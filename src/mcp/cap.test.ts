import { describe, expect, test } from "vitest";
import { capResult, RESULT_CAP } from "./cap";

// n rows of eight characters each. The body `{"data":[...]}` is 10 + 11n
// characters as JSON (each row is ten with its quotes, plus a comma), and the
// cap counts it twice, so n rows weigh 20 + 22n.
const rows = (n: number, cell = "a".repeat(8)) =>
	Array.from({ length: n }, () => cell);
const page = (n: number, cell?: string) => ({ data: rows(n, cell) });

const shownRows = (result: ReturnType<typeof capResult>) => {
	if (result === null) throw new Error("expected a cut, got none");
	return (result.body as { data: string[] }).data.length;
};

describe("how many rows the cut keeps", () => {
	test("keeps the most rows that fit under the cap", () => {
		// 5 rows weigh 130, 6 weigh 152
		expect(shownRows(capResult("list_donors", page(10), 130))).toBe(5);
	});

	test("one character under a row's weight drops that row", () => {
		expect(shownRows(capResult("list_donors", page(10), 129))).toBe(4);
	});

	test("counts a character as one unit, however many bytes it takes", () => {
		// 4 emoji are 8 UTF-16 units, 16 bytes; 8 CJK characters are 8 units, 24 bytes
		expect(
			shownRows(capResult("list_donors", page(10, "😀".repeat(4)), 130)),
		).toBe(5);
		expect(
			shownRows(capResult("list_donors", page(10, "日本語日本語日本"), 130)),
		).toBe(5);
	});
});

describe("when a result is cut at all", () => {
	test("a body exactly at the cap is not cut", () => {
		expect(capResult("list_donors", page(10), 240)).toBeNull();
	});

	test("a body one character over the cap loses a row", () => {
		const cut = capResult("list_donors", page(10), 239);
		expect(shownRows(cut)).toBe(9);
	});

	test("the default cap is the documented 120,000", () => {
		expect(RESULT_CAP).toBe(120_000);
		const under = capResult("list_donors", page(5_000, "a".repeat(8)));
		// 5,000 rows weigh 110,020: under the default
		expect(under).toBeNull();
		const over = capResult("list_donors", page(6_000, "a".repeat(8)));
		expect(shownRows(over)).toBe(5_453);
	});

	test("a tool whose result is bounded by nature is never cut", () => {
		expect(capResult("get_campaign", page(10), 1)).toBeNull();
		expect(capResult("no_such_tool", page(10), 1)).toBeNull();
	});

	test("a body that is not an object, or has no list at the path, is left alone", () => {
		expect(capResult("list_donors", [rows(10)], 1)).toBeNull();
		expect(capResult("list_donors", "text", 1)).toBeNull();
		expect(capResult("list_donors", { data: "not a list" }, 1)).toBeNull();
		expect(capResult("get_donor", { gifts: null }, 1)).toBeNull();
	});
});

describe("the cursor of a cut page", () => {
	test("a body with no next_cursor gets none added", () => {
		const cut = capResult("get_results", { campaigns: rows(10) }, 130);
		expect(cut?.body).toEqual({ campaigns: rows(4) });
		expect(cut?.body).not.toHaveProperty("next_cursor");
	});

	test("a cut page's cursor is cleared and the note says the list goes on", () => {
		const cut = capResult(
			"list_donors",
			{ ...page(10), next_cursor: "page_2" },
			150,
		);
		expect(cut?.body).toEqual({ data: rows(4), next_cursor: null });
		expect(cut?.note).toContain(
			"4 of 10 donors are shown and 6 were left out, and the list goes on past those 10.",
		);
	});

	test("a last page's note does not say the list goes on", () => {
		const cut = capResult(
			"list_donors",
			{ ...page(10), next_cursor: null },
			150,
		);
		expect(cut?.note).toContain(
			"4 of 10 donors are shown and 6 were left out.",
		);
		expect(cut?.note).not.toContain("goes on");
	});
});

describe("every list that grows with the account is capped", () => {
	const big = (n: number) => rows(n, "x".repeat(100));
	const cases: [tool: string, body: unknown, noun: string][] = [
		["list_campaigns", { data: big(20) }, "campaigns"],
		["list_forms", { data: big(20) }, "donation forms"],
		["list_donations", { data: big(20) }, "donations"],
		["list_donors", { data: big(20) }, "donors"],
		["list_recurring_gifts", { data: big(20) }, "monthly gifts"],
		["get_results", { gift_count: 3, campaigns: big(20) }, "campaign totals"],
		[
			"get_donor",
			{ gift_count: 20, gifts: { data: big(20), next_cursor: "g2" } },
			"gifts",
		],
	];

	test.each(cases)("%s is cut and names its rows", (tool, body, noun) => {
		const cut = capResult(tool, body, 1_000);
		expect(cut?.note).toMatch(
			new RegExp(
				`^This result was too big to show whole: \\d+ of 20 ${noun} are shown`,
			),
		);
	});

	test("get_donor's gifts are cut where they sit, the donor and the cursor beside them kept as they are", () => {
		const cut = capResult(
			"get_donor",
			{
				name: "Jane",
				gift_count: 20,
				gifts: { data: big(20), next_cursor: "g2" },
			},
			1_000,
		);
		const shown = cut?.body as {
			name: string;
			gift_count: number;
			gifts: { data: string[]; next_cursor: string | null };
		};
		expect(shown.gifts.data.length).toBeLessThan(20);
		expect(shown.gifts.next_cursor).toBeNull();
		expect(shown).not.toHaveProperty("next_cursor");
		expect(shown.name).toBe("Jane");
		expect(shown.gift_count).toBe(20);
		expect(cut?.summaryHolds).toBe(true);
	});

	test("a tool's summary holds beside its cut only where its summary reads outside the rows", () => {
		const holds = (tool: string, body: unknown) =>
			capResult(tool, body, 1_000)?.summaryHolds;
		expect(holds("list_donors", { data: big(20) })).toBe(false);
		expect(holds("get_results", { campaigns: big(20) })).toBe(true);
	});
});
