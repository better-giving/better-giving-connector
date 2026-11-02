/** @jsxImportSource hono/jsx/dom */
import type { CampaignResultsData } from "../model";
import { ProgressBar, percentOf } from "../ui/progress";
import { Sparkline, weekOverWeek } from "../ui/sparkline";
import { useMoney } from "../ui/text";
import { useLocale } from "../ui/widget";

export function Totals(props: { data: CampaignResultsData }) {
	const money = useMoney();
	const { data } = props;
	const { goal } = data.campaign;
	const percent = percentOf(data.raised, goal);
	return (
		<div class="totals">
			<p class="raised">
				<strong>{money(data.raised)}</strong>
				{goal ? (
					<span class="muted"> of {money(goal)}</span>
				) : (
					<span class="muted"> raised</span>
				)}
				{percent !== null && <span class="percent"> · {percent}%</span>}
			</p>
			{percent !== null && (
				<ProgressBar percent={percent} label="Raised of goal" />
			)}
		</div>
	);
}

export function Facts(props: { data: CampaignResultsData }) {
	const money = useMoney();
	const count = new Intl.NumberFormat(useLocale());
	const { data } = props;
	const facts = [
		{ name: "Donors", value: count.format(data.donors) },
		{
			name: "Average gift",
			value: data.averageGift ? money(data.averageGift) : "No gifts yet",
		},
		{
			name: "Median gift",
			value: data.medianGift ? money(data.medianGift) : "No gifts yet",
		},
	];
	return (
		<dl class="facts">
			{facts.map((f) => (
				<div key={f.name} class="fact">
					<dt>{f.name}</dt>
					<dd>{f.value}</dd>
				</div>
			))}
		</dl>
	);
}

export function Trend(props: { data: CampaignResultsData }) {
	const money = useMoney();
	const { daily } = props.data;
	const week = weekOverWeek(daily);
	const { change } = week;
	let words: string;
	let mark = "";
	if (change === null) words = "No gifts in the 7 days before";
	else if (change > 0) {
		words = `Up ${change}% from the previous 7 days`;
		mark = "▲";
	} else if (change < 0) {
		words = `Down ${-change}% from the previous 7 days`;
		mark = "▼";
	} else words = "Same as the previous 7 days";
	return (
		<section class="trend" aria-label="Last 7 days">
			<div class="trend-text">
				<p class="eyebrow">Last 7 days</p>
				<p class="trend-amount">{money(week.last)}</p>
				<p class="trend-change">
					{mark && <span aria-hidden="true">{mark} </span>}
					{words}
				</p>
				<p class="hint">Previous 7 days: {money(week.previous)}</p>
			</div>
			<div class="trend-chart">
				<Sparkline
					values={daily.map((d) => Number(d.total.amount))}
					emphasize={7}
					label="Gifts per day over the last 14 days"
				/>
				<p class="hint trend-legend">Previous 7 days, then last 7 days</p>
			</div>
		</section>
	);
}
