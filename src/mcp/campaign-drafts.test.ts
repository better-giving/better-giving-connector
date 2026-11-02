import { expect, test } from "vitest";
import { memoryDrafts } from "../../test/memory-drafts";
import type { CampaignDraftKey, CampaignDrafts } from "../db";
import {
	DRAFT_MOVED,
	mergeDraft,
	saveLiveCampaignEdit,
} from "./campaign-drafts";
import { ToolRefusal } from "./spec";

// Platform serves no content action, so a content page's merge is checked
// here rather than through the tools.

const content = (page: Record<string, unknown>) =>
	({ part: "page", kind: "content", page }) as const;
const blocks = (page: unknown[]) =>
	({ part: "page", kind: "blocks", page }) as const;

test("a content edit merges key by key into a content page, the later value winning", () => {
	const first = mergeDraft(null, content({ story: "One.", hero: "a.jpg" }));
	const second = mergeDraft(first, content({ story: "Two." }));

	expect(second).toEqual({
		settings: null,
		page: { story: "Two.", hero: "a.jpg" },
		pageKind: "content",
	});
});

test("a page of the other kind replaces the draft's page, and the settings stay", () => {
	const stored = mergeDraft(
		mergeDraft(null, { part: "settings", settings: { goal: null } }),
		blocks([{ type: "story", text: "Blocks." }]),
	);

	const asContent = mergeDraft(stored, content({ story: "Content." }));
	const backToBlocks = mergeDraft(asContent, blocks([{ type: "title" }]));

	expect(asContent).toEqual({
		settings: { goal: null },
		page: { story: "Content." },
		pageKind: "content",
	});
	expect(backToBlocks).toEqual({
		settings: { goal: null },
		page: [{ type: "title" }],
		pageKind: "blocks",
	});
});

test("a settings edit leaves the draft's page as it is", () => {
	const stored = mergeDraft(null, content({ story: "Kept." }));

	expect(
		mergeDraft(stored, { part: "settings", settings: { end_date: null } }),
	).toEqual({
		settings: { end_date: null },
		page: { story: "Kept." },
		pageKind: "content",
	});
});

const deps = (drafts: CampaignDrafts) =>
	({
		connection: { userId: "u1", origin: "https://hopeshelter.org" },
		client: {
			call: async () => ({
				body: { id: "cmp_1", status: "published", version: "7" },
			}),
		},
		drafts,
	}) as unknown as Parameters<typeof saveLiveCampaignEdit>[0];

test("a save refuses, and keeps the other save, when the draft changed after it was read", async () => {
	const store = memoryDrafts();
	const key = {
		userId: "u1",
		origin: "https://hopeshelter.org" as CampaignDraftKey["origin"],
		campaignId: "cmp_1",
	};
	const empty = {
		baseVersion: "7",
		settings: null,
		page: null,
		pageKind: null,
	};
	await store.put({ ...key, ...empty, settings: { goal: 1 } }, null);
	// another save lands between this one's read and its write
	const racing: CampaignDrafts = {
		...store,
		get: async (k) => {
			const read = await store.get(k);
			await store.put(
				{ ...key, ...empty, settings: { goal: 2 } },
				read?.revision ?? null,
			);
			return read;
		},
	};

	const outcome = saveLiveCampaignEdit(deps(racing), "cmp_1", {
		part: "settings",
		settings: { end_date: "2031-04-02" },
	});

	await expect(outcome).rejects.toThrow(ToolRefusal);
	await expect(outcome).rejects.toMatchObject({ text: DRAFT_MOVED });
	expect((await store.get(key))?.settings).toEqual({ goal: 2 });
});
