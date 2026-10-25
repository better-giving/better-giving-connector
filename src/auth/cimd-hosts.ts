// The hosts a CIMD `client_id` URL may live on. A Client ID Metadata Document
// is fetched from the `client_id` URL itself, so this list is what the server
// is willing to reach out to. Claude's custom-connector sign-in sends
// `https://claude.ai/oauth/mcp-oauth-client-metadata`; the other hosts cover
// Claude's sibling domains. ChatGPT is not here: it registers through DCR and
// publishes no CIMD host.
const CIMD_CLIENT_ID_HOSTS: ReadonlySet<string> = new Set([
	"claude.ai",
	"claude.com",
	"anthropic.com",
]);

// The pre-fetch gate for `cimd`: an https URL whose host is one of the above.
// The plugin still runs the CIMD draft's own URL checks and the SSRF-safe
// transport after this; this only narrows which origins are ever contacted.
// A host must match exactly, so `claude.ai.evil.example` is refused.
export function isCimdClientIdAllowed(clientIdUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(clientIdUrl);
	} catch {
		return false;
	}
	return url.protocol === "https:" && CIMD_CLIENT_ID_HOSTS.has(url.hostname);
}
