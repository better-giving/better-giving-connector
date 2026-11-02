/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";

const MARK = { done: "✓", failed: "✗", todo: "○" } as const;
const WORD = {
	done: "Done",
	failed: "Failed",
	todo: "Not done",
} as const;

/** One checklist line: a glyph and a spoken word as well as the color. */
export function Check(props: {
	state: keyof typeof MARK;
	children: Child;
	/** Overrides the spoken word ("Skipped"). */
	word?: string;
}) {
	return (
		<li class={`check check-${props.state}`}>
			<span class="check-mark" aria-hidden="true">
				{MARK[props.state]}
			</span>
			<span class="sr-only">{props.word ?? WORD[props.state]}: </span>
			<span>{props.children}</span>
		</li>
	);
}
