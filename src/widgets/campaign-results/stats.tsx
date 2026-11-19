/** @jsxImportSource hono/jsx/dom */
import { useId } from "hono/jsx/dom";
import type { CampaignResultsData } from "../model";
import { scaled, scaleOf, unscaled } from "../ui/decimal";
import { ProgressBar, percentOf } from "../ui/progress";
import { Sparkline, weekOverWeek } from "../ui/sparkline";
import { useWholeMoney } from "../ui/text";
import { useLocale } from "../ui/widget";

export function Totals(props: { data: CampaignResultsData }) {
	const money = useWholeMoney();
	const { data } = props;
	const { goal } = data.campaign;
	const percent = percentOf(data.raised, goal);
	const scale = goal ? scaleOf([data.raised.amount, goal.amount]) : 0;
	const left = goal
		? scaled(goal.amount, scale) - scaled(data.raised.amount, scale)
		: 0n;
	const draft = data.campaign.status === "draft";
	return (
		<div class="totals">
			<p class="raised">
				<strong class="raised-figure">{money(data.raised)}</strong>
				{goal ? (
					<span class="muted">
						{" "}
						raised of {money(goal)}
						{draft ? " goal" : ""}
					</span>
				) : (
					<span class="muted"> raised</span>
				)}
			</p>
			{percent !== null && (
				<ProgressBar percent={percent} label="Raised of goal" />
			)}
			{percent !== null && !draft && (
				<p class="goal-row">
					<span>{percent}% of goal</span>
					<span>
						{left > 0n
							? `${money({ amount: unscaled(left, scale), currency: data.raised.currency })} to go`
							: "Goal reached"}
					</span>
				</p>
			)}
		</div>
	);
}

/** lucide's trending-up and trending-down, the badge's glyph. */
function TrendGlyph(props: { up: boolean }) {
	return (
		<svg
			class="ds-trend-glyph"
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			{props.up ? (
				<>
					<path d="M16 7h6v6" />
					<path d="m22 7-8.5 8.5-5-5L2 17" />
				</>
			) : (
				<>
					<path d="M16 17h6v-6" />
					<path d="m22 17-8.5-8.5-5 5L2 7" />
				</>
			)}
		</svg>
	);
}

export function Facts(props: { data: CampaignResultsData }) {
	const money = useWholeMoney();
	const count = new Intl.NumberFormat(useLocale());
	const { data } = props;
	const { daily } = data;
	const week = weekOverWeek(daily);
	const { change } = week;
	const ended = data.campaign.status === "ended";
	const labelId = useId();
	const note =
		daily.length < 14
			? "Not enough days to compare"
			: week.change === null
				? "Nothing in the 7 days before"
				: `Previous 7 days: ${money(week.previous)}`;
	return (
		<div class="facts">
			<dl class="fact">
				<dt>Donors</dt>
				<dd class="fact-figure">{count.format(data.donors)}</dd>
				<dd class="fact-sub">
					{count.format(data.giftCount)}{" "}
					{data.giftCount === 1 ? "gift" : "gifts"}
				</dd>
			</dl>
			<dl class="fact">
				<dt>Average gift</dt>
				<dd class="fact-figure">
					{data.averageGift ? money(data.averageGift) : "No gifts yet"}
				</dd>
				{data.medianGift && (
					<dd class="fact-sub">Median {money(data.medianGift)}</dd>
				)}
			</dl>
			{!ended && (
				<div class="fact">
					{/* biome-ignore lint/a11y/useSemanticElements: the registry's trend block is a role="group" div; a fieldset is not a card block */}
					<div class="ds-trend" role="group" aria-labelledby={labelId}>
						<p class="ds-trend-label" id={labelId}>
							Last 7 days
						</p>
						<div class="ds-trend-main">
							<b class="ds-trend-figure">{money(week.last)}</b>
							{change !== null && change !== 0 && (
								<span
									class={
										change > 0
											? "ds-badge ds-badge-success"
											: "ds-badge ds-badge-warning"
									}
								>
									<TrendGlyph up={change > 0} />
									{change > 0 ? "Up" : "Down"} {Math.abs(change)}%
								</span>
							)}
						</div>
						<p class="ds-trend-note">{note}</p>
						<Sparkline
							values={daily.map((d) => Number(d.total.amount))}
							emphasize={7}
							label="Amount raised per day over the last 14 days"
						/>
					</div>
				</div>
			)}
		</div>
	);
}
