/// <reference path="../widgets.d.ts" />
// Every widget as the complete HTML document an MCP Apps host renders, under
// the resource URI its render tool links to.
import campaignCreate from "./campaign-create/index.tsx?widget";
import campaignEditor from "./campaign-editor/index.tsx?widget";
import campaignResults from "./campaign-results/index.tsx?widget";
import campaigns from "./campaigns/index.tsx?widget";
import type { WidgetName } from "./model";
import photo from "./photo/index.tsx?widget";

export type WidgetResource = {
	uri: `ui://better-giving/${string}.html`;
	html: string;
};

const resource = (name: WidgetName, html: string): WidgetResource => ({
	uri: `ui://better-giving/${name}.html`,
	html,
});

export const WIDGETS: Record<WidgetName, WidgetResource> = {
	"campaign-create": resource("campaign-create", campaignCreate),
	campaigns: resource("campaigns", campaigns),
	"campaign-results": resource("campaign-results", campaignResults),
	"campaign-editor": resource("campaign-editor", campaignEditor),
	photo: resource("photo", photo),
};
