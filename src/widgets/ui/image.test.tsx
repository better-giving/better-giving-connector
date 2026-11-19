/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { useState } from "hono/jsx/dom";
import { describe, expect, it, vi } from "vitest";
import { flush, mount } from "../test-dom";
import { ImageWithPlaceholder, isAllowedImage } from "./image";

const ORIGINS = [
	"https://app.connect.better.giving",
	"https://*.public.blob.vercel-storage.com",
];

describe("isAllowedImage", () => {
	it("takes an exact origin and a subdomain of a wildcard one", () => {
		expect(
			isAllowedImage("https://app.connect.better.giving/a.png", ORIGINS),
		).toBe(true);
		expect(
			isAllowedImage(
				"https://x1.public.blob.vercel-storage.com/a.jpg",
				ORIGINS,
			),
		).toBe(true);
	});

	it("refuses another host, a look-alike suffix, another scheme or port, and junk", () => {
		for (const url of [
			"https://example.com/a.png",
			"https://public.blob.vercel-storage.com/a.png",
			"https://x.public.blob.vercel-storage.com.evil.io/a.png",
			"http://app.connect.better.giving/a.png",
			"http://x.public.blob.vercel-storage.com/a.png",
			"https://endow-profiles.s3.amazonaws.com/logos/a.png",
			"https://res.cloudinary.com/demo/image/upload/a.jpg",
			"https://app.connect.better.giving:8443/a.png",
			"not a url",
		]) {
			expect(isAllowedImage(url, ORIGINS), url).toBe(false);
		}
	});
});

describe("ImageWithPlaceholder", () => {
	const img = (root: HTMLElement) => root.querySelector("img");
	const placeholder = (root: HTMLElement) =>
		root.querySelector('.ds-image-placeholder[role="img"]');

	it("shows an allowed image with its alt text", async () => {
		const root = mount(
			<ImageWithPlaceholder
				src="https://app.connect.better.giving/a.png"
				alt="Coats on a rack"
				origins={ORIGINS}
			/>,
		);
		expect(img(root)?.getAttribute("alt")).toBe("Coats on a rack");
		expect(img(root)?.classList.contains("ds-image")).toBe(true);
		expect(placeholder(root)).toBeNull();
		const frame = root.querySelector(".ds-image-frame");
		expect(frame?.getAttribute("data-state")).toBe("loading");
		img(root)?.dispatchEvent(new Event("load"));
		await vi.waitFor(() =>
			expect(frame?.getAttribute("data-state")).toBe("loaded"),
		);
	});

	it("draws an overlay slot on request", () => {
		const root = mount(
			<ImageWithPlaceholder
				src={null}
				alt=""
				origins={ORIGINS}
				overlay={<span>Live</span>}
			/>,
		);
		const frame = root.querySelector(".ds-image-frame");
		expect(frame?.getAttribute("data-state")).toBe("unavailable");
		expect(frame?.querySelector(".ds-image-overlay")?.textContent).toBe("Live");
	});

	it("shows the placeholder, never the img, for a blocked origin or no image", () => {
		for (const src of ["https://example.com/a.png", null]) {
			const root = mount(
				<ImageWithPlaceholder src={src} alt="Cover" origins={ORIGINS} />,
			);
			expect(img(root)).toBeNull();
			expect(placeholder(root)?.getAttribute("aria-label")).toBe("Cover");
		}
	});

	it("marks a blocked origin unavailable, with no img", () => {
		const root = mount(
			<ImageWithPlaceholder
				src="https://example.com/a.png"
				alt="Cover"
				origins={ORIGINS}
			/>,
		);
		expect(
			root.querySelector(".ds-image-frame")?.getAttribute("data-state"),
		).toBe("unavailable");
	});

	it("puts a caller's class on the frame beside the registry's", () => {
		const root = mount(
			<ImageWithPlaceholder
				src={null}
				alt=""
				origins={ORIGINS}
				class="pv-hero"
			/>,
		);
		const frame = root.querySelector(".ds-image-frame");
		expect(frame?.classList.contains("ds-image-frame")).toBe(true);
		expect(frame?.classList.contains("pv-hero")).toBe(true);
		expect(root.querySelector(".pv-hero .ds-image-placeholder")).not.toBeNull();
	});

	it("draws the overlay after a real img, inside the frame", () => {
		const root = mount(
			<ImageWithPlaceholder
				src="https://app.connect.better.giving/a.png"
				alt="Cover"
				origins={ORIGINS}
				overlay={<span>Live</span>}
			/>,
		);
		const frame = root.querySelector(".ds-image-frame");
		expect(
			[...(frame?.children ?? [])].map((c) => `${c.tagName}.${c.className}`),
		).toEqual(["IMG.ds-image", "DIV.ds-image-overlay"]);
		expect(frame?.querySelector(".ds-image-overlay")?.textContent).toBe("Live");
	});

	it("starts a new src over as loading, however the last one ended", async () => {
		const A = "https://app.connect.better.giving/a.png";
		const B = "https://app.connect.better.giving/b.png";
		let draw: (src: string) => void = () => {};
		function Swap() {
			const [src, setSrc] = useState(A);
			draw = setSrc;
			return <ImageWithPlaceholder src={src} alt="Cover" origins={ORIGINS} />;
		}
		const root = mount(<Swap />);
		const state = () =>
			root.querySelector(".ds-image-frame")?.getAttribute("data-state");

		img(root)?.dispatchEvent(new Event("error"));
		await vi.waitFor(() => expect(state()).toBe("unavailable"));
		draw(B);
		await flush();
		expect(state()).toBe("loading");
		expect(img(root)?.getAttribute("src")).toBe(B);

		img(root)?.dispatchEvent(new Event("load"));
		await vi.waitFor(() => expect(state()).toBe("loaded"));
		draw(A);
		await flush();
		expect(state()).toBe("loading");
		expect(img(root)?.getAttribute("src")).toBe(A);
	});

	it("reads loading, not loaded, when a loaded src comes back after none", async () => {
		const A = "https://app.connect.better.giving/a.png";
		let draw: (src: string | null) => void = () => {};
		function Swap() {
			const [src, setSrc] = useState<string | null>(A);
			draw = setSrc;
			return <ImageWithPlaceholder src={src} alt="Cover" origins={ORIGINS} />;
		}
		const root = mount(<Swap />);
		const state = () =>
			root.querySelector(".ds-image-frame")?.getAttribute("data-state");

		img(root)?.dispatchEvent(new Event("load"));
		await vi.waitFor(() => expect(state()).toBe("loaded"));
		draw(null);
		await flush();
		expect(state()).toBe("unavailable");
		draw(A);
		await flush();
		expect(state()).toBe("loading");
		expect(img(root)?.getAttribute("src")).toBe(A);
	});

	it("hides the placeholder from screen readers when it has no alt text", () => {
		const root = mount(
			<ImageWithPlaceholder src={null} alt="" origins={ORIGINS} />,
		);
		const box = root.querySelector(".ds-image-placeholder");
		expect(box?.getAttribute("aria-hidden")).toBe("true");
		expect(box?.hasAttribute("role")).toBe(false);
		expect(box?.hasAttribute("aria-label")).toBe(false);
	});

	it("falls back to the placeholder when the image fails to load", async () => {
		const root = mount(
			<ImageWithPlaceholder
				src="https://app.connect.better.giving/gone.png"
				alt="Cover"
				origins={ORIGINS}
			/>,
		);
		img(root)?.dispatchEvent(new Event("error"));
		await vi.waitFor(() => expect(img(root)).toBeNull());
		expect(placeholder(root)).not.toBeNull();
		expect(
			root.querySelector(".ds-image-frame")?.getAttribute("data-state"),
		).toBe("unavailable");
	});
});
