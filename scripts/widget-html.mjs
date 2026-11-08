import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
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
// its `fonts-core` item is the subset a widget or page sets. The `variables`
// item imports fonts.css, so this swaps in fonts-core.css for that import.
const FONTS_CORE = fileURLToPath(
	new URL("../src/widgets/registry/styles/fonts-core.css", import.meta.url),
);
const registryFontsPlugin = {
	name: "registry-fonts-core",
	setup(b) {
		b.onResolve({ filter: /(^|\/)fonts\.css$/ }, (args) =>
			args.resolveDir.endsWith("registry/styles")
				? { path: FONTS_CORE }
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

export const CSS_QUERY = "?css";

/** Where src/pages/fonts.ts serves the faces a page's stylesheet names. */
export const PAGE_FONT_DIR = "/assets/fonts";

// A served page links its faces instead of inlining them: each url() becomes a
// route on this service and the file stays out of the stylesheet.
const servedFontsPlugin = {
	name: "served-fonts",
	setup(b) {
		b.onResolve({ filter: /\.woff2$/ }, (args) => ({
			path: `${PAGE_FONT_DIR}/${basename(args.path)}`,
			external: true,
		}));
	},
};

/** Bundle a page's stylesheet: the registry's tokens, minified, faces by route. */
export async function buildCss(entry) {
	const result = await build({
		entryPoints: [resolve(entry)],
		bundle: true,
		write: false,
		outdir: "css-out",
		metafile: true,
		minify: true,
		legalComments: "none",
		plugins: [registryFontsPlugin, servedFontsPlugin],
		logLevel: "silent",
	});
	const css = result.outputFiles.find((out) => out.path.endsWith(".css"));
	const inputs = Object.keys(result.metafile.inputs)
		.filter((input) => !input.startsWith("node_modules"))
		.map((input) => resolve(input));
	if (!css?.text) throw new Error(`${entry} produced no stylesheet`);
	return { css: css.text, inputs };
}

/** `./x.css?css` imported from `importerDir` → the stylesheet's absolute path. */
export function cssEntry(specifier, importerDir) {
	return resolve(importerDir, specifier.slice(0, -CSS_QUERY.length));
}
