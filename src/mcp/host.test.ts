import { expect, test } from "vitest";
import { callerOf, claudeDomain } from "./host";

// The expected values are the digests of each URL as `sha256sum` prints them,
// the first for the example in Claude's own docs
// (claude.com/docs/connectors/building/mcp-apps/getting-started.md).
test("Claude's domain is the first 32 hex characters of the SHA-256 of the exact server URL", () => {
	expect(claudeDomain("https://example.com/mcp")).toBe(
		"c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com",
	);
	expect(claudeDomain("https://app.connect.better.giving/mcp")).toBe(
		"eb1cc393c78a13943eb6982ef027a638.claudemcpcontent.com",
	);
});

test("a trailing slash is another URL and so another domain", () => {
	expect(claudeDomain("https://example.com/mcp/")).not.toBe(
		claudeDomain("https://example.com/mcp"),
	);
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
	new Request("https://connect.example/mcp", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});

test("a 2025 initialize is told apart by the client's name", async () => {
	const named = (name: string) =>
		callerOf(
			post({
				method: "initialize",
				params: { clientInfo: { name }, capabilities: {} },
			}),
		);

	expect((await named("claude-ai")).host).toBe("claude");
	expect((await named("openai-mcp")).host).toBe("other");
});

test("a request that names no client is told apart by its User-Agent, and one that says nothing is other", async () => {
	const body = { method: "resources/read", params: { uri: "ui://x" } };

	expect(
		(await callerOf(post(body, { "user-agent": "Claude-User" }))).host,
	).toBe("claude");
	expect(
		(await callerOf(post(body, { "user-agent": "openai-mcp/1.0" }))).host,
	).toBe("other");
	expect((await callerOf(post(body))).host).toBe("other");
	expect((await callerOf(post("not json"))).host).toBe("other");
});

// A chunked body, as a client streaming its POST sends it: no content-length.
const streamed = (body: string, headers: Record<string, string> = {}) => {
	const bytes = new TextEncoder().encode(body);
	const chunk = 64 * 1024;
	let offset = 0;
	return new Request("https://connect.example/mcp", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		duplex: "half",
		body: new ReadableStream<Uint8Array>({
			pull(controller) {
				if (offset >= bytes.byteLength) {
					controller.close();
					return;
				}
				controller.enqueue(bytes.slice(offset, offset + chunk));
				offset += chunk;
			},
		}),
	});
};

const TWO_MIB = 2 * 1024 * 1024;
const head = JSON.stringify({
	method: "initialize",
	params: { clientInfo: { name: "claude-ai" } },
	pad: "",
}).slice(0, -2);
const oversized = `${head}${"x".repeat(TWO_MIB - head.length - 2)}"}`;

test("a streamed body past the cap is not read for the client's name", async () => {
	const request = streamed(oversized, { "user-agent": "openai-mcp/1.0" });

	expect(request.headers.get("content-length")).toBeNull();
	expect((await callerOf(request)).host).toBe("other");
});

test("the original body still reads in full after a streamed body past the cap", async () => {
	const request = streamed(oversized, { "user-agent": "openai-mcp/1.0" });
	await callerOf(request);

	const text = await request.text();
	expect(text.length).toBe(2_097_152);
	expect(text).toBe(oversized);
});

test("a streamed body under the cap is read for the client's name", async () => {
	const caller = await callerOf(
		streamed(
			JSON.stringify({
				method: "initialize",
				params: { clientInfo: { name: "claude-ai" } },
			}),
			{ "user-agent": "openai-mcp/1.0" },
		),
	);

	expect(caller.host).toBe("claude");
});

test("a body that is not JSON falls back to the User-Agent", async () => {
	expect(
		(await callerOf(post("not json", { "user-agent": "Claude-User" }))).host,
	).toBe("claude");
});

test("the client's own name beats the User-Agent", async () => {
	const caller = await callerOf(
		post(
			{ method: "x", params: { clientInfo: { name: "openai-mcp" } } },
			{ "user-agent": "Claude-User" },
		),
	);

	expect(caller.host).toBe("other");
});
