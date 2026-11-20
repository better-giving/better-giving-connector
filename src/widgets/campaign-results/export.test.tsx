/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { startFakeHost } from "../../../test/widget-host/fake-host";
import {
	type Fixture,
	RESULTS_LIVE,
	type ToolReply,
} from "../../../test/widget-host/fixtures";
import { connectHost, type Host } from "../host";
import { CampaignResultsData } from "../model";
import { linkedPair, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { MAX_ROWS, readRows } from "./export";
import { CampaignResults } from "./results";

async function render(host: Host) {
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, CampaignResultsData, CampaignResults, "Loading…");
	await vi.waitFor(() => expect(root.textContent).not.toContain("Loading…"));
	return root;
}

/** The results card on a host that saves files, answering its reads from `calls`. */
async function show(
	calls: NonNullable<Fixture["calls"]>,
	more: Partial<Fixture> = {},
) {
	const [viewSide, hostSide] = linkedPair();
	const { log } = await startFakeHost(hostSide, {
		fixture: { result: { structuredContent: RESULTS_LIVE }, calls, ...more },
		theme: "light",
		locale: "en-US",
		width: 640,
	});
	const root = await render(await connectHost({ transport: viewSide }));
	return { root, log };
}

const button = (root: HTMLElement, text: string) => {
	const found = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === text,
	);
	if (!found) throw new Error(`no button ${text}`);
	return found;
};

const press = (root: HTMLElement, text: string) => button(root, text).click();

const note = (root: HTMLElement) =>
	root.querySelector('[role="status"]:not(.sr-only)')?.textContent;

const alertLine = (root: HTMLElement) =>
	root.querySelector('[role="alert"]')?.textContent;

const gift = (n: number, note = "") => ({
	id: `g${n}`,
	amount: { amount: "25.00", currency: "USD" },
	date: "2026-11-01",
	donor_id: `d${n}`,
	method: "card",
	note,
});

const page = (data: unknown[], next_cursor: string | null = null) => ({
	structuredContent: { data, next_cursor },
});

describe("the CSV buttons", () => {
	it("are not there when the host takes no files", async () => {
		const { bridge, host } = await startHost({ caps: { serverTools: {} } });
		await bridge.sendToolResult({
			content: [],
			structuredContent: RESULTS_LIVE,
		});
		await vi.waitFor(() => expect(host.toolResult()).toBeDefined());
		const root = await render(host);
		expect(root.textContent).not.toContain("CSV");
	});

	it("are not there with no gifts to export", async () => {
		const [viewSide, hostSide] = linkedPair();
		await startFakeHost(hostSide, {
			fixture: {
				result: { structuredContent: { ...RESULTS_LIVE, giftCount: 0 } },
			},
			theme: "light",
			locale: "en-US",
			width: 640,
		});
		const root = await render(await connectHost({ transport: viewSide }));
		expect(root.textContent).not.toContain("CSV");
	});

	it("save the campaign's gifts, a typed formula made inert", async () => {
		const { root, log } = await show({
			list_donations: () =>
				page([gift(1, "=HYPERLINK(1)"), gift(2, "thank you")]),
		});
		press(root, "Download gifts (CSV)");
		await vi.waitFor(() => expect(log.downloads).toHaveLength(1));
		expect(log.calls).toEqual([
			{
				name: "list_donations",
				args: { campaign_id: "c-winter", limit: 100 },
			},
		]);
		expect(log.downloads).toEqual([
			{
				name: "gifts-c-winter.csv",
				mimeType: "text/csv",
				text:
					"\ufeffDate,Amount,Currency,Donor ID,Method,Note,Gift ID\r\n" +
					"2026-11-01,25.00,USD,d1,card,'=HYPERLINK(1),g1\r\n" +
					"2026-11-01,25.00,USD,d2,card,thank you,g2\r\n",
			},
		]);
		await vi.waitFor(() => expect(note(root)).toBe("Saved 2 gifts."));
	});

	it("save every donor with their totals", async () => {
		const { root, log } = await show({
			list_donors: () =>
				page([
					{
						id: "d1",
						name: "@admin",
						email: null,
						total: { amount: "50.00", currency: "USD" },
						gift_count: 2,
					},
				]),
		});
		press(root, "Download donors (CSV)");
		await vi.waitFor(() => expect(log.downloads).toHaveLength(1));
		expect(log.downloads[0]?.name).toBe("donors.csv");
		expect(log.downloads[0]?.text).toBe(
			"\ufeffName,Email,Total,Currency,Gifts,Donor ID\r\n'@admin,,50.00,USD,2,d1\r\n",
		);
	});

	it("say how many were saved and that more remain past the cap", async () => {
		const { root, log } = await show({
			list_donations: ({ cursor }) => {
				const from = cursor === undefined ? 0 : Number(cursor);
				const rows = Array.from({ length: 100 }, (_, i) => gift(from + i));
				return page(rows, String(from + 100));
			},
		});
		press(root, "Download gifts (CSV)");
		await vi.waitFor(() => expect(log.downloads).toHaveLength(1));
		expect(log.calls).toHaveLength(MAX_ROWS / 100);
		await vi.waitFor(() =>
			expect(note(root)).toBe(
				"Saved the first 2,000 gifts. There are more: ask in the chat for a date range or a name to get the rest.",
			),
		);
	});

	it("keep focus on the pressed button while it reads, and take no second press", async () => {
		let answer: (reply: ToolReply) => void = () => {};
		const { root, log } = await show({
			list_donations: () =>
				new Promise<ToolReply>((resolve) => {
					answer = resolve;
				}),
		});
		const gifts = button(root, "Download gifts (CSV)");
		const donors = button(root, "Download donors (CSV)");
		gifts.focus();
		gifts.click();
		await vi.waitFor(() =>
			expect(gifts.getAttribute("aria-busy")).toBe("true"),
		);
		expect(gifts.getAttribute("aria-disabled")).toBe("true");
		expect(gifts.disabled).toBe(false);
		expect(donors.getAttribute("aria-disabled")).toBe("true");
		expect(donors.getAttribute("aria-busy")).toBeNull();
		expect(donors.disabled).toBe(false);
		expect(document.activeElement).toBe(gifts);

		gifts.click();
		donors.click();
		await vi.waitFor(() => expect(log.calls).toHaveLength(1));
		answer(page([gift(1)]));
		await vi.waitFor(() => expect(log.downloads).toHaveLength(1));
		await vi.waitFor(() => expect(gifts.getAttribute("aria-busy")).toBeNull());
		expect(gifts.getAttribute("aria-disabled")).toBeNull();
		expect(donors.getAttribute("aria-disabled")).toBeNull();
		expect(log.calls).toHaveLength(1);
		expect(document.activeElement).toBe(gifts);
	});

	it.each([
		["refuses the file", "refused"],
		["fails to take the file", "failed"],
	] as const)("say the file wasn't saved when the host %s", async (_, save) => {
		const { root, log } = await show(
			{ list_donations: () => page([gift(1)]) },
			{ save },
		);
		press(root, "Download gifts (CSV)");
		await vi.waitFor(() =>
			expect(alertLine(root)).toBe("The file wasn't saved. Try gifts again."),
		);
		expect(log.downloads).toEqual([]);
		expect(note(root)).toBe("");
		expect(
			button(root, "Download gifts (CSV)").getAttribute("aria-busy"),
		).toBeNull();
	});

	it("say so, and save nothing, when the read fails", async () => {
		const { root, log } = await show({
			list_donations: () => ({ error: "Better Giving is unreachable." }),
		});
		press(root, "Download gifts (CSV)");
		await vi.waitFor(() =>
			expect(alertLine(root)).toBe("Better Giving is unreachable."),
		);
		expect(log.downloads).toEqual([]);
		expect(note(root)).toBe("");
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
