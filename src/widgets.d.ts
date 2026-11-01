// `import html from "./editor/index.tsx?widget"`: the entry bundled into one
// self-contained HTML document (scripts/widget-html.mjs).
declare module "*?widget" {
	const html: string;
	export default html;
}
