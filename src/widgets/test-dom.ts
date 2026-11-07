// Test support for widgets under happy-dom: render a component, or connect a
// widget to a real ext-apps AppBridge playing the host.
import type { App } from "@modelcontextprotocol/ext-apps";
import {
	AppBridge,
	type McpUiHostCapabilities,
	type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Child } from "hono/jsx";
import { render } from "hono/jsx/dom";
import { connectHost, type OpenAiGlobals } from "./host";

type Transport = NonNullable<Parameters<App["connect"]>[0]>;
type Message = Parameters<Transport["send"]>[0];

/** Renders `node` into a fresh element on the page; the next mount replaces it. */
export function mount(node: Child): HTMLElement {
	document.body.replaceChildren();
	const root = document.createElement("div");
	document.body.append(root);
	render(node, root);
	return root;
}

/** Lets a hono/jsx/dom state update, or a queued bridge message, land. */
export const flush = (ms = 0) =>
	new Promise((resolve) => setTimeout(resolve, ms));

/** Two transports wired to each other, delivering each message on a later task as postMessage does. */
export function linkedPair(): [Transport, Transport] {
	const make = (): Transport & { peer?: Transport } => ({
		async start() {},
		async close() {
			this.onclose?.();
		},
		async send(message: Message) {
			const peer = this.peer;
			setTimeout(() => peer?.onmessage?.(structuredClone(message)), 0);
		},
	});
	const a = make();
	const b = make();
	a.peer = b;
	b.peer = a;
	return [a, b];
}

export const ALL_CAPS: McpUiHostCapabilities = {
	openLinks: {},
	serverTools: {},
	message: { text: {} },
};

/** A real AppBridge host and the widget-side `Host` connected to it. */
export async function startHost(
	opts: {
		context?: McpUiHostContext;
		caps?: McpUiHostCapabilities;
		openai?: Partial<OpenAiGlobals>;
	} = {},
) {
	const [viewSide, hostSide] = linkedPair();
	const bridge = new AppBridge(
		null,
		{ name: "test-host", version: "1.0.0" },
		opts.caps ?? ALL_CAPS,
		{ hostContext: opts.context ?? {} },
	);
	await bridge.connect(hostSide);
	const host = await connectHost({
		transport: viewSide,
		openai: opts.openai as OpenAiGlobals | undefined,
	});
	return { bridge, host };
}

// tsconfig.widgets.json gives src/widgets no node types; the suite runs on node,
// from the repo root.
const { process } = globalThis as unknown as {
	process: {
		cwd(): string;
		getBuiltinModule(id: "node:fs"): {
			readFileSync(path: string, encoding: "utf8"): string;
		};
	};
};
const { readFileSync } = process.getBuiltinModule("node:fs");

const inlined = (path: string): string =>
	readFileSync(path, "utf8").replace(/@import "([^"]+)";/g, (_, rel: string) =>
		inlined(`${path.slice(0, path.lastIndexOf("/"))}/${rel}`),
	);

/** Puts sheets (paths under src/widgets) on the page in order, imports inlined as the ?widget bundle does. */
export function applyStyles(...sheets: string[]) {
	const style = document.createElement("style");
	style.textContent = sheets
		.map((sheet) => inlined(`${process.cwd()}/src/widgets/${sheet}`))
		.join("\n");
	document.head.replaceChildren(style);
}
