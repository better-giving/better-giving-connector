/** @jsxImportSource hono/jsx/dom */
import { useId, useState } from "hono/jsx/dom";
import type { CampaignResultsData } from "../model";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Check } from "../ui/check";
import { StatusChip } from "../ui/chip";
import { useWidgetState } from "../ui/state";
import { DateText, useMoney } from "../ui/text";
import { callTool } from "../ui/tools";
import { useLocale, useSession } from "../ui/widget";
import { EndConfirm } from "./end-confirm";
import { Facts, Totals, Trend } from "./stats";
import "./results.css";

const GENERAL = "";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

function Title(props: { data: CampaignResultsData; id: string }) {
	const { campaign } = props.data;
	return (
		<>
			<StatusChip status={campaign.status} />
			<h2 class="title" id={props.id} tabindex={-1}>
				{campaign.title}
			</h2>
		</>
	);
}

export function CampaignResults(props: { data: CampaignResultsData }) {
	const { host } = useSession();
	const locale = useLocale();
	const money = useMoney();
	const titleId = useId();
	const [data, setData] = useState(props.data);
	const [giftsGoTo, setGiftsGoTo] = useState(props.data.giftsGoTo ?? GENERAL);
	const [confirming, setConfirming] = useWidgetState(
		"confirmEnd",
		false,
		isBool,
	);
	const [busy, setBusy] = useState<"publish" | "end" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState("");

	const { campaign } = data;
	const confirmOpen = confirming && campaign.status === "published";

	const run = async (
		kind: "publish" | "end",
		args: { id: string; giftsGoTo: string | null } | { id: string },
	) => {
		setBusy(kind);
		setError(null);
		const res =
			kind === "publish" && "giftsGoTo" in args
				? await callTool(host, "app_publish_campaign", args)
				: await callTool(host, "app_end_campaign", { id: args.id });
		setBusy(null);
		if (!res.ok) {
			setError(res.error);
			return;
		}
		setConfirming(false);
		setData(res.data);
		setStatus(kind === "publish" ? "Published." : "Campaign ended.");
		setTimeout(() => document.getElementById(titleId)?.focus(), 0);
	};

	const publish = () =>
		void run("publish", {
			id: campaign.id,
			giftsGoTo: giftsGoTo === GENERAL ? null : giftsGoTo,
		});

	const openPage = (url: string) => {
		setError(null);
		host
			.openLink(url)
			.catch(() =>
				setError(
					`Couldn't open the page. It's at ${url} if you'd like to copy it.`,
				),
			);
	};

	const preview = () => {
		if (campaign.url) {
			openPage(campaign.url);
			return;
		}
		setError(null);
		host
			.sendFollowUp(
				`Open the editor for the draft campaign "${campaign.title}" (id ${campaign.id}) so I can preview it.`,
			)
			.catch(() =>
				setError(
					"Couldn't ask the chat to open it. Ask for the draft by name instead.",
				),
			);
	};

	const keepLive = () => {
		setConfirming(false);
		setTimeout(() => document.getElementById(`${titleId}-end`)?.focus(), 0);
	};

	const errorLine = (
		<p class="error-line" role="alert">
			{error}
		</p>
	);
	const statusLine = (
		<p class="sr-only" role="status">
			{status}
		</p>
	);

	if (campaign.status === "draft") {
		const open = data.readiness.filter((r) => !r.done).length;
		return (
			<Card class="results" label="Campaign results">
				<Title data={data} id={titleId} />
				<Totals data={data} />
				<section aria-label="Ready to publish">
					<h3 class="section-title">
						{open === 0
							? "Ready to publish"
							: `${open} to do before publishing`}
					</h3>
					<ul class="checks">
						{data.readiness.map((r) => (
							<Check key={r.id} state={r.done ? "done" : "todo"}>
								{r.label}
							</Check>
						))}
					</ul>
				</section>
				<div class="field">
					<label for={`${titleId}-gifts`}>Gifts go to</label>
					<select
						id={`${titleId}-gifts`}
						class="input"
						value={giftsGoTo}
						onChange={(e: Event) =>
							setGiftsGoTo((e.target as HTMLSelectElement).value)
						}
					>
						<option value={GENERAL} selected={giftsGoTo === GENERAL}>
							General fund
						</option>
						{data.programs.map((p) => (
							<option key={p.id} value={p.id} selected={giftsGoTo === p.id}>
								{p.name}
							</option>
						))}
					</select>
				</div>
				<div class="row">
					<Button variant="primary" busy={busy === "publish"} onClick={publish}>
						Publish
					</Button>
					<Button variant="secondary" onClick={preview}>
						Preview
					</Button>
				</div>
				{errorLine}
				{statusLine}
			</Card>
		);
	}

	const ended = campaign.status === "ended";
	return (
		<Card class="results" label="Campaign results">
			<Title data={data} id={titleId} />
			<Totals data={data} />
			<Facts data={data} />
			{ended ? (
				<p class="muted">
					{campaign.endDate ? (
						<>
							Ended <DateText iso={campaign.endDate} />. This campaign no longer
							takes gifts.
						</>
					) : (
						"This campaign no longer takes gifts."
					)}
					{data.giftCount > 0 &&
						` ${new Intl.NumberFormat(locale).format(data.giftCount)} ${data.giftCount === 1 ? "gift" : "gifts"}, ${money(data.raised)} in all.`}
				</p>
			) : (
				<Trend data={data} />
			)}
			{!ended && data.pendingDraft && (
				<p class="pending">
					You have saved edits that donors can't see yet. Publish changes to put
					them live.
				</p>
			)}
			{!ended && !confirmOpen && (
				<div class="row">
					{data.pendingDraft && (
						<Button
							variant="primary"
							busy={busy === "publish"}
							onClick={publish}
						>
							Publish changes
						</Button>
					)}
					{campaign.url && (
						<Button
							variant="secondary"
							onClick={() => campaign.url && openPage(campaign.url)}
						>
							View page
						</Button>
					)}
					<Button
						id={`${titleId}-end`}
						variant="outline-destructive"
						onClick={() => setConfirming(true)}
					>
						End campaign
					</Button>
				</div>
			)}
			{confirmOpen && (
				<EndConfirm
					donors={data.donors}
					busy={busy === "end"}
					onKeep={keepLive}
					onEnd={() => void run("end", { id: campaign.id })}
				/>
			)}
			{errorLine}
			{statusLine}
		</Card>
	);
}
