import { describe, expect, test } from "vitest";
import { Unreachable } from "../deployment";
import { MAX_PHOTO_BYTES, setCampaignPhoto } from "./photo-upload";
import { type LocalCall, ToolRefusal } from "./spec";
import { WIDGET_TOOLS } from "./widget-tools";

const ORIGIN = "https://hopeshelter.org";
const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

type Seen = { url: string; method: string; accept: string | null };

function setup(options: {
	linkUrl?: string;
	link?: Record<string, unknown>;
	file?: () => Response;
	upload?: () => Response;
	/** The address that answers a redirect, which the stub follows or refuses as the caller's `redirect` option says. */
	redirects?: "download" | "upload";
	/** How campaigns.get answers the read after the upload. */
	campaign?: () => Record<string, unknown>;
}) {
	const actions: string[] = [];
	const seen: Seen[] = [];
	const redirects: RequestInit["redirect"][] = [];
	const fetchStub = (async (input: URL | string, init?: RequestInit) => {
		const url = String(input);
		const onUpload = url.startsWith(`${ORIGIN}/photo-upload/`);
		if (options.redirects === (onUpload ? "upload" : "download")) {
			redirects.push(init?.redirect);
			if (init?.redirect === "error") throw new TypeError("redirect");
			if (init?.redirect === "manual")
				return new Response(null, {
					status: 302,
					headers: { location: "https://evil.example/" },
				});
		}
		seen.push({
			url,
			method: init?.method ?? "GET",
			accept: new Headers(init?.headers).get("accept"),
		});
		if (onUpload)
			return options.upload?.() ?? Response.json({ url: "https://cdn/x.png" });
		return options.file?.() ?? new Response(PNG);
	}) as typeof fetch;
	const call = {
		connection: { origin: ORIGIN },
		client: {
			call: async (_c: unknown, action: string) => {
				actions.push(action);
				return {
					body:
						action === "photos.upload_link"
							? (options.link ?? {
									url: options.linkUrl ?? `${ORIGIN}/photo-upload/tok`,
									expires_at: "2031-04-02T10:15:00Z",
								})
							: (options.campaign?.() ?? { id: "cmp_1" }),
				};
			},
		},
		fetch: fetchStub,
	} as unknown as LocalCall;
	return { call, seen, redirects, actions };
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

	test.each([
		["on another port", `${ORIGIN}:8443/photo-upload/tok`],
		["over http", "http://hopeshelter.org/photo-upload/tok"],
		["on a subdomain", "https://evil.hopeshelter.org/photo-upload/tok"],
	])(
		"never posts to an upload link %s of the connected site",
		async (_, linkUrl) => {
			const { call, seen } = setup({ linkUrl });

			const outcome = await setCampaignPhoto(call, "cmp_1", photo);

			expect(outcome).toMatchObject({ uploaded: false, link: null });
			expect(seen.some((s) => s.method === "POST")).toBe(false);
		},
	);

	test("refuses a photo address that redirects rather than follow it", async () => {
		const { call, seen, redirects } = setup({ redirects: "download" });

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			reason: "The photo couldn't be downloaded from the chat.",
		});
		expect(redirects[0]).toBe("error");
		expect(seen.some((s) => s.method === "POST")).toBe(false);
	});

	test("does not follow a redirect from the upload page, and hands back the link", async () => {
		const { call, redirects } = setup({ redirects: "upload" });

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			reason: "The site didn't accept the photo.",
			link: { url: `${ORIGIN}/photo-upload/tok` },
		});
		expect(redirects).toEqual(["manual"]);
	});

	test("refuses a streamed photo that outgrows the cap with no length declared, and stops reading it", async () => {
		let cancelled = false;
		const chunk = new Uint8Array(MAX_PHOTO_BYTES / 2 + 1);
		const { call } = setup({
			file: () =>
				new Response(
					new ReadableStream({
						pull(controller) {
							controller.enqueue(chunk);
						},
						cancel() {
							cancelled = true;
						},
					}),
				),
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			reason: "The photo is larger than 4 MB.",
		});
		expect(cancelled).toBe(true);
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

	test("takes the cover's address from the upload answer without reading the campaign again", async () => {
		const { call, actions } = setup({});

		await setCampaignPhoto(call, "cmp_1", photo);

		expect(actions).toEqual(["photos.upload_link"]);
	});

	test("reads the cover's address from the campaign when the upload answer has none", async () => {
		const { call } = setup({
			upload: () => Response.json({}),
			campaign: () => ({ id: "cmp_1", hero: { url: "https://cdn/hero.png" } }),
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toEqual({
			uploaded: true,
			imageUrl: "https://cdn/hero.png",
		});
	});

	test("an upload the site took is still reported set when the campaign read after it fails", async () => {
		const { call } = setup({
			upload: () => Response.json({}),
			campaign: () => {
				throw new Unreachable();
			},
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toEqual({ uploaded: true, imageUrl: null });
	});

	test("a photo whose download breaks off midway is refused with the link, not failed as the site's fault", async () => {
		const { call } = setup({
			file: () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(PNG);
							controller.error(new TypeError("terminated"));
						},
					}),
				),
		});

		const outcome = await setCampaignPhoto(call, "cmp_1", photo);

		expect(outcome).toMatchObject({
			uploaded: false,
			reason: "The photo couldn't be downloaded from the chat.",
			link: { url: `${ORIGIN}/photo-upload/tok` },
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

describe("the photo card's upload link", () => {
	const linkFor = (call: LocalCall) =>
		WIDGET_TOOLS.find((s) => s.tool === "app_photo_upload_link")?.run({
			...call,
			input: { id: "cmp_1" },
		});

	test("hands out the site's own upload page", async () => {
		const { call } = setup({});

		expect((await linkFor(call))?.structured).toEqual({
			url: `${ORIGIN}/photo-upload/tok`,
			expiresAt: "2031-04-02T10:15:00Z",
		});
	});

	test("refuses a link on another origin rather than hand it to the card", async () => {
		const { call } = setup({ linkUrl: "https://evil.example/photo-upload/t" });

		const outcome = linkFor(call);

		await expect(outcome).rejects.toThrow(ToolRefusal);
		await expect(outcome).rejects.toMatchObject({
			text: "The site's upload page isn't on the connected site, so no link was made.",
		});
	});

	test("refuses an answer with no link, never answering the word undefined", async () => {
		const { call } = setup({ link: { expires_at: "2031-04-02T10:15:00Z" } });

		await expect(linkFor(call)).rejects.toThrow(ToolRefusal);
	});
});
