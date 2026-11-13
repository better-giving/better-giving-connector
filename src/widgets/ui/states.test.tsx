/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { useState } from "hono/jsx/dom";
import { describe, expect, it, vi } from "vitest";
import { mount } from "../test-dom";
import { LoadingState } from "./states";

const card = (root: HTMLElement) => root.querySelector('[role="status"]');
const read = (root: HTMLElement) =>
	card(root)?.querySelector(".ds-state-card-read");

describe("LoadingState", () => {
	it("arrives with the read copy empty, so its later fill is a change the live region announces", () => {
		const root = mount(<LoadingState label="Loading campaigns…" />);
		expect(card(root)?.getAttribute("aria-live")).toBe("polite");
		expect(read(root)?.textContent).toBe("");
	});

	it("writes the label into the read copy after mount, the drawn line hidden from assistive technology", async () => {
		const root = mount(<LoadingState label="Loading campaigns…" />);
		await vi.waitFor(() =>
			expect(read(root)?.textContent).toBe("Loading campaigns…"),
		);
		const drawn = [...(card(root)?.children ?? [])].filter(
			(el) => el.textContent === "Loading campaigns…" && el !== read(root),
		);
		expect(drawn).toHaveLength(1);
		expect(drawn[0]?.getAttribute("aria-hidden")).toBe("true");
	});

	it("keeps the spinner hidden from assistive technology", () => {
		const root = mount(<LoadingState label="Loading…" />);
		expect(
			card(root)?.querySelector(".ds-spinner")?.getAttribute("aria-hidden"),
		).toBe("true");
	});

	it("follows a label that changes while mounted", async () => {
		let relabel: (label: string) => void = () => {};
		function Relabelled() {
			const [label, setLabel] = useState("Loading…");
			relabel = setLabel;
			return <LoadingState label={label} />;
		}
		const root = mount(<Relabelled />);
		await vi.waitFor(() => expect(read(root)?.textContent).toBe("Loading…"));
		relabel("Loading results…");
		await vi.waitFor(() =>
			expect(read(root)?.textContent).toBe("Loading results…"),
		);
	});
});
