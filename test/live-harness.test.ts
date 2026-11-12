import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { ROUTES } from "../src/deployment/contract";
import { ACTIONS } from "../src/mcp/actions";
import { fakeDeployment, MVP_ACTIONS } from "./fake-deployment";
import { readLiveEnv } from "./live/env";
import { runLiveHarness } from "./live/harness";
import { PLATFORM_ACTION_OF } from "./platform-hello";

test("readLiveEnv refuses to run until LIVE_ORIGIN and LIVE_CODE are set", () => {
	expect(() => readLiveEnv({}, join(tmpdir(), "missing.env.live"))).toThrow(
		"set LIVE_ORIGIN and LIVE_CODE",
	);
});

test("readLiveEnv takes the environment first and the file for the rest", () => {
	const dir = mkdtempSync(join(tmpdir(), "live-env-"));
	const file = join(dir, ".env.live");
	writeFileSync(file, 'LIVE_ORIGIN="https://from.file"\nLIVE_CODE=from-file\n');

	expect(readLiveEnv({}, file)).toEqual({
		origin: "https://from.file",
		code: "from-file",
	});
	expect(readLiveEnv({ LIVE_ORIGIN: "https://from.env" }, file)).toEqual({
		origin: "https://from.env",
		code: "from-file",
	});
});

test("the harness runs the minimum tools against the fake and records no secrets", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter" });
	dep.setActions(MVP_ACTIONS);
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));
	const resultsPath = join(dir, "results.ndjson");
	const now = new Date("2026-10-17T15:04:05.000Z");

	await runLiveHarness({
		origin: dep.origin,
		code: dep.mintCode(),
		fetch: dep.fetch,
		resultsPath,
		now,
	});

	const text = readFileSync(resultsPath, "utf8");
	const rows = text
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
	const key = dep.issuedKeys[0] ?? "";

	expect(key).not.toBe("");
	expect(text).not.toContain(key);
	expect(text).not.toContain("connector live test");
	expect(
		rows.every(
			(row) => Object.keys(row).toSorted().join() === "bytes,ms,outcome,tool",
		),
	).toBe(true);
	expect(
		rows
			.filter((row) => row.tool === "create_campaign")
			.map((row) => row.outcome),
	).toEqual(["ok", "replay"]);
	expect(
		rows
			.filter((row) => row.tool === "record_donation")
			.map((row) => row.outcome),
	).toEqual(["ok", "replay"]);
	const unknown = rows.filter((row) => row.outcome === "unknown_action");
	expect(unknown).toHaveLength(12);
	expect(rows.at(-1)).toMatchObject({
		tool: "list_campaigns",
		outcome: "key_refused",
	});
	expect(dep.issuedKeys).toHaveLength(1);
});

// What the fake Platform lists, plus record_donation, as a release that records gifts would.
const PLATFORM_SERVES = [
	...Object.values(PLATFORM_ACTION_OF),
	"donations.record",
];

const MVP = new Set<string>(MVP_ACTIONS);

// The routes of the 12 tools beyond the minimum 13, each as a method and a
// path pattern: a write, publish or reset the harness must never send when the
// deployment serves it.
const OTHER_ROUTES = ACTIONS.filter((spec) => !MVP.has(spec.action)).map(
	(spec) => ({
		action: spec.action,
		method: ROUTES[spec.action].method,
		path: new RegExp(
			`${ROUTES[spec.action].path.replace(/:[^/]+/g, "[^/]+")}$`,
		),
	}),
);

function reachedOther(
	dep: ReturnType<typeof fakeDeployment>,
	actions: readonly string[] = OTHER_ROUTES.map((route) => route.action),
): string[] {
	return dep.calls
		.filter((call) =>
			OTHER_ROUTES.some(
				(route) =>
					actions.includes(route.action) &&
					route.method === call.method &&
					route.path.test(call.path),
			),
		)
		.map((call) => `${call.method} ${call.path}`);
}

const formPath = (dep: ReturnType<typeof fakeDeployment>): string | undefined =>
	dep.calls.find(
		(call) => call.method === "GET" && /\/forms\/[^/]+$/.test(call.path),
	)?.path;

async function runHarness(
	dep: ReturnType<typeof fakeDeployment>,
): Promise<Record<string, unknown>[]> {
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));
	const resultsPath = join(dir, "results.ndjson");
	await runLiveHarness({
		origin: dep.origin,
		code: dep.mintCode(),
		fetch: dep.fetch,
		resultsPath,
		now: new Date("2026-10-17T15:04:05.000Z"),
	});
	return readFileSync(resultsPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("on Platform with create_form served, the harness creates a form, lists it and reads that one, not an earlier form", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		extraForm: true,
	});
	dep.setActions(PLATFORM_SERVES);

	const rows = await runHarness(dep);
	const tools = rows.map((row) => row.tool);

	expect(
		tools.filter((tool) =>
			["create_form", "list_forms", "get_form"].includes(tool as string),
		),
	).toEqual(["create_form", "list_forms", "get_form"]);
	expect(rows.find((row) => row.tool === "create_form")).toMatchObject({
		outcome: "ok",
	});
	const posted = dep.calls.filter(
		(call) => call.method === "POST" && call.path.endsWith("/forms"),
	);
	expect(posted).toHaveLength(1);
	// frm_1 and frm_other list first; the form read is the one create_form made
	expect(formPath(dep)).toMatch(/\/forms\/(?!frm_1$|frm_other$)[^/]+$/);
	expect(rows.at(-1)).toMatchObject({
		tool: "list_campaigns",
		outcome: "key_refused",
	});
});

test("on Platform the harness follows list_forms pages to the form it made", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		fillerForms: 120,
	});
	dep.setActions(PLATFORM_SERVES);
	// what the deployment answered to each list_forms call
	const answered: { next_cursor: string | null }[] = [];
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));
	const resultsPath = join(dir, "results.ndjson");

	await runLiveHarness({
		origin: dep.origin,
		code: dep.mintCode(),
		fetch: async (input, init) => {
			const res = await dep.fetch(input, init);
			const url = new URL(input instanceof Request ? input.url : String(input));
			const isList =
				(init?.method ?? "GET") === "GET" && url.pathname.endsWith("/forms");
			if (isList) answered.push(await res.clone().json());
			return res;
		},
		resultsPath,
		now: new Date("2026-10-17T15:04:05.000Z"),
	});
	const rows = readFileSync(resultsPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as Record<string, unknown>);

	// frm_1 and 120 fillers overfill the first page, so the made form is on a later one
	const listCalls = dep.calls.filter(
		(call) => call.method === "GET" && call.path.endsWith("/forms"),
	);
	expect(listCalls).toHaveLength(2);
	// the second call asks for the cursor the first answer gave
	expect(answered[0]?.next_cursor).toEqual(expect.any(String));
	expect(listCalls[1]?.query.cursor).toBe(answered[0]?.next_cursor);
	expect(listCalls[0]?.query.cursor).toBeUndefined();
	expect(listCalls.every((call) => Number(call.query.limit) <= 100)).toBe(true);
	expect(formPath(dep)).toMatch(/\/forms\/(?!frm_1$|frm_fill_)[^/]+$/);
	expect(rows.find((row) => row.tool === "get_form")).toMatchObject({
		outcome: "ok",
	});
});

test("on Platform the harness skips the other tools it serves and calls only the ones it does not", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		defaultForm: false,
	});
	dep.setActions(PLATFORM_SERVES);

	const rows = await runHarness(dep);

	const otherTools = ACTIONS.filter((spec) => !MVP.has(spec.action));
	// create_form is served and still called, to make the form the run reads
	const servedOthers = otherTools
		.filter((spec) => PLATFORM_SERVES.includes(spec.action))
		.filter((spec) => spec.action !== "forms.create")
		.map((spec) => spec.tool);
	const unservedOthers = otherTools
		.filter((spec) => !PLATFORM_SERVES.includes(spec.action))
		.map((spec) => spec.tool);
	// both sets are real, so an over-skipping or an under-skipping harness differs
	expect(servedOthers.length).toBeGreaterThan(0);
	expect(unservedOthers.length).toBeGreaterThan(0);

	const skipped = rows.filter((row) => row.outcome === "skipped");
	expect(skipped.map((row) => row.tool).toSorted()).toEqual(
		servedOthers.toSorted(),
	);
	expect(skipped.every((row) => row.ms === 0 && row.bytes === 0)).toBe(true);
	expect(
		rows
			.filter((row) => row.outcome === "unknown_action")
			.map((row) => row.tool)
			.toSorted(),
	).toEqual(unservedOthers.toSorted());
	// a served write or publish never reached the deployment; create_form is
	// the one served other tool called, to make the form the run reads
	expect(
		reachedOther(
			dep,
			PLATFORM_SERVES.filter((action) => action !== "forms.create"),
		),
	).toEqual([]);
	// the served set holds real writes, so the check above has routes to catch
	expect(PLATFORM_SERVES).toEqual(
		expect.arrayContaining(["campaigns.publish", "forms.update"]),
	);
});

// What Platform's hello lists: no donations.record.
const PLATFORM_LISTED = Object.values(PLATFORM_ACTION_OF);

const donationPosts = (dep: ReturnType<typeof fakeDeployment>) =>
	dep.calls.filter(
		(call) => call.method === "POST" && call.path.endsWith("/donations"),
	);

test("on Platform, which does not record gifts, record_donation is refused once and get_donor reads the donor list_donors lists", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(PLATFORM_LISTED);
	dep.seedGift({ amount: "5.00", date: "2026-10-01" });

	const rows = await runHarness(dep);

	expect(
		rows
			.filter((row) => row.tool === "record_donation")
			.map((row) => row.outcome),
	).toEqual(["unknown_action"]);
	// the one refused call; the fake stored no gift for a second to replay
	expect(donationPosts(dep)).toHaveLength(1);
	expect(rows.find((row) => row.tool === "get_donor")).toMatchObject({
		outcome: "ok",
	});
	expect(
		dep.calls.some(
			(call) => call.method === "GET" && /\/donors\/dnr_\d+$/.test(call.path),
		),
	).toBe(true);
});

test("on Platform, get_donor reads the first donor list_donors lists, not a later one", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(PLATFORM_LISTED);
	const donor = (id: string) => ({
		id,
		name: id,
		email: null,
		total: { amount: "5.00", currency: "USD" },
		gift_count: 1,
	});
	dep.intercept((req) => {
		const path = new URL(req.url).pathname;
		if (req.method !== "GET") return undefined;
		if (path.endsWith("/donors")) {
			return Response.json({
				data: [donor("dnr_first"), donor("dnr_second")],
				next_cursor: null,
			});
		}
		const read = /\/donors\/(dnr_first|dnr_second)$/.exec(path);
		return read?.[1] === undefined
			? undefined
			: Response.json({
					...donor(read[1]),
					gifts: { data: [], next_cursor: null },
				});
	});

	const rows = await runHarness(dep);

	expect(rows.find((row) => row.tool === "get_donor")).toMatchObject({
		outcome: "ok",
	});
	expect(
		dep.calls
			.filter(
				(call) => call.method === "GET" && /\/donors\/[^/]+$/.test(call.path),
			)
			.map((call) => call.path.split("/").at(-1)),
	).toEqual(["dnr_first"]);
});

test("on Platform serving donations.record, record_donation records the gift and replays it", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(PLATFORM_SERVES);

	const rows = await runHarness(dep);

	expect(
		rows
			.filter((row) => row.tool === "record_donation")
			.map((row) => row.outcome),
	).toEqual(["ok", "replay"]);
	expect(donationPosts(dep)).toHaveLength(2);
});

test("on Platform with no donor listed, get_donor is skipped and not called", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(PLATFORM_LISTED);

	const rows = await runHarness(dep);

	expect(rows.find((row) => row.tool === "get_donor")).toEqual({
		tool: "get_donor",
		outcome: "skipped",
		ms: 0,
		bytes: 0,
	});
	expect(
		dep.calls.filter((call) => /\/donors\/[^/]+$/.test(call.path)),
	).toEqual([]);
	expect(rows.at(-1)).toMatchObject({
		tool: "list_campaigns",
		outcome: "key_refused",
	});
});

test("on Platform a list_donors answer with no data array fails the run instead of skipping get_donor", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(PLATFORM_LISTED);
	dep.seedGift({ amount: "5.00", date: "2026-10-01" });
	dep.intercept((req) =>
		req.method === "GET" && new URL(req.url).pathname.endsWith("/donors")
			? Response.json({ data: "oops", next_cursor: null })
			: undefined,
	);
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));
	const resultsPath = join(dir, "results.ndjson");

	await expect(
		runLiveHarness({
			origin: dep.origin,
			code: dep.mintCode(),
			fetch: dep.fetch,
			resultsPath,
			now: new Date("2026-10-17T15:04:05.000Z"),
		}),
	).rejects.toThrow("list_donors returned no data array");
	const tools = readFileSync(resultsPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => (JSON.parse(line) as { tool: string }).tool);
	expect(tools).toContain("list_donors");
	expect(tools).not.toContain("get_donor");
});

test("on Platform the live check is live: every other tool, not served, reaches the fake on its own route", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(MVP_ACTIONS);

	await runHarness(dep);

	// MVP-only: runTool validates no input, so each other tool is sent and refused.
	// A route whose method or path matches nothing the tool sends would leave the
	// "sent none" checks beside this one green for nothing.
	const unreached = OTHER_ROUTES.filter(
		(route) => reachedOther(dep, [route.action]).length === 0,
	).map((route) => route.action);
	expect(unreached).toEqual([]);
});

test("on Platform each tool runs with the spec its connection is served: the edit and publish tools read the campaign first", async () => {
	const campaignReads = (dep: ReturnType<typeof fakeDeployment>) =>
		dep.calls.filter(
			(call) => call.method === "GET" && /\/campaigns\/[^/]+$/.test(call.path),
		).length;
	const platform = fakeDeployment({ name: "Hope Shelter", platform: true });
	platform.setActions(MVP_ACTIONS);
	const standalone = fakeDeployment({ name: "Hope Shelter" });
	standalone.setActions(MVP_ACTIONS);

	await runHarness(platform);
	await runHarness(standalone);

	// Platform's update and publish tools read the campaign to keep a live
	// campaign's edit as a draft; Standalone's specs send them without a read.
	// get_campaign reads once on both.
	expect(campaignReads(standalone)).toBe(1);
	expect(campaignReads(platform)).toBeGreaterThan(campaignReads(standalone));
});

test("on Standalone serving the writes, the harness skips every other tool and sends none", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter" });
	dep.setActions([
		...MVP_ACTIONS,
		...OTHER_ROUTES.map((route) => route.action),
	]);

	const rows = await runHarness(dep);

	expect(rows.filter((row) => row.outcome === "skipped")).toHaveLength(12);
	expect(rows.filter((row) => row.outcome === "unknown_action")).toEqual([]);
	expect(reachedOther(dep)).toEqual([]);
});

test("when hello states no actions, every action is offered and the harness skips the other tools", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter" });
	dep.intercept((req) =>
		req.method === "GET" && new URL(req.url).pathname.endsWith("/hello")
			? Response.json({
					service: "better-giving",
					contract: 1,
					release: "1.0.0",
					name: "Hope Shelter",
				})
			: undefined,
	);

	const rows = await runHarness(dep);

	expect(rows.filter((row) => row.outcome === "skipped")).toHaveLength(12);
	expect(reachedOther(dep)).toEqual([]);
});

test("on Platform with create_form not served, the harness uses the form that is listed", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		extraForm: true,
	});
	dep.setActions(MVP_ACTIONS);

	const rows = await runHarness(dep);

	expect(
		rows.some((row) => row.tool === "create_form" && row.outcome === "ok"),
	).toBe(false);
	expect(rows.find((row) => row.tool === "get_form")).toMatchObject({
		outcome: "ok",
	});
	// the first form listed, not the last
	expect(formPath(dep)).toMatch(/\/forms\/frm_1$/);
});

test("on Platform with no form and create_form not served, the harness fails naming the cause and still writes its results", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		defaultForm: false,
	});
	dep.setActions(MVP_ACTIONS);
	dep.setCampaignForms(false);
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));
	const resultsPath = join(dir, "results.ndjson");

	await expect(
		runLiveHarness({
			origin: dep.origin,
			code: dep.mintCode(),
			fetch: dep.fetch,
			resultsPath,
			now: new Date("2026-10-17T15:04:05.000Z"),
		}),
	).rejects.toThrow("list_forms listed no form, and create_form was not run");
	expect(readFileSync(resultsPath, "utf8")).toContain('"tool":"list_forms"');
});

// Standalone serves create_form here yet never runs it.
test("on Standalone with no form listed, the harness fails with the same cause even when create_form is served", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", defaultForm: false });
	dep.setCampaignForms(false);
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));

	await expect(
		runLiveHarness({
			origin: dep.origin,
			code: dep.mintCode(),
			fetch: dep.fetch,
			resultsPath: join(dir, "results.ndjson"),
			now: new Date("2026-10-17T15:04:05.000Z"),
		}),
	).rejects.toThrow("list_forms listed no form, and create_form was not run");
	expect(dep.calls.some((call) => call.path.endsWith("/forms"))).toBe(true);
	expect(
		dep.calls.some(
			(call) => call.method === "POST" && call.path.endsWith("/forms"),
		),
	).toBe(false);
});

test("on Platform the harness fails when list_forms does not list the form create_form made, and still writes its results", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(PLATFORM_SERVES);
	dep.intercept((req) =>
		req.method === "GET" && new URL(req.url).pathname.endsWith("/forms")
			? Response.json({ data: [], next_cursor: null })
			: undefined,
	);
	const dir = mkdtempSync(join(tmpdir(), "live-results-"));
	const resultsPath = join(dir, "results.ndjson");

	await expect(
		runLiveHarness({
			origin: dep.origin,
			code: dep.mintCode(),
			fetch: dep.fetch,
			resultsPath,
			now: new Date("2026-10-17T15:04:05.000Z"),
		}),
	).rejects.toThrow("list_forms does not list the form create_form made");
	const tools = readFileSync(resultsPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => (JSON.parse(line) as { tool: string }).tool);
	expect(tools).toContain("create_form");
	expect(tools).not.toContain("get_form");
});
