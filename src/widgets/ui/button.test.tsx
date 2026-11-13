/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount } from "../test-dom";
import { Button } from "./button";

it("draws the destructive-outline variant with the registry's class", () => {
	const button = mount(
		<Button variant="destructive-outline" onClick={() => {}}>
			End campaign
		</Button>,
	).querySelector("button");
	expect(button?.className.split(" ").sort()).toEqual([
		"ds-btn",
		"ds-btn-destructive-outline",
	]);
});
