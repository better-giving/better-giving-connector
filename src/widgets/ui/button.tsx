/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

export type ButtonVariant =
	| "primary"
	| "secondary"
	| "destructive"
	| "destructive-outline";

/**
 * A button; `busy` disables it and tells assistive tech it is working.
 * With `keepFocus`, busy and disabled hold it with `aria-disabled` instead, so
 * a focused button keeps focus, and a press is ignored while it is held.
 */
export function Button(props: {
	variant: ButtonVariant;
	onClick: () => void;
	children: Child;
	busy?: boolean;
	full?: boolean;
	disabled?: boolean;
	keepFocus?: boolean;
	label?: string;
	class?: string;
	id?: string;
	describedBy?: string;
}) {
	const busy = props.busy === true;
	const off = busy || props.disabled === true;
	const held = off && props.keepFocus === true;
	return (
		<button
			type="button"
			id={props.id}
			class={`ds-btn ds-btn-${props.variant}${props.full ? " ds-btn-full" : ""}${props.class ? ` ${props.class}` : ""}`}
			aria-label={props.label}
			aria-describedby={props.describedBy}
			aria-busy={busy ? "true" : undefined}
			aria-disabled={held ? "true" : undefined}
			disabled={off && !held}
			onClick={() => {
				if (!held) props.onClick();
			}}
		>
			{props.children}
		</button>
	);
}
