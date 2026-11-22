import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { PLATFORM_ORIGIN } from "../../src/deployment/origin";
import { WIDGETS } from "../../src/widgets/html";
import { fakeDeployment } from "../fake-deployment";
import { BASE, env } from "../harness";
import { freshDb } from "../support";
import { CAMPAIGNS, findFixture, standInImage } from "./fixtures";
import { previewApp, previewStates } from "./preview";
import { withStandInFixture, withStandInImages } from "./preview-client";

const preview = previewApp(WIDGETS);
const states = previewStates(Object.keys(WIDGETS));
const get = (path: string) => preview.request(`http://preview.test${path}`);

describe("widget preview", () => {
	it("lists a fixture for every widget, so none goes unseen", () => {
		for (const widget of Object.keys(WIDGETS)) {
			expect(states.filter((s) => s.widget === widget).length).toBeGreaterThan(
				0,
			);
		}
	});

	it("links every state, light and dark, at 1440 and 375, from the index", async () => {
		const index = await (await get("/")).text();
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
			expect(html).toContain('srcdoc="');
		}
	});

	it("answers 404 for a state no fixture has", async () => {
		expect((await get("/photo/nope")).status).toBe(404);
		expect((await get("/nope/dropped")).status).toBe(404);
		expect((await get("/_/frame/photo/nope")).status).toBe(404);
	});

	it("bundles the fake host for a browser", async () => {
		const res = await get("/_/host.js");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("javascript");
		const script = await res.text();
		expect(script.length).toBeGreaterThan(1000);
		expect(script).not.toMatch(/require\(["']node:/);
	});

	it("serves a photo stand-in for the fixtures' image URLs", async () => {
		const res = await get("/_/img/x.jpg");
		expect(res.headers.get("content-type")).toBe("image/svg+xml");
		expect(await res.text()).toBe(standInImage("/_/img/x.jpg"));
	});
});

describe("stand-in images", () => {
	const ORIGIN = "https://preview.example";

	it("moves the fixtures' image URLs onto the page's origin and allows it", () => {
		const shown = withStandInImages(CAMPAIGNS, ORIGIN);
		expect(shown.imageOrigins).toContain(ORIGIN);
		const urls = JSON.stringify(shown);
		expect(urls).toContain(`${ORIGIN}/_/img/`);
		expect(urls).not.toContain("bg-test.public.blob.vercel-storage.com");
	});

	it("leaves a link to a page alone", () => {
		const shown = withStandInImages(CAMPAIGNS, ORIGIN);
		expect(JSON.stringify(shown)).toContain(
			"https://give.harborfoodbank.org/winter-coats",
		);
	});

	it("also swaps the images in a scripted tool answer", async () => {
		const fixture = findFixture("photo", "account");
		if (!fixture?.calls) throw new Error("photo/account scripts no tool call");
		const shown = withStandInFixture(fixture, ORIGIN);
		for (const [name, answer] of Object.entries(shown.calls ?? {})) {
			const reply = await answer({});
			expect(JSON.stringify(reply), name).not.toContain(
				"bg-test.public.blob.vercel-storage.com",
			);
		}
	});
});

describe("the service", () => {
	it("does not serve the preview", async () => {
		const db = await freshDb();
		try {
			const served = createApp({
				env,
				db,
				fetch: fakeDeployment().fetch,
				platformOrigin: PLATFORM_ORIGIN,
			});
			for (const path of [
				"/photo/account",
				"/campaign-results/live",
				"/_/host.js",
				"/_/frame/photo/account",
				"/_/img/x.jpg",
			]) {
				const res = await served.request(new Request(`${BASE}${path}`));
				expect(res.status, path).toBe(404);
			}
		} finally {
			db.close();
		}
	});
});
