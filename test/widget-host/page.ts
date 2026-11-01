// The page a fake host shows: a chat column with the widget's HTML in an
// iframe, and a relay that carries postMessage traffic between the iframe and
// the AppBridge running outside the page (./browser.ts). Pure string building.

import type { Theme } from "./fake-host";

/** ChatGPT's `window.openai` as the page seeds it; its methods call back into ./browser.ts. */
export type OpenAiSeed = {
	theme: Theme;
	locale: string;
	displayMode: "inline" | "fullscreen";
	toolInput: Record<string, unknown>;
	toolOutput: unknown;
	widgetState: unknown;
};

/** The globals the page and the widget frame expose to ./browser.ts. */
export const RELAY = {
	/** page → node: a message the widget posted to its parent */
	toHost: "__widgetToHost",
	/** node → page: post a message into the widget frame */
	toWidget: "__hostToWidget",
	/** node → page: the widget's reported height */
	resize: "__resizeWidget",
	/** frame → node: a `window.openai` method call */
	openai: "__openaiCall",
} as const;

/** A chat thread's column on a desktop; a phone uses its whole width. */
const COLUMN = 768;

const BACKDROP: Record<Theme, { bg: string; fg: string }> = {
	light: { bg: "#ffffff", fg: "#0d0d0d" },
	dark: { bg: "#212121", fg: "#ececec" },
};

const escapeAttribute = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

/** JSON that can sit inside an inline <script>. */
const scriptJson = (value: unknown) =>
	JSON.stringify(value).replaceAll("<", "\\u003c");

function openAiScript(seed: OpenAiSeed): string {
	const call = `(name, arg) => parent.${RELAY.openai}(name, arg)`;
	return `<script>(() => {
const call = ${call};
const openai = Object.assign(${scriptJson(seed)}, {
	setWidgetState: (state) => { openai.widgetState = state; return call("setWidgetState", state); },
	requestDisplayMode: async ({ mode }) => { openai.displayMode = mode; await call("requestDisplayMode", mode); return { mode }; },
	sendFollowUpMessage: ({ prompt }) => call("sendFollowUpMessage", prompt),
	openExternal: ({ href }) => call("openExternal", href),
});
window.openai = openai;
})();</script>`;
}

/** The widget document, with `window.openai` defined before its own script runs when `openai` is given. */
export function widgetDocument(html: string, openai?: OpenAiSeed): string {
	if (!openai) return html;
	const head = html.indexOf("</head>");
	if (head < 0) throw new Error("widget HTML has no </head>");
	return html.slice(0, head) + openAiScript(openai) + html.slice(head);
}

export function hostPage(options: {
	html: string;
	theme: Theme;
	fullscreen: boolean;
	openai?: OpenAiSeed;
}): string {
	const { bg, fg } = BACKDROP[options.theme];
	const column = options.fullscreen
		? "width:100%;height:100vh;"
		: `width:100%;max-width:${COLUMN}px;margin:0 auto;padding:24px 16px;`;
	const frameHeight = options.fullscreen ? "100%" : "120px";
	return `<!doctype html>
<html lang="en" style="color-scheme:${options.theme}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}
body{margin:0;background:${bg};color:${fg};font:16px/1.5 system-ui,sans-serif}
main{${column}}
iframe{display:block;width:100%;height:${frameHeight};border:0}
</style>
<script>
const frame = () => document.getElementById("widget");
addEventListener("message", (event) => {
	if (event.source === frame().contentWindow) window.${RELAY.toHost}(event.data);
});
window.${RELAY.toWidget} = (message) => frame().contentWindow.postMessage(message, "*");
window.${RELAY.resize} = (height) => { ${options.fullscreen ? "" : 'frame().style.height = `${Math.ceil(height)}px`;'} };
</script></head>
<body><main><iframe id="widget" title="Widget" srcdoc="${escapeAttribute(widgetDocument(options.html, options.openai))}"></iframe></main></body></html>`;
}
