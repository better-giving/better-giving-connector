/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it } from "vitest";
import { RESULTS_LIVE } from "../../../test/widget-host/fixtures";
import { CampaignResultsData } from "../model";
import { flush, startHost } from "../test-dom";
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
	await flush(10);
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

describe("campaign results", () => {
	it("says so when the host won't open the campaign page", async () => {
		const { bridge, root } = await show(RESULTS_LIVE);
		bridge.onopenlink = async () => ({ isError: true });
		button(root, "View page").click();
		await flush(10);
		expect(root.querySelector('[role="alert"]')?.textContent).toMatch(
			/couldn't open/i,
		);
	});

	it("counts donors in the reader's locale in the end confirm", async () => {
		const { root } = await show(
			{ ...RESULTS_LIVE, donors: 1234 },
			{ locale: "de-DE" },
		);
		button(root, "End campaign").click();
		await flush(10);
		expect(root.querySelector(".confirm p")?.textContent).toContain(
			"1.234 donors have given",
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
		await flush(10);
		button(root, "Keep it live").click();
		await flush(10);
		expect(document.activeElement).toBe(button(root, "End campaign"));

		button(root, "End campaign").click();
		await flush(10);
		root
			.querySelector(".confirm")
			?.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		await flush(10);
		expect(document.activeElement).toBe(button(root, "End campaign"));
	});
});
