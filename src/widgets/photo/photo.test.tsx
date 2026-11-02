/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { PHOTO } from "../../../test/widget-host/fixtures";
import { PhotoData } from "../model";
import { flush, startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { PhotoCard } from "./photo";

async function show(data: PhotoData) {
	const { bridge, host } = await startHost({ context: {} });
	const called: { name: string; args: unknown }[] = [];
	bridge.oncalltool = async (params) => {
		called.push({ name: params.name, args: params.arguments });
		const structuredContent =
			params.name === "get_profile"
				? { id: "u1", name: "Harbor Food Bank" }
				: { url: "https://x.example/p.jpg", alt: "a" };
		return { content: [{ type: "text", text: "ok" }], structuredContent };
	};
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, PhotoData, PhotoCard, "Loading…");
	await bridge.sendToolResult({ content: [], structuredContent: data });
	await flush(10);
	await flush(10);
	return { root, called };
}

const button = (root: HTMLElement, text: string) => {
	const found = [...root.querySelectorAll("button")].find(
		(b) => b.textContent === text,
	);
	if (!found) throw new Error(`no button ${text}`);
	return found;
};

describe("photo card", () => {
	it("shows the connected account and sets the dropped photo as the cover", async () => {
		const { root, called } = await show(PHOTO);
		expect(root.querySelector(".account-name")?.textContent).toBe(
			"Harbor Food Bank",
		);
		button(root, "Set as cover").click();
		await flush(10);
		expect(called.map((c) => c.name)).toContain("app_set_campaign_photo");
		expect(root.textContent).toContain("The photo is now the cover.");
	});

	it("offers the upload link where the host takes no file", async () => {
		const { root } = await show({ ...PHOTO, canUpload: false });
		expect(button(root, "Open upload link")).toBeTruthy();
		expect(
			[...root.querySelectorAll("button")].some(
				(b) => b.textContent === "Set as cover",
			),
		).toBe(false);
	});
});
