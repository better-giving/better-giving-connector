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
const widgets = files.filter((name) => !name.startsWith("registry/"));

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

	// every widget mounts through ui/widget.tsx, which imports ui/styles.css and, through it,
	// registry-ui.css, so their declarations reach all of them; any other file's reach only itself
	it("reads only tokens the registry, the shared ui/styles.css or the same file declares", () => {
		expect(read("ui/widget.tsx")).toContain('import "./styles.css";');
		expect(read("ui/styles.css")).toContain('@import "../registry-ui.css";');
		const shared = [
			...declared("registry-ui.css"),
			...declared("ui/styles.css"),
		];
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

describe("campaign editor multi-line fields", () => {
	// the registry's field-css sets no resize; without this rule a textarea can be dragged wider than its column
	it("resize vertically only, so they cannot be dragged wider than their column", () => {
		const css = read("ui/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");
		const block = /(?:^|[}\s,])textarea\.ds-field-input\s*\{([^}]*)\}/.exec(
			css,
		);
		expect(
			block,
			"ui/styles.css has no textarea.ds-field-input rule",
		).not.toBeNull();
		expect(block?.[1]).toMatch(/(?:^|[;\s])resize:\s*vertical\s*(?:;|$)/);
	});
});

describe("fonts", () => {
	it("serves every face the registry's fonts-core names, and no other", () => {
		const urls = [
			...read("registry/styles/fonts-core.css").matchAll(
				/url\(\.\/fonts\/([^)]+)\)/g,
			),
		].map((m) => m[1] ?? "");
		expect(urls.length).toBeGreaterThan(0);
		const served = [
			...read("../pages/fonts.ts").matchAll(/"(RedHatRound[^"]+\.woff2)":/g),
		].map((m) => m[1] ?? "");
		expect(served.sort()).toEqual(urls.sort());
	});
});

// The served pages' stylesheets and the components they share, outside src/widgets.
const pageSheets = [
	"../site/site.css",
	"../connect/connect.css",
	"registry-ui.css",
];

// Registry gap, awaiting the design-system PM: these five are local to
// registry-ui.css because the registry has no token for them yet. When it ships
// one, the "not in the registry" check below goes red; delete that entry then.
const LOCAL_TO_REGISTRY_UI = [
	"--control-height",
	"--text-xs",
	"--text-sm",
	"--text-base",
	"--text-lg",
];

describe("page stylesheets use the registry's tokens", () => {
	it("keeps the local allowlist to exactly what registry-ui.css declares and the registry lacks", () => {
		expect([...new Set(declared("registry-ui.css"))].sort()).toEqual(
			[...LOCAL_TO_REGISTRY_UI].sort(),
		);
		for (const token of LOCAL_TO_REGISTRY_UI)
			expect(registryTokens.has(token), `${token} is now in the registry`).toBe(
				false,
			);
	});

	it("redeclares no registry token", () => {
		for (const name of pageSheets)
			for (const token of declared(name))
				expect(
					registryTokens.has(token),
					`${name}: ${token} redeclares a registry token`,
				).toBe(false);
	});

	it("reads only tokens the registry, the local allowlist or the same file declares", () => {
		const unknown: string[] = [];
		for (const name of pageSheets) {
			const own = new Set([...LOCAL_TO_REGISTRY_UI, ...declared(name)]);
			for (const m of read(name).matchAll(/var\((--[a-z0-9-]+)/g)) {
				const token = m[1] ?? "";
				if (!registryTokens.has(token) && !own.has(token))
					unknown.push(`${name}: ${token}`);
			}
		}
		expect(unknown).toEqual([]);
	});
});
