import { describe, expect, it } from "vitest";
import {
	APP_TOOLS,
	CampaignCreateData,
	CampaignEditorData,
	CampaignResultsData,
	CampaignsData,
	PhotoData,
} from "./model";

const usd = (amount: string) => ({ amount, currency: "USD" });

const card = (id: string) => ({
	id,
	title: `Campaign ${id}`,
	status: "published",
	goal: usd("1000.00"),
	raised: usd("250.00"),
	donors: 4,
	endDate: "2026-12-31",
	imageUrl: null,
	url: `https://give.example.org/c/${id}`,
});

const campaigns = (n: number) => ({
	currency: "USD",
	imageOrigins: ["https://*.public.blob.vercel-storage.com"],
	campaigns: Array.from({ length: n }, (_, i) => card(`c${i}`)),
});

describe("show_campaigns data", () => {
	it("takes up to eight campaigns", () => {
		expect(CampaignsData.safeParse(campaigns(8)).success).toBe(true);
		expect(CampaignsData.safeParse(campaigns(9)).success).toBe(false);
	});

	it("rejects money that is not a decimal string", () => {
		const data = campaigns(1);
		data.campaigns[0] = { ...card("c0"), raised: usd("1,000") };
		expect(CampaignsData.safeParse(data).success).toBe(false);
	});

	it("rejects a status the deployment does not have", () => {
		const data = campaigns(1);
		data.campaigns[0] = { ...card("c0"), status: "live" };
		expect(CampaignsData.safeParse(data).success).toBe(false);
	});
});

const daily = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		date: `2026-10-${String(i + 1).padStart(2, "0")}`,
		total: usd("10.00"),
	}));

const results = {
	campaign: {
		id: "c1",
		title: "Winter coats",
		status: "published",
		goal: usd("5000.00"),
		endDate: null,
		url: null,
		version: "14",
	},
	raised: usd("1200.00"),
	donors: 30,
	giftCount: 34,
	averageGift: usd("35.29"),
	medianGift: usd("25.00"),
	daily: daily(14),
	readiness: [{ id: "goal", label: "Goal set", done: true }],
	programs: [{ id: "p1", name: "Shelter" }],
	giftsGoTo: null,
	pendingDraft: false,
};

describe("show_campaign_results data", () => {
	it("takes exactly fourteen daily totals", () => {
		expect(CampaignResultsData.safeParse(results).success).toBe(true);
		expect(
			CampaignResultsData.safeParse({ ...results, daily: daily(13) }).success,
		).toBe(false);
	});
});

const rec = <T>(value: T) => ({
	value,
	evidence: "Your last appeal did this.",
});
const preset = (theme: string) => ({
	theme,
	title: "Year-end appeal:",
	goal: usd("50000.00"),
	endDate: "2026-12-31",
	suggestedAmounts: [usd("50.00"), usd("100.00")],
});

describe("show_campaign_create data", () => {
	const data = {
		presets: ["emergency", "year_end", "capital", "giving_day"].map(preset),
		selected: "year_end",
		recommendations: {
			basedOnHistory: true,
			goal: rec(usd("40000.00")),
			suggestedAmounts: rec([usd("50.00")]),
			endDays: rec(45),
			theme: rec("year_end"),
		},
	};

	it("takes one preset per theme", () => {
		expect(CampaignCreateData.safeParse(data).success).toBe(true);
		expect(
			CampaignCreateData.safeParse({
				...data,
				presets: data.presets.slice(0, 3),
			}).success,
		).toBe(false);
	});

	it("rejects a selected theme that is not a preset", () => {
		expect(
			CampaignCreateData.safeParse({ ...data, selected: "spring" }).success,
		).toBe(false);
	});
});

describe("open_campaign_editor data", () => {
	const base = {
		orgName: "Harbor Food Bank",
		campaign: {
			id: "c1",
			title: "Winter coats",
			status: "draft",
			version: "14",
			url: null,
		},
		pendingDraft: false,
		draftRevision: null,
		draftsLiveEdits: true,
		formAmounts: [usd("25.00")],
		imageOrigins: [],
		images: {},
	};

	it("reads a blocks page and a content page apart", () => {
		const blocks = CampaignEditorData.parse({
			...base,
			page: { pageKind: "blocks", blocks: [{ type: "hero", heading: "Hi" }] },
		});
		expect(blocks.page.pageKind).toBe("blocks");
		const content = CampaignEditorData.parse({
			...base,
			page: { pageKind: "content", content: { heading: "Hi" } },
		});
		expect(content.page).toEqual({
			pageKind: "content",
			content: { heading: "Hi" },
		});
	});
});

describe("show_photo data", () => {
	it("takes a card with no dropped file", () => {
		expect(
			PhotoData.safeParse({
				campaign: { id: "c1", title: "Winter coats" },
				current: null,
				file: null,
				suggestedAlt: "",
				uploadUrl: null,
				canUpload: false,
				imageOrigins: [],
			}).success,
		).toBe(true);
	});
});

describe("app-only tools", () => {
	it("are the app_ twins of the model-facing writes, plus get_profile", () => {
		expect(Object.keys(APP_TOOLS).sort()).toEqual([
			"app_create_campaign",
			"app_discard_campaign_draft",
			"app_end_campaign",
			"app_get_campaign_editor",
			"app_photo_upload_link",
			"app_publish_campaign",
			"app_save_campaign_edit",
			"app_set_campaign_photo",
			"get_profile",
		]);
	});

	it("refuse an argument they don't declare, as every other tool's input does", () => {
		for (const [name, { args }] of Object.entries(APP_TOOLS)) {
			const shape = args.shape as Record<string, unknown>;
			const declared = Object.fromEntries(
				Object.keys(shape).map((key) => [key, undefined]),
			);
			const parsed = args.safeParse({ ...declared, stray: true });
			expect(
				parsed.success ? [] : parsed.error.issues.map((i) => i.code),
				name,
			).toContain("unrecognized_keys");
		}
	});

	it("caps a created draft's suggested amounts at six, as the chat's preset is", () => {
		const usd = (amount: string) => ({ amount, currency: "USD" });
		const preset = {
			theme: "year_end",
			title: "Year-End 2026",
			goal: usd("5000.00"),
			endDate: "2026-12-31",
			suggestedAmounts: Array.from({ length: 6 }, (_, i) =>
				usd(`${i + 1}0.00`),
			),
		};
		const { args } = APP_TOOLS.app_create_campaign;
		expect(args.safeParse(preset).success).toBe(true);
		expect(
			args.safeParse({
				...preset,
				suggestedAmounts: [...preset.suggestedAmounts, usd("70.00")],
			}).success,
		).toBe(false);
	});

	it("reads the create result's steps and the step that failed", () => {
		const out = APP_TOOLS.app_create_campaign.result.parse({
			campaign: { id: "c9", title: "Year-end appeal", status: "draft" },
			steps: [
				{ step: "create", status: "done" },
				{ step: "settings", status: "failed", detail: "Goal too large." },
				{ step: "form", status: "skipped" },
				{ step: "page", status: "skipped" },
			],
			failedStep: "settings",
		});
		expect(out.failedStep).toBe("settings");
		expect(
			APP_TOOLS.app_create_campaign.result.safeParse({
				...out,
				failedStep: "publish",
			}).success,
		).toBe(false);
	});

	it("reads a create result's replayed flag, and a result without one", () => {
		const result = {
			campaign: { id: "c9", title: "Year-end appeal", status: "draft" },
			steps: [{ step: "create", status: "done" }],
			failedStep: null,
		};
		const parse = (r: object) => APP_TOOLS.app_create_campaign.result.parse(r);
		expect(parse({ ...result, replayed: true }).replayed).toBe(true);
		expect(parse(result).replayed).toBeUndefined();
	});
});
