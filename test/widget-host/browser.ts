// A widget in a real browser page, hosted by the fake host: the AppBridge
// runs here in node and talks to the widget frame through the page's relay.
// Used by scripts/widget-shots.ts; never by `pnpm test` (no browser there).

import type { BrowserContext, Page } from "playwright-core";
import { type FakeHostOptions, startFakeHost } from "./fake-host";
import { blobImage } from "./fixtures";
import { hostPage, type OpenAiSeed, RELAY } from "./page";

type Transport = Parameters<typeof startFakeHost>[0];
type Message = Parameters<Transport["send"]>[0];
type Relay = Record<string, (value: unknown) => void>;

const SPINNER_CLASS = "ds-state-card-spinner";
const STAND_IN_HOST = new URL(blobImage("x")).host;

/** A photo-like stand-in for every image under the fixtures' blob origin; nothing else loads. */
export async function serveFixtureImages(context: BrowserContext) {
	await context.route("**/*", (route) => {
		const url = new URL(route.request().url());
		if (url.host !== STAND_IN_HOST) return route.abort("blockedbyclient");
		let hue = 0;
		for (const char of url.pathname)
			hue = (hue * 31 + char.charCodeAt(0)) % 360;
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 16 9">
<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 62%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 32%)"/></linearGradient></defs>
<rect width="16" height="9" fill="url(#g)"/><circle cx="12" cy="2.6" r="1.2" fill="hsl(48 90% 85%)"/>
<path d="M0 9 5 4.5 8.5 7.5 11 5.5 16 9Z" fill="hsl(${hue} 30% 20% / .55)"/></svg>`;
		return route.fulfill({ contentType: "image/svg+xml", body: svg });
	});
}

/**
 * Opens `html` in `page` as the fake host would show it and resolves once the
 * widget has its result and has reported its size. `chatgpt` also seeds
 * `window.openai` in the widget frame.
 */
export async function showWidget(
	page: Page,
	html: string,
	options: FakeHostOptions,
) {
	const { fixture } = options;
	const transport: Transport = {
		async start() {},
		async close() {},
		async send(message: Message) {
			await page.evaluate(
				([name, m]) => (globalThis as unknown as Relay)[name]?.(m),
				[RELAY.toWidget, message] as const,
			);
		},
	};
	await page.exposeFunction(RELAY.toHost, (message: Message) =>
		transport.onmessage?.(message),
	);
	const openaiCalls: { name: string; arg: unknown }[] = [];
	await page.exposeFunction(RELAY.openai, (name: string, arg: unknown) => {
		openaiCalls.push({ name, arg });
	});

	const sized = Promise.withResolvers<void>();
	const fake = await startFakeHost(transport, options, {
		onSize: ({ height }) => {
			if (height === undefined) return;
			page
				.evaluate(([name, h]) => (globalThis as unknown as Relay)[name]?.(h), [
					RELAY.resize,
					height,
				] as const)
				.then(() => sized.resolve(), sized.reject);
		},
	});
	const fullscreen = (fixture.displayMode ?? "inline") === "fullscreen";
	const openai: OpenAiSeed | undefined = options.chatgpt
		? {
				theme: options.theme,
				locale: options.locale,
				displayMode: fixture.displayMode ?? "inline",
				toolInput: fixture.toolInput ?? {},
				toolOutput:
					"structuredContent" in fixture.result
						? fixture.result.structuredContent
						: null,
				widgetState: null,
			}
		: undefined;
	await page.setContent(
		hostPage({
			html,
			theme: options.theme,
			fullscreen,
			openai,
			column: fixture.column,
		}),
	);
	await withTimeout(fake.served, "the widget never initialized");
	if (!fullscreen) await withTimeout(sized.promise, "the widget never sized");
	// the result renders a task after it arrives (ui/states.tsx draws the spinner until then)
	const frame = page.frameLocator("#widget");
	// `detached` also passes when nothing matches, so a renamed spinner class
	// would turn this wait into a no-op; fail while the bundle still names it
	if (!html.includes(SPINNER_CLASS)) {
		throw new Error(
			`the widget bundle no longer draws .${SPINNER_CLASS} (ui/states.tsx); update the loading wait in test/widget-host/browser.ts`,
		);
	}
	await frame
		.locator(`.${SPINNER_CLASS}`)
		.waitFor({ state: "detached", timeout: 10_000 });
	await page.waitForLoadState("networkidle");
	// the size report for the rendered result lands after the render
	await page.waitForTimeout(250);
	return { ...fake, openaiCalls };
}

async function withTimeout<T>(promise: Promise<T>, message: string) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), 10_000);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
