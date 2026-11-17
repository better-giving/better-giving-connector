import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";

// Older nonprofits keep their logo on one of two image hosts. A widget's CSP
// may not name either (its resourceDomains also cover scripts and styles), so
// the card draws `/logo/<ref>` from this origin and this route fetches the
// image. The ref is signed by this service over a URL it read from the
// deployment: the route never fetches a URL a caller chose.

/**
 * Cloudinary is shared by every customer, so only the one account older logos
 * live under is fetched; the other bucket's host is ours alone.
 */
const CLOUDINARY_ACCOUNT_PREFIX = "/everydotorg/";

/** The exact hosts a logo is fetched from, each with the path prefix it is limited to. */
const LOGO_HOSTS: ReadonlyMap<string, string> = new Map([
	["endow-profiles.s3.amazonaws.com", "/"],
	["res.cloudinary.com", CLOUDINARY_ACCOUNT_PREFIX],
]);
const IMAGE_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);
const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
/** Six hours: a logo changes rarely, and a card draws it on every open. */
const CACHE_SECONDS = 6 * 60 * 60;
/** A day: a stale logo beats initials while the edge refetches it. */
const STALE_SECONDS = 24 * 60 * 60;

/**
 * `url` is https on a logo host, with no userinfo and no port, and its parsed
 * path (dot segments already resolved, encoded slashes left encoded) starts
 * with that host's prefix.
 */
export function isLogoUrl(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const prefix = LOGO_HOSTS.get(parsed.hostname);
	return (
		prefix !== undefined &&
		parsed.protocol === "https:" &&
		parsed.username === "" &&
		parsed.password === "" &&
		parsed.port === "" &&
		parsed.pathname.startsWith(prefix)
	);
}

const sign = (secret: string, payload: string) =>
	createHmac("sha256", secret).update(payload).digest("base64url");

/** The path a card draws a logo from, or null when `url` is not on a logo host. */
export function logoPath(secret: string, url: string): string | null {
	if (!isLogoUrl(url)) return null;
	const payload = Buffer.from(url).toString("base64url");
	return `/logo/${payload}.${sign(secret, payload)}`;
}

/** The URL a ref was signed over, or null for a ref this service didn't sign. */
function urlOfRef(secret: string, ref: string): string | null {
	const [payload, signature, ...extra] = ref.split(".");
	if (!payload || !signature || extra.length > 0) return null;
	const expected = Buffer.from(sign(secret, payload));
	const given = Buffer.from(signature);
	if (given.length !== expected.length || !timingSafeEqual(given, expected))
		return null;
	const url = Buffer.from(payload, "base64url").toString();
	return isLogoUrl(url) ? url : null;
}

const refused = (status: 404 | 502 | 504, error: string) =>
	new Response(JSON.stringify({ error }), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
		},
	});

/** The fetch's timeout signal errors the body stream too, so both phases map here. */
const fetchFailed = (error: unknown) =>
	error instanceof Error && error.name === "TimeoutError"
		? refused(504, "logo_timeout")
		: refused(502, "logo_unavailable");

/** Reads at most MAX_BYTES; null when the body is longer. */
async function readCapped(body: ReadableStream<Uint8Array>) {
	const chunks: Uint8Array[] = [];
	let size = 0;
	for await (const chunk of body) {
		size += chunk.byteLength;
		if (size > MAX_BYTES) return null;
		chunks.push(chunk);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

export function logoRoutes(deps: {
	secret: string;
	fetch: typeof fetch;
}): Hono {
	const app = new Hono();
	app.get("/logo/:ref", async (c) => {
		const url = urlOfRef(deps.secret, c.req.param("ref"));
		if (!url) return refused(404, "not_found");
		let upstream: Response;
		try {
			upstream = await deps.fetch(url, {
				redirect: "manual",
				credentials: "omit",
				headers: { accept: [...IMAGE_TYPES].join(", ") },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch (error) {
			return fetchFailed(error);
		}
		const type = upstream.headers
			.get("content-type")
			?.split(";")[0]
			?.trim()
			.toLowerCase();
		const length = Number(upstream.headers.get("content-length") ?? 0);
		if (
			upstream.status !== 200 ||
			!type ||
			!IMAGE_TYPES.has(type) ||
			length > MAX_BYTES ||
			!upstream.body
		) {
			await upstream.body?.cancel().catch(() => undefined);
			return refused(502, "logo_unavailable");
		}
		let bytes: Uint8Array<ArrayBuffer> | null;
		try {
			bytes = await readCapped(upstream.body);
		} catch (error) {
			return fetchFailed(error);
		}
		if (!bytes) return refused(502, "logo_unavailable");
		return new Response(bytes, {
			headers: {
				"content-type": type,
				"x-content-type-options": "nosniff",
				// Vercel's CDN caches a function response only with s-maxage. Not
				// immutable: a ref names a URL, and the image behind it can change.
				"cache-control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
				"content-security-policy": "default-src 'none'",
			},
		});
	});
	return app;
}
