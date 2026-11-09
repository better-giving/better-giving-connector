/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

export function LoadingState(props: { label: string }) {
	return (
		<div
			class="ds-state-card ds-state-card-loading"
			role="status"
			aria-live="polite"
		>
			<span class="ds-state-card-spinner" aria-hidden="true" />
			{props.label}
		</div>
	);
}

/** A failure in the tool's own sentence; never raw JSON. */
export function ErrorState(props: { message: string; action?: Child }) {
	return (
		<div class="ds-state-card ds-state-card-error" role="alert">
			<p class="ds-state-card-title">Something went wrong</p>
			<div class="ds-state-card-body">{props.message}</div>
			{props.action && <div class="ds-state-card-action">{props.action}</div>}
		</div>
	);
}

export function EmptyState(props: {
	title: string;
	children?: Child;
	action?: Child;
}) {
	return (
		<div class="ds-state-card">
			<p class="ds-state-card-title">{props.title}</p>
			{props.children && <div class="ds-state-card-body">{props.children}</div>}
			{props.action && <div class="ds-state-card-action">{props.action}</div>}
		</div>
	);
}
