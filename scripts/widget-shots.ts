// Screenshots of every widget state in test/widget-host/fixtures.ts, light and
// dark, desktop and phone, hosted by the fake MCP Apps host in headless
// chromium. Not part of `pnpm test`.
//
//   pnpm exec tsx scripts/widget-shots.ts [widget...] [--chatgpt]
//
// Writes docs/widget-screenshots/<nn>-<widget>-<state>-<theme>-<width>.png (with a
// `-chatgpt` suffix when the frame also gets `window.openai`).

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { serveFixtureImages, showWidget } from "../test/widget-host/browser";
import type { Theme } from "../test/widget-host/fake-host";
import { FIXTURES } from "../test/widget-host/fixtures";
import "./binary-register.mjs";

const OUT = "docs/widget-screenshots";
const ORDER = [
	"campaign-create",
	"campaigns",
	"campaign-results",
	"campaign-editor",
	"photo",
];
const THEMES: Theme[] = ["light", "dark"];
const WIDTHS = [1440, 375];
const LOCALE = "en-US";

// after the loader hooks register: html.ts imports each widget as `?widget`
const { WIDGETS } = await import("../src/widgets/html");
type WidgetName = keyof typeof WIDGETS;
const isWidget = (name: string): name is WidgetName => name in WIDGETS;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { chatgpt: { type: "boolean", default: false } },
});
const unknown = positionals.filter((name) => !isWidget(name));
if (unknown.length > 0) {
	process.stderr.write(
		`widget-shots: no widget named ${unknown.join(", ")}; widgets: ${Object.keys(WIDGETS).join(", ")}\n`,
	);
	process.exit(2);
}
const names = (
	positionals.length > 0 ? positionals : Object.keys(WIDGETS)
).filter(isWidget);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
	for (const name of names) {
		const states = Object.entries(FIXTURES[name] ?? {});
		if (states.length === 0) {
			process.stderr.write(`widget-shots: ${name} has no fixtures yet\n`);
		}
		for (const [state, fixture] of states) {
			for (const theme of THEMES) {
				for (const width of WIDTHS) {
					const suffix = values.chatgpt ? "-chatgpt" : "";
					const file = join(
						OUT,
						`${String(ORDER.indexOf(name) + 1).padStart(2, "0")}-${name}-${state}-${theme}-${width}${suffix}.png`,
					);
					const context = await browser.newContext({
						viewport: { width, height: width < 640 ? 812 : 900 },
						deviceScaleFactor: 1,
						colorScheme: theme,
					});
					try {
						await serveFixtureImages(context);
						const page = await context.newPage();
						const errors: string[] = [];
						page.on("pageerror", (err) => errors.push(err.message));
						await showWidget(page, WIDGETS[name].html, {
							fixture,
							theme,
							locale: LOCALE,
							width,
							chatgpt: values.chatgpt,
						});
						for (const label of fixture.click ?? []) {
							await page
								.frameLocator("#widget")
								.getByRole("button", { name: label })
								.click();
							await page.waitForTimeout(250);
						}
						await page.screenshot({ path: file, fullPage: true });
						if (errors.length > 0) throw new Error(errors.join("; "));
						process.stdout.write(`${file}\n`);
					} catch (err) {
						failed += 1;
						process.stderr.write(
							`widget-shots: ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
						);
					} finally {
						await context.close();
					}
				}
			}
		}
	}
} finally {
	await browser.close();
}
process.exitCode = failed > 0 ? 1 : 0;
