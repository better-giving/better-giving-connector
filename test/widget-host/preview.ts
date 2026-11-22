// A page that renders every widget state from ./fixtures.ts in the fake host,
// in a browser: `pnpm preview:widgets` (scripts/widget-preview.ts) serves it.
// It is its own app, never mounted in src/app.ts, so no deployment serves it.
//
//   /                            every state, linked
//   /<widget>/<state>            one state in a frame, with theme and width switches
//   ?theme=light|dark&width=1440|375
//   /_/frame/<widget>/<state>    the host page itself (what the frame above shows)
//   /_/host.js                   the fake host, bundled for the browser
//   /_/img/*                     the stand-in photo the fixtures' image URLs are swapped for

import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Hono } from "hono";
import type { WidgetName } from "../../src/widgets/model";
import type { Theme } from "./fake-host";
import { FIXTURES, findFixture, standInImage } from "./fixtures";
import { hostPage } from "./page";
import { type PreviewConfig, STAND_IN_PATH } from "./preview-client";

const THEMES: Theme[] = ["light", "dark"];
const WIDTHS = [1440, 375];
const LOCALE = "en-US";

const esc = (text: string) =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll('"', "&quot;");

/** JSON that can sit inside an inline <script>. */
const scriptJson = (value: unknown) =>
	JSON.stringify(value).replaceAll("<", "\\u003c");

/** Every widget state the preview shows, in fixture order. */
export const previewStates = (widgets: readonly string[]) =>
	widgets.flatMap((widget) =>
		Object.keys(FIXTURES[widget as WidgetName] ?? {}).map((state) => ({
			widget,
			state,
		})),
	);

const stateUrl = (widget: string, state: string, theme: Theme, width: number) =>
	`/${widget}/${state}?theme=${theme}&width=${width}`;

/** The host bundle's entry, as a file path esbuild can open (`pathname` keeps `%20`). */
export const hostEntry = (base: string | URL = import.meta.url) =>
	fileURLToPath(new URL("./preview-client.ts", base));

async function bundleHost(): Promise<string> {
	const result = await build({
		entryPoints: [hostEntry()],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2023",
	});
	const [file] = result.outputFiles;
	if (!file) throw new Error("the preview host bundle came out empty");
	return file.text;
}

const CHROME_STYLE = `
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#f4f4f5;color:#18181b}
header{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;padding:8px 16px;background:#fff;border-bottom:1px solid #d4d4d8}
header a{color:inherit}
nav{display:flex;gap:4px;align-items:center}
nav a{padding:2px 10px;border:1px solid #d4d4d8;border-radius:6px;text-decoration:none}
nav a[aria-current=true]{background:#18181b;color:#fff;border-color:#18181b}
main{padding:16px}
iframe{display:block;margin:0 auto;border:1px solid #d4d4d8;background:#fff;max-width:100%}
h2{margin:24px 0 4px;font-size:16px}
li{margin:2px 0}
`;

const shell = (title: string, body: string) =>
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CHROME_STYLE}</style></head><body>${body}</body></html>`;

/**
 * The preview app. `widgets` maps each widget's name to its document (the
 * caller loads `src/widgets/html.ts`, which needs the `?widget` loaders).
 */
export function previewApp(widgets: Record<string, { html: string }>): Hono {
	const app = new Hono();
	const names = Object.keys(widgets);
	let host: Promise<string> | undefined;

	app.get("/_/host.js", async (c) => {
		// a failed build is not kept: the next request builds again
		host ??= bundleHost().catch((err: unknown) => {
			host = undefined;
			throw err;
		});
		return c.body(await host, 200, {
			"content-type": "text/javascript; charset=utf-8",
			"cache-control": "no-store",
		});
	});

	app.get(`${STAND_IN_PATH}/*`, (c) =>
		c.body(standInImage(c.req.path), 200, {
			"content-type": "image/svg+xml",
		}),
	);

	const lookup = (widget: string, state: string) => {
		const document = Object.hasOwn(widgets, widget)
			? widgets[widget]
			: undefined;
		const fixture = findFixture(widget, state);
		return document && fixture ? { document, fixture } : null;
	};
	const pick = <T extends string | number>(
		raw: string | undefined,
		allowed: readonly T[],
	): T => allowed.find((a) => String(a) === raw) ?? (allowed[0] as T);

	app.get("/_/frame/:widget/:state", (c) => {
		const { widget = "", state = "" } = c.req.param();
		const found = lookup(widget, state);
		if (!found) return c.text("No such widget state.", 404);
		const theme = pick(c.req.query("theme"), THEMES);
		const width = pick(c.req.query("width"), WIDTHS);
		const config: PreviewConfig = {
			widget,
			state,
			theme,
			width,
			locale: LOCALE,
		};
		const head = `<script>window.__preview=${scriptJson(config)}</script><script src="/_/host.js"></script>`;
		return c.html(
			hostPage({
				html: found.document.html,
				theme,
				fullscreen: (found.fixture.displayMode ?? "inline") === "fullscreen",
				column: found.fixture.column,
				head,
			}),
		);
	});

	app.get("/:widget/:state", (c) => {
		const { widget = "", state = "" } = c.req.param();
		if (!lookup(widget, state)) return c.text("No such widget state.", 404);
		const theme = pick(c.req.query("theme"), THEMES);
		const width = pick(c.req.query("width"), WIDTHS);
		const switches = (
			label: string,
			options: readonly (Theme | number)[],
			current: Theme | number,
			href: (option: never) => string,
		) =>
			`<nav aria-label="${label}">${label}: ${options
				.map(
					(o) =>
						`<a href="${esc(href(o as never))}"${o === current ? ' aria-current="true"' : ""}>${o}</a>`,
				)
				.join("")}</nav>`;
		const frame = `/_/frame/${widget}/${state}?theme=${theme}&width=${width}`;
		return c.html(
			shell(
				`${widget} / ${state}`,
				`<header><a href="/">All states</a><strong>${esc(widget)} / ${esc(state)}</strong>${switches(
					"Theme",
					THEMES,
					theme,
					(t: Theme) => stateUrl(widget, state, t, width),
				)}${switches("Width", WIDTHS, width, (w: number) =>
					stateUrl(widget, state, theme, w),
				)}</header><main><iframe title="${esc(`${widget} / ${state}`)}" src="${esc(frame)}" style="width:${width}px;height:calc(100vh - 80px)"></iframe></main>`,
			),
		);
	});

	app.get("/", (c) => {
		const sections = names
			.map((widget) => {
				const states = previewStates([widget]);
				const items = states
					.map(
						({ state }) =>
							`<li>${esc(state)}: ${THEMES.map((theme) =>
								WIDTHS.map(
									(width) =>
										`<a href="${esc(stateUrl(widget, state, theme, width))}">${theme} ${width}</a>`,
								).join(" · "),
							).join(" · ")}</li>`,
					)
					.join("");
				return `<h2>${esc(widget)}</h2><ul>${items || "<li>no fixtures yet</li>"}</ul>`;
			})
			.join("");
		return c.html(
			shell(
				"Widget preview",
				`<header><strong>Widget preview</strong>every state, rendered by the fake host</header><main>${sections}</main>`,
			),
		);
	});

	return app;
}
