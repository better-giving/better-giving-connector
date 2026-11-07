/** @jsxImportSource hono/jsx/dom */
import type { CampaignStatus } from "../model";

const LABEL: Record<CampaignStatus, string> = {
	draft: "Draft",
	published: "Live",
	ended: "Ended",
};

// the registry's badge variants
const VARIANT: Record<CampaignStatus, "warning" | "success" | "neutral"> = {
	draft: "warning",
	published: "success",
	ended: "neutral",
};

export function StatusBadge(props: { status: CampaignStatus }) {
	return (
		<span class={`ds-badge ds-badge-${VARIANT[props.status]}`}>
			{LABEL[props.status]}
		</span>
	);
}
