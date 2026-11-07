import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Plain .mjs: the node loader hook (tsx's thread) imports this file directly.
// esbuild, vite and node all route `import html from "./x.tsx?widget"` here.

const PRAGMA = /@jsxImportSource\s+(\S+)/;
const DEFAULT_JSX_SOURCE = "hono/jsx/dom";

// Inside an inline <script> or <style>, `</script`, `<script` and `<!--` can
// end or confuse the raw-text element. `\x3C` and `\3C ` spell `<` inside the
// string, regex and template literals those sequences can legitimately sit in.
const escapeForScript = (js) =>
	js.replace(/<(\/script|script|!--)/gi, "\\x3C$1");
const escapeForStyle = (css) => css.replace(/<(\/style)/gi, "\\3C $1");

// The registry's fonts.css names every face it ships (about 2 MB once inlined);
// widgets get src/widgets/fonts.css, the faces they set, in its place.
const FONT_SUBSET = fileURLToPath(
	new URL("../src/widgets/fonts.css", import.meta.url),
);
const registryFontsPlugin = {
	name: "registry-fonts-subset",
	setup(b) {
		b.onResolve({ filter: /(^|\/)fonts\.css$/ }, (args) =>
			args.resolveDir.endsWith("registry/styles")
				? { path: FONT_SUBSET }
				: undefined,
		);
	},
};

/** Bundle a widget entry. `html` is the document; `inputs` are the files it was built from. */
export async function buildWidget(entry) {
	const file = resolve(entry);
	const jsxImportSource =
		PRAGMA.exec(readFileSync(file, "utf8"))?.[1] ?? DEFAULT_JSX_SOURCE;
	const result = await build({
		entryPoints: [file],
		bundle: true,
		write: false,
		outdir: "widget-out",
		metafile: true,
		format: "iife",
		platform: "browser",
		target: "es2022",
		minify: true,
		legalComments: "none",
		jsx: "automatic",
		jsxImportSource,
		loader: { ".woff2": "dataurl", ".png": "dataurl" },
		plugins: [registryFontsPlugin],
		logLevel: "silent",
	});
	let js = "";
	let css = "";
	for (const out of result.outputFiles) {
		if (out.path.endsWith(".js")) js = out.text;
		else if (out.path.endsWith(".css")) css = out.text;
	}
	const html = [
		"<!doctype html>",
		'<html lang="en">',
		"<head>",
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1">',
		`<style>${escapeForStyle(css)}</style>`,
		"</head>",
		"<body>",
		'<div id="root"></div>',
		`<script>${escapeForScript(js)}</script>`,
		"</body>",
		"</html>",
		"",
	].join("\n");
	const inputs = Object.keys(result.metafile.inputs)
		.filter((input) => !input.startsWith("node_modules"))
		.map((input) => resolve(input));
	return { html, inputs };
}

/** The complete HTML document for a widget entry. */
export async function widgetHtml(entry) {
	return (await buildWidget(entry)).html;
}

export const WIDGET_QUERY = "?widget";

/** `./editor/index.tsx?widget` imported from `importerDir` → the entry's absolute path. */
export function widgetEntry(specifier, importerDir) {
	return resolve(importerDir, specifier.slice(0, -WIDGET_QUERY.length));
}

export function moduleSource(html) {
	return `export default ${JSON.stringify(html)};\n`;
}
