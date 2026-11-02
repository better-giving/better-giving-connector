/** @jsxImportSource hono/jsx/dom */
import { useState } from "hono/jsx/dom";
import type { CampaignCard, CampaignsData } from "../model";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { StatusChip } from "../ui/chip";
import { ImageWithPlaceholder } from "../ui/image";
import { ProgressBar, percentOf } from "../ui/progress";
import { EmptyState } from "../ui/states";
import { useDate, useWholeMoney } from "../ui/text";
import { useLocale, useSession } from "../ui/widget";
import "./carousel.css";

const NOT_SENT =
	"Couldn't ask the chat for that. Ask for the campaign by name instead.";

/** What the card's one button asks the chat to show next. */
function followUp(campaign: CampaignCard) {
	return campaign.status === "draft"
		? {
				label: "Open draft",
				prompt: `Open the editor for the draft campaign "${campaign.title}" (id ${campaign.id}).`,
			}
		: {
				label: "View results",
				prompt: `Show the results for the campaign "${campaign.title}" (id ${campaign.id}).`,
			};
}

function useMeta() {
	const date = useDate();
	const count = new Intl.NumberFormat(useLocale());
	return (campaign: CampaignCard) => {
		const parts: string[] = [];
		if (campaign.endDate) {
			const when = date(campaign.endDate);
			parts.push(
				campaign.status === "ended" ? `Ended ${when}` : `Ends ${when}`,
			);
		} else if (campaign.status !== "ended") {
			parts.push("No end date");
		}
		if (campaign.status === "draft") parts.push("Not published yet");
		else
			parts.push(
				`${count.format(campaign.donors)} ${campaign.donors === 1 ? "donor" : "donors"}`,
			);
		return parts.join(" · ");
	};
}

function CampaignTile(props: {
	campaign: CampaignCard;
	imageOrigins: readonly string[];
	/** Never rejects: a failure shows as the carousel's notice. */
	onFollowUp: (prompt: string) => Promise<void>;
}) {
	const { campaign } = props;
	const money = useWholeMoney();
	const meta = useMeta();
	const [busy, setBusy] = useState(false);
	const percent = percentOf(campaign.raised, campaign.goal);
	const action = followUp(campaign);
	const titleId = `campaign-${campaign.id}`;
	return (
		<li class="campaign-slot">
			<Card
				class="campaign"
				media={
					<div class="campaign-media">
						<ImageWithPlaceholder
							src={campaign.imageUrl}
							alt=""
							origins={props.imageOrigins}
						/>
						<span class="campaign-chip">
							<StatusChip status={campaign.status} />
						</span>
					</div>
				}
			>
				<h3 class="campaign-title" id={titleId}>
					{campaign.title}
				</h3>
				<p class="campaign-amounts">
					<strong>{money(campaign.raised)}</strong>
					<span class="muted">
						{campaign.goal ? ` of ${money(campaign.goal)}` : " raised"}
					</span>
					{campaign.goal && percent !== null && (
						<span class="campaign-percent">{percent}%</span>
					)}
				</p>
				{percent !== null && (
					<ProgressBar percent={percent} label="Raised of goal" />
				)}
				<p class="campaign-meta muted">{meta(campaign)}</p>
				<Button
					variant="secondary"
					class="campaign-action"
					busy={busy}
					onClick={async () => {
						setBusy(true);
						await props.onFollowUp(action.prompt);
						setBusy(false);
					}}
				>
					{action.label}
				</Button>
			</Card>
		</li>
	);
}

export function Campaigns(props: { data: CampaignsData }) {
	const { host } = useSession();
	const [notice, setNotice] = useState<string | null>(null);
	const ask = async (prompt: string) => {
		try {
			await host.sendFollowUp(prompt);
			setNotice(null);
		} catch {
			setNotice(NOT_SENT);
		}
	};
	const { campaigns, imageOrigins } = props.data;

	if (campaigns.length === 0) {
		return (
			<EmptyState
				title="No campaigns yet"
				action={
					<Button
						variant="primary"
						onClick={() => ask("Help me create a campaign.")}
					>
						Create a campaign
					</Button>
				}
			>
				<p>Your organization hasn't started a campaign on Better Giving.</p>
			</EmptyState>
		);
	}

	return (
		<section class="campaigns">
			<ul class="carousel" tabindex={0} aria-label="Campaigns">
				{campaigns.map((campaign) => (
					<CampaignTile
						key={campaign.id}
						campaign={campaign}
						imageOrigins={imageOrigins}
						onFollowUp={ask}
					/>
				))}
			</ul>
			<p class="notice" role="status">
				{notice}
			</p>
		</section>
	);
}
