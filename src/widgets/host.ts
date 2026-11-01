// The one place a widget meets its host. The MCP Apps `App` bridge is the
// source of every fact; ChatGPT's `window.openai` fills only what the bridge
// leaves out (widget state, fullscreen, file uploads, and any context field
// the bridge's host context lacks), so one bundle runs in Claude and ChatGPT.

import {
	App,
	applyHostStyleVariables,
	type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { DEFAULT_LOCALE } from "../format";

type Transport = NonNullable<Parameters<App["connect"]>[0]>;
type CallToolResult = Awaited<ReturnType<App["callServerTool"]>>;

export type Theme = "light" | "dark";
export type DisplayMode = "inline" | "fullscreen" | "pip";

/** The subset of ChatGPT's `window.openai` this adapter reads. */
export interface OpenAiGlobals {
	theme?: Theme;
	locale?: string;
	displayMode?: DisplayMode;
	toolInput?: Record<string, unknown> | null;
	toolOutput?: unknown;
	widgetState?: unknown;
	setWidgetState?: (state: unknown) => unknown;
	requestDisplayMode?: (args: {
		mode: DisplayMode;
	}) => Promise<{ mode?: DisplayMode } | undefined>;
	openExternal?: (args: { href: string }) => unknown;
	sendFollowUpMessage?: (args: { prompt: string }) => Promise<unknown>;
	uploadFile?: (file: File) => Promise<{ fileId: string }>;
	getFileDownloadUrl?: (args: {
		fileId: string;
	}) => Promise<{ downloadUrl: string }>;
}

/** A tool's answer as a widget renders it: its structured data, or the sentence it failed with. */
export type ToolOutcome =
	| { ok: true; data: unknown; text: string }
	| { ok: false; error: string };

export interface HostContext {
	theme: Theme | undefined;
	locale: string;
	displayMode: DisplayMode;
	/** The host reports a touch device (or a mobile platform): controls grow to 44px. */
	touch: boolean;
}

export interface Host {
	/** The arguments of the tool call that opened this widget, once the host sends them. */
	toolInput(): Record<string, unknown> | undefined;
	/** The render tool's result, `undefined` until it arrives. */
	toolResult(): ToolOutcome | undefined;
	context(): HostContext;
	/** Called on every new tool input or result and every context change; returns the unsubscribe. */
	subscribe(listener: () => void): () => void;
	callTool(name: string, args?: Record<string, unknown>): Promise<ToolOutcome>;
	/** Posts `prompt` as the user's next chat message. */
	sendFollowUp(prompt: string): Promise<void>;
	/** Asks for fullscreen; resolves with the mode the host actually set. */
	requestFullscreen(): Promise<DisplayMode>;
	/** Tells the host the document's size now (the bridge also does this on every resize). */
	reportSize(): void;
	openLink(url: string): Promise<void>;
	getState<T>(): T | undefined;
	setState(state: unknown): void;
	/** The host takes a file from the widget (ChatGPT's file APIs). */
	readonly canUploadFiles: boolean;
	/** Uploads `file` to the host; resolves with a URL the server can fetch it from. */
	uploadFile(file: File): Promise<{ fileId: string; downloadUrl: string }>;
}

// Shown when a call never reached a tool, so there is no tool sentence to show.
export const UNREACHABLE =
	"Couldn't reach Better Giving just now. Try again in a moment.";

export function outcomeOf(result: CallToolResult): ToolOutcome {
	const text = result.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n");
	if (result.isError) return { ok: false, error: text || UNREACHABLE };
	return { ok: true, data: result.structuredContent, text };
}

function canonicalLocale(tag: unknown): string | undefined {
	if (typeof tag !== "string") return undefined;
	try {
		return Intl.getCanonicalLocales(tag)[0];
	} catch {
		return undefined;
	}
}

function currentOpenAi(): OpenAiGlobals | undefined {
	const openai = (globalThis as { openai?: OpenAiGlobals }).openai;
	return typeof openai === "object" && openai !== null ? openai : undefined;
}

export async function connectHost(
	options: {
		/** Defaults to postMessage with the parent frame. */
		transport?: Transport;
		/** Defaults to `window.openai` when the page has one. */
		openai?: OpenAiGlobals;
	} = {},
): Promise<Host> {
	const openai = options.openai ?? currentOpenAi();
	const app = new App({ name: "better-giving-widget", version: "1.0.0" });
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};

	let input: Record<string, unknown> | undefined =
		openai?.toolInput ?? undefined;
	let result: ToolOutcome | undefined =
		openai?.toolOutput == null
			? undefined
			: { ok: true, data: openai.toolOutput, text: "" };
	let memoryState: unknown;

	const bridgeContext = (): McpUiHostContext => app.getHostContext() ?? {};
	const context = (): HostContext => {
		const ctx = bridgeContext();
		return {
			theme: ctx.theme ?? openai?.theme,
			locale:
				canonicalLocale(ctx.locale) ??
				canonicalLocale(openai?.locale) ??
				DEFAULT_LOCALE,
			displayMode: ctx.displayMode ?? openai?.displayMode ?? "inline",
			touch:
				ctx.deviceCapabilities?.touch === true || ctx.platform === "mobile",
		};
	};
	const applyContext = () => {
		const { theme } = context();
		if (theme) document.documentElement.dataset.theme = theme;
		const variables = bridgeContext().styles?.variables;
		if (variables) applyHostStyleVariables(variables);
	};

	app.addEventListener("toolinput", (params) => {
		input = params.arguments;
		notify();
	});
	app.addEventListener("toolresult", (params) => {
		result = outcomeOf(params);
		notify();
	});
	app.addEventListener("hostcontextchanged", () => {
		applyContext();
		notify();
	});
	if (openai) {
		globalThis.addEventListener?.("openai:set_globals", () => {
			if (result === undefined && openai.toolOutput != null) {
				result = { ok: true, data: openai.toolOutput, text: "" };
			}
			applyContext();
			notify();
		});
	}

	await app.connect(options.transport);
	applyContext();

	return {
		toolInput: () => input,
		toolResult: () => result,
		context,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		async callTool(name, args = {}) {
			try {
				return outcomeOf(await app.callServerTool({ name, arguments: args }));
			} catch {
				return { ok: false, error: UNREACHABLE };
			}
		},
		async sendFollowUp(prompt) {
			if (app.getHostCapabilities()?.message) {
				await app.sendMessage({
					role: "user",
					content: [{ type: "text", text: prompt }],
				});
			} else if (openai?.sendFollowUpMessage) {
				await openai.sendFollowUpMessage({ prompt });
			}
		},
		async requestFullscreen() {
			const ctx = bridgeContext();
			if (ctx.availableDisplayModes?.includes("fullscreen")) {
				return (await app.requestDisplayMode({ mode: "fullscreen" })).mode;
			}
			if (openai?.requestDisplayMode) {
				const set = await openai.requestDisplayMode({ mode: "fullscreen" });
				return set?.mode ?? "fullscreen";
			}
			return context().displayMode;
		},
		reportSize() {
			const root = document.documentElement;
			void app.sendSizeChanged({
				width: Math.ceil(root.getBoundingClientRect().width),
				height: Math.ceil(root.scrollHeight),
			});
		},
		async openLink(url) {
			if (app.getHostCapabilities()?.openLinks) {
				await app.openLink({ url });
			} else if (openai?.openExternal) {
				openai.openExternal({ href: url });
			} else {
				globalThis.open?.(url, "_blank", "noopener");
			}
		},
		getState<T>() {
			return (openai?.setWidgetState ? openai.widgetState : memoryState) as
				| T
				| undefined;
		},
		setState(state) {
			if (openai?.setWidgetState) {
				void openai.setWidgetState(state);
			} else {
				memoryState = state;
			}
		},
		canUploadFiles:
			typeof openai?.uploadFile === "function" &&
			typeof openai.getFileDownloadUrl === "function",
		async uploadFile(file) {
			if (!openai?.uploadFile || !openai.getFileDownloadUrl) {
				throw new Error("this host takes no file uploads");
			}
			const { fileId } = await openai.uploadFile(file);
			const { downloadUrl } = await openai.getFileDownloadUrl({ fileId });
			return { fileId, downloadUrl };
		},
	};
}
