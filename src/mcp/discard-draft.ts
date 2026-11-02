import { z } from "zod";
import { DESTRUCTIVE } from "./actions";
import { discardCampaignDraft } from "./campaign-drafts";
import { type LocalSpec, statusLines, ToolRefusal } from "./spec";

const discarded = z.strictObject({ discarded: z.boolean() });

const DISCARD_MOVED =
	"Nothing was dropped: this campaign's draft changed since it was read. Read it again with get_campaign, tell the operator what it holds now, and discard it with the revision get_campaign returns only if they still want to.";

export const DISCARD_CAMPAIGN_DRAFT: LocalSpec = {
	tool: "discard_campaign_draft",
	title: "Discard a campaign's draft edits",
	description:
		"Drops the edits saved as a draft of a live campaign, so they never go live; the live campaign stays as donors see it. The dropped edits can't be brought back, so check with the operator first. get_campaign shows the draft under pendingDraft; send its revision, and a draft saved since is kept.",
	input: z.strictObject({
		id: z.string().min(1),
		revision: z
			.int()
			.describe("pendingDraft.revision, as get_campaign last showed it."),
	}),
	output: { schema: discarded },
	annotations: DESTRUCTIVE,
	_meta: statusLines("Discarding draft edits…", "Draft edits discarded"),
	needs: [],
	platformOnly: true,
	// The connector's own store alone: the deployment never held the draft.
	async run(call) {
		const outcome = await discardCampaignDraft(
			call,
			String(call.input.id),
			z.int().parse(call.input.revision),
		);
		if (outcome === "moved") throw new ToolRefusal("rejected", DISCARD_MOVED);
		const structured = discarded.parse({
			discarded: outcome === "discarded",
		});
		const lead = structured.discarded
			? "Dropped the draft edits of this campaign: they will never go live, and the live campaign is as it was."
			: "This campaign had no draft edits, so nothing was dropped.";
		return { text: `${lead}\n${JSON.stringify(structured)}`, structured };
	},
};
