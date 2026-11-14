import { createHash } from "node:crypto";
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
} from "@modelcontextprotocol/server";

const MCP_APPS = "io.modelcontextprotocol/ui";
const MCP_APP_MIME = "text/html;profile=mcp-app";
// Past this a body is not read for who sent it; the SDK reads it for the call.
const MAX_SNIFFED_BYTES = 1024 * 1024;

/** The chat app a request comes from, as far as the request itself says. */
export type Caller = {
	/** "other" is ChatGPT, any other host and one that said nothing. */
	host: "claude" | "other";
	/**
	 * Whether the client renders MCP Apps, as a 2026-07-28 request declares in
	 * its envelope; null for a 2025 request, whose capabilities came with an
	 * initialize this per-request server never saw.
	 */
	rendersApps: boolean | null;
};

/**
 * Claude's `_meta.ui.domain` for a connector: the first 32 hex characters of
 * the SHA-256 of the exact URL the user added in Claude, then
 * `.claudemcpcontent.com`
 * (claude.com/docs/connectors/building/mcp-apps/getting-started.md).
 */
export const claudeDomain = (serverUrl: string): string =>
	`${createHash("sha256").update(serverUrl).digest("hex").slice(0, 32)}.claudemcpcontent.com`;

/** Whether the declared capabilities in a request's `_meta` include MCP Apps. */
export function rendersApps(envelope: object | undefined): boolean | null {
	if (envelope === undefined || !(CLIENT_CAPABILITIES_META_KEY in envelope))
		return null;
	const declared = (envelope as Record<string, unknown>)[
		CLIENT_CAPABILITIES_META_KEY
	] as { extensions?: Record<string, { mimeTypes?: unknown }> } | undefined;
	const mimeTypes = declared?.extensions?.[MCP_APPS]?.mimeTypes;
	return Array.isArray(mimeTypes) && mimeTypes.includes(MCP_APP_MIME);
}

const isClaude = (name: unknown) =>
	typeof name === "string" && /claude/i.test(name);

/**
 * Who sent a request. The name the client gives itself wins: a 2026-07-28
 * request carries `clientInfo` in its `_meta`, a 2025 initialize in its
 * params. A 2025 request after the initialize carries neither (the server
 * keeps no session), so the User-Agent is read then. A request that names no
 * Claude is "other", which keeps every value the server gave before it knew
 * hosts apart. Reads a clone; the body is the SDK's to read.
 */
export async function callerOf(request: Request): Promise<Caller> {
	const agent = request.headers.get("user-agent");
	let message: unknown;
	try {
		const length = Number(request.headers.get("content-length") ?? 0);
		if (length <= MAX_SNIFFED_BYTES) {
			message = JSON.parse(await request.clone().text());
		}
	} catch {
		message = undefined;
	}
	const params = (message as { params?: Record<string, unknown> } | null)
		?.params;
	const meta =
		params && typeof params._meta === "object" && params._meta !== null
			? (params._meta as Record<string, unknown>)
			: undefined;
	const named = (meta?.[CLIENT_INFO_META_KEY] ?? params?.clientInfo) as
		| { name?: unknown }
		| undefined;
	const claude =
		named?.name !== undefined ? isClaude(named.name) : isClaude(agent);
	return { host: claude ? "claude" : "other", rendersApps: rendersApps(meta) };
}
