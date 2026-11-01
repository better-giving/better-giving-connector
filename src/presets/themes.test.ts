import { expect, test } from "vitest";
import { THEME_NAMES, THEMES, storyDocument } from "./themes";

test("each theme's defaults: goal, run length and suggested amounts", () => {
	expect(
		Object.fromEntries(
			THEME_NAMES.map((name) => {
				const t = THEMES[name];
				return [
					name,
					[
						t.goal.amount,
						t.endDays,
						t.suggestedAmounts.map((m) => m.amount).join("/"),
					],
				];
			}),
		),
	).toEqual({
		emergency: ["25000.00", 30, "25.00/50.00/100.00/250.00/500.00"],
		year_end: ["50000.00", 45, "50.00/100.00/250.00/500.00/1000.00"],
		capital: ["250000.00", 180, "100.00/250.00/500.00/1000.00/5000.00"],
		giving_day: ["10000.00", 2, "10.00/25.00/50.00/100.00/250.00"],
	});
	for (const name of THEME_NAMES) {
		expect(THEMES[name].goal.currency).toBe("USD");
		expect(THEMES[name].label).toMatch(/\S/);
		expect(THEMES[name].titlePrefix).toMatch(/\S/);
	}
});

test("a story scaffold is plain text the operator edits, and the same paragraphs as a rich-text document", () => {
	const { story } = THEMES.emergency;

	const doc = storyDocument(story);

	expect(story).toContain("\n\n");
	expect(doc).toEqual({
		type: "doc",
		content: story.split("\n\n").map((text) => ({
			type: "paragraph",
			content: [{ type: "text", text }],
		})),
	});
});
