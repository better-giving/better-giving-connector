// The browser half of the widget preview (./preview.ts): the fake host's
// AppBridge runs in the page itself and talks to the widget's iframe through
// the relay ./page.ts sets up. The bundle is a classic script in the frame
// page's head, so it is listening before the iframe's widget starts.
// Neither DOM nor node types here: the project's tsconfigs have one or the
// other, so the few browser members it touches are declared below.

import { startFakeHost, type Theme } from "./fake-host";
import { type Fixture, findFixture } from "./fixtures";
import { RELAY } from "./page";

/** What ./preview.ts inlines ahead of this script. */
export type PreviewConfig = {
	widget: string;
	state: string;
	theme: Theme;
	width: number;
	locale: string;
};

type Transport = Parameters<typeof startFakeHost>[0];
type Message = Parameters<Transport["send"]>[0];
type Frame = {
	contentDocument: {
		querySelectorAll(selector: string): {
			ariaLabel: string | null;
			textContent: string | null;
			click(): void;
		}[];
	} | null;
};
type Notice = {
	setAttribute(name: string, value: string): void;
	textContent: string | null;
};
type Page = {
	location: { origin: string };
	document: {
		getElementById(id: string): Frame | null;
		createElement(tag: "p"): Notice;
		body: { prepend(node: Notice): void } | null;
	};
	addEventListener(type: "DOMContentLoaded", listener: () => void): void;
	__preview: PreviewConfig;
	__previewStatus?: string;
} & { [name: string]: unknown };

export const STAND_IN_PATH = "/_/img";
/** Hosts the fixtures draw images from; the preview serves a stand-in for each. */
const IMAGE_HOSTS = [
	"https://bg-test.public.blob.vercel-storage.com",
	"https://images.example.com",
];

/**
 * The fixture's data with its image URLs on `origin` and that origin allowed:
 * the widget only draws https images from the origins its data lists.
 */
export function withStandInImages<T>(value: T, origin: string): T {
	const walk = (node: unknown, key?: string): unknown => {
		if (typeof node === "string") {
			const host = IMAGE_HOSTS.find((h) => node.startsWith(`${h}/`));
			return host
				? `${origin}${STAND_IN_PATH}${node.slice(host.length)}`
				: node;
		}
		if (Array.isArray(node)) {
			const items = node.map((item) => walk(item));
			return key === "imageOrigins" ? [...items, origin] : items;
		}
		if (node && typeof node === "object") {
			return Object.fromEntries(
				Object.entries(node).map(([k, v]) => [k, walk(v, k)]),
			);
		}
		return node;
	};
	return walk(value) as T;
}

/** The fixture with stand-in images in its result and in every scripted tool answer. */
export function withStandInFixture(fixture: Fixture, origin: string): Fixture {
	const calls = Object.fromEntries(
		Object.entries(fixture.calls ?? {}).map(([name, answer]) => [
			name,
			async (args: Record<string, unknown>) =>
				withStandInImages(await answer(args), origin),
		]),
	);
	return {
		...fixture,
		result: withStandInImages(fixture.result, origin),
		calls,
	};
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

/**
 * Presses the fixture's buttons, by accessible name, once the widget has
 * rendered them; rejects when one never shows, as widget-shots.ts's click does.
 */
export async function press(
	page: { document: Pick<Page["document"], "getElementById"> },
	labels: readonly string[],
) {
	for (const label of labels) {
		const find = () =>
			[
				...(page.document
					.getElementById("widget")
					?.contentDocument?.querySelectorAll("button") ?? []),
			].find((b) => (b.ariaLabel ?? b.textContent ?? "").trim() === label);
		let button = find();
		for (let tries = 0; !button && tries < 50; tries++) {
			await sleep(100);
			button = find();
		}
		if (!button) throw new Error(`no button named "${label}" appeared`);
		button.click();
		await sleep(250);
	}
}

/** Puts a failed run at the top of the frame page, where the person previewing sees it. */
export function showFailure(page: Page, err: unknown) {
	const reason = err instanceof Error ? err.message : String(err);
	page.__previewStatus = `error: ${reason}`;
	const notice = page.document.createElement("p");
	notice.setAttribute("role", "alert");
	notice.textContent = `Preview failed: ${reason}`;
	const show = () => page.document.body?.prepend(notice);
	// a failure before the body is parsed waits for it
	if (page.document.body) show();
	else page.addEventListener("DOMContentLoaded", show);
}

async function run(page: Page) {
	const { widget, state, theme, width, locale } = page.__preview;
	const fixture = findFixture(widget, state);
	if (!fixture) throw new Error(`no fixture for ${widget} / ${state}`);
	const transport: Transport = {
		async start() {},
		async close() {},
		async send(message: Message) {
			(page[RELAY.toWidget] as (m: Message) => void)(message);
		},
	};
	page[RELAY.toHost] = (message: Message) => transport.onmessage?.(message);
	const shown = withStandInFixture(fixture, page.location.origin);
	const host = await startFakeHost(
		transport,
		{ fixture: shown, theme, locale, width },
		{
			onSize: ({ height }) => {
				if (height !== undefined)
					(page[RELAY.resize] as (h: number) => void)(height);
			},
		},
	);
	await host.served;
	await press(page, fixture.click ?? []);
}

function start(page: Page) {
	run(page).then(
		() => {
			page.__previewStatus = "ready";
		},
		(err: unknown) => showFailure(page, err),
	);
}

// the bundle is a script, not a module: `import` of this file (the tests) starts nothing
const page = globalThis as unknown as Partial<Page>;
if (page.__preview) start(page as Page);
