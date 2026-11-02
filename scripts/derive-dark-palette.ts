// Derives the widgets' dark palette (src/widgets/tokens.css) with Radix's
// custom-palette generator: `generateRadixColors` from radix-ui/website
// components/generate-radix-colors.tsx, ported below without changes to its
// maths (the alpha and surface outputs are left out; tokens.css uses neither).
//
// Needs the generator's own dependencies at the versions radix-ui/website
// pins, installed outside this repo (nothing is added to package.json):
//
//   mkdir -p /tmp/radix-deps && cd /tmp/radix-deps && echo '{"private":true}' > package.json
//   pnpm add --ignore-scripts @radix-ui/colors@3.0.0 colorjs.io@0.5.2 bezier-easing@2.1.0
//
// Run from the repo root:
//
//   pnpm exec tsx scripts/derive-dark-palette.ts /tmp/radix-deps/node_modules
//
// It first regenerates the light half from Platform's inputs (background
// #FFFFFF) and exits non-zero unless every step matches the light hex in
// tokens.css, then prints each dark step as `oklch(...) /* #hex */` and the
// tool's contrast colour per accent.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const ACCENTS = {
	blue: "#1E6DAB",
	red: "#CC1926",
	green: "#0E8C62",
	amber: "#F59E0B",
} as const;
const GRAY = "#E2E8F0";
const BACKGROUND = { light: "#FFFFFF", dark: "#212121" } as const;
type Appearance = keyof typeof BACKGROUND;

type Coords = [number, number, number];
interface ColorInstance {
	coords: Coords;
	to(space: string): ColorInstance;
	deltaEOK(other: ColorInstance): number;
	contrastAPCA(other: ColorInstance): number;
	toString(options?: { format?: string; precision?: number }): string;
	inGamut(space: string): boolean;
}
interface ColorStatic {
	new (str: string | ColorInstance): ColorInstance;
	new (space: string, coords: number[]): ColorInstance;
	mix(a: ColorInstance, b: ColorInstance, ratio: number): ColorInstance;
}
type Easing = [number, number, number, number];
type BezierEasing = (...curve: Easing) => (t: number) => number;
type Scale = ColorInstance[];

const depsDir = process.argv[2];
if (!depsDir) {
	process.stderr.write(
		"usage: tsx scripts/derive-dark-palette.ts <node_modules with @radix-ui/colors, colorjs.io, bezier-easing>\n",
	);
	process.exit(2);
}
const load = createRequire(join(depsDir, "_.js"));
const Color = (load("colorjs.io") as { default: ColorStatic }).default;
const bezierEasing = load("bezier-easing") as BezierEasing;
const RadixColors = load("@radix-ui/colors") as Record<
	string,
	Record<string, string>
>;

const grayScaleNames = ["gray", "mauve", "slate", "sage", "olive", "sand"];
const scaleNames = [
	...grayScaleNames,
	"tomato",
	"red",
	"ruby",
	"crimson",
	"pink",
	"plum",
	"purple",
	"violet",
	"iris",
	"indigo",
	"blue",
	"cyan",
	"teal",
	"jade",
	"green",
	"grass",
	"brown",
	"orange",
	"sky",
	"mint",
	"lime",
	"yellow",
	"amber",
];

function stockScales(names: string[], suffix: "P3" | "DarkP3") {
	return Object.fromEntries(
		names.map((name) => {
			const steps = RadixColors[`${name}${suffix}`];
			if (!steps) throw new Error(`@radix-ui/colors has no ${name}${suffix}`);
			return [
				name,
				Object.values(steps).map((str) => new Color(str).to("oklch")),
			];
		}),
	) as Record<string, Scale>;
}

const stock = {
	light: {
		all: stockScales(scaleNames, "P3"),
		gray: stockScales(grayScaleNames, "P3"),
	},
	dark: {
		all: stockScales(scaleNames, "DarkP3"),
		gray: stockScales(grayScaleNames, "DarkP3"),
	},
};

const darkModeEasing: Easing = [1, 0, 1, 0];
const lightModeEasing: Easing = [0, 2, 0, 2];

function at<T>(arr: readonly T[], i: number): T {
	const value = arr[i];
	if (value === undefined) throw new Error(`index ${i} out of range`);
	return value;
}

function generateRadixColors(
	appearance: Appearance,
	accent: string,
	gray: string,
	background: string,
) {
	const allScales = stock[appearance].all;
	const grayScales = stock[appearance].gray;
	const backgroundColor = new Color(background).to("oklch");
	const grayScaleColors = getScaleFromColor(
		new Color(gray).to("oklch"),
		grayScales,
		backgroundColor,
	);
	const accentBaseColor = new Color(accent).to("oklch");
	let accentScaleColors = getScaleFromColor(
		accentBaseColor,
		allScales,
		backgroundColor,
	);
	const accentBaseHex = accentBaseColor.to("srgb").toString({ format: "hex" });
	if (accentBaseHex === "#000" || accentBaseHex === "#fff") {
		accentScaleColors = grayScaleColors.map(
			(c) => new Color("oklch", [...c.coords]),
		);
	}
	const [accent9, accentContrast] = getStep9Colors(
		accentScaleColors,
		accentBaseColor,
	);
	accentScaleColors[8] = accent9;
	accentScaleColors[9] = getButtonHoverColor(accent9, [accentScaleColors]);
	const textChromaCap = Math.max(
		at(accentScaleColors, 8).coords[1],
		at(accentScaleColors, 7).coords[1],
	);
	for (const i of [10, 11]) {
		const step = at(accentScaleColors, i);
		step.coords[1] = Math.min(textChromaCap, step.coords[1]);
	}
	return {
		accentScale: accentScaleColors,
		accentContrast,
		grayScale: grayScaleColors,
	};
}

function getStep9Colors(
	scale: Scale,
	accentBaseColor: ColorInstance,
): [ColorInstance, ColorInstance] {
	const distance = accentBaseColor.deltaEOK(at(scale, 0)) * 100;
	if (distance < 25) return [at(scale, 8), getTextColor(at(scale, 8))];
	return [accentBaseColor, getTextColor(accentBaseColor)];
}

function getButtonHoverColor(source: ColorInstance, scales: Scale[]) {
	const [L, C, H] = source.coords;
	const newL = L > 0.4 ? L - 0.03 / (L + 0.1) : L + 0.03 / (L + 0.1);
	const newC = L > 0.4 && !Number.isNaN(H) ? C * 0.93 + 0 : C;
	const buttonHoverColor = new Color("oklch", [newL, newC, H]);
	let closestColor = buttonHoverColor;
	let minDistance = Number.POSITIVE_INFINITY;
	for (const scale of scales) {
		for (const color of scale) {
			const distance = buttonHoverColor.deltaEOK(color);
			if (distance < minDistance) {
				minDistance = distance;
				closestColor = color;
			}
		}
	}
	buttonHoverColor.coords[1] = closestColor.coords[1];
	buttonHoverColor.coords[2] = closestColor.coords[2];
	return buttonHoverColor;
}

function getScaleFromColor(
	source: ColorInstance,
	scales: Record<string, Scale>,
	backgroundColor: ColorInstance,
): Scale {
	const allColors: { scale: string; color: ColorInstance; distance: number }[] =
		[];
	for (const [name, scale] of Object.entries(scales)) {
		for (const color of scale) {
			allColors.push({ scale: name, distance: source.deltaEOK(color), color });
		}
	}
	allColors.sort((a, b) => a.distance - b.distance);
	const closestColors = allColors.filter(
		(color, i, arr) =>
			i === arr.findIndex((value) => value.scale === color.scale),
	);
	const allAreGrays = closestColors.every((c) =>
		grayScaleNames.includes(c.scale),
	);
	if (!allAreGrays && grayScaleNames.includes(at(closestColors, 0).scale)) {
		while (grayScaleNames.includes(at(closestColors, 1).scale)) {
			closestColors.splice(1, 1);
		}
	}
	const colorA = at(closestColors, 0);
	const colorB = at(closestColors, 1);

	const a = colorB.distance;
	const b = colorA.distance;
	const c = colorA.color.deltaEOK(colorB.color);
	const cosA = (b ** 2 + c ** 2 - a ** 2) / (2 * b * c);
	const sinA = Math.sin(Math.acos(cosA));
	const cosB = (a ** 2 + c ** 2 - b ** 2) / (2 * a * c);
	const sinB = Math.sin(Math.acos(cosB));
	const tanC1 = cosA / sinA;
	const tanC2 = cosB / sinB;
	const ratio = Math.max(0, tanC1 / tanC2) * 0.5;

	const scaleA = scales[colorA.scale] ?? [];
	const scaleB = scales[colorB.scale] ?? [];
	const scale = Array.from({ length: 12 }, (_, i) =>
		new Color(Color.mix(at(scaleA, i), at(scaleB, i), ratio)).to("oklch"),
	);
	const baseColor = at(
		scale.slice().sort((x, y) => source.deltaEOK(x) - source.deltaEOK(y)),
		0,
	);
	const ratioC = source.coords[1] / baseColor.coords[1];
	for (const color of scale) {
		color.coords[1] = Math.min(
			source.coords[1] * 1.5,
			color.coords[1] * ratioC,
		);
		color.coords[2] = source.coords[2];
	}

	if (at(scale, 0).coords[0] > 0.5) {
		const backgroundL = Math.max(0, Math.min(1, backgroundColor.coords[0]));
		const newLightness = transposeProgressionStart(
			backgroundL,
			[1, ...scale.map(({ coords }) => coords[0])],
			lightModeEasing,
		);
		newLightness.shift();
		newLightness.forEach((lightness, i) => {
			at(scale, i).coords[0] = lightness;
		});
		return scale;
	}

	const ease: Easing = [...darkModeEasing];
	const referenceBackgroundL = at(scale, 0).coords[0];
	const backgroundL = Math.max(0, Math.min(1, backgroundColor.coords[0]));
	const ratioL = backgroundL / referenceBackgroundL;
	if (ratioL > 1) {
		const maxRatio = 1.5;
		for (let i = 0; i < ease.length; i++) {
			const metaRatio = (ratioL - 1) * (maxRatio / (maxRatio - 1));
			ease[i] =
				ratioL > maxRatio ? 0 : Math.max(0, at(ease, i) * (1 - metaRatio));
		}
	}
	const newLightness = transposeProgressionStart(
		backgroundColor.coords[0],
		scale.map(({ coords }) => coords[0]),
		ease,
	);
	newLightness.forEach((lightness, i) => {
		at(scale, i).coords[0] = lightness;
	});
	return scale;
}

function getTextColor(background: ColorInstance) {
	const white = new Color("oklch", [1, 0, 0]);
	if (Math.abs(white.contrastAPCA(background)) < 40) {
		const [, C, H] = background.coords;
		return new Color("oklch", [0.25, Math.max(0.08 * C, 0.04), H]);
	}
	return white;
}

function transposeProgressionStart(to: number, arr: number[], curve: Easing) {
	const fn = bezierEasing(...curve);
	const lastIndex = arr.length - 1;
	const diff = at(arr, 0) - to;
	return arr.map((n, i) => n - diff * fn(1 - i / lastIndex));
}

function hex(color: ColorInstance) {
	const str = color.to("srgb").toString({ format: "hex" });
	return str.length === 4
		? `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`
		: str;
}

/** The oklch() of the sRGB hex, as Platform authors it: the generator's wide-gamut value can sit outside sRGB. */
function oklch(color: ColorInstance) {
	const [L, C, H] = new Color(hex(color)).to("oklch").coords;
	const round = (n: number, digits: number) => +n.toFixed(digits);
	const hue = Number.isNaN(H) ? 0 : round(H, 2);
	return `oklch(${round(L, 4)} ${round(C, 4)} ${hue})`;
}

function generateAll(appearance: Appearance) {
	const out: Record<string, ColorInstance[]> = {};
	const contrast: Record<string, ColorInstance> = {};
	for (const [name, accent] of Object.entries(ACCENTS)) {
		const result = generateRadixColors(
			appearance,
			accent,
			GRAY,
			BACKGROUND[appearance],
		);
		out[name] = result.accentScale;
		contrast[name] = result.accentContrast;
		out.gray = result.grayScale;
	}
	return { scales: out, contrast };
}

const tokensCss = readFileSync(
	new URL("../src/widgets/tokens.css", import.meta.url),
	"utf8",
);
const lightHex = new Map(
	[
		...tokensCss.matchAll(
			/--([a-z]+-\d+):\s*light-dark\(\s*oklch\([^)]*\)\s*\/\*\s*(#[0-9a-f]{6})/g,
		),
	].map((m) => [m[1], m[2]]),
);

const light = generateAll("light");
const mismatches: string[] = [];
for (const [name, scale] of Object.entries(light.scales)) {
	scale.forEach((color, i) => {
		const want = lightHex.get(`${name}-${i + 1}`);
		const got = hex(color);
		if (want !== got)
			mismatches.push(`${name}-${i + 1}: tokens.css ${want}, generated ${got}`);
	});
}
if (mismatches.length > 0) {
	process.stderr.write(
		`light regeneration does not match tokens.css:\n${mismatches.join("\n")}\n`,
	);
	process.exit(1);
}
process.stdout.write(
	`light: all ${lightHex.size} steps regenerate to tokens.css\n\ndark (background ${BACKGROUND.dark}):\n`,
);

const dark = generateAll("dark");
for (const [name, scale] of Object.entries(dark.scales)) {
	scale.forEach((color, i) => {
		process.stdout.write(
			`--${name}-${i + 1}: ${oklch(color)} /* ${hex(color)} */${color.inGamut("srgb") ? "" : " (outside sRGB; hex is the generator's sRGB mapping)"}\n`,
		);
	});
}
for (const [name, color] of Object.entries(dark.contrast)) {
	process.stdout.write(
		`contrast(${name}): ${oklch(color)} /* ${hex(color)} */\n`,
	);
}
