import { describe, expect, it } from "vitest";

// tsconfig.widgets.json typechecks src/widgets with DOM types and no node
// types, so `import "node:fs"` does not resolve there; the suite runs on node.
const { readFileSync, readdirSync } = (
	globalThis as unknown as {
		process: {
			getBuiltinModule(id: "node:fs"): {
				readFileSync(path: URL, encoding: "utf8"): string;
				readdirSync(path: URL, options: { recursive: true }): string[];
			};
		};
	}
).process.getBuiltinModule("node:fs");

const root = new URL("./", import.meta.url);
const files = readdirSync(root, { recursive: true }).filter(
	(name) =>
		/\.(css|ts|tsx)$/.test(name) &&
		!/\.(test\.tsx?|d\.ts)$/.test(name) &&
		name !== "test-dom.ts",
);
const read = (name: string) => readFileSync(new URL(name, root), "utf8");
const registry = files.filter((name) => name.startsWith("registry/"));
const widgets = files.filter(
	(name) => !name.startsWith("registry/") && name !== "fonts.css",
);

const declared = (name: string) =>
	[...read(name).matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? "");

const registryTokens = new Set(registry.flatMap(declared));
// "--accent-9" -> "accent", "--panel" -> "panel": the word a token's name starts with
const rootWord = (token: string) =>
	(token.split("-")[2] ?? "").replace(/\d+$/, "");
const registryWords = new Set([...registryTokens].map(rootWord));
const scaleStep = /^--[a-z]+-a?\d+$/;

describe("widget tokens are the registry's", () => {
	it("imports the registry's variables and declares no scale or role of its own", () => {
		expect(read("tokens.css")).toContain(
			'@import "./registry/styles/variables.css";',
		);
		for (const name of widgets) {
			for (const token of declared(name)) {
				expect(
					registryTokens.has(token),
					`${name}: ${token} redeclares a registry token`,
				).toBe(false);
				expect(
					scaleStep.test(token),
					`${name}: ${token} is a colour scale step`,
				).toBe(false);
				expect(
					registryWords.has(rootWord(token)),
					`${name}: ${token} is a variant of a registry scale or role`,
				).toBe(false);
			}
		}
	});

	// every widget mounts through ui/widget.tsx, which imports ui/styles.css, so its
	// declarations reach all of them; any other file's declarations reach only itself
	it("reads only tokens the registry, the shared ui/styles.css or the same file declares", () => {
		expect(read("ui/widget.tsx")).toContain('import "./styles.css";');
		const shared = declared("ui/styles.css");
		const unknown: string[] = [];
		for (const name of widgets) {
			const own = new Set([...shared, ...declared(name)]);
			for (const m of read(name).matchAll(/var\((--[a-z0-9-]+)/g)) {
				const token = m[1] ?? "";
				if (!registryTokens.has(token) && !own.has(token))
					unknown.push(`${name}: ${token}`);
			}
		}
		expect(unknown).toEqual([]);
	});

	it("names no face of its own, outside the donor-page preview", () => {
		const own: string[] = [];
		for (const name of widgets) {
			if (name.startsWith("campaign-editor/")) continue;
			for (const m of read(name).matchAll(/font-family:\s*([^;]+);/g))
				if (!/^var\(--font-(body|display|mono)\)$/.test((m[1] ?? "").trim()))
					own.push(`${name}: ${m[1]}`);
		}
		expect(own).toEqual([]);
	});
});

describe("fonts", () => {
	it("cuts the registry's faces to files the registry ships", () => {
		const cut = read("fonts.css");
		const urls = [...cut.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] ?? "");
		expect(urls.length).toBeGreaterThan(0);
		const registryFonts = read("registry/styles/fonts.css");
		for (const url of urls)
			expect(registryFonts).toContain(
				`url(./${url.replace("./registry/styles/", "")})`,
			);
	});
});
