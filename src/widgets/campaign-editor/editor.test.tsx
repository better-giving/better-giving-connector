/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EDITOR } from "../../../test/widget-host/fixtures";
import { CampaignEditorData } from "../model";
import { startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { CampaignEditor } from "./editor";

const LIVE: CampaignEditorData = {
	...EDITOR,
	campaign: { ...EDITOR.campaign, status: "published" },
};

async function show(data: CampaignEditorData) {
	const { bridge, host } = await startHost({ context: {} });
	bridge.oncalltool = async () => ({
		content: [{ type: "text", text: "ok" }],
		structuredContent: data,
	});
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

async function saveAnEdit(root: HTMLElement) {
	const field = root.querySelector<HTMLInputElement>(
		".editor-fields input, .editor-fields textarea",
	);
	if (!field) throw new Error("no field");
	field.value = "Changed";
	field.dispatchEvent(new Event("input", { bubbles: true }));
	const save = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === "Save",
	);
	await vi.waitFor(() => expect(save?.disabled).toBe(false));
	save?.click();
}

const status = (root: HTMLElement) =>
	root.querySelector('[role="status"]')?.textContent;

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
