/** @jsxImportSource hono/jsx/dom */
// Placeholder entry so html.ts can bundle every widget; the Campaign results builder replaces it.
import { CampaignResultsData } from "../model";
import { EmptyState } from "../ui/states";
import { startWidget } from "../ui/widget";

void startWidget(
	CampaignResultsData,
	() => <EmptyState title="Campaign results isn't built yet" />,
	"Loading…",
);
