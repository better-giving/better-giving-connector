import { build, type Plugin } from "esbuild";
import {
	buildCss,
	buildWidget,
	cssEntry,
	moduleSource,
	widgetEntry,
} from "./widget-html.mjs";

/** `./x.tsx?widget` is the widget's HTML document, inlined as a string module. */
const widgetHtmlPlugin: Plugin = {
	name: "widget-html",
	setup(b) {
		b.onResolve({ filter: /\?widget$/ }, (args) => ({
			path: widgetEntry(args.path, args.resolveDir),
			namespace: "widget",
		}));
		b.onLoad({ filter: /.*/, namespace: "widget" }, async (args) => {
			const { html, inputs } = await buildWidget(args.path);
			return {
				contents: moduleSource(html),
				loader: "js",
				watchFiles: inputs,
			};
		});
	},
};

/** `./x.css?css` is the page's stylesheet, inlined as a string module. */
const pageCssPlugin: Plugin = {
	name: "page-css",
	setup(b) {
		b.onResolve({ filter: /\?css$/ }, (args) => ({
			path: cssEntry(args.path, args.resolveDir),
			namespace: "page-css",
		}));
		b.onLoad({ filter: /.*/, namespace: "page-css" }, async (args) => {
			const { css, inputs } = await buildCss(args.path);
			return { contents: moduleSource(css), loader: "js", watchFiles: inputs };
		});
	},
};

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	packages: "external",
	outfile: "dist/index.js",
	loader: { ".mp4": "binary", ".png": "binary", ".woff2": "binary" },
	plugins: [widgetHtmlPlugin, pageCssPlugin],
});
