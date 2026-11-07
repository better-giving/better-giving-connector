// `import html from "./editor/index.tsx?widget"`: the entry bundled into one
// self-contained HTML document (scripts/widget-html.mjs).
declare module "*?widget" {
	const html: string;
	export default html;
}

// `import css from "./site.css?css"`: the stylesheet bundled into one string,
// its faces linked from src/pages/fonts.ts's routes (scripts/widget-html.mjs).
declare module "*?css" {
	const css: string;
	export default css;
}
