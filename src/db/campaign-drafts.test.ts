import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { freshDb } from "../../test/support";
import type { Origin } from "../deployment/origin";
import { type CampaignDraftKey, campaignDrafts, type Db } from "./index";

const ORIGIN = "https://give.example.org" as Origin;
const KEY: CampaignDraftKey = {
	userId: "user-1",
	origin: ORIGIN,
	campaignId: "camp-1",
};

let db: Db;

beforeEach(async () => {
	db = await freshDb();
});

afterEach(() => db.close());

test("get returns the draft put, with updatedAt set to now", async () => {
	const store = campaignDrafts(db);
	const before = Date.now();

	await store.put({
		...KEY,
		baseVersion: "17",
		settings: { title: "Spring drive", goal: 5000 },
		page: [{ type: "text", body: "Hello" }],
		pageKind: "blocks",
	});

	const draft = await store.get(KEY);
	expect(draft).toEqual({
		...KEY,
		baseVersion: "17",
		settings: { title: "Spring drive", goal: 5000 },
		page: [{ type: "text", body: "Hello" }],
		pageKind: "blocks",
		updatedAt: expect.any(Date),
		revision: expect.any(Number),
	});
	expect(draft?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
	expect(draft?.updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
});

test("put over an existing draft replaces the whole row, leaving one", async () => {
	const store = campaignDrafts(db);
	await store.put({
		...KEY,
		baseVersion: "17",
		settings: { title: "Spring drive" },
		page: "<p>Hello</p>",
		pageKind: "content",
	});

	await store.put({
		...KEY,
		baseVersion: null,
		settings: { goal: 9000 },
		page: null,
		pageKind: null,
	});

	expect(await store.get(KEY)).toMatchObject({
		baseVersion: null,
		settings: { goal: 9000 },
		page: null,
		pageKind: null,
	});
	const { rows } = await db.execute("SELECT count(*) AS n FROM campaign_draft");
	expect(rows[0]?.n).toBe(1);
});

test("get is null for a key with no draft", async () => {
	expect(await campaignDrafts(db).get(KEY)).toBeNull();
});

test("drafts differing in user, origin or campaign are kept apart", async () => {
	const store = campaignDrafts(db);
	const keys: CampaignDraftKey[] = [
		KEY,
		{ ...KEY, userId: "user-2" },
		{ ...KEY, origin: "https://other.example.org" as Origin },
		{ ...KEY, campaignId: "camp-2" },
	];
	for (const [i, key] of keys.entries()) {
		await store.put({
			...key,
			baseVersion: String(i),
			settings: null,
			page: null,
			pageKind: null,
		});
	}

	for (const [i, key] of keys.entries()) {
		expect(await store.get(key)).toMatchObject({
			...key,
			baseVersion: String(i),
		});
	}
});

const EMPTY = { baseVersion: null, settings: null, page: null, pageKind: null };

test("a put with the revision get returned applies, and moves the revision", async () => {
	const store = campaignDrafts(db);
	await store.put({ ...KEY, ...EMPTY }, null);
	const read = await store.get(KEY);
	if (!read) throw new Error("no draft");

	expect(
		await store.put(
			{ ...KEY, ...EMPTY, settings: { goal: 9000 } },
			read.revision,
		),
	).toBe(true);

	const after = await store.get(KEY);
	expect(after?.settings).toEqual({ goal: 9000 });
	expect(after?.revision).not.toBe(read.revision);
});

test("a put with a revision since moved on writes nothing and says so", async () => {
	const store = campaignDrafts(db);
	await store.put({ ...KEY, ...EMPTY }, null);
	const read = await store.get(KEY);
	if (!read) throw new Error("no draft");
	await store.put({ ...KEY, ...EMPTY, settings: { goal: 1 } }, read.revision);

	expect(
		await store.put({ ...KEY, ...EMPTY, settings: { goal: 2 } }, read.revision),
	).toBe(false);

	expect((await store.get(KEY))?.settings).toEqual({ goal: 1 });
});

test("a first put, expecting no draft, writes nothing over one stored since", async () => {
	const store = campaignDrafts(db);
	expect(
		await store.put({ ...KEY, ...EMPTY, settings: { goal: 1 } }, null),
	).toBe(true);

	expect(
		await store.put({ ...KEY, ...EMPTY, settings: { goal: 2 } }, null),
	).toBe(false);

	expect((await store.get(KEY))?.settings).toEqual({ goal: 1 });
});

test("delete removes that draft alone and says whether one was there", async () => {
	const store = campaignDrafts(db);
	const other = { ...KEY, campaignId: "camp-2" };
	await store.put({ ...KEY, ...EMPTY });
	await store.put({ ...other, ...EMPTY });

	expect(await store.delete(KEY)).toBe(true);
	expect(await store.delete(KEY)).toBe(false);

	expect(await store.get(KEY)).toBeNull();
	expect(await store.get(other)).not.toBeNull();
});

test("a delete with a revision since moved on leaves the draft and says so", async () => {
	const store = campaignDrafts(db);
	await store.put({ ...KEY, ...EMPTY }, null);
	const read = await store.get(KEY);
	if (!read) throw new Error("no draft");
	await store.put({ ...KEY, ...EMPTY, settings: { goal: 1 } }, read.revision);

	expect(await store.delete(KEY, read.revision)).toBe(false);

	expect((await store.get(KEY))?.settings).toEqual({ goal: 1 });
});

test("a delete with the revision get returned removes the draft", async () => {
	const store = campaignDrafts(db);
	await store.put({ ...KEY, ...EMPTY }, null);
	const read = await store.get(KEY);
	if (!read) throw new Error("no draft");

	expect(await store.delete(KEY, read.revision)).toBe(true);

	expect(await store.get(KEY)).toBeNull();
});

test("a draft deleted and stored again refuses a revision read before the delete", async () => {
	const store = campaignDrafts(db);
	await store.put({ ...KEY, ...EMPTY }, null);
	const deleted = await store.get(KEY);
	if (!deleted) throw new Error("no draft");
	await store.delete(KEY, deleted.revision);
	await store.put({ ...KEY, ...EMPTY, settings: { goal: 1 } }, null);

	expect(
		await store.put(
			{ ...KEY, ...EMPTY, settings: { goal: 2 } },
			deleted.revision,
		),
	).toBe(false);
	expect(await store.delete(KEY, deleted.revision)).toBe(false);

	expect((await store.get(KEY))?.settings).toEqual({ goal: 1 });
});

test("deleteIdleSince removes only drafts last put before the cutoff, counting them", async () => {
	const store = campaignDrafts(db);
	const cutoff = new Date("2026-10-01T00:00:00Z");
	const old = { ...KEY, campaignId: "old" };
	const atCutoff = { ...KEY, campaignId: "at-cutoff" };
	const fresh = { ...KEY, campaignId: "fresh" };
	vi.useFakeTimers({ toFake: ["Date"] });
	try {
		vi.setSystemTime(cutoff.getTime() - 1);
		await store.put({ ...old, ...EMPTY });
		vi.setSystemTime(cutoff);
		await store.put({ ...atCutoff, ...EMPTY });
		vi.setSystemTime(cutoff.getTime() + 1);
		await store.put({ ...fresh, ...EMPTY });
	} finally {
		vi.useRealTimers();
	}

	expect(await store.deleteIdleSince(cutoff)).toBe(1);

	expect(await store.get(old)).toBeNull();
	expect(await store.get(atCutoff)).not.toBeNull();
	expect(await store.get(fresh)).not.toBeNull();
});

test("deleteForUser removes every draft of that user across origins, counting them", async () => {
	const store = campaignDrafts(db);
	const otherOrigin = { ...KEY, origin: "https://other.example.org" as Origin };
	const otherUser = { ...KEY, userId: "user-2" };
	await store.put({ ...KEY, ...EMPTY });
	await store.put({ ...otherOrigin, ...EMPTY });
	await store.put({ ...otherUser, ...EMPTY });

	expect(await store.deleteForUser("user-1")).toBe(2);

	expect(await store.get(KEY)).toBeNull();
	expect(await store.get(otherOrigin)).toBeNull();
	expect(await store.get(otherUser)).not.toBeNull();
});

test("a part whose stored JSON no longer parses reads as null, a page with its kind", async () => {
	const store = campaignDrafts(db);
	await store.put({
		...KEY,
		baseVersion: "3",
		settings: { title: "Spring drive" },
		page: [{ type: "text" }],
		pageKind: "blocks",
	});
	await db.execute("UPDATE campaign_draft SET page = '[{\"type\":'");

	expect(await store.get(KEY)).toMatchObject({
		baseVersion: "3",
		settings: { title: "Spring drive" },
		page: null,
		pageKind: null,
	});
});

test.each([
	{ case: "a page without a kind", page: [{ type: "text" }], pageKind: null },
	{ case: "a kind without a page", page: null, pageKind: "blocks" },
	{ case: "an unknown kind", page: "<p>Hi</p>", pageKind: "html" },
] as const)(
	"put refuses $case, storing nothing",
	async ({ page, pageKind }) => {
		const store = campaignDrafts(db);

		await expect(
			store.put({
				...KEY,
				...EMPTY,
				page,
				pageKind: pageKind as "blocks" | null,
			}),
		).rejects.toThrow(/CHECK constraint/);

		expect(await store.get(KEY)).toBeNull();
	},
);
