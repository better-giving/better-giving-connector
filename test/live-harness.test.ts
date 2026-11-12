import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
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

test("on Platform with no forms and create_form served, the harness creates one, lists it and reads it", async () => {
	const dep = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		defaultForm: false,
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
	// a served write or publish never reached the deployment
	const served = (call: { method: string; path: string }) =>
		/\/(publish|end|upload-link)$/.test(call.path) ||
		(call.method === "PATCH" && /\/(forms|campaigns)\/[^/]+$/.test(call.path));
	expect(dep.calls.filter(served)).toEqual([]);
});

test("on Platform with create_form not served, the harness uses the form that is listed", async () => {
	const dep = fakeDeployment({ name: "Hope Shelter", platform: true });
	dep.setActions(MVP_ACTIONS);

	const rows = await runOnPlatform(dep);

	expect(
		rows.some((row) => row.tool === "create_form" && row.outcome === "ok"),
	).toBe(false);
	expect(rows.find((row) => row.tool === "get_form")).toMatchObject({
		outcome: "ok",
	});
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
