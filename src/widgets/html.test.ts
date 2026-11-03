import { describe, expect, it } from "vitest";
import { WIDGETS } from "./html";
import { RENDER_TOOLS } from "./model";

const count = (haystack: string, needle: RegExp) =>
	haystack.match(needle)?.length ?? 0;

describe("WIDGETS", () => {
	it("has one resource per render tool, at its ui:// URI", () => {
		expect(Object.keys(WIDGETS).sort()).toEqual(
			Object.keys(RENDER_TOOLS).sort(),
		);
		for (const [name, widget] of Object.entries(WIDGETS)) {
			expect(widget.uri).toBe(`ui://better-giving/${name}.html`);
		}
	});

	describe.each(Object.entries(WIDGETS))("%s", (_name, { html }) => {
		it("is a full HTML document with its style and script inline", () => {
			expect(html.startsWith("<!doctype html>")).toBe(true);
			expect(html).toContain('<div id="root"></div>');
			expect(count(html, /<style>/g)).toBe(1);
			expect(count(html, /<script>/g)).toBe(1);
			const script = html.slice(
				html.indexOf("<script>"),
				html.lastIndexOf("</script>"),
			);
			// the bundle, not an empty shell: it starts the widget against the host
			expect(script.length).toBeGreaterThan(10_000);
			expect(script).toContain("ui/initialize");
		});

		it("loads nothing from outside the document", () => {
			expect(html).not.toMatch(/<link\b/i);
			expect(html).not.toMatch(/<(script|img|iframe)\b[^>]*\bsrc=/i);
			const style = html.slice(
				html.indexOf("<style>"),
				html.indexOf("</style>"),
			);
			expect(style).not.toMatch(/@import/);
			expect(style).not.toMatch(/url\((?!data:)/);
		});
	});
});
