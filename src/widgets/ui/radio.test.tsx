/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { useState } from "hono/jsx/dom";
import { describe, expect, it, vi } from "vitest";
import { mount } from "../test-dom";
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
			renderOption={(theme) => ({
				cover: <svg aria-hidden="true" />,
				title: theme,
				description: `The ${theme} preset`,
			})}
		/>
	);
}

const radios = (root: HTMLElement) => [
	...root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
];
// the card names its radio by the title it points at
const optionText = (radio: Element | null | undefined) => {
	const id = radio?.getAttribute("aria-labelledby");
	return id ? document.getElementById(id)?.textContent : undefined;
};
const checked = (root: HTMLElement) => {
	const on = radios(root).filter((r) => r.checked);
	expect(on).toHaveLength(1);
	return optionText(on[0]);
};
const press = async (root: HTMLElement, key: string, shown: string) => {
	document.activeElement?.dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true }),
	);
	await vi.waitFor(() => expect(checked(root)).toBe(shown));
};

describe("RadioGroup", () => {
	it("is one named group of native radios, one tab stop on the checked option", () => {
		const root = mount(<Harness initial="Capital" />);
		const group = root.querySelector("fieldset");
		expect(group?.querySelector(":scope > legend")?.textContent).toBe(
			"Campaign preset",
		);
		expect(radios(root).map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
		expect(new Set(radios(root).map((r) => r.name)).size).toBe(1);
		expect(radios(root).map(optionText)).toEqual(THEMES);
		expect(checked(root)).toBe("Capital");
	});

	it("moves the choice and the focus with the arrow keys, wrapping at the ends", async () => {
		const root = mount(<Harness initial="Capital" />);
		radios(root)[2]?.focus();
		await press(root, "ArrowRight", "Giving day");
		expect(optionText(document.activeElement)).toBe("Giving day");
		await press(root, "ArrowDown", "Emergency");
		await press(root, "ArrowLeft", "Giving day");
		await press(root, "ArrowUp", "Capital");
		expect(radios(root).map((r) => r.tabIndex)).toEqual([-1, -1, 0, -1]);
	});

	it("jumps to the first and last option with Home and End", async () => {
		const root = mount(<Harness initial="Year-end" />);
		radios(root)[1]?.focus();
		await press(root, "End", "Giving day");
		await press(root, "Home", "Emergency");
	});

	it("checks an option on a click on its card, or Space", async () => {
		const root = mount(<Harness initial="Emergency" />);
		// the radio lies over its whole card, so a press on the card lands on it
		radios(root)[3]?.click();
		await vi.waitFor(() => expect(checked(root)).toBe("Giving day"));
		radios(root)[1]?.focus();
		await press(root, " ", "Year-end");
	});

	it("draws the registry's radio cards: a cover, a check badge, a title and a description, the radio last", () => {
		const root = mount(<Harness initial="Capital" />);
		const cards = [
			...root.querySelectorAll("fieldset > .ds-radio-cards > .ds-radio-card"),
		];
		expect(cards).toHaveLength(THEMES.length);
		for (const [i, card] of cards.entries()) {
			expect(
				[...card.children].map((el) => el.className || el.tagName),
			).toEqual([
				"ds-radio-card-cover",
				"ds-radio-card-badge",
				"ds-radio-card-body",
				"INPUT",
			]);
			const radio = card.lastElementChild;
			const body = card.querySelector(".ds-radio-card-body");
			expect(body?.querySelector(".ds-radio-card-title")?.id).toBe(
				radio?.getAttribute("aria-labelledby"),
			);
			expect(body?.querySelector(".ds-radio-card-desc")?.id).toBe(
				radio?.getAttribute("aria-describedby"),
			);
			expect(optionText(radio)).toBe(THEMES[i]);
		}
	});
});
