import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import { type CronDeps, cronRoutes } from "../src/cron";
import { campaignDrafts, type Db } from "../src/db";
import { type FakeDeployment, fakeDeployment } from "./fake-deployment";
import { BASE, env, warmUp } from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { advance, countRows, DAY, freshDb, seedDeadUsers } from "./support";

let db: Db;
let deployment: FakeDeployment;
let call: Call;

beforeEach(async () => {
	db = await freshDb();
	deployment = fakeDeployment();
	const app = createApp({
		env,
		db,
		fetch: deployment.fetch,
		platformOrigin: deployment.origin,
	});
	call = async (req) => app.request(req);
	await warmUp(call);
	return () => db.close();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

const BEARER = `Bearer ${env.CRON_SECRET}`;

const sweepRequest = (authorization?: string) =>
	new Request(`${BASE}/cron/sweep`, {
		headers: authorization ? { authorization } : {},
	});

test.each([
	["no Authorization header", undefined],
	["a wrong secret", "Bearer test-cron-secret-bbbbbbbbbbbbbbbbbbbbbbb"],
	["the secret without the Bearer scheme", env.CRON_SECRET],
	["a malformed header", "Bearer not a token!"],
])(
	"/cron/sweep with %s is 401 and sweeps nothing",
	async (_, authorization) => {
		await seedDeadUsers(db, 1);

		const res = await call(sweepRequest(authorization));

		expect(res.status).toBe(401);
		expect(await res.text()).toBe("");
		expect(await countRows(db, "user")).toBe(1);
	},
);

test("/cron/sweep with the secret drops a connection whose refresh token expired", async () => {
	await connectFlow(call, deployment, BASE).connect();
	advance(91 * DAY);

	const res = await call(sweepRequest(BEARER));

	expect(res.status).toBe(200);
	expect(await res.json()).toEqual({ connections: 1, drafts: 0 });
	expect(await countRows(db, "connection")).toBe(0);
});

test("/cron/sweep drops the campaign drafts of each connection it drops", async () => {
	await seedDeadUsers(db, 1);
	const drafts = campaignDrafts(db);
	const key = { userId: "u1", origin: deployment.origin, campaignId: "c1" };
	await drafts.put(
		{
			...key,
			baseVersion: "3",
			settings: { goal: { amount: "10.00", currency: "USD" } },
			page: null,
			pageKind: null,
		},
		null,
	);

	await call(sweepRequest(BEARER));

	expect(await countRows(db, "user")).toBe(0);
	expect(await drafts.get(key)).toBeNull();
});

test("/cron/sweep sweeps again while a batch comes back full", async () => {
	await seedDeadUsers(db, 1001);

	const res = await call(sweepRequest(BEARER));

	expect(await res.json()).toEqual({ connections: 1001, drafts: 0 });
	expect(await countRows(db, "user")).toBe(0);
});

test("/cron/sweep stops repeating once 50 s have passed, leaving the rest for tomorrow", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	let now = 0;
	const cron = cronRoutes({
		auth: {
			// each batch is full and takes 30 s
			sweep: async () => {
				now += 30_000;
				return { connections: 500, more: true };
			},
		},
		drafts: { deleteIdleSince: async () => 0 },
		secret: env.CRON_SECRET,
		clock: () => now,
	});

	const res = await cron.request(
		new Request(`${BASE}/sweep`, { headers: { authorization: BEARER } }),
	);

	expect(await res.json()).toEqual({ connections: 1000, drafts: 0 });
});

test("/cron/sweep writes one log line, its counts and duration only", async () => {
	await seedDeadUsers(db, 2);
	const out = vi.spyOn(console, "log").mockImplementation(() => {});
	const err = vi.spyOn(console, "error").mockImplementation(() => {});

	await call(sweepRequest(BEARER));

	const lines = [...out.mock.calls, ...err.mock.calls].map(([line]) => line);
	expect(lines).toHaveLength(1);
	expect(JSON.parse(lines[0])).toStrictEqual({
		kind: "sweep",
		connections: 2,
		drafts: 0,
		ms: expect.any(Number),
	});
});

// Every console line of the run, parsed, stdout's first.
function captureLines() {
	const out = vi.spyOn(console, "log").mockImplementation(() => {});
	const err = vi.spyOn(console, "error").mockImplementation(() => {});
	return () =>
		[...out.mock.calls, ...err.mock.calls].map(([line]) =>
			JSON.parse(String(line)),
		);
}

const sweepWith = (deps: Pick<CronDeps, "auth" | "drafts">) =>
	cronRoutes({ ...deps, secret: env.CRON_SECRET }).request(
		new Request(`${BASE}/sweep`, { headers: { authorization: BEARER } }),
	);

test("/cron/sweep whose auth sweep throws still drops idle drafts, logs both, and is a 500", async () => {
	const lines = captureLines();
	let draftsSwept = false;

	const res = await sweepWith({
		auth: {
			sweep: async () => {
				throw new TypeError("store down: secret-1d9e");
			},
		},
		drafts: {
			deleteIdleSince: async () => {
				draftsSwept = true;
				return 2;
			},
		},
	});

	expect(draftsSwept).toBe(true);
	expect(res.status).toBe(500);
	expect(await res.json()).toEqual({ error: "internal_error" });
	expect(lines()).toStrictEqual([
		{ kind: "sweep", connections: 0, drafts: 2, ms: expect.any(Number) },
		{ kind: "error", where: "sweep", errorName: "TypeError" },
	]);
});

test("/cron/sweep whose draft sweep throws still logs the connections it dropped, and is a 500", async () => {
	const lines = captureLines();

	const res = await sweepWith({
		auth: { sweep: async () => ({ connections: 3, more: false }) },
		drafts: {
			deleteIdleSince: async () => {
				throw new TypeError("store down: secret-1d9e");
			},
		},
	});

	expect(res.status).toBe(500);
	expect(lines()).toStrictEqual([
		{ kind: "sweep", connections: 3, drafts: 0, ms: expect.any(Number) },
		{ kind: "error", where: "sweep", errorName: "TypeError" },
	]);
});

test("/cron/sweep whose database is down is a 500 logged by error name only", async () => {
	const lines = captureLines();
	db.close();

	const res = await call(sweepRequest(BEARER));

	expect(res.status).toBe(500);
	expect(await res.json()).toEqual({ error: "internal_error" });
	expect(lines()).toStrictEqual([
		{ kind: "sweep", connections: 0, drafts: 0, ms: expect.any(Number) },
		{
			kind: "error",
			where: "sweep",
			errorName: expect.stringMatching(/^\w+$/),
		},
		{
			kind: "error",
			where: "sweep",
			errorName: expect.stringMatching(/^\w+$/),
		},
	]);
});

test("/cron/sweep drops drafts untouched for 30 days and keeps newer ones", async () => {
	const drafts = campaignDrafts(db);
	const key = (campaignId: string) => ({
		userId: "u1",
		origin: deployment.origin,
		campaignId,
	});
	const draft = (campaignId: string) => ({
		...key(campaignId),
		baseVersion: "3",
		settings: { goal: { amount: "10.00", currency: "USD" } },
		page: null,
		pageKind: null,
	});
	// at sweep time "outside" has idled 30 days and a second, "inside" 30 days
	// less a second
	await drafts.put(draft("outside"), null);
	advance(2_000);
	await drafts.put(draft("inside"), null);
	advance(30 * DAY - 1_000);

	const res = await call(sweepRequest(BEARER));

	expect(await res.json()).toMatchObject({ drafts: 1 });
	expect(await drafts.get(key("outside"))).toBeNull();
	expect(await drafts.get(key("inside"))).not.toBeNull();
});
