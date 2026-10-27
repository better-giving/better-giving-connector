import type { ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ActionName } from "../deployment";

export type ActionSpec<Tool extends string = string> = {
	tool: Tool;
	action: ActionName;
	title: string;
	description: string;
	input: z.ZodObject;
	annotations: ToolAnnotations;
	/** A write's read tool: what shows whether it went through when its answer was lost. */
	checkWith?: NoInfer<Tool>;
};

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

// openWorldHint is false: every tool talks only to the one connected site.
// destructiveHint false on a read matches the directory packet; the spec
// treats it as meaningful only when readOnlyHint is false.
const READ = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
// Creates a new record or link. Calling it again adds another.
const ADD = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};
// The deployment replays these two when the arguments match, so a retry
// does not add a second campaign or gift.
const REPLAYS = {
	...ADD,
	idempotentHint: true,
};
// Sets fields to the values sent. The same call again leaves them as they are.
const SET = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};
// Replaces or retires something donors can see. The same call again does not
// stack: the page is that block list, or the campaign is in that state.
const DESTRUCTIVE = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: false,
};

const CONFIRMED =
	"Donors see this immediately, so the operator confirms it in the chat first.";
const editsContent = (read: string) =>
	`Each block follows a schema from get_block_catalog. ${read} returns the current content; send every block the page should keep. For sites that edit pages as blocks.`;
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
		description:
			"Lists the site's campaigns with their status, public link, and id. For the amount raised, use get_results.",
		input: z.strictObject({
			status: z.enum(["draft", "published", "ended"]).optional(),
			...page,
		}),
		annotations: READ,
	},
	{
		tool: "get_campaign",
		action: "campaigns.get",
		title: "Get a campaign",
		description: `Reads one campaign: settings, status, public link, and its page. The page is its content (title, story, photos, gift tiers, questions) and the design the site picked from it ${CONTENT_SITES}, or its blocks ${BLOCK_SITES}. For the amount raised, use get_results.`,
		input: z.strictObject({ id }),
		annotations: READ,
	},
	{
		tool: "create_campaign",
		action: "campaigns.create",
		title: "Create a campaign",
		description:
			"Creates a new draft campaign with the given title. Donors cannot see it until it is published.",
		input: z.strictObject({ title: z.string().trim().min(1) }),
		annotations: REPLAYS,
		checkWith: "list_campaigns",
	},
	{
		tool: "update_campaign_blocks",
		action: "campaigns.update_blocks",
		title: "Edit a campaign's page",
		description: `Edits the content of a campaign's page, such as its title, story, hero photo, and goal bar. ${editsContent("get_campaign")}`,
		input: z.strictObject({ id, blocks }),
		annotations: DESTRUCTIVE,
		checkWith: "get_campaign",
	},
	{
		tool: "update_campaign_content",
		action: "campaigns.update_content",
		title: "Edit a campaign's page",
		description: `Edits the content of a campaign's page: its heading, lede, story, cover photo (hero), photos beside the cover, gift tiers, and questions (faq). Send only the keys to change: a key left out stays as it is, and null clears it. Each key's shape is in get_content_catalog, and get_campaign returns the current content. Donors see the change once the campaign is published. ${DRAWN_FROM_CONTENT}`,
		input: z
			.strictObject({ id, ...campaignContent })
			.refine(
				(input) =>
					CONTENT_KEYS.some(
						(key) => input[key as keyof typeof input] !== undefined,
					),
				`Send at least one content key: ${CONTENT_KEYS.join(", ")}.`,
			),
		annotations: SET,
		checkWith: "get_campaign",
	},
	{
		tool: "update_campaign_settings",
		action: "campaigns.update_settings",
		title: "Change a campaign's settings",
		description:
			'Sets a campaign\'s goal, end date, time zone, or the message shown when it is shared. A field left out stays as it is. Null clears a field; sharing is cleared with {"message": null}. Page content goes through update_campaign_content or update_campaign_blocks.',
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
		annotations: SET,
		checkWith: "get_campaign",
	},
	{
		tool: "publish_campaign",
		action: "campaigns.publish",
		title: "Publish a campaign",
		description: `Puts a draft campaign live at its public link. The first publish requires gifts_go_to: ask the operator where the gifts go, then send a program id, or null for the general fund. ${CONFIRMED}`,
		input: z.strictObject({
			id,
			gifts_go_to: z.string().nullable().optional(),
		}),
		annotations: DESTRUCTIVE,
		checkWith: "get_campaign",
	},
	{
		tool: "end_campaign",
		action: "campaigns.end",
		title: "End a campaign",
		description: `Ends a campaign for good. It stops taking gifts. ${CONFIRMED}`,
		input: z.strictObject({ id }),
		annotations: DESTRUCTIVE,
		checkWith: "get_campaign",
	},
	{
		tool: "get_donation_page",
		action: "donation_page.get",
		title: "Get the donation page",
		description: `Reads the site's main donation page and its public link. The page is its content ${CONTENT_SITES}, where only its heading can be edited, or its blocks ${BLOCK_SITES}.`,
		input: z.strictObject({}),
		annotations: READ,
	},
	{
		tool: "update_donation_page_blocks",
		action: "donation_page.update_blocks",
		title: "Edit the donation page",
		description: `Edits the content of the site's main donation page, such as its title, story, and hero photo. ${editsContent("get_donation_page")}`,
		input: z.strictObject({ blocks }),
		annotations: DESTRUCTIVE,
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
		annotations: SET,
		checkWith: "get_donation_page",
	},
	{
		tool: "reset_donation_page",
		action: "donation_page.reset",
		title: "Reset the donation page",
		description: `Puts the main donation page back to its default content, discarding what is there now. ${CONFIRMED}`,
		input: z.strictObject({ confirm: z.literal(true) }),
		annotations: DESTRUCTIVE,
		checkWith: "get_donation_page",
	},
	{
		tool: "get_block_catalog",
		action: "blocks.catalog",
		title: "Get the block catalog",
		description:
			"Lists every block type a page can hold, with what it is for and its JSON Schema. For sites that edit pages as blocks.",
		input: z.strictObject({}),
		annotations: READ,
	},
	{
		tool: "get_content_catalog",
		action: "content.catalog",
		title: "Get the content catalog",
		description:
			"Lists every content key a page can hold (heading, lede, story, hero, photos, tiers, faq) with what each shows donors and its JSON Schema, and says how the site arranges a campaign from its content. A campaign holds every key; the donation page holds its heading alone.",
		input: z.strictObject({}),
		annotations: READ,
	},
	{
		tool: "list_forms",
		action: "forms.list",
		title: "List donation forms",
		description:
			"Lists the site's donation forms (suggested amounts, currency, monthly giving), including each form's id. The list includes the donation page's form and each campaign's form; a campaign's form carries that campaign's campaign_id, and any other form has campaign_id null.",
		input: z.strictObject({ ...page }),
		annotations: READ,
	},
	{
		tool: "get_form",
		action: "forms.get",
		title: "Get a donation form",
		description: "Reads one donation form in full.",
		input: z.strictObject({ id }),
		annotations: READ,
	},
	{
		tool: "create_form",
		action: "forms.create",
		title: "Create a donation form",
		description:
			"Creates a donation form. The name is required. Other fields match the shape get_form returns.",
		input: z.looseObject({ name: z.string().trim().min(1) }),
		annotations: ADD,
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
		annotations: SET,
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
		annotations: READ,
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
		annotations: READ,
	},
	{
		tool: "list_donors",
		action: "donors.list",
		title: "List donors",
		description:
			"Lists donors with their totals. q matches names and emails. Includes each donor's id.",
		input: z.strictObject({ q: z.string().optional(), ...page }),
		annotations: READ,
	},
	{
		tool: "get_donor",
		action: "donors.get",
		title: "Get a donor",
		description: "Reads one donor and a page of the gifts they have given.",
		input: z.strictObject({ id, ...page }),
		annotations: READ,
	},
	{
		tool: "list_recurring_gifts",
		action: "recurring.list",
		title: "List monthly gifts",
		description:
			"Lists recurring gifts. This connector cannot change a monthly gift.",
		input: z.strictObject({ ...page }),
		annotations: READ,
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
		annotations: REPLAYS,
		checkWith: "list_donations",
	},
	{
		tool: "create_photo_upload_link",
		action: "photos.upload_link",
		title: "Make a photo upload link",
		description: `Returns a short-lived, single-use link for adding a photo to a campaign, or to the donation page ${BLOCK_SITES}. The operator opens the link and chooses the photo. This connector does not upload the file. On sites with get_content_catalog, a campaign holds a cover photo and at most ${PHOTOS_MAX} photos beside it; when all ${PHOTOS_MAX} are taken, ask the operator which one the new photo replaces.`,
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
		annotations: ADD,
	},
]);

type Tool = (typeof ACTIONS)[number]["tool"];
const specOf = (tool: Tool) => {
	const spec = ACTIONS.find((s) => s.tool === tool);
	if (!spec) throw new Error(`no ${tool} spec`);
	return spec;
};

// What Platform's writes add to the specs above: a campaign's version guard,
// create_form's warning against a second call, updated_at on a form, and photo
// links for the hero alone.
const PLATFORM_CHANGES: Partial<Record<Tool, Partial<ActionSpec<Tool>>>> = {
	update_campaign_blocks: {
		description: `${specOf("update_campaign_blocks").description} A hero photo is one uploaded for this campaign through create_photo_upload_link, as get_campaign shows it, or null.`,
		input: z.strictObject({ id, blocks, expected_version: expectedVersion }),
	},
	// Platform keeps no time zone or share message of its own, and refuses a change to either.
	update_campaign_settings: {
		description:
			"Sets a campaign's goal or end date. A field left out stays as it is, and null clears it. Page content goes through update_campaign_blocks.",
		input: specOf("update_campaign_settings")
			.input.omit({ time_zone: true, sharing: true })
			.extend({ expected_version: expectedVersion }),
	},
	create_form: {
		description: `${specOf("create_form").description} Each call makes a new form, so after an unclear answer check with list_forms before calling again.`,
	},
	update_form: {
		description:
			"Changes a donation form. Only the fields sent are changed, in the shape get_form returns; send the updated_at get_form returned, so a change made since is refused rather than overwritten. On a live form, a change donors would see needs confirm set to true, and only after the operator agrees.",
	},
	create_photo_upload_link: {
		description:
			"Returns a single-use link, good for 15 minutes, for adding a campaign's hero photo. The operator opens the link and chooses a JPEG, PNG or WebP of at most 4 MB; expires_at says when the link stops working. This connector does not upload the file. An ended campaign takes no new photo. The uploaded photo becomes the campaign's hero: read the campaign again with get_campaign before editing its blocks.",
		input: z.strictObject({
			target: z.strictObject({ kind: z.literal("campaign"), id }),
			slot: z
				.literal("hero")
				.optional()
				.describe('Where the photo goes: "hero", or left out.'),
		}),
	},
};

/** The specs for a connection: Standalone's as above, or Platform's with its changes. */
export const actionsFor = (platform: boolean): readonly ActionSpec[] =>
	platform
		? ACTIONS.map((spec) => ({ ...spec, ...PLATFORM_CHANGES[spec.tool] }))
		: ACTIONS;
