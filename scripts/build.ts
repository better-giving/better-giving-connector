import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	packages: "external",
	outfile: "dist/index.js",
	loader: { ".mp4": "binary", ".png": "binary", ".woff2": "binary" },
});
