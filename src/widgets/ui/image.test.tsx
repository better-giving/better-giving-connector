/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
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
		root.querySelector('.image-placeholder[role="img"]');

	it("shows an allowed image with its alt text", () => {
		const root = mount(
			<ImageWithPlaceholder
				src="https://app.connect.better.giving/a.png"
				alt="Coats on a rack"
				origins={ORIGINS}
			/>,
		);
		expect(img(root)?.getAttribute("alt")).toBe("Coats on a rack");
		expect(placeholder(root)).toBeNull();
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

	it("hides the placeholder from screen readers when it has no alt text", () => {
		const root = mount(
			<ImageWithPlaceholder src={null} alt="" origins={ORIGINS} />,
		);
		const box = root.querySelector(".image-placeholder");
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
		await flush();
		expect(img(root)).toBeNull();
		expect(placeholder(root)).not.toBeNull();
	});
});
