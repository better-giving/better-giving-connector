/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type {
	AppBridge,
	McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR } from "../../../test/widget-host/fixtures";
import { CampaignEditorData } from "../model";
import { applyStyles, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { CampaignEditor } from "./editor";

type Call = { name: string; args: Record<string, unknown> };
type Answer = Awaited<ReturnType<NonNullable<AppBridge["oncalltool"]>>>;

const calls: Call[] = [];
beforeEach(() => {
	calls.length = 0;
});

const LIVE: CampaignEditorData = {
	...EDITOR,
	campaign: { ...EDITOR.campaign, status: "published" },
};

const answer = (data: CampaignEditorData): Answer => ({
	content: [{ type: "text", text: "ok" }],
	structuredContent: data,
});

async function show(
	data: CampaignEditorData,
	respond: (call: Call) => Answer = () => answer(data),
	context: McpUiHostContext = {},
) {
	const { bridge, host } = await startHost({ context });
	bridge.oncalltool = async ({ name, arguments: args = {} }) => {
		const call = { name, args };
		calls.push(call);
		return respond(call);
	};
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, CampaignEditorData, CampaignEditor, "Loading…");
	await bridge.sendToolResult({ content: [], structuredContent: data });
	await vi.waitFor(() => expect(root.querySelector(".editor")).not.toBeNull());
	return root;
}

const buttons = (root: HTMLElement) =>
	[...root.querySelectorAll("button")].map((b) => b.textContent);

async function editField(root: HTMLElement) {
	const field = root.querySelector<HTMLInputElement>(
		".editor-fields input, .editor-fields textarea",
	);
	if (!field) throw new Error("no field");
	field.value = "Changed";
	field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function clickButton(root: HTMLElement, label: string) {
	const button = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === label,
	);
	await vi.waitFor(() => {
		expect(button).toBeDefined();
		expect(button?.disabled).toBe(false);
	});
	button?.click();
}

async function saveAnEdit(root: HTMLElement) {
	await editField(root);
	await clickButton(root, "Save");
}

const status = (root: HTMLElement) =>
	root.querySelector('[role="status"]')?.textContent;

const saves = () => calls.filter((c) => c.name === "app_save_campaign_edit");

describe("the campaign editor on a live campaign", () => {
	it("says a Platform save waits as a draft, and offers to publish it", async () => {
		const root = await show({ ...LIVE, draftsLiveEdits: true });

		expect(buttons(root)).toContain("Publish changes");
		await saveAnEdit(root);

		await vi.waitFor(() => expect(status(root)).toBe("Saved as a draft."));
	});

	it("says a Standalone save is saved, with nothing left to publish", async () => {
		const root = await show({ ...LIVE, draftsLiveEdits: false });

		expect(buttons(root)).not.toContain("Publish changes");
		await saveAnEdit(root);

		await vi.waitFor(() =>
			expect(status(root)).toBe("Saved. Donors see it now."),
		);
	});
});

describe("the campaign editor and the draft revision", () => {
	const PENDING: CampaignEditorData = {
		...LIVE,
		draftsLiveEdits: true,
		pendingDraft: true,
		draftRevision: 3,
	};
	const CHANGED =
		"This draft changed elsewhere since you opened it. Open it again to see the latest.";
	const refuse = (): Answer => ({
		isError: true,
		content: [{ type: "text", text: CHANGED }],
	});

	it("saves with the revision it was opened with, then with the one each save returned", async () => {
		const root = await show(PENDING, () =>
			answer({ ...PENDING, draftRevision: 4 }),
		);

		await saveAnEdit(root);
		await vi.waitFor(() => expect(status(root)).toBe("Saved as a draft."));
		expect(saves()[0]?.args.draftRevision).toBe(3);

		await saveAnEdit(root);
		await vi.waitFor(() => expect(saves()).toHaveLength(2));
		expect(saves()[1]?.args.draftRevision).toBe(4);
	});

	it("discards with the current revision", async () => {
		const root = await show(PENDING, () =>
			answer({ ...PENDING, pendingDraft: false, draftRevision: null }),
		);

		await clickButton(root, "Discard draft edits");

		await vi.waitFor(() => expect(status(root)).toBe("Draft edits discarded."));
		const discard = calls.find((c) => c.name === "app_discard_campaign_draft");
		expect(discard?.args).toEqual({
			id: PENDING.campaign.id,
			draftRevision: 3,
		});
	});

	it("shows a refused save's message, keeps the edits and does not say saved", async () => {
		const root = await show(PENDING, refuse);

		await saveAnEdit(root);

		await vi.waitFor(() =>
			expect(root.querySelector(".error-line")?.textContent).toBe(CHANGED),
		);
		expect(root.querySelector(".editor-saved")?.textContent).toBe(
			"Unsaved changes",
		);
		expect(status(root)).toBe("");
		expect(
			root.querySelector<HTMLInputElement>(
				".editor-fields input, .editor-fields textarea",
			)?.value,
		).toBe("Changed");
	});

	it("shows a refused discard's message and keeps the unsaved edits", async () => {
		const root = await show(PENDING, refuse);

		await editField(root);
		await clickButton(root, "Discard draft edits");

		await vi.waitFor(() =>
			expect(root.querySelector(".error-line")?.textContent).toBe(CHANGED),
		);
		expect(root.querySelector(".editor-saved")?.textContent).toBe(
			"Unsaved changes",
		);
		expect(status(root)).toBe("");
	});

	it("offers no Discard when the data shows no pending draft", async () => {
		const root = await show({
			...LIVE,
			pendingDraft: false,
			draftRevision: null,
		});

		expect(buttons(root)).not.toContain("Discard draft edits");
	});
});

describe("campaign editor preview", () => {
	it("sets its headings in the donor page's face, not the widget's", async () => {
		applyStyles("ui/styles.css", "campaign-editor/editor.css");
		const root = await show(EDITOR);
		const preview = root.querySelector(".preview");
		const face = getComputedStyle(preview as Element).fontFamily;
		const headings = [...(preview?.querySelectorAll("h1, h2, h3") ?? [])].map(
			(h) => getComputedStyle(h).fontFamily,
		);
		expect(face).toMatch(/^Quicksand/);
		expect(headings.length).toBeGreaterThan(0);
		expect(new Set(headings)).toEqual(new Set([face]));
	});
});

describe("campaign editor row buttons", () => {
	const sizes = async (context: McpUiHostContext) => {
		applyStyles("ui/styles.css", "campaign-editor/editor.css");
		const root = await show(EDITOR, () => answer(EDITOR), context);
		const found = [...root.querySelectorAll(".outline .icon-btn")];
		const row = root.querySelector(".outline-item");
		const name = row?.querySelector(".outline-label")?.textContent;
		expect(
			[...(row?.querySelectorAll(".icon-btn") ?? [])].map((b) =>
				b.getAttribute("aria-label"),
			),
		).toEqual([`Move ${name} up`, `Move ${name} down`, `Remove ${name}`]);
		await vi.waitFor(() =>
			expect(document.documentElement.hasAttribute("data-touch")).toBe(
				context.deviceCapabilities?.touch === true,
			),
		);
		return new Set(
			found.flatMap((b) => {
				const style = getComputedStyle(b);
				return [style.minWidth, style.minHeight];
			}),
		);
	};

	it("squares the up, down and remove buttons at 44px on a touch host", async () => {
		expect(await sizes({ deviceCapabilities: { touch: true } })).toEqual(
			new Set(["44px"]),
		);
	});

	it("keeps them 32px square where the host is not touch", async () => {
		expect(await sizes({})).toEqual(new Set(["32px"]));
	});
});

describe("campaign editor Replace photo", () => {
	it("is described by its help, and a button without one is undescribed", async () => {
		const root = await show({
			...EDITOR,
			page: { pageKind: "content", content: { heading: "Clean water" } },
		});
		[...root.querySelectorAll("button")]
			.find((b) => b.textContent?.includes("Hero photo"))
			?.click();
		const replace = await vi.waitFor(() => {
			const found = [...root.querySelectorAll("button")].find(
				(b) => b.textContent === "Replace photo",
			);
			if (!found) throw new Error("no Replace photo button");
			return found;
		});
		const describedBy = replace.getAttribute("aria-describedby");
		if (!describedBy) throw new Error("Replace photo has no aria-describedby");
		const help = document.getElementById(describedBy);
		expect(help?.classList.contains("ds-field-help")).toBe(true);
		expect(help?.textContent).toBe(
			"Opens a one-time upload page. Reopen the editor afterwards to see the new photo.",
		);
		expect(help?.closest(".ds-field")).toBe(replace.closest(".ds-field"));

		const save = [...root.querySelectorAll("button")].find(
			(b) => b.textContent === "Save",
		);
		expect(save?.hasAttribute("aria-describedby")).toBe(false);
	});
});

describe("campaign editor tier amounts", () => {
	async function openAmounts(root: HTMLElement) {
		const donationForm = [...root.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Donation form"),
		);
		donationForm?.click();
		return vi.waitFor(() => {
			const fields = [
				...root.querySelectorAll<HTMLInputElement>('input[type="number"]'),
			];
			expect(fields.length).toBeGreaterThan(0);
			return fields;
		});
	}

	const type = (field: HTMLInputElement | undefined, value: string) => {
		if (!field) throw new Error("no amount field");
		field.value = value;
		field.dispatchEvent(new Event("input", { bubbles: true }));
	};

	it("accepts any decimal, so the field is never marked invalid for its step", async () => {
		const root = await show({
			...EDITOR,
			page: {
				pageKind: "content",
				content: { tiers: [{ amountMinor: 2500, buys: "A coat" }] },
			},
		});
		const [amount] = await openAmounts(root);
		if (!amount) throw new Error("no amount field");
		expect(amount.getAttribute("step")).toBe("any");
		amount.value = "12.345";
		expect(amount.validity.stepMismatch).toBe(false);
	});

	it("saves a whole yen amount but not a fractional one", async () => {
		const tiers = [
			{ amountMinor: 2500, buys: "A coat" },
			{ amountMinor: 5000, buys: "Boots" },
		];
		const root = await show({
			...EDITOR,
			formAmounts: [{ amount: "2500", currency: "JPY" }],
			page: { pageKind: "content", content: { tiers } },
		});
		const [first, second] = await openAmounts(root);
		expect(first?.getAttribute("step")).toBe("1");

		type(first, "1.5");
		type(second, "7");
		await clickButton(root, "Save");

		await vi.waitFor(() => expect(saves()).toHaveLength(1));
		expect(saves()[0]?.args.page).toEqual({
			pageKind: "content",
			content: {
				tiers: [
					{ amountMinor: 2500, buys: "A coat" },
					{ amountMinor: 7, buys: "Boots" },
				],
			},
		});
	});
});
