/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount } from "../test-dom";
import { StatusBadge } from "./badge";

it.each([
	["draft", "Draft", "ds-badge-warning"],
	["published", "Live", "ds-badge-success"],
	["ended", "Ended", "ds-badge-outline"],
] as const)(
	"labels a %s campaign %s, in words beside its %s color",
	(status, label, variant) => {
		const badge = mount(<StatusBadge status={status} />).querySelector(
			".ds-badge",
		);
		expect(badge?.textContent).toBe(label);
		expect(badge?.className.split(" ").sort()).toEqual(["ds-badge", variant]);
	},
);

it("keeps an ended campaign's chip neutral on a photo, which the outline badge can't sit on", () => {
	const badge = mount(<StatusBadge status="ended" onPhoto />).querySelector(
		".ds-badge",
	);
	expect(badge?.className.split(" ").sort()).toEqual([
		"ds-badge",
		"ds-badge-neutral",
		"ds-badge-on-photo",
	]);
});
