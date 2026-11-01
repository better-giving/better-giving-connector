// The data contract between the widgets and the server: the structuredContent
// of each render tool, and the arguments and results of the app-only tools the
// widgets' buttons call. Pure and browser-safe: src/mcp imports it to build
// what the widgets parse, so nothing here may touch the DOM or node.

import { z } from "zod";
import { THEME_NAMES } from "../presets/themes";

/** A decimal-string amount in its own currency, as every tool returns money. */
export const Money = z.object({
	amount: z.string().regex(/^-?\d+(\.\d+)?$/),
	currency: z.string().length(3),
});
export type Money = z.infer<typeof Money>;

/** The deployment's campaign status; the widgets label `published` "Live". */
export const CampaignStatus = z.enum(["draft", "published", "ended"]);
export type CampaignStatus = z.infer<typeof CampaignStatus>;

const Day = z.iso.date();
const Url = z.url({ protocol: /^https?$/ });
const Theme = z.enum(THEME_NAMES);

/**
 * The origins an `<img>` may load from, as the resource's CSP lists them:
 * `https://host` or `https://*.suffix`. An image elsewhere renders the placeholder.
 */
const ImageOrigins = z.array(z.string());

// show_campaigns

export const CampaignCard = z.object({
	id: z.string(),
	title: z.string(),
	status: CampaignStatus,
	goal: Money.nullable(),
	raised: Money,
	donors: z.int().nonnegative(),
	endDate: Day.nullable(),
	imageUrl: Url.nullable(),
	/** The public page; null for a draft. */
	url: Url.nullable(),
});
export type CampaignCard = z.infer<typeof CampaignCard>;

export const MAX_CAMPAIGNS = 8;

export const CampaignsData = z.object({
	/** The organization's currency, for totals when there are no campaigns. */
	currency: z.string().length(3),
	imageOrigins: ImageOrigins,
	campaigns: z.array(CampaignCard).max(MAX_CAMPAIGNS),
});
export type CampaignsData = z.infer<typeof CampaignsData>;

// show_campaign_results (also the result of publish and end)

export const CampaignResultsData = z.object({
	campaign: z.object({
		id: z.string(),
		title: z.string(),
		status: CampaignStatus,
		goal: Money.nullable(),
		endDate: Day.nullable(),
		url: Url.nullable(),
		/** Platform's saved version; null where the deployment has none. */
		version: z.string().nullable(),
	}),
	raised: Money,
	donors: z.int().nonnegative(),
	giftCount: z.int().nonnegative(),
	/** Null with no gifts. */
	averageGift: Money.nullable(),
	medianGift: Money.nullable(),
	/** Oldest first, ending today; days with no gifts are zero. */
	daily: z.array(z.object({ date: Day, total: Money })).length(14),
	/** What the first publish needs, in the server's words. */
	readiness: z.array(
		z.object({ id: z.string(), label: z.string(), done: z.boolean() }),
	),
	/** The programs `giftsGoTo` may name, besides the general fund. */
	programs: z.array(z.object({ id: z.string(), name: z.string() })),
	/** A program id; null is the general fund. */
	giftsGoTo: z.string().nullable(),
	/** A live campaign has saved edits not yet published. */
	pendingDraft: z.boolean(),
});
export type CampaignResultsData = z.infer<typeof CampaignResultsData>;

// show_campaign_create

const recommendation = <T extends z.ZodType>(value: T) =>
	z.object({
		value,
		/** One sentence on where the value comes from. */
		evidence: z.string(),
	});

/** One preset card; its values are what Create draft sends (the theme's defaults, or the server's tuned ones). */
export const Preset = z.object({
	theme: Theme,
	title: z.string(),
	goal: Money,
	endDate: Day,
	suggestedAmounts: z.array(Money).min(1),
});
export type Preset = z.infer<typeof Preset>;

export const CampaignCreateData = z
	.object({
		presets: z.array(Preset).length(THEME_NAMES.length),
		selected: Theme,
		recommendations: z.object({
			/** False: too little history, so the values are starting points. */
			basedOnHistory: z.boolean(),
			goal: recommendation(Money),
			suggestedAmounts: recommendation(z.array(Money)),
			/** Days from publish to the end date. */
			endDays: recommendation(z.int().positive()),
			theme: recommendation(Theme),
		}),
	})
	.refine(
		(data) =>
			new Set(data.presets.map((p) => p.theme)).size === THEME_NAMES.length,
		{ path: ["presets"], message: "one preset per theme" },
	);
export type CampaignCreateData = z.infer<typeof CampaignCreateData>;

const CreateStep = z.enum(["create", "settings", "form", "page"]);

export const CreateResult = z.object({
	campaign: z.object({
		id: z.string(),
		title: z.string(),
		version: z.string().optional(),
		status: CampaignStatus,
	}),
	steps: z.array(
		z.object({
			step: CreateStep,
			status: z.enum(["done", "failed", "skipped"]),
			detail: z.string().optional(),
		}),
	),
	failedStep: CreateStep.nullable(),
});
export type CreateResult = z.infer<typeof CreateResult>;

// open_campaign_editor (also the result of every editor write)

/** A Platform block as the deployment's catalog defines it. */
export const Block = z.looseObject({ type: z.string() });
export type Block = z.infer<typeof Block>;

/** Standalone's content keys; `hero` and `photos` name images by id (see `images`). */
export const PageContent = z.looseObject({
	heading: z.string().optional(),
	lede: z.string().optional(),
	story: z.record(z.string(), z.unknown()).optional(),
	hero: z
		.object({ imageId: z.string(), alt: z.string().nullable() })
		.optional(),
	tiers: z
		.array(z.object({ amountMinor: z.int().positive(), buys: z.string() }))
		.optional(),
	faq: z
		.array(
			z.object({
				question: z.string(),
				answer: z.record(z.string(), z.unknown()),
			}),
		)
		.optional(),
});
export type PageContent = z.infer<typeof PageContent>;

export const Page = z.discriminatedUnion("pageKind", [
	z.object({ pageKind: z.literal("blocks"), blocks: z.array(Block) }),
	z.object({ pageKind: z.literal("content"), content: PageContent }),
]);
export type Page = z.infer<typeof Page>;

export const CampaignEditorData = z.object({
	orgName: z.string(),
	campaign: z.object({
		id: z.string(),
		title: z.string(),
		status: CampaignStatus,
		/** The saved version the header shows ("Saved · v14"). */
		version: z.string().nullable(),
		url: Url.nullable(),
	}),
	/** The draft when one is pending, else the published page. */
	page: Page,
	pendingDraft: z.boolean(),
	/** The donation form's suggested amounts. */
	formAmounts: z.array(Money),
	imageOrigins: ImageOrigins,
	/** Image id → URL, for the content model's photos. */
	images: z.record(z.string(), Url),
});
export type CampaignEditorData = z.infer<typeof CampaignEditorData>;

// show_photo

export const PhotoData = z.object({
	campaign: z.object({ id: z.string(), title: z.string() }),
	/** The campaign's cover now. */
	current: z.object({ url: Url, alt: z.string().nullable() }).nullable(),
	/** The photo the user dropped into the chat; null when there is none. */
	file: z
		.object({
			name: z.string(),
			size: z.int().nonnegative(),
			type: z.string(),
			/** Where the widget can show it; null outside the image origins. */
			previewUrl: Url.nullable(),
			/** Where the server fetches it from (the host's file download URL). */
			downloadUrl: Url,
		})
		.nullable(),
	suggestedAlt: z.string(),
	/** A link to upload the photo on the deployment's own page; null when it has none. */
	uploadUrl: Url.nullable(),
	/** The deployment takes a cover through the connector (app_set_campaign_photo). */
	canUpload: z.boolean(),
	imageOrigins: ImageOrigins,
});
export type PhotoData = z.infer<typeof PhotoData>;

// The tools the widgets' buttons call. Every app_ tool is app-only
// (`_meta.ui.visibility: ["app"]`); get_profile is model-visible.

const CampaignId = z.object({ id: z.string() });

export const APP_TOOLS = {
	app_create_campaign: {
		args: Preset,
		result: CreateResult,
	},
	app_publish_campaign: {
		/** Publishes a draft, or applies a live campaign's pending draft. */
		args: CampaignId.extend({ giftsGoTo: z.string().nullable() }),
		result: CampaignResultsData,
	},
	app_end_campaign: { args: CampaignId, result: CampaignResultsData },
	app_get_campaign_editor: { args: CampaignId, result: CampaignEditorData },
	app_save_campaign_edit: {
		/** A live campaign stores it as its draft; a draft campaign is written through. */
		args: CampaignId.extend({
			expectedVersion: z.string().nullable(),
			page: Page,
		}),
		result: CampaignEditorData,
	},
	app_discard_campaign_draft: {
		args: CampaignId,
		result: CampaignEditorData,
	},
	app_set_campaign_photo: {
		args: CampaignId.extend({ downloadUrl: Url, alt: z.string() }),
		result: z.object({ url: Url, alt: z.string().nullable() }),
	},
	app_photo_upload_link: {
		args: CampaignId,
		result: z.object({ url: Url, expiresAt: z.iso.datetime({ offset: true }) }),
	},
	get_profile: {
		args: z.object({}),
		result: z.object({ id: z.string(), name: z.string() }),
	},
} as const;
export type AppToolName = keyof typeof APP_TOOLS;
export type AppToolArgs<N extends AppToolName> = z.input<
	(typeof APP_TOOLS)[N]["args"]
>;
export type AppToolResult<N extends AppToolName> = z.output<
	(typeof APP_TOOLS)[N]["result"]
>;

/** Each widget's resource name and the render tool that shows it. */
export const RENDER_TOOLS = {
	"campaign-create": { tool: "show_campaign_create", data: CampaignCreateData },
	campaigns: { tool: "show_campaigns", data: CampaignsData },
	"campaign-results": {
		tool: "show_campaign_results",
		data: CampaignResultsData,
	},
	"campaign-editor": { tool: "open_campaign_editor", data: CampaignEditorData },
	photo: { tool: "show_photo", data: PhotoData },
} as const;
export type WidgetName = keyof typeof RENDER_TOOLS;
