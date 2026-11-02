import { formatMoney } from "../format";
import { THEME_NAMES, THEMES, type ThemeName } from "../presets/themes";

/** An amount in its own currency, as the deployment sends money. */
export type Money = { amount: string; currency: string };

/** What the recommendations are drawn from: the org's ended campaigns and the gifts read. */
export type History = {
	pastCampaigns: { id: string; title: string; total: Money | null }[];
	gifts: { amount: Money; date: string; campaignId: string | null }[];
};

export type Recommendation<T> = { value: T; evidence: string };

export type Recommendations = {
	/** False: too little history, so every value is its theme's default. */
	basedOnHistory: boolean;
	goal: Recommendation<Money>;
	/** Ascending, at most six, in one currency. */
	suggestedAmounts: Recommendation<Money[]>;
	/** Days from publish to the end date. */
	endDays: Recommendation<number>;
	theme: Recommendation<ThemeName>;
};

export const DEFAULT_THEME: ThemeName = "year_end";
/** History is used from this many ended campaigns, or from MIN_GIFTS gifts. */
export const MIN_PAST_CAMPAIGNS = 2;
export const MIN_GIFTS = 25;

// How a sentence names one appeal of a theme, and several.
type Noun = { an: string; one: string; many: string };
const KIND: Record<ThemeName, Noun> = {
	emergency: {
		an: "an emergency appeal",
		one: "emergency appeal",
		many: "emergency appeals",
	},
	year_end: {
		an: "a year-end appeal",
		one: "year-end appeal",
		many: "year-end appeals",
	},
	capital: {
		an: "a capital campaign",
		one: "capital campaign",
		many: "capital campaigns",
	},
	giving_day: { an: "a giving day", one: "giving day", many: "giving days" },
};
/** "a year-end appeal": one appeal of `theme`, as a sentence names it. */
export const anAppeal = (theme: ThemeName) => KIND[theme].an;
const CAMPAIGN: Noun = { an: "a campaign", one: "campaign", many: "campaigns" };

const NOT_ENOUGH = "there isn't enough history yet";

/**
 * A new campaign's goal, suggested amounts, run length and theme, each with
 * the sentence that says where it came from. Deterministic: the same history
 * gives the same answer. Below the history threshold every field is the
 * theme's default; above it, a field its history can't support still is,
 * and its evidence says why.
 */
export function recommend(
	history: History,
	opts: { theme?: ThemeName; locale: string },
): Recommendations {
	const { locale } = opts;
	const basedOnHistory =
		history.pastCampaigns.length >= MIN_PAST_CAMPAIGNS ||
		history.gifts.length >= MIN_GIFTS;
	const theme = opts.theme ?? DEFAULT_THEME;
	const asked =
		opts.theme === undefined ? null : `You asked for ${KIND[theme].an}.`;
	if (!basedOnHistory) {
		return {
			basedOnHistory,
			goal: defaultGoal(theme, locale, `${NOT_ENOUGH} to base one on yours`),
			suggestedAmounts: defaultAmounts(
				theme,
				`${NOT_ENOUGH} to base them on your gifts`,
			),
			endDays: defaultEndDays(theme, `${NOT_ENOUGH} to base one on yours`),
			theme: {
				value: theme,
				evidence:
					asked ??
					`There isn't enough history yet to point to one kind of appeal, so ${KIND[theme].an} is a starting point.`,
			},
		};
	}
	const currency = currencyOf(history);
	const inferred =
		opts.theme === undefined ? themeFrom(history, currency, locale) : null;
	const chosen = inferred?.value ?? theme;
	return {
		basedOnHistory,
		goal:
			goalFrom(history, currency, locale) ??
			defaultGoal(
				chosen,
				locale,
				"you have no ended campaign that raised money to base one on",
			),
		suggestedAmounts:
			amountsFrom(history, currency, locale) ??
			defaultAmounts(chosen, "your gifts so far are too few to base them on"),
		endDays: endDaysFrom(history, chosen, opts.theme !== undefined),
		theme: inferred ?? {
			value: theme,
			evidence:
				asked ??
				`None of your past campaign titles point to one kind of appeal, so ${KIND[theme].an} is a starting point.`,
		},
	};
}

// What a past campaign's title says it was. A title matching no theme, or
// more than one, says nothing.
const TITLE_WORDS: Record<ThemeName, RegExp> = {
	emergency:
		/\b(emergency|urgent|relief|disaster|crisis|flood|fire|wildfire|hurricane|earthquake|storm)\b/i,
	year_end: /\b(year[- ]end|end[- ]of[- ](the[- ])?year|holiday|december)\b/i,
	capital: /\b(capital|building|construction|renovation|expansion|new home)\b/i,
	giving_day:
		/\b(giving day|giving tuesday|givingtuesday|day of giving|match day|24 hours)\b/i,
};

function themeOfTitle(title: string): ThemeName | null {
	const named = THEME_NAMES.filter((t) => TITLE_WORDS[t].test(title));
	return named.length === 1 ? (named[0] as ThemeName) : null;
}

const ofTheme = (history: History, theme: ThemeName) =>
	history.pastCampaigns.filter((k) => themeOfTitle(k.title) === theme);

/** The theme whose past campaigns raised the most together; ties go to the more campaigns, then THEME_NAMES' order. */
function themeFrom(
	history: History,
	currency: string,
	locale: string,
): Recommendation<ThemeName> | null {
	let best: { theme: ThemeName; n: number; raised: number } | null = null;
	for (const theme of THEME_NAMES) {
		const ks = ofTheme(history, theme);
		if (ks.length === 0) continue;
		const raised = ks.reduce(
			(sum, k) => sum + (k.total?.currency === currency ? cents(k.total) : 0),
			0,
		);
		if (
			best === null ||
			raised > best.raised ||
			(raised === best.raised && ks.length > best.n)
		)
			best = { theme, n: ks.length, raised };
	}
	if (best === null) return null;
	const together = shown(fromCents(best.raised, currency), locale);
	return {
		value: best.theme,
		evidence:
			best.n === 1
				? `One of your past campaigns was ${KIND[best.theme].an}, raising ${together}.`
				: `${best.n} of your past campaigns were ${KIND[best.theme].many}, raising ${together} together.`,
	};
}

// Clean run lengths, in days.
const DAY_LADDER = [1, 2, 3, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180, 365];
const DAY_MS = 86_400_000;

/**
 * The median span, first gift to last, of the past campaigns of `theme`;
 * with none and no theme asked for, of every past campaign. Calendar days
 * in UTC, both ends counted.
 */
function endDaysFrom(
	history: History,
	theme: ThemeName,
	asked: boolean,
): Recommendation<number> {
	const spanOf = new Map<string, { first: number; last: number }>();
	for (const g of history.gifts) {
		const day = Math.floor(Date.parse(g.date) / DAY_MS);
		if (g.campaignId === null || Number.isNaN(day)) continue;
		const span = spanOf.get(g.campaignId);
		spanOf.set(g.campaignId, {
			first: Math.min(span?.first ?? day, day),
			last: Math.max(span?.last ?? day, day),
		});
	}
	const spans = (ks: History["pastCampaigns"]) =>
		ks.flatMap((k) => {
			const span = spanOf.get(k.id);
			return span ? [span.last - span.first + 1] : [];
		});
	const themed = spans(ofTheme(history, theme));
	if (themed.length > 0) return runOf(themed, KIND[theme]);
	// A theme asked for keeps its own run: a giving day isn't timed by a month-long appeal.
	if (asked)
		return defaultEndDays(
			theme,
			"none of your past campaigns was one to time it by",
		);
	const all = spans(history.pastCampaigns);
	if (all.length > 0) return runOf(all, CAMPAIGN);
	return defaultEndDays(
		theme,
		"your past campaigns' gifts don't show how long they ran",
	);
}

function runOf(spans: number[], noun: Noun): Recommendation<number> {
	const mid = median(spans) as number;
	return {
		value: nearestByRatio(DAY_LADDER, mid),
		evidence:
			spans.length === 1
				? `Your past ${noun.one} took gifts over ${mid} days.`
				: `Your ${spans.length} past ${noun.many} took gifts over a median of ${mid} days.`,
	};
}

function goalFrom(
	history: History,
	currency: string,
	locale: string,
): Recommendation<Money> | null {
	const raised = history.pastCampaigns.flatMap((k) =>
		k.total?.currency === currency ? [cents(k.total)] : [],
	);
	const mid = median(raised);
	if (mid === null || mid <= 0) return null;
	const n = raised.length;
	return {
		value: money(roundToTwoFigures(mid / 100), currency),
		evidence:
			n === 1
				? `Your past campaign raised ${shown(fromCents(mid, currency), locale)}.`
				: `Your ${n} past campaigns raised a median of ${shown(fromCents(mid, currency), locale)}.`,
	};
}

// Nearest-rank percentiles of the gifts, each snapped to a clean figure.
const AMOUNT_PERCENTILES = [0.1, 0.25, 0.5, 0.75, 0.9, 0.98];
/** Fewer distinct clean amounts than this make a poor ladder; the theme's stand. */
const MIN_AMOUNTS = 3;

function amountsFrom(
	history: History,
	currency: string,
	locale: string,
): Recommendation<Money[]> | null {
	const sorted = history.gifts
		.flatMap((g) => (g.amount.currency === currency ? [cents(g.amount)] : []))
		.filter((c) => c > 0)
		.toSorted((a, b) => a - b);
	if (sorted.length === 0) return null;
	const at = (q: number) =>
		sorted[Math.max(Math.ceil(q * sorted.length) - 1, 0)] as number;
	const snapped = [
		...new Set(AMOUNT_PERCENTILES.map((q) => cleanAmount(at(q) / 100))),
	];
	if (snapped.length < MIN_AMOUNTS) return null;
	const show = (c: number) => shown(fromCents(c, currency), locale);
	return {
		value: snapped.map((units) => money(units, currency)),
		evidence: `Your ${sorted.length} gifts had a median of ${show(at(0.5))}, and 9 in 10 were ${show(at(0.9))} or less.`,
	};
}

// Clean figures: 1, 2, 2.5, 3, 4, 5 and 7.5 times a power of ten, from 1 up.
const LADDER = [1, 2, 2.5, 3, 4, 5, 7.5];

/** The clean figure nearest `units`; ascending percentiles stay ascending. */
function cleanAmount(units: number): number {
	if (units <= 1) return 1;
	const power = 10 ** Math.floor(Math.log10(units));
	return nearestByRatio([...LADDER.map((m) => m * power), 10 * power], units);
}

/** The candidate closest to `x` by ratio, so 39 days snaps to 45 over 30; ties to the earlier. */
function nearestByRatio(candidates: number[], x: number): number {
	const off = (c: number) => Math.abs(Math.log(c / x));
	return candidates.reduce((best, c) => (off(c) < off(best) ? c : best));
}

const defaultGoal = (
	theme: ThemeName,
	locale: string,
	reason: string,
): Recommendation<Money> => ({
	value: THEMES[theme].goal,
	evidence: `${shown(THEMES[theme].goal, locale)} is a common starting goal for ${KIND[theme].an}; ${reason}.`,
});

const defaultAmounts = (
	theme: ThemeName,
	reason: string,
): Recommendation<Money[]> => ({
	value: THEMES[theme].suggestedAmounts,
	evidence: `These are common amounts for ${KIND[theme].an}; ${reason}.`,
});

const defaultEndDays = (
	theme: ThemeName,
	reason: string,
): Recommendation<number> => ({
	value: THEMES[theme].endDays,
	evidence: `${THEMES[theme].endDays} days is a common run for ${KIND[theme].an}; ${reason}.`,
});

// The currency most gifts came in, else most campaign totals, else the
// themes'; money in any other currency is left out, never converted.
function currencyOf(history: History): string {
	const counts = new Map<string, number>();
	const tally = (ms: Money[]) => {
		for (const m of ms)
			counts.set(m.currency, (counts.get(m.currency) ?? 0) + 1);
	};
	tally(history.gifts.map((g) => g.amount));
	if (counts.size === 0)
		tally(history.pastCampaigns.flatMap((k) => (k.total ? [k.total] : [])));
	let best: [string, number] = [THEMES[DEFAULT_THEME].goal.currency, 0];
	for (const entry of counts) if (entry[1] > best[1]) best = entry;
	return best[0];
}

const cents = (m: Money) => Math.round(Number(m.amount) * 100);
const fromCents = (n: number, currency: string): Money => ({
	amount: (n / 100).toFixed(2),
	currency,
});
const money = (units: number, currency: string): Money => ({
	amount: units.toFixed(2),
	currency,
});

/** The middle value, or the mean of the middle two rounded to a whole; null for none. */
function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = values.toSorted((a, b) => a - b);
	const mid = sorted.length >> 1;
	return sorted.length % 2 === 1
		? (sorted[mid] as number)
		: Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/** 18,240 → 18,000; 1,234 → 1,200; 47 → 47. */
function roundToTwoFigures(units: number): number {
	const step = 10 ** Math.max(Math.floor(Math.log10(units)) - 1, 0);
	return Math.round(units / step) * step;
}

const shown = (m: Money, locale: string) =>
	formatMoney(m.amount, m.currency, locale);
