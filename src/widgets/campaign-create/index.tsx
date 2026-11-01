/** @jsxImportSource hono/jsx/dom */
// Placeholder entry so html.ts can bundle every widget; the Campaign create builder replaces it.
import { CampaignCreateData } from "../model";
import { EmptyState } from "../ui/states";
import { startWidget } from "../ui/widget";

void startWidget(
	CampaignCreateData,
	() => <EmptyState title="Campaign create isn't built yet" />,
	"Loading…",
);
