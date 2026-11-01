// The campaign presets' templates, connector-side. Pure and browser-safe: the
// widgets under src/widgets import it too, so nothing here may import a node
// or server module.

export const THEME_NAMES = [
	"emergency",
	"year_end",
	"capital",
	"giving_day",
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export type Money = { amount: string; currency: "USD" };

export type Theme = {
	label: string;
	/** What a title for this kind of appeal starts with, for a form to offer. */
	titlePrefix: string;
	/** Placeholder paragraphs separated by a blank line, worded for the operator to replace: no fact about the organization. */
	story: string;
	goal: Money;
	/** How many days after today the campaign ends. */
	endDays: number;
	suggestedAmounts: Money[];
};

const usd = (dollars: number): Money => ({
	amount: dollars.toFixed(2),
	currency: "USD",
});
const amounts = (...dollars: number[]) => dollars.map(usd);

export const THEMES: Record<ThemeName, Theme> = {
	emergency: {
		label: "Emergency appeal",
		titlePrefix: "Emergency appeal:",
		story: [
			"[Say what happened, and when.]",
			"[Say who needs help now, and what your team is doing about it.]",
			"[Say what a gift pays for today.]",
		].join("\n\n"),
		goal: usd(25_000),
		endDays: 30,
		suggestedAmounts: amounts(25, 50, 100, 250, 500),
	},
	year_end: {
		label: "Year-end giving",
		titlePrefix: "Year-end appeal:",
		story: [
			"[Say what this year's gifts made possible.]",
			"[Say what you plan for next year.]",
			"[Say what a gift before the year closes will do.]",
		].join("\n\n"),
		goal: usd(50_000),
		endDays: 45,
		suggestedAmounts: amounts(50, 100, 250, 500, 1000),
	},
	capital: {
		label: "Capital campaign",
		titlePrefix: "Capital campaign:",
		story: [
			"[Say what you are building or buying, and why.]",
			"[Say who it will serve, and for how long.]",
			"[Say how far along the campaign is, and what is left to raise.]",
		].join("\n\n"),
		goal: usd(250_000),
		endDays: 180,
		suggestedAmounts: amounts(100, 250, 500, 1000, 5000),
	},
	giving_day: {
		label: "Giving day",
		titlePrefix: "Giving day:",
		story: [
			"[Say what today is, and why it matters to you.]",
			"[Say what you hope to raise by the end of the day.]",
			"[Say what a gift today will do.]",
		].join("\n\n"),
		goal: usd(10_000),
		endDays: 2,
		suggestedAmounts: amounts(10, 25, 50, 100, 250),
	},
};

/** A plain-text story as the content model's rich-text `story`: one paragraph per blank-line-separated part. */
export const storyDocument = (story: string) => ({
	type: "doc",
	content: story.split("\n\n").map((text) => ({
		type: "paragraph",
		content: [{ type: "text", text }],
	})),
});
