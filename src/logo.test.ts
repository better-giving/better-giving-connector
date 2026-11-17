import { createHmac } from "node:crypto";
import { expect, test, vi } from "vitest";
import { isLogoUrl, logoPath, logoRoutes } from "./logo";

const SECRET = "logo-test-secret";
const S3 = "https://endow-profiles.s3.amazonaws.com/logos/a.png";
const CLOUDINARY = "https://res.cloudinary.com/everydotorg/image/upload/a.jpg";
const PNG = new Uint8Array([137, 80, 78, 71]);

const image = (type = "image/png", headers: Record<string, string> = {}) =>
	new Response(PNG, { headers: { "content-type": type, ...headers } });

function serve(upstream: (init?: RequestInit) => Promise<Response> | Response) {
	const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
		upstream(init),
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

const refusedPaths = [
	"/everydotorg/../other/a.png",
	"/everydotorg%2f..%2fother/a.png",
	"/everydotorg.evil/a.png",
	"/EveryDotOrg/a.png",
	"/other/a.png",
	"/everydotorg",
	"/everydotorg/",
	"/everydotorg/a.png",
	"/everydotorg/image/fetch/https://x.example/a.png",
	"/everydotorg/raw/upload/a.png",
	"/everydotorg/image/upload",
	"/everydotorg/image/upload/../fetch/a.png",
	"/everydotorg/image/upload/%2e%2e/fetch/a.png",
	"/everydotorg/image/upload/.%2E/fetch/a.png",
	"/everydotorg/image/upload\\..\\fetch/a.png",
	"/everydotorg/image/uploaded/a.png",
	"/other?/everydotorg/image/upload/a.png",
	"/other#/everydotorg/image/upload/a.png",
];

/** A ref with a valid signature over any URL, made as src/logo.ts signs: HMAC-SHA256 of the base64url payload. */
const signedRef = (url: string) => {
	const payload = Buffer.from(url).toString("base64url");
	const signature = createHmac("sha256", SECRET)
		.update(payload)
		.digest("base64url");
	return `/logo/${payload}.${signature}`;
};

test("Cloudinary is limited to the /everydotorg/image/upload/ path, parsed as a browser would", async () => {
	for (const path of refusedPaths) {
		const url = `https://res.cloudinary.com${path}`;
		expect(isLogoUrl(url), url).toBe(false);
		expect(logoPath(SECRET, url), url).toBeNull();
	}
	const ok = "https://res.cloudinary.com/everydotorg/image/upload/a.jpg";
	expect(isLogoUrl(ok)).toBe(true);
	expect(
		isLogoUrl(
			"https://res.cloudinary.com/everydotorg/image/upload/w_100,h_100/v1/dir/a.jpg",
		),
	).toBe(true);
	expect(
		isLogoUrl("https://endow-profiles.s3.amazonaws.com/any/path.png"),
	).toBe(true);

	// a ref validly signed over a URL outside the limit is refused when served
	const { fetcher, get } = serve(() => image());
	for (const path of refusedPaths) {
		const url = `https://res.cloudinary.com${path}`;
		expect((await get(signedRef(url))).status, url).toBe(404);
	}
	expect(fetcher).not.toHaveBeenCalled();

	// the same forging on a URL inside the limit is served, so the 404s above
	// come from the URL check and not from a signature this test got wrong
	expect((await get(signedRef(CLOUDINARY))).status).toBe(200);
	expect(fetcher.mock.calls[0]?.[0]).toBe(CLOUDINARY);
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

const streamed =
	(...sizes: number[]) =>
	() =>
		new Response(streamOf(...sizes), {
			headers: { "content-type": "image/png" },
		});

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

const TIME_LIMIT_MS = 5000;

/**
 * Serves one logo on a fake clock and reports whether it had answered one
 * millisecond before the limit. `AbortSignal.timeout` runs on the platform's
 * own timer, so it is replaced by one that fires from the fake `setTimeout`
 * with the same `TimeoutError` reason; the upstream reacts to that signal.
 */
async function serveOnFakeClock(
	upstream: (signal: AbortSignal) => Promise<Response> | Response,
) {
	vi.useFakeTimers({ toFake: ["setTimeout"] });
	vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
		const controller = new AbortController();
		setTimeout(
			() => controller.abort(new DOMException("timed out", "TimeoutError")),
			ms,
		);
		return controller.signal;
	});
	try {
		const { get } = serve((init) => upstream(init?.signal as AbortSignal));
		let answered = false;
		const pending = Promise.resolve(get(refOf(S3)));
		const watched = pending.then(() => {
			answered = true;
		});
		await vi.advanceTimersByTimeAsync(TIME_LIMIT_MS - 1);
		const answeredEarly = answered;
		await vi.advanceTimersByTimeAsync(1);
		await watched;
		return { answeredEarly, res: await pending };
	} finally {
		vi.useRealTimers();
		vi.restoreAllMocks();
	}
}

test("a fetch still pending at 5 seconds answers 504, and not before", async () => {
	const { answeredEarly, res } = await serveOnFakeClock(
		(signal) =>
			new Promise<Response>((_, reject) =>
				signal.addEventListener("abort", () => reject(signal.reason)),
			),
	);

	expect(answeredEarly).toBe(false);
	expect(res.status).toBe(504);
	expect(await res.json()).toEqual({ error: "logo_timeout" });
});

test("a body still streaming at 5 seconds answers 504, and not before", async () => {
	const { answeredEarly, res } = await serveOnFakeClock(
		(signal) =>
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(PNG);
						signal.addEventListener("abort", () =>
							controller.error(signal.reason),
						);
					},
				}),
				{ headers: { "content-type": "image/png" } },
			),
	);

	expect(answeredEarly).toBe(false);
	expect(res.status).toBe(504);
	expect(await res.json()).toEqual({ error: "logo_timeout" });
});
