import type { CampaignDraft, CampaignDraftKey, CampaignDrafts } from "../db";
import { DeploymentRejected } from "../deployment";
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
};

/** What publishing a live campaign's draft did: the parts that went live, and those still kept. */
export type DraftPublished = {
	campaign: Record<string, unknown>;
	applied: DraftPart[];
	pending: DraftPart[];
	/** Why the pending part didn't go live, when one was tried. */
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

export const STALE_DRAFT =
	"This campaign changed since the draft was started. Read it again with get_campaign and re-make the edit.";
const STALE_READ =
	"Nothing was saved: this campaign changed after it was read. Read it again with get_campaign, make the change against what it shows now, and send the version it returns as expected_version.";

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
 * The first edit records the version it was read at; a later one keeps it. An
 * `expectedVersion` other than the campaign's own is refused as stale.
 */
export async function saveLiveCampaignEdit(
	deps: DraftDeps,
	campaignId: string,
	edit: DraftEdit,
	expectedVersion?: string,
): Promise<SavedDraft | null> {
	const campaign = await readCampaign(deps, campaignId);
	if (!isLive(campaign)) return null;
	const current = versionOf(campaign) ?? null;
	if (expectedVersion !== undefined && expectedVersion !== current) {
		throw new ToolRefusal("rejected", STALE_READ);
	}
	const key = keyOf(deps, campaignId);
	const stored = await deps.drafts.get(key);
	const baseVersion = stored ? stored.baseVersion : current;
	await deps.drafts.put({
		...key,
		baseVersion,
		...mergeDraft(stored, edit),
	});
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
	};
}

/** Whether the campaign had a draft to discard. */
export const discardCampaignDraft = (
	deps: Pick<DraftDeps, "connection" | "drafts">,
	campaignId: string,
): Promise<boolean> => deps.drafts.delete(keyOf(deps, campaignId));

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
		await deps.drafts.delete(key);
		return { campaign, applied: [], pending: [] };
	}
	let landed: Body;
	try {
		landed = await first.send(draft.baseVersion);
	} catch (error) {
		if (isStale(error)) throw new ToolRefusal("rejected", STALE_DRAFT);
		throw error;
	}
	if (!second) {
		await deps.drafts.delete(key);
		return { campaign: landed, applied: [first.part], pending: [] };
	}
	const version = versionOf(landed) ?? null;
	try {
		landed = await second.send(version);
	} catch (error) {
		await deps.drafts.put({
			...key,
			baseVersion: version,
			settings: null,
			page: draft.page,
			pageKind: draft.pageKind,
		});
		if (!isStepFailure(error)) throw error;
		return {
			campaign: landed,
			applied: [first.part],
			pending: [second.part],
			failure: failureDetail(error),
		};
	}
	await deps.drafts.delete(key);
	return { campaign: landed, applied: [first.part, second.part], pending: [] };
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
