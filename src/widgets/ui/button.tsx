/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

export type ButtonVariant =
	| "primary"
	| "secondary"
	| "destructive"
	| "destructive-outline";

/** A button; `busy` disables it and tells assistive tech it is working. */
export function Button(props: {
	variant: ButtonVariant;
	onClick: () => void;
	children: Child;
	busy?: boolean;
	disabled?: boolean;
	label?: string;
	class?: string;
	id?: string;
	describedBy?: string;
}) {
	const busy = props.busy === true;
	return (
		<button
			type="button"
			id={props.id}
			class={`ds-btn ds-btn-${props.variant}${props.class ? ` ${props.class}` : ""}`}
			aria-label={props.label}
			aria-describedby={props.describedBy}
			aria-busy={busy ? "true" : undefined}
			disabled={busy || props.disabled === true}
			onClick={props.onClick}
		>
			{props.children}
		</button>
	);
}
