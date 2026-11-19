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

	it("has no change to show with fewer than 14 days", () => {
		expect(weekOverWeek(days(...Array(10).fill("5.00"))).change).toBeNull();
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

	it("puts a single value at the left edge, at the top when it is the busiest", () => {
		expect(sparklinePoints([5], 100, 20)).toEqual([[0, 0]]);
	});
});

describe("Sparkline", () => {
	it("is one labelled image", () => {
		const root = mount(
			<Sparkline
				values={Array.from({ length: 14 }, (_, i) => i)}
				emphasize={7}
				label="Gifts per day, last 14 days"
			/>,
		);
		const svg = root.querySelector('svg.ds-sparkline[role="img"]');
		expect(svg?.getAttribute("aria-label")).toBe("Gifts per day, last 14 days");
	});

	it("gives the before line the earlier days and the recent line the last ones, meeting on one point", () => {
		const root = mount(
			<Sparkline values={[0, 28, 14, 28]} emphasize={2} label="Gifts" />,
		);
		const points = (cls: string) =>
			root.querySelector(`.${cls}`)?.getAttribute("points");
		expect(points("ds-spark-before")).toBe("0.0,30.0 46.7,2.0 93.3,16.0");
		expect(points("ds-spark-recent")).toBe("93.3,16.0 140.0,2.0");
	});

	const points = (root: Element, cls: string) =>
		root.querySelector(`.${cls}`)?.getAttribute("points");

	it("draws everything in the recent line when more days are emphasized than exist", () => {
		const root = mount(
			<Sparkline values={[0, 28, 14]} emphasize={5} label="Gifts" />,
		);
		expect(points(root, "ds-spark-before")).toBe("0.0,30.0");
		expect(points(root, "ds-spark-recent")).toBe(
			"0.0,30.0 70.0,2.0 140.0,16.0",
		);
	});

	it("draws everything in the before line, leaving none recent, when emphasize is 0", () => {
		const root = mount(
			<Sparkline values={[0, 28, 14]} emphasize={0} label="Gifts" />,
		);
		expect(points(root, "ds-spark-before")).toBe(
			"0.0,30.0 70.0,2.0 140.0,16.0",
		);
		expect(points(root, "ds-spark-recent")).toBe("");
	});

	it("draws a single day as one point on each line", () => {
		const root = mount(<Sparkline values={[5]} emphasize={1} label="Gifts" />);
		expect(points(root, "ds-spark-before")).toBe("0.0,2.0");
		expect(points(root, "ds-spark-recent")).toBe("0.0,2.0");
	});

	it("lays a run of empty days flat along the bottom", () => {
		const root = mount(
			<Sparkline values={[0, 0, 0]} emphasize={2} label="Gifts" />,
		);
		expect(points(root, "ds-spark-before")).toBe("0.0,30.0 70.0,30.0");
		expect(points(root, "ds-spark-recent")).toBe("70.0,30.0 140.0,30.0");
	});
});
