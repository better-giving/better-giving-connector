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
	calls?: Record<
		string,
		(args: Record<string, unknown>) => ToolReply | Promise<ToolReply>
	>;
	/** How the host answers a file the widget hands it: saved unless refused (the person cancelled) or failed (the request errors). */
	save?: "refused" | "failed";
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

/** The photo-like SVG the screenshot and preview hosts serve for an image at `path`; the path picks its hues. */
export function standInImage(path: string): string {
	let hue = 0;
	for (const char of path) hue = (hue * 31 + char.charCodeAt(0)) % 360;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 16 9">
<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 32%)"/></linearGradient></defs>
<rect width="16" height="9" fill="url(#g)"/><circle cx="12" cy="2.6" r="1.2" fill="hsl(48 90% 85%)"/>
<path d="M0 9 5 4.5 8.5 7.5 11 5.5 16 9Z" fill="hsl(${hue} 30% 20% / .55)"/></svg>`;
}

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
	orgName: "Bayanihan Relief Network",
	campaign: {
		id: "c-storm",
		title: "Storm relief — Visayas",
		status: "draft",
		version: "14",
		url: null,
	},
	page: {
		pageKind: "blocks",
		blocks: [
			{
				type: "hero",
				imageUrl: blobImage("storm"),
				alt: "A house after the flood",
			},
			{
				type: "story",
				heading: "Storm relief — Visayas",
				body: "Typhoon Ofel flooded Brgy. San Roque and Brgy. Malinao on Oct 28. 640 families lost food stocks and school supplies.\n\nYour gift puts a 5-day family food pack and clean water on a truck this week.",
			},
			{ type: "goal" },
			{ type: "donate" },
			{
				type: "faq",
				heading: "Questions",
				q1: "Where does my gift go?",
			},
		],
	},
	pendingDraft: false,
	draftRevision: null,
	draftsLiveEdits: true,
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

const nonprofit = (
	id: string,
	name: string,
	over: { current?: boolean; logo_url?: string; can_manage?: boolean } = {},
) => ({ id, name, role: "admin", can_manage: true, current: false, ...over });

/** The photo card with no dropped file, and the nonprofits list_nonprofits answers. */
const accountWith = (rows: ReturnType<typeof nonprofit>[]): Fixture => ({
	result: { structuredContent: { ...PHOTO, file: null, canUpload: false } },
	calls: {
		get_profile: () => ({
			structuredContent: { id: "u1", name: "Bayanihan Relief Network" },
		}),
		list_nonprofits: () => ({
			structuredContent: { data: rows, next_cursor: null },
		}),
	},
});

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
		"live-flat": {
			result: {
				structuredContent: {
					...SHOT_LIVE,
					daily: SHOT_LIVE.daily.map((d) => ({ ...d, total: usd("600.00") })),
				},
			},
		},
		"live-down": {
			result: {
				structuredContent: {
					...SHOT_LIVE,
					daily: SHOT_LIVE.daily.map((d, i, all) => ({
						...d,
						total: all[all.length - 1 - i]?.total ?? d.total,
					})),
				},
			},
		},
		"end-confirm": {
			result: { structuredContent: SHOT_LIVE },
			click: ["End campaign"],
		},
	},
	"campaign-editor": {
		blocks: {
			result: { structuredContent: EDITOR },
			displayMode: "fullscreen",
			click: ["Title & story"],
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
		account: {
			result: {
				structuredContent: { ...PHOTO, file: null, canUpload: false },
			},
			calls: {
				get_profile: () => ({
					structuredContent: { id: "u1", name: "Bayanihan Relief Network" },
				}),
			},
		},
		"account-three": accountWith([
			nonprofit("101", "Bayanihan Relief Network", {
				current: true,
				logo_url: blobImage("bayanihan-logo"),
			}),
			nonprofit("102", "Harbor Food Bank"),
			nonprofit("103", "Casa de Esperanza"),
		]),
		"account-long": accountWith([
			nonprofit("101", "Bayanihan Relief Network", { current: true }),
			...[
				"Casa de Esperanza",
				"Harbor Food Bank",
				"Lakeshore Animal Rescue",
				"Maple Street Pantry",
				"Northside Youth Choir",
				"Open Door Clinic",
				"Riverbend Library Friends",
				"Sunrise Senior Center",
				"Tri-County Literacy",
			].map((name, n) => nonprofit(String(102 + n), name)),
		]),
		"account-single": accountWith([
			nonprofit("101", "Bayanihan Relief Network", { current: true }),
		]),
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

/** The fixture for `state` of `widget`, where either may be a name from outside (a URL). */
export function findFixture(
	widget: string,
	state: string,
): Fixture | undefined {
	// own keys only: `constructor` and the rest of Object.prototype are not states
	const states = Object.hasOwn(FIXTURES, widget)
		? FIXTURES[widget as WidgetName]
		: undefined;
	return states && Object.hasOwn(states, state) ? states[state] : undefined;
}
