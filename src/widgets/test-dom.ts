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
	downloadFile: {},
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

const CARD_LOOK =
	/^(background(-color)?|border(-(left|right|inline(-start|-end)?))?(-width|-style|-color)?|border(-[a-z]+)*-radius|box-shadow)$/;

/**
 * The declarations in a sheet (a path under src/widgets) that draw a card on
 * `className`: a fill, a side edge, a corner or a shadow, in every rule whose
 * selector ends on that class. The registry's card rule (card-css) gives a
 * group inside a card none of them; a hairline above or below it is a
 * separator. Read from the source: happy-dom computes no var() colour or edge.
 */
export function cardRules(sheet: string, className: string): string[] {
	const css = readFileSync(
		`${process.cwd()}/src/widgets/${sheet}`,
		"utf8",
	).replace(/\/\*[\s\S]*?\*\//g, "");
	const ends = new RegExp(`\\.${className}(?![\\w-])[^\\s>+~]*$`);
	const found: string[] = [];
	for (const [, selectors = "", body = ""] of css.matchAll(
		/([^{}]+)\{([^{}]*)\}/g,
	)) {
		const selector = selectors.trim();
		if (!selector.split(",").some((s) => ends.test(s.trim()))) continue;
		for (const decl of body.split(";")) {
			const property = decl.split(":")[0]?.trim() ?? "";
			if (CARD_LOOK.test(property))
				found.push(`${selector} { ${decl.trim()} }`);
		}
	}
	return found;
}

/** Every `ds-card` inside another, as its class list: the registry draws no card inside a card. */
export const nestedCards = (root: Element) =>
	[...root.querySelectorAll(".ds-card .ds-card")].map((el) => el.className);
