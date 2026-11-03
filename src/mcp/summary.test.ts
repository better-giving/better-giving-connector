import { expect, test } from "vitest";
import { ACTIONS } from "./actions";
import type { SummaryContext } from "./spec";
import { OUTPUTS } from "./summary";

const usd = (amount: string) => ({ amount, currency: "USD" });
const campaign = {
	id: "cmp_1",
	title: "Winter coats",
	status: "published",
	public_url: "https://give.example.org/campaigns/cmp_1",
	settings: { goal: usd("5000.00"), end_date: "2026-12-31" },
};
const draft = { ...campaign, status: "draft", settings: { goal: null } };
const gift = {
	id: "don_1",
	amount: usd("100.00"),
	date: "2026-10-01",
	donor_id: "dnr_1",
	campaign_id: null,
	method: "check",
	note: null,
};
const donor = {
	id: "dnr_1",
	name: "Ada",
	email: null,
	total: usd("1250.00"),
	gift_count: 3,
};
const form = { id: "frm_1", name: "Gala", campaign_id: null };
const page = { public_url: "https://give.example.org/donate" };
const list = (data: unknown[], next: string | null = null) => ({
	data,
	next_cursor: next,
});

const cx = (over: Partial<SummaryContext> = {}): SummaryContext => ({
	locale: "en-US",
	input: {},
	replayed: false,
	...over,
});

const CASES: [keyof typeof OUTPUTS, unknown, SummaryContext, string][] = [
	[
		"list_campaigns",
		list([campaign, draft, { ...draft, id: "cmp_3" }]),
		cx(),
		"3 campaigns: 1 live, 2 drafts",
	],
	[
		"list_campaigns",
		list([campaign], "1"),
		cx({ input: { status: "published" } }),
		"1 live campaign, more on the next page",
	],
	["list_campaigns", list([]), cx(), "No campaigns"],
	[
		"get_campaign",
		campaign,
		cx(),
		"Winter coats: live, goal $5,000.00, ends Dec 31, 2026",
	],
	[
		"get_campaign",
		campaign,
		cx({ locale: "de-DE" }),
		"Winter coats: live, goal 5.000,00 $, ends 31.12.2026",
	],
	["create_campaign", draft, cx(), "Draft created: Winter coats"],
	[
		"create_campaign",
		draft,
		cx({ replayed: true }),
		"Already created: Winter coats",
	],
	["update_campaign_blocks", campaign, cx(), "Page saved: Winter coats"],
	["update_campaign_content", campaign, cx(), "Page saved: Winter coats"],
	["update_campaign_settings", draft, cx(), "Settings saved: Winter coats"],
	["publish_campaign", campaign, cx(), "Winter coats is live"],
	["end_campaign", campaign, cx(), "Winter coats has ended"],
	[
		"get_donation_page",
		{ ...page, content: { heading: "Give warmth" } },
		cx(),
		"Donation page: Give warmth",
	],
	["get_donation_page", page, cx(), "Donation page"],
	["update_donation_page_blocks", page, cx(), "Donation page saved"],
	[
		"update_donation_page_content",
		page,
		cx(),
		"Donation page heading saved to its draft",
	],
	["reset_donation_page", page, cx(), "Donation page reset to its default"],
	[
		"get_block_catalog",
		{ blocks: [{ type: "hero" }, { type: "goal_meter" }] },
		cx(),
		"2 block types",
	],
	[
		"get_content_catalog",
		{ content: [{ key: "heading" }], layout: {} },
		cx(),
		"1 content key",
	],
	["list_forms", list([form, form]), cx(), "2 donation forms"],
	["get_form", form, cx(), "Form: Gala"],
	["create_form", form, cx(), "Form created: Gala"],
	["update_form", form, cx(), "Form saved: Gala"],
	[
		"get_results",
		{
			total: usd("12480.00"),
			gift_count: 1234,
			donor_count: 1,
			campaigns: [],
		},
		cx({ locale: "en-PH" }),
		"$12,480.00 raised from 1,234 gifts by 1 donor",
	],
	["list_donations", list([gift]), cx(), "1 donation"],
	["list_donations", list([]), cx(), "No donations"],
	["list_donors", list([donor]), cx(), "1 donor"],
	[
		"get_donor",
		{ ...donor, gifts: list([gift]) },
		cx(),
		"Ada: $1,250.00 from 3 gifts",
	],
	[
		"list_recurring_gifts",
		list([{ id: "rec_1", donor_id: "dnr_1", amount: usd("10.00") }]),
		cx(),
		"1 monthly gift",
	],
	["record_donation", gift, cx(), "Recorded $100.00 received Oct 1, 2026"],
	[
		"record_donation",
		gift,
		cx({ replayed: true }),
		"Already recorded: $100.00 received Oct 1, 2026",
	],
	[
		"create_photo_upload_link",
		{
			url: "https://give.example.org/uploads/x",
			expires_at: "2026-10-01T15:19:00.000Z",
		},
		cx(),
		"Upload link ready until 3:19 PM UTC",
	],
];

test.each(CASES)("%s sums up its body: %#", (tool, body, context, line) => {
	const { schema, summary } = OUTPUTS[tool];
	const parsed = schema.parse(body);

	// ICU spaces before AM/PM differ between releases
	expect(summary?.(parsed, context).replace(/\s/g, " ")).toBe(
		line.replace(/\s/g, " "),
	);
});

test("every action tool has a summary line", () => {
	const summed = new Set(CASES.map(([tool]) => tool));

	expect(ACTIONS.filter((s) => !summed.has(s.tool)).map((s) => s.tool)).toEqual(
		[],
	);
	for (const spec of ACTIONS) expect(spec.output).toBe(OUTPUTS[spec.tool]);
});
