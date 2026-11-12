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

// What the fake Platform lists, plus record_donation, which the 13 minimum tools need.
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

async function runOnPlatform(
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

	const rows = await runOnPlatform(dep);
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

test("on Platform the harness skips the other tools it serves and calls only the ones it does not", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		defaultForm: false,
	});
	dep.setActions(PLATFORM_SERVES);

	const rows = await runOnPlatform(dep);

	const skipped = rows.filter((row) => row.outcome === "skipped");
	expect(skipped.length).toBeGreaterThan(0);
	expect(skipped.map((row) => row.tool)).toContain("update_form");
	expect(skipped.every((row) => row.ms === 0 && row.bytes === 0)).toBe(true);
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

test("on Platform the live check is live: a non-served write would reach the fake", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(MVP_ACTIONS);

	await runOnPlatform(dep);

	// MVP-only: every other tool is called and refused, so the fake saw their routes
	expect(reachedOther(dep)).toEqual(
		expect.arrayContaining([expect.stringMatching(/^POST .*\/publish$/)]),
	);
});

test("on Standalone serving the writes, the harness skips every other tool and sends none", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter" });
	dep.setActions([
		...MVP_ACTIONS,
		...OTHER_ROUTES.map((route) => route.action),
	]);

	const rows = await runOnPlatform(dep);

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

	const rows = await runOnPlatform(dep);

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

	const rows = await runOnPlatform(dep);

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
	).rejects.toThrow("no form and create_form not served");
	expect(readFileSync(resultsPath, "utf8")).toContain('"tool":"list_forms"');
});
