import { expect, test, vi } from "vitest";
import { isLogoUrl, logoPath, logoRoutes } from "./logo";

const SECRET = "logo-test-secret";
const S3 = "https://endow-profiles.s3.amazonaws.com/logos/a.png";
const CLOUDINARY = "https://res.cloudinary.com/demo/image/upload/a.jpg";
const PNG = new Uint8Array([137, 80, 78, 71]);

const image = (type = "image/png", headers: Record<string, string> = {}) =>
	new Response(PNG, { headers: { "content-type": type, ...headers } });

function serve(upstream: () => Promise<Response> | Response) {
	const fetcher = vi.fn(async (_url: unknown, _init?: RequestInit) =>
		upstream(),
	);
	const app = logoRoutes({ secret: SECRET, fetch: fetcher as typeof fetch });
	return { fetcher, get: (path: string) => app.request(path) };
}

const refOf = (url: string, secret = SECRET) => {
	const path = logoPath(secret, url);
	if (!path) throw new Error("not a logo url");
	return path;
};

test("a ref for each logo host fetches that URL and returns the image with its hardening and cache headers", async () => {
	for (const url of [S3, CLOUDINARY]) {
		const { fetcher, get } = serve(() => image());

		const res = await get(refOf(url));

		expect(res.status).toBe(200);
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("cache-control")).toBe(
			"public, max-age=21600, s-maxage=21600, stale-while-revalidate=86400",
		);
		expect(res.headers.get("content-security-policy")).toBe(
			"default-src 'none'",
		);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const [fetched, init] = fetcher.mock.calls[0] ?? [];
		expect(fetched).toBe(url);
		expect(init?.redirect).toBe("manual");
		expect(init?.credentials).toBe("omit");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
		// exact, so a cookie or authorization header added later goes red
		expect(init?.headers).toEqual({
			accept: "image/png, image/jpeg, image/gif, image/webp",
		});
	}
});

test("every image type but SVG is passed on, with its parameters dropped", async () => {
	for (const type of ["image/jpeg", "image/gif", "image/webp"]) {
		const { get } = serve(() => image(`${type}; charset=binary`));
		const res = await get(refOf(S3));
		expect(res.headers.get("content-type")).toBe(type);
	}
});

test("a URL that is not an exact https logo host gets no ref", () => {
	for (const url of [
		"https://endow-profiles.s3.amazonaws.com.evil.io/a.png",
		"https://evil.res.cloudinary.com/a.png",
		"https://other.s3.amazonaws.com/a.png",
		"http://res.cloudinary.com/a.png",
		"https://user:pw@res.cloudinary.com/a.png",
		"https://res.cloudinary.com@evil.io/a.png",
		"https://res.cloudinary.com:8443/a.png",
		"res.cloudinary.com/a.png",
		"https://public.blob.vercel-storage.com/a.png",
	]) {
		expect(isLogoUrl(url), url).toBe(false);
		expect(logoPath(SECRET, url), url).toBeNull();
	}
});

test("a ref nobody signed, or signed for another URL or secret, is a 404 and nothing is fetched", async () => {
	const { fetcher, get } = serve(() => image());
	const [payload, signature] = refOf(S3).slice("/logo/".length).split(".");
	const evil = Buffer.from("https://evil.example/a.png").toString("base64url");

	for (const path of [
		"/logo/garbage",
		"/logo/a.b.c",
		`/logo/${payload}.`,
		`/logo/${payload}.AAAA`,
		`/logo/${evil}.${signature}`,
		refOf(S3, "another-secret"),
	])
		expect((await get(path)).status, path).toBe(404);
	expect(fetcher).not.toHaveBeenCalled();
});

test("a redirect, an upstream error and a network failure answer 502 with no upstream body", async () => {
	for (const upstream of [
		() =>
			new Response("moved", {
				status: 302,
				headers: {
					location: "https://evil.example/a.png",
					"content-type": "image/png",
				},
			}),
		() =>
			new Response("secret upstream page", {
				status: 500,
				headers: { "content-type": "image/png" },
			}),
		() =>
			new Response("nope", {
				status: 404,
				headers: { "content-type": "text/html" },
			}),
		() => {
			throw new TypeError("fetch failed");
		},
	]) {
		const res = await serve(upstream).get(refOf(S3));
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ error: "logo_unavailable" });
	}
});

test("SVG, HTML and a missing content type are refused", async () => {
	for (const type of [
		"image/svg+xml",
		"text/html",
		"application/octet-stream",
		"",
	]) {
		const res = await serve(() => image(type)).get(refOf(S3));
		expect(res.status, type).toBe(502);
	}
});

test("an image over 2 MiB is refused by its length header and by its streamed size", async () => {
	const big = new Uint8Array(2 * 1024 * 1024 + 1);
	const declared = await serve(() =>
		image("image/png", { "content-length": String(big.length) }),
	).get(refOf(S3));
	expect(declared.status).toBe(502);

	const streamed = await serve(
		() => new Response(big, { headers: { "content-type": "image/png" } }),
	).get(refOf(S3));
	expect(streamed.status).toBe(502);
});

const MAX_BYTES = 2 * 1024 * 1024;

/** A body that arrives as one chunk of each size. */
const streamOf = (...sizes: number[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const size of sizes) controller.enqueue(new Uint8Array(size));
			controller.close();
		},
	});

const streamed = (...sizes: number[]) => () =>
	new Response(streamOf(...sizes), { headers: { "content-type": "image/png" } });

test("an image of exactly 2 MiB is served whole, streamed or declared, and one byte more is refused", async () => {
	const whole = await serve(streamed(MAX_BYTES / 2, MAX_BYTES / 2)).get(
		refOf(S3),
	);
	expect(whole.status).toBe(200);
	expect((await whole.arrayBuffer()).byteLength).toBe(MAX_BYTES);

	const declared = await serve(() =>
		image("image/png", { "content-length": String(MAX_BYTES) }),
	).get(refOf(S3));
	expect(declared.status).toBe(200);

	const over = await serve(streamed(MAX_BYTES / 2, MAX_BYTES / 2, 1)).get(
		refOf(S3),
	);
	expect(over.status).toBe(502);
	expect(await over.json()).toEqual({ error: "logo_unavailable" });
});

test("a body that fails partway through, for a reason other than the time limit, answers 502", async () => {
	let pulls = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			pulls += 1;
			if (pulls === 1) controller.enqueue(PNG);
			else controller.error(new TypeError("terminated"));
		},
	});

	const res = await serve(
		() => new Response(body, { headers: { "content-type": "image/png" } }),
	).get(refOf(S3));

	expect(pulls).toBe(2);
	expect(res.status).toBe(502);
	expect(await res.json()).toEqual({ error: "logo_unavailable" });
});

test("a fetch that outlasts the time limit answers 504", async () => {
	const res = await serve(() => {
		throw new DOMException("timed out", "TimeoutError");
	}).get(refOf(S3));
	expect(res.status).toBe(504);
});

test("a time limit that runs out partway through the body answers 504", async () => {
	let pulls = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			pulls += 1;
			if (pulls === 1) controller.enqueue(PNG);
			else controller.error(new DOMException("timed out", "TimeoutError"));
		},
	});

	const res = await serve(
		() => new Response(body, { headers: { "content-type": "image/png" } }),
	).get(refOf(S3));

	expect(pulls).toBe(2);
	expect(res.status).toBe(504);
	expect(await res.json()).toEqual({ error: "logo_timeout" });
});
