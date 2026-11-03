/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mount } from "../test-dom";
import { ProgressBar, percentOf } from "./progress";

const usd = (amount: string) => ({ amount, currency: "USD" });

describe("percentOf", () => {
	it("is the whole percent raised, never rounded up to the goal", () => {
		expect(percentOf(usd("1230.00"), usd("1000.00"))).toBe(123);
		expect(percentOf(usd("999.99"), usd("1000.00"))).toBe(99);
		expect(percentOf(usd("0.00"), usd("1000.00"))).toBe(0);
	});

	it("is null without a positive goal", () => {
		expect(percentOf(usd("10.00"), null)).toBeNull();
		expect(percentOf(usd("10.00"), usd("0.00"))).toBeNull();
	});
});

describe("ProgressBar", () => {
	it("fills to 100% past the goal and names the real percentage", () => {
		const root = mount(<ProgressBar percent={123} label="Raised of goal" />);
		const bar = root.querySelector('[role="progressbar"]');
		expect(bar?.getAttribute("aria-valuenow")).toBe("100");
		expect(bar?.getAttribute("aria-valuemax")).toBe("100");
		expect(bar?.getAttribute("aria-valuetext")).toBe("123%");
		expect(bar?.getAttribute("aria-label")).toBe("Raised of goal");
		const fill = bar?.querySelector<HTMLElement>(".progress-fill");
		expect(fill?.style.width).toBe("100%");
	});

	it("fills to the percentage below the goal", () => {
		const root = mount(<ProgressBar percent={37} label="Raised of goal" />);
		const fill = root.querySelector<HTMLElement>(".progress-fill");
		expect(fill?.style.width).toBe("37%");
	});

	it("marks a met goal so it draws in the success color", () => {
		const met = mount(<ProgressBar percent={100} label="x" />);
		expect(met.querySelector(".progress")?.classList.contains("met")).toBe(
			true,
		);
		const short = mount(<ProgressBar percent={99} label="x" />);
		expect(short.querySelector(".progress")?.classList.contains("met")).toBe(
			false,
		);
	});
});
