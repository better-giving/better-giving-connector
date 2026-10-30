import { expect, test } from "vitest";
import { chatClientOf } from "./chat-client";
import { CHAT_APP_REDIRECT_URIS } from "./redirect-uris";

test.each([
	["https://chatgpt.com/connector_platform_oauth_redirect", "chatgpt"],
	["https://chatgpt.com/connector/oauth/AbC_12-x", "chatgpt"],
	["https://auth.chatgpt.com/cb", "chatgpt"],
	["https://openai.com/cb", "chatgpt"],
	["https://platform.openai.com/cb", "chatgpt"],
	["https://claude.ai/api/mcp/auth_callback", "claude"],
	["https://www.claude.ai/cb", "claude"],
	["https://claude.com/cb", "claude"],
	["https://anthropic.com/cb", "claude"],
	["https://console.anthropic.com/cb", "claude"],
	["https://CHATGPT.COM/cb", "chatgpt"],
] as const)("a redirect_uri at %s is %s", (redirectUri, client) => {
	expect(chatClientOf("a-dcr-client-id", redirectUri)).toBe(client);
});

test.each(CHAT_APP_REDIRECT_URIS)(
	"the allow-listed callback %s names a client",
	(callback) => {
		const redirectUri = callback.replace("{callback_id}", "AbC_12-x");

		expect(chatClientOf("a-dcr-client-id", redirectUri)).not.toBeNull();
	},
);

test.each([
	"https://evilchatgpt.com/cb",
	"https://chatgpt.com.evil.example/cb",
	"https://chatgpt.com-evil.example/cb",
	"https://notclaude.ai/cb",
	"https://claude.ai.evil.example/cb",
	"https://evil.example/chatgpt.com/cb",
	"https://evil.example/cb?redirect=https://claude.ai",
	"https://claude.ai@evil.example/cb",
	"https://chatgpt.com./cb",
	"https://give.example.org/cb",
	"not a url",
	"",
])("a redirect_uri at %s names no client", (redirectUri) => {
	expect(chatClientOf("a-dcr-client-id", redirectUri)).toBeNull();
});

test("no client_id and no redirect_uri names no client", () => {
	expect(chatClientOf(null, null)).toBeNull();
});

test("a CIMD client_id is read by its own host, not its redirect_uri", () => {
	expect(
		chatClientOf(
			"https://claude.ai/oauth/mcp-oauth-client-metadata",
			"https://chatgpt.com/connector_platform_oauth_redirect",
		),
	).toBe("claude");
	expect(
		chatClientOf(
			"https://evil.example/claude.ai",
			"https://claude.ai/api/mcp/auth_callback",
		),
	).toBeNull();
});

test("a client_id that isn't an https URL falls back to the redirect_uri", () => {
	expect(
		chatClientOf(
			"http://claude.ai/metadata",
			"https://chatgpt.com/connector_platform_oauth_redirect",
		),
	).toBe("chatgpt");
});
