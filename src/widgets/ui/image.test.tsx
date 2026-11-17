/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { mount } from "../test-dom";
import { ImageWithPlaceholder, isAllowedImage } from "./image";

const ORIGINS = [
	"https://app.connect.better.giving",
	"https://*.public.blob.vercel-storage.com",
	"https://endow-profiles.s3.amazonaws.com",
	"https://res.cloudinary.com",
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

describe("isAllowedImage logo hosts", () => {
	it("takes the two exact logo hosts", () => {
		for (const url of [
			"https://endow-profiles.s3.amazonaws.com/logos/a.png",
			"https://res.cloudinary.com/demo/image/upload/a.jpg",
		])
			expect(isAllowedImage(url, ORIGINS), url).toBe(true);
	});

	it("refuses look-alikes, other subdomains, http, userinfo tricks and a value with no scheme", () => {
		for (const url of [
			"https://endow-profiles.s3.amazonaws.com.evil.io/a.png",
			"https://evil.res.cloudinary.com/a.png",
			"https://other.s3.amazonaws.com/a.png",
			"https://s3.amazonaws.com/a.png",
			"http://endow-profiles.s3.amazonaws.com/a.png",
			"http://res.cloudinary.com/a.png",
			"https://endow-profiles.s3.amazonaws.com@evil.io/a.png",
			"https://res.cloudinary.com:8443/a.png",
			"endow-profiles.s3.amazonaws.com/a.png",
			"res.cloudinary.com/a.png",
			"//res.cloudinary.com/a.png",
		])
			expect(isAllowedImage(url, ORIGINS), url).toBe(false);
	});
});

describe("isAllowedImage scheme", () => {
	it("refuses http even on a wildcard host whose suffix matches", () => {
		expect(
			isAllowedImage("http://x.public.blob.vercel-storage.com/a.png", ORIGINS),
		).toBe(false);
		expect(
			isAllowedImage("https://x.public.blob.vercel-storage.com/a.png", ORIGINS),
		).toBe(true);
	});
});

describe("ImageWithPlaceholder", () => {
	const img = (root: HTMLElement) => root.querySelector("img");
	const placeholder = (root: HTMLElement) =>
		root.querySelector('.image-placeholder[role="img"]');

	it("draws an image on each logo host, with that src", () => {
		for (const src of [
			"https://endow-profiles.s3.amazonaws.com/logos/a.png",
			"https://res.cloudinary.com/demo/image/upload/a.jpg",
		]) {
			const root = mount(
				<ImageWithPlaceholder src={src} alt="Logo" origins={ORIGINS} />,
			);
			expect(img(root)?.getAttribute("src"), src).toBe(src);
			expect(placeholder(root), src).toBeNull();
		}
	});

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
		await vi.waitFor(() => expect(img(root)).toBeNull());
		expect(placeholder(root)).not.toBeNull();
	});
});
