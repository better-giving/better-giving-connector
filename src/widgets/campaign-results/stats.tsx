/** @jsxImportSource hono/jsx/dom */
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

export function Facts(props: { data: CampaignResultsData }) {
	const money = useWholeMoney();
	const count = new Intl.NumberFormat(useLocale());
	const { data } = props;
	const { daily } = data;
	const week = weekOverWeek(daily);
	const { change } = week;
	const ended = data.campaign.status === "ended";
	return (
		<dl class="facts">
			<div class="fact">
				<dt>Donors</dt>
				<dd>{count.format(data.donors)}</dd>
				<dd class="fact-sub">
					{count.format(data.giftCount)}{" "}
					{data.giftCount === 1 ? "gift" : "gifts"}
				</dd>
			</div>
			<div class="fact">
				<dt>Average gift</dt>
				<dd>{data.averageGift ? money(data.averageGift) : "No gifts yet"}</dd>
				{data.medianGift && (
					<dd class="fact-sub">Median {money(data.medianGift)}</dd>
				)}
			</div>
			{!ended && (
				<div class="fact fact-trend">
					<dt>Last 7 days</dt>
					<dd class="fact-line">
						<span>{money(week.last)}</span>
						{change !== null && change !== 0 && (
							<span class={change > 0 ? "pill pill-up" : "pill pill-down"}>
								<span aria-hidden="true">{change > 0 ? "↗" : "↘"}</span>{" "}
								{change > 0 ? "Up" : "Down"} {Math.abs(change)}%
							</span>
						)}
					</dd>
					<dd class="fact-sub">Previous 7 days: {money(week.previous)}</dd>
					<dd class="fact-chart">
						<Sparkline
							values={daily.map((d) => Number(d.total.amount))}
							emphasize={7}
							label="Gifts per day over the last 14 days"
						/>
					</dd>
				</div>
			)}
		</dl>
	);
}
