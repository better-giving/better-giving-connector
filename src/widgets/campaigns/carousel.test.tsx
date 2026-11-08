/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it, vi } from "vitest";
import { CAMPAIGNS } from "../../../test/widget-host/fixtures";
import { formatMoney } from "../../format";
import { CampaignsData } from "../model";
import { applyStyles, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { Campaigns } from "./carousel";

async function show(
	result: Parameters<
		Awaited<ReturnType<typeof startHost>>["bridge"]["sendToolResult"]
	>[0],
	context: McpUiHostContext = {},
) {
	const { bridge, host } = await startHost({ context });
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, CampaignsData, Campaigns, "Loading campaigns…");
	await bridge.sendToolResult(result);
	await vi.waitFor(() =>
		expect(root.textContent).not.toContain("Loading campaigns…"),
	);
	return { bridge, root };
}

const cards = (root: HTMLElement) => [
	...root.querySelectorAll<HTMLElement>(".campaign"),
];
const card = (root: HTMLElement, title: string) => {
	const found = cards(root).find(
		(c) => c.querySelector(".campaign-title")?.textContent === title,
	);
	if (!found) throw new Error(`no card titled ${title}`);
	return found;
};

describe("campaign carousel", () => {
	it("shows one card per campaign, in order", async () => {
		const { root } = await show({ content: [], structuredContent: CAMPAIGNS });
		expect(
			cards(root).map((c) => c.querySelector(".campaign-title")?.textContent),
		).toEqual(CAMPAIGNS.campaigns.map((c) => c.title));
	});

	it("caps an over-goal bar at full and still shows the real 123%", async () => {
		const { root } = await show({ content: [], structuredContent: CAMPAIGNS });
		const gala = card(root, "Spring gala 2026");
		expect(gala.querySelector(".ds-badge")?.textContent).toBe("Ended");
		expect(gala.querySelector(".campaign-amounts")?.textContent).toBe(
			"$12,300 of $10,000123%",
		);
		const bar = gala.querySelector('[role="progressbar"]');
		expect(bar?.getAttribute("aria-valuenow")).toBe("100");
		expect(bar?.getAttribute("aria-valuetext")).toBe("123%");
	});

	it("shows what was raised, with no bar, for a campaign without a goal", async () => {
		const { root } = await show({ content: [], structuredContent: CAMPAIGNS });
		const tuesday = card(
			root,
			"Giving Tuesday neighbor-to-neighbor match for families across the harbor district",
		);
		expect(tuesday.querySelector(".campaign-amounts")?.textContent).toBe(
			"$1,875 raised",
		);
		expect(tuesday.querySelector('[role="progressbar"]')).toBeNull();
		expect(tuesday.querySelector(".campaign-meta")?.textContent).toBe(
			"Ends Dec 2, 2026 · 1 donor",
		);
	});

	it("draws the placeholder for a draft with no image and for a blocked origin", async () => {
		const { root } = await show({ content: [], structuredContent: CAMPAIGNS });
		for (const title of [
			"Year-end appeal: Keep the pantry full",
			"Library roof repair",
		]) {
			const c = card(root, title);
			expect(c.querySelector("img"), title).toBeNull();
			expect(c.querySelector(".image-placeholder"), title).not.toBeNull();
		}
		expect(card(root, "Winter coat drive").querySelector("img")).not.toBeNull();
	});

	it("asks the chat for a live campaign's results, and to open a draft", async () => {
		const { bridge, root } = await show({
			content: [],
			structuredContent: CAMPAIGNS,
		});
		const sent: string[] = [];
		bridge.onmessage = async (params) => {
			for (const block of params.content) {
				if (block.type === "text") sent.push(block.text);
			}
			return {};
		};
		const winter = card(root, "Winter coat drive").querySelector("button");
		expect(winter?.textContent).toBe("View results");
		winter?.click();
		const draft = card(
			root,
			"Year-end appeal: Keep the pantry full",
		).querySelector("button");
		expect(draft?.textContent).toBe("Open draft");
		draft?.click();
		await vi.waitFor(() =>
			expect(sent).toEqual([
				'Show the results for the campaign "Winter coat drive" (id c-winter).',
				'Open the editor for the draft campaign "Year-end appeal: Keep the pantry full" (id c-yearend).',
			]),
		);
	});

	it("formats money and dates in the host's locale, never converting the currency", async () => {
		const { root } = await show(
			{ content: [], structuredContent: CAMPAIGNS },
			{ locale: "de-DE" },
		);
		expect(
			card(root, "Spring gala 2026").querySelector(".campaign-amounts")
				?.textContent,
		).toBe(
			`${formatMoney("12300.00", "USD", "de-DE", { dropZeroCents: true })} of ${formatMoney("10000.00", "USD", "de-DE", { dropZeroCents: true })}123%`,
		);
		// the dollar stays a dollar: German separators, never a conversion to euro
		expect(formatMoney("12300.00", "USD", "de-DE")).toMatch(/^12\.300,00\s\$$/);
	});

	it("is one keyboard-scrollable, labelled list", async () => {
		const { root } = await show({ content: [], structuredContent: CAMPAIGNS });
		const scroller = root.querySelector(".carousel");
		expect(scroller?.getAttribute("tabindex")).toBe("0");
		expect(scroller?.getAttribute("aria-label")).toBe("Campaigns");
		expect(scroller?.querySelectorAll(":scope > li")).toHaveLength(5);
	});

	it("says there are no campaigns yet, and offers to start one", async () => {
		const { bridge, root } = await show({
			content: [],
			structuredContent: { ...CAMPAIGNS, campaigns: [] },
		});
		const sent: unknown[] = [];
		bridge.onmessage = async (params) => {
			sent.push(params.content);
			return {};
		};
		expect(root.querySelector(".state-title")?.textContent).toBe(
			"No campaigns yet",
		);
		root.querySelector("button")?.click();
		await vi.waitFor(() =>
			expect(sent).toEqual([
				[{ type: "text", text: "Help me create a campaign." }],
			]),
		);
	});

	it("shows the tool's own sentence when it failed", async () => {
		const { root } = await show({
			isError: true,
			content: [{ type: "text", text: "Reconnect Better Giving." }],
		});
		expect(root.querySelector('[role="alert"]')?.textContent).toContain(
			"Reconnect Better Giving.",
		);
	});
});

describe("campaign photo status chip", () => {
	const rule = (variant: string) =>
		[...(document.styleSheets[0]?.cssRules ?? [])]
			.filter((r) =>
				r.cssText.startsWith(`.campaign-chip .ds-badge-${variant}`),
			)
			.map((r) => r.cssText)
			.join(" ");

	it("gives live, draft and ended campaigns each their own class", async () => {
		const { root } = await show({ content: [], structuredContent: CAMPAIGNS });
		const classes = new Map<string, string>();
		for (const chip of root.querySelectorAll(".campaign-chip .ds-badge")) {
			classes.set(chip.textContent ?? "", chip.className);
		}
		expect([...classes.keys()].sort()).toEqual(["Draft", "Ended", "Live"]);
		expect(new Set(classes.values()).size).toBe(3);
	});

	it("leaves each status's fill and ink to the registry's badge variant", () => {
		applyStyles("ui/styles.css", "campaigns/carousel.css");
		for (const variant of ["success", "warning", "neutral"]) {
			expect(rule(variant)).toBe("");
		}
	});
});
