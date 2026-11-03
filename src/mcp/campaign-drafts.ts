import type { CampaignDraft, CampaignDraftKey, CampaignDrafts } from "../db";
import { DeploymentRejected } from "../deployment";
import { log } from "../log";
import {
	type DeploymentDeps,
	failureDetail,
	isStepFailure,
	versionOf,
} from "./campaign-presets";
import { ToolRefusal } from "./spec";

// A live Platform campaign takes an edit to its page or settings at once, in
// front of donors. So the connector keeps such an edit here, per connection
// and campaign, and sends it only when the campaign is published again.

export type DraftDeps = DeploymentDeps & { drafts: CampaignDrafts };

export type DraftPart = "settings" | "page";

/** One edit as the tools take it: settings fields, or a page of blocks or content. */
export type DraftEdit =
	| { part: "settings"; settings: Record<string, unknown> }
	| { part: "page"; kind: "blocks"; page: unknown[] }
	| { part: "page"; kind: "content"; page: Record<string, unknown> };

/** What an edit to a live campaign answers: kept, not sent. */
export type SavedDraft = {
	saved: "draft";
	campaign_id: string;
	base_version: string | null;
};

/** A campaign's draft as get_campaign shows it, beside the live campaign. */
export type PendingDraft = {
	settings: Record<string, unknown> | null;
	page: unknown | null;
	page_kind: "blocks" | "content" | null;
	base_version: string | null;
	/** ISO timestamp of the last edit. */
	updated_at: string;
	/** Moves on every save; a discard names the one it read. */
	revision: number;
};

/** What publishing a live campaign's draft did: the parts that went live, and those still kept. */
export type DraftPublished = {
	campaign: Record<string, unknown>;
	applied: DraftPart[];
	pending: DraftPart[];
	/** Why a part is still pending. */
	failure?: string;
};

type Body = Record<string, unknown>;
const isBody = (value: unknown): value is Body =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const keyOf = (
	{ connection }: Pick<DraftDeps, "connection">,
	campaignId: string,
): CampaignDraftKey => ({
	userId: connection.userId,
	origin: connection.origin,
	campaignId,
});

/** Published and not ended: what donors see now. */
export const isLive = (campaign: Body) => campaign.status === "published";

export async function readCampaign(
	{ connection, client }: DeploymentDeps,
	id: string,
): Promise<Body> {
	const { body } = await client.call(connection, "campaigns.get", { id });
	return isBody(body) ? body : {};
}

export const DRAFT_MOVED =
	"Nothing was saved: this campaign's draft changed while the edit was being made. Read it again with get_campaign and re-make the edit.";
const DRAFT_MOVED_CARD =
	"Nothing was saved: this campaign's draft edits changed elsewhere while you were editing. Close the editor and open it again to see them, then make the change again.";
export const STALE_DRAFT =
	"Nothing was published: this campaign changed on the site after its draft edits were started, and publishing them would overwrite that change. Read it with get_campaign, which shows the campaign as it is now and the draft under pendingDraft, and tell the operator what changed. To keep the draft, re-make its edit with the version get_campaign returns as expected_version, which moves the draft onto that version, then publish again; or drop it with discard_campaign_draft.";
const STALE_DRAFT_CARD =
	"Nothing was published: this campaign was changed on the site after these draft edits were saved, and publishing them would overwrite that change. Discard the draft edits, then make them again on the campaign as it is now.";
const STALE_BASE =
	"Nothing was saved: this campaign was changed on the site after its draft edits were started, and saving onto them would overwrite that change when they're published. Discard the draft edits to start again from the campaign as it is now.";
const STALE_READ =
	"Nothing was saved: this campaign changed after it was read. Read it again with get_campaign, make the change against what it shows now, and send the version it returns as expected_version.";
const STALE_READ_CARD =
	"Nothing was saved: this campaign changed on the site after the editor opened it. Close the editor and open it again to see it as it is now, then make the change again.";

/**
 * The draft after `edit`: settings merge key by key, the later value winning;
 * a blocks page replaces the page whole; a content page merges key by key
 * into a stored content page and replaces a page of the other kind.
 */
export function mergeDraft(
	stored: Pick<CampaignDraft, "settings" | "page" | "pageKind"> | null,
	edit: DraftEdit,
): Pick<CampaignDraft, "settings" | "page" | "pageKind"> {
	const settings = isBody(stored?.settings) ? stored.settings : null;
	const page = stored?.page ?? null;
	const pageKind = stored?.pageKind ?? null;
	if (edit.part === "settings") {
		return {
			settings: { ...settings, ...edit.settings },
			page,
			pageKind,
		};
	}
	if (edit.kind === "content" && pageKind === "content" && isBody(page)) {
		return { settings, page: { ...page, ...edit.page }, pageKind };
	}
	return { settings, page: edit.page, pageKind: edit.kind };
}

/**
 * Keeps `edit` as the campaign's draft when the campaign is live, and answers
 * what was kept; null when it isn't live, for the edit to be sent as usual.
 * The first edit records the version it was read at; a later one keeps it,
 * unless it names the campaign's own version as `expectedVersion`: made
 * against the campaign as it is now, it moves the whole draft onto that
 * version. Any other `expectedVersion` is refused as stale. With `rebase`
 * false, a draft the campaign has moved past is refused instead of moved: the
 * editor card shows the draft, never the site's change it would overwrite.
 * Given `draftRevision`, the edit lands only on the draft at that revision,
 * or where there is none when it is null; omitted, on whichever is stored.
 */
export async function saveLiveCampaignEdit(
	deps: DraftDeps,
	campaignId: string,
	edit: DraftEdit,
	expectedVersion?: string,
	{
		rebase = true,
		draftRevision,
	}: { rebase?: boolean; draftRevision?: number | null } = {},
): Promise<SavedDraft | null> {
	const campaign = await readCampaign(deps, campaignId);
	if (!isLive(campaign)) return null;
	const current = versionOf(campaign) ?? null;
	if (expectedVersion !== undefined && expectedVersion !== current) {
		throw new ToolRefusal("rejected", STALE_READ, STALE_READ_CARD);
	}
	const key = keyOf(deps, campaignId);
	const stored = await deps.drafts.get(key);
	const read = stored?.revision ?? null;
	if (draftRevision !== undefined && draftRevision !== read) {
		throw new ToolRefusal("rejected", DRAFT_MOVED, DRAFT_MOVED_CARD);
	}
	if (!rebase && stored && stored.baseVersion !== current) {
		throw new ToolRefusal("rejected", STALE_BASE);
	}
	const baseVersion =
		stored && expectedVersion === undefined ? stored.baseVersion : current;
	const kept = await deps.drafts.put(
		{ ...key, baseVersion, ...mergeDraft(stored, edit) },
		read,
	);
	if (!kept) throw new ToolRefusal("rejected", DRAFT_MOVED, DRAFT_MOVED_CARD);
	return { saved: "draft", campaign_id: campaignId, base_version: baseVersion };
}

export async function pendingDraft(
	deps: Pick<DraftDeps, "connection" | "drafts">,
	campaignId: string,
): Promise<PendingDraft | null> {
	const draft = await deps.drafts.get(keyOf(deps, campaignId));
	if (!draft) return null;
	return {
		settings: isBody(draft.settings) ? draft.settings : null,
		page: draft.page,
		page_kind: draft.pageKind,
		base_version: draft.baseVersion,
		updated_at: draft.updatedAt.toISOString(),
		revision: draft.revision,
	};
}

/**
 * Drops the campaign's draft while it is still the one at `revision`:
 * "moved" when a save has replaced it since, or one exists where `revision`
 * is null (none was read); "none" when there is no draft.
 */
export async function discardCampaignDraft(
	deps: Pick<DraftDeps, "connection" | "drafts">,
	campaignId: string,
	revision: number | null,
): Promise<"discarded" | "moved" | "none"> {
	const key = keyOf(deps, campaignId);
	if (revision !== null && (await deps.drafts.delete(key, revision)))
		return "discarded";
	return (await deps.drafts.get(key)) ? "moved" : "none";
}

const isStale = (error: unknown) =>
	error instanceof DeploymentRejected &&
	error.status === 409 &&
	error.problem?.code === "stale_read";

/**
 * Sends a live campaign's draft: its settings, then its page. The first write
 * is checked against the version the draft started from; the second carries
 * the version the first returned, since each write moves it. Never publishes:
 * the campaign is live already. A stale first write keeps the whole draft and
 * throws a refusal; any other failure of it throws as the action's would. A
 * second write that fails leaves the first applied and the rest kept, on the
 * version the first returned. Everything applied, the draft is deleted.
 */
export async function publishLiveCampaignDraft(
	deps: DraftDeps,
	campaign: Body,
): Promise<DraftPublished> {
	const id = String(campaign.id);
	const key = keyOf(deps, id);
	const draft = await deps.drafts.get(key);
	if (!draft) return { campaign, applied: [], pending: [] };

	const writes: {
		part: DraftPart;
		send: (version: string | null) => Promise<Body>;
	}[] = [];
	const settings = isBody(draft.settings) ? draft.settings : null;
	if (settings) {
		writes.push({
			part: "settings",
			send: (version) =>
				write(deps, "campaigns.update_settings", { id, ...settings }, version),
		});
	}
	if (draft.page !== null && draft.pageKind !== null) {
		const page = draft.page;
		writes.push({
			part: "page",
			send: (version) =>
				draft.pageKind === "blocks"
					? write(
							deps,
							"campaigns.update_blocks",
							{ id, blocks: withDraftGoal(page, settings) },
							version,
						)
					: write(
							deps,
							"campaigns.update_content",
							{ id, ...(isBody(page) ? page : {}) },
							version,
						),
		});
	}

	const [first, second] = writes;
	if (!first) {
		return {
			campaign,
			applied: [],
			...(await settle(deps, draft, null, null)),
		};
	}
	let landed: Body;
	try {
		landed = await first.send(draft.baseVersion);
	} catch (error) {
		if (isStale(error))
			throw new ToolRefusal("rejected", STALE_DRAFT, STALE_DRAFT_CARD);
		throw error;
	}
	const version = versionOf(landed) ?? null;
	if (!second) {
		const settled = await settle(deps, draft, version, null);
		return { campaign: landed, applied: [first.part], ...settled };
	}
	try {
		landed = await second.send(version);
	} catch (error) {
		const kept = { settings: null, page: draft.page, pageKind: draft.pageKind };
		const settled = await settle(deps, draft, version, kept);
		if (!isStepFailure(error)) throw error;
		return {
			campaign: landed,
			applied: [first.part],
			pending: settled.pending,
			failure: settled.failure ?? failureDetail(error),
		};
	}
	const settled = await settle(deps, draft, versionOf(landed) ?? null, null);
	return {
		campaign: landed,
		applied: [first.part, second.part],
		...settled,
	};
}

const SAVED_DURING_PUBLISH =
	"An edit saved while this was publishing is kept as a draft; publish again to send it.";
const NOT_CLEARED =
	"These edits went live, but the connector couldn't clear its draft of them, so they may still show as pending.";

const partsOf = (d: Pick<CampaignDraft, "settings" | "page">): DraftPart[] => [
	...(isBody(d.settings) ? (["settings"] as const) : []),
	...(d.page !== null ? (["page"] as const) : []),
];

/**
 * Leaves the store as the publish left the campaign: `kept`, the parts still
 * to go live, on `version`, or no draft. A draft saved since `read` holds
 * what just went live plus its own edit, so it stays, moved onto `version`,
 * and is answered pending.
 */
async function settle(
	deps: DraftDeps,
	read: CampaignDraft,
	version: string | null,
	kept: Pick<CampaignDraft, "settings" | "page" | "pageKind"> | null,
): Promise<{ pending: DraftPart[]; failure?: string }> {
	const key = keyOf(deps, read.campaignId);
	try {
		const done = kept
			? await deps.drafts.put(
					{ ...key, baseVersion: version, ...kept },
					read.revision,
				)
			: await deps.drafts.delete(key, read.revision);
		if (done) return { pending: kept ? partsOf(kept) : [] };
		const newer = await deps.drafts.get(key);
		if (!newer) return { pending: [] };
		const { updatedAt: _, revision, ...rest } = newer;
		await deps.drafts.put({ ...rest, baseVersion: version }, revision);
		return { pending: partsOf(newer), failure: SAVED_DURING_PUBLISH };
	} catch (error) {
		const errorName = error instanceof Error ? error.name : "unknown";
		log({ kind: "error", where: "mcp", errorName });
		return { pending: partsOf(kept ?? read), failure: NOT_CLEARED };
	}
}

async function write(
	{ connection, client }: DeploymentDeps,
	action:
		| "campaigns.update_settings"
		| "campaigns.update_blocks"
		| "campaigns.update_content",
	input: Body,
	version: string | null,
): Promise<Body> {
	const { body } = await client.call(connection, action, {
		...input,
		...(version === null ? {} : { expected_version: version }),
	});
	return isBody(body) ? body : {};
}

// Platform's page repeats the goal in its goal bar, read when the page was
// edited; the draft's settings hold the goal meant to go live with it, so the
// page write doesn't put the old one back.
function withDraftGoal(page: unknown, settings: Body | null): unknown {
	if (!Array.isArray(page) || !settings || !Object.hasOwn(settings, "goal"))
		return page;
	return page.map((block) =>
		isBody(block) && block.type === "goal-bar"
			? { ...block, goal: settings.goal }
			: block,
	);
}
