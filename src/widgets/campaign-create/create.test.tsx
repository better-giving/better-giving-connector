/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it, vi } from "vitest";
import { CREATE } from "../../../test/widget-host/fixtures";
import { THEMES } from "../../presets/themes";
import { CampaignCreateData, type CreateResult } from "../model";
import { cardRules, nestedCards, sheetText, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { CampaignCreate } from "./create";

const RESULT: CreateResult = {
	campaign: { id: "c9", title: "Year-end appeal", status: "draft" },
	steps: [
		{ step: "create", status: "done" },
		{ step: "settings", status: "done" },
		{ step: "form", status: "done" },
		{ step: "page", status: "done" },
	],
	failedStep: null,
};

const answer = (result: CreateResult) => ({
	content: [{ type: "text" as const, text: "ok" }],
	structuredContent: result,
});

async function mountForm(
	result: CreateResult,
	reply: () => Promise<ReturnType<typeof answer>> = async () => answer(result),
) {
	const { bridge, host } = await startHost({ context: {} });
	bridge.oncalltool = reply satisfies AppBridge["oncalltool"];
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, CampaignCreateData, CampaignCreate, "Loading…");
	await bridge.sendToolResult({ content: [], structuredContent: CREATE });
	await vi.waitFor(() =>
		expect(root.querySelector(".ds-radio-cards")).not.toBeNull(),
	);
	return root;
}

async function createWith(result: CreateResult) {
	const root = await mountForm(result);
	const create = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === "Create draft",
	);
	create?.click();
	await vi.waitFor(() => expect(root.querySelector(".created")).not.toBeNull());
	return root;
}

describe("the create card's header", () => {
	it("holds the Draft badge in the card's status slot", async () => {
		const root = await mountForm(RESULT);
		const badge = root.querySelector(".ds-card-status > .ds-badge-warning");
		expect(badge?.textContent).toBe("Draft");
		expect(badge?.classList.contains("ds-badge")).toBe(true);
	});
});

describe("the create card's groups", () => {
	it("draws no card inside the widget's card; the recommendations are a group of it", async () => {
		const root = await mountForm(RESULT);
		expect(root.querySelectorAll("article.ds-card")).toHaveLength(1);
		expect(nestedCards(root)).toEqual([]);
		expect(root.querySelector(".ds-card .recs")).not.toBeNull();
		expect(cardRules("campaign-create/create.css", "recs")).toEqual([]);
	});

	it("draws no card inside the created card", async () => {
		const root = await createWith(RESULT);
		expect(root.querySelectorAll("article.ds-card")).toHaveLength(1);
		expect(nestedCards(root)).toEqual([]);
	});
});

describe("the create card's presets", () => {
	it("are the registry's radio cards, one per preset in order, the selected one checked", async () => {
		const root = await mountForm(RESULT);
		const group = root.querySelector("fieldset.presets");
		expect(group?.querySelector("legend")?.textContent).toBe("Campaign preset");
		const cards = [
			...(group?.querySelectorAll(".ds-radio-cards > .ds-radio-card") ?? []),
		];
		expect(cards).toHaveLength(CREATE.presets.length);
		for (const card of cards) {
			expect(card.querySelector(".ds-radio-card-cover > svg")).not.toBeNull();
			expect(card.querySelector(".ds-radio-card-badge > svg")).not.toBeNull();
			expect(
				card.querySelector(".ds-radio-card-body > .ds-radio-card-desc .pills"),
			).not.toBeNull();
		}
		expect(
			cards.map((c) => c.querySelector(".ds-radio-card-title")?.textContent),
		).toEqual(CREATE.presets.map((p) => `${THEMES[p.theme].label} ${p.title}`));
		const radios = cards.map((c) => c.querySelector("input"));
		expect(radios.map((r) => r?.checked)).toEqual(
			CREATE.presets.map((p) => p.theme === CREATE.selected),
		);
		expect(root.querySelector(".preset, .preset-checked, .radio")).toBeNull();
		expect(cardRules("campaign-create/create.css", "presets")).toEqual([]);
	});

	it("checks another preset and names it in the footer's summary", async () => {
		const root = await mountForm(RESULT);
		const capital = CREATE.presets.find((p) => p.theme === "capital");
		const radio = root.querySelector<HTMLInputElement>(
			'.ds-radio-card input[value="capital"]',
		);
		radio?.click();
		await vi.waitFor(() =>
			expect(root.querySelector(".summary")?.textContent).toContain(
				capital?.title,
			),
		);
		expect(radio?.checked).toBe(true);
	});

	it("holds the choice while a create request is in flight", async () => {
		let release = () => {};
		const root = await mountForm(
			RESULT,
			() =>
				new Promise((resolve) => {
					release = () => resolve(answer(RESULT));
				}),
		);
		const summary = root.querySelector(".summary")?.textContent;
		const radios = [
			...root.querySelectorAll<HTMLInputElement>(".ds-radio-card input"),
		];
		const before = radios.map((r) => r.checked);
		[...root.querySelectorAll("button")]
			.find((b) => b.textContent === "Create draft")
			?.click();
		await vi.waitFor(() => expect(radios.every((r) => r.disabled)).toBe(true));

		const other = radios.find((r) => !r.checked);
		other?.click();
		radios
			.find((r) => r.checked)
			?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
			);
		await new Promise((r) => setTimeout(r, 0));
		expect(radios.map((r) => r.checked)).toEqual(before);
		expect(root.querySelector(".summary")?.textContent).toBe(summary);

		release();
		await vi.waitFor(() =>
			expect(root.querySelector(".created")).not.toBeNull(),
		);
	});

	it("draws each theme's art at the registry cover's ratio, so the cover crops nothing", async () => {
		const root = await mountForm(RESULT);
		const cover =
			/\.ds-radio-card-cover\s*\{[^}]*aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/.exec(
				sheetText("registry/styles/radio-card-css.css"),
			);
		expect(cover).not.toBeNull();
		const ratio = Number(cover?.[1]) / Number(cover?.[2]);
		const boxes = [...root.querySelectorAll(".ds-radio-card-cover > svg")].map(
			(svg) => svg.getAttribute("viewBox")?.split(" ").map(Number) ?? [],
		);
		expect(boxes).toHaveLength(CREATE.presets.length);
		for (const [, , w = 0, h = 1] of boxes) expect(w / h).toBeCloseTo(ratio);
	});
});

describe("the create card's footer", () => {
	it("holds Customize, Create draft and the summary in a footer after the body", async () => {
		const root = await mountForm(RESULT);
		const footer = root.querySelector("article.card > .ds-card-footer");

		expect(
			footer?.previousElementSibling?.classList.contains("ds-card-body"),
		).toBe(true);
		expect(root.querySelector(".ds-card-body .ds-card-footer")).toBeNull();
		expect(
			[...(footer?.querySelectorAll("button") ?? [])].map((b) => b.textContent),
		).toEqual(["Customize", "Create draft"]);
		expect(footer?.querySelector(".summary")?.textContent).toContain(" by ");
	});
});

describe("the create card's outcome", () => {
	it("says a draft was created", async () => {
		const root = await createWith(RESULT);

		expect(root.querySelector(".eyebrow")?.textContent).toBe("Draft created");
		expect(root.textContent).toContain("Campaign created");
		expect(root.textContent).not.toContain("already existed");
	});

	it("says a draft with that title already existed, and nothing on it changed", async () => {
		const root = await createWith({
			...RESULT,
			replayed: true,
			steps: [
				{ step: "create", status: "done" },
				{ step: "settings", status: "skipped", detail: "Left as it is." },
				{ step: "form", status: "skipped" },
				{ step: "page", status: "skipped" },
			],
		});

		expect(root.querySelector(".eyebrow")?.textContent).toBe(
			"Draft already existed",
		);
		expect(root.textContent).toContain(
			"A draft with this title already existed. Nothing on it was changed.",
		);
		expect(root.textContent).not.toContain("Draft created");
		expect(root.textContent).not.toContain("Campaign created");
	});

	it("says what was filled in on an existing draft", async () => {
		const root = await createWith({
			...RESULT,
			replayed: true,
			steps: [
				{ step: "create", status: "done" },
				{ step: "settings", status: "done" },
				{ step: "form", status: "skipped" },
				{ step: "page", status: "skipped" },
			],
		});

		expect(root.textContent).toContain("already existed");
		expect(root.textContent).toContain("Only what is ticked above");
		expect(root.textContent).not.toContain("Nothing on it was changed");
	});
});
