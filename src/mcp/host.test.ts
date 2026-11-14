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

test("the client's own name beats the User-Agent", async () => {
	const caller = await callerOf(
		post(
			{ method: "x", params: { clientInfo: { name: "openai-mcp" } } },
			{ "user-agent": "Claude-User" },
		),
	);

	expect(caller.host).toBe("other");
});
