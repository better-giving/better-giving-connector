/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { useState } from "hono/jsx/dom";
import { describe, expect, it } from "vitest";
import { flush, mount } from "../test-dom";
import { RadioGroup } from "./radio";

const THEMES = ["Emergency", "Year-end", "Capital", "Giving day"];

function Harness(props: { initial: string }) {
	const [value, setValue] = useState(props.initial);
	return (
		<RadioGroup
			label="Campaign preset"
			options={THEMES}
			value={value}
			onChange={setValue}
			renderOption={(theme) => <span>{theme}</span>}
		/>
	);
}

const radios = (root: HTMLElement) => [
	...root.querySelectorAll<HTMLElement>('[role="radio"]'),
];
const checked = (root: HTMLElement) =>
	radios(root).find((r) => r.getAttribute("aria-checked") === "true")
		?.textContent;
const press = async (root: HTMLElement, key: string) => {
	document.activeElement?.dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true }),
	);
	await flush();
	return root;
};

describe("RadioGroup", () => {
	it("is one named group with one tab stop, on the checked option", () => {
		const root = mount(<Harness initial="Capital" />);
		const group = root.querySelector('[role="radiogroup"]');
		expect(group?.getAttribute("aria-label")).toBe("Campaign preset");
		expect(radios(root).map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
	});

	it("moves the choice and the focus with the arrow keys, wrapping at the ends", async () => {
		const root = mount(<Harness initial="Capital" />);
		radios(root)[2]?.focus();
		expect(checked(await press(root, "ArrowRight"))).toBe("Giving day");
		expect(document.activeElement?.textContent).toBe("Giving day");
		expect(checked(await press(root, "ArrowDown"))).toBe("Emergency");
		expect(checked(await press(root, "ArrowLeft"))).toBe("Giving day");
		expect(checked(await press(root, "ArrowUp"))).toBe("Capital");
		expect(radios(root).map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
	});

	it("jumps to the first and last option with Home and End", async () => {
		const root = mount(<Harness initial="Year-end" />);
		radios(root)[1]?.focus();
		expect(checked(await press(root, "End"))).toBe("Giving day");
		expect(checked(await press(root, "Home"))).toBe("Emergency");
	});

	it("checks an option on click or Space", async () => {
		const root = mount(<Harness initial="Emergency" />);
		radios(root)[3]?.click();
		await flush();
		expect(checked(root)).toBe("Giving day");
		radios(root)[1]?.focus();
		expect(checked(await press(root, " "))).toBe("Year-end");
	});
});
