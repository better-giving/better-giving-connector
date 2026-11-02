// The data each widget is rendered with in tests and screenshots. A fixture
// is one state of one widget: the render tool's result, and the answers to
// the tools its buttons call. Add a widget's states under its name; the
// screenshot script renders every one (scripts/widget-shots.ts).

import type {
	CampaignCreateData,
	CampaignEditorData,
	CampaignResultsData,
	CampaignsData,
	PhotoData,
	WidgetName,
} from "../../src/widgets/model";

/** A render tool's result as the host delivers it, or the sentence it failed with. */
export type ToolReply =
	| { structuredContent: Record<string, unknown>; text?: string }
	| { error: string };

export type Fixture = {
	result: ToolReply;
	/** How the host first shows the widget; inline unless the render tool opens fullscreen. */
	displayMode?: "inline" | "fullscreen";
	toolInput?: Record<string, unknown>;
	/** Scripted answers to `callServerTool`, by tool name. */
	calls?: Record<string, (args: Record<string, unknown>) => ToolReply>;
	/** Buttons the screenshot presses, by accessible name, once the widget has rendered. */
	click?: string[];
	/** The chat column's width in px, where it isn't the default. */
	column?: number;
};

export const IMAGE_ORIGINS = [
	"https://app.connect.better.giving",
	"https://*.public.blob.vercel-storage.com",
];

/** An image the screenshot host serves (any path under this origin draws a photo stand-in). */
export const blobImage = (name: string) =>
	`https://bg-test.public.blob.vercel-storage.com/${name}.jpg`;

const usd = (amount: string) => ({ amount, currency: "USD" });

export const CAMPAIGNS: CampaignsData = {
	currency: "USD",
	imageOrigins: IMAGE_ORIGINS,
	campaigns: [
		{
			id: "c-winter",
			title: "Winter coat drive",
			status: "published",
			goal: usd("5000.00"),
			raised: usd("3240.50"),
			donors: 87,
			endDate: "2026-12-15",
			imageUrl: blobImage("coats"),
			url: "https://give.harborfoodbank.org/winter-coats",
		},
		{
			id: "c-gala",
			title: "Spring gala 2026",
			status: "ended",
			goal: usd("10000.00"),
			raised: usd("12300.00"),
			donors: 214,
			endDate: "2026-05-01",
			imageUrl: blobImage("gala"),
			url: "https://give.harborfoodbank.org/spring-gala",
		},
		{
			id: "c-yearend",
			title: "Year-end appeal: Keep the pantry full",
			status: "draft",
			goal: usd("50000.00"),
			raised: usd("0.00"),
			donors: 0,
			endDate: "2026-12-31",
			imageUrl: null,
			url: null,
		},
		{
			id: "c-roof",
			title: "Library roof repair",
			status: "published",
			goal: usd("250000.00"),
			raised: usd("81250.00"),
			donors: 402,
			endDate: null,
			// outside the image origins: renders the placeholder
			imageUrl: "https://images.example.com/roof.jpg",
			url: "https://give.harborfoodbank.org/roof",
		},
		{
			id: "c-tuesday",
			title:
				"Giving Tuesday neighbor-to-neighbor match for families across the harbor district",
			status: "published",
			goal: null,
			raised: usd("1875.00"),
			donors: 1,
			endDate: "2026-12-02",
			imageUrl: blobImage("tuesday"),
			url: "https://give.harborfoodbank.org/giving-tuesday",
		},
	],
};

const day = (back: number) =>
	new Date(Date.UTC(2026, 10, 2 - back)).toISOString().slice(0, 10);
const DAILY = [0, 120, 80, 0, 240, 60, 0, 150, 310, 90, 40, 0, 220, 380].map(
	(n, i) => ({ date: day(13 - i), total: usd(`${n}.00`) }),
);

export const CREATE: CampaignCreateData = {
	selected: "emergency",
	presets: [
		{
			theme: "emergency",
			title: "Storm relief — Visayas",
			goal: usd("25000.00"),
			endDate: "2026-12-15",
			suggestedAmounts: [
				usd("25.00"),
				usd("50.00"),
				usd("100.00"),
				usd("250.00"),
			],
		},
		{
			theme: "year_end",
			title: "Year-end appeal 2026",
			goal: usd("60000.00"),
			endDate: "2026-12-31",
			suggestedAmounts: [
				usd("50.00"),
				usd("100.00"),
				usd("250.00"),
				usd("500.00"),
			],
		},
		{
			theme: "capital",
			title: "New learning center",
			goal: usd("250000.00"),
			endDate: "2027-06-30",
			suggestedAmounts: [
				usd("100.00"),
				usd("500.00"),
				usd("1000.00"),
				usd("5000.00"),
			],
		},
		{
			theme: "giving_day",
			title: "GivingTuesday 2026",
			goal: usd("15000.00"),
			endDate: "2026-12-02",
			suggestedAmounts: [
				usd("20.00"),
				usd("40.00"),
				usd("75.00"),
				usd("150.00"),
			],
		},
	],
	recommendations: {
		basedOnHistory: true,
		goal: {
			value: usd("25000.00"),
			evidence: "Last emergency raised $21,480 in 18 days.",
		},
		suggestedAmounts: {
			value: [usd("50.00")],
			evidence: "38% of 412 gifts — put it 2nd.",
		},
		endDays: {
			value: 21,
			evidence: "82% of gifts came in the first 14 days.",
		},
		theme: {
			value: "emergency",
			evidence: "You started this from an emergency request.",
		},
	},
};

export const RESULTS_LIVE: CampaignResultsData = {
	campaign: {
		id: "c-winter",
		title: "Winter coat drive",
		status: "published",
		goal: usd("5000.00"),
		endDate: "2026-12-15",
		url: "https://give.harborfoodbank.org/winter-coats",
		version: "14",
	},
	raised: usd("3240.50"),
	donors: 87,
	giftCount: 102,
	averageGift: usd("31.77"),
	medianGift: usd("25.00"),
	daily: DAILY,
	readiness: [],
	programs: [],
	giftsGoTo: null,
	pendingDraft: false,
};

// The states the screenshots show, with the approved mockup's numbers.
const SHOT_DAILY = [
	400, 500, 450, 600, 520, 687, 600, 600, 640, 700, 720, 760, 780, 760,
].map((n, i) => ({ date: day(13 - i), total: usd(`${n}.00`) }));

const SHOT_LIVE: CampaignResultsData = {
	...RESULTS_LIVE,
	campaign: {
		...RESULTS_LIVE.campaign,
		id: "c-storm",
		title: "Storm relief — Visayas",
		goal: usd("25000.00"),
		endDate: "2026-12-15",
	},
	raised: usd("18420.00"),
	donors: 214,
	giftCount: 214,
	averageGift: usd("86.07"),
	medianGift: usd("50.00"),
	daily: SHOT_DAILY,
};

const SHOT_DRAFT: CampaignResultsData = {
	...SHOT_LIVE,
	campaign: { ...SHOT_LIVE.campaign, status: "draft", url: null, version: "3" },
	raised: usd("0.00"),
	donors: 0,
	giftCount: 0,
	averageGift: null,
	medianGift: null,
	daily: SHOT_DAILY.map((d) => ({ ...d, total: usd("0.00") })),
	readiness: [
		{ id: "photo", label: "Cover photo", done: true },
		{ id: "story", label: "Story", done: true },
		{ id: "goal", label: "Goal & end date", done: true },
		{ id: "amounts", label: "Gift amounts", done: true },
	],
	programs: [{ id: "p-disaster", name: "Disaster response fund" }],
	giftsGoTo: "p-disaster",
};

export const EDITOR: CampaignEditorData = {
	orgName: "Harbor Food Bank",
	campaign: {
		id: "c-winter",
		title: "Winter coat drive",
		status: "draft",
		version: "14",
		url: null,
	},
	page: {
		pageKind: "blocks",
		blocks: [
			{
				type: "hero",
				imageUrl: blobImage("coats"),
				alt: "Volunteers sorting coats",
			},
			{
				type: "story",
				heading: "Every neighbor deserves a warm coat",
				body: "Winter is coming and 300 families on our list have no coat.\n\nYour gift buys a new coat and a pair of gloves.",
			},
			{ type: "goal" },
			{ type: "donate" },
			{
				type: "faq",
				heading: "Questions",
				q1: "Where do the coats go? To families on our waiting list.",
			},
		],
	},
	pendingDraft: false,
	formAmounts: [usd("25.00"), usd("50.00"), usd("100.00")],
	imageOrigins: IMAGE_ORIGINS,
	images: {},
};

export const PHOTO: PhotoData = {
	campaign: { id: "c-winter", title: "Winter coat drive" },
	current: { url: blobImage("old-cover"), alt: "Coats on a rack" },
	file: {
		name: "volunteers.jpg",
		size: 2_400_000,
		type: "image/jpeg",
		previewUrl: blobImage("volunteers"),
		downloadUrl: "https://files.example.org/volunteers.jpg",
	},
	suggestedAlt: "Volunteers sorting winter coats into boxes",
	uploadUrl: "https://give.harborfoodbank.org/photo-upload/tok",
	canUpload: true,
	imageOrigins: IMAGE_ORIGINS,
};

export const FIXTURES: Partial<Record<WidgetName, Record<string, Fixture>>> = {
	campaigns: {
		five: { result: { structuredContent: CAMPAIGNS }, column: 1040 },
		empty: {
			result: {
				structuredContent: { ...CAMPAIGNS, campaigns: [] },
			},
		},
		error: {
			result: {
				error:
					"Better Giving didn't answer. Try again in a minute, or check that the site is up.",
			},
		},
	},
	"campaign-create": {
		presets: { result: { structuredContent: CREATE } },
		starting: {
			result: {
				structuredContent: {
					...CREATE,
					recommendations: { ...CREATE.recommendations, basedOnHistory: false },
				},
			},
		},
	},
	"campaign-results": {
		draft: { result: { structuredContent: SHOT_DRAFT } },
		live: { result: { structuredContent: SHOT_LIVE } },
		"end-confirm": {
			result: { structuredContent: SHOT_LIVE },
			click: ["End campaign"],
		},
	},
	"campaign-editor": {
		blocks: {
			result: { structuredContent: EDITOR },
			displayMode: "fullscreen",
		},
	},
	photo: {
		dropped: {
			result: { structuredContent: PHOTO },
			calls: {
				get_profile: () => ({
					structuredContent: { id: "u1", name: "Harbor Food Bank" },
				}),
			},
		},
		none: {
			result: {
				structuredContent: { ...PHOTO, file: null, canUpload: false },
			},
			calls: {
				get_profile: () => ({
					structuredContent: { id: "u1", name: "Harbor Food Bank" },
				}),
			},
		},
	},
};
