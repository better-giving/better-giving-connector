/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { describe, expect, it, vi } from "vitest";
import { CREATE } from "../../../test/widget-host/fixtures";
import { CampaignCreateData, type CreateResult } from "../model";
import { startHost } from "../test-dom";
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

async function mountForm(result: CreateResult) {
	const { bridge, host } = await startHost({ context: {} });
	bridge.oncalltool = (async () => ({
		content: [{ type: "text", text: "ok" }],
		structuredContent: result,
	})) satisfies AppBridge["oncalltool"];
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, CampaignCreateData, CampaignCreate, "Loading…");
	await bridge.sendToolResult({ content: [], structuredContent: CREATE });
	await vi.waitFor(() => expect(root.querySelector(".presets")).not.toBeNull());
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

describe("the create card's footer", () => {
	it("holds Customize, Create draft and the summary in a footer after the body", async () => {
		const root = await mountForm(RESULT);
		const footer = root.querySelector("article.card > .ds-card-footer");

		expect(footer?.previousElementSibling?.classList.contains("ds-card-body")).toBe(
			true,
		);
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
