/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";
import { useEffect, useId, useState } from "hono/jsx/dom";
import type { CampaignResultsData } from "../model";
import { StatusBadge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Check } from "../ui/check";
import { useWidgetState } from "../ui/state";
import { DateText, useMoney } from "../ui/text";
import { callTool } from "../ui/tools";
import { useLocale, useSession } from "../ui/widget";
import { EndConfirm } from "./end-confirm";
import { Facts, Totals } from "./stats";
import "./results.css";

const GENERAL = "";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";

const DAY_MS = 86_400_000;

/** Whole days from today to `iso` (a day), never negative. */
const daysUntil = (iso: string, now: number) =>
	Math.max(0, Math.ceil((Date.parse(`${iso}T23:59:59`) - now) / DAY_MS));

function Updated() {
	const [minutes, setMinutes] = useState(0);
	useEffect(() => {
		const started = Date.now();
		const timer = setInterval(
			() => setMinutes(Math.floor((Date.now() - started) / 60_000)),
			30_000,
		);
		return () => clearInterval(timer);
	}, []);
	return (
		<span class="updated">
			{minutes < 1 ? "Updated just now" : `Updated ${minutes} min ago`}
		</span>
	);
}

function Header(props: { data: CampaignResultsData; id: string }) {
	const { campaign } = props.data;
	const locale = useLocale();
	const days = campaign.endDate
		? daysUntil(campaign.endDate, Date.now())
		: null;
	const ends = campaign.endDate ? <DateText iso={campaign.endDate} /> : null;
	let sub: Child;
	if (campaign.status === "draft")
		sub = "Not published · donors can't see it yet";
	else if (campaign.status === "ended")
		sub = ends ? <>Ended {ends}</> : "Ended";
	else if (ends)
		sub = (
			<>
				Ends {ends} ·{" "}
				{days === null
					? ""
					: days === 1
						? "1 day left"
						: `${new Intl.NumberFormat(locale).format(days)} days left`}
			</>
		);
	else sub = "No end date";
	return (
		<div class="head">
			<div>
				<h2 class="title" id={props.id} tabindex={-1}>
					{campaign.title}
				</h2>
				<p class="subtitle">{sub}</p>
			</div>
			<span class="ds-card-status">
				<StatusBadge status={campaign.status} />
			</span>
		</div>
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

	const share = () => {
		if (!campaign.url) return;
		setError(null);
		const url = campaign.url;
		navigator.clipboard
			.writeText(url)
			.then(() => setStatus("Link copied."))
			.catch(() => setError(`Copy the link from here: ${url}`));
	};

	if (campaign.status === "draft") {
		const done = data.readiness.filter((r) => r.done).length;
		return (
			<Card
				class="results"
				label="Campaign results"
				footer={
					<div class="ds-card-footer card-foot">
						<div class="gifts-go">
							<label class="ds-label" for={`${titleId}-gifts`}>
								Gifts go to:
							</label>
							<div class="ds-select ds-select-inline">
								<select
									id={`${titleId}-gifts`}
									class="ds-field-input"
									value={giftsGoTo}
									onChange={(e: Event) =>
										setGiftsGoTo((e.target as HTMLSelectElement).value)
									}
								>
									<option value={GENERAL} selected={giftsGoTo === GENERAL}>
										General fund
									</option>
									{data.programs.map((p) => (
										<option
											key={p.id}
											value={p.id}
											selected={giftsGoTo === p.id}
										>
											{p.name}
										</option>
									))}
								</select>
								<svg
									class="ds-select-chevron"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="m6 9 6 6 6-6" />
								</svg>
							</div>
						</div>
						<div class="foot-actions">
							<Button variant="secondary" onClick={preview}>
								Preview
							</Button>
							<Button
								variant="primary"
								busy={busy === "publish"}
								onClick={publish}
							>
								Publish
							</Button>
						</div>
					</div>
				}
			>
				<Header data={data} id={titleId} />
				<Totals data={data} />
				<section aria-label="Ready to publish">
					<h3 class="eyebrow">
						Ready to publish · {done} of {data.readiness.length}
					</h3>
					<ul class="checks">
						{data.readiness.map((r) => (
							<Check key={r.id} state={r.done ? "done" : "todo"}>
								{r.label}
							</Check>
						))}
					</ul>
				</section>
				{errorLine}
				{statusLine}
			</Card>
		);
	}

	const ended = campaign.status === "ended";
	return (
		<Card
			class="results"
			label="Campaign results"
			footer={
				!ended && (
					<div class="ds-card-footer card-foot">
						<Updated />
						<div class="foot-actions">
							{data.pendingDraft && (
								<Button
									variant="primary"
									busy={busy === "publish"}
									onClick={publish}
								>
									Publish changes
								</Button>
							)}
							<Button
								id={`${titleId}-end`}
								variant="destructive-outline"
								onClick={() => setConfirming(true)}
							>
								End campaign
							</Button>
							{campaign.url && (
								<Button variant="secondary" onClick={share}>
									Share link
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
						</div>
					</div>
				)
			}
		>
			<Header data={data} id={titleId} />
			<Totals data={data} />
			<Facts data={data} />
			{ended && (
				<p class="muted">
					This campaign no longer takes gifts.
					{data.giftCount > 0 &&
						` ${new Intl.NumberFormat(locale).format(data.giftCount)} ${data.giftCount === 1 ? "gift" : "gifts"}, ${money(data.raised)} in all.`}
				</p>
			)}
			{!ended && data.pendingDraft && (
				<p class="pending">
					You have saved edits that donors can't see yet. Publish changes to put
					them live.
				</p>
			)}
			{errorLine}
			{statusLine}
			{confirmOpen && (
				<EndConfirm
					title={campaign.title}
					donors={data.donors}
					busy={busy === "end"}
					onKeep={keepLive}
					onEnd={() => void run("end", { id: campaign.id })}
				/>
			)}
		</Card>
	);
}
