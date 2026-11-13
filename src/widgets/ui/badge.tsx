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

// An ended campaign is the registry's outline badge. The outline takes no
// `ds-badge-on-photo`, so on an image the ended chip stays the neutral one.
function badgeClass(status: CampaignStatus, onPhoto: boolean): string {
	if (onPhoto) return `ds-badge ds-badge-${VARIANT[status]} ds-badge-on-photo`;
	if (status === "ended") return "ds-badge ds-badge-outline";
	return `ds-badge ds-badge-${VARIANT[status]}`;
}

export function StatusBadge(props: {
	status: CampaignStatus;
	onPhoto?: boolean;
}) {
	return (
		<span class={badgeClass(props.status, props.onPhoto === true)}>
			{LABEL[props.status]}
		</span>
	);
}
