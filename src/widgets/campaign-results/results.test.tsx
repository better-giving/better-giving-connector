/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it, vi } from "vitest";
import { RESULTS_LIVE } from "../../../test/widget-host/fixtures";
import { CampaignResultsData } from "../model";
import { applyStyles, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { CampaignResults } from "./results";

async function show(data: CampaignResultsData, context: McpUiHostContext = {}) {
	const { bridge, host } = await startHost({ context });
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(
		root,
		host,
		CampaignResultsData,
		CampaignResults,
		"Loading results…",
	);
	await bridge.sendToolResult({ content: [], structuredContent: data });
	await vi.waitFor(() =>
		expect(root.textContent).not.toContain("Loading results…"),
	);
	return { bridge, root };
}

const endedNote = (root: HTMLElement) =>
	[...root.querySelectorAll("p")].find((p) =>
		p.textContent?.includes("no longer takes gifts"),
	)?.textContent;

const button = (root: HTMLElement, text: string) => {
	const found = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === text,
	);
	if (!found) throw new Error(`no button ${text}`);
	return found;
};

describe("campaign results money", () => {
	it.each([
		["en-US", "$3,240.50"],
		["en-PH", "$3,240.50"],
		["de-DE", "3.240,50"],
	])(
		"shows the raised amount in %s, still in dollars",
		async (locale, shown) => {
			const { root } = await show(RESULTS_LIVE, { locale });
			const text = root.querySelector(".raised")?.textContent ?? "";
			expect(text).toContain(shown);
			expect(text).toMatch(/\$/);
			expect(text).not.toMatch(/[₱€]/);
		},
	);
});

describe("campaign results", () => {
	it("says so when the host won't open the campaign page", async () => {
		const { bridge, root } = await show(RESULTS_LIVE);
		bridge.onopenlink = async () => ({ isError: true });
		button(root, "View page").click();
		await vi.waitFor(() =>
			expect(root.querySelector('[role="alert"]')?.textContent).toMatch(
				/couldn't open/i,
			),
		);
	});

	it("counts donors in the reader's locale in the end confirm", async () => {
		const { root } = await show(
			{ ...RESULTS_LIVE, donors: 1234 },
			{ locale: "de-DE" },
		);
		button(root, "End campaign").click();
		await vi.waitFor(() =>
			expect(root.querySelector(".confirm p")?.textContent).toContain(
				"1.234 donors have given",
			),
		);
	});

	it("counts one gift as a gift on an ended campaign", async () => {
		const ended = {
			...RESULTS_LIVE,
			campaign: { ...RESULTS_LIVE.campaign, status: "ended" as const },
		};
		const one = await show({ ...ended, giftCount: 1 });
		expect(endedNote(one.root)).toContain(" 1 gift, $3,240.50 in all.");
		const many = await show({ ...ended, giftCount: 1020 }, { locale: "de-DE" });
		expect(endedNote(many.root)).toContain(" 1.020 gifts, ");
	});

	it("puts focus back on End campaign when the confirm closes", async () => {
		const { root } = await show(RESULTS_LIVE);
		button(root, "End campaign").click();
		await vi.waitFor(() => expect(button(root, "Keep it live")).toBeTruthy());
		button(root, "Keep it live").click();
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(button(root, "End campaign")),
		);

		button(root, "End campaign").click();
		await vi.waitFor(() =>
			expect(root.querySelector(".confirm")).not.toBeNull(),
		);
		root
			.querySelector(".confirm")
			?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		await vi.waitFor(() =>
			expect(document.activeElement).toBe(button(root, "End campaign")),
		);
	});
});

describe("campaign results card footer", () => {
	const draft = {
		...RESULTS_LIVE,
		campaign: { ...RESULTS_LIVE.campaign, status: "draft" as const, url: null },
	};
	const ended = {
		...RESULTS_LIVE,
		campaign: { ...RESULTS_LIVE.campaign, status: "ended" as const },
	};
	const footerButtons = (root: HTMLElement) =>
		[...root.querySelectorAll(".ds-card-footer button")].map(
			(b) => b.textContent,
		);

	it.each([
		["draft", draft],
		["live", RESULTS_LIVE],
	])(
		"puts a %s campaign's footer under the body, not inside it",
		async (_state, data) => {
			const { root } = await show(data);
			const footer = root.querySelector("article.card > .ds-card-footer");

			expect(footer).not.toBeNull();
			expect(
				footer?.previousElementSibling?.classList.contains("ds-card-body"),
			).toBe(true);
			expect(root.querySelector(".ds-card-body .ds-card-footer")).toBeNull();
		},
	);

	it("holds a live campaign's actions in the footer", async () => {
		const { root } = await show(RESULTS_LIVE);

		expect(footerButtons(root)).toEqual([
			"End campaign",
			"Share link",
			"View page",
		]);
	});

	it("adds Publish changes to the footer only when a draft is pending", async () => {
		const pending = await show({ ...RESULTS_LIVE, pendingDraft: true });

		expect(footerButtons(pending.root)).toEqual([
			"Publish changes",
			"End campaign",
			"Share link",
			"View page",
		]);
	});

	it("holds a draft's Preview and Publish in the footer", async () => {
		const { root } = await show(draft);

		expect(footerButtons(root)).toEqual(["Preview", "Publish"]);
	});

	it("has no footer on an ended campaign, and no way to end or share it", async () => {
		const { root } = await show(ended);
		const buttons = [...root.querySelectorAll("button")].map(
			(b) => b.textContent,
		);

		expect(root.querySelector(".ds-card-footer")).toBeNull();
		expect(buttons).not.toContain("End campaign");
		expect(buttons).not.toContain("Share link");
		// the card still renders: the ended note is in its body
		expect(endedNote(root)).toContain("no longer takes gifts");
	});
});

describe("campaign results type", () => {
	const styled = async (data: CampaignResultsData) => {
		applyStyles("ui/styles.css", "campaign-results/results.css");
		return (await show(data)).root;
	};
	const weight = (el: Element) =>
		({ normal: "400", bold: "700" })[getComputedStyle(el).fontWeight] ??
		getComputedStyle(el).fontWeight;
	const ownText = (el: Element) =>
		[...el.childNodes].some(
			(n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
		);

	it("sets display-face text only at the weights fonts-core cuts it to", async () => {
		const root = await styled(RESULTS_LIVE);
		const display = getComputedStyle(document.documentElement)
			.getPropertyValue("--font-display")
			.trim();
		const offCut = [...root.querySelectorAll("*")]
			.filter(
				(el) =>
					ownText(el) &&
					getComputedStyle(el).fontFamily === display &&
					!["600", "700"].includes(weight(el)),
			)
			.map((el) => `${el.className}: ${el.textContent?.trim()}`);
		expect(display).toContain("Red Hat Round Display");
		expect(offCut).toEqual([]);
	});

	it("sets the week-over-week badge in the face the status badge uses", async () => {
		const root = await styled(RESULTS_LIVE);
		const [status, trend] = [...root.querySelectorAll(".ds-badge")];
		expect(trend?.textContent).toMatch(/(Up|Down) \d+%/);
		expect(getComputedStyle(trend as Element).fontFamily).toBe(
			getComputedStyle(status as Element).fontFamily,
		);
	});

	const draftFooter = async () =>
		await styled({
			...RESULTS_LIVE,
			campaign: { ...RESULTS_LIVE.campaign, status: "draft", url: null },
			programs: [{ id: "p-coats", name: "Coat fund" }],
		});

	it("grows the gift select and the buttons to 44px on a touch host", async () => {
		const root = await draftFooter();
		const select = root.querySelector(".card-foot select") as Element;
		document.documentElement.setAttribute("data-touch", "");
		try {
			expect(getComputedStyle(select).minBlockSize).toBe("44px");
			expect(getComputedStyle(button(root, "Publish")).minBlockSize).toBe(
				"44px",
			);
		} finally {
			document.documentElement.removeAttribute("data-touch");
		}
		expect(getComputedStyle(select).minBlockSize).toBe(
			getComputedStyle(button(root, "Publish")).minBlockSize,
		);
	});

	it("sizes the draft footer's gift select to the buttons beside it, labelled like a field", async () => {
		const root = await draftFooter();
		const select = root.querySelector(".card-foot select");
		const label = root.querySelector(`label[for="${select?.id}"]`);
		const publish = button(root, "Publish");
		expect(publish.className).toContain("ds-btn");
		// the registry button's 9-spacing-unit height, as happy-dom leaves the calc
		// unresolved; an unapplied rule reads "", which the pattern rejects
		const nineUnits = /\* 9\)$/;
		expect(getComputedStyle(publish).minBlockSize).toMatch(nineUnits);
		expect(getComputedStyle(select as Element).minBlockSize).toMatch(nineUnits);
		expect(getComputedStyle(label as Element).fontWeight).toBe("500");
	});

	it("draws End campaign as the registry's destructive outline, not the secondary button", async () => {
		const root = await styled(RESULTS_LIVE);
		const end = button(root, "End campaign");
		const secondary = button(root, "View page");
		expect(end.classList.contains("ds-btn")).toBe(true);
		expect(end.classList.contains("ds-btn-destructive-outline")).toBe(true);
		expect(secondary.classList.contains("ds-btn-secondary")).toBe(true);

		// button-css sets the outline's fill to transparent and the secondary's to a gray step
		const endFill = getComputedStyle(end).backgroundColor;
		expect(endFill).toMatch(
			/^(transparent|rgba\(0, ?0, ?0, ?0\)|rgb\(0 0 0 \/ 0\))$/,
		);
		expect(endFill).not.toBe(getComputedStyle(secondary).backgroundColor);
	});

	it("sets the ended status badge in the card's status slot as the outline badge", async () => {
		const root = await styled({
			...RESULTS_LIVE,
			campaign: { ...RESULTS_LIVE.campaign, status: "ended" },
		});
		const badge = root.querySelector(
			".head > .ds-card-status > .ds-badge-outline",
		);
		expect(badge?.textContent).toBe("Ended");
		expect(badge?.classList.contains("ds-badge")).toBe(true);
	});

	it("keeps a live campaign's status badge out of the outline variant", async () => {
		const root = await styled(RESULTS_LIVE);
		const badge = root.querySelector(".head > .ds-card-status > .ds-badge");
		expect(badge?.textContent).toBe("Live");
		expect(badge?.classList.contains("ds-badge-outline")).toBe(false);
	});
});
