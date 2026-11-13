/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { useState } from "hono/jsx/dom";
import { describe, expect, it } from "vitest";
import type { Block } from "../model";
import { flush, mount } from "../test-dom";
import { BlockFields, ContentFields } from "./fields";

function titleSection(): HTMLElement {
	return mount(
		<ContentFields
			campaignId="c-1"
			section="title"
			content={{ heading: "Clean water" }}
			currency="USD"
			onChange={() => {}}
		/>,
	);
}

function control(root: HTMLElement, label: string): HTMLElement {
	const found = [...root.querySelectorAll("label")].find(
		(l) => l.textContent === label,
	);
	const el = found && root.ownerDocument.getElementById(found.htmlFor);
	if (!el) throw new Error(`no control labelled ${label}`);
	return el;
}

describe("ContentFields' Story hint", () => {
	it("is the Story textarea's description, inside the same field", () => {
		const root = titleSection();
		const story = control(root, "Story");
		const describedBy = story.getAttribute("aria-describedby");
		if (!describedBy) throw new Error("Story has no aria-describedby");
		const help = root.ownerDocument.getElementById(describedBy);
		expect(help?.textContent).toBe("Leave a blank line between paragraphs.");
		expect(help?.closest(".ds-field")).toBe(story.closest(".ds-field"));
	});

	it("leaves a field without a hint undescribed", () => {
		const root = titleSection();
		const heading = control(root, "Heading");
		expect(heading.hasAttribute("aria-describedby")).toBe(false);
		expect(heading.closest(".ds-field")?.querySelector(".ds-field-help")).toBe(
			null,
		);
	});
});

describe("BlockFields' more-settings line", () => {
	const moreLine = (block: Block): string | undefined => {
		const root = mount(
			<BlockFields campaignId="c-1" block={block} onChange={() => {}} />,
		);
		return [...root.querySelectorAll("p")]
			.map((p) => p.textContent?.replace(/\s+/g, " ").trim())
			.find((t) => t?.includes("can be changed by asking in the chat"));
	};

	it("says one more setting when one is not editable here", () => {
		expect(moreLine({ type: "story", title: "Hi", items: [1] })).toBe(
			"One more setting can be changed by asking in the chat.",
		);
	});

	it("counts the settings when several are not editable here", () => {
		expect(
			moreLine({ type: "story", title: "Hi", items: [1], style: { a: 1 } }),
		).toBe("2 more settings can be changed by asking in the chat.");
	});

	it("is absent when every setting is editable here", () => {
		expect(moreLine({ type: "story", title: "Hi", showDate: true })).toBe(
			undefined,
		);
	});
});

describe("BlockFields' boolean setting", () => {
	it("is a switch named by its label, and toggling it reports the new value", async () => {
		const changes: Block[] = [];
		function Harness() {
			const [block, setBlock] = useState<Block>({
				type: "story",
				showDate: false,
			});
			return (
				<BlockFields
					campaignId="c-1"
					block={block}
					onChange={(next) => {
						changes.push(next);
						setBlock(next);
					}}
				/>
			);
		}
		const root = mount(<Harness />);
		const toggle = root.querySelector<HTMLInputElement>('[role="switch"]');
		expect(toggle?.type).toBe("checkbox");
		expect(toggle?.checked).toBe(false);
		expect(toggle?.closest("label")?.textContent).toBe("Show date");

		if (!toggle) throw new Error("no switch");
		toggle.click();
		await flush();
		expect(changes).toEqual([{ type: "story", showDate: true }]);
		expect(
			root.querySelector<HTMLInputElement>('[role="switch"]')?.checked,
		).toBe(true);

		const again = root.querySelector<HTMLInputElement>('[role="switch"]');
		if (!again) throw new Error("no switch");
		again.click();
		await flush();
		expect(changes.at(-1)).toEqual({ type: "story", showDate: false });
	});
});
