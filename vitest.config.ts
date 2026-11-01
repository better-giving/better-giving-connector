import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import {
	buildWidget,
	moduleSource,
	WIDGET_QUERY,
	widgetEntry,
} from "./scripts/widget-html.mjs";

const BINARY = /\.(mp4|png|woff2)$/;

/** A video, image or font import is the file bytes, matching esbuild's binary loader. */
function binaryBytes(): Plugin {
	return {
		name: "binary-bytes",
		enforce: "pre",
		load(id) {
			const path = id.split("?")[0] ?? id;
			if (!BINARY.test(path)) return null;
			const encoded = readFileSync(path).toString("base64");
			return [
				`const bin = atob(${JSON.stringify(encoded)});`,
				"const out = new Uint8Array(bin.length);",
				"for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);",
				"export default out;",
			].join("\n");
		},
	};
}

const WIDGET_PREFIX = "\0widget:";

/** `./x.tsx?widget` is the widget's HTML document, matching the esbuild plugin. */
function widgetHtml(): Plugin {
	return {
		name: "widget-html",
		enforce: "pre",
		resolveId(source, importer) {
			if (!source.endsWith(WIDGET_QUERY)) return null;
			const from = importer
				? dirname(importer.split("?")[0] ?? importer)
				: process.cwd();
			return WIDGET_PREFIX + widgetEntry(source, from);
		},
		async load(id) {
			if (!id.startsWith(WIDGET_PREFIX)) return null;
			const { html, inputs } = await buildWidget(
				id.slice(WIDGET_PREFIX.length),
			);
			for (const input of inputs) this.addWatchFile(input);
			return moduleSource(html);
		},
	};
}

export default defineConfig({
	plugins: [binaryBytes(), widgetHtml()],
	test: {
		include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
	},
});
