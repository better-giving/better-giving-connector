/** @jsxImportSource hono/jsx/dom */
import type { Money } from "../model";
import { scaled, scaleOf } from "./decimal";

/**
 * The whole percent of `goal` raised, rounded down so 100% means the goal is
 * met; past the goal it keeps counting (123). Null without a positive goal.
 */
export function percentOf(raised: Money, goal: Money | null): number | null {
	if (!goal) return null;
	const scale = scaleOf([raised.amount, goal.amount]);
	const g = scaled(goal.amount, scale);
	if (g <= 0n) return null;
	return Number((scaled(raised.amount, scale) * 100n) / g);
}

/** A bar capped at full that still names the real percentage (123%). */
export function ProgressBar(props: { percent: number; label: string }) {
	const fill = Math.min(100, Math.max(0, props.percent));
	return (
		<div
			class={props.percent >= 100 ? "progress met" : "progress"}
			role="progressbar"
			aria-label={props.label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={fill}
			aria-valuetext={`${props.percent}%`}
		>
			<div class="progress-fill" style={{ width: `${fill}%` }} />
		</div>
	);
}
