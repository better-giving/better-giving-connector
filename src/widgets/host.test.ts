// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenAiGlobals } from "./host";
import { startHost as start } from "./test-dom";

afterEach(() => {
	delete document.documentElement.dataset.theme;
	document.documentElement.classList.remove("dark");
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

// happy-dom's URL rejects file: URLs, so read by path from the repo root (as test-dom.ts does)
const { process: nodeProcess } = globalThis as unknown as {
	process: {
		cwd(): string;
		getBuiltinModule(id: "node:fs"): {
			readFileSync(path: string, encoding: "utf8"): string;
		};
	};
};
const registryTheme = nodeProcess
	.getBuiltinModule("node:fs")
	.readFileSync(
		`${nodeProcess.cwd()}/src/widgets/registry/styles/themes/default.css`,
		"utf8",
	);

/** A browser whose colour scheme the test flips; `change` listeners really fire. */
function stubBrowser(initiallyDark: boolean) {
	let dark = initiallyDark;
	const listeners = new Set<() => void>();
	const query = {
		get matches() {
			return dark;
		},
		addEventListener(type: string, listener: () => void) {
			if (type === "change") listeners.add(listener);
		},
	};
	vi.stubGlobal("matchMedia", () => query);
	return {
		setDark(next: boolean) {
			dark = next;
			for (const listener of listeners) listener();
		},
	};
}

/** host.ts keeps one browser listener per module load, so each test loads it fresh. */
async function freshStart(opts: Parameters<typeof start>[0] = {}) {
	vi.resetModules();
	const { startHost } = await import("./test-dom");
	return startHost(opts);
}

const isDark = () => document.documentElement.classList.contains("dark");

describe("host context", () => {
	it("applies the bridge's theme to the document", async () => {
		await start({ context: { theme: "dark" } });
		expect(document.documentElement.dataset.theme).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
	});

	it("follows a theme change from the host and tells subscribers", async () => {
		const { bridge, host } = await start({ context: { theme: "dark" } });
		const seen = vi.fn();
		host.subscribe(seen);
		await bridge.sendHostContextChange({ theme: "light" });
		await vi.waitFor(() => expect(seen).toHaveBeenCalled());
		expect(document.documentElement.dataset.theme).toBe("light");
		expect(document.documentElement.classList.contains("dark")).toBe(false);
		expect(host.context().theme).toBe("light");
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

describe("theme and the browser", () => {
	it("follows the browser's colour scheme at start, light or dark", async () => {
		stubBrowser(false);
		await freshStart({ context: {} });
		expect(isDark()).toBe(false);

		document.documentElement.classList.remove("dark");
		stubBrowser(true);
		await freshStart({ context: {} });
		expect(isDark()).toBe(true);
	});

	it("follows the browser switching scheme mid-session, both ways", async () => {
		const browser = stubBrowser(false);
		await freshStart({ context: {} });
		browser.setDark(true);
		expect(isDark()).toBe(true);
		browser.setDark(false);
		expect(isDark()).toBe(false);
	});

	it("keeps a host's light theme when the browser is dark", async () => {
		const browser = stubBrowser(true);
		await freshStart({ context: { theme: "light" } });
		expect(isDark()).toBe(false);
		browser.setDark(false);
		browser.setDark(true);
		expect(isDark()).toBe(false);
	});

	it("keeps a host's dark theme when the browser is light", async () => {
		const browser = stubBrowser(false);
		await freshStart({ context: { theme: "dark" } });
		expect(isDark()).toBe(true);
		browser.setDark(true);
		browser.setDark(false);
		expect(isDark()).toBe(true);
	});

	it("returns to following the browser when the host drops its theme", async () => {
		const browser = stubBrowser(true);
		const { bridge } = await freshStart({ context: { theme: "light" } });
		expect(isDark()).toBe(false);
		await bridge.sendHostContextChange({ theme: undefined });
		await vi.waitFor(() => expect(isDark()).toBe(true));
		expect(document.documentElement.dataset.theme).toBeUndefined();
		browser.setDark(false);
		expect(isDark()).toBe(false);
	});

	it("sets the class the registry's theme turns dark on", async () => {
		await freshStart({ context: { theme: "dark" } });
		const [hook] = [...document.documentElement.classList];
		expect(hook).toBeDefined();
		expect(registryTheme).toContain(`:root.${hook}`);
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
		await vi.waitFor(() =>
			expect(host.toolResult()).toEqual({
				ok: true,
				data: { n: 3 },
				text: "3 campaigns",
			}),
		);
		expect(host.toolInput()).toEqual({ status: "live" });
		await bridge.sendToolResult({ content: [], structuredContent: { n: 4 } });
		await vi.waitFor(() =>
			expect(host.toolResult()).toMatchObject({ data: { n: 4 } }),
		);
	});

	it("turns an error result into the tool's own sentence", async () => {
		const { bridge, host } = await start();
		await bridge.sendToolResult({
			isError: true,
			content: [{ type: "text", text: "Reconnect Better Giving." }],
		});
		await vi.waitFor(() =>
			expect(host.toolResult()).toEqual({
				ok: false,
				error: "Reconnect Better Giving.",
			}),
		);
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

	it("rejects a follow-up the host refuses, or that no one can send", async () => {
		const refusing = await start();
		refusing.bridge.onmessage = async () => ({ isError: true });
		await expect(refusing.host.sendFollowUp("Hi")).rejects.toThrow();

		const mute = await start({ caps: {} });
		await expect(mute.host.sendFollowUp("Hi")).rejects.toThrow();
	});

	it("rejects a link the host refuses to open", async () => {
		const { bridge, host } = await start();
		bridge.onopenlink = async () => ({ isError: true });
		await expect(host.openLink("https://example.org/a")).rejects.toThrow();
	});

	it("reports the document size to the host", async () => {
		const { bridge, host } = await start();
		const sizes: unknown[] = [];
		bridge.onsizechange = (size) => sizes.push(size);
		host.reportSize();
		await vi.waitFor(() =>
			expect(sizes.at(-1)).toEqual({
				width: expect.any(Number),
				height: expect.any(Number),
			}),
		);
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
