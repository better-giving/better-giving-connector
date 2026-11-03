/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "../test-dom";
import { Sparkline, sparklinePoints, weekOverWeek } from "./sparkline";

const usd = (amount: string) => ({ amount, currency: "USD" });
const days = (...amounts: string[]) =>
	amounts.map((amount, i) => ({
		date: `2026-10-${String(i + 1).padStart(2, "0")}`,
		total: usd(amount),
	}));

describe("weekOverWeek", () => {
	it("totals the last seven days against the seven before, exactly", () => {
		const daily = days(
			...["10.10", "0", "0", "0", "0", "0", "9.90"],
			...["0.10", "0.20", "0", "0", "0", "29.70", "0"],
		);
		expect(weekOverWeek(daily)).toEqual({
			last: usd("30.00"),
			previous: usd("20.00"),
			change: 50,
		});
	});

	it("has no change to show when the previous week took nothing", () => {
		const daily = days(...Array(7).fill("0.00"), ...Array(7).fill("5.00"));
		expect(weekOverWeek(daily).change).toBeNull();
	});

	it("rounds a fall to a whole negative percent", () => {
		const daily = days(...Array(7).fill("3.00"), "1.00", ...Array(6).fill("0"));
		expect(weekOverWeek(daily).change).toBe(-95);
	});
});

describe("sparklinePoints", () => {
	it("puts one point per day, the busiest day at the top and zero at the bottom", () => {
		expect(sparklinePoints([0, 5, 10], 100, 20)).toEqual([
			[0, 20],
			[50, 10],
			[100, 0],
		]);
	});

	it("lays a run of empty days flat along the bottom", () => {
		expect(sparklinePoints([0, 0], 10, 4)).toEqual([
			[0, 4],
			[10, 4],
		]);
	});
});

describe("Sparkline", () => {
	it("is one labelled image, the last week drawn apart from the week before", () => {
		const root = mount(
			<Sparkline
				values={Array.from({ length: 14 }, (_, i) => i)}
				emphasize={7}
				label="Gifts per day, last 14 days"
			/>,
		);
		const svg = root.querySelector('svg[role="img"]');
		expect(svg?.getAttribute("aria-label")).toBe("Gifts per day, last 14 days");
		const before = svg?.querySelector(".spark-before")?.getAttribute("points");
		const recent = svg?.querySelector(".spark-recent")?.getAttribute("points");
		expect(before?.split(" ")).toHaveLength(8);
		expect(recent?.split(" ")).toHaveLength(7);
	});
});
