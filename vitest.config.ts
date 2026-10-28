import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

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

export default defineConfig({
	plugins: [binaryBytes()],
	test: {
		include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
	},
});
