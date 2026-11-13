/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

/** The widgets' surface: host radius, hairline edge, `media` flush to the top, `footer` flush to the bottom. */
export function Card(props: {
	children: Child;
	media?: Child;
	/** The registry's `.ds-card-footer` row, flush under the body. */
	footer?: Child;
	class?: string;
	label?: string;
}) {
	return (
		<article
			class={props.class ? `ds-card card ${props.class}` : "ds-card card"}
			aria-label={props.label}
		>
			{props.media}
			<div class="ds-card-body card-body">{props.children}</div>
			{props.footer}
		</article>
	);
}
