import type { ChatClient } from "../deployment";

// Each chat app's own domains; a host is one of them or a subdomain of one.
const DOMAINS: ReadonlyArray<readonly [string, ChatClient]> = [
	["chatgpt.com", "chatgpt"],
	["openai.com", "chatgpt"],
	["claude.ai", "claude"],
	["claude.com", "claude"],
	["anthropic.com", "claude"],
];

const hostOf = (url: string): string | null => {
	try {
		return new URL(url).hostname;
	} catch {
		return null;
	}
};

const clientOfHost = (host: string): ChatClient | null =>
	DOMAINS.find(
		([domain]) => host === domain || host.endsWith(`.${domain}`),
	)?.[1] ?? null;

/**
 * Which chat app an authorize request comes from, for Allow's label and logo:
 * a CIMD `client_id` (an https URL) by its own host, any other client by its
 * `redirect_uri`, which oauth-provider has matched to the client's
 * registration before the request is signed. Null for any other host, or one
 * that doesn't parse.
 */
export function chatClientOf(
	clientId: string | null,
	redirectUri: string | null,
): ChatClient | null {
	const cimd = clientId?.startsWith("https://") ? clientId : null;
	const host = hostOf(cimd ?? redirectUri ?? "");
	return host === null ? null : clientOfHost(host);
}
