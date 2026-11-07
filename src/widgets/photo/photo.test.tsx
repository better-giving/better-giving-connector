/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { PHOTO } from "../../../test/widget-host/fixtures";
import { PhotoData } from "../model";
import { startHost } from "../test-dom";
import { renderWidget } from "../ui/widget";
import { PhotoCard } from "./photo";

type Profile =
	| { name: string }
	| { failing: true }
	| { pending: Promise<string> };

const HARBOR = { name: "Harbor Food Bank" };

async function show(data: PhotoData, profile: Profile = HARBOR) {
	const { bridge, host } = await startHost({ context: {} });
	const called: { name: string; args: unknown }[] = [];
	bridge.oncalltool = async (params) => {
		called.push({ name: params.name, args: params.arguments });
		if (params.name === "get_profile") {
			if ("failing" in profile) {
				return {
					isError: true,
					content: [{ type: "text", text: "Profile unavailable." }],
				};
			}
			const name = "pending" in profile ? await profile.pending : profile.name;
			return {
				content: [{ type: "text", text: "ok" }],
				structuredContent: { id: "u1", name },
			};
		}
		return {
			content: [{ type: "text", text: "ok" }],
			structuredContent: { url: "https://x.example/p.jpg", alt: "a" },
		};
	};
	const asked: unknown[] = [];
	bridge.onmessage = async (params: unknown) => {
		asked.push(params);
		return {};
	};
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	renderWidget(root, host, PhotoData, PhotoCard, "Loading…");
	await bridge.sendToolResult({ content: [], structuredContent: data });
	await vi.waitFor(() => expect(root.querySelector(".account")).not.toBeNull());
	if ("name" in profile) {
		await vi.waitFor(() =>
			expect(root.querySelector(".account-name")?.textContent).toBe(
				profile.name.trim() ? profile.name : "Your nonprofit",
			),
		);
	}
	return { root, called, bridge, asked };
}

const userMessage = (text: string) => ({
	role: "user",
	content: [{ type: "text", text }],
});

const SWITCH_PROMPT =
	"I want to connect a different Better Giving nonprofit. Walk me through switching.";
const DISCONNECT_PROMPT =
	"I want to disconnect Better Giving from this chat. Where do I do that?";

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
		await vi.waitFor(() =>
			expect(root.querySelector('[role="status"]')?.textContent).toBe(
				"The photo is now the cover.",
			),
		);
		expect(called.map((c) => c.name)).toContain("app_set_campaign_photo");
	});

	describe("account panel", () => {
		it("shows the connected nonprofit with its initials and a Connected pill", async () => {
			const { root } = await show(PHOTO);
			expect(root.querySelector(".avatar")?.textContent).toBe("HF");
			expect(root.querySelector(".badge-success")?.textContent).toBe(
				"Connected",
			);
		});

		it("offers only the connected nonprofit, never a list of others", async () => {
			const { root } = await show(PHOTO);
			const account = root.querySelector(".account") as HTMLElement;
			expect(
				account.querySelectorAll(
					"select, option, li, input, [role=listbox], [role=radio]",
				).length,
			).toBe(0);
			expect(
				[...account.querySelectorAll("button")].map((b) => b.textContent),
			).toEqual(["Switch nonprofit", "How to disconnect"]);
		});

		it("asks the chat to start a switch, and only that", async () => {
			const { root, asked } = await show(PHOTO);
			button(root, "Switch nonprofit").click();
			await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0));
			expect(asked).toEqual([userMessage(SWITCH_PROMPT)]);
		});

		it("asks the chat how to disconnect, with its own prompt", async () => {
			const { root, asked } = await show(PHOTO);
			button(root, "How to disconnect").click();
			await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0));
			expect(asked).toEqual([userMessage(DISCONNECT_PROMPT)]);
		});

		it("tells the person when the chat refuses the ask, and clears it on the next ask", async () => {
			const { root, bridge, asked } = await show(PHOTO);
			bridge.onmessage = async () => ({ isError: true });
			button(root, "Switch nonprofit").click();
			await vi.waitFor(() =>
				expect(root.querySelector('[role="alert"]')?.textContent).toBe(
					"Couldn't ask the chat. Ask it in your own words instead.",
				),
			);
			bridge.onmessage = async (params: unknown) => {
				asked.push(params);
				return {};
			};
			button(root, "How to disconnect").click();
			await vi.waitFor(() => expect(asked.length).toBe(1));
			expect(root.querySelector('[role="alert"]')).toBeNull();
		});

		it.each([
			["a lowercase two-word name", "harbor food", "HF"],
			["a one-word name", "Harbor", "H"],
			["a name of three or more words", "Friends of the Harbor", "FO"],
			["extra and surrounding whitespace", "  harbor \t  food   bank ", "HF"],
			["a non-Latin name", "北海道 食料銀行", "北食"],
			["a right-to-left name", "بنك الطعام", "با"],
			["a first character outside the BMP", "\u{1F600} Food", "\u{1F600}F"],
		])(
			"derives the avatar initials from %s",
			async (_label, name, initials) => {
				const { root } = await show(PHOTO, { name });
				expect(root.querySelector(".avatar")?.textContent).toBe(initials);
				expect(root.querySelector(".account-name")?.textContent).toBe(name);
			},
		);

		it("falls back to a generic name for an empty profile name", async () => {
			const { root } = await show(PHOTO, { name: "" });
			await vi.waitFor(() =>
				expect(root.querySelector(".account-name")?.textContent).toBe(
					"Your nonprofit",
				),
			);
			expect(root.querySelector(".avatar")?.textContent).toBe("");
		});

		it("shows a placeholder until the profile arrives, with the buttons already working", async () => {
			let resolve: (name: string) => void = () => {};
			const pending = new Promise<string>((r) => {
				resolve = r;
			});
			const { root, asked } = await show(PHOTO, { pending });
			expect(root.querySelector(".account-name")?.textContent).toBe("…");
			expect(root.querySelector(".avatar")?.textContent).toBe("");
			button(root, "Switch nonprofit").click();
			await vi.waitFor(() => expect(asked.length).toBe(1));
			resolve("Harbor Food Bank");
			await vi.waitFor(() =>
				expect(root.querySelector(".account-name")?.textContent).toBe(
					"Harbor Food Bank",
				),
			);
			expect(root.querySelector(".avatar")?.textContent).toBe("HF");
		});

		it("falls back to a generic name and keeps working buttons when the profile call fails", async () => {
			const { root, called, asked } = await show(PHOTO, { failing: true });
			await vi.waitFor(() =>
				expect(called.map((c) => c.name)).toContain("get_profile"),
			);
			button(root, "How to disconnect").click();
			await vi.waitFor(() => expect(asked.length).toBe(1));
			await vi.waitFor(() =>
				expect(root.querySelector(".account-name")?.textContent).toBe(
					"Your nonprofit",
				),
			);
			expect(root.querySelector(".avatar")?.textContent).toBe("");
			expect(root.querySelector('[role="alert"]')).toBeNull();
		});
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
