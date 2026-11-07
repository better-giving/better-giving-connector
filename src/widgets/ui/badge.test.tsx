/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount } from "../test-dom";
import { StatusBadge } from "./badge";

it.each([
	["draft", "Draft", "badge-warning"],
	["published", "Live", "badge-success"],
	["ended", "Ended", "badge-neutral"],
] as const)(
	"labels a %s campaign %s, in words beside its %s color",
	(status, label, variant) => {
		const badge = mount(<StatusBadge status={status} />).querySelector(
			".badge",
		);
		expect(badge?.textContent).toBe(label);
		expect(badge?.className.split(" ").sort()).toEqual(["badge", variant]);
	},
);
