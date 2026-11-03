/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

/** The widgets' surface: host radius, hairline edge, `media` flush to the top. */
export function Card(props: {
	children: Child;
	media?: Child;
	class?: string;
	label?: string;
}) {
	return (
		<article
			class={props.class ? `card ${props.class}` : "card"}
			aria-label={props.label}
		>
			{props.media}
			<div class="card-body">{props.children}</div>
		</article>
	);
}
