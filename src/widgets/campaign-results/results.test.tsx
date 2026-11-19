/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it, vi } from "vitest";
import { FIXTURES, RESULTS_LIVE } from "../../../test/widget-host/fixtures";
import { CampaignResultsData } from "../model";
import { applyStyles, mount, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { CampaignResults } from "./results";
import { Facts } from "./stats";

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

describe("campaign results trend", () => {
	const usd = (amount: string) => ({ amount, currency: "USD" });
	const series = (...amounts: string[]) =>
		amounts.map((amount, i) => ({
			date: `2026-10-${String(i + 1).padStart(2, "0")}`,
			total: usd(amount),
		}));
	const trend = (root: HTMLElement) => {
		const block = root.querySelector(".ds-trend");
		if (!block) throw new Error("no trend block");
		return {
			badge: block.querySelector(".ds-trend-main .ds-badge"),
			note: block.querySelector(".ds-trend-note")?.textContent,
		};
	};

	// previous week $100, last week $150 / $75 / $100
	const PREVIOUS = ["10", "10", "10", "10", "10", "25", "25"];
	const weeks = (last: string[]) => ({
		...RESULTS_LIVE,
		daily: series(...PREVIOUS, ...last),
	});
	const glyphPath = (badge: Element | null | undefined) =>
		badge?.querySelector("svg.ds-trend-glyph path")?.getAttribute("d");

	it("shows a success badge with an upward glyph and the week before", async () => {
		const { root } = await show(weeks(["50", "0", "0", "0", "0", "0", "100"]));
		const { badge, note } = trend(root);
		expect(badge?.textContent).toBe("Up 50%");
		expect(badge?.classList.contains("ds-badge-success")).toBe(true);
		expect(badge?.classList.contains("ds-badge-warning")).toBe(false);
		expect(note).toBe("Previous 7 days: $100");
		expect(
			badge?.querySelector("svg.ds-trend-glyph")?.getAttribute("aria-hidden"),
		).toBe("true");
	});

	it("shows a warning badge with a downward glyph for a falling week", async () => {
		const { root } = await show(weeks(["75", "0", "0", "0", "0", "0", "0"]));
		const { badge, note } = trend(root);
		expect(badge?.textContent).toBe("Down 25%");
		expect(badge?.classList.contains("ds-badge-warning")).toBe(true);
		expect(badge?.classList.contains("ds-badge-success")).toBe(false);
		expect(note).toBe("Previous 7 days: $100");
	});

	it("draws a different glyph for a rising week than for a falling one", async () => {
		const up = await show(weeks(["50", "0", "0", "0", "0", "0", "100"]));
		const upPath = glyphPath(trend(up.root).badge);
		const down = await show(weeks(["75", "0", "0", "0", "0", "0", "0"]));
		const downPath = glyphPath(trend(down.root).badge);
		expect(upPath).toBeTruthy();
		expect(downPath).toBeTruthy();
		expect(upPath).not.toBe(downPath);
	});

	it("draws no badge for a flat week, but still names the week before", async () => {
		const { root } = await show(weeks(["100", "0", "0", "0", "0", "0", "0"]));
		const { badge, note } = trend(root);
		expect(badge).toBeNull();
		expect(note).toBe("Previous 7 days: $100");
	});

	it("names the sparkline for what it plots", async () => {
		const { root } = await show(weeks(["50", "0", "0", "0", "0", "0", "100"]));
		expect(
			root
				.querySelector('.ds-trend svg[role="img"]')
				?.getAttribute("aria-label"),
		).toBe("Amount raised per day over the last 14 days");
	});

	it("groups the trend under its 'Last 7 days' label", async () => {
		const { root } = await show(weeks(["50", "0", "0", "0", "0", "0", "100"]));
		const group = root.querySelector('.ds-trend[role="group"]');
		const labelId = group?.getAttribute("aria-labelledby");
		expect(labelId).toBeTruthy();
		expect(document.getElementById(labelId ?? "")?.textContent).toBe(
			"Last 7 days",
		);
	});

	it("leaves the trend out once the campaign has ended", async () => {
		const live = await show(weeks(["50", "0", "0", "0", "0", "0", "100"]));
		expect(live.root.querySelector(".ds-trend")).not.toBeNull();
		const { root } = await show({
			...weeks(["50", "0", "0", "0", "0", "0", "100"]),
			campaign: { ...RESULTS_LIVE.campaign, status: "ended" },
		});
		expect(root.querySelector(".ds-trend")).toBeNull();
	});

	it("gives donors and the average gift their own figures", async () => {
		const { root } = await show(RESULTS_LIVE);
		const facts = [...root.querySelectorAll("dl.fact")].map((dl) => ({
			term: dl.querySelector("dt")?.textContent,
			figure: dl.querySelector(".fact-figure")?.textContent,
			sub: dl.querySelector(".fact-sub")?.textContent,
		}));
		expect(facts).toEqual([
			{ term: "Donors", figure: "87", sub: "102 gifts" },
			{ term: "Average gift", figure: "$31.77", sub: "Median $25" },
		]);
	});

	it("draws no badge when the week before took nothing", async () => {
		const { root } = await show({
			...RESULTS_LIVE,
			daily: series(...Array(7).fill("0.00"), ...Array(7).fill("5.00")),
		});
		const { badge, note } = trend(root);
		expect(badge).toBeNull();
		expect(note).toBe("Nothing in the 7 days before");
	});

	// the model schema fixes `daily` at 14 days, so a shorter series reaches
	// Facts only by direct render
	it("says there are too few days to compare under 14, even when all of them are zero", () => {
		for (const days of [
			series("5", "5", "5", "5", "5", "5", "5", "5", "5", "5"),
			series(...Array(13).fill("0.00")),
		]) {
			const root = mount(<Facts data={{ ...RESULTS_LIVE, daily: days }} />);
			const { badge, note } = trend(root);
			expect(note).toBe("Not enough days to compare");
			expect(badge).toBeNull();
		}
	});

	it("compares from exactly 14 days", async () => {
		const { root } = await show({
			...RESULTS_LIVE,
			daily: series(...Array(14).fill("5.00")),
		});
		expect(trend(root).note).toBe("Previous 7 days: $35");
	});
});

describe("screenshot fixtures for the results trend", () => {
	// scripts/widget-shots.ts reads these; they must keep showing what they're named for
	const fixture = (name: string) => {
		const reply = FIXTURES["campaign-results"]?.[name]?.result;
		if (!reply || !("structuredContent" in reply)) {
			throw new Error(`no ${name} fixture`);
		}
		return CampaignResultsData.parse(reply.structuredContent);
	};
	const badge = (root: HTMLElement) =>
		root.querySelector(".ds-trend .ds-trend-main .ds-badge");

	it("live rises", async () => {
		const { root } = await show(fixture("live"));
		expect(badge(root)?.textContent).toMatch(/^Up \d+%$/);
	});

	it("live-down falls", async () => {
		const { root } = await show(fixture("live-down"));
		expect(badge(root)?.textContent).toMatch(/^Down \d+%$/);
	});

	it("live-flat shows no change badge", async () => {
		const { root } = await show(fixture("live-flat"));
		expect(root.querySelector(".ds-trend")).not.toBeNull();
		expect(badge(root)).toBeNull();
	});
});
