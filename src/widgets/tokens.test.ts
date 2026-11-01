import { describe, expect, it } from "vitest";

// tsconfig.widgets.json typechecks src/widgets with DOM types and no node
// types, so `import "node:fs"` does not resolve there; the suite runs on node.
const { readFileSync } = (
	globalThis as unknown as {
		process: {
			getBuiltinModule(id: "node:fs"): {
				readFileSync(path: URL, encoding: "utf8"): string;
			};
		};
	}
).process.getBuiltinModule("node:fs");

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

const declarations = new Map(
	[...css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]*);/g)].map((m) => [
		m[1] ?? "",
		(m[2] ?? "").trim(),
	]),
);

/** The two arguments of `light-dark(a, b)`, splitting on the comma outside parens and comments. */
function lightDarkHalves(value: string): [string, string] | undefined {
	const inner = /^light-dark\(([\s\S]*)\)$/.exec(value)?.[1];
	if (inner === undefined) return undefined;
	let depth = 0;
	let inComment = false;
	for (let i = 0; i < inner.length; i++) {
		const pair = inner.slice(i, i + 2);
		if (inComment) {
			if (pair === "*/") inComment = false;
			continue;
		}
		if (pair === "/*") inComment = true;
		else if (inner[i] === "(") depth++;
		else if (inner[i] === ")") depth--;
		else if (inner[i] === "," && depth === 0) {
			return [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
		}
	}
	return undefined;
}

/** The half a token takes in `theme`: its own light-dark() argument, or the one of the token it aliases. */
function half(name: string, theme: Theme): string {
	const value = declarations.get(name);
	if (value === undefined) throw new Error(`${name} is not declared`);
	const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value)?.[1];
	if (alias) return half(alias, theme);
	const halves = lightDarkHalves(value);
	if (!halves) throw new Error(`${name} is not a light-dark() pair`);
	return theme === "light" ? halves[0] : halves[1];
}

/** The hex a half carries in its trailing comment: the source value the oklch() is authored from. */
function hex(name: string, theme: Theme): string {
	const found = /\/\*\s*(#[0-9a-f]{6})\b/.exec(half(name, theme))?.[1];
	if (!found) throw new Error(`${name} (${theme}) has no source hex comment`);
	return found;
}

function oklchToRgb255(l: number, c: number, h: number): number[] {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
	];
	return linear.map((v) => {
		const encoded =
			v <= 0.0031308 ? 12.92 * v : 1.055 * Math.abs(v) ** (1 / 2.4) - 0.055;
		return Math.min(255, Math.max(0, encoded * 255));
	});
}

function hexToRgb255(value: string): number[] {
	const n = Number.parseInt(value.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(value: string): number {
	const [r = 0, g = 0, b = 0] = hexToRgb255(value).map((channel) => {
		const c = channel / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two sRGB hexes. */
function contrast(a: string, b: string): number {
	const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
		(x, y) => y - x,
	);
	return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// Better Giving Platform packages/brand/src/colors.css, light only.
const PLATFORM_LIGHT: Record<string, string> = {
	"--blue-1": "#fafdff",
	"--blue-2": "#f3f9ff",
	"--blue-3": "#e4f4ff",
	"--blue-4": "#d5edff",
	"--blue-5": "#c4e3ff",
	"--blue-6": "#b0d6fb",
	"--blue-7": "#95c5f2",
	"--blue-8": "#6daee9",
	"--blue-9": "#1e6dab",
	"--blue-10": "#055f9c",
	"--blue-11": "#206fad",
	"--blue-12": "#1c3d5b",
	"--red-1": "#fffcfc",
	"--red-2": "#fff7f6",
	"--red-3": "#ffebe9",
	"--red-4": "#ffdbd6",
	"--red-5": "#ffcdc7",
	"--red-6": "#ffbdb6",
	"--red-7": "#f7a9a1",
	"--red-8": "#ee8d85",
	"--red-9": "#cc1926",
	"--red-10": "#bb0016",
	"--red-11": "#d2222b",
	"--red-12": "#661516",
	"--green-1": "#fbfefc",
	"--green-2": "#f4fbf7",
	"--green-3": "#e6f6ee",
	"--green-4": "#d7f0e3",
	"--green-5": "#c5e8d6",
	"--green-6": "#b0ddc6",
	"--green-7": "#92cdb0",
	"--green-8": "#66b893",
	"--green-9": "#0e8c62",
	"--green-10": "#007e55",
	"--green-11": "#008057",
	"--green-12": "#203a2e",
	"--amber-1": "#fefdfb",
	"--amber-2": "#fff8e7",
	"--amber-3": "#ffefcd",
	"--amber-4": "#ffe5b7",
	"--amber-5": "#ffd99e",
	"--amber-6": "#ffc977",
	"--amber-7": "#ffb453",
	"--amber-8": "#f19a00",
	"--amber-9": "#f59e0b",
	"--amber-10": "#e99300",
	"--amber-11": "#ac6500",
	"--amber-12": "#4f3515",
	"--gray-1": "#fbfcfe",
	"--gray-2": "#f6f9fd",
	"--gray-3": "#ecf1f7",
	"--gray-4": "#e3e9f1",
	"--gray-5": "#dbe2ec",
	"--gray-6": "#d2dbe7",
	"--gray-7": "#c7d0db",
	"--gray-8": "#b4bdc8",
	"--gray-9": "#868f9a",
	"--gray-10": "#7c848f",
	"--gray-11": "#5d656f",
	"--gray-12": "#1a2029",
};

// Platform's semantic map: each token is a ramp step in both themes, or white.
const SEMANTIC: Record<string, string> = {
	"--background": "--gray-1",
	"--panel": "--gray-2",
	"--surface": "--gray-1",
	"--border": "--gray-6",
	"--primary": "--blue-9",
	"--primary-hover": "--blue-10",
	"--primary-fg": "#ffffff",
	"--band": "--blue-2",
	"--secondary": "--blue-3",
	"--secondary-active": "--blue-5",
	"--destructive": "--red-9",
	"--destructive-hover": "--red-10",
	"--destructive-fg": "#ffffff",
	"--destructive-subtle": "--red-3",
	"--destructive-subtle-fg": "--red-11",
	"--destructive-subtle-active": "--red-5",
	"--success": "--green-9",
	"--success-hover": "--green-10",
	"--success-fg": "#ffffff",
	"--success-subtle": "--green-3",
	"--success-subtle-fg": "--green-11",
	"--warning": "--amber-9",
	"--warning-hover": "--amber-10",
	"--warning-fg": "--amber-12",
	"--warning-subtle": "--amber-3",
	"--warning-subtle-fg": "--amber-11",
	"--ring": "--blue-8",
};

// Inks whose fill is the same hex in both themes keep their light step in dark.
const INK_FOLLOWS_FILL: Record<string, string> = {
	"--warning-fg": "--warning",
};

// The values DESIGN.md names.
const DESIGN_MD: Record<string, string> = {
	"--primary": "#1e6dab",
	"--primary-hover": "#055f9c",
	"--secondary": "#e4f4ff",
	"--band": "#f3f9ff",
	"--ring": "#6daee9",
	"--destructive": "#cc1926",
	"--destructive-subtle": "#ffebe9",
	"--success": "#0e8c62",
	"--success-subtle": "#e6f6ee",
	"--warning-subtle": "#ffefcd",
	"--warning-fg": "#4f3515",
	"--gray-12": "#1a2029",
	"--gray-11": "#5d656f",
	"--gray-6": "#d2dbe7",
	"--gray-7": "#c7d0db",
};

const NON_COLOR = new Set(["--preview-radius", "--preview-font"]);
const COLOR_TOKENS = [...declarations.keys()].filter((n) => !NON_COLOR.has(n));

describe("light half is Platform's palette", () => {
	it.each(Object.entries(PLATFORM_LIGHT))("%s is %s", (name, want) => {
		expect(hex(name, "light")).toBe(want);
	});

	it.each(Object.entries(DESIGN_MD))("%s is DESIGN.md's %s", (name, want) => {
		expect(hex(name, "light")).toBe(want);
	});

	it("declares exactly Platform's ramps, the semantic map and the preview tokens", () => {
		expect(new Set(declarations.keys())).toEqual(
			new Set([
				...Object.keys(PLATFORM_LIGHT),
				...Object.keys(SEMANTIC),
				...NON_COLOR,
			]),
		);
	});
});

describe("semantic map", () => {
	it.each(
		THEMES.flatMap((theme) =>
			Object.entries(SEMANTIC).map(([name, source]) => [theme, name, source]),
		),
	)("%s %s is %s", (theme, name, source) => {
		const want = source.startsWith("#")
			? source
			: hex(
					source,
					theme === "dark" && name in INK_FOLLOWS_FILL
						? "light"
						: (theme as Theme),
				);
		expect(hex(name, theme as Theme)).toBe(want);
	});
});

describe("an ink that follows its fill", () => {
	it.each(Object.entries(INK_FOLLOWS_FILL))(
		"%s: its fill %s is the same hex in both themes",
		(_ink, fill) => {
			expect(hex(fill, "dark")).toBe(hex(fill, "light"));
		},
	);
});

describe("every colour token has both halves", () => {
	it.each(COLOR_TOKENS)("%s", (name) => {
		for (const theme of THEMES) {
			expect(hex(name, theme)).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it.each(THEMES.flatMap((theme) => COLOR_TOKENS.map((name) => [theme, name])))(
		"%s %s: oklch() renders its source hex within one step per channel",
		(theme, name) => {
			const value = half(name, theme as Theme);
			const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(value);
			if (!match) throw new Error(`${name} (${theme}) is not oklch(L C H)`);
			const rendered = oklchToRgb255(
				Number(match[1]),
				Number(match[2]),
				Number(match[3]),
			);
			const source = hexToRgb255(hex(name, theme as Theme));
			rendered.forEach((channel, i) => {
				expect(Math.abs(channel - (source[i] ?? 0))).toBeLessThanOrEqual(1.5);
			});
		},
	);

	it("follows the browser unless data-theme forces the host's theme", () => {
		expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light dark;/);
		expect(css).toMatch(
			/\[data-theme="light"\]\s*\{\s*color-scheme:\s*light;\s*\}/,
		);
		expect(css).toMatch(
			/\[data-theme="dark"\]\s*\{\s*color-scheme:\s*dark;\s*\}/,
		);
	});
});

describe("preview tokens", () => {
	it("are the donor page's radius and Quicksand with a system fallback", () => {
		expect(declarations.get("--preview-radius")).toBe("4px");
		expect(declarations.get("--preview-font")).toMatch(
			/^"Quicksand", .*sans-serif$/,
		);
	});
});

describe("WCAG 2.x contrast of the widgets' text on its grounds", () => {
	it("matches the light ratios this repo cites", () => {
		expect(contrast("#ffffff", hex("--primary", "light")).toFixed(2)).toBe(
			"5.48",
		);
		expect(contrast("#ffffff", hex("--red-9", "light")).toFixed(2)).toBe(
			"5.62",
		);
		expect(contrast(hex("--gray-11", "light"), "#ffffff").toFixed(2)).toBe(
			"5.90",
		);
		expect(
			contrast(hex("--amber-12", "light"), hex("--amber-3", "light")).toFixed(
				2,
			),
		).toBe("9.98");
		expect(
			contrast(hex("--green-12", "light"), hex("--green-3", "light")).toFixed(
				1,
			),
		).toBe("11.0");
	});

	const PAIRS: [ink: string, ground: string][] = [
		["--gray-12", "--background"],
		["--gray-12", "--panel"],
		["--gray-12", "--secondary"],
		["--gray-11", "--background"],
		["--gray-11", "--panel"],
		["--gray-11", "--secondary"],
		["--blue-11", "--background"],
		["--blue-11", "--panel"],
		["--primary-fg", "--primary"],
		["--primary-fg", "--primary-hover"],
		["--destructive-fg", "--destructive"],
		["--destructive-fg", "--destructive-hover"],
		["--success-fg", "--success"],
		["--warning-fg", "--warning"],
		["--destructive-subtle-fg", "--destructive-subtle"],
		["--success-subtle-fg", "--success-subtle"],
		["--warning-subtle-fg", "--warning-subtle"],
		["--gray-12", "--destructive-subtle"],
		["--gray-12", "--success-subtle"],
		["--gray-12", "--warning-subtle"],
	];

	// Platform's palette misses 4.5 on these light pairs; it ships them as they are.
	const LIGHT_EXCEPTIONS: Record<string, string> = {
		"--success-fg on --success": "4.25",
		"--success-subtle-fg on --success-subtle": "4.45",
		"--warning-subtle-fg on --warning-subtle": "4.00",
	};

	it.each(
		PAIRS.filter(
			([ink, ground]) => !(`${ink} on ${ground}` in LIGHT_EXCEPTIONS),
		),
	)("light %s on %s is at least 4.5", (ink, ground) => {
		expect(
			contrast(hex(ink, "light"), hex(ground, "light")),
		).toBeGreaterThanOrEqual(4.5);
	});

	it.each(Object.entries(LIGHT_EXCEPTIONS))(
		"light %s is Platform's accepted miss at %s",
		(pair, ratio) => {
			const [ink = "", ground = ""] = pair.split(" on ");
			expect(contrast(hex(ink, "light"), hex(ground, "light")).toFixed(2)).toBe(
				ratio,
			);
		},
	);

	// Widgets put no text on a filled success surface (success is a progress
	// and chip-edge fill; its text sits on --success-subtle), so dark has no such pair.
	const DARK_PAIRS = PAIRS.filter(
		([ink, ground]) => !(ink === "--success-fg" && ground === "--success"),
	);

	it.each(DARK_PAIRS)("dark %s on %s is at least 4.5", (ink, ground) => {
		expect(
			contrast(hex(ink, "dark"), hex(ground, "dark")),
		).toBeGreaterThanOrEqual(4.5);
	});
});
