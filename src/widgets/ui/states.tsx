/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

export function LoadingState(props: { label: string }) {
	return (
		<div class="state" role="status" aria-live="polite">
			<div class="spinner" aria-hidden="true" />
			<p>{props.label}</p>
		</div>
	);
}

/** A failure in the tool's own sentence; never raw JSON. */
export function ErrorState(props: { message: string; action?: Child }) {
	return (
		<div class="state state-error" role="alert">
			<p class="state-title">Something went wrong</p>
			<p>{props.message}</p>
			{props.action}
		</div>
	);
}

export function EmptyState(props: {
	title: string;
	children?: Child;
	action?: Child;
}) {
	return (
		<div class="state">
			<p class="state-title">{props.title}</p>
			{props.children}
			{props.action}
		</div>
	);
}
