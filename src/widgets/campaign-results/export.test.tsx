/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it, vi } from "vitest";
import { RESULTS_LIVE } from "../../../test/widget-host/fixtures";
import { CampaignResultsData } from "../model";
import { ALL_CAPS, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { MAX_ROWS, readRows } from "./export";
import { CampaignResults } from "./results";

type Reply = { data: unknown[]; next_cursor: string | null };

async function show(
	data: CampaignResultsData,
	caps: McpUiHostCapabilities,
	answer: (name: string, args: Record<string, unknown>) => Reply,
) {
	const { bridge, host } = await startHost({ caps });
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	bridge.oncalltool = async ({ name, arguments: args = {} }) => {
		calls.push({ name, args });
		const reply = answer(name, args);
		return { content: [], structuredContent: reply };
	};
	const files: { name: string; text: string }[] = [];
	bridge.ondownloadfile = async ({ contents }) => {
		for (const item of contents) {
			if (item.type === "resource" && "text" in item.resource) {
				files.push({ name: item.resource.uri, text: item.resource.text });
			}
		}
		return {};
	};
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, CampaignResultsData, CampaignResults, "Loading…");
	await bridge.sendToolResult({ content: [], structuredContent: data });
	await vi.waitFor(() => expect(root.textContent).not.toContain("Loading…"));
	return { root, calls, files };
}

const press = (root: HTMLElement, text: string) => {
	const found = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === text,
	);
	if (!found) throw new Error(`no button ${text}`);
	found.click();
};

const gift = (n: number, note = "") => ({
	id: `g${n}`,
	amount: { amount: "25.00", currency: "USD" },
	date: "2026-11-01",
	donor_id: `d${n}`,
	method: "card",
	note,
});

describe("the CSV buttons", () => {
	it("are not there when the host takes no files", async () => {
		const { root } = await show(RESULTS_LIVE, { serverTools: {} }, () => ({
			data: [],
			next_cursor: null,
		}));
		expect(root.textContent).not.toContain("CSV");
	});

	it("are not there with no gifts to export", async () => {
		const { root } = await show(
			{ ...RESULTS_LIVE, giftCount: 0 },
			ALL_CAPS,
			() => ({ data: [], next_cursor: null }),
		);
		expect(root.textContent).not.toContain("CSV");
	});

	it("save the campaign's gifts, a typed formula made inert", async () => {
		const { root, calls, files } = await show(RESULTS_LIVE, ALL_CAPS, () => ({
			data: [gift(1, "=HYPERLINK(1)"), gift(2, "thank you")],
			next_cursor: null,
		}));
		press(root, "Download gifts (CSV)");
		await vi.waitFor(() => expect(files).toHaveLength(1));
		expect(calls).toEqual([
			{
				name: "list_donations",
				args: { campaign_id: "c-winter", limit: 100 },
			},
		]);
		expect(files[0]?.name).toBe("file:///gifts-c-winter.csv");
		expect(files[0]?.text).toBe(
			"﻿Date,Amount,Currency,Donor ID,Method,Note,Gift ID\r\n" +
				"2026-11-01,25.00,USD,d1,card,'=HYPERLINK(1),g1\r\n" +
				"2026-11-01,25.00,USD,d2,card,thank you,g2\r\n",
		);
		await vi.waitFor(() =>
			expect(
				root.querySelector('[role="status"]:not(.sr-only)')?.textContent,
			).toBe("Saved 2 gifts."),
		);
	});

	it("save every donor with their totals", async () => {
		const { root, files } = await show(RESULTS_LIVE, ALL_CAPS, () => ({
			data: [
				{
					id: "d1",
					name: "@admin",
					email: null,
					total: { amount: "50.00", currency: "USD" },
					gift_count: 2,
				},
			],
			next_cursor: null,
		}));
		press(root, "Download donors (CSV)");
		await vi.waitFor(() => expect(files).toHaveLength(1));
		expect(files[0]?.text).toBe(
			"﻿Name,Email,Total,Currency,Gifts,Donor ID\r\n'@admin,,50.00,USD,2,d1\r\n",
		);
	});

	it("say so, and save nothing, when the read fails", async () => {
		const { bridge, host } = await startHost({ caps: ALL_CAPS });
		bridge.oncalltool = async () => ({
			isError: true,
			content: [{ type: "text", text: "Better Giving is unreachable." }],
		});
		document.body.replaceChildren();
		const root = document.createElement("div");
		document.body.append(root);
		renderWidget(root, host, CampaignResultsData, CampaignResults, "Loading…");
		await bridge.sendToolResult({
			content: [],
			structuredContent: RESULTS_LIVE,
		});
		await vi.waitFor(() => expect(root.textContent).not.toContain("Loading…"));
		press(root, "Download gifts (CSV)");
		await vi.waitFor(() =>
			expect(root.querySelector('[role="alert"]')?.textContent).toBe(
				"Better Giving is unreachable.",
			),
		);
	});
});

describe("readRows", () => {
	const pages = (total: number) => {
		const asked: (string | undefined)[] = [];
		const page = async (cursor: string | undefined) => {
			asked.push(cursor);
			const from = cursor === undefined ? 0 : Number(cursor);
			const data = Array.from({ length: 100 }, (_, i) => from + i).filter(
				(n) => n < total,
			);
			const next = from + 100;
			return {
				ok: true as const,
				data: { data, next_cursor: next < total ? String(next) : null },
			};
		};
		return { page, asked };
	};

	it("stops at the cap on a huge account and says rows remain", async () => {
		const { page, asked } = pages(1_000_000);
		const read = await readRows(page);
		expect(read).toMatchObject({ ok: true, more: true });
		if (read.ok) expect(read.rows).toHaveLength(MAX_ROWS);
		expect(asked).toHaveLength(MAX_ROWS / 100);
	});

	it("reads a short list whole", async () => {
		const read = await readRows(pages(250).page);
		expect(read).toMatchObject({ ok: true, more: false });
		if (read.ok) expect(read.rows).toHaveLength(250);
	});

	it("is not caught in a cursor that never moves", async () => {
		const read = await readRows(async () => ({
			ok: true as const,
			data: { data: [1], next_cursor: "same" },
		}));
		expect(read).toMatchObject({ ok: true, more: false });
		if (read.ok) expect(read.rows).toHaveLength(2);
	});
});
