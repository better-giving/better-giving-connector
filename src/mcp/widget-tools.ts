import { z } from "zod";
import { formatDate, formatMoney } from "../format";
import { THEME_NAMES } from "../presets/themes";
import { WIDGETS } from "../widgets/html";
import {
	APP_TOOLS,
	CampaignCreateData,
	CampaignEditorData,
	CampaignResultsData,
	CampaignsData,
	CreateResult,
	PhotoData,
	RENDER_TOOLS,
	type WidgetName,
} from "../widgets/model";
import { ADD, DESTRUCTIVE, OVERWRITES, READ } from "./actions";
import {
	type DraftPublished,
	discardCampaignDraft,
	isLive,
	pendingDraft,
	publishLiveCampaignDraft,
	readCampaign,
} from "./campaign-drafts";
import { createCampaignWithPreset } from "./campaign-presets";
import { BLOCKS_EDIT, CONTENT_EDIT, composeLiveEdit } from "./draft-tools";
import { setCampaignPhoto, uploadLink } from "./photo-upload";
import type { LocalCall, LocalSpec, ToolMeta } from "./spec";
import { statusLines, ToolRefusal } from "./spec";
import {
	campaignsData,
	createData,
	editorData,
	photoData,
	resultsData,
} from "./widget-data";

// The render tools that show each widget, and the app-only tools its buttons
// call. A widget is an MCP Apps resource the render tool links to; a button
// press is a tool call the model never sees (`visibility: ["app"]`), so no
// elicitation is involved. Of the buttons that change what donors see, only
// End asks the operator to confirm in the card; Publish runs on its press.

const widgetUri = (name: WidgetName) => WIDGETS[name].uri;

const renderMeta = (
	name: WidgetName,
	invoking: string,
	invoked: string,
): ToolMeta => ({
	...statusLines(invoking, invoked),
	ui: { resourceUri: widgetUri(name), visibility: ["model", "app"] },
	"openai/outputTemplate": widgetUri(name),
});

const appMeta = (invoking: string, invoked: string): ToolMeta => ({
	...statusLines(invoking, invoked),
	ui: { visibility: ["app"] },
	"openai/widgetAccessible": true,
});

// A host that ignores `_meta.ui` lists an app-only tool to its model as any
// other; the description is then what keeps the model from pressing it.
const CARD_ONLY =
	"Only the card calls this tool, when the operator presses its button; never call it from the chat.";

const answer = (structured: Record<string, unknown>) => ({
	text: JSON.stringify(structured),
	structured,
});

const id = z.string().min(1);
// ChatGPT's file param: its submission check wants all four fields declared,
// only the first two required.
const photoFile = z.strictObject({
	download_url: z.url({ protocol: /^https$/ }),
	file_id: z.string().min(1),
	mime_type: z.string().optional(),
	file_name: z.string().optional(),
});
const PHOTO_PARAM = ["photo"];

const money = (m: { amount: string; currency: string }, locale: string) =>
	formatMoney(m.amount, m.currency, locale);

// --- render tools -----------------------------------------------------------

const SHOW_CAMPAIGN_CREATE: LocalSpec = {
	tool: RENDER_TOOLS["campaign-create"].tool,
	title: "Show the campaign presets",
	description:
		"Shows the operator a card to start a campaign from a preset (emergency, year-end, capital or giving day), with values recommended from their past campaigns. Use it when they want a new campaign and haven't named the details. The card creates the draft itself.",
	input: z.strictObject({
		theme: z
			.enum(THEME_NAMES)
			.optional()
			.describe("The preset to select first."),
	}),
	output: {
		schema: CampaignCreateData,
		summary: (body, { locale }) => {
			const data = body as CampaignCreateData;
			return `${data.presets.length} campaign presets, ${data.selected.replace("_", "-")} selected, goal ${money(
				data.presets.find((p) => p.theme === data.selected)?.goal ?? {
					amount: "0",
					currency: "USD",
				},
				locale,
			)}`;
		},
	},
	annotations: READ,
	_meta: renderMeta(
		"campaign-create",
		"Preparing campaign presets…",
		"Campaign presets ready",
	),
	needs: ["campaigns.list", "results.summary", "donations.list"],
	async run(call) {
		const theme = z.enum(THEME_NAMES).optional().parse(call.input.theme);
		return answer(await createData(call, theme));
	},
};

const SHOW_CAMPAIGNS: LocalSpec = {
	tool: RENDER_TOOLS.campaigns.tool,
	title: "Show campaigns",
	description:
		"Shows the operator their campaigns as cards with status and progress toward each goal (up to eight). Use it to browse campaigns; the cards open each campaign's results or editor.",
	input: z.strictObject({
		status: z.enum(["draft", "published", "ended"]).optional(),
	}),
	output: {
		schema: CampaignsData,
		summary: (body, { locale }) => {
			const { campaigns } = body as CampaignsData;
			if (campaigns.length === 0) return "No campaigns";
			const live = campaigns.filter((k) => k.status === "published").length;
			const cents = new Map<string, number>();
			for (const { raised } of campaigns) {
				const sum = cents.get(raised.currency) ?? 0;
				cents.set(
					raised.currency,
					sum + Math.round(Number(raised.amount) * 100),
				);
			}
			const total = new Intl.ListFormat(locale).format(
				[...cents].map(([currency, sum]) =>
					money({ amount: (sum / 100).toFixed(2), currency }, locale),
				),
			);
			return `${campaigns.length} campaigns, ${live} live, ${total} raised`;
		},
	},
	annotations: READ,
	_meta: renderMeta("campaigns", "Loading campaigns…", "Campaigns ready"),
	needs: ["campaigns.list", "campaigns.get", "results.summary"],
	async run(call) {
		const status = z
			.enum(["draft", "published", "ended"])
			.optional()
			.parse(call.input.status);
		return answer(await campaignsData(call, status));
	},
};

const resultsSummary = (body: Record<string, unknown>, locale: string) => {
	const data = body as CampaignResultsData;
	const raised = money(data.raised, locale);
	return data.campaign.goal
		? `${data.campaign.title}: ${raised} of ${money(data.campaign.goal, locale)} from ${data.donors} donors`
		: `${data.campaign.title}: ${raised} from ${data.donors} donors`;
};

const SHOW_CAMPAIGN_RESULTS: LocalSpec = {
	tool: RENDER_TOOLS["campaign-results"].tool,
	title: "Show a campaign's results",
	description:
		"Shows the operator one campaign's results card: raised against its goal, donors, average and median gift, and the last seven days against the seven before; a draft shows what is left before it can be published. The card has the Publish and End buttons; End asks the operator to confirm in the card, Publish doesn't.",
	input: z.strictObject({ id }),
	output: {
		schema: CampaignResultsData,
		summary: (body, { locale }) => resultsSummary(body, locale),
	},
	annotations: READ,
	_meta: renderMeta(
		"campaign-results",
		"Loading campaign results…",
		"Campaign results ready",
	),
	needs: ["campaigns.get", "results.summary", "donations.list"],
	async run(call) {
		return answer(await resultsData(call, String(call.input.id)));
	},
};

const editorSummary = (body: Record<string, unknown>) => {
	const data = body as CampaignEditorData;
	return `${data.campaign.title}: editor open${data.pendingDraft ? ", draft edits pending" : ""}`;
};

const OPEN_CAMPAIGN_EDITOR: LocalSpec = {
	tool: RENDER_TOOLS["campaign-editor"].tool,
	title: "Open a campaign's editor",
	description:
		"Opens the fullscreen editor for a campaign's page, with a live preview of the donation page. Edits to a live campaign are saved as a draft until it is published again.",
	standaloneDescription:
		"Opens the fullscreen editor for a campaign's page, with a live preview of the donation page. Its saves go to the site at once: donors see a live campaign's edits as soon as they're saved.",
	input: z.strictObject({ id }),
	output: { schema: CampaignEditorData, summary: editorSummary },
	annotations: READ,
	_meta: renderMeta(
		"campaign-editor",
		"Opening the campaign editor…",
		"Campaign editor ready",
	),
	needs: ["campaigns.get"],
	async run(call) {
		return answer(await editorData(call, String(call.input.id)));
	},
};

const SHOW_PHOTO: LocalSpec = {
	tool: RENDER_TOOLS.photo.tool,
	title: "Show a campaign's photo",
	description:
		"Shows a campaign's cover photo and, when the operator dropped a photo into the chat, a card to set it as the cover.",
	input: z.strictObject({
		campaign_id: id,
		photo: photoFile.optional(),
	}),
	output: {
		schema: PhotoData,
		summary: (body) => {
			const data = body as PhotoData;
			return data.file
				? `Photo ready for ${data.campaign.title}`
				: `${data.campaign.title}: ${data.current ? "cover photo shown" : "no cover photo yet"}`;
		},
	},
	annotations: READ,
	_meta: {
		...renderMeta("photo", "Preparing the photo…", "Photo ready"),
		"openai/fileParams": PHOTO_PARAM,
	},
	needs: ["campaigns.get"],
	async run(call) {
		const given = photoFile.optional().parse(call.input.photo);
		const file = given
			? {
					name: given.file_name ?? "Photo",
					size: 0,
					type: given.mime_type ?? "image/*",
					previewUrl: null,
					downloadUrl: given.download_url,
				}
			: null;
		return answer(await photoData(call, String(call.input.campaign_id), file));
	},
};

// --- the model's photo tool ---------------------------------------------------

const photoOutcome = z.strictObject({
	uploaded: z.boolean(),
	imageUrl: z.string().nullable(),
	/** The link the operator opens to upload the photo themselves, when it couldn't be done here. */
	uploadLink: z.string().nullable(),
	expiresAt: z.string().nullable(),
	reason: z.string().nullable(),
});

async function setPhotoAnswer(
	call: LocalCall,
	campaignId: string,
	downloadUrl: string,
) {
	const outcome = await setCampaignPhoto(call, campaignId, downloadUrl);
	const structured = photoOutcome.parse(
		outcome.uploaded
			? {
					uploaded: true,
					imageUrl: outcome.imageUrl,
					uploadLink: null,
					expiresAt: null,
					reason: null,
				}
			: {
					uploaded: false,
					imageUrl: null,
					uploadLink: outcome.link?.url ?? null,
					expiresAt: outcome.link?.expiresAt ?? null,
					reason: outcome.reason,
				},
	);
	const lead = outcome.uploaded
		? "The photo is now the campaign's cover."
		: `The photo wasn't set: ${outcome.reason}${outcome.link ? " The operator can upload it themselves at the link, which works once for 15 minutes." : ""}`;
	return { text: `${lead}\n${JSON.stringify(structured)}`, structured };
}

const SET_CAMPAIGN_PHOTO: LocalSpec = {
	tool: "set_campaign_photo",
	title: "Set a campaign's cover photo",
	description:
		"Sets a campaign's cover photo from a photo the operator dropped into the chat (JPEG, PNG or WebP, at most 4 MB). If it can't be set here, the answer carries a one-time link for the operator to upload it themselves. An ended campaign takes no new photo.",
	input: z.strictObject({ campaign_id: id, photo: photoFile }),
	output: {
		schema: photoOutcome,
		summary: (body) =>
			(body as z.output<typeof photoOutcome>).uploaded
				? "Cover photo set"
				: "Photo not set; upload link ready",
	},
	annotations: OVERWRITES,
	_meta: {
		...statusLines("Setting the cover photo…", "Cover photo set"),
		"openai/fileParams": PHOTO_PARAM,
	},
	needs: ["photos.upload_link"],
	async run(call) {
		const photo = photoFile.parse(call.input.photo);
		return setPhotoAnswer(
			call,
			String(call.input.campaign_id),
			photo.download_url,
		);
	},
};

// --- app-only tools -------------------------------------------------------------

const { app_create_campaign, app_publish_campaign, app_end_campaign } =
	APP_TOOLS;

const APP_CREATE_CAMPAIGN: LocalSpec = {
	tool: "app_create_campaign",
	title: "Create a campaign draft from a preset",
	description: `The campaign presets card's Create draft button: makes a draft campaign with the preset's goal, end date, suggested amounts and starter story. ${CARD_ONLY}`,
	input: app_create_campaign.args,
	output: {
		schema: CreateResult,
		summary: (body, { replayed }) => {
			const data = body as CreateResult;
			if (data.failedStep)
				return `${replayed ? "Already created" : "Partly created"}: ${data.campaign.title}, ${data.failedStep} step failed`;
			return replayed
				? `Already created: ${data.campaign.title}`
				: `Draft created: ${data.campaign.title}`;
		},
	},
	annotations: ADD,
	_meta: appMeta("Creating campaign…", "Draft created"),
	needs: ["campaigns.create"],
	async run(call) {
		const preset = app_create_campaign.args.parse(call.input);
		const created = await createCampaignWithPreset(call, preset.title, {
			theme: preset.theme,
			goal: preset.goal as never,
			end_date: preset.endDate,
			suggested_amounts: preset.suggestedAmounts as never,
		});
		return { ...answer(created), replayed: created.replayed };
	},
};

const partlyPublished = ({ applied, pending, failure }: DraftPublished) => {
	const still = `${pending.join(" and ")} edits are still a draft: ${failure ?? ""}`;
	const lead =
		applied.length > 0
			? `The ${applied.join(" and ")} edits are live now, but the ${still}`
			: `The ${still}`;
	return `${lead} Fix them in the editor and publish again, or discard the draft edits.`;
};

const APP_PUBLISH_CAMPAIGN: LocalSpec = {
	tool: "app_publish_campaign",
	title: "Publish a campaign from its card",
	description: `The results card's Publish button: puts a draft campaign live, or sends a live campaign's saved draft edits. ${CARD_ONLY}`,
	input: app_publish_campaign.args,
	output: {
		schema: CampaignResultsData,
		summary: (body, { locale }) => resultsSummary(body, locale),
	},
	annotations: DESTRUCTIVE,
	_meta: appMeta("Publishing the campaign…", "Campaign published"),
	needs: ["campaigns.publish"],
	async run(call) {
		const { id: campaignId, giftsGoTo } = app_publish_campaign.args.parse(
			call.input,
		);
		const campaign = await readCampaign(call, campaignId);
		if (isLive(campaign)) {
			const published = await publishLiveCampaignDraft(call, campaign);
			if (published.pending.length > 0) {
				throw new ToolRefusal("rejected", partlyPublished(published));
			}
		} else {
			await call.client.call(call.connection, "campaigns.publish", {
				id: campaignId,
				gifts_go_to: giftsGoTo,
			});
		}
		return answer(await resultsData(call, campaignId));
	},
};

const APP_END_CAMPAIGN: LocalSpec = {
	tool: "app_end_campaign",
	title: "End a campaign from its card",
	description: `The results card's End campaign button, pressed after its inline confirm: ends the campaign for good; it stops taking gifts. ${CARD_ONLY}`,
	input: app_end_campaign.args,
	output: {
		schema: CampaignResultsData,
		summary: (body, { locale }) => resultsSummary(body, locale),
	},
	annotations: DESTRUCTIVE,
	_meta: appMeta("Ending the campaign…", "Campaign ended"),
	needs: ["campaigns.end"],
	async run(call) {
		const { id: campaignId } = app_end_campaign.args.parse(call.input);
		await call.client.call(call.connection, "campaigns.end", {
			id: campaignId,
		});
		return answer(await resultsData(call, campaignId));
	},
};

const APP_GET_CAMPAIGN_EDITOR: LocalSpec = {
	tool: "app_get_campaign_editor",
	title: "Reload a campaign in the editor",
	description: `The editor's refresh: the campaign's page, draft included. ${CARD_ONLY}`,
	input: APP_TOOLS.app_get_campaign_editor.args,
	output: { schema: CampaignEditorData, summary: editorSummary },
	annotations: READ,
	_meta: appMeta("Reading the campaign…", "Campaign read"),
	needs: ["campaigns.get"],
	async run(call) {
		return answer(await editorData(call, String(call.input.id)));
	},
};

const APP_SAVE_CAMPAIGN_EDIT: LocalSpec = {
	tool: "app_save_campaign_edit",
	title: "Save an editor change",
	description: `The editor's save: a live campaign keeps the change as a draft until it is published; a draft campaign is written through. ${CARD_ONLY}`,
	standaloneDescription: `The editor's save: writes the change to the site at once, a live campaign's included. ${CARD_ONLY}`,
	input: APP_TOOLS.app_save_campaign_edit.args,
	output: { schema: CampaignEditorData, summary: editorSummary },
	annotations: OVERWRITES,
	_meta: appMeta("Saving the page…", "Page saved"),
	// The write is update_blocks or update_content, as the campaign's page
	// takes; a site serves the one its pages use, so requiring both would
	// hide the save where it works.
	needs: ["campaigns.get"],
	async run(call) {
		const {
			id: campaignId,
			expectedVersion,
			page,
			draftRevision,
		} = APP_TOOLS.app_save_campaign_edit.args.parse(call.input);
		// Standalone's content action takes no version.
		const version =
			expectedVersion === null || !call.connection.platform
				? {}
				: { expected_version: expectedVersion };
		const isBlocks = page.pageKind === "blocks";
		const input = isBlocks
			? { id: campaignId, blocks: page.blocks, ...version }
			: { ...page.content, id: campaignId, ...version };
		// Standalone shows a live campaign's edit at once, as its own tools do.
		const kept = call.connection.platform
			? await composeLiveEdit(isBlocks ? BLOCKS_EDIT : CONTENT_EDIT, {
					rebase: false,
					draftRevision,
				})({ ...call, input })
			: null;
		if (kept === null) {
			await call.client.call(
				call.connection,
				isBlocks ? "campaigns.update_blocks" : "campaigns.update_content",
				input,
			);
		}
		return answer(await editorData(call, campaignId));
	},
};

const DISCARD_MOVED =
	"Nothing was dropped: this campaign's draft changed after the editor read it.";
const DISCARD_MOVED_CARD =
	"Nothing was dropped: this campaign's draft edits changed elsewhere while you were editing. Close the editor and open it again to see them, then discard them if you still want to.";

const APP_DISCARD_CAMPAIGN_DRAFT: LocalSpec = {
	tool: "app_discard_campaign_draft",
	title: "Discard a campaign's draft edits from the editor",
	description: `The editor's Discard draft: drops the saved draft edits of a live campaign. ${CARD_ONLY}`,
	input: APP_TOOLS.app_discard_campaign_draft.args,
	output: { schema: CampaignEditorData, summary: editorSummary },
	annotations: DESTRUCTIVE,
	_meta: appMeta("Discarding draft edits…", "Draft edits discarded"),
	needs: ["campaigns.get"],
	platformOnly: true,
	async run(call) {
		const { id: campaignId, draftRevision } =
			APP_TOOLS.app_discard_campaign_draft.args.parse(call.input);
		// A card sending no revision drops the draft stored now, not
		// necessarily the one it shows.
		const read =
			draftRevision === undefined
				? ((await pendingDraft(call, campaignId))?.revision ?? null)
				: draftRevision;
		const outcome = await discardCampaignDraft(call, campaignId, read);
		if (outcome === "moved" || (outcome === "none" && draftRevision != null))
			throw new ToolRefusal("rejected", DISCARD_MOVED, DISCARD_MOVED_CARD);
		return answer(await editorData(call, campaignId));
	},
};

const APP_SET_CAMPAIGN_PHOTO: LocalSpec = {
	tool: "app_set_campaign_photo",
	title: "Set a cover photo from its card",
	description: `The photo card's Set as cover: uploads the dropped photo as the campaign's cover. ${CARD_ONLY}`,
	input: APP_TOOLS.app_set_campaign_photo.args,
	output: {
		schema: z.strictObject({
			url: z.string(),
			alt: z.string().nullable(),
		}),
		summary: () => "Cover photo set",
	},
	annotations: OVERWRITES,
	_meta: appMeta("Setting the cover photo…", "Cover photo set"),
	needs: ["photos.upload_link"],
	async run(call) {
		const args = APP_TOOLS.app_set_campaign_photo.args.parse(call.input);
		const outcome = await setCampaignPhoto(call, args.id, args.downloadUrl);
		if (!outcome.uploaded) {
			throw new ToolRefusal(
				"rejected",
				`The photo wasn't set: ${outcome.reason}${outcome.link ? ` Upload it at ${outcome.link.url}.` : ""}`,
			);
		}
		return answer({ url: outcome.imageUrl ?? args.downloadUrl, alt: args.alt });
	},
};

const APP_PHOTO_UPLOAD_LINK: LocalSpec = {
	tool: "app_photo_upload_link",
	title: "Get an upload link from the photo card",
	description: `The photo card's Open upload link: a single-use link, good for 15 minutes, to upload the campaign's cover on the site. ${CARD_ONLY}`,
	input: APP_TOOLS.app_photo_upload_link.args,
	output: {
		schema: z.strictObject({ url: z.string(), expiresAt: z.string() }),
		summary: (body, { locale }) =>
			`Upload link ready until ${formatDate(String(body.expiresAt), locale, {
				hour: "numeric",
				minute: "2-digit",
				timeZoneName: "short",
			})}`,
	},
	annotations: ADD,
	_meta: appMeta("Getting an upload link…", "Upload link ready"),
	needs: ["photos.upload_link"],
	async run(call) {
		const link = await uploadLink(call, String(call.input.id));
		if (link === null) {
			throw new ToolRefusal(
				"rejected",
				"The site's upload page isn't on the connected site, so no link was made.",
			);
		}
		return answer(link);
	},
};

export const WIDGET_TOOLS: readonly LocalSpec[] = [
	SHOW_CAMPAIGN_CREATE,
	SHOW_CAMPAIGNS,
	SHOW_CAMPAIGN_RESULTS,
	OPEN_CAMPAIGN_EDITOR,
	SHOW_PHOTO,
	SET_CAMPAIGN_PHOTO,
	APP_CREATE_CAMPAIGN,
	APP_PUBLISH_CAMPAIGN,
	APP_END_CAMPAIGN,
	APP_GET_CAMPAIGN_EDITOR,
	APP_SAVE_CAMPAIGN_EDIT,
	APP_DISCARD_CAMPAIGN_DRAFT,
	APP_SET_CAMPAIGN_PHOTO,
	APP_PHOTO_UPLOAD_LINK,
];
