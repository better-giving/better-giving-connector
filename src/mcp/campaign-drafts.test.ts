import { expect, test, vi } from "vitest";
import { memoryDrafts } from "../../test/memory-drafts";
import type { CampaignDraftKey, CampaignDrafts } from "../db";
import { DeploymentRejected } from "../deployment";
import {
	DRAFT_MOVED,
	mergeDraft,
	publishLiveCampaignDraft,
	saveLiveCampaignEdit,
} from "./campaign-drafts";
import { type LocalCall, ToolRefusal } from "./spec";
import { editorData } from "./widget-data";
import { WIDGET_TOOLS } from "./widget-tools";

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

const deps = (
	drafts: CampaignDrafts,
	campaign: Record<string, unknown> = {
		id: "cmp_1",
		status: "published",
		version: "7",
	},
) =>
	({
		connection: { userId: "u1", origin: "https://hopeshelter.org" },
		client: { call: async () => ({ body: campaign }) },
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

test("a version the site gives as a number is no version to the editor and to the draft alike, so the editor's save is kept", async () => {
	const live = { id: "cmp_1", status: "published", version: 3 };
	const store = memoryDrafts();
	const call = {
		...deps(store, live),
		connection: {
			userId: "u1",
			origin: "https://hopeshelter.org",
			platform: true,
			actions: null,
		},
		input: {},
	} as unknown as LocalCall;
	const save = WIDGET_TOOLS.find((s) => s.tool === "app_save_campaign_edit");

	const editor = await editorData(call, "cmp_1");
	const saved = await save?.run({
		...call,
		input: {
			id: "cmp_1",
			expectedVersion: editor.campaign.version,
			page: { pageKind: "blocks", blocks: [] },
		},
	});

	expect(editor.campaign.version).toBeNull();
	expect(saved?.structured).toMatchObject({ pendingDraft: true });
	expect((await store.get(KEY))?.baseVersion).toBeNull();
});

const KEY = {
	userId: "u1",
	origin: "https://hopeshelter.org" as CampaignDraftKey["origin"],
	campaignId: "cmp_1",
};

/** A live campaign at version 7 whose every write moves the version; `failPage` refuses the page write. */
function site(options: { failPage?: boolean } = {}) {
	let version = 7;
	const sent: { action: string; input: Record<string, unknown> }[] = [];
	return {
		sent,
		client: {
			call: async (
				_connection: unknown,
				action: string,
				input: Record<string, unknown>,
			) => {
				sent.push({ action, input });
				if (options.failPage && action === "campaigns.update_blocks")
					throw new DeploymentRejected(422, { detail: "Too long." });
				version += 1;
				return {
					body: { id: "cmp_1", status: "published", version: String(version) },
				};
			},
		},
	};
}

const publishDeps = (
	drafts: CampaignDrafts,
	client: ReturnType<typeof site>["client"],
) =>
	({
		connection: { userId: "u1", origin: "https://hopeshelter.org" },
		client,
		drafts,
	}) as unknown as Parameters<typeof publishLiveCampaignDraft>[0];

const LIVE = { id: "cmp_1", status: "published", version: "7" };

/** A draft of the goal and the story, on version 7. */
async function drafted(store: CampaignDrafts) {
	await store.put(
		{
			...KEY,
			baseVersion: "7",
			settings: { goal: 1 },
			page: [{ type: "story", text: "One." }],
			pageKind: "blocks",
		},
		null,
	);
}

/** `store`, with `during` run once just before the publish's first store write after its read. */
function racing(
	store: CampaignDrafts,
	during: () => Promise<void>,
): CampaignDrafts {
	let raced = false;
	const race = async () => {
		if (raced) return;
		raced = true;
		await during();
	};
	return {
		...store,
		put: async (
			d: Parameters<CampaignDrafts["put"]>[0],
			read?: number | null,
		) => {
			await race();
			return store.put(d, read as number | null);
		},
		delete: async (k, read) => {
			await race();
			return store.delete(k, read);
		},
	};
}

test("a save that lands while a publish sends the draft is kept, moved onto the version that went live, and reported pending", async () => {
	const store = memoryDrafts();
	await drafted(store);
	const later = racing(store, async () => {
		const read = await store.get(KEY);
		await store.put(
			{
				...KEY,
				baseVersion: "7",
				settings: { goal: 2 },
				page: null,
				pageKind: null,
			},
			read?.revision ?? null,
		);
	});
	const { client } = site();

	const published = await publishLiveCampaignDraft(
		publishDeps(later, client),
		LIVE,
	);

	expect(published).toMatchObject({
		applied: ["settings", "page"],
		pending: ["settings"],
		failure:
			"An edit saved while this was publishing is kept as a draft; publish again to send it.",
	});
	expect(await store.get(KEY)).toMatchObject({
		settings: { goal: 2 },
		baseVersion: "9",
	});
});

test("a save that lands while a failed page write is kept moves onto the version the settings went live at", async () => {
	const store = memoryDrafts();
	await drafted(store);
	const later = racing(store, async () => {
		const read = await store.get(KEY);
		await store.put(
			{
				...KEY,
				baseVersion: "7",
				settings: { goal: 1 },
				page: [{ type: "story", text: "Two." }],
				pageKind: "blocks",
			},
			read?.revision ?? null,
		);
	});
	const { client } = site({ failPage: true });

	const published = await publishLiveCampaignDraft(
		publishDeps(later, client),
		LIVE,
	);

	expect(published).toMatchObject({
		applied: ["settings"],
		pending: ["settings", "page"],
	});
	expect(await store.get(KEY)).toMatchObject({
		page: [{ type: "story", text: "Two." }],
		baseVersion: "8",
	});
});

test("a store that fails after the site took the draft answers what went live, with the draft reported pending", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	const store = memoryDrafts();
	await drafted(store);
	const broken: CampaignDrafts = {
		...store,
		delete: async () => {
			throw new Error("database is locked");
		},
	};
	const { client } = site();

	const published = await publishLiveCampaignDraft(
		publishDeps(broken, client),
		LIVE,
	);

	expect(published).toMatchObject({
		applied: ["settings", "page"],
		pending: ["settings", "page"],
		failure:
			"These edits went live, but the connector couldn't clear its draft of them, so they may still show as pending.",
	});
	vi.restoreAllMocks();
});

test("a draft deleted and stored again refuses the revision read from the deleted one", async () => {
	const store = memoryDrafts();
	const write = {
		...KEY,
		baseVersion: "7",
		settings: { goal: 1 },
		page: null,
		pageKind: null,
	};
	await store.put(write, null);
	const read = (await store.get(KEY))?.revision as number;
	await store.delete(KEY);
	await store.put(write, null);

	expect(await store.put(write, read)).toBe(false);
	expect(await store.delete(KEY, read)).toBe(false);
	expect(await store.get(KEY)).not.toBeNull();
});
