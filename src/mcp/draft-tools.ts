import {
	type DraftEdit,
	type DraftPart,
	isLive,
	pendingDraft,
	publishLiveCampaignDraft,
	readCampaign,
	saveLiveCampaignEdit,
} from "./campaign-drafts";
import type { LocalAnswer, LocalCall } from "./spec";

// How Platform's campaign tools word the connector's drafts of a live
// campaign; the drafts themselves are src/mcp/campaign-drafts.ts.

const fromSite = (org: string) => `From ${org}'s Better Giving site:`;

type EditOf = (input: Record<string, unknown>) => DraftEdit;

const without = (input: Record<string, unknown>, ...keys: string[]) =>
	Object.fromEntries(Object.entries(input).filter(([k]) => !keys.includes(k)));

export const SETTINGS_EDIT: EditOf = (input) => ({
	part: "settings",
	settings: without(input, "id", "expected_version"),
});
export const BLOCKS_EDIT: EditOf = (input) => ({
	part: "page",
	kind: "blocks",
	page: Array.isArray(input.blocks) ? input.blocks : [],
});
export const CONTENT_EDIT: EditOf = (input) => ({
	part: "page",
	kind: "content",
	page: without(input, "id", "expected_version"),
});

/** An edit to a live campaign is kept as its draft; to any other campaign it is sent as usual (null). */
export const composeLiveEdit =
	(
		editOf: EditOf,
		options?: { rebase?: boolean; draftRevision?: number | null },
	) =>
	async (call: LocalCall): Promise<LocalAnswer | null> => {
		const { input } = call;
		const saved = await saveLiveCampaignEdit(
			call,
			String(input.id),
			editOf(input),
			typeof input.expected_version === "string"
				? input.expected_version
				: undefined,
			options,
		);
		if (saved === null) return null;
		return {
			text: `This campaign is live, so the change was saved as a draft and donors don't see it yet. It goes live when the campaign is published again with publish_campaign, after the operator says yes; get_campaign shows it under pendingDraft, and discard_campaign_draft drops it.\n${JSON.stringify(saved)}`,
			structured: saved,
		};
	};

/** The campaign as the site has it, with the connector's draft of it beside it under pendingDraft. */
export async function composeGetCampaign(
	call: LocalCall,
): Promise<LocalAnswer> {
	const id = String(call.input.id);
	const campaign = await readCampaign(call, id);
	const pending = await pendingDraft(call, id);
	const structured = pending
		? { ...campaign, pendingDraft: pending }
		: campaign;
	const lines = [fromSite(call.connection.orgName)];
	if (pending) {
		lines.push(
			isLive(campaign)
				? "This live campaign has draft edits donors don't see yet, under pendingDraft; publish_campaign sends them once the operator says yes."
				: "This campaign has ended, so its draft edits can no longer be published; discard_campaign_draft drops them.",
		);
	}
	lines.push(JSON.stringify(structured));
	return { text: lines.join("\n"), structured };
}

const parts = (list: DraftPart[]) => list.join(" and ");

/**
 * Publishing a live campaign sends its draft and never publishes it again;
 * any other campaign is published as usual (null).
 */
export async function composePublish(
	call: LocalCall,
): Promise<LocalAnswer | null> {
	const campaign = await readCampaign(call, String(call.input.id));
	if (!isLive(campaign)) return null;
	const published = await publishLiveCampaignDraft(call, campaign);
	const { applied, pending } = published;
	const title =
		typeof published.campaign.title === "string"
			? published.campaign.title
			: "This campaign";
	const lines: string[] = [];
	if (applied.length === 0) {
		lines.push(
			`${title} is already live, with no draft edits pending, so nothing changed.`,
		);
	} else if (pending.length === 0) {
		lines.push(
			`${title} is live, and its draft ${parts(applied)} edits are now live too: donors see them.`,
		);
	} else {
		lines.push(
			`${title}'s draft ${parts(applied)} edits are live now, but its ${parts(pending)} edits are still a draft: ${published.failure ?? ""} Read the campaign with get_campaign, fix the draft, and publish again, or drop it with discard_campaign_draft.`,
		);
	}
	if (call.input.gifts_go_to !== undefined) {
		lines.push(
			"Where its gifts go was left as it is: that is set at a campaign's first publish, and the operator changes it in the Better Giving dashboard.",
		);
	}
	const structured = {
		...published.campaign,
		draft: { applied, pending },
	};
	lines.push(JSON.stringify(structured));
	return { text: lines.join("\n"), structured };
}
