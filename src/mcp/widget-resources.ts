import type { McpServer } from "@modelcontextprotocol/server";
import { WIDGETS } from "../widgets/html";
import { blobOrigin } from "./widget-data";

/** The MIME type MCP Apps hosts render as a widget. */
export const WIDGET_MIME = "text/html;profile=mcp-app";

/** What a widget's resource tells the host about the sandbox it runs in. */
export const widgetMeta = (publicOrigin: string, domain: string) => ({
	ui: {
		// Images and assets only from this service and Vercel Blob; a widget reaches
		// data through tool calls alone, so there are no connect domains.
		csp: { resourceDomains: [publicOrigin, blobOrigin], connectDomains: [] },
		domain,
		prefersBorder: true,
	},
});

/**
 * Registers every widget as an MCP Apps resource, each the HTML its render tool
 * links to. `domain` is the sandbox origin the asking host expects, so the
 * resources are registered per request and never shared between hosts.
 */
export function registerWidgetResources(
	server: McpServer,
	publicOrigin: string,
	domain: string,
): void {
	for (const [name, widget] of Object.entries(WIDGETS)) {
		server.registerResource(
			`better-giving-${name}`,
			widget.uri,
			{ mimeType: WIDGET_MIME, _meta: widgetMeta(publicOrigin, domain) },
			() => ({
				contents: [
					{
						uri: widget.uri,
						mimeType: WIDGET_MIME,
						text: widget.html,
						_meta: widgetMeta(publicOrigin, domain),
					},
				],
			}),
		);
	}
}
