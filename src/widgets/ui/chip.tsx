/** @jsxImportSource hono/jsx/dom */
import type { CampaignStatus } from "../model";

const LABEL: Record<CampaignStatus, string> = {
	draft: "Draft",
	published: "Live",
	ended: "Ended",
};

export function StatusChip(props: { status: CampaignStatus }) {
	return <span class={`chip chip-${props.status}`}>{LABEL[props.status]}</span>;
}
