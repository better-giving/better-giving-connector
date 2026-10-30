import type { CallAnswer } from "../deployment";
import { isKeyedAction } from "../deployment";
import type { ActionSpec } from "./actions";
import type { RunToolContext, ToolConnection } from "./run-tool";

const REPLAY_PREFIX =
	"Already done: this matches an earlier call with the same details, so nothing new was recorded. The original result follows.";

/**
 * A successful call as the chat reads it: a lead line naming the org, then
 * the deployment's JSON as it sent it. Never throws: a body it can't
 * summarize gets the generic lead.
 */
export async function answerText(
	spec: ActionSpec,
	connection: ToolConnection,
	input: Record<string, unknown>,
	answer: CallAnswer,
	ctx: RunToolContext,
): Promise<string> {
	const replayed = isKeyedAction(spec.action) && answer.status === 200;
	const lead = await leadOf(
		spec,
		connection,
		input,
		answer.body,
		replayed,
		ctx,
	).catch(() => null);
	const lines = [lead ?? generic(connection.orgName)];
	if (replayed) lines.push(REPLAY_PREFIX);
	lines.push(JSON.stringify(answer.body));
	return lines.join("\n");
}

const generic = (org: string) => `From ${org}'s Better Giving site:`;

type Body = Record<string, unknown>;
const isBody = (value: unknown): value is Body =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) =>
	typeof value === "string" && value !== "" ? value : undefined;

// Each page and list carries its items under `data`, the next page's cursor
// under `next_cursor`.
const pageOf = (body: unknown) =>
	isBody(body) && Array.isArray(body.data)
		? { data: body.data as unknown[], more: body.next_cursor != null }
		: null;

async function leadOf(
	spec: ActionSpec,
	connection: ToolConnection,
	input: Record<string, unknown>,
	body: unknown,
	replayed: boolean,
	ctx: RunToolContext,
): Promise<string | null> {
	const org = connection.orgName;
	switch (spec.action) {
		case "campaigns.list":
			return campaignsLead(org, input, body, () =>
				ctx.client.call(connection, "campaigns.list", { limit: 100 }),
			);
		case "campaigns.create":
			// A replay's "Created…" would contradict the replay line below it.
			return replayed ? null : createdLead(org, input, body);
		case "results.summary":
			return resultsLead(org, input, body, () =>
				ctx.client.call(connection, "results.summary", {}),
			);
		case "donations.list":
			return donationsLead(org, input, body, () =>
				ctx.client.call(connection, "donations.list", { limit: 100 }),
			);
		default:
			return null;
	}
}

type Unfiltered = () => Promise<CallAnswer>;

// Well under the client's per-call timeout (src/deployment/index.ts): a slow
// count costs the lead its second sentence, never the answer.
const UNFILTERED_MS = 3_000;

// The unfiltered read's body, or null when it fails or outlasts UNFILTERED_MS;
// either way the lead falls back to its plain sentence.
async function readUnfiltered(unfiltered: Unfiltered): Promise<unknown> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const late = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), UNFILTERED_MS);
	});
	try {
		return await Promise.race([
			unfiltered().then(
				(answer) => answer.body,
				() => null,
			),
			late,
		]);
	} finally {
		clearTimeout(timer);
	}
}

const STATUSES = ["draft", "published", "ended"] as const;
type Status = (typeof STATUSES)[number];

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`;
const campaignNoun = (n: number, status?: Status) =>
	status === "draft"
		? n === 1
			? "draft"
			: "drafts"
		: `${status === undefined ? "" : `${status} `}campaign${n === 1 ? "" : "s"}`;
const campaigns = (n: number, status?: Status) =>
	`${n} ${campaignNoun(n, status)}`;
const andList = (items: string[]) =>
	items.length < 2
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const orList = (items: string[]) =>
	items.length < 2
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

const NO_CAMPAIGNS = (org: string) =>
	`${org} has no campaigns yet. create_campaign starts one as a draft.`;

async function campaignsLead(
	org: string,
	input: Record<string, unknown>,
	body: unknown,
	unfiltered: Unfiltered,
): Promise<string | null> {
	const listed = pageOf(body);
	if (listed === null) return null;
	const status = STATUSES.find((s) => s === input.status);
	const firstPage = input.cursor === undefined;
	if (listed.data.length > 0) {
		const more = listed.more
			? " More follow: pass next_cursor as cursor for the next page."
			: "";
		return `${org}: ${campaigns(listed.data.length, status)}${firstPage ? "" : " on this page"}.${more}`;
	}
	if (!firstPage) return `${org}: no more ${campaignNoun(2, status)}.`;
	if (status === undefined) return NO_CAMPAIGNS(org);
	const none = `${org} has no ${status} campaigns.`;
	const all = pageOf(await readUnfiltered(unfiltered));
	if (all === null) return none;
	if (all.more) {
		return `${none} It has more than 100 campaigns in all; call list_campaigns without a status to see them.`;
	}
	if (all.data.length === 0) return NO_CAMPAIGNS(org);
	const others = STATUSES.filter((s) => s !== status)
		.map((s) => ({
			status: s,
			count: all.data.filter((k) => isBody(k) && k.status === s).length,
		}))
		.filter((o) => o.count > 0);
	if (others.length === 0) return none;
	const total = others.reduce((n, o) => n + o.count, 0);
	return `${none} It has ${andList(others.map((o) => campaigns(o.count, o.status)))}; call list_campaigns with status ${orList(others.map((o) => `"${o.status}"`))} to see ${total === 1 ? "it" : "them"}.`;
}

function createdLead(
	org: string,
	input: Record<string, unknown>,
	body: unknown,
): string | null {
	if (!isBody(body)) return null;
	const title = text(body.title) ?? text(input.title);
	if (title === undefined) return null;
	return `Created a draft campaign "${title}" for ${org}. Donors can't see it until it's published.`;
}

// " from X to Y for campaign Z", from whichever filters were sent.
function scope(input: Record<string, unknown>): string {
	const from = text(input.from);
	const to = text(input.to);
	const campaign = text(input.campaign_id);
	let range = "";
	if (from && to) range = ` from ${from} to ${to}`;
	else if (from) range = ` from ${from} on`;
	else if (to) range = ` through ${to}`;
	return campaign ? `${range} for campaign ${campaign}` : range;
}

function money(value: unknown): string | null {
	if (!isBody(value)) return null;
	const amount = Number(value.amount);
	const currency = text(value.currency);
	if (!Number.isFinite(amount) || currency === undefined) return null;
	try {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
		}).format(amount);
	} catch {
		return null;
	}
}

const giftsOf = (body: unknown) => {
	if (!isBody(body) || typeof body.gift_count !== "number") return null;
	const total = money(body.total);
	return total === null ? null : { count: body.gift_count, total };
};

async function resultsLead(
	org: string,
	input: Record<string, unknown>,
	body: unknown,
	unfiltered: Unfiltered,
): Promise<string | null> {
	const gifts = giftsOf(body);
	if (gifts === null) return null;
	const within = scope(input);
	if (gifts.count > 0) {
		return `${org} raised ${gifts.total} from ${plural(gifts.count, "gift", "gifts")}${within}.`;
	}
	if (within === "") return `${org} has no gifts recorded yet.`;
	const none = `${org} had no gifts${within}.`;
	const all = giftsOf(await readUnfiltered(unfiltered));
	if (all === null) return none;
	if (all.count === 0) return `${org} has no gifts recorded yet.`;
	return `${none} All time, it has ${plural(all.count, "gift", "gifts")} totaling ${all.total}; widen the range or leave the filters out to see them.`;
}

async function donationsLead(
	org: string,
	input: Record<string, unknown>,
	body: unknown,
	unfiltered: Unfiltered,
): Promise<string | null> {
	const listed = pageOf(body);
	if (listed === null) return null;
	const within = scope(input);
	const firstPage = input.cursor === undefined;
	if (listed.data.length > 0) {
		const more = listed.more
			? " More follow: pass next_cursor as cursor for the next page."
			: "";
		return `${org}: ${plural(listed.data.length, "donation", "donations")}${within}${firstPage ? "" : " on this page"}.${more}`;
	}
	if (!firstPage) return `${org}: no more donations${within}.`;
	if (within === "") return `${org} has no donations recorded yet.`;
	const none = `${org} had no donations${within}.`;
	const all = pageOf(await readUnfiltered(unfiltered));
	if (all === null) return none;
	if (all.data.length === 0) return `${org} has no donations recorded yet.`;
	const count = all.more
		? "more than 100 donations"
		: plural(all.data.length, "donation", "donations");
	// Past 100 the newest gift may be on a page not read.
	const newest = all.more ? undefined : newestDate(all.data);
	return `${none} It has ${count} in all${newest ? `, the newest on ${newest}` : ""}; widen the range or leave the filters out to see them.`;
}

// The latest of the donations' dates as the site wrote it; a date that
// doesn't parse is skipped.
function newestDate(donations: unknown[]): string | undefined {
	let newest: { at: number; date: string } | undefined;
	for (const d of donations) {
		const date = isBody(d) ? text(d.date) : undefined;
		const at = date === undefined ? Number.NaN : Date.parse(date);
		if (
			date !== undefined &&
			!Number.isNaN(at) &&
			(newest === undefined || at > newest.at)
		) {
			newest = { at, date };
		}
	}
	return newest?.date;
}
