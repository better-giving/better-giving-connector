import { describe, expect, test } from "vitest";
import { MAX_PHOTO_BYTES, setCampaignPhoto } from "./photo-upload";
import type { LocalCall } from "./spec";

const ORIGIN = "https://hopeshelter.org";
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

type Seen = { url: string; method: string; accept: string | null };

function setup(options: {
	linkUrl?: string;
	file?: () => Response;
	upload?: () => Response;
}) {
	const seen: Seen[] = [];
	const fetchStub = (async (input: URL | string, init?: RequestInit) => {
		const url = String(input);
		seen.push({
			url,
			method: init?.method ?? "GET",
			accept: new Headers(init?.headers).get("accept"),
		});
		if (url.startsWith(`${ORIGIN}/photo-upload/`))
			return options.upload?.() ?? Response.json({ url: "https://cdn/x.png" });
		return options.file?.() ?? new Response(PNG);
	}) as typeof fetch;
	const call = {
		connection: { origin: ORIGIN },
		client: {
			call: async (_c: unknown, action: string) => ({
				body:
					action === "photos.upload_link"
						? {
								url: options.linkUrl ?? `${ORIGIN}/photo-upload/tok`,
								expires_at: "2031-04-02T10:15:00Z",
							}
						: { id: "cmp_1" },
			}),
		},
		fetch: fetchStub,
	} as unknown as LocalCall;
	return { call, seen };
}

const photo = "https://files.example.org/p.png";

describe("setCampaignPhoto", () => {
	test("uploads the photo to the site's own upload page, asking for JSON", async () => {
		const { call, seen } = setup({});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toEqual({ uploaded: true, imageUrl: "https://cdn/x.png" });
		expect(seen.at(-1)).toEqual({
			url: `${ORIGIN}/photo-upload/tok`,
			method: "POST",
			accept: "application/json",
		});
	});

	test("never posts to an upload link on another origin", async () => {
		const { call, seen } = setup({
			linkUrl: "https://evil.example/photo-upload/t",
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({ uploaded: false, link: null });
		expect(seen.some((s) => s.method === "POST")).toBe(false);
	});

	test("refuses an address that isn't https, without downloading it", async () => {
		const { call, seen } = setup({});

		const outcome = await setCampaignPhoto(call, "cmp_1", "http://files/p.png");

		expect(outcome).toMatchObject({ uploaded: false });
		expect(seen.some((s) => s.url.startsWith("http://"))).toBe(false);
	});

	test("refuses a photo over the size cap and hands back the link", async () => {
		const { call, seen } = setup({
			file: () =>
				new Response(PNG, {
					headers: { "content-length": String(MAX_PHOTO_BYTES + 1) },
				}),
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			reason: "The photo is larger than 4 MB.",
			link: { url: `${ORIGIN}/photo-upload/tok` },
		});
		expect(seen.some((s) => s.method === "POST")).toBe(false);
	});

	test("refuses a file that isn't JPEG, PNG or WebP whatever it is called", async () => {
		const { call } = setup({ file: () => new Response("<html>not a photo") });

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			reason: "The photo isn't a JPEG, PNG or WebP image.",
		});
	});

	test("returns the link when the site refuses the upload", async () => {
		const { call } = setup({
			upload: () => new Response("no", { status: 413 }),
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			link: { url: `${ORIGIN}/photo-upload/tok` },
		});
	});
});
