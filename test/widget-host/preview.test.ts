import { existsSync } from "node:fs";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { createApp } from "../../src/app";
import { PLATFORM_ORIGIN } from "../../src/deployment/origin";
import { WIDGETS } from "../../src/widgets/html";
import { fakeDeployment } from "../fake-deployment";
import { BASE, env } from "../harness";
import { freshDb } from "../support";
import { CAMPAIGNS, findFixture, IMAGE_ORIGINS } from "./fixtures";
import { hostEntry, previewApp, previewStates } from "./preview";
import {
	press,
	showFailure,
	withStandInFixture,
	withStandInImages,
} from "./preview-client";

// the real esbuild, unless a test makes the next build fail
const esbuild = vi.hoisted(() => ({ failNext: false }));
vi.mock("esbuild", async (actual) => {
	const real = await actual<typeof import("esbuild")>();
	return {
		...real,
		build: ((options: Parameters<typeof real.build>[0]) => {
			if (esbuild.failNext) {
				esbuild.failNext = false;
				return Promise.reject(new Error("esbuild failed"));
			}
			return real.build(options);
		}) as typeof real.build,
	};
});

const preview = previewApp(WIDGETS);
const states = previewStates(Object.keys(WIDGETS));
const get = (path: string) => preview.request(`http://preview.test${path}`);

// the first /_/host.js request runs a cold esbuild bundle; warm it once, with room
beforeAll(async () => {
	expect((await get("/_/host.js")).status).toBe(200);
}, 60_000);

const srcdocOf = (page: string) => {
	const match = /srcdoc="([^"]*)"/.exec(page);
	if (!match?.[1]) throw new Error("no srcdoc in the frame page");
	return match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&");
};

describe("widget preview", () => {
	afterEach(() => {
		esbuild.failNext = false;
	});

	it("shows exactly the known states, so a dropped fixture goes red", () => {
		expect(states.map((s) => `${s.widget}/${s.state}`).sort()).toEqual(
			[
				"campaign-create/presets",
				"campaign-create/starting",
				"campaign-editor/blocks",
				"campaign-results/draft",
				"campaign-results/end-confirm",
				"campaign-results/live",
				"campaign-results/live-down",
				"campaign-results/live-flat",
				"campaigns/empty",
				"campaigns/error",
				"campaigns/five",
				"photo/account",
				"photo/account-long",
				"photo/account-single",
				"photo/account-three",
				"photo/dropped",
				"photo/none",
			].sort(),
		);
	});

	it("carries the requested widget's own document in the frame, and two widgets differ", async () => {
		const frameOf = async (widget: string, state: string) =>
			srcdocOf(await (await get(`/_/frame/${widget}/${state}`)).text());
		const photo = await frameOf("photo", "account");
		const campaigns = await frameOf("campaigns", "five");
		expect(photo).toBe(WIDGETS.photo.html);
		expect(campaigns).toBe(WIDGETS.campaigns.html);
		expect(photo).not.toBe(campaigns);
	});

	it("links every state, light and dark, at 1440 and 375, from the index", async () => {
		const index = await (await get("/")).text();
		expect(index).toContain("<h2>photo</h2>");
		expect(index).toContain("<li>account-three: ");
		for (const { widget, state } of states) {
			for (const theme of ["light", "dark"]) {
				for (const width of [1440, 375]) {
					expect(index).toContain(
						`href="/${widget}/${state}?theme=${theme}&amp;width=${width}"`,
					);
				}
			}
		}
	});

	it.each(
		states.map((s) => [`${s.widget}/${s.state}`, s.widget, s.state] as const),
	)("renders %s in a frame, in both themes", async (_name, widget, state) => {
		for (const theme of ["light", "dark"]) {
			const page = await get(`/${widget}/${state}?theme=${theme}&width=375`);
			expect(page.status).toBe(200);
			const body = await page.text();
			expect(body).toContain(
				`src="/_/frame/${widget}/${state}?theme=${theme}&amp;width=375"`,
			);
			expect(body).toContain('aria-current="true">375');

			const frame = await get(
				`/_/frame/${widget}/${state}?theme=${theme}&width=375`,
			);
			expect(frame.status).toBe(200);
			const html = await frame.text();
			expect(html).toContain(`color-scheme:${theme}`);
			expect(html).toContain('<script src="/_/host.js"></script>');
			expect(html).toContain(`"widget":"${widget}"`);
			// the widget's document rides in the iframe, after the host script
			expect(html.indexOf("/_/host.js")).toBeLessThan(html.indexOf("<iframe"));
			expect(srcdocOf(html)).toBe(WIDGETS[widget as keyof typeof WIDGETS].html);
		}
	});

	it("carries a dark theme and 1440 width from the URL into the config", async () => {
		const frame = await (
			await get("/_/frame/photo/account-long?theme=dark&width=1440")
		).text();
		expect(frame).toContain(
			'window.__preview={"widget":"photo","state":"account-long","theme":"dark","width":1440,"locale":"en-US"}',
		);
	});

	it("shows a fullscreen fixture across the viewport and an inline one in the chat column", async () => {
		const editor = await (await get("/_/frame/campaign-editor/blocks")).text();
		expect(editor).toContain("main{width:100%;height:100vh;}");
		expect(editor).toContain("iframe{display:block;width:100%;height:100%;");
		const photo = await (await get("/_/frame/photo/account")).text();
		expect(photo).toContain("max-width:768px");
		expect(photo).toContain("height:120px");
		expect(photo).not.toContain("height:100vh");
	});

	it("widens the chat column to a fixture's column", async () => {
		const five = await (await get("/_/frame/campaigns/five")).text();
		expect(five).toContain("max-width:1040px");
		expect(five).not.toContain("max-width:768px");
	});

	it("falls back to light at 1440 for a theme or width it does not offer", async () => {
		const page = await (
			await get("/photo/account?theme=neon&width=999")
		).text();
		expect(page).toContain(
			'src="/_/frame/photo/account?theme=light&amp;width=1440"',
		);
		expect(page).toContain('aria-current="true">light</a>');
		expect(page).toContain('aria-current="true">1440</a>');
		expect(page.match(/ aria-current="true"/g)).toHaveLength(2);
	});

	it("marks the requested theme and width as current, and no other", async () => {
		const page = await (
			await get("/photo/account?theme=dark&width=375")
		).text();
		expect(page).toContain('aria-current="true">dark</a>');
		expect(page).toContain('aria-current="true">375</a>');
		expect(page).not.toContain('aria-current="true">light</a>');
		expect(page).not.toContain('aria-current="true">1440</a>');
	});

	it("defaults to light at 1440 with no query", async () => {
		const page = await (await get("/photo/account")).text();
		expect(page).toContain('aria-current="true">light</a>');
		expect(page).toContain('aria-current="true">1440</a>');
		const frame = await (await get("/_/frame/photo/account")).text();
		expect(frame).toContain("color-scheme:light");
		expect(frame).toContain('"theme":"light","width":1440');
	});

	it("escapes a widget name in the index and says it has no fixtures", async () => {
		const odd = previewApp({ 'a<i>&"b': { html: "" } });
		const index = await (await odd.request("http://preview.test/")).text();
		expect(index).toContain("<h2>a&lt;i>&amp;&quot;b</h2>");
		expect(index).toContain("<li>no fixtures yet</li>");
		expect(index).not.toContain("<i>");
	});

	it("answers 404 for a state no fixture has", async () => {
		expect((await get("/photo/nope")).status).toBe(404);
		expect((await get("/nope/dropped")).status).toBe(404);
		expect((await get("/_/frame/photo/nope")).status).toBe(404);
	});

	it("answers 404 for names Object.prototype carries", async () => {
		for (const path of [
			"/constructor/name",
			"/hasOwnProperty/name",
			"/photo/constructor",
			"/photo/__proto__",
			"/_/frame/constructor/name",
			"/_/frame/photo/toString",
		]) {
			expect((await get(path)).status, path).toBe(404);
		}
		expect(findFixture("constructor", "name")).toBeUndefined();
		expect(findFixture("photo", "constructor")).toBeUndefined();
	});

	it("builds the host again after a failed build", async () => {
		const fresh = previewApp(WIDGETS);
		const host = () => fresh.request("http://preview.test/_/host.js");
		const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			esbuild.failNext = true;
			expect((await host()).status).toBe(500);
		} finally {
			quiet.mockRestore();
		}
		expect((await host()).status).toBe(200);
	});

	it("bundles from a file path, decoded, so a checkout path with a space works", () => {
		expect(existsSync(hostEntry())).toBe(true);
		expect(hostEntry("file:///home/a%20b/test/widget-host/preview.ts")).toBe(
			"/home/a b/test/widget-host/preview-client.ts",
		);
	});

	it("bundles the fake host for a browser", async () => {
		const res = await get("/_/host.js");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("javascript");
		const script = await res.text();
		expect(script.length).toBeGreaterThan(1000);
		expect(script).not.toMatch(/require\(["']node:/);
	});

	it("serves a photo stand-in svg that differs by path, nested paths included", async () => {
		const a = await get("/_/img/x.jpg");
		expect(a.status).toBe(200);
		expect(a.headers.get("content-type")).toBe("image/svg+xml");
		const first = await a.text();
		expect(first).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		expect(first).toContain('viewBox="0 0 16 9"');
		const nested = await get("/_/img/logos/team/b.png");
		expect(nested.status).toBe(200);
		expect(await nested.text()).not.toBe(first);
	});
});

describe("preview failures", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	type Fake = { ariaLabel: string | null; textContent: string | null };
	const pageWith = (initial: Fake[]) => {
		const clicked: (string | null)[] = [];
		const buttons: (Fake & { click(): void })[] = [];
		const add = (button: Fake) =>
			buttons.push({
				...button,
				click: () => clicked.push(button.ariaLabel ?? button.textContent),
			});
		for (const button of initial) add(button);
		const page = {
			document: {
				getElementById: () => ({
					contentDocument: {
						querySelectorAll: (selector: string) =>
							selector === "button" ? buttons : [],
					},
				}),
			},
		};
		return { page, clicked, add };
	};
	const text = (textContent: string): Fake => ({
		ariaLabel: null,
		textContent,
	});

	it("presses a button the fixture names", async () => {
		vi.useFakeTimers();
		const { page, clicked } = pageWith([text("Cancel"), text("End campaign")]);
		const pressed = press(page, ["End campaign"]);
		await vi.runAllTimersAsync();
		await pressed;
		expect(clicked).toEqual(["End campaign"]);
	});

	it("presses a button whose name only contains the label, in any case", async () => {
		vi.useFakeTimers();
		const { page, clicked } = pageWith([text("Edit TITLE & story (3)")]);
		const pressed = press(page, ["title & STORY"]);
		await vi.runAllTimersAsync();
		await pressed;
		expect(clicked).toEqual(["Edit TITLE & story (3)"]);
	});

	it("matches on the aria-label when a button has one, not its text", async () => {
		vi.useFakeTimers();
		const { page, clicked } = pageWith([
			{ ariaLabel: "Cancel", textContent: "Remove photo 2" },
			{ ariaLabel: "Remove photo 2", textContent: "x" },
		]);
		const pressed = press(page, ["remove PHOTO"]);
		await vi.runAllTimersAsync();
		await pressed;
		expect(clicked).toEqual(["Remove photo 2"]);
	});

	it("presses each label in order", async () => {
		vi.useFakeTimers();
		const { page, clicked } = pageWith([text("Second"), text("First")]);
		const pressed = press(page, ["first", "second"]);
		await vi.runAllTimersAsync();
		await pressed;
		expect(clicked).toEqual(["First", "Second"]);
	});

	it("waits for a button that renders after the widget has started", async () => {
		vi.useFakeTimers();
		const { page, clicked, add } = pageWith([]);
		const pressed = press(page, ["End campaign"]);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(clicked).toEqual([]);
		add(text("End campaign"));
		await vi.runAllTimersAsync();
		await pressed;
		expect(clicked).toEqual(["End campaign"]);
	});

	it("fails when a button the fixture names never shows", async () => {
		vi.useFakeTimers();
		const { page, clicked } = pageWith([text("Cancel")]);
		const pressed = press(page, ["End campaign"]);
		const failed = expect(pressed).rejects.toThrow(
			'no button named "End campaign" appeared',
		);
		await vi.runAllTimersAsync();
		await failed;
		expect(clicked).toEqual([]);
	});

	const failingPage = (bodyReady: boolean) => {
		const shown: { role?: string; text: string | null }[] = [];
		const listeners: Record<string, () => void> = {};
		const notice = {
			role: undefined as string | undefined,
			textContent: null as string | null,
		};
		const page = {
			location: { origin: "https://preview.example" },
			__preview: {
				widget: "photo",
				state: "account",
				theme: "light" as const,
				width: 375,
				locale: "en-US",
			},
			addEventListener: (type: string, listener: () => void) => {
				listeners[type] = listener;
			},
			document: {
				getElementById: () => null,
				createElement: () => ({
					setAttribute: (_name: string, value: string) => {
						notice.role = value;
					},
					set textContent(text: string | null) {
						notice.textContent = text;
					},
					get textContent() {
						return notice.textContent;
					},
				}),
				body: bodyReady
					? {
							prepend: () =>
								shown.push({ role: notice.role, text: notice.textContent }),
						}
					: null,
			},
		};
		return { page, shown, listeners };
	};

	it("shows a failure on the page as an alert", () => {
		const { page, shown } = failingPage(true);
		showFailure(page, new Error('no button named "End campaign" appeared'));
		expect(shown).toEqual([
			{
				role: "alert",
				text: 'Preview failed: no button named "End campaign" appeared',
			},
		]);
		expect(page).toHaveProperty(
			"__previewStatus",
			'error: no button named "End campaign" appeared',
		);
	});

	it("holds the alert until the body is parsed when the widget fails before it", () => {
		const { page, shown, listeners } = failingPage(false);
		showFailure(page, new Error("no fixture for photo / nope"));
		expect(shown).toEqual([]);
		expect(page).toHaveProperty(
			"__previewStatus",
			"error: no fixture for photo / nope",
		);
		// the body arrives, then the page tells the listener
		page.document.body = {
			prepend: () =>
				shown.push({
					role: "alert",
					text: "Preview failed: no fixture for photo / nope",
				}),
		} as never;
		listeners.DOMContentLoaded?.();
		expect(shown).toEqual([
			{ role: "alert", text: "Preview failed: no fixture for photo / nope" },
		]);
	});

	it("shows a rejection that is not an Error by its string", () => {
		const { page, shown } = failingPage(true);
		showFailure(page, "host refused");
		expect(shown).toEqual([
			{ role: "alert", text: "Preview failed: host refused" },
		]);
		expect(page).toHaveProperty("__previewStatus", "error: host refused");
	});
});

describe("stand-in images", () => {
	const ORIGIN = "https://preview.example";
	const BLOB = "bg-test.public.blob.vercel-storage.com";

	it("moves the fixtures' image URLs onto the page's origin and allows it", () => {
		const before = JSON.stringify(CAMPAIGNS);
		expect(before).toContain(BLOB);
		expect(before).toContain("https://images.example.com/roof.jpg");
		const shown = withStandInImages(CAMPAIGNS, ORIGIN);
		expect(shown.imageOrigins).toEqual([...IMAGE_ORIGINS, ORIGIN]);
		const urls = JSON.stringify(shown);
		expect(urls).toContain(`${ORIGIN}/_/img/coats.jpg`);
		expect(urls).not.toContain(BLOB);
		// the blocked-origin card keeps its URL and its origin stays unlisted
		expect(urls).toContain("https://images.example.com/roof.jpg");
		expect(urls).not.toContain(`${ORIGIN}/_/img/roof.jpg`);
		expect(shown.imageOrigins).not.toContain("https://images.example.com");
	});

	it("leaves a link to a page alone", () => {
		const shown = withStandInImages(CAMPAIGNS, ORIGIN);
		expect(JSON.stringify(shown)).toContain(
			"https://give.harborfoodbank.org/winter-coats",
		);
	});

	it("also swaps the images in a scripted tool answer", async () => {
		const fixture = findFixture("photo", "account-three");
		const original = fixture?.calls?.list_nonprofits;
		if (!fixture || !original) throw new Error("no list_nonprofits script");
		// positive control: the unswapped answer does carry a blob image
		expect(JSON.stringify(await original({}))).toContain(BLOB);

		const swapped = withStandInFixture(fixture, ORIGIN).calls?.list_nonprofits;
		if (!swapped) throw new Error("the swap dropped the scripted call");
		const reply = JSON.stringify(await swapped({}));
		expect(reply).not.toContain(BLOB);
		expect(reply).toContain(`${ORIGIN}/_/img/bayanihan-logo.jpg`);
	});
});

describe("the service", () => {
	const paths = [
		"/photo/account",
		"/campaign-results/live",
		"/_/host.js",
		"/_/frame/photo/account",
		"/_/img/x.jpg",
	];
	let db: Awaited<ReturnType<typeof freshDb>>;
	let served: ReturnType<typeof createApp>;

	beforeAll(async () => {
		db = await freshDb();
		served = createApp({
			env,
			db,
			fetch: fakeDeployment().fetch,
			platformOrigin: PLATFORM_ORIGIN,
		});
	});
	afterAll(() => db.close());

	// the preview answers each path, so the service's 404 is the mount's absence
	it.each(paths)("does not serve %s, though the preview does", async (path) => {
		expect((await get(path)).status).toBe(200);
		const res = await served.request(new Request(`${BASE}${path}`));
		expect(res.status).toBe(404);
	});
});
