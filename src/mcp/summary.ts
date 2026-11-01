import { z } from "zod";
import { formatDate, formatMoney } from "../format";
import type { SummaryContext, ToolOutput } from "./spec";

// Each action tool's structured result: the body its deployment is known to
// send, as a loose object so a field the deployment adds never fails a call,
// and the line that sums it up. A field one deployment leaves out, or that
// only Platform sends, is optional.

/** Binds a summary line to its schema: the pipeline calls it only with a body the schema accepted. */
const output = <S extends z.ZodObject>(
	schema: S,
	summary: (body: z.output<S>, cx: SummaryContext) => string,
): ToolOutput => ({
	schema,
	summary: (body, cx) => summary(body as z.output<S>, cx),
});

const money = z.looseObject({ amount: z.string(), currency: z.string() });
const listOf = <T extends z.ZodType>(item: T) =>
	z.looseObject({ data: z.array(item), next_cursor: z.string().nullable() });

const campaignItem = z.looseObject({
	id: z.string(),
	title: z.string(),
	status: z.string(),
	public_url: z.string().nullable(),
	slug: z.string().optional(),
});
const campaign = campaignItem.extend({
	settings: z
		.looseObject({
			goal: money.nullable().optional(),
			end_date: z.string().nullable().optional(),
			time_zone: z.string().nullable().optional(),
		})
		.optional(),
	version: z.union([z.string(), z.number()]).optional(),
	blocks: z.array(z.looseObject({ type: z.string() })).optional(),
	content: z.record(z.string(), z.unknown()).optional(),
	layout: z.string().optional(),
});
const donationPage = z.looseObject({
	public_url: z.string().nullable(),
	blocks: z.array(z.looseObject({ type: z.string() })).optional(),
	content: z
		.looseObject({ heading: z.string().nullable().optional() })
		.optional(),
});
const form = z.looseObject({
	id: z.string(),
	name: z.string(),
	campaign_id: z.string().nullable().optional(),
	status: z.string().optional(),
	updated_at: z.string().optional(),
});
const donation = z.looseObject({
	id: z.string(),
	amount: money,
	date: z.string(),
	donor_id: z.string(),
	campaign_id: z.string().nullable().optional(),
	method: z.string().optional(),
	note: z.string().nullable().optional(),
});
const donor = z.looseObject({
	id: z.string(),
	name: z.string(),
	email: z.string().nullable().optional(),
	total: money,
	gift_count: z.number(),
});
const recurring = z.looseObject({
	id: z.string(),
	donor_id: z.string(),
	amount: money,
	interval: z.string().optional(),
	status: z.string().optional(),
	next_date: z.string().nullable().optional(),
});

const count = (n: number, locale: string, one: string, many: string) =>
	`${new Intl.NumberFormat(locale).format(n)} ${n === 1 ? one : many}`;
const shown = (m: z.output<typeof money>, locale: string) =>
	formatMoney(m.amount, m.currency, locale);
const onePage = (n: string, more: string | null) =>
	more === null ? n : `${n}, more on the next page`;
const STATUS: Record<string, string> = { published: "live" };
const statusOf = (status: string) => STATUS[status] ?? status;

// ", goal $5,000.00, ends Dec 31, 2026": what is set of a campaign's settings.
function goalAndEnd(k: z.output<typeof campaign>, locale: string): string {
	const parts: string[] = [];
	const goal = k.settings?.goal;
	if (goal) parts.push(`goal ${shown(goal, locale)}`);
	const end = k.settings?.end_date;
	if (end) parts.push(`ends ${formatDate(end, locale)}`);
	return parts.map((part) => `, ${part}`).join("");
}

function campaignsListed(
	list: z.output<ReturnType<typeof listOf<typeof campaignItem>>>,
	{ locale, input }: SummaryContext,
): string {
	const filtered = typeof input.status === "string" ? input.status : null;
	const noun =
		filtered === null ? "campaign" : `${statusOf(filtered)} campaign`;
	const n = list.data.length;
	if (n === 0) return `No ${noun}s`;
	const total = count(n, locale, noun, `${noun}s`);
	if (filtered !== null) return onePage(total, list.next_cursor);
	const byStatus = new Map<string, number>();
	for (const k of list.data) {
		byStatus.set(k.status, (byStatus.get(k.status) ?? 0) + 1);
	}
	const split = [...byStatus]
		.map(([status, m]) =>
			status === "draft"
				? count(m, locale, "draft", "drafts")
				: `${new Intl.NumberFormat(locale).format(m)} ${statusOf(status)}`,
		)
		.join(", ");
	return onePage(`${total}: ${split}`, list.next_cursor);
}

const counted = (item: z.ZodType, one: string, many: string) =>
	output(listOf(item), (list, { locale }) =>
		list.data.length === 0
			? `No ${many}`
			: onePage(count(list.data.length, locale, one, many), list.next_cursor),
	);

/** Every action tool's output, by tool name. */
export const OUTPUTS = {
	list_campaigns: output(listOf(campaignItem), campaignsListed),
	get_campaign: output(
		campaign,
		(k, { locale }) =>
			`${k.title}: ${statusOf(k.status)}${goalAndEnd(k, locale)}`,
	),
	create_campaign: output(campaign, (k, { replayed }) =>
		replayed ? `Already created: ${k.title}` : `Draft created: ${k.title}`,
	),
	update_campaign_blocks: output(campaign, (k) => `Page saved: ${k.title}`),
	update_campaign_content: output(campaign, (k) => `Page saved: ${k.title}`),
	update_campaign_settings: output(
		campaign,
		(k, { locale }) => `Settings saved: ${k.title}${goalAndEnd(k, locale)}`,
	),
	publish_campaign: output(campaign, (k) => `${k.title} is live`),
	end_campaign: output(campaign, (k) => `${k.title} has ended`),
	get_donation_page: output(donationPage, (page) => {
		const heading = page.content?.heading;
		return heading ? `Donation page: ${heading}` : "Donation page";
	}),
	update_donation_page_blocks: output(
		donationPage,
		() => "Donation page saved",
	),
	update_donation_page_content: output(
		donationPage,
		() => "Donation page heading saved to its draft",
	),
	reset_donation_page: output(
		donationPage,
		() => "Donation page reset to its default",
	),
	get_block_catalog: output(
		z.looseObject({ blocks: z.array(z.looseObject({ type: z.string() })) }),
		(catalog, { locale }) =>
			count(catalog.blocks.length, locale, "block type", "block types"),
	),
	get_content_catalog: output(
		z.looseObject({
			// each entry's `key` is a content key's name, left unnamed so no
			// output schema lists a field called key
			content: z.array(z.looseObject({ description: z.string().optional() })),
			layout: z.looseObject({}).optional(),
		}),
		(catalog, { locale }) =>
			count(catalog.content.length, locale, "content key", "content keys"),
	),
	list_forms: counted(form, "donation form", "donation forms"),
	get_form: output(form, (f) => `Form: ${f.name}`),
	create_form: output(form, (f, { replayed }) =>
		replayed ? `Already created: ${f.name}` : `Form created: ${f.name}`,
	),
	update_form: output(form, (f) => `Form saved: ${f.name}`),
	get_results: output(
		z.looseObject({
			total: money,
			gift_count: z.number(),
			donor_count: z.number(),
			campaigns: z.array(
				z.looseObject({ id: z.string(), title: z.string(), total: money }),
			),
		}),
		(results, { locale }) =>
			`${shown(results.total, locale)} raised from ${count(results.gift_count, locale, "gift", "gifts")} by ${count(results.donor_count, locale, "donor", "donors")}`,
	),
	list_donations: counted(donation, "donation", "donations"),
	list_donors: counted(donor, "donor", "donors"),
	get_donor: output(
		donor.extend({ gifts: listOf(donation) }),
		(d, { locale }) =>
			`${d.name}: ${shown(d.total, locale)} from ${count(d.gift_count, locale, "gift", "gifts")}`,
	),
	list_recurring_gifts: counted(recurring, "monthly gift", "monthly gifts"),
	record_donation: output(donation, (gift, { locale, replayed }) => {
		const what = `${shown(gift.amount, locale)} received ${formatDate(gift.date, locale)}`;
		return replayed ? `Already recorded: ${what}` : `Recorded ${what}`;
	}),
	create_photo_upload_link: output(
		z.looseObject({ url: z.string(), expires_at: z.string() }),
		(link, { locale }) =>
			`Upload link ready until ${formatDate(link.expires_at, locale, {
				hour: "numeric",
				minute: "2-digit",
				timeZoneName: "short",
			})}`,
	),
};
