/** @jsxImportSource hono/jsx/dom */
import { CampaignCreateData } from "../model";
import { startWidget } from "../ui/widget";
import { CampaignCreate } from "./create";

void startWidget(
	CampaignCreateData,
	CampaignCreate,
	"Loading campaign presets…",
);
