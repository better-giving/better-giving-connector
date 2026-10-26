import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type { Origin } from "../src/deployment/origin";
import { PLATFORM_ACTION_OF } from "./platform-hello";

/** Standalone's `MAX_NOTE`: the longest note a gift keeps. */
const MAX_NOTE = 2_000;

// An in-process Better Giving deployment speaking `/connector/v1` as the
// public Standalone connector surface serves it
// (https://github.com/better-giving/better-giving
// packages/app/src/lib/server/connector/). Routes are transcribed from that
// surface, not from src/deployment/contract.ts, so the two copies check each
// other.
//
// It serves both page models. A release serving the block actions edits a page
// as blocks; one serving `CONTENT_ACTIONS` alone is Standalone's content
// release: it edits a page's content, picks the layout from it, and answers
// each retired block action 422 `replaced`.
//
// With `platform: true` it is Platform instead
// (better-giving/better-giving-platform, apps/platform/.server/connector/):
// hello lists tool names, and its writes keep Platform's rules: a campaign's
// `version` and 409 `stale_read`, 409 `campaign_ended`, a live form's 409
// `confirm_required`, create_form's optional Idempotency-Key, and photo links
// for a campaign's hero alone.

export const ALL_ACTIONS = [
	"campaigns.list",
	"campaigns.get",
	"campaigns.create",
	"campaigns.update_blocks",
	"campaigns.update_content",
	"campaigns.update_settings",
	"campaigns.publish",
	"campaigns.end",
	"donation_page.get",
	"donation_page.update_blocks",
	"donation_page.update_content",
	"donation_page.reset",
	"blocks.catalog",
	"content.catalog",
	"forms.list",
	"forms.get",
	"forms.create",
	"forms.update",
	"results.summary",
	"donations.list",
	"donors.list",
	"donors.get",
	"recurring.list",
	"donations.record",
	"photos.upload_link",
] as const;

/** Each block action the content release retired, and the action in its place. */
const REPLACED_BY: Record<string, string> = {
	"campaigns.update_blocks": "campaigns.update_content",
	"donation_page.update_blocks": "donation_page.update_content",
	"blocks.catalog": "content.catalog",
};

/** What Standalone's content release serves: every action but the block ones. */
export const CONTENT_ACTIONS = ALL_ACTIONS.filter(
	(action) => !Object.hasOwn(REPLACED_BY, action),
);

/** What Standalone served before its content release: the block actions, no content ones. */
export const BLOCK_ACTIONS = ALL_ACTIONS.filter(
	(action) => !Object.values(REPLACED_BY).includes(action),
);

/**
 * The thirteen tools a minimum deployment serves:
 * list_campaigns, get_campaign, get_donation_page, get_block_catalog,
 * list_forms, get_form, get_results, list_donations, list_donors, get_donor,
 * list_recurring_gifts, create_campaign, record_donation.
 */
export const MVP_ACTIONS = [
	"campaigns.list",
	"campaigns.get",
	"donation_page.get",
	"blocks.catalog",
	"forms.list",
	"forms.get",
	"results.summary",
	"donations.list",
	"donors.list",
	"donors.get",
	"recurring.list",
	"campaigns.create",
	"donations.record",
] as const satisfies readonly (typeof ALL_ACTIONS)[number][];

// Where Allow sends the browser back; fixed in the deployment's code.
export const RETURN_URL = "https://app.connect.better.giving/connect/return";

export type RecordedCall = {
	method: string;
	host: string;
	path: string;
	query: Record<string, string>;
	authorization: string | null;
	idempotencyKey: string | null;
	body: unknown;
};

export type Interceptor = (
	req: Request,
) => Response | undefined | Promise<Response | undefined>;

export type FakeDeployment = {
	origin: Origin;
	host: string;
	/** Reaches this host only; any other host fails like a DNS miss. */
	fetch: typeof fetch;
	/** Every request that reached this host, oldest first. */
	calls: RecordedCall[];
	/** Every key `/exchange` has handed out, oldest first, revoked ones included. */
	issuedKeys: string[];
	/** Revokes every key issued so far, as Disconnect does. */
	refuseKeys(): void;
	setRelease(release: string): void;
	setActions(actions: readonly string[]): void;
	/** The name `/exchange` returns. `/hello` keeps the name from construction. */
	setExchangeName(name: string): void;
	/** What pressing Allow mints: a single-use code for `/exchange`. */
	mintCode(): string;
	/** Answers ahead of the deployment while set; `undefined` falls through. */
	intercept(handler: Interceptor | null): void;
	/** The deployment itself, behind the network; `fakeNetwork` calls it. */
	handle(req: Request): Promise<Response>;
	/** The next `count` requests run, and then their answers are lost. */
	loseAnswers(count: number): void;
	/**
	 * Platform: the next `count` keyed form creates find an earlier try under
	 * their key still running and answer `idempotency_in_progress`; the try
	 * after that finds it finished and gets its replay.
	 */
	stallCreates(count?: number): void;
	/** Platform: the Retry-After an in-progress create answers with, in seconds. */
	setRetryAfter(seconds: string): void;
	/**
	 * Platform: the operator uploads a photo through a link, which becomes its
	 * campaign's hero. The stored photo's address, or null for a link that is
	 * spent, expired or unknown.
	 */
	uploadPhoto(link: string): string | null;
};

/** An interceptor that never answers, rejecting only when the request is aborted. */
export const hang: Interceptor = (req) =>
	new Promise((_, reject) => {
		req.signal.addEventListener("abort", () => reject(req.signal.reason));
	});

/**
 * One `fetch` for several fakes, routed by host. Redirects behave as fetch's do:
 * "error" fails, "manual" hands back the 3xx, "follow" follows and drops
 * Authorization on a cross-origin hop.
 */
export function fakeNetwork(...deployments: FakeDeployment[]): typeof fetch {
	const route = (req: Request) => {
		const target = deployments.find((d) => d.host === new URL(req.url).host);
		if (!target) throw new TypeError("fetch failed");
		return target.handle(req);
	};
	return async (input, init) => {
		let req = new Request(input, init);
		const body = req.body ? await req.clone().text() : undefined;
		for (let hop = 0; ; hop++) {
			const res = await route(req);
			const location = res.headers.get("location");
			if (
				res.status < 300 ||
				res.status >= 400 ||
				!location ||
				req.redirect === "manual"
			) {
				return res;
			}
			if (req.redirect === "error" || hop === 20)
				throw new TypeError("fetch failed");
			const next = new URL(location, req.url);
			const headers = new Headers(req.headers);
			if (next.origin !== new URL(req.url).origin)
				headers.delete("authorization");
			const asGet =
				res.status === 303 ||
				((res.status === 301 || res.status === 302) && req.method === "POST");
			req = new Request(next, {
				method: asGet ? "GET" : req.method,
				headers,
				body: asGet ? undefined : body,
				redirect: req.redirect,
				signal: req.signal,
			});
		}
	};
}

export function fakeDeployment(
	opts: { host?: string; name?: string; platform?: boolean } = {},
): FakeDeployment {
	const host = opts.host ?? "give.example.org";
	const state = newState(
		host,
		opts.name ?? "Give Example",
		opts.platform ?? false,
	);
	const calls: RecordedCall[] = [];
	let interceptor: Interceptor | null = null;
	const app = deploymentApp(state);

	async function handle(req: Request): Promise<Response> {
		calls.push(await record(req));
		const res = (await interceptor?.(req)) ?? (await app.fetch(req));
		if (state.lose > 0) {
			state.lose--;
			throw new TypeError("fetch failed");
		}
		return res;
	}

	const fake: FakeDeployment = {
		origin: `https://${host}` as Origin,
		host,
		fetch: (input, init) => fakeNetwork(fake)(input, init),
		calls,
		issuedKeys: state.issued,
		refuseKeys: () => state.keys.clear(),
		setRelease: (release) => {
			state.release = release;
		},
		setActions: (actions) => {
			state.actions = new Set(actions);
		},
		setExchangeName: (name) => {
			state.exchangeName = name;
		},
		mintCode: () => mintCode(state),
		intercept: (handler) => {
			interceptor = handler;
		},
		handle,
		loseAnswers: (count) => {
			state.lose = count;
		},
		stallCreates: (count = Number.POSITIVE_INFINITY) => {
			state.stall = count;
		},
		setRetryAfter: (seconds) => {
			state.retryAfter = seconds;
		},
		uploadPhoto: (link) => uploadPhoto(state, link),
	};
	return fake;
}

async function record(req: Request): Promise<RecordedCall> {
	const url = new URL(req.url);
	const text = await req.clone().text();
	let body: unknown = null;
	if (text !== "") {
		try {
			body = JSON.parse(text);
		} catch {
			body = text;
		}
	}
	return {
		method: req.method,
		host: url.host,
		path: url.pathname,
		query: Object.fromEntries(url.searchParams),
		authorization: req.headers.get("authorization"),
		idempotencyKey: req.headers.get("idempotency-key"),
		body,
	};
}

type Money = { amount: string; currency: "USD" };
type CampaignStatus = "draft" | "published" | "ended";
type Block = { type: string } & Record<string, unknown>;
type Content = Record<string, unknown>;
type Campaign = {
	id: string;
	title: string;
	status: CampaignStatus;
	blocks: Block[];
	content: Content;
	everPublished: boolean;
	settings: {
		goal: Money | null;
		end_date: string | null;
		time_zone: string | null;
		sharing: { message: string | null; channels: string[] | null };
	};
	created_at: string;
	/** Platform's: bumped on every write, shown as a string. */
	version: number;
	story: string;
	hero: string | null;
	/** Platform: the photos uploaded through this campaign's links. */
	uploads: string[];
	giftsGoTo?: string | null;
};
type Form = { id: string; campaign_id: string | null } & Record<
	string,
	unknown
>;
type Donor = { id: string; name: string; email: string | null };
type Donation = {
	id: string;
	amount: Money;
	date: string;
	donor_id: string;
	campaign_id: string | null;
	method: string;
	note: string | null;
};
type Recurring = {
	id: string;
	donor_id: string;
	amount: Money;
	interval: "month";
	status: "active";
	next_date: string;
};

type State = ReturnType<typeof newState>;

function newState(host: string, name: string, platform: boolean) {
	const formId = "frm_1";
	return {
		host,
		name,
		exchangeName: name,
		platform,
		release: platform ? "0f3c2a1" : "1.0.0",
		actions: new Set<string>(
			platform ? Object.values(PLATFORM_ACTION_OF) : ALL_ACTIONS,
		),
		keys: new Set<string>(),
		issued: [] as string[],
		// Allow codes not yet redeemed, with when each lapses
		codes: new Map<string, number>(),
		seq: 1,
		campaigns: new Map<string, Campaign>(),
		forms: new Map<string, Form>([
			[
				formId,
				{
					id: formId,
					name: "Default form",
					amounts: ["25.00", "50.00", "100.00"],
					currency: "USD",
					allow_recurring: true,
					campaign_id: null,
					...(platform && {
						status: "live",
						updated_at: "2026-10-01T00:00:00.000Z",
					}),
				},
			],
		]),
		donationPage: {
			blocks: startingBlocks(formId),
			content: { heading: "" } as Content,
		},
		donors: new Map<string, Donor>(),
		donations: new Map<string, Donation>(),
		recurring: [] as Recurring[],
		idempotency: new Map<string, { fingerprint: string; body: unknown }>(),
		// Platform's create_form claims: pending while an attempt runs.
		formClaims: new Map<
			string,
			{ fingerprint: string; pending: boolean; body: unknown }
		>(),
		photoLinks: new Map<
			string,
			{ campaignId: string; expiresAt: number; used: boolean }
		>(),
		lose: 0,
		stall: 0,
		retryAfter: "5",
	};
}

/** Platform's `PHOTO_LINK_TTL_MS`. */
const PHOTO_LINK_TTL_MS = 15 * 60_000;
/** Where Platform's blob store keeps an uploaded photo. */
const PHOTO_STORE = "https://store.example.com/u";

function uploadPhoto(state: State, link: string): string | null {
	const token = new URL(link).pathname.split("/").at(-1) ?? "";
	const found = state.photoLinks.get(token);
	if (!found || found.used || Date.now() >= found.expiresAt) return null;
	found.used = true;
	const k = state.campaigns.get(found.campaignId);
	if (!k || k.status === "ended") return null;
	const url = `${PHOTO_STORE}/${crypto.randomUUID()}.jpg`;
	k.uploads.push(url);
	k.hero = url;
	k.version++;
	return url;
}

const CODE_TTL_MS = 10 * 60_000;

function mintCode(state: State): string {
	const code = crypto.randomUUID();
	state.codes.set(code, Date.now() + CODE_TTL_MS);
	return code;
}

// Single-use: a redeemed code is gone whether or not it was still good.
function redeemCode(state: State, code: string): boolean {
	const lapsesAt = state.codes.get(code);
	state.codes.delete(code);
	return lapsesAt !== undefined && Date.now() < lapsesAt;
}

function startingBlocks(formId: string): Block[] {
	return [
		{ type: "hero", heading: "Support our work", subheading: null },
		{ type: "goal_meter" },
		{ type: "donate_form", form_id: formId },
	];
}

const CATALOG = [
	{
		type: "hero",
		description:
			"Large heading at the top of the page, with an optional photo.",
		schema: {
			type: "object",
			required: ["heading"],
			properties: {
				heading: { type: "string" },
				subheading: { type: ["string", "null"] },
				image_url: { type: ["string", "null"], format: "uri" },
			},
		},
	},
	{
		type: "text",
		description: "A paragraph of story text.",
		schema: {
			type: "object",
			required: ["body"],
			properties: { body: { type: "string" } },
		},
	},
	{
		type: "goal_meter",
		description: "Progress toward the campaign goal.",
		schema: { type: "object", properties: {} },
	},
	{
		type: "donate_form",
		description: "The donation form.",
		schema: {
			type: "object",
			required: ["form_id"],
			properties: { form_id: { type: "string" } },
		},
	},
];
const BLOCK_TYPES = new Set(CATALOG.map((b) => b.type));

// Standalone's content rules (packages/app/src/lib/page/catalog.ts and
// shape.ts): a campaign holds every key, the donation page its heading alone.
const PHOTOS_MAX = 8;
const STORY_THRESHOLD = 320;
const FEATURE_EXTRAS = 4;
const richText = z.record(z.string(), z.unknown());
const photo = z.strictObject({
	imageId: z.uuid(),
	alt: z.string().nullable(),
});
const CONTENT_RULES = {
	heading: z.string(),
	lede: z.string(),
	story: richText,
	hero: photo,
	photos: z.array(photo).max(PHOTOS_MAX),
	tiers: z
		.array(
			z.strictObject({ amountMinor: z.int().positive(), buys: z.string() }),
		)
		.max(6),
	faq: z
		.array(z.strictObject({ question: z.string(), answer: richText }))
		.max(10),
} as const;
const CONTENT_KEYS = Object.keys(CONTENT_RULES);
const CONTENT_DESCRIPTIONS: Record<string, string> = {
	heading: "The page's title.",
	lede: "A sentence or two under the title; a campaign only.",
	story: "The story behind the appeal, in rich text; a campaign only.",
	hero: "The cover photo; a campaign only.",
	photos: "Photos beside the cover; a campaign only.",
	tiers: "Up to six gift amounts, each with what it buys; a campaign only.",
	faq: "Up to ten questions donors ask, each with its answer; a campaign only.",
};
const CONTENT_CATALOG = {
	content: CONTENT_KEYS.map((key) => ({
		key,
		description: CONTENT_DESCRIPTIONS[key],
		schema: z.toJSONSchema(CONTENT_RULES[key as keyof typeof CONTENT_RULES], {
			io: "input",
		}),
	})),
	layout: {
		description: `A campaign is drawn in one of three layouts, picked from its content and never set: the card for a story of at most ${STORY_THRESHOLD} characters and nothing else; the letter for a longer story, or one to ${FEATURE_EXTRAS - 1} tiers, questions and photos beside the cover counted together; the feature for ${FEATURE_EXTRAS} or more. The donation page has one fixed layout.`,
		story_threshold: STORY_THRESHOLD,
		feature_extras: FEATURE_EXTRAS,
	},
};
const NOT_CONTENT =
	"the page picks its whole layout from its content: a short story with nothing else is a card; a longer story, or one to three tiers, questions and photos, is a letter; four or more is a feature. no layout, look, colour, block, order or share button is set, so send content keys only";
const SETTINGS_KEYS = ["goal", "end_date", "time_zone", "sharing"];

const textLength = (node: unknown): number => {
	if (typeof node !== "object" || node === null) return 0;
	const { text, content } = node as { text?: unknown; content?: unknown };
	return (
		(typeof text === "string" ? text.length : 0) +
		(Array.isArray(content)
			? content.reduce((n: number, child) => n + textLength(child), 0)
			: 0)
	);
};

/** The layout Standalone picks for a campaign's content. */
function layoutOf(content: Content): "card" | "letter" | "feature" {
	const count = (key: string) =>
		Array.isArray(content[key]) ? (content[key] as unknown[]).length : 0;
	const extras = count("tiers") + count("faq") + count("photos");
	if (extras >= FEATURE_EXTRAS) return "feature";
	if (extras > 0 || textLength(content.story) > STORY_THRESHOLD)
		return "letter";
	return "card";
}

type Refusal = { path: string; message: string };

/** A content body's refusal, as Standalone's `contentEdit` words it, or null. */
function contentRefusal(
	body: unknown,
	keys: readonly string[],
): Refusal | null {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return {
			path: "",
			message: `the body is a JSON object of content keys: ${keys.join(", ")}`,
		};
	}
	const unknown = Object.keys(body).find((key) => !keys.includes(key));
	if (unknown !== undefined) {
		return {
			path: unknown,
			message: CONTENT_KEYS.includes(unknown)
				? `the donation page holds no ${unknown}; it draws one fixed layout and its content is its heading alone`
				: `${JSON.stringify(unknown)} is not content; ${NOT_CONTENT}`,
		};
	}
	if (Object.keys(body).length === 0) {
		return {
			path: "",
			message: `send at least one content key: ${keys.join(", ")}; a key left out is left alone`,
		};
	}
	for (const [key, value] of Object.entries(body)) {
		if (value === null) continue;
		const checked =
			CONTENT_RULES[key as keyof typeof CONTENT_RULES].safeParse(value);
		const issue = checked.error?.issues[0];
		if (issue) {
			return { path: [key, ...issue.path].join("."), message: issue.message };
		}
	}
	return null;
}

/** `content` with each key `body` names written over it; null clears one. */
function withContent(content: Content, body: Record<string, unknown>) {
	const next = { ...content };
	for (const [key, value] of Object.entries(body)) {
		if (value !== null) next[key] = value;
		else if (key === "heading") next.heading = "";
		else delete next[key];
	}
	return next;
}

/** A photo link's slot, as Standalone's `parseSlot` reads it. */
const SLOT = /^(cover|new|0|[1-9][0-9]?)$/;

/** Whether a photo for `slot` would add one more beside the cover. */
function addsPhoto(content: Content, slot: string | undefined): boolean {
	const photos = Array.isArray(content.photos) ? content.photos.length : 0;
	if (slot === "cover") return false;
	if (slot === "new") return true;
	if (slot !== undefined && Number(slot) < photos) return false;
	return content.hero !== undefined;
}

/** A settings body's refusal on the content release, or null. */
function settingsRefusal(body: unknown): Refusal | null {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return {
			path: "",
			message: `the body is a JSON object of ${SETTINGS_KEYS.join(", ")}`,
		};
	}
	const unset = Object.keys(body).find((key) => !SETTINGS_KEYS.includes(key));
	if (unset !== undefined) {
		return {
			path: unset,
			message: `${JSON.stringify(unset)} is not a setting; the settings are ${SETTINGS_KEYS.join(", ")}, content goes through campaigns.update_content, and the page picks its layout from its content, so no layout, look, colour or block is set`,
		};
	}
	const { sharing } = body as { sharing?: unknown };
	if (sharing === undefined) return null;
	if (typeof sharing !== "object" || sharing === null || Array.isArray(sharing))
		return {
			path: "sharing",
			message:
				'sharing is { "message": "<what a share says>" }, or { "message": null } for none',
		};
	const other = Object.keys(sharing).find((key) => key !== "message");
	if (other === "channels")
		return {
			path: "sharing.channels",
			message:
				"every page offers the same share buttons, Copy link, Email, Facebook and WhatsApp, and none is chosen; send sharing.message only",
		};
	if (other !== undefined)
		return {
			path: `sharing.${other}`,
			message: "sharing holds message alone; send sharing.message only",
		};
	return null;
}

const money = z.object({
	amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
	currency: z.literal("USD"),
});
const date = z.iso.date();
const blocks = z.object({
	blocks: z.array(
		z
			.object({
				type: z
					.string()
					.refine((t) => BLOCK_TYPES.has(t), "unknown block type"),
			})
			.loose(),
	),
});
const bodies = {
	createCampaign: z.object({ title: z.string().trim().min(1).max(120) }),
	settings: z.object({
		goal: money.nullable().optional(),
		end_date: date.nullable().optional(),
		time_zone: z.string().nullable().optional(),
		sharing: z
			.object({
				message: z.string().nullable().optional(),
				channels: z.array(z.string()).nullable().optional(),
			})
			.nullable()
			.optional(),
	}),
	createForm: z.object({ name: z.string().trim().min(1) }).loose(),
	updateForm: z.object({ name: z.string().trim().min(1).optional() }).loose(),
	recordDonation: z.object({
		amount: money,
		date,
		donor: z.object({
			name: z.string().trim().min(1),
			email: z.email().optional(),
		}),
		method: z.enum(["cash", "check"]),
		note: z.string().trim().max(MAX_NOTE).optional(),
	}),
	uploadLink: z.object({
		target: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("campaign"), id: z.string() }),
			z.object({ kind: z.literal("donation_page") }),
		]),
		slot: z.string().optional(),
	}),
};

function problem(
	c: Context,
	status: ContentfulStatusCode,
	code: string,
	detail: string,
	errors?: { path: string; message: string }[],
	headers: Record<string, string> = {},
) {
	const body = {
		type: `https://better.giving/connector/problems/${code}`,
		title: code,
		status,
		detail,
		code,
		errors,
	};
	return c.body(JSON.stringify(body), status, {
		"content-type": "application/problem+json",
		...headers,
	});
}

/** Standalone's `invalid`: a 422 naming the one field it refuses. */
const invalid = (c: Context, { path, message }: Refusal) =>
	problem(c, 422, "invalid", message, [{ path, message }]);

async function parse<T extends z.ZodType>(
	c: Context,
	schema: T,
): Promise<{ ok: true; data: z.output<T> } | { ok: false; res: Response }> {
	const raw: unknown = await c.req.json().catch(() => undefined);
	const parsed = schema.safeParse(raw);
	if (parsed.success) return { ok: true, data: parsed.data };
	// Assumption pending the contract: it names `errors: [{ path, message }]`
	// and no status or path syntax. 422 and dotted paths are this fake's own.
	const errors = parsed.error.issues.map((i) => ({
		path: i.path.join("."),
		message: i.message,
	}));
	return {
		ok: false,
		res: problem(
			c,
			422,
			"validation_failed",
			"The request body is invalid.",
			errors,
		),
	};
}

function page<T>(c: Context, items: T[]) {
	const start = Number(c.req.query("cursor") ?? 0) || 0;
	const limit = Math.min(Math.max(Number(c.req.query("limit")) || 25, 1), 100);
	const end = start + limit;
	return c.json({
		data: items.slice(start, end),
		next_cursor: end < items.length ? String(end) : null,
	});
}

const toCents = (m: Money) => Math.round(Number(m.amount) * 100);
const fromCents = (cents: number): Money => ({
	amount: (cents / 100).toFixed(2),
	currency: "USD",
});
const sum = (ds: Donation[]) =>
	fromCents(ds.reduce((n, d) => n + toCents(d.amount), 0));

function deploymentApp(state: State) {
	const nextId = (prefix: string) => `${prefix}_${state.seq++}`;
	const publicUrl = (path: string) => `https://${state.host}${path}`;
	// The content release: no block action served, and their replacements are.
	const contentRelease = () =>
		Object.entries(REPLACED_BY).every(
			([retired, replacement]) =>
				!state.actions.has(retired) && state.actions.has(replacement),
		);
	const campaignView = (k: Campaign) => {
		const { blocks, content, ...rest } = k;
		const view: Record<string, unknown> = {
			...rest,
			public_url: publicUrl(`/campaigns/${k.id}`),
		};
		if (!contentRelease()) view.blocks = blocks;
		if (state.actions.has("campaigns.update_content")) {
			view.layout = layoutOf(content);
			view.content = content;
		}
		if (state.platform) {
			view.blocks = platformBlocks(k);
			view.version = String(k.version);
		}
		if (contentRelease()) {
			view.settings = {
				...k.settings,
				sharing: { message: k.settings.sharing.message },
			};
		}
		return view;
	};
	const idempotencySlot = (c: Context) => {
		const key = c.req.header("idempotency-key");
		return key ? `${new URL(c.req.url).pathname}\n${key}` : null;
	};
	const replay = (c: Context, raw: unknown): Response | null => {
		const slot = idempotencySlot(c);
		if (!slot) return null;
		const prior = state.idempotency.get(slot);
		if (!prior) return null;
		if (prior.fingerprint !== JSON.stringify(raw)) {
			return problem(
				c,
				409,
				"idempotency_conflict",
				"This Idempotency-Key already recorded a different request, so this one was not recorded.",
			);
		}
		return c.json(prior.body, 200);
	};
	const remember = (c: Context, raw: unknown, body: unknown) => {
		const slot = idempotencySlot(c);
		if (slot) {
			state.idempotency.set(slot, {
				fingerprint: JSON.stringify(raw),
				body,
			});
		}
	};
	const donorView = (d: Donor) => {
		const gifts = [...state.donations.values()].filter(
			(g) => g.donor_id === d.id,
		);
		return { ...d, total: sum(gifts), gift_count: gifts.length };
	};
	const inRange = (d: Donation, from?: string, to?: string) =>
		(!from || d.date >= from) && (!to || d.date <= to);

	const action =
		(name: string): MiddlewareHandler =>
		async (c, next) => {
			const replacement = REPLACED_BY[name];
			if (
				!state.actions.has(name) &&
				replacement !== undefined &&
				contentRelease()
			) {
				return problem(
					c,
					422,
					"replaced",
					`${name} is no longer served: the page now picks its layout from its content. Use ${replacement} instead.`,
				);
			}
			if (!state.actions.has(name)) {
				return problem(
					c,
					404,
					"unknown_action",
					`This release has no ${name}.`,
				);
			}
			await next();
		};

	const findCampaign = (c: Context) => {
		const k = state.campaigns.get(c.req.param("id") ?? "");
		return k ?? problem(c, 404, "not_found", "No campaign has that id.");
	};
	const transition = (
		name: string,
		from: CampaignStatus[],
		to: CampaignStatus,
	) =>
		[
			action(name),
			(c: Context) => {
				const k = findCampaign(c);
				if (k instanceof Response) return k;
				// Assumption pending the contract: it names no status for a refused
				// transition. 409 `invalid_state` is this fake's own.
				if (!from.includes(k.status)) {
					return problem(
						c,
						409,
						"invalid_state",
						`A ${k.status} campaign cannot do that.`,
					);
				}
				k.status = to;
				return c.json(campaignView(k));
			},
		] as const;

	const app = new Hono();

	// Stands in for a signed-in operator pressing Allow, or Deny with `press=deny`.
	app.get("/admin/connector/allow", (c) => {
		const back = new URL(RETURN_URL);
		back.searchParams.set("state", c.req.query("state") ?? "");
		back.searchParams.set("iss", `https://${state.host}`);
		if (c.req.query("press") === "deny") {
			back.searchParams.set("error", "access_denied");
		} else {
			back.searchParams.set("code", mintCode(state));
		}
		return c.redirect(back.href, 302);
	});

	const v1 = new Hono();

	// Registered ahead of the key check below, which therefore never runs for them.
	v1.use("/hello", async (c, next) => {
		if (c.req.method === "GET") return next();
		return problem(
			c,
			404,
			"unknown_action",
			"This release has no such action.",
		);
	});
	v1.get("/hello", (c) =>
		c.json({
			service: "better-giving",
			contract: 1,
			release: state.release,
			name: state.name,
			actions: state.platform
				? [
						"hello",
						"exchange",
						"disconnect",
						...Object.keys(PLATFORM_ACTION_OF).filter((tool) =>
							state.actions.has(PLATFORM_ACTION_OF[tool] as string),
						),
					]
				: [...state.actions],
		}),
	);
	v1.use("/exchange", async (c, next) => {
		if (c.req.method === "POST") return next();
		return problem(
			c,
			404,
			"unknown_action",
			"This release has no such action.",
		);
	});
	v1.post("/exchange", async (c) => {
		const body: unknown = await c.req.json().catch(() => undefined);
		const code = z.object({ code: z.string() }).safeParse(body).data?.code;
		if (!code || !redeemCode(state, code)) {
			return problem(
				c,
				400,
				"code_invalid",
				"That code is used, expired or unknown.",
			);
		}
		const key = `bgk_${crypto.randomUUID()}`;
		state.keys.add(key);
		state.issued.push(key);
		return c.json({ key, name: state.exchangeName });
	});

	v1.use(async (c, next) => {
		const [scheme, key] = (c.req.header("authorization") ?? "").split(" ");
		if (scheme !== "Bearer" || !key || !state.keys.has(key)) {
			return problem(
				c,
				401,
				"key_refused",
				"This connector key is not accepted.",
			);
		}
		await next();
	});

	v1.post("/disconnect", (c) => {
		const [, key] = (c.req.header("authorization") ?? "").split(" ");
		state.keys.delete(key ?? "");
		return c.body(null, 204);
	});

	if (state.platform) platformWrites(v1, state, { action, campaignView });

	v1.get("/campaigns", action("campaigns.list"), (c) => {
		const status = c.req.query("status");
		const all = [...state.campaigns.values()].filter(
			(k) => !status || k.status === status,
		);
		return page(
			c,
			all.map((k) => {
				const { id, title, status, public_url } = campaignView(k);
				return { id, title, status, public_url };
			}),
		);
	});
	v1.post("/campaigns", action("campaigns.create"), async (c) => {
		const raw: unknown = await c.req.json().catch(() => undefined);
		const again = replay(c, raw);
		if (again) return again;
		const parsed = bodies.createCampaign.safeParse(raw);
		if (!parsed.success) {
			const errors = parsed.error.issues.map((i) => ({
				path: i.path.join("."),
				message: i.message,
			}));
			return problem(
				c,
				422,
				"validation_failed",
				"The request body is invalid.",
				errors,
			);
		}
		const id = nextId("cmp");
		const form: Form = {
			id: nextId("frm"),
			name: `${parsed.data.title} form`,
			amounts: ["25.00", "50.00", "100.00"],
			currency: "USD",
			allow_recurring: true,
			campaign_id: id,
		};
		state.forms.set(form.id, form);
		const k: Campaign = {
			id,
			title: parsed.data.title,
			status: "draft",
			everPublished: false,
			blocks: startingBlocks(form.id),
			content: { heading: "" },
			settings: {
				goal: null,
				end_date: null,
				time_zone: null,
				sharing: { message: null, channels: null },
			},
			created_at: new Date().toISOString(),
			version: 1,
			story: "",
			hero: null,
			uploads: [],
		};
		state.campaigns.set(id, k);
		const view = campaignView(k);
		remember(c, raw, view);
		return c.json(view, 201);
	});
	v1.get("/campaigns/:id", action("campaigns.get"), (c) => {
		const k = findCampaign(c);
		return k instanceof Response ? k : c.json(campaignView(k));
	});
	v1.patch(
		"/campaigns/:id/blocks",
		action("campaigns.update_blocks"),
		async (c) => {
			const k = findCampaign(c);
			if (k instanceof Response) return k;
			const body = await parse(c, blocks);
			if (!body.ok) return body.res;
			k.blocks = body.data.blocks;
			return c.json(campaignView(k));
		},
	);
	v1.patch(
		"/campaigns/:id/content",
		action("campaigns.update_content"),
		async (c) => {
			const k = findCampaign(c);
			if (k instanceof Response) return k;
			const raw: unknown = await c.req.json().catch(() => undefined);
			const refused = contentRefusal(raw, CONTENT_KEYS);
			if (refused) return invalid(c, refused);
			k.content = withContent(k.content, raw as Record<string, unknown>);
			return c.json(campaignView(k));
		},
	);
	v1.patch(
		"/campaigns/:id/settings",
		action("campaigns.update_settings"),
		async (c) => {
			const k = findCampaign(c);
			if (k instanceof Response) return k;
			if (contentRelease()) {
				const raw: unknown = await c.req.raw
					.clone()
					.json()
					.catch(() => undefined);
				const refused = settingsRefusal(raw);
				if (refused) return invalid(c, refused);
			}
			const body = await parse(c, bodies.settings);
			if (!body.ok) return body.res;
			const { goal, end_date, time_zone, sharing } = body.data;
			if (goal !== undefined) k.settings.goal = goal;
			if (end_date !== undefined) k.settings.end_date = end_date;
			if (time_zone !== undefined) k.settings.time_zone = time_zone;
			if (sharing === null) {
				k.settings.sharing = { message: null, channels: null };
			} else if (sharing) {
				if (sharing.message !== undefined)
					k.settings.sharing.message = sharing.message;
				if (sharing.channels !== undefined)
					k.settings.sharing.channels = sharing.channels;
			}
			return c.json(campaignView(k));
		},
	);
	v1.post("/campaigns/:id/publish", action("campaigns.publish"), async (c) => {
		const k = findCampaign(c);
		if (k instanceof Response) return k;
		if (k.status !== "draft") {
			return problem(
				c,
				409,
				"invalid_state",
				`A ${k.status} campaign cannot do that.`,
			);
		}
		const raw: unknown = await c.req.json().catch(() => undefined);
		const gifts =
			typeof raw === "object" && raw !== null
				? (raw as { gifts_go_to?: unknown }).gifts_go_to
				: undefined;
		if (!k.everPublished && gifts === undefined) {
			return problem(
				c,
				422,
				"invalid",
				"A campaign's first publish says where its gifts go.",
				[
					{
						path: "gifts_go_to",
						message:
							"is a program id, or null for the general fund; ask the operator",
					},
				],
			);
		}
		if (k.everPublished && gifts !== undefined) {
			return problem(
				c,
				422,
				"invalid",
				"Where gifts go is answered at a campaign's first publish only.",
				[
					{
						path: "gifts_go_to",
						message: "is left out once a campaign has been published",
					},
				],
			);
		}
		if (gifts !== undefined && gifts !== null && typeof gifts !== "string") {
			return problem(
				c,
				422,
				"invalid",
				"gifts_go_to is a program id or null.",
				[{ path: "gifts_go_to", message: "is a string or null" }],
			);
		}
		k.everPublished = true;
		k.status = "published";
		return c.json(campaignView(k));
	});
	v1.post(
		"/campaigns/:id/end",
		...transition("campaigns.end", ["draft", "published"], "ended"),
	);

	const pageView = () => {
		const { blocks, content } = state.donationPage;
		return {
			...(contentRelease() ? {} : { blocks }),
			...(state.actions.has("donation_page.update_content") ? { content } : {}),
			public_url: publicUrl("/donate"),
		};
	};
	v1.get("/donation-page", action("donation_page.get"), (c) =>
		c.json(pageView()),
	);
	v1.patch(
		"/donation-page/blocks",
		action("donation_page.update_blocks"),
		async (c) => {
			const body = await parse(c, blocks);
			if (!body.ok) return body.res;
			state.donationPage.blocks = body.data.blocks;
			return c.json(pageView());
		},
	);
	v1.patch(
		"/donation-page/content",
		action("donation_page.update_content"),
		async (c) => {
			const raw: unknown = await c.req.json().catch(() => undefined);
			const refused = contentRefusal(raw, ["heading"]);
			if (refused) return invalid(c, refused);
			state.donationPage.content = withContent(
				state.donationPage.content,
				raw as Record<string, unknown>,
			);
			return c.json(pageView());
		},
	);
	v1.post("/donation-page/reset", action("donation_page.reset"), async (c) => {
		const raw: unknown = await c.req.json().catch(() => undefined);
		const confirm =
			typeof raw === "object" && raw !== null
				? (raw as { confirm?: unknown }).confirm
				: undefined;
		if (confirm !== true) {
			return problem(
				c,
				422,
				"invalid",
				"Reset replaces the live donation page. Nothing was reset.",
				[{ path: "confirm", message: "is true, once the operator agrees" }],
			);
		}
		state.donationPage.blocks = startingBlocks("frm_1");
		state.donationPage.content = { heading: "" };
		return c.json(pageView());
	});
	v1.get("/blocks/catalog", action("blocks.catalog"), (c) =>
		c.json({ blocks: CATALOG }),
	);
	v1.get("/content/catalog", action("content.catalog"), (c) =>
		c.json(CONTENT_CATALOG),
	);

	const findForm = (c: Context) =>
		state.forms.get(c.req.param("id") ?? "") ??
		problem(c, 404, "not_found", "No form has that id.");
	v1.get("/forms", action("forms.list"), (c) =>
		page(c, [...state.forms.values()]),
	);
	v1.get("/forms/:id", action("forms.get"), (c) => {
		const f = findForm(c);
		return f instanceof Response ? f : c.json(f);
	});
	v1.post("/forms", action("forms.create"), async (c) => {
		const body = await parse(c, bodies.createForm);
		if (!body.ok) return body.res;
		const f: Form = {
			amounts: [],
			currency: "USD",
			allow_recurring: false,
			...body.data,
			id: nextId("frm"),
			campaign_id: null,
		};
		state.forms.set(f.id, f);
		return c.json(f, 201);
	});
	v1.patch("/forms/:id", action("forms.update"), async (c) => {
		const f = findForm(c);
		if (f instanceof Response) return f;
		const body = await parse(c, bodies.updateForm);
		if (!body.ok) return body.res;
		Object.assign(f, body.data, { id: f.id });
		return c.json(f);
	});

	v1.get("/results", action("results.summary"), (c) => {
		const { campaign_id, from, to } = c.req.query();
		const gifts = [...state.donations.values()].filter(
			(d) =>
				(!campaign_id || d.campaign_id === campaign_id) && inRange(d, from, to),
		);
		return c.json({
			total: sum(gifts),
			gift_count: gifts.length,
			donor_count: new Set(gifts.map((d) => d.donor_id)).size,
			campaigns: [...state.campaigns.values()]
				.filter((k) => !campaign_id || k.id === campaign_id)
				.map((k) => ({
					id: k.id,
					title: k.title,
					total: sum(gifts.filter((d) => d.campaign_id === k.id)),
				})),
		});
	});
	v1.get("/donations", action("donations.list"), (c) => {
		const { campaign_id, from, to } = c.req.query();
		return page(
			c,
			[...state.donations.values()].filter(
				(d) =>
					(!campaign_id || d.campaign_id === campaign_id) &&
					inRange(d, from, to),
			),
		);
	});
	v1.post("/donations", action("donations.record"), async (c) => {
		const raw: unknown = await c.req.json().catch(() => undefined);
		const again = replay(c, raw);
		if (again) return again;
		if (
			typeof raw === "object" &&
			raw !== null &&
			"campaign_id" in raw &&
			(raw as { campaign_id?: unknown }).campaign_id !== undefined
		) {
			return problem(
				c,
				422,
				"invalid",
				"A hand-recorded gift is not tied to a campaign.",
				[
					{
						path: "campaign_id",
						message: "is left out: a hand-recorded gift counts toward none",
					},
				],
			);
		}
		const parsed = bodies.recordDonation.safeParse(raw);
		if (!parsed.success) {
			const errors = parsed.error.issues.map((i) => ({
				path: i.path.join("."),
				message: i.message,
			}));
			return problem(
				c,
				422,
				"validation_failed",
				"The request body is invalid.",
				errors,
			);
		}
		const { donor, note, ...rest } = parsed.data;
		const known = [...state.donors.values()].find((d) =>
			donor.email ? d.email === donor.email : d.name === donor.name,
		);
		const who = known ?? {
			id: nextId("dnr"),
			name: donor.name,
			email: donor.email ?? null,
		};
		state.donors.set(who.id, who);
		const gift: Donation = {
			...rest,
			id: nextId("don"),
			donor_id: who.id,
			campaign_id: null,
			note: note === undefined || note === "" ? null : note,
		};
		state.donations.set(gift.id, gift);
		remember(c, raw, gift);
		return c.json(gift, 201);
	});
	v1.get("/donors", action("donors.list"), (c) => {
		const q = c.req.query("q")?.toLowerCase();
		const hits = [...state.donors.values()].filter(
			(d) =>
				!q ||
				d.name.toLowerCase().includes(q) ||
				d.email?.toLowerCase().includes(q),
		);
		return page(c, hits.map(donorView));
	});
	v1.get("/donors/:id", action("donors.get"), (c) => {
		const d = state.donors.get(c.req.param("id"));
		if (!d) return problem(c, 404, "not_found", "No donor has that id.");
		const gifts = [...state.donations.values()].filter(
			(g) => g.donor_id === d.id,
		);
		const start = Number(c.req.query("cursor") ?? 0) || 0;
		const limit = Math.min(
			Math.max(Number(c.req.query("limit")) || 25, 1),
			100,
		);
		const end = start + limit;
		return c.json({
			...donorView(d),
			gifts: {
				data: gifts.slice(start, end),
				next_cursor: end < gifts.length ? String(end) : null,
			},
		});
	});
	v1.get("/recurring", action("recurring.list"), (c) =>
		page(c, state.recurring),
	);
	v1.post("/photos/upload-link", action("photos.upload_link"), async (c) => {
		const body = await parse(c, bodies.uploadLink);
		if (!body.ok) return body.res;
		const { target, slot } = body.data;
		if (target.kind === "campaign" && !state.campaigns.has(target.id)) {
			return problem(c, 404, "not_found", "No campaign has that id.");
		}
		if (contentRelease()) {
			if (target.kind === "donation_page") {
				return problem(
					c,
					422,
					"invalid",
					"The donation page holds no photos: it draws one fixed layout. A photo goes on a campaign, as its cover or beside it.",
				);
			}
			if (slot !== undefined && !SLOT.test(slot)) {
				return problem(
					c,
					422,
					"invalid",
					'slot is "cover" for the cover photo, "new" for a photo after the rest, or the place of a photo beside the cover to replace, "0" for the first; leave it out to fill the cover where there is none, or add a photo after the rest.',
				);
			}
			const { content } = state.campaigns.get(target.id) as Campaign;
			const photos = Array.isArray(content.photos) ? content.photos.length : 0;
			if (addsPhoto(content, slot) && photos >= PHOTOS_MAX) {
				return problem(
					c,
					422,
					"invalid",
					`This campaign already holds ${PHOTOS_MAX} photos beside its cover, the most it can, so a new photo has no place. Ask the operator which photo it replaces, and make the link with that slot: "cover", or the place of a photo beside it, "0" for the first.`,
				);
			}
		}
		// Assumption pending the contract: it says "short-lived", not how short.
		return c.json({
			url: publicUrl(`/uploads/${crypto.randomUUID()}`),
			expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
		});
	});

	app.route("/connector/v1", v1);
	// A sub-app's notFound never runs under route(); this one covers both.
	app.notFound((c) =>
		c.req.path.startsWith("/connector/v1/")
			? problem(c, 404, "unknown_action", "This release has no such action.")
			: c.text("Not Found", 404),
	);
	return app;
}

/** A Platform campaign's page: its four blocks, in the order get_campaign shows them. */
function platformBlocks(k: Campaign): Block[] {
	return [
		{ type: "title", text: k.title },
		{ type: "story", text: k.story },
		{ type: "hero", image_url: k.hero },
		{ type: "goal-bar", goal: k.settings.goal },
	];
}

const PLATFORM_BLOCKS = ["title", "story", "hero", "goal-bar"] as const;
const PLATFORM_BLOCK_FIELD: Record<string, string> = {
	title: "text",
	story: "text",
	hero: "image_url",
	"goal-bar": "goal",
};
const HERO_MSG =
	"is null, or the link to a photo uploaded through create_photo_upload_link for this campaign";
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Platform's form fields, beside what get_form shows but this action can't move. */
const FORM_WRITABLE = [
	"name",
	"status",
	"suggested_amounts",
	"frequencies",
	"donate_methods",
	"gifts_go_to",
];
const FORM_ECHOES = [
	"id",
	"campaign_id",
	"updated_at",
	"minimum",
	"maximum",
	"allowed_origins",
];

type Issue = { path: string; message: string };

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (value: unknown): unknown =>
	Array.isArray(value)
		? value.map(sorted)
		: value !== null && typeof value === "object"
			? Object.fromEntries(
					Object.entries(value)
						.sort(([a], [b]) => (a < b ? -1 : 1))
						.map(([k, v]) => [k, sorted(v)]),
				)
			: value;

const isMoney = (value: unknown) => {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const { amount, currency, ...rest } = value as Record<string, unknown>;
	return (
		Object.keys(rest).length === 0 &&
		typeof amount === "string" &&
		AMOUNT.test(amount) &&
		Number(amount) > 0 &&
		currency === "USD"
	);
};

function platformWrites(
	v1: Hono,
	state: State,
	deps: {
		action: (name: string) => MiddlewareHandler;
		campaignView: (k: Campaign) => Record<string, unknown>;
	},
) {
	const { action, campaignView } = deps;
	const invalid = (c: Context, errors: Issue[]) =>
		problem(c, 422, "invalid", "The request is invalid.", errors);
	const missing = (c: Context, what: string, id: string) =>
		problem(
			c,
			404,
			"not_found",
			`${what} ${id} does not exist for this nonprofit.`,
		);
	const ended = (c: Context) =>
		problem(
			c,
			409,
			"campaign_ended",
			"This campaign has ended, and an ended campaign stays ended.",
		);
	const stale = (c: Context) =>
		problem(
			c,
			409,
			"stale_read",
			"This campaign changed after it was read. Read it again with get_campaign, then send the change against that version.",
		);
	const unknownKeys = (
		body: Record<string, unknown>,
		allowed: readonly string[],
		issues: Issue[],
	) => {
		for (const key of Object.keys(body)) {
			if (!allowed.includes(key))
				issues.push({ path: key, message: "is not a field on this action" });
		}
	};
	// The body as an object; with `allowEmpty`, no body at all reads as `{}`.
	const readBody = async (
		c: Context,
		allowEmpty = false,
	): Promise<Record<string, unknown> | Response> => {
		const text = await c.req.text();
		let parsed: unknown;
		try {
			parsed = allowEmpty && text.trim() === "" ? {} : JSON.parse(text);
		} catch {
			parsed = undefined;
		}
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
			return invalid(c, [{ path: "", message: "is a JSON object" }]);
		return parsed as Record<string, unknown>;
	};
	// undefined when left out, null when malformed (with the issue pushed).
	const readVersion = (body: Record<string, unknown>, issues: Issue[]) => {
		if (!Object.hasOwn(body, "expected_version")) return undefined;
		const v = body.expected_version;
		if (typeof v === "string" && /^\d{1,19}$/.test(v)) return v;
		issues.push({
			path: "expected_version",
			message: "is the version get_campaign returned, or left out",
		});
		return null;
	};
	const campaignOf = (c: Context) =>
		state.campaigns.get(c.req.param("id") ?? "") ??
		missing(c, "Campaign", c.req.param("id") ?? "");

	v1.patch(
		"/campaigns/:id/settings",
		action("campaigns.update_settings"),
		async (c) => {
			const k = campaignOf(c);
			if (k instanceof Response) return k;
			const body = await readBody(c);
			if (body instanceof Response) return body;
			const issues: Issue[] = [];
			unknownKeys(
				body,
				["goal", "end_date", "time_zone", "sharing", "expected_version"],
				issues,
			);
			const expected = readVersion(body, issues);
			for (const key of ["time_zone", "sharing"] as const) {
				if (Object.hasOwn(body, key) && !sameJson(body[key], k.settings[key]))
					issues.push({
						path: key,
						message: "is not supported on Better Giving",
					});
			}
			if (
				Object.hasOwn(body, "goal") &&
				body.goal !== null &&
				!isMoney(body.goal)
			) {
				issues.push({
					path: "goal",
					message: 'is {amount, currency: "USD"}, or null for no goal',
				});
			}
			const end = body.end_date;
			if (
				end !== undefined &&
				end !== null &&
				!(typeof end === "string" && DAY.test(end))
			) {
				issues.push({
					path: "end_date",
					message: "is a day written YYYY-MM-DD, today or later, or null",
				});
			}
			if (issues.length > 0) return invalid(c, issues);
			if (k.status === "ended") return ended(c);
			if (expected !== undefined && expected !== String(k.version))
				return stale(c);
			const before = JSON.stringify(k.settings);
			if (Object.hasOwn(body, "goal"))
				k.settings.goal = body.goal as Money | null;
			if (end !== undefined) k.settings.end_date = end as string | null;
			if (JSON.stringify(k.settings) !== before) k.version++;
			return c.json(campaignView(k));
		},
	);

	v1.patch(
		"/campaigns/:id/blocks",
		action("campaigns.update_blocks"),
		async (c) => {
			const k = campaignOf(c);
			if (k instanceof Response) return k;
			const body = await readBody(c);
			if (body instanceof Response) return body;
			const issues: Issue[] = [];
			unknownKeys(body, ["blocks", "expected_version"], issues);
			const expected = readVersion(body, issues);
			const sent = body.blocks;
			const next = {
				title: k.title,
				story: k.story,
				hero: k.hero,
				goal: k.settings.goal,
			};
			if (!Array.isArray(sent) || sent.length !== PLATFORM_BLOCKS.length) {
				issues.push({
					path: "blocks",
					message: `is the campaign's ${PLATFORM_BLOCKS.length} blocks, ${PLATFORM_BLOCKS.join(", ")}, in the order get_campaign returns them`,
				});
			} else {
				sent.forEach((raw: unknown, i) => {
					const want = PLATFORM_BLOCKS[i] as string;
					const block = (raw ?? {}) as Record<string, unknown>;
					const field = PLATFORM_BLOCK_FIELD[want] as string;
					const path = `blocks[${i}].${field}`;
					if (block.type !== want) {
						issues.push({ path: `blocks[${i}].type`, message: `is "${want}"` });
						return;
					}
					const value = block[field];
					if (want === "title") {
						const title = typeof value === "string" ? value.trim() : "";
						if (title.length < 1 || title.length > 200)
							issues.push({
								path,
								message: "is the campaign's name, 1 to 200 characters",
							});
						else next.title = title;
					} else if (want === "story") {
						if (typeof value !== "string")
							issues.push({ path, message: "is plain text" });
						else next.story = value;
					} else if (want === "hero") {
						if (
							value === null ||
							value === k.hero ||
							(typeof value === "string" && k.uploads.includes(value))
						)
							next.hero = value as string | null;
						else issues.push({ path, message: HERO_MSG });
					} else if (value === null || isMoney(value)) {
						next.goal = value as Money | null;
					} else {
						issues.push({
							path,
							message: 'is {amount, currency: "USD"}, or null for no goal',
						});
					}
				});
			}
			if (issues.length > 0) return invalid(c, issues);
			if (k.status === "ended") return ended(c);
			if (expected !== undefined && expected !== String(k.version))
				return stale(c);
			const changed =
				next.title !== k.title ||
				next.story !== k.story ||
				next.hero !== k.hero ||
				!sameJson(next.goal, k.settings.goal);
			k.title = next.title;
			k.story = next.story;
			k.hero = next.hero;
			k.settings.goal = next.goal;
			if (changed) k.version++;
			return c.json(campaignView(k));
		},
	);

	v1.post("/campaigns/:id/publish", action("campaigns.publish"), async (c) => {
		const k = campaignOf(c);
		if (k instanceof Response) return k;
		const body = await readBody(c, true);
		if (body instanceof Response) return body;
		const issues: Issue[] = [];
		unknownKeys(body, ["gifts_go_to"], issues);
		const sent = Object.hasOwn(body, "gifts_go_to");
		const to = body.gifts_go_to;
		if (sent && to !== null && typeof to !== "string")
			issues.push({
				path: "gifts_go_to",
				message:
					"is a program id of this nonprofit, or null for the general fund",
			});
		if (issues.length > 0) return invalid(c, issues);
		if (k.status === "ended") return ended(c);
		if (k.everPublished) {
			if (!sent || to === k.giftsGoTo) return c.json(campaignView(k));
			return problem(
				c,
				409,
				"already_published",
				"This campaign is live. Change where its gifts go in the Better Giving dashboard.",
			);
		}
		if (!sent)
			return invalid(c, [
				{
					path: "gifts_go_to",
					message:
						"is required on the first publish: a program id, or null for the general fund",
				},
			]);
		k.everPublished = true;
		k.status = "published";
		k.giftsGoTo = to as string | null;
		k.version++;
		return c.json(campaignView(k));
	});

	v1.post("/campaigns/:id/end", action("campaigns.end"), async (c) => {
		const k = campaignOf(c);
		if (k instanceof Response) return k;
		const body = await readBody(c, true);
		if (body instanceof Response) return body;
		const issues: Issue[] = [];
		unknownKeys(body, [], issues);
		if (issues.length > 0) return invalid(c, issues);
		if (k.status !== "ended") {
			k.status = "ended";
			k.version++;
		}
		return c.json(campaignView(k));
	});

	const formFields = (body: Record<string, unknown>, issues: Issue[]) => {
		if (Object.hasOwn(body, "name")) {
			const name = typeof body.name === "string" ? body.name.trim() : "";
			if (name.length < 1 || name.length > 200)
				issues.push({
					path: "name",
					message: "is the form's label, 1 to 200 characters",
				});
		}
		if (
			Object.hasOwn(body, "status") &&
			body.status !== "live" &&
			body.status !== "draft"
		)
			issues.push({ path: "status", message: 'is "live" or "draft"' });
		if (
			Object.hasOwn(body, "suggested_amounts") &&
			!(
				Array.isArray(body.suggested_amounts) &&
				body.suggested_amounts.every(isMoney)
			)
		)
			issues.push({
				path: "suggested_amounts",
				message: "is a list of amounts",
			});
	};
	const stamp = (prev: unknown) =>
		new Date(
			Math.max(
				Date.now(),
				(typeof prev === "string" ? Date.parse(prev) : 0) + 1,
			),
		).toISOString();

	const stillRunning = (c: Context) =>
		problem(
			c,
			409,
			"idempotency_in_progress",
			"A request with this Idempotency-Key is still running. Retry the same request, with the same Idempotency-Key and the same body, after a few seconds.",
			undefined,
			{ "retry-after": state.retryAfter },
		);

	v1.post("/forms", action("forms.create"), async (c) => {
		const body = await readBody(c);
		if (body instanceof Response) return body;
		const key = c.req.header("idempotency-key")?.trim() ?? "";
		const fingerprint = JSON.stringify(sorted(body));
		const claim = key ? state.formClaims.get(key) : undefined;
		if (claim) {
			if (claim.fingerprint !== fingerprint)
				return problem(
					c,
					409,
					"idempotency_conflict",
					"This Idempotency-Key was already used for a different request. Send a new key for a new request.",
				);
			if (claim.pending && state.stall > 0) {
				state.stall--;
				return stillRunning(c);
			}
			// a replay is 200, even though the create was 201
			if (!claim.pending) return c.json(claim.body, 200);
		}
		const issues: Issue[] = [];
		unknownKeys(body, FORM_WRITABLE, issues);
		if (!Object.hasOwn(body, "name"))
			issues.push({
				path: "name",
				message: "is the form's label, 1 to 200 characters",
			});
		formFields(body, issues);
		if (issues.length > 0) return invalid(c, issues);
		if (key && state.stall > 0 && !claim) {
			state.stall--;
			state.formClaims.set(key, { fingerprint, pending: true, body: null });
			return stillRunning(c);
		}
		const f: Form = {
			id: `frm_${crypto.randomUUID()}`,
			campaign_id: null,
			status: "live",
			suggested_amounts: [],
			...body,
			name: (body.name as string).trim(),
			updated_at: stamp(null),
		};
		state.forms.set(f.id, f);
		if (key)
			state.formClaims.set(key, { fingerprint, pending: false, body: f });
		// the earlier try finishing: this answer is its replay
		return c.json(f, claim ? 200 : 201);
	});

	v1.patch("/forms/:id", action("forms.update"), async (c) => {
		const id = c.req.param("id");
		const f = state.forms.get(id);
		if (!f) return missing(c, "Form", id);
		const body = await readBody(c);
		if (body instanceof Response) return body;
		const issues: Issue[] = [];
		unknownKeys(body, [...FORM_WRITABLE, ...FORM_ECHOES, "confirm"], issues);
		if (Object.hasOwn(body, "confirm") && body.confirm !== true)
			issues.push({ path: "confirm", message: "is true, or left out" });
		formFields(body, issues);
		if (issues.length > 0) return invalid(c, issues);
		if (typeof body.updated_at === "string" && body.updated_at !== f.updated_at)
			return problem(
				c,
				409,
				"stale_read",
				"This form changed after it was read. Read it again with get_form, then send the change against what it shows now.",
			);
		const changed = FORM_WRITABLE.filter(
			(key) => Object.hasOwn(body, key) && !sameJson(body[key], f[key]),
		);
		if (changed.length === 0) return c.json(f);
		const held = changed.filter((key) => key !== "name");
		if (f.status === "live" && held.length > 0 && body.confirm !== true)
			return problem(
				c,
				409,
				"confirm_required",
				`This form is live, so donors would see the change to ${held.join(", ")}. Send confirm: true to apply it.`,
			);
		for (const key of changed) f[key] = body[key];
		f.updated_at = stamp(f.updated_at);
		return c.json(f);
	});

	v1.post("/photos/upload-link", action("photos.upload_link"), async (c) => {
		const body = await readBody(c);
		if (body instanceof Response) return body;
		const issues: Issue[] = [];
		unknownKeys(body, ["target", "slot"], issues);
		const target = (body.target ?? {}) as Record<string, unknown>;
		if (target.kind === "donation_page")
			issues.push({
				path: "target.kind",
				message:
					"is not supported on Better Giving; only a campaign's photo can be uploaded",
			});
		else if (target.kind !== "campaign" || typeof target.id !== "string")
			issues.push({ path: "target", message: 'is {kind: "campaign", id}' });
		if (Object.hasOwn(body, "slot") && body.slot !== "hero")
			issues.push({ path: "slot", message: 'is "hero", or left out' });
		if (issues.length > 0) return invalid(c, issues);
		const k = state.campaigns.get(target.id as string);
		if (!k) return missing(c, "Campaign", target.id as string);
		if (k.status === "ended") return ended(c);
		const token = crypto.randomUUID();
		const expiresAt = Date.now() + PHOTO_LINK_TTL_MS;
		state.photoLinks.set(token, { campaignId: k.id, expiresAt, used: false });
		return c.json(
			{
				url: `https://${state.host}/photo-upload/${token}`,
				expires_at: new Date(expiresAt).toISOString(),
			},
			201,
		);
	});
}
