// @vitest-environment happy-dom
import { jsx } from "hono/jsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Page } from "../src/site/page";

// The page's nav script, run in a DOM against the page's own markup. The
// markup is the Page component's output, which the routes serve unchanged.
// Scripts are cut out of the markup and run by hand, so the dark script never
// runs and the nav script runs exactly once per test.
const html = String(
	jsx(Page, { heading: "Docs", current: "/docs" }, "Body text"),
);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
	(m) => m[1] ?? "",
);
const navScript = scripts.find((s) => s.includes("site-menu")) ?? "";
const body = (html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "").replace(
	/<script>[\s\S]*?<\/script>/g,
	"",
);

const MENU_PATHS = ["M4 5h16", "M4 12h16", "M4 19h16"];
const CLOSE_PATHS = ["M18 6 6 18", "m6 6 12 12"];

type Listener = (e: Event) => void;
let documentListeners: Array<[string, Listener]> = [];
let widthListeners: Array<() => void> = [];
let width = { matches: false };
let asked = "";

// Mounts the page and runs the nav script against a stub `matchMedia`, whose
// match the tests flip. The script also listens on `document`, which outlives
// the test, so each listener it adds is taken back in afterEach.
function mount() {
	const add = document.addEventListener.bind(document);
	vi.spyOn(document, "addEventListener").mockImplementation(
		(type: string, fn: EventListenerOrEventListenerObject) => {
			documentListeners.push([type, fn as Listener]);
			add(type, fn);
		},
	);
	document.body.innerHTML = `${body}<input id="outside" />`;
	width = { matches: false };
	new Function("matchMedia", navScript)((query: string) => {
		asked = query;
		return {
			get matches() {
				return width.matches;
			},
			addEventListener: (type: string, fn: () => void) => {
				if (type === "change") widthListeners.push(fn);
			},
		};
	});
	const toggle = document.querySelector(".ds-site-nav-toggle") as HTMLElement;
	const menu = document.getElementById("site-menu") as HTMLElement;
	const links = [...menu.querySelectorAll("a")] as HTMLElement[];
	const outside = document.getElementById("outside") as HTMLInputElement;
	const glyph = () =>
		[...toggle.querySelectorAll("path")].map((p) => p.getAttribute("d"));
	const open = () => toggle.click();
	const isOpen = () => !menu.hidden;
	const escape = (target: EventTarget, init: KeyboardEventInit = {}) =>
		target.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	const focusOut = (from: EventTarget, to: EventTarget | null) =>
		from.dispatchEvent(
			new FocusEvent("focusout", { bubbles: true, relatedTarget: to }),
		);
	const pointerDown = (target: EventTarget) =>
		target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	const widen = (matches: boolean) => {
		width.matches = matches;
		for (const fn of widthListeners) fn();
	};
	return {
		toggle,
		menu,
		links,
		outside,
		glyph,
		open,
		isOpen,
		escape,
		focusOut,
		pointerDown,
		widen,
	};
}

beforeEach(() => {
	documentListeners = [];
	widthListeners = [];
});

afterEach(() => {
	vi.restoreAllMocks();
	for (const [type, fn] of documentListeners)
		document.removeEventListener(type, fn);
	document.body.innerHTML = "";
});

describe("the site nav's menu button", () => {
	it("starts closed, with the menu glyph, and asks for the 40rem fold", () => {
		const { toggle, isOpen, glyph } = mount();

		expect(asked).toBe("(min-width: 40rem)");
		expect(isOpen()).toBe(false);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(glyph()).toEqual(MENU_PATHS);
	});

	it("opens the menu on a click and closes it on a second", () => {
		const { toggle, open, isOpen, glyph } = mount();

		open();
		expect(isOpen()).toBe(true);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(glyph()).toEqual(CLOSE_PATHS);

		open();
		expect(isOpen()).toBe(false);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(glyph()).toEqual(MENU_PATHS);
	});
});

describe("the site nav's menu and Escape", () => {
	it.each(["panel", "button", "body"] as const)(
		"closes on Escape from the %s and focuses the button",
		(where) => {
			const m = mount();
			m.open();
			const target = { panel: m.links[0], button: m.toggle, body: document.body }[
				where
			] as HTMLElement;
			if (where === "panel") target.focus();

			m.escape(target);

			expect(m.isOpen()).toBe(false);
			expect(m.toggle.getAttribute("aria-expanded")).toBe("false");
			expect(document.activeElement).toBe(m.toggle);
		},
	);

	it("leaves the menu open on Escape from a field outside it", () => {
		const m = mount();
		m.open();

		m.escape(m.outside);

		expect(m.isOpen()).toBe(true);
	});

	it("leaves the menu open on an Escape another handler already took", () => {
		const m = mount();
		m.open();
		m.links[0]?.addEventListener("keydown", (e) => e.preventDefault());

		m.escape(m.links[0] as HTMLElement);

		expect(m.isOpen()).toBe(true);
	});
});

describe("the site nav's menu and the pointer", () => {
	it("closes on a press outside it", () => {
		const m = mount();
		m.open();

		m.pointerDown(m.outside);

		expect(m.isOpen()).toBe(false);
	});

	it("stays open on a press inside the panel or on the button", () => {
		const m = mount();
		m.open();

		m.pointerDown(m.links[0] as HTMLElement);
		m.pointerDown(m.toggle);

		expect(m.isOpen()).toBe(true);
	});

	it("closes when a link in the panel is clicked", () => {
		const m = mount();
		m.open();
		// the page would navigate; the test only watches the menu
		document.addEventListener("click", (e) => e.preventDefault());

		m.links[1]?.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true }),
		);

		expect(m.isOpen()).toBe(false);
	});
});

describe("the site nav's menu and focus", () => {
	it("closes when focus moves to something outside it", () => {
		const m = mount();
		m.open();

		m.focusOut(m.links[0] as HTMLElement, m.outside);

		expect(m.isOpen()).toBe(false);
	});

	it("stays open when focus moves inside the menu or to the button, or to nothing", () => {
		const m = mount();
		m.open();

		m.focusOut(m.links[0] as HTMLElement, m.links[1] as HTMLElement);
		m.focusOut(m.links[0] as HTMLElement, m.toggle);
		m.focusOut(m.toggle, m.links[0] as HTMLElement);
		m.focusOut(m.links[0] as HTMLElement, null);
		m.focusOut(m.toggle, null);

		expect(m.isOpen()).toBe(true);
	});
});

describe("the site nav's menu and the fold", () => {
	it("closes when the viewport widens to 40rem", () => {
		const m = mount();
		m.open();

		m.widen(true);

		expect(m.isOpen()).toBe(false);
		expect(m.toggle.getAttribute("aria-expanded")).toBe("false");
	});

	it("stays open when the query stops matching", () => {
		const m = mount();
		m.open();

		m.widen(false);

		expect(m.isOpen()).toBe(true);
	});
});
