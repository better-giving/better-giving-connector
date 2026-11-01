import { z } from "zod";
import { formatMoney } from "../format";
import { THEME_NAMES } from "../presets/themes";
import { READ } from "./actions";
import {
	anAppeal,
	type History,
	type Money,
	recommend,
} from "./recommendations";
import type { LocalCall, LocalSpec } from "./spec";
import { statusLines } from "./spec";

// The most pages of 100 read of each list: 500 ended campaigns, 500 gifts.
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

const money = z.looseObject({ amount: z.string(), currency: z.string() });
const campaignItem = z.looseObject({
	id: z.string(),
	title: z.string(),
	status: z.string(),
});
const giftItem = z.looseObject({
	amount: money,
	date: z.string(),
	campaign_id: z.string().nullable().optional(),
});
const results = z.looseObject({
	campaigns: z.array(z.looseObject({ id: z.string(), total: money })),
});

type Body = Record<string, unknown>;
const isBody = (value: unknown): value is Body =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Every item of a paged list the schema accepts, up to MAX_PAGES pages; an item it refuses is left out. */
async function readPages<T>(
	{ connection, client }: LocalCall,
	action: "campaigns.list" | "donations.list",
	query: Body,
	item: z.ZodType<T>,
): Promise<T[]> {
	const items: T[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const answer = (
			await client.call(connection, action, {
				...query,
				limit: PAGE_SIZE,
				...(cursor === undefined ? {} : { cursor }),
			})
		).body;
		const data = isBody(answer) && Array.isArray(answer.data) ? answer.data : [];
		for (const raw of data) {
			const parsed = item.safeParse(raw);
			if (parsed.success) items.push(parsed.data);
		}
		if (!isBody(answer) || typeof answer.next_cursor !== "string") break;
		cursor = answer.next_cursor;
	}
	return items;
}

async function readHistory(call: LocalCall): Promise<History> {
	const ended = (
		await readPages(call, "campaigns.list", { status: "ended" }, campaignItem)
	).filter((k) => k.status === "ended");
	// One summary carries every campaign's total; an org with no ended campaign needs none.
	const totals = new Map<string, Money>();
	if (ended.length > 0) {
		const answer = results.safeParse(
			(await call.client.call(call.connection, "results.summary", {})).body,
		);
		for (const k of answer.success ? answer.data.campaigns : [])
			totals.set(k.id, k.total);
	}
	const gifts = await readPages(call, "donations.list", {}, giftItem);
	return {
		pastCampaigns: ended.map((k) => ({
			id: k.id,
			title: k.title,
			total: totals.get(k.id) ?? null,
		})),
		gifts: gifts.map((g) => ({
			amount: g.amount,
			date: g.date,
			campaignId: g.campaign_id ?? null,
		})),
	};
}

const recommendation = <T extends z.ZodType>(value: T) =>
	z.looseObject({ value, evidence: z.string() });

const recommendations = z.looseObject({
	basedOnHistory: z.boolean(),
	goal: recommendation(money),
	suggestedAmounts: recommendation(z.array(money)),
	endDays: recommendation(z.number().int().positive()),
	theme: recommendation(z.enum(THEME_NAMES)),
});

export const RECOMMEND_CAMPAIGN_PRESETS: LocalSpec = {
	tool: "recommend_campaign_presets",
	title: "Recommend campaign settings",
	description:
		"Recommends a new campaign's goal, suggested amounts, run length (endDays, days from publish to the end date) and theme from the nonprofit's ended campaigns and its gifts, each with a sentence of evidence. With little history, each is the theme's starting point and basedOnHistory is false. Use the values as create_campaign's preset, with end_date endDays after today.",
	input: z.strictObject({
		theme: z
			.enum(THEME_NAMES)
			.optional()
			.describe("Recommend for this kind of appeal rather than the one history points to."),
	}),
	output: {
		schema: recommendations,
		summary: (body, { locale }) => {
			const r = body as z.output<typeof recommendations>;
			const label = anAppeal(r.theme.value);
			const goal = formatMoney(r.goal.value.amount, r.goal.value.currency, locale);
			const rest = `a goal of ${goal}, ${r.suggestedAmounts.value.length} suggested amounts and a ${r.endDays.value}-day run`;
			return r.basedOnHistory
				? `Recommended from your history: ${label} with ${rest}.`
				: `Starting points for ${label}, with too little history to tune them: ${rest}.`;
		},
	},
	annotations: READ,
	_meta: statusLines(
		"Reading past campaigns and gifts…",
		"Recommendations ready",
	),
	needs: ["campaigns.list", "results.summary", "donations.list"],
	async run(call) {
		const theme = z.enum(THEME_NAMES).optional().parse(call.input.theme);
		const structured = recommend(await readHistory(call), {
			locale: call.locale,
			...(theme === undefined ? {} : { theme }),
		});
		return { text: JSON.stringify(structured), structured };
	},
};
