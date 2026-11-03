import { describe, expect, test } from "vitest";
import { DEFAULT_LOCALE, formatDate, formatMoney, localeOf } from "./format";

describe("formatMoney keeps the currency and formats for the locale", () => {
	test.each([
		["en-US", "$1,250.00"],
		["de-DE", "1.250,00 $"],
		// a dollar sign, not ₱: the amount is in USD whatever the reader's locale
		["en-PH", "$1,250.00"],
	])("%s", (locale, shown) => {
		expect(formatMoney("1250.00", "USD", locale)).toBe(shown);
	});

	test("keeps every digit of a decimal string", () => {
		expect(formatMoney("12345678901234567.05", "USD", "en-US")).toBe(
			"$12,345,678,901,234,567.05",
		);
	});

	test("refuses an amount that isn't a decimal string", () => {
		expect(() => formatMoney("ten", "USD", "en-US")).toThrow(RangeError);
	});
});

describe("formatDate", () => {
	test("shows a calendar date as that day in every time zone", () => {
		expect(formatDate("2026-10-01", "en-US")).toBe("Oct 1, 2026");
		expect(formatDate("2026-10-01", "de-DE")).toBe("01.10.2026");
	});

	test("takes Intl options for a timestamp", () => {
		expect(
			formatDate("2026-10-01T15:04:00.000Z", "en-US", { timeStyle: "short" }),
			// the space before PM differs between ICU releases
		).toMatch(/^3:04\sPM$/);
	});

	test("refuses a string that isn't a date", () => {
		expect(() => formatDate("soon", "en-US")).toThrow(RangeError);
	});
});

describe("localeOf", () => {
	test("reads openai/locale first", () => {
		expect(
			localeOf({ "openai/locale": "de-DE", "webplus/i18n": "en-PH" }),
		).toBe("de-DE");
	});

	test("then webplus/i18n", () => {
		expect(localeOf({ "webplus/i18n": "en-PH" })).toBe("en-PH");
	});

	test("then en-US", () => {
		expect(localeOf({})).toBe("en-US");
		expect(localeOf(undefined)).toBe(DEFAULT_LOCALE);
	});

	test("skips a tag that isn't BCP 47 for the next in the chain", () => {
		expect(
			localeOf({ "openai/locale": "en_US", "webplus/i18n": "fr-CA" }),
		).toBe("fr-CA");
		expect(localeOf({ "openai/locale": "not a locale" })).toBe("en-US");
		expect(localeOf({ "openai/locale": 42 })).toBe("en-US");
	});

	test("returns the canonical form of the tag", () => {
		expect(localeOf({ "openai/locale": "EN-ph" })).toBe("en-PH");
	});
});
