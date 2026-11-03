import { readCampaign } from "./campaign-drafts";
import { isStepFailure } from "./campaign-presets";
import { type Body, isBody } from "./read-pages";
import type { LocalCall } from "./spec";

// Setting a campaign's cover from a photo the operator dropped into the chat.
// The one place the connector talks to a deployment outside /connector/v1:
// the upload page a photos.upload_link answer names, and only when that page
// is on the connection's own origin.

/** Platform's cap on an uploaded photo. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

const SIGNATURES: { type: string; matches: (b: Uint8Array) => boolean }[] = [
	{
		type: "image/jpeg",
		matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	},
	{
		type: "image/png",
		matches: (b) =>
			[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
				(byte, i) => b[i] === byte,
			),
	},
	{
		type: "image/webp",
		matches: (b) => text(b, 0, 4) === "RIFF" && text(b, 8, 12) === "WEBP",
	},
];
const text = (b: Uint8Array, from: number, to: number) =>
	String.fromCharCode(...b.slice(from, to));

export type UploadLink = { url: string; expiresAt: string };

export type PhotoOutcome =
	| { uploaded: true; imageUrl: string | null }
	| { uploaded: false; reason: string; link: UploadLink | null };

class Refused extends Error {}

/** The photo's bytes and type, or a Refused saying why not. */
async function download(
	doFetch: typeof fetch,
	downloadUrl: string,
): Promise<{ bytes: Uint8Array; type: string }> {
	let url: URL;
	try {
		url = new URL(downloadUrl);
	} catch {
		throw new Refused("The photo's address isn't a valid link.");
	}
	if (url.protocol !== "https:")
		throw new Refused("The photo's address isn't a secure (https) link.");
	let res: Response;
	try {
		res = await doFetch(url, { redirect: "error" });
	} catch {
		throw new Refused("The photo couldn't be downloaded from the chat.");
	}
	if (!res.ok)
		throw new Refused("The photo couldn't be downloaded from the chat.");
	const tooBig = new Refused("The photo is larger than 4 MB.");
	const declared = Number(res.headers.get("content-length"));
	if (declared > MAX_PHOTO_BYTES) throw tooBig;
	const reader = res.body?.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (reader) {
		const { done, value } = await reader.read().catch(() => {
			throw new Refused("The photo couldn't be downloaded from the chat.");
		});
		if (done) break;
		size += value.byteLength;
		if (size > MAX_PHOTO_BYTES) {
			await reader.cancel();
			throw tooBig;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	const type = SIGNATURES.find((s) => s.matches(bytes))?.type;
	if (type === undefined)
		throw new Refused("The photo isn't a JPEG, PNG or WebP image.");
	return { bytes, type };
}

const OFF_SITE_LINK = "The site's upload page isn't on the connected site.";

/**
 * A fresh single-use link for the campaign's cover, from the site; null when
 * the site's answer names no page on the connection's own origin, which is
 * never handed out.
 */
export async function uploadLink(
	{ connection, client }: Pick<LocalCall, "connection" | "client">,
	campaignId: string,
): Promise<UploadLink | null> {
	const { body } = await client.call(connection, "photos.upload_link", {
		target: { kind: "campaign", id: campaignId },
		slot: "hero",
	});
	const link: Body = isBody(body) ? body : {};
	if (typeof link.url !== "string" || typeof link.expires_at !== "string")
		return null;
	return URL.parse(link.url)?.origin === connection.origin
		? { url: link.url, expiresAt: link.expires_at }
		: null;
}

/**
 * Puts the photo at `downloadUrl` on the campaign as its cover. Any failure
 * before the site takes the photo answers `uploaded: false` with why, and the
 * link for the operator to open themselves, except a link to another origin,
 * which is never handed out.
 */
export async function setCampaignPhoto(
	call: LocalCall,
	campaignId: string,
	downloadUrl: string,
): Promise<PhotoOutcome> {
	let file: Awaited<ReturnType<typeof download>> | null = null;
	let reason = "";
	try {
		file = await download(call.fetch, downloadUrl);
	} catch (error) {
		if (!(error instanceof Refused)) throw error;
		reason = error.message;
	}
	const link = await uploadLink(call, campaignId);
	if (link === null) return { uploaded: false, reason: OFF_SITE_LINK, link };
	if (file === null) return { uploaded: false, reason, link };

	const form = new FormData();
	form.set(
		"photo",
		new Blob([file.bytes as unknown as ArrayBuffer], { type: file.type }),
		"photo",
	);
	let answered: unknown;
	try {
		const res = await call.fetch(new URL(link.url), {
			method: "POST",
			body: form,
			headers: { accept: "application/json" },
			redirect: "manual",
		});
		if (!res.ok)
			return {
				uploaded: false,
				reason: "The site didn't accept the photo.",
				link,
			};
		answered = await res.json().catch(() => null);
	} catch {
		return {
			uploaded: false,
			reason: "The site didn't answer the upload.",
			link,
		};
	}
	const given = isBody(answered) ? answered.url : undefined;
	if (typeof given === "string") return { uploaded: true, imageUrl: given };
	return { uploaded: true, imageUrl: await coverUrl(call, campaignId) };
}

// The upload has landed by now: a read that fails leaves the cover set, its
// address unknown.
async function coverUrl(
	call: LocalCall,
	campaignId: string,
): Promise<string | null> {
	let hero: unknown;
	try {
		hero = (await readCampaign(call, campaignId)).hero;
	} catch (error) {
		if (isStepFailure(error)) return null;
		throw error;
	}
	const url = isBody(hero) ? hero.url : hero;
	return typeof url === "string" ? url : null;
}
