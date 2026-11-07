// Screenshots of every page the site and the connect flow render, from the app
// itself (createApp, answered in-process), at 1440 and 375, light and dark.
// The connect flow is light-only; the site follows the browser's scheme.
// Not part of `pnpm test` or CI.
//
//   pnpm surface-shots [outDir]
//
// playwright-core ships no browser; see `pnpm widget-shots` for installing one.
// Writes <outDir>/<surface>-<page>-<theme>-<width>.png (default
// docs/surface-screenshots/after).

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import "./binary-register.mjs";

// after the loader hooks register: the app imports its fonts, images and widgets
const { createApp } = await import("../src/app");
const { createDb } = await import("../src/db");
const { migrate } = await import("../src/db/migrate");
const { fakeDeployment } = await import("../test/fake-deployment");
const { BASE, env, warmUp } = await import("../test/harness");
const { authorization, discover, openAuthorization, registerClient } =
	await import("../test/oauth");

const OUT = process.argv[2] ?? "docs/surface-screenshots/after";
const WIDTHS = [1440, 375];

const db = createDb({ url: ":memory:" });
await migrate(db);
const deployment = fakeDeployment({ name: "Hope Shelter" });
// The Better Giving site answers nothing, so /connect lands on its
// "couldn't reach" page, which carries the Back button.
const down: typeof fetch = () => Promise.reject(new TypeError("fetch failed"));
const app = createApp({
	env,
	db,
	fetch: down,
	platformOrigin: deployment.origin,
});
const call = async (req: Request) => app.request(req);
await warmUp(call);

const ep = await discover(call, BASE);
const client = await registerClient(call, ep);
const login = await openAuthorization(
	call,
	authorization(ep, client.client_id),
);

const PAGES: { surface: "site" | "connect"; page: string; path: string }[] = [
	// "/" redirects to /docs
	{ surface: "site", page: "docs", path: "/docs" },
	{ surface: "site", page: "privacy", path: "/privacy" },
	{ surface: "site", page: "support", path: "/support" },
	{ surface: "site", page: "terms", path: "/terms" },
	// no login request: the page has no Back button
	{ surface: "connect", page: "message", path: "/connect/" },
	// a verifying login request: the page has the Back button
	{
		surface: "connect",
		page: "message-back",
		path: `${login.pathname}${login.search}`,
	},
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
let failed = 0;
try {
	for (const { surface, page: name, path } of PAGES) {
		const themes =
			surface === "site" ? (["light", "dark"] as const) : ["light"];
		for (const theme of themes) {
			for (const width of WIDTHS) {
				const file = join(OUT, `${surface}-${name}-${theme}-${width}.png`);
				const context = await browser.newContext({
					viewport: { width, height: width < 640 ? 812 : 900 },
					deviceScaleFactor: 1,
					colorScheme: theme as "light" | "dark",
				});
				try {
					await context.route(new RegExp(`^${BASE}(/|$)`), async (route) => {
						const res = await app.request(
							new Request(route.request().url(), {
								method: route.request().method(),
							}),
						);
						await route.fulfill({
							status: res.status,
							headers: Object.fromEntries(res.headers),
							body: Buffer.from(await res.arrayBuffer()),
						});
					});
					const page = await context.newPage();
					await page.goto(`${BASE}${path}`);
					await page.evaluate("document.fonts.ready");
					await page.screenshot({ path: file, fullPage: true });
					process.stdout.write(`${file}\n`);
				} catch (err) {
					failed += 1;
					process.stderr.write(
						`surface-shots: ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
					);
				} finally {
					await context.close();
				}
			}
		}
	}
} finally {
	await browser.close();
}
process.exitCode = failed > 0 ? 1 : 0;
