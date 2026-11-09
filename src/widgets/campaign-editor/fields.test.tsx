/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { useState } from "hono/jsx/dom";
import { describe, expect, it } from "vitest";
import type { Block } from "../model";
import { flush, mount } from "../test-dom";
import { BlockFields } from "./fields";

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
