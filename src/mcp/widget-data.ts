import { z } from "zod";
import { THEME_NAMES, THEMES, type ThemeName } from "../presets/themes";
import {
	type CampaignCreateData,
	type CampaignEditorData,
	type CampaignResultsData,
	type CampaignsData,
	MAX_CAMPAIGNS,
	type PhotoData,
} from "../widgets/model";
import { isLive, pendingDraft, readCampaign } from "./campaign-drafts";
import { findCampaignForm, versionOf } from "./campaign-presets";
import { type Body, isBody, readPages, readPagesCapped } from "./read-pages";
import { readHistory } from "./recommend-tool";
import { recommend } from "./recommendations";
import type { LocalCall } from "./spec";

// What each widget's render tool answers: read from the deployment's actions
// and shaped as src/widgets/model.ts says. A field a deployment leaves out is
// null, never invented.

const DAY_MS = 86_400_000;
const DEFAULT_CURRENCY = "USD";

/** Where a widget's `<img>` may load from: this service, and Vercel Blob. */
export const blobOrigin = "https://*.public.blob.vercel-storage.com";
export const imageOrigins = (call: Pick<LocalCall, "publicOrigin">) => [
	call.publicOrigin,
	blobOrigin,
];

const str = (value: unknown): string | null =>
	typeof value === "string" ? value : null;
const bodyOf = (value: unknown): Body => (isBody(value) ? value : {});
const money = (value: unknown) => {
	const parsed = z
		.object({ amount: z.string(), currency: z.string().length(3) })
		.safeParse(value);
	return parsed.success ? parsed.data : null;
};
const day = (value: unknown): string | null => {
	const text = str(value);
	return text !== null && /^\d{4}-\d{2}-\d{2}/.test(text)
		? text.slice(0, 10)
		: null;
};
const url = (value: unknown): string | null => {
	const text = str(value);
	if (text === null) return null;
	try {
		const parsed = new URL(text);
		return parsed.protocol === "https:" || parsed.protocol === "http:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
};
const version = (campaign: Body): string | null => versionOf(campaign) ?? null;
const status = (campaign: Body): "draft" | "published" | "ended" =>
	campaign.status === "published" || campaign.status === "ended"
		? campaign.status
		: "draft";
const zero = (currency: string) => ({ amount: "0.00", currency });

const call = async (
	{ connection, client }: LocalCall,
	action: Parameters<LocalCall["client"]["call"]>[1],
	input: Record<string, unknown> = {},
): Promise<Body> => bodyOf((await client.call(connection, action, input)).body);

const serves = ({ connection }: LocalCall, action: string) =>
	connection.actions === null ||
	(connection.actions as readonly string[]).includes(action);

const cents = (m: { amount: string }) => Math.round(Number(m.amount) * 100);
const fromCents = (c: number, currency: string) => ({
	amount: (c / 100).toFixed(2),
	currency,
});

// --- show_campaigns ---------------------------------------------------------

export async function campaignsData(
	c: LocalCall,
	filter?: "draft" | "published" | "ended",
): Promise<CampaignsData> {
	const list = await call(c, "campaigns.list", {
		limit: MAX_CAMPAIGNS,
		...(filter === undefined ? {} : { status: filter }),
	});
	const items = (Array.isArray(list.data) ? list.data : [])
		.filter(isBody)
		.slice(0, MAX_CAMPAIGNS);
	const campaigns = await Promise.all(
		items.map(async (item) => {
			const id = String(item.id);
			const [full, results] = await Promise.all([
				call(c, "campaigns.get", { id }),
				call(c, "results.summary", { campaign_id: id }),
			]);
			const settings = bodyOf(full.settings);
			const goal = money(settings.goal);
			const raised =
				money(results.total) ?? zero(goal?.currency ?? DEFAULT_CURRENCY);
			const donors =
				typeof results.donor_count === "number" ? results.donor_count : 0;
			return {
				id,
				title: String(item.title),
				status: status(item),
				goal,
				raised,
				donors,
				endDate: day(settings.end_date),
				imageUrl: url(full.image_url ?? bodyOf(full.hero).url),
				url: status(item) === "draft" ? null : url(item.public_url),
			};
		}),
	);
	return {
		currency: campaigns[0]?.raised.currency ?? DEFAULT_CURRENCY,
		imageOrigins: imageOrigins(c),
		campaigns,
	};
}

// --- show_campaign_results --------------------------------------------------

const giftItem = z.looseObject({
	amount: z.looseObject({ amount: z.string(), currency: z.string() }),
	date: z.string(),
});

export async function resultsData(
	c: LocalCall,
	id: string,
): Promise<CampaignResultsData> {
	const campaign = await readCampaign(c, id);
	const settings = bodyOf(campaign.settings);
	const goal = money(settings.goal);
	const results = await call(c, "results.summary", { campaign_id: id });
	const currency =
		money(results.total)?.currency ?? goal?.currency ?? DEFAULT_CURRENCY;
	const raised = money(results.total) ?? zero(currency);
	const today = Date.now() - (Date.now() % DAY_MS);
	const days = Array.from({ length: 14 }, (_, i) =>
		new Date(today - (13 - i) * DAY_MS).toISOString().slice(0, 10),
	);
	const [all, recent] = await Promise.all([
		readPagesCapped(c, "donations.list", { campaign_id: id }, giftItem),
		readPages(
			c,
			"donations.list",
			{ campaign_id: id, from: days[0] },
			giftItem,
		),
	]);

	// a median of the gifts read is no median of the campaign when more remain
	const amounts = all.complete
		? all.items.map((g) => cents(g.amount)).sort((a, b) => a - b)
		: [];
	const mid = Math.floor(amounts.length / 2);
	const median =
		amounts.length === 0
			? null
			: amounts.length % 2 === 1
				? (amounts[mid] ?? 0)
				: Math.round(((amounts[mid - 1] ?? 0) + (amounts[mid] ?? 0)) / 2);
	const giftCount =
		typeof results.gift_count === "number"
			? results.gift_count
			: all.items.length;
	const average =
		giftCount === 0 ? null : Math.round(cents(raised) / giftCount);

	const daily = days.map((date) => {
		const total = recent
			.filter((g) => g.date.slice(0, 10) === date)
			.reduce((sum, g) => sum + cents(g.amount), 0);
		return { date, total: fromCents(total, currency) };
	});

	const forms = serves(c, "forms.list")
		? await findCampaignForm(c, id)
		: undefined;
	const hasPage =
		(Array.isArray(campaign.blocks) && campaign.blocks.length > 0) ||
		Object.keys(bodyOf(campaign.content)).length > 0;
	const readiness = [
		{ id: "goal", label: "A goal is set", done: goal !== null },
		{
			id: "end_date",
			label: "An end date is set",
			done: day(settings.end_date) !== null,
		},
		{ id: "page", label: "The page has its story", done: hasPage },
		...(forms === undefined
			? []
			: [
					{
						id: "form",
						label: "A donation form is ready",
						done: forms !== null,
					},
				]),
	];
	const programs = (Array.isArray(campaign.programs) ? campaign.programs : [])
		.filter(isBody)
		.map((p) => ({ id: String(p.id), name: String(p.name ?? p.id) }));
	return {
		campaign: {
			id,
			title: String(campaign.title ?? ""),
			status: status(campaign),
			goal,
			endDate: day(settings.end_date),
			url: status(campaign) === "draft" ? null : url(campaign.public_url),
			version: version(campaign),
		},
		raised,
		donors: typeof results.donor_count === "number" ? results.donor_count : 0,
		giftCount,
		averageGift: average === null ? null : fromCents(average, currency),
		medianGift: median === null ? null : fromCents(median, currency),
		daily,
		readiness,
		programs,
		giftsGoTo: str(campaign.gifts_go_to),
		pendingDraft: (await pendingDraft(c, id)) !== null,
	};
}

// --- show_campaign_create ---------------------------------------------------

const plusDays = (days: number) =>
	new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

export async function createData(
	c: LocalCall,
	theme?: ThemeName,
): Promise<CampaignCreateData> {
	const recommendations = recommend(await readHistory(c), {
		locale: c.locale,
		...(theme === undefined ? {} : { theme }),
	});
	const selected = theme ?? recommendations.theme.value;
	const year = new Date().getUTCFullYear();
	const presets = THEME_NAMES.map((name) => {
		const t = THEMES[name];
		// the selected card carries the tuned values a history supports
		const tuned = name === selected && recommendations.basedOnHistory;
		return {
			theme: name,
			title: `${t.label} ${year}`,
			goal: tuned ? recommendations.goal.value : t.goal,
			endDate: plusDays(tuned ? recommendations.endDays.value : t.endDays),
			suggestedAmounts: tuned
				? recommendations.suggestedAmounts.value
				: t.suggestedAmounts,
		};
	});
	return { presets, selected, recommendations };
}

// --- open_campaign_editor ---------------------------------------------------

export async function editorData(
	c: LocalCall,
	id: string,
): Promise<CampaignEditorData> {
	const campaign = await readCampaign(c, id);
	// a draft left behind by a campaign that has since ended never goes live
	const draft = isLive(campaign) ? await pendingDraft(c, id) : null;
	const asBlocks = Array.isArray(campaign.blocks);
	const page: CampaignEditorData["page"] =
		draft?.page != null && draft.page_kind === "blocks"
			? { pageKind: "blocks", blocks: draft.page as never }
			: draft?.page != null && draft.page_kind === "content"
				? { pageKind: "content", content: draft.page as never }
				: asBlocks
					? { pageKind: "blocks", blocks: campaign.blocks as never }
					: { pageKind: "content", content: bodyOf(campaign.content) };
	const form = serves(c, "forms.list") ? await findCampaignForm(c, id) : null;
	const amounts = Array.isArray(form?.suggested_amounts)
		? form.suggested_amounts.map(money).filter((m) => m !== null)
		: Array.isArray(form?.amounts)
			? form.amounts.flatMap((a) =>
					typeof a === "string"
						? [{ amount: a, currency: DEFAULT_CURRENCY }]
						: [],
				)
			: [];
	const images: Record<string, string> = {};
	for (const [key, value] of Object.entries(bodyOf(campaign.images))) {
		const link = url(value);
		if (link !== null) images[key] = link;
	}
	return {
		orgName: c.connection.orgName,
		campaign: {
			id,
			title: String(campaign.title ?? ""),
			status: status(campaign),
			version: version(campaign),
			url: status(campaign) === "draft" ? null : url(campaign.public_url),
		},
		page,
		pendingDraft: draft !== null,
		draftsLiveEdits: c.connection.platform,
		formAmounts: amounts,
		imageOrigins: imageOrigins(c),
		images,
	};
}

// --- show_photo -------------------------------------------------------------

export async function photoData(
	c: LocalCall,
	id: string,
	file: PhotoData["file"],
): Promise<PhotoData> {
	const campaign = await readCampaign(c, id);
	const title = String(campaign.title ?? "");
	const hero = bodyOf(campaign.hero);
	const current = url(campaign.image_url ?? hero.url);
	return {
		campaign: { id, title },
		current: current === null ? null : { url: current, alt: str(hero.alt) },
		file,
		suggestedAlt: title === "" ? "" : `Photo for ${title}`,
		uploadUrl: null,
		canUpload: serves(c, "photos.upload_link"),
		imageOrigins: imageOrigins(c),
	};
}
