/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";
import { useEffect, useState } from "hono/jsx/dom";

export function LoadingState(props: { label: string }) {
	// filled after mount: a live region announces a change inside it, never the
	// text it arrived holding (state-card-css.usage.md, Accessibility)
	const [read, setRead] = useState("");
	useEffect(() => {
		setRead(props.label);
	}, [props.label]);
	return (
		<div
			class="ds-state-card ds-state-card-loading"
			role="status"
			aria-live="polite"
		>
			<span class="ds-spinner" aria-hidden="true" />
			<span aria-hidden="true">{props.label}</span>
			<span class="ds-state-card-read">{read}</span>
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
