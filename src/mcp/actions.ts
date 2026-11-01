import { z } from "zod";
import { THEME_NAMES } from "../presets/themes";
import {
	createCampaignWithPreset,
	type Preset,
	presetCreatedText,
} from "./campaign-presets";
import {
	BLOCKS_EDIT,
	CONTENT_EDIT,
	composeGetCampaign,
	composeLiveEdit,
	composePublish,
	SETTINGS_EDIT,
} from "./draft-tools";
import {
	type ActionSpec,
	type Hints,
	type LocalCall,
	statusLines,
} from "./spec";
import { OUTPUTS, PLATFORM_OUTPUTS } from "./summary";

export type { ActionSpec } from "./spec";

// Tool is inferred from the specs' `tool` names alone, so a `checkWith`
// naming no tool is a type error.
const toolSpecs = <const Tool extends string>(
	specs: readonly ActionSpec<Tool>[],
) => specs;

// Ids fill path segments. Encoding leaves "." and ".." as they are and URL
// parsing resolves them onto another route; "/" is encoded, and refused in case
// the deployment decodes %2F before routing.
const id = z
	.string()
	.min(1)
	.regex(/^(?!\.\.?$)[^/]+$/, "An id is never '.', '..' or contains '/'.");
const date = z.iso.date();
// A campaign's version as get_campaign returns it on Platform. It is passed
// through, never filled in: a version read just before the write would match
// whatever the page holds, and so guard nothing the chat read.
const expectedVersion = z
	.string()
	.regex(/^\d{1,19}$/, "The version get_campaign returned.")
	.optional()
	.describe(
		"The version get_campaign returned with the campaign this change is based on. Send it whenever get_campaign returns one: if the campaign changed since, nothing is saved, and the campaign is read again before retrying.",
	);
/** The longest note Standalone keeps on a gift (its `MAX_NOTE`); a longer one is refused there. */
export const MAX_NOTE = 2_000;
/** The longest campaign title Platform takes (its `TITLE_MAX`); a longer one is refused there. */
export const TITLE_MAX = 200;
const isIanaTimeZone = (zone: string) => {
	try {
		Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
};
const money = z
	.strictObject({
		amount: z
			.string()
			.regex(/^\d+(\.\d{1,2})?$/, 'A decimal string such as "25.00".'),
		currency: z.literal("USD"),
	})
	.describe(
		'An object with a decimal-string amount and a currency, such as {"amount": "100.00", "currency": "USD"}. A plain number is refused.',
	);
/** The most suggested amounts a preset sets on a campaign's form. */
export const MAX_SUGGESTED_AMOUNTS = 6;
const preset = z
	.strictObject({
		theme: z.enum(THEME_NAMES),
		goal: money,
		end_date: date,
		suggested_amounts: z.array(money).min(1).max(MAX_SUGGESTED_AMOUNTS),
	})
	.optional()
	.describe(
		`Sets up the new draft in the same call: its goal and end date, its donation form's suggested amounts (at most ${MAX_SUGGESTED_AMOUNTS}), and the theme's starter story for the operator to replace. recommend_campaign_presets suggests the values. Left out, only the draft is created.`,
	);
// With a preset, the create is the first of the writes that dress the draft.
async function composePreset({ connection, client, input, locale }: LocalCall) {
	if (input.preset === undefined) return null;
	const chosen = input.preset as Preset;
	const created = await createCampaignWithPreset(
		{ connection, client },
		input.title as string,
		chosen,
	);
	return {
		text: presetCreatedText(created, chosen, connection.orgName, locale),
		structured: created,
	};
}
const page = {
	cursor: z
		.string()
		.optional()
		.describe("The next_cursor of the previous page."),
	limit: z.int().min(1).max(100).optional(),
};
const blocks = z
	.array(z.record(z.string(), z.unknown()))
	.describe(
		"The page's content as blocks. Each block's schema is in get_block_catalog.",
	);

// A page's content as Standalone holds it (its content.catalog): each key's
// value in the page rule's shape, null to clear it. The deployment's rule is
// the full check; these shapes refuse what it never takes before any request.
const richText = z
	.record(z.string(), z.unknown())
	.describe(
		'A rich-text document as Tiptap JSON, such as {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Every coat is a warm night."}]}]}.',
	);
const photo = z
	.strictObject({
		imageId: z.uuid({
			error: "The id a stored photo was given on upload, never an address.",
		}),
		alt: z.string().nullable().describe("What the photo shows, or null."),
	})
	.describe(
		"A photo already on the site, named by the imageId get_campaign returns. A new photo comes in through create_photo_upload_link.",
	);
/** The most photos Standalone keeps beside a campaign's cover (its `PHOTOS_MAX`). */
const PHOTOS_MAX = 8;
const campaignContent = {
	heading: z
		.string()
		.nullable()
		.optional()
		.describe("The page's title. Empty or null shows the campaign's name."),
	lede: z
		.string()
		.nullable()
		.optional()
		.describe("A sentence or two under the title."),
	story: richText
		.nullable()
		.optional()
		.describe("The story behind the appeal, as a rich-text document."),
	hero: photo.nullable().optional().describe("The cover photo."),
	photos: z
		.array(photo)
		.max(PHOTOS_MAX)
		.nullable()
		.optional()
		.describe(
			`Photos beside the cover, at most ${PHOTOS_MAX}. Sent whole: the list replaces the current one.`,
		),
	tiers: z
		.array(
			z.strictObject({
				amountMinor: z
					.int()
					.positive()
					.describe("The gift in cents, such as 2500 for $25.00."),
				buys: z.string().describe("What that gift buys."),
			}),
		)
		.max(6)
		.nullable()
		.optional()
		.describe(
			"Up to six gift amounts, each with what it buys. Sent whole: the list replaces the current one.",
		),
	faq: z
		.array(z.strictObject({ question: z.string(), answer: richText }))
		.max(10)
		.nullable()
		.optional()
		.describe(
			"Up to ten questions donors ask, each with its answer. Sent whole: the list replaces the current one.",
		),
};
const CONTENT_KEYS = Object.keys(campaignContent);

// A write changes data on the operator's site, a separate system, so every
// write is open-world. A read changes nothing there and is closed-world.
// OpenAI's app review flags a write marked closed-world.
// Every hint is stated: a client reads a missing destructiveHint as true.
// destructiveHint false on a read matches the directory packet; the spec
// treats it as meaningful only when readOnlyHint is false.
export const READ: Hints = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
// Creates a new record or link. Calling it again adds another.
const ADD: Hints = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: true,
};
// The deployment replays these two when the arguments match, so a retry
// does not add a second campaign or gift.
const REPLAYS: Hints = {
	...ADD,
	idempotentHint: true,
};
// Overwrites the fields sent: a page, a form, or a campaign's settings. The
// same call again does not stack: the fields hold the values sent. What it
// replaced is an edit the operator asked for, so it is not destructive.
const OVERWRITES: Hints = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
};
// Changes what donors can do or see past a plain edit: puts a campaign live,
// ends it for good, or discards a page's content. Again it does not stack:
// the campaign is in that state, the page at its default.
export const DESTRUCTIVE: Hints = {
	...OVERWRITES,
	destructiveHint: true,
};

// Platform applies an edit to a live campaign at once, so the connector keeps it.
export const LIVE_EDITS_DRAFT =
	"On a live campaign the change is saved as a draft donors don't see, and goes live when publish_campaign is called again.";
const CONFIRMED =
	"Donors see this immediately, so the operator confirms it in the chat first.";
// Ends every campaign tool's description: a chat app otherwise guesses a
// dashboard path or a link the site never returned.
const LINKS_ONLY =
	"Link only to URLs a Better Giving tool returned; never describe click-paths or invent URLs.";
const editsContent = (read: string) =>
	`Each block follows a schema from get_block_catalog. ${read} returns the current content; send every block the page should keep. For sites that edit pages as blocks.`;
const EDITS_CAMPAIGN_BLOCKS = `Edits the content of a campaign's page, such as its title, story, hero photo, and goal bar. ${editsContent("get_campaign")}`;
// Standalone picks how a page is drawn from its content, so a content edit
// sets none of it; the deployment refuses a key that tries.
const DRAWN_FROM_CONTENT =
	"The site arranges the page from its content, so this tool sets no design, colors, blocks, or share buttons.";
// Two page models: a site serves either the block tools or the content ones.
const CONTENT_SITES = "on sites with get_content_catalog";
const BLOCK_SITES = "on sites with get_block_catalog";

/** One tool per `/connector/v1` action; a server registers the ones its connection's deployment serves. */
export const ACTIONS = toolSpecs([
	{
		tool: "list_campaigns",
		action: "campaigns.list",
		title: "List campaigns",
		description: `Lists the site's campaigns with their status, public link, and id. For the amount raised, use get_results. ${LINKS_ONLY}`,
		input: z.strictObject({
			status: z.enum(["draft", "published", "ended"]).optional(),
			...page,
		}),
		output: OUTPUTS.list_campaigns,
		annotations: READ,
		_meta: statusLines("Listing campaigns…", "Campaigns listed"),
	},
	{
		tool: "get_campaign",
		action: "campaigns.get",
		title: "Get a campaign",
		description: `Reads one campaign: settings, status, public link, and its page. The page is its content (title, story, photos, gift tiers, questions) and the design the site picked from it ${CONTENT_SITES}, or its blocks ${BLOCK_SITES}. For the amount raised, use get_results. ${LINKS_ONLY}`,
		input: z.strictObject({ id }),
		output: OUTPUTS.get_campaign,
		annotations: READ,
		_meta: statusLines("Reading the campaign…", "Campaign read"),
	},
	{
		tool: "create_campaign",
		action: "campaigns.create",
		title: "Create a campaign",
		description: `Creates a new draft campaign with the given title. Donors cannot see it until it is published. ${LINKS_ONLY}`,
		input: z.strictObject({ title: z.string().trim().min(1), preset }),
		output: OUTPUTS.create_campaign,
		annotations: REPLAYS,
		_meta: statusLines("Creating campaign…", "Draft created"),
		checkWith: "list_campaigns",
		compose: composePreset,
	},
	{
		tool: "update_campaign_blocks",
		action: "campaigns.update_blocks",
		title: "Edit a campaign's page",
		description: `${EDITS_CAMPAIGN_BLOCKS} ${LINKS_ONLY}`,
		input: z.strictObject({ id, blocks }),
		output: OUTPUTS.update_campaign_blocks,
		annotations: OVERWRITES,
		_meta: statusLines("Saving the campaign page…", "Campaign page saved"),
		checkWith: "get_campaign",
	},
	{
		tool: "update_campaign_content",
		action: "campaigns.update_content",
		title: "Edit a campaign's page",
		description: `Edits the content of a campaign's page: its heading, lede, story, cover photo (hero), photos beside the cover, gift tiers, and questions (faq). Send only the keys to change: a key left out stays as it is, and null clears it. Each key's shape is in get_content_catalog, and get_campaign returns the current content. Donors see the change once the campaign is published. ${DRAWN_FROM_CONTENT} ${LINKS_ONLY}`,
		input: z
			.strictObject({ id, ...campaignContent })
			.refine(
				(input) =>
					CONTENT_KEYS.some(
						(key) => input[key as keyof typeof input] !== undefined,
					),
				`Send at least one content key: ${CONTENT_KEYS.join(", ")}.`,
			),
		output: OUTPUTS.update_campaign_content,
		annotations: OVERWRITES,
		_meta: statusLines("Saving the campaign page…", "Campaign page saved"),
		checkWith: "get_campaign",
	},
	{
		tool: "update_campaign_settings",
		action: "campaigns.update_settings",
		title: "Change a campaign's settings",
		description: `Sets a campaign's goal, end date, time zone, or the message shown when it is shared. A field left out stays as it is. Null clears a field; sharing is cleared with {"message": null}. Page content goes through update_campaign_content or update_campaign_blocks. ${LINKS_ONLY}`,
		input: z.strictObject({
			id,
			goal: money.nullable().optional(),
			end_date: date.nullable().optional(),
			time_zone: z
				.string()
				.refine(isIanaTimeZone, "An IANA time zone, such as America/New_York.")
				.nullable()
				.optional(),
			sharing: z
				.strictObject({
					message: z.string().nullable().optional(),
					channels: z
						.array(z.string())
						.nullable()
						.optional()
						.describe(
							`Share channels, ${BLOCK_SITES} only. Sites with get_content_catalog offer the same share buttons on every page and refuse this.`,
						),
				})
				.optional(),
		}),
		output: OUTPUTS.update_campaign_settings,
		annotations: OVERWRITES,
		_meta: statusLines("Saving campaign settings…", "Campaign settings saved"),
		checkWith: "get_campaign",
	},
	{
		tool: "publish_campaign",
		action: "campaigns.publish",
		title: "Publish a campaign",
		description: `Puts a draft campaign live at its public link. The first publish requires gifts_go_to: ask the operator where the gifts go, then send a program id, or null for the general fund. ${CONFIRMED} ${LINKS_ONLY}`,
		input: z.strictObject({
			id,
			gifts_go_to: z.string().nullable().optional(),
		}),
		output: OUTPUTS.publish_campaign,
		annotations: DESTRUCTIVE,
		_meta: statusLines("Publishing the campaign…", "Campaign published"),
		checkWith: "get_campaign",
	},
	{
		tool: "end_campaign",
		action: "campaigns.end",
		title: "End a campaign",
		description: `Ends a campaign for good. It stops taking gifts. ${CONFIRMED} ${LINKS_ONLY}`,
		input: z.strictObject({ id }),
		output: OUTPUTS.end_campaign,
		annotations: DESTRUCTIVE,
		_meta: statusLines("Ending the campaign…", "Campaign ended"),
		checkWith: "get_campaign",
	},
	{
		tool: "get_donation_page",
		action: "donation_page.get",
		title: "Get the donation page",
		description: `Reads the site's main donation page and its public link. The page is its content ${CONTENT_SITES}, where only its heading can be edited, or its blocks ${BLOCK_SITES}.`,
		input: z.strictObject({}),
		output: OUTPUTS.get_donation_page,
		annotations: READ,
		_meta: statusLines("Reading the donation page…", "Donation page read"),
	},
	{
		tool: "update_donation_page_blocks",
		action: "donation_page.update_blocks",
		title: "Edit the donation page",
		description: `Edits the content of the site's main donation page, such as its title, story, and hero photo. ${editsContent("get_donation_page")}`,
		input: z.strictObject({ blocks }),
		output: OUTPUTS.update_donation_page_blocks,
		annotations: OVERWRITES,
		_meta: statusLines("Saving the donation page…", "Donation page saved"),
		checkWith: "get_donation_page",
	},
	{
		tool: "update_donation_page_content",
		action: "donation_page.update_content",
		title: "Edit the donation page",
		description: `Edits the heading of the site's main donation page, the only content it holds; the rest of the page is the same on every site. An empty heading, or null, shows "Donate to" and the organization's name. get_donation_page returns the current heading. The edit goes to the page's draft: donors see it once the operator publishes the donation page in the Better Giving dashboard, and no tool here publishes it. ${DRAWN_FROM_CONTENT}`,
		input: z.strictObject({
			heading: z
				.string()
				.nullable()
				.describe("The page's title, or null for the default."),
		}),
		output: OUTPUTS.update_donation_page_content,
		annotations: OVERWRITES,
		_meta: statusLines(
			"Saving the donation page heading…",
			"Donation page heading saved",
		),
		checkWith: "get_donation_page",
	},
	{
		tool: "reset_donation_page",
		action: "donation_page.reset",
		title: "Reset the donation page",
		description: `Puts the main donation page back to its default content, discarding what is there now. ${CONFIRMED}`,
		input: z.strictObject({ confirm: z.literal(true) }),
		output: OUTPUTS.reset_donation_page,
		annotations: DESTRUCTIVE,
		_meta: statusLines("Resetting the donation page…", "Donation page reset"),
		checkWith: "get_donation_page",
	},
	{
		tool: "get_block_catalog",
		action: "blocks.catalog",
		title: "Get the block catalog",
		description:
			"Lists every block type a page can hold, with what it is for and its JSON Schema. For sites that edit pages as blocks.",
		input: z.strictObject({}),
		output: OUTPUTS.get_block_catalog,
		annotations: READ,
		_meta: statusLines("Reading the block catalog…", "Block catalog read"),
	},
	{
		tool: "get_content_catalog",
		action: "content.catalog",
		title: "Get the content catalog",
		description:
			"Lists every content key a page can hold (heading, lede, story, hero, photos, tiers, faq) with what each shows donors and its JSON Schema, and says how the site arranges a campaign from its content. A campaign holds every key; the donation page holds its heading alone.",
		input: z.strictObject({}),
		output: OUTPUTS.get_content_catalog,
		annotations: READ,
		_meta: statusLines("Reading the content catalog…", "Content catalog read"),
	},
	{
		tool: "list_forms",
		action: "forms.list",
		title: "List donation forms",
		description:
			"Lists the site's donation forms (suggested amounts, currency, monthly giving), including each form's id. The list includes the donation page's form and each campaign's form; a campaign's form carries that campaign's campaign_id, and any other form has campaign_id null.",
		input: z.strictObject({ ...page }),
		output: OUTPUTS.list_forms,
		annotations: READ,
		_meta: statusLines("Listing donation forms…", "Donation forms listed"),
	},
	{
		tool: "get_form",
		action: "forms.get",
		title: "Get a donation form",
		description: "Reads one donation form in full.",
		input: z.strictObject({ id }),
		output: OUTPUTS.get_form,
		annotations: READ,
		_meta: statusLines("Reading the donation form…", "Donation form read"),
	},
	{
		tool: "create_form",
		action: "forms.create",
		title: "Create a donation form",
		description:
			"Creates a donation form. The name is required. Other fields match the shape get_form returns.",
		input: z.looseObject({ name: z.string().trim().min(1) }),
		output: OUTPUTS.create_form,
		annotations: ADD,
		_meta: statusLines("Creating donation form…", "Donation form created"),
		checkWith: "list_forms",
	},
	{
		tool: "update_form",
		action: "forms.update",
		title: "Edit a donation form",
		description:
			"Changes a donation form. Only the fields sent are changed, in the shape get_form returns. On a live form, a change donors would see needs confirm set to true, and only after the operator agrees.",
		input: z.looseObject({
			id,
			name: z.string().trim().min(1).optional(),
			confirm: z.literal(true).optional(),
		}),
		output: OUTPUTS.update_form,
		annotations: OVERWRITES,
		_meta: statusLines("Saving the donation form…", "Donation form saved"),
		checkWith: "get_form",
	},
	{
		tool: "get_results",
		action: "results.summary",
		title: "Get fundraising results",
		description:
			"Totals raised, gift count, donor count and per-campaign totals, optionally for one campaign or a date range.",
		input: z.strictObject({
			campaign_id: id.optional(),
			from: date.optional(),
			to: date.optional(),
		}),
		output: OUTPUTS.get_results,
		annotations: READ,
		_meta: statusLines("Totaling results…", "Results totaled"),
	},
	{
		tool: "list_donations",
		action: "donations.list",
		title: "List donations",
		description:
			"Lists gifts. Optionally limited to one campaign or a date range.",
		input: z.strictObject({
			campaign_id: id.optional(),
			from: date.optional(),
			to: date.optional(),
			...page,
		}),
		output: OUTPUTS.list_donations,
		annotations: READ,
		_meta: statusLines("Listing donations…", "Donations listed"),
	},
	{
		tool: "list_donors",
		action: "donors.list",
		title: "List donors",
		description:
			"Lists donors with their totals. q matches names and emails. Includes each donor's id.",
		input: z.strictObject({ q: z.string().optional(), ...page }),
		output: OUTPUTS.list_donors,
		annotations: READ,
		_meta: statusLines("Listing donors…", "Donors listed"),
	},
	{
		tool: "get_donor",
		action: "donors.get",
		title: "Get a donor",
		description: "Reads one donor and a page of the gifts they have given.",
		input: z.strictObject({ id, ...page }),
		output: OUTPUTS.get_donor,
		annotations: READ,
		_meta: statusLines("Reading the donor…", "Donor read"),
	},
	{
		tool: "list_recurring_gifts",
		action: "recurring.list",
		title: "List monthly gifts",
		description:
			"Lists recurring gifts. This connector cannot change a monthly gift.",
		input: z.strictObject({ ...page }),
		output: OUTPUTS.list_recurring_gifts,
		annotations: READ,
		_meta: statusLines("Listing monthly gifts…", "Monthly gifts listed"),
	},
	{
		tool: "record_donation",
		action: "donations.record",
		title: "Record a donation",
		description:
			"Records a donation already received offline, in cash or by check, so it counts in totals and the donor's history. It moves no money, charges no card, and issues no refund, and it is not tied to a campaign. To record a second gift with the same details, add a distinguishing note; the same details again match the earlier gift and record nothing new.",
		input: z.strictObject({
			amount: money,
			date,
			donor: z.strictObject({
				name: z.string().trim().min(1),
				email: z.email().optional(),
			}),
			method: z.enum(["cash", "check"]),
			note: z.string().trim().max(MAX_NOTE).optional(),
		}),
		output: OUTPUTS.record_donation,
		annotations: REPLAYS,
		_meta: statusLines("Recording the donation…", "Donation recorded"),
		checkWith: "list_donations",
	},
	{
		tool: "create_photo_upload_link",
		action: "photos.upload_link",
		title: "Make a photo upload link",
		description: `Returns a short-lived, single-use link for adding a photo to a campaign, or to the donation page ${BLOCK_SITES}. The operator opens the link and chooses the photo. This connector does not upload the file. On sites with get_content_catalog, a campaign holds a cover photo and at most ${PHOTOS_MAX} photos beside it; when all ${PHOTOS_MAX} are taken, ask the operator which one the new photo replaces. ${LINKS_ONLY}`,
		input: z.strictObject({
			target: z.discriminatedUnion("kind", [
				z.strictObject({ kind: z.literal("campaign"), id }),
				z.strictObject({ kind: z.literal("donation_page") }),
			]),
			slot: z
				.string()
				.optional()
				.describe(
					`Where the photo goes. On sites with get_content_catalog: "cover" for the cover, "new" to add it after the other photos, or the position of a photo beside the cover to replace it ("0" is the first). Left out, or a position with no photo, it becomes the cover when there is none and otherwise goes after the other photos. On sites with get_block_catalog: the id of the photo block it fills; left out, the first empty one.`,
				),
		}),
		output: OUTPUTS.create_photo_upload_link,
		annotations: ADD,
		_meta: statusLines("Making a photo upload link…", "Upload link ready"),
	},
]);

/** Every tool name the connector can register. */
export type ToolName = (typeof ACTIONS)[number]["tool"];
const specOf = (tool: ToolName) => {
	const spec = ACTIONS.find((s) => s.tool === tool);
	if (!spec) throw new Error(`no ${tool} spec`);
	return spec;
};

// What Platform's writes add to the specs above: a campaign's version guard,
// create_form's warning against a second call, updated_at on a form, photo
// links for a campaign's hero alone, when public_url is null, and a create
// that takes a title alone.
const PLATFORM_CHANGES: Partial<
	Record<ToolName, Partial<ActionSpec<ToolName>>>
> = {
	list_campaigns: {
		description: `Lists the site's campaigns with their status, public link, and id. public_url is null for a draft, and for every campaign while the nonprofit has no public profile address. When a list filtered by status comes back empty, the result says how many campaigns the other statuses hold, so there is no need to list again. For the amount raised, use get_results. ${LINKS_ONLY}`,
	},
	get_campaign: {
		description: `Reads one campaign: settings, status, public link, and its blocks. public_url is null for a draft, and while the nonprofit has no public profile address. A live campaign's edits not yet published are under pendingDraft. For the amount raised, use get_results. ${LINKS_ONLY}`,
		output: PLATFORM_OUTPUTS.get_campaign,
		compose: composeGetCampaign,
	},
	// Platform refuses any key but the title.
	create_campaign: {
		description: `Creates a new draft campaign. Before calling, ask the operator in one message for the campaign's name (required), a fundraising goal in USD, an end date, and a few sentences of story; skip what they don't know. Confirm once with a one-line summary and wait for their yes, then create it. Then, without asking again, set the goal and end date with update_campaign_settings, then the story with update_campaign_blocks, giving each call the version the call before it returned. Reply in one sentence. Donors can't see the draft, and it has no public link, until it is published. ${LINKS_ONLY}`,
		input: z.strictObject({
			title: z.string().trim().min(1).max(TITLE_MAX),
			preset,
		}),
	},
	update_campaign_blocks: {
		description: `${EDITS_CAMPAIGN_BLOCKS} A hero photo is one uploaded for this campaign through create_photo_upload_link, as get_campaign shows it, or null. ${LIVE_EDITS_DRAFT} ${LINKS_ONLY}`,
		input: specOf("update_campaign_blocks").input.extend({
			expected_version: expectedVersion,
		}),
		output: PLATFORM_OUTPUTS.update_campaign_blocks,
		compose: composeLiveEdit(BLOCKS_EDIT),
	},
	update_campaign_content: {
		output: PLATFORM_OUTPUTS.update_campaign_content,
		compose: composeLiveEdit(CONTENT_EDIT),
	},
	// Platform keeps no time zone or share message of its own, and refuses a change to either.
	update_campaign_settings: {
		description: `Sets a campaign's goal or end date. A field left out stays as it is, and null clears it. Page content goes through update_campaign_blocks. ${LIVE_EDITS_DRAFT} ${LINKS_ONLY}`,
		input: specOf("update_campaign_settings")
			.input.omit({ time_zone: true, sharing: true })
			.extend({ expected_version: expectedVersion }),
		output: PLATFORM_OUTPUTS.update_campaign_settings,
		compose: composeLiveEdit(SETTINGS_EDIT),
	},
	publish_campaign: {
		description: `Puts a draft campaign live at its public link. The first publish requires gifts_go_to: ask the operator where the gifts go, then send a program id, or null for the general fund. On a campaign that is already live, it sends the edits saved as its draft instead, and nothing else. ${CONFIRMED} ${LINKS_ONLY}`,
		output: PLATFORM_OUTPUTS.publish_campaign,
		compose: composePublish,
	},
	create_form: {
		description: `${specOf("create_form").description} Each call makes a new form, so after an unclear answer check with list_forms before calling again.`,
	},
	update_form: {
		description:
			"Changes a donation form. Only the fields sent are changed, in the shape get_form returns; send the updated_at get_form returned, so a change made since is refused rather than overwritten. On a live form, a change donors would see needs confirm set to true, and only after the operator agrees.",
	},
	create_photo_upload_link: {
		description: `Returns a single-use link, good for 15 minutes, for adding a campaign's hero photo. The operator opens the link and chooses a JPEG, PNG or WebP of at most 4 MB; expires_at says when the link stops working. This connector does not upload the file. An ended campaign takes no new photo. The uploaded photo becomes the campaign's hero: read the campaign again with get_campaign before editing its blocks. ${LINKS_ONLY}`,
		input: z.strictObject({
			target: z.strictObject({ kind: z.literal("campaign"), id }),
			slot: z
				.literal("hero")
				.optional()
				.describe('Where the photo goes: "hero", or left out.'),
		}),
	},
};

const PLATFORM_ACTIONS: readonly ActionSpec[] = ACTIONS.map((spec) => ({
	...spec,
	...PLATFORM_CHANGES[spec.tool],
}));

/** The specs for a connection: Standalone's as above, or Platform's with its changes. */
export const actionsFor = (platform: boolean): readonly ActionSpec[] =>
	platform ? PLATFORM_ACTIONS : ACTIONS;
