// The HOST side of an MCP Apps conversation, played by the real ext-apps
// AppBridge: it serves a fixture's result as the render tool's result, answers
// the widget's tool calls from the fixture's script, and records what the
// widget asked for. Runs anywhere a transport reaches the widget: a linked
// pair in tests, a page relay in the screenshot browser (./browser.ts).
// Uses neither DOM nor node types: both tsconfigs check it.

import {
	AppBridge,
	type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Fixture, ToolReply } from "./fixtures";

type Transport = Parameters<AppBridge["connect"]>[0];
type CallToolResult = Parameters<AppBridge["sendToolResult"]>[0];

export type Theme = "light" | "dark";

export type FakeHostOptions = {
	fixture: Fixture;
	theme: Theme;
	locale: string;
	/** The width the widget renders at; below 640 the host reports a touch phone. */
	width: number;
	/** ChatGPT's split: theme and locale come from `window.openai`, not the bridge. */
	chatgpt?: boolean;
};

/** Everything the widget asked the host for, in order. */
export type HostLog = {
	calls: { name: string; args: Record<string, unknown> }[];
	messages: string[];
	links: string[];
	sizes: { width?: number; height?: number }[];
};

export const PHONE_BELOW = 640;

export function toCallToolResult(reply: ToolReply): CallToolResult {
	if ("error" in reply) {
		return { isError: true, content: [{ type: "text", text: reply.error }] };
	}
	return {
		content: reply.text ? [{ type: "text", text: reply.text }] : [],
		structuredContent: reply.structuredContent,
	};
}

export function hostContext(options: FakeHostOptions): McpUiHostContext {
	const phone = options.width < PHONE_BELOW;
	return {
		...(options.chatgpt
			? {}
			: { theme: options.theme, locale: options.locale }),
		displayMode: options.fixture.displayMode ?? "inline",
		availableDisplayModes: ["inline", "fullscreen"],
		platform: phone ? "mobile" : "web",
		deviceCapabilities: { touch: phone, hover: !phone },
	};
}

/** Connects a host on `transport`; the widget gets its input and result once it initializes. */
export async function startFakeHost(
	transport: Transport,
	options: FakeHostOptions,
	extra: { onSize?: (size: { width?: number; height?: number }) => void } = {},
) {
	const { fixture } = options;
	const log: HostLog = { calls: [], messages: [], links: [], sizes: [] };
	let context = hostContext(options);
	const bridge = new AppBridge(
		null,
		{ name: "better-giving-fake-host", version: "1.0.0" },
		{ openLinks: {}, serverTools: {}, message: { text: {} } },
		{ hostContext: context },
	);

	bridge.oncalltool = async ({ name, arguments: args = {} }) => {
		log.calls.push({ name, args });
		const answer = fixture.calls?.[name];
		return toCallToolResult(
			answer
				? answer(args)
				: { error: `The fake host has no scripted answer for ${name}.` },
		);
	};
	bridge.onmessage = async ({ content }) => {
		for (const block of content) {
			if (block.type === "text") log.messages.push(block.text);
		}
		return {};
	};
	bridge.onopenlink = async ({ url }) => {
		log.links.push(url);
		return {};
	};
	bridge.onrequestdisplaymode = async ({ mode }) => {
		const granted = mode === "pip" ? context.displayMode : mode;
		context = { ...context, displayMode: granted };
		bridge.setHostContext(context);
		return { mode: granted ?? "inline" };
	};
	bridge.onsizechange = (size) => {
		log.sizes.push(size);
		extra.onSize?.(size);
	};

	const served = new Promise<void>((resolve, reject) => {
		bridge.oninitialized = () => {
			bridge
				.sendToolInput({ arguments: fixture.toolInput ?? {} })
				.then(() => bridge.sendToolResult(toCallToolResult(fixture.result)))
				.then(resolve, reject);
		};
	});
	await bridge.connect(transport);
	return {
		bridge,
		log,
		/** Resolves once the widget has its tool input and result. */
		served,
		setTheme(theme: Theme) {
			context = { ...context, theme };
			bridge.setHostContext(context);
		},
	};
}
