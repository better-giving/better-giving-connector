/** @jsxImportSource hono/jsx/dom */
import type { Money } from "../model";
import { scaled, scaleOf, sumAmounts } from "./decimal";

type Day = { date: string; total: Money };

/**
 * The last seven days' total against the seven before, and the change as a
 * whole percent (null when the week before took nothing). `daily` is oldest
 * first, in one currency.
 */
export function weekOverWeek(daily: readonly Day[]): {
	last: Money;
	previous: Money;
	change: number | null;
} {
	const currency = daily[0]?.total.currency ?? "USD";
	const total = (days: readonly Day[]) =>
		sumAmounts(days.map((d) => d.total.amount));
	const last = total(daily.slice(-7));
	const previous = total(daily.slice(-14, -7));
	const scale = scaleOf([last, previous]);
	const prev = scaled(previous, scale);
	const change =
		prev === 0n
			? null
			: Math.round((Number(scaled(last, scale) - prev) / Number(prev)) * 100);
	return {
		last: { amount: last, currency },
		previous: { amount: previous, currency },
		change,
	};
}

/** One [x, y] per value across `width`, the largest at y 0 and zero at `height`. */
export function sparklinePoints(
	values: readonly number[],
	width: number,
	height: number,
): [number, number][] {
	const max = Math.max(0, ...values);
	const step = values.length > 1 ? width / (values.length - 1) : 0;
	return values.map((v, i) => [
		i * step,
		max === 0 ? height : height - (v / max) * height,
	]);
}

const W = 140;
const H = 32;
const PAD = 2;

/** Daily totals as a line; the last `emphasize` days drawn in the brand color. */
export function Sparkline(props: {
	values: readonly number[];
	emphasize: number;
	label: string;
}) {
	const points = sparklinePoints(props.values, W, H - PAD * 2).map(
		([x, y]) => `${x.toFixed(1)},${(y + PAD).toFixed(1)}`,
	);
	const split = Math.max(0, points.length - props.emphasize);
	return (
		<svg
			class="sparkline"
			role="img"
			aria-label={props.label}
			viewBox={`0 0 ${W} ${H}`}
			preserveAspectRatio="none"
		>
			{/* the earlier line runs into the first emphasised day, so the two meet */}
			<polyline
				class="spark-before"
				points={points.slice(0, split + 1).join(" ")}
			/>
			<polyline class="spark-recent" points={points.slice(split).join(" ")} />
		</svg>
	);
}
