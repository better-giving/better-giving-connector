// @vitest-environment happy-dom
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps/app-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenAiGlobals } from "./host";
import { startHost as start } from "./test-dom";

/** Let queued transport messages land. */
const settle = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => {
	delete document.documentElement.dataset.theme;
	vi.restoreAllMocks();
});

describe("host context", () => {
	it("applies the bridge's theme to the document", async () => {
		await start({ context: { theme: "dark" } });
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("follows a theme change from the host and tells subscribers", async () => {
		const { bridge, host } = await start({ context: { theme: "dark" } });
		const seen = vi.fn();
		host.subscribe(seen);
		await bridge.sendHostContextChange({ theme: "light" });
		await settle();
		expect(document.documentElement.dataset.theme).toBe("light");
		expect(host.context().theme).toBe("light");
		expect(seen).toHaveBeenCalled();
	});

	it("takes the bridge's theme, locale and display mode over window.openai's", async () => {
		const { host } = await start({
			context: { theme: "light", locale: "fr-FR", displayMode: "fullscreen" },
			openai: { theme: "dark", locale: "de-DE", displayMode: "pip" },
		});
		expect(host.context()).toMatchObject({
			theme: "light",
			locale: "fr-FR",
			displayMode: "fullscreen",
		});
		expect(document.documentElement.dataset.theme).toBe("light");
	});

	it("fills only the fields the bridge lacks from window.openai", async () => {
		const { host } = await start({
			context: { locale: "fr-FR" },
			openai: { theme: "dark", locale: "de-DE", displayMode: "pip" },
		});
		expect(host.context()).toMatchObject({
			theme: "dark",
			locale: "fr-FR",
			displayMode: "pip",
		});
		expect(document.documentElement.dataset.theme).toBe("dark");
	});

	it("falls back to en-US and inline, and leaves the theme to the browser, with neither", async () => {
		const { host } = await start({ context: { locale: "not a locale!" } });
		expect(host.context()).toMatchObject({
			theme: undefined,
			locale: "en-US",
			displayMode: "inline",
		});
		expect(document.documentElement.dataset.theme).toBeUndefined();
	});

	it("puts the host's radius variables on the document", async () => {
		await start({
			context: {
				styles: { variables: { "--border-radius-lg": "24px" } as never },
			},
		});
		expect(
			document.documentElement.style.getPropertyValue("--border-radius-lg"),
		).toBe("24px");
	});
});

describe("tool input and result", () => {
	it("delivers the structured result, and again when the host updates it", async () => {
		const { bridge, host } = await start();
		expect(host.toolResult()).toBeUndefined();
		await bridge.sendToolInput({ arguments: { status: "live" } });
		await bridge.sendToolResult({
			content: [{ type: "text", text: "3 campaigns" }],
			structuredContent: { n: 3 },
		});
		await settle();
		expect(host.toolInput()).toEqual({ status: "live" });
		expect(host.toolResult()).toEqual({
			ok: true,
			data: { n: 3 },
			text: "3 campaigns",
		});
		await bridge.sendToolResult({ content: [], structuredContent: { n: 4 } });
		await settle();
		expect(host.toolResult()).toMatchObject({ data: { n: 4 } });
	});

	it("turns an error result into the tool's own sentence", async () => {
		const { bridge, host } = await start();
		await bridge.sendToolResult({
			isError: true,
			content: [{ type: "text", text: "Reconnect Better Giving." }],
		});
		await settle();
		expect(host.toolResult()).toEqual({
			ok: false,
			error: "Reconnect Better Giving.",
		});
	});

	it("starts from window.openai's toolOutput until the bridge sends one", async () => {
		const { host } = await start({ openai: { toolOutput: { n: 1 } } });
		expect(host.toolResult()).toMatchObject({ ok: true, data: { n: 1 } });
	});
});

describe("callTool", () => {
	it("calls the server tool through the bridge", async () => {
		const { bridge, host } = await start();
		const calls: unknown[] = [];
		bridge.oncalltool = async (params) => {
			calls.push(params);
			return { content: [], structuredContent: { id: "c1" } };
		};
		const out = await host.callTool("app_publish_campaign", { id: "c1" });
		expect(calls).toMatchObject([
			{ name: "app_publish_campaign", arguments: { id: "c1" } },
		]);
		expect(out).toEqual({ ok: true, data: { id: "c1" }, text: "" });
	});

	it("returns the tool's error sentence, never the raw result", async () => {
		const { bridge, host } = await start();
		bridge.oncalltool = async () => ({
			isError: true,
			content: [{ type: "text", text: "This campaign has ended." }],
		});
		expect(await host.callTool("app_end_campaign", {})).toEqual({
			ok: false,
			error: "This campaign has ended.",
		});
	});

	it("returns a plain sentence when the call never reaches a tool", async () => {
		const { bridge, host } = await start();
		bridge.oncalltool = async () => {
			throw new Error('{"code":-32603,"secret":"internal"}');
		};
		const out = await host.callTool("app_end_campaign", {});
		expect(out.ok).toBe(false);
		expect(out).not.toMatchObject({ error: expect.stringContaining("{") });
	});
});

describe("widget state", () => {
	it("keeps state in memory without window.openai", async () => {
		const { host } = await start();
		expect(host.getState()).toBeUndefined();
		host.setState({ preset: "year-end" });
		expect(host.getState()).toEqual({ preset: "year-end" });
	});

	it("persists through window.openai.widgetState when present", async () => {
		const openai: Partial<OpenAiGlobals> = {
			widgetState: { preset: "capital" },
		};
		openai.setWidgetState = vi.fn((s: unknown) => {
			openai.widgetState = s;
		});
		const { host } = await start({ openai });
		expect(host.getState()).toEqual({ preset: "capital" });
		host.setState({ preset: "emergency" });
		expect(openai.setWidgetState).toHaveBeenCalledWith({
			preset: "emergency",
		});
		expect(host.getState()).toEqual({ preset: "emergency" });
	});
});

describe("display mode, links and follow-ups", () => {
	it("asks the bridge for fullscreen when the host offers it", async () => {
		const requestDisplayMode = vi.fn();
		const { bridge, host } = await start({
			context: { availableDisplayModes: ["inline", "fullscreen"] },
			openai: { requestDisplayMode },
		});
		bridge.onrequestdisplaymode = async ({ mode }) => ({ mode });
		expect(await host.requestFullscreen()).toBe("fullscreen");
		expect(requestDisplayMode).not.toHaveBeenCalled();
	});

	it("falls back to window.openai for fullscreen when the bridge doesn't offer it", async () => {
		const requestDisplayMode = vi.fn(async () => ({
			mode: "fullscreen" as const,
		}));
		const { host } = await start({ openai: { requestDisplayMode } });
		expect(await host.requestFullscreen()).toBe("fullscreen");
		expect(requestDisplayMode).toHaveBeenCalledWith({ mode: "fullscreen" });
	});

	it("stays inline when no one offers fullscreen", async () => {
		const { host } = await start();
		expect(await host.requestFullscreen()).toBe("inline");
	});

	it("opens links through the bridge, or openExternal when the bridge can't", async () => {
		const withBridge = await start();
		const opened: string[] = [];
		withBridge.bridge.onopenlink = async ({ url }) => {
			opened.push(url);
			return {};
		};
		await withBridge.host.openLink("https://example.org/a");
		expect(opened).toEqual(["https://example.org/a"]);

		const openExternal = vi.fn();
		const noLinks = await start({ caps: {}, openai: { openExternal } });
		await noLinks.host.openLink("https://example.org/b");
		expect(openExternal).toHaveBeenCalledWith({
			href: "https://example.org/b",
		});
	});

	it("sends a follow-up as the user's message", async () => {
		const { bridge, host } = await start();
		const sent: unknown[] = [];
		bridge.onmessage = async (params) => {
			sent.push(params);
			return {};
		};
		await host.sendFollowUp("Show results for Winter coats");
		expect(sent).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "Show results for Winter coats" }],
			},
		]);
	});

	it("reports the document size to the host", async () => {
		const { bridge, host } = await start();
		const sizes: unknown[] = [];
		bridge.onsizechange = (size) => sizes.push(size);
		host.reportSize();
		await settle();
		expect(sizes.at(-1)).toEqual({
			width: expect.any(Number),
			height: expect.any(Number),
		});
	});
});

describe("file uploads", () => {
	it("are off without window.openai's file APIs", async () => {
		const { host } = await start();
		expect(host.canUploadFiles).toBe(false);
		await expect(host.uploadFile(new File(["x"], "a.png"))).rejects.toThrow();
	});

	it("upload through window.openai and resolve a download URL", async () => {
		const uploadFile = vi.fn(async () => ({ fileId: "file_1" }));
		const getFileDownloadUrl = vi.fn(async () => ({
			downloadUrl: "https://files.example/file_1",
		}));
		const { host } = await start({
			openai: { uploadFile, getFileDownloadUrl },
		});
		expect(host.canUploadFiles).toBe(true);
		const file = new File(["x"], "a.png", { type: "image/png" });
		expect(await host.uploadFile(file)).toEqual({
			fileId: "file_1",
			downloadUrl: "https://files.example/file_1",
		});
		expect(uploadFile).toHaveBeenCalledWith(file);
		expect(getFileDownloadUrl).toHaveBeenCalledWith({ fileId: "file_1" });
	});
});
