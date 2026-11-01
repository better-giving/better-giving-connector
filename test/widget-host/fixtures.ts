// The data each widget is rendered with in tests and screenshots. A fixture
// is one state of one widget: the render tool's result, and the answers to
// the tools its buttons call. Add a widget's states under its name; the
// screenshot script renders every one (scripts/widget-shots.ts).

import type { CampaignsData, WidgetName } from "../../src/widgets/model";

/** A render tool's result as the host delivers it, or the sentence it failed with. */
export type ToolReply =
	| { structuredContent: Record<string, unknown>; text?: string }
	| { error: string };

export type Fixture = {
	result: ToolReply;
	toolInput?: Record<string, unknown>;
	/** Scripted answers to `callServerTool`, by tool name. */
	calls?: Record<string, (args: Record<string, unknown>) => ToolReply>;
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

export const FIXTURES: Partial<Record<WidgetName, Record<string, Fixture>>> = {
	campaigns: {
		five: { result: { structuredContent: CAMPAIGNS } },
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
};
