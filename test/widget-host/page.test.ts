import { describe, expect, it } from "vitest";
import { hostPage, type OpenAiSeed, widgetDocument } from "./page";

const WIDGET =
	'<!doctype html>\n<html><head><style>p{}</style></head><body><div id="root"></div><script>start("&")</script></body></html>';

const SEED: OpenAiSeed = {
	theme: "dark",
	locale: "de-DE",
	displayMode: "inline",
	toolInput: {},
	toolOutput: { title: "</script><script>alert(1)</script>" },
	widgetState: null,
};

describe("widgetDocument", () => {
	it("is the widget's own HTML when there is no window.openai to seed", () => {
		expect(widgetDocument(WIDGET)).toBe(WIDGET);
	});

	it("defines window.openai in the head, before the widget's script runs", () => {
		const doc = widgetDocument(WIDGET, SEED);
		const seeded = doc.indexOf("window.openai = openai");
		expect(seeded).toBeGreaterThan(0);
		expect(seeded).toBeLessThan(doc.indexOf("</head>"));
		expect(seeded).toBeLessThan(doc.indexOf('start("&")'));
	});

	it("keeps a tool output's text from closing the seeding script", () => {
		const doc = widgetDocument(WIDGET, SEED);
		expect(doc.match(/<\/script>/g)).toHaveLength(2);
		expect(doc).toContain("\\u003c/script>\\u003cscript>alert(1)");
	});
});

describe("hostPage", () => {
	it("embeds the widget document whole in the iframe's srcdoc", () => {
		const page = hostPage({ html: WIDGET, theme: "light", fullscreen: false });
		const srcdoc = /srcdoc="([^"]*)"/.exec(page)?.[1];
		expect(
			srcdoc?.replaceAll("&quot;", '"').replaceAll("&amp;", "&"),
		).toBe(WIDGET);
	});
});
