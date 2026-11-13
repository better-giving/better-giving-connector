import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCss, buildWidget } from "../scripts/widget-html.mjs";
import html from "./fixtures/widget/entry.tsx?widget";

const count = (haystack: string, needle: RegExp) =>
	haystack.match(needle)?.length ?? 0;

describe("?widget import", () => {
	it("is one complete HTML document", () => {
		expect(typeof html).toBe("string");
		expect(html.startsWith("<!doctype html>")).toBe(true);
		expect(html).toContain('<meta charset="utf-8">');
		expect(html).toContain('<meta name="viewport"');
		expect(html).toContain('<div id="root"></div>');
		expect(count(html, /<style>/g)).toBe(1);
		expect(count(html, /<script>/g)).toBe(1);
	});

	it("inlines the bundle's CSS and its data-URL asset", () => {
		const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
		expect(style).toContain("color:#639");
		expect(style).toContain("url(data:image/png;base64,");
	});

	it("bundles the render call into the script", () => {
		const script = html.slice(
			html.indexOf("<script>"),
			html.lastIndexOf("</script>"),
		);
		expect(script).toContain("hello widget");
		expect(script).toContain("(()=>{");
	});

	it("loads nothing from outside the document", () => {
		expect(html).not.toMatch(/<link\b/i);
		expect(html).not.toMatch(/<(script|img|iframe)\b[^>]*\bsrc=/i);
		expect(html).not.toMatch(/@import/);
		expect(html).not.toMatch(/url\((?!data:)/);
	});

	it("cannot be ended early by the bundle's own text", () => {
		expect(count(html, /<\/script/gi)).toBe(1);
		expect(count(html, /<script/gi)).toBe(1);
		expect(html).not.toContain("<!--");
		expect(html).toContain("<\\/script>\\x3C!-- \\x3Cscript>");
	});
});

// The node hook behind `pnpm dev` and `pnpm widget-shots`, run the way they
// run it: tsx with scripts/binary-register.mjs.
describe("?widget import through scripts/widget-hook.mjs", () => {
	const root = join(__dirname, "..");
	const importWidget = (specifier: string) =>
		spawnSync(
			join(root, "node_modules/.bin/tsx"),
			[
				"--import",
				"./scripts/binary-register.mjs",
				"-e",
				`const m = await import(${JSON.stringify(specifier)}); process.stdout.write(m.default)`,
			],
			{ cwd: root, encoding: "utf8" },
		);

	it("resolves a relative specifier to the same document as the vitest plugin", () => {
		const run = importWidget("./test/fixtures/widget/entry.tsx?widget");
		expect(run.stderr).toBe("");
		expect(run.status).toBe(0);
		expect(run.stdout).toBe(html);
	});

	it("resolves an absolute specifier", () => {
		const run = importWidget(
			`${join(root, "test/fixtures/widget/entry.tsx")}?widget`,
		);
		expect(run.stderr).toBe("");
		expect(run.status).toBe(0);
		expect(run.stdout).toBe(html);
	});
});

describe("?css import", () => {
	it("throws, naming the entry, when it yields no stylesheet", async () => {
		const dir = mkdtempSync(join(tmpdir(), "buildcss-"));
		const entry = join(dir, "empty.css");
		writeFileSync(entry, "");
		try {
			await expect(buildCss(entry)).rejects.toThrow(entry);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});
});

// tokens.css imports the registry's full fonts.css (every face, about 2 MB
// inlined); both builders swap in fonts-core.css, the subset a surface sets.
describe("registry fonts", () => {
	const root = join(__dirname, "..");
	const faceFiles = (css: string) =>
		[...css.matchAll(/RedHatRound[\w-]+\.woff2/g)].map((m) => m[0]).sort();
	// the family each @font-face declares; a `--font-mono` token naming a family is not a face
	const faceFamilies = (css: string) =>
		[
			...new Set(
				[...css.matchAll(/@font-face\{font-family:([^;]+);/g)].map((m) => m[1]),
			),
		].sort();
	const coreCss = readFileSync(
		join(root, "src/widgets/registry/styles/fonts-core.css"),
		"utf8",
	);
	const coreFaces = faceFiles(coreCss);
	const coreFamilies = [
		"Red Hat Round Display",
		"Red Hat Round Mono",
		"Red Hat Round Text",
	];

	it("bundles only the fonts-core faces into a widget document", async () => {
		const dir = mkdtempSync(join(tmpdir(), "widget-fonts-"));
		const entry = join(dir, "entry.ts");
		writeFileSync(
			entry,
			`import ${JSON.stringify(join(root, "src/widgets/tokens.css"))};`,
		);
		try {
			const { html } = await buildWidget(entry);
			const style = html.slice(
				html.indexOf("<style>"),
				html.indexOf("</style>"),
			);
			expect(count(style, /@font-face/g)).toBe(coreFaces.length);
			expect(faceFamilies(style)).toEqual(coreFamilies);
		} finally {
			rmSync(dir, { recursive: true });
		}
	});

	it("links only the fonts-core faces from a page stylesheet", async () => {
		const { css } = await buildCss(join(root, "src/connect/connect.css"));
		expect(coreFaces).toHaveLength(7);
		expect(faceFiles(css)).toEqual(coreFaces);
		expect(faceFamilies(css)).toEqual(coreFamilies);
	});
});
