// Money and dates as a reader in one locale reads them. Pure and browser-safe:
// the widgets under src/widgets import it too, so nothing here may import a
// node or server module.

export const DEFAULT_LOCALE = "en-US";

// The request `_meta` keys a chat app states its reader's locale under, in
// the order they are trusted.
const LOCALE_KEYS = ["openai/locale", "webplus/i18n"] as const;

/**
 * The reader's locale from a request's `_meta`: the first of its locale keys
 * holding a valid BCP 47 tag, canonicalized, or en-US.
 */
export function localeOf(meta: unknown): string {
	if (typeof meta !== "object" || meta === null) return DEFAULT_LOCALE;
	for (const key of LOCALE_KEYS) {
		const tag = canonical((meta as Record<string, unknown>)[key]);
		if (tag !== null) return tag;
	}
	return DEFAULT_LOCALE;
}

function canonical(tag: unknown): string | null {
	if (typeof tag !== "string") return null;
	try {
		return Intl.getCanonicalLocales(tag)[0] ?? null;
	} catch {
		return null;
	}
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A decimal-string amount in its own currency, formatted for `locale`. The
 * currency is never converted; the locale only moves separators and the
 * symbol. Throws RangeError for an amount that isn't a decimal string or a
 * currency Intl doesn't know.
 */
export function formatMoney(
	amount: string,
	currency: string,
	locale: string,
): string {
	if (!DECIMAL.test(amount)) throw new RangeError("amount is not a decimal");
	// A string is formatted as the exact decimal, never through a float.
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
		amount as Intl.StringNumericLiteral,
	);
}

/**
 * An ISO date or timestamp formatted for `locale`, in UTC unless `options`
 * names a time zone, so a calendar date ("2026-10-01") is that day for every
 * reader. Defaults to the medium date style. Throws RangeError for a string
 * that isn't a date.
 */
export function formatDate(
	iso: string,
	locale: string,
	options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) throw new RangeError("not a date");
	return new Intl.DateTimeFormat(locale, {
		timeZone: "UTC",
		...options,
	}).format(at);
}
