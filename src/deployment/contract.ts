import { z } from "zod";

// Mirror of `/connector/v1` as Better Giving deployments serve it: Standalone
// (better-giving/better-giving, packages/app/src/lib/server/connector/) and
// Platform (better-giving/better-giving-platform,
// apps/platform/.server/connector/). When that surface moves, this file moves.
//
// Pages come in two models. Platform, and Standalone before its content
// release, edit a page as a list of blocks (`*.update_blocks`,
// `blocks.catalog`). Standalone now edits a page's content alone and picks how
// it is drawn from that content (`*.update_content`, `content.catalog`); it
// answers the block actions 422 `replaced`, naming the action in their place.

export const BASE_PATH = "/connector/v1";
export const ALLOW_PATH = "/admin/connector/allow";

export const ROUTES = {
	"campaigns.list": { method: "GET", path: "/campaigns" },
	"campaigns.get": { method: "GET", path: "/campaigns/:id" },
	"campaigns.create": { method: "POST", path: "/campaigns" },
	"campaigns.update_blocks": { method: "PATCH", path: "/campaigns/:id/blocks" },
	"campaigns.update_content": {
		method: "PATCH",
		path: "/campaigns/:id/content",
	},
	"campaigns.update_settings": {
		method: "PATCH",
		path: "/campaigns/:id/settings",
	},
	"campaigns.publish": { method: "POST", path: "/campaigns/:id/publish" },
	"campaigns.end": { method: "POST", path: "/campaigns/:id/end" },
	"donation_page.get": { method: "GET", path: "/donation-page" },
	"donation_page.update_blocks": {
		method: "PATCH",
		path: "/donation-page/blocks",
	},
	"donation_page.update_content": {
		method: "PATCH",
		path: "/donation-page/content",
	},
	"donation_page.reset": { method: "POST", path: "/donation-page/reset" },
	"blocks.catalog": { method: "GET", path: "/blocks/catalog" },
	"content.catalog": { method: "GET", path: "/content/catalog" },
	"forms.list": { method: "GET", path: "/forms" },
	"forms.get": { method: "GET", path: "/forms/:id" },
	"forms.create": { method: "POST", path: "/forms" },
	"forms.update": { method: "PATCH", path: "/forms/:id" },
	"results.summary": { method: "GET", path: "/results" },
	"donations.list": { method: "GET", path: "/donations" },
	"donors.list": { method: "GET", path: "/donors" },
	"donors.get": { method: "GET", path: "/donors/:id" },
	"recurring.list": { method: "GET", path: "/recurring" },
	"donations.record": { method: "POST", path: "/donations" },
	"photos.upload_link": { method: "POST", path: "/photos/upload-link" },
} as const satisfies Record<
	string,
	{ method: "GET" | "POST" | "PATCH"; path: string }
>;

export type ActionName = keyof typeof ROUTES;

export const isActionName = (name: string): name is ActionName =>
	Object.hasOwn(ROUTES, name);

/** Each block action Standalone retired, and the content action it answers `replaced` with. */
export const REPLACED_BY = {
	"campaigns.update_blocks": "campaigns.update_content",
	"donation_page.update_blocks": "donation_page.update_content",
	"blocks.catalog": "content.catalog",
} as const satisfies Partial<Record<ActionName, ActionName>>;

export const replacementOf = (action: ActionName): ActionName | null =>
	Object.hasOwn(REPLACED_BY, action)
		? REPLACED_BY[action as keyof typeof REPLACED_BY]
		: null;

/**
 * Each action's tool name, the other spelling hello's `actions` arrives in:
 * Standalone lists contract names, Platform lists tool names. src/mcp/actions.ts
 * names the same pairs, and src/mcp/actions.test.ts holds the two equal.
 */
export const TOOL_ACTIONS = {
	list_campaigns: "campaigns.list",
	get_campaign: "campaigns.get",
	create_campaign: "campaigns.create",
	update_campaign_blocks: "campaigns.update_blocks",
	update_campaign_content: "campaigns.update_content",
	update_campaign_settings: "campaigns.update_settings",
	publish_campaign: "campaigns.publish",
	end_campaign: "campaigns.end",
	get_donation_page: "donation_page.get",
	update_donation_page_blocks: "donation_page.update_blocks",
	update_donation_page_content: "donation_page.update_content",
	reset_donation_page: "donation_page.reset",
	get_block_catalog: "blocks.catalog",
	get_content_catalog: "content.catalog",
	list_forms: "forms.list",
	get_form: "forms.get",
	create_form: "forms.create",
	update_form: "forms.update",
	get_results: "results.summary",
	list_donations: "donations.list",
	list_donors: "donors.list",
	get_donor: "donors.get",
	list_recurring_gifts: "recurring.list",
	record_donation: "donations.record",
	create_photo_upload_link: "photos.upload_link",
} as const satisfies Record<string, ActionName>;

const actionOf = (name: string): ActionName | null =>
	isActionName(name)
		? name
		: Object.hasOwn(TOOL_ACTIONS, name)
			? TOOL_ACTIONS[name as keyof typeof TOOL_ACTIONS]
			: null;

/**
 * The known action names in `value`, or null when it is not an array. A name
 * may be a contract name or its tool name; one that is neither is dropped, and
 * each action appears once. So hello's `actions` and a stored `actions` column
 * read the same way: unknown names are absent, not stated.
 */
export const knownActions = (value: unknown): ActionName[] | null =>
	Array.isArray(value)
		? [
				...new Set(
					value.flatMap((name) => {
						const action = typeof name === "string" ? actionOf(name) : null;
						return action === null ? [] : [action];
					}),
				),
			]
		: null;

/**
 * Whether hello's `actions` come from Platform, which lists tool names where
 * Standalone lists contract names: some tool name, and no contract name.
 * Platform-only behavior keys off this.
 */
function listsToolNames(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	const names = value.filter((name) => typeof name === "string");
	return (
		names.some((name) => Object.hasOwn(TOOL_ACTIONS, name)) &&
		!names.some(isActionName)
	);
}

const ORG_NAME_MAX = 100;

// The deployment writes the org name, and it reaches the model's instructions
// and every error sentence, so it arrives as one line of bounded length; empty
// when nothing is left, for hello to fill. Cut by code point, so never inside
// a surrogate pair.
const orgName = (name: string) =>
	Array.from(
		name
			.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
			.replace(/\s+/g, " ")
			.trim(),
	)
		.slice(0, ORG_NAME_MAX)
		.join("")
		.trim();

// Unknown fields are ignored, never thrown on. `actions` lists what this
// deployment serves; absent or not an array, it is unstated (null), and any
// name this contract doesn't know is dropped.
export const helloBody = z
	.object({
		service: z.literal("better-giving"),
		contract: z.literal(1),
		release: z.string(),
		name: z.string(),
		actions: z.unknown().optional(),
	})
	.transform(({ release, name, actions }) => ({
		release,
		orgName: orgName(name),
		actions: knownActions(actions),
		platform: listsToolNames(actions),
	}));

// `name` is kept and cleaned the same way hello's is. Absent, it is empty, so
// the name hello already resolved stays.
export const exchangeBody = z
	.object({
		key: z.string().min(1),
		name: z.string().optional(),
	})
	.transform(({ key, name }) => ({
		key,
		orgName: name === undefined ? "" : orgName(name),
	}));

/** What of an RFC 9457 problem body the chat can act on. */
export type Problem = {
	title?: string;
	detail?: string;
	code?: string;
	errors?: { path: string; message: string }[];
};

// Anything else in the body stays behind, and a malformed field is dropped
// rather than failing the rest.
const problemFields = z.object({
	title: z.string().optional().catch(undefined),
	detail: z.string().optional().catch(undefined),
	code: z.string().optional().catch(undefined),
	errors: z
		.array(z.object({ path: z.string(), message: z.string() }))
		.optional()
		.catch(undefined),
});

/** The problem in a response body, or null when the body holds none. */
export function problemOf(body: unknown): Problem | null {
	const fields = problemFields.safeParse(body).data ?? {};
	const kept = Object.entries(fields).filter(([, v]) => v !== undefined);
	return kept.length > 0 ? (Object.fromEntries(kept) as Problem) : null;
}
