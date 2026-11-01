/** @jsxImportSource hono/jsx/dom */
// Placeholder entry so html.ts can bundle every widget; the Campaign editor builder replaces it.
import { CampaignEditorData } from "../model";
import { EmptyState } from "../ui/states";
import { startWidget } from "../ui/widget";

void startWidget(
	CampaignEditorData,
	() => <EmptyState title="Campaign editor isn't built yet" />,
	"Loading…",
);
