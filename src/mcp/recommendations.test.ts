import { expect, test } from "vitest";
import { type History, recommend } from "./recommendations";

const usd = (amount: string) => ({ amount, currency: "USD" });
const EMPTY: History = { pastCampaigns: [], gifts: [] };

test("an org with no history gets the year-end defaults as starting points", () => {
	expect(recommend(EMPTY, { locale: "en-US" })).toEqual({
		basedOnHistory: false,
		goal: {
			value: usd("50000.00"),
			evidence:
				"$50,000.00 is a common starting goal for a year-end appeal; there isn't enough history yet to base one on yours.",
		},
		suggestedAmounts: {
			value: ["50.00", "100.00", "250.00", "500.00", "1000.00"].map(usd),
			evidence:
				"These are common amounts for a year-end appeal; there isn't enough history yet to base them on your gifts.",
		},
		endDays: {
			value: 45,
			evidence:
				"45 days is a common run for a year-end appeal; there isn't enough history yet to base one on yours.",
		},
		theme: {
			value: "year_end",
			evidence:
				"There isn't enough history yet to point to one kind of appeal, so a year-end appeal is a starting point.",
		},
	});
});

test("a theme asked for, below the threshold, is that theme's defaults", () => {
	const got = recommend(EMPTY, { theme: "giving_day", locale: "en-US" });

	expect(got.basedOnHistory).toBe(false);
	expect(got.theme).toEqual({
		value: "giving_day",
		evidence: "You asked for a giving day.",
	});
	expect(got.goal.value).toEqual(usd("10000.00"));
	expect(got.endDays.value).toBe(2);
});

const past = (id: string, title: string, total: string) => ({
	id,
	title,
	total: usd(total),
});

test("two past campaigns are enough history: the goal is their median raised, rounded to a clean figure", () => {
	const history: History = {
		pastCampaigns: [
			past("c1", "Spring meals", "12400.00"),
			past("c2", "Summer camp", "30050.00"),
			past("c3", "Food pantry", "18200.00"),
		],
		gifts: [],
	};

	expect(recommend(history, { locale: "en-US" })).toEqual({
		basedOnHistory: true,
		goal: {
			value: usd("18000.00"),
			evidence: "Your 3 past campaigns raised a median of $18,200.00.",
		},
		suggestedAmounts: {
			value: ["50.00", "100.00", "250.00", "500.00", "1000.00"].map(usd),
			evidence:
				"These are common amounts for a year-end appeal; your gifts so far are too few to base them on.",
		},
		endDays: {
			value: 45,
			evidence:
				"45 days is a common run for a year-end appeal; your past campaigns' gifts don't show how long they ran.",
		},
		theme: {
			value: "year_end",
			evidence:
				"None of your past campaign titles point to one kind of appeal, so a year-end appeal is a starting point.",
		},
	});
});

const gift = (amount: string, date = "2026-03-01", campaignId: string | null = null) => ({
	amount: usd(amount),
	date,
	campaignId,
});
// 25 gifts, ascending; the nearest-rank 10th, 25th, 50th, 75th, 90th and
// 98th percentiles are 18, 27, 52, 110, 260 and 1100.
const GIFTS_25 = [
	10, 15, 18, 20, 22, 25, 27, 30, 35, 40, 45, 50, 52, 60, 70, 75, 90, 100, 110,
	150, 200, 240, 260, 500, 1100,
].map((d) => gift(d.toFixed(2)));

test("25 gifts are enough history: the amounts are their percentiles snapped to clean figures", () => {
	const got = recommend(
		{ pastCampaigns: [], gifts: GIFTS_25 },
		{ locale: "en-US" },
	);

	expect(got.basedOnHistory).toBe(true);
	expect(got.suggestedAmounts).toEqual({
		value: ["20.00", "25.00", "50.00", "100.00", "250.00", "1000.00"].map(usd),
		evidence:
			"Your 25 gifts had a median of $52.00, and 9 in 10 were $260.00 or less.",
	});
	expect(got.goal).toEqual({
		value: usd("50000.00"),
		evidence:
			"$50,000.00 is a common starting goal for a year-end appeal; you have no ended campaign that raised money to base one on.",
	});
});

test("24 gifts and one past campaign are below the threshold", () => {
	const got = recommend(
		{
			pastCampaigns: [past("c1", "Spring meals", "9000.00")],
			gifts: GIFTS_25.slice(1),
		},
		{ locale: "en-US" },
	);

	expect(got.basedOnHistory).toBe(false);
	expect(got.goal.value).toEqual(usd("50000.00"));
});

test("gifts that snap to fewer than three clean amounts leave the theme's amounts", () => {
	const gifts = Array.from({ length: 30 }, (_, i) =>
		gift(i % 2 === 0 ? "48.00" : "52.00"),
	);

	const got = recommend({ pastCampaigns: [], gifts }, { locale: "en-US" });

	expect(got.suggestedAmounts.value).toEqual(
		["50.00", "100.00", "250.00", "500.00", "1000.00"].map(usd),
	);
});

// Two year-end appeals (47 and 31 days of gifts) and one flood appeal (a day).
const SEASONAL: History = {
	pastCampaigns: [
		past("c1", "Year-End Appeal 2024", "40000.00"),
		past("c2", "Holiday giving 2025", "20000.00"),
		past("c3", "Flood relief", "15000.00"),
	],
	gifts: [
		gift("100.00", "2024-11-15", "c1"),
		gift("250.00", "2024-12-31T23:10:00Z", "c1"),
		gift("50.00", "2025-12-01", "c2"),
		gift("75.00", "2025-12-31", "c2"),
		gift("500.00", "2025-06-01", "c3"),
	],
};

test("the theme is the kind of appeal the titles name that raised the most", () => {
	expect(recommend(SEASONAL, { locale: "en-US" }).theme).toEqual({
		value: "year_end",
		evidence:
			"2 of your past campaigns were year-end appeals, raising $60,000.00 together.",
	});
});

test("the run length is the median span of gifts to past campaigns of that theme, snapped to a clean figure", () => {
	expect(recommend(SEASONAL, { locale: "en-US" }).endDays).toEqual({
		value: 45,
		evidence:
			"Your 2 past year-end appeals took gifts over a median of 39 days.",
	});
});

test("with no theme in the titles, the run length is every past campaign's", () => {
	const history: History = {
		pastCampaigns: [
			past("c1", "Spring meals", "1000.00"),
			past("c2", "Summer camp", "2000.00"),
		],
		gifts: [
			gift("10.00", "2025-03-01", "c1"),
			gift("10.00", "2025-03-20", "c1"),
			gift("10.00", "2025-06-01", "c2"),
			gift("10.00", "2025-06-24", "c2"),
		],
	};

	expect(recommend(history, { locale: "en-US" }).endDays).toEqual({
		value: 21,
		evidence: "Your 2 past campaigns took gifts over a median of 22 days.",
	});
});

test("a theme asked for that no past campaign was keeps that theme's run length, and the goal still comes from history", () => {
	const got = recommend(SEASONAL, { theme: "giving_day", locale: "en-US" });

	expect(got.theme.evidence).toBe("You asked for a giving day.");
	expect(got.endDays).toEqual({
		value: 2,
		evidence:
			"2 days is a common run for a giving day; none of your past campaigns was one to time it by.",
	});
	expect(got.goal.value).toEqual(usd("20000.00"));
});

test("money keeps the gifts' currency, unconverted, and reads in the request locale", () => {
	const eur = (amount: string) => ({ amount, currency: "EUR" });
	const history: History = {
		pastCampaigns: [
			{ id: "c1", title: "Frühjahr", total: eur("12400.00") },
			{ id: "c2", title: "Sommer", total: eur("18240.00") },
			// another currency is left out, never converted
			{ id: "c3", title: "Herbst", total: usd("99000.00") },
		],
		gifts: GIFTS_25.map((g) => ({ ...g, amount: eur(g.amount.amount) })),
	};

	const got = recommend(history, { locale: "de-DE" });

	expect(got.goal).toEqual({
		value: eur("15000.00"),
		evidence: "Your 2 past campaigns raised a median of 15.320,00\u00a0€.",
	});
	expect(got.suggestedAmounts.value.map((m) => m.currency)).toEqual(
		Array(6).fill("EUR"),
	);
	expect(got.suggestedAmounts.evidence).toBe(
		"Your 25 gifts had a median of 52,00\u00a0€, and 9 in 10 were 260,00\u00a0€ or less.",
	);
});
