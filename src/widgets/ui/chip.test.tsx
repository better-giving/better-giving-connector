/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount } from "../test-dom";
import { StatusChip } from "./chip";

it.each([
	["draft", "Draft"],
	["published", "Live"],
	["ended", "Ended"],
] as const)(
	"labels a %s campaign %s, in words beside its color",
	(status, label) => {
		const chip = mount(<StatusChip status={status} />).querySelector(".chip");
		expect(chip?.textContent).toBe(label);
		expect(chip?.classList.contains(`chip-${status}`)).toBe(true);
	},
);
