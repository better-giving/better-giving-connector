/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";
import { type KeyboardEvent, useRef } from "hono/jsx/dom";

/** The option a key moves to from `index` of `count`, or null for a key that doesn't move. */
function target(key: string, index: number, count: number): number | null {
	switch (key) {
		case "ArrowRight":
		case "ArrowDown":
			return (index + 1) % count;
		case "ArrowLeft":
		case "ArrowUp":
			return (index - 1 + count) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

/**
 * A radio group as one tab stop: the checked option takes focus, arrows (and
 * Home/End) check and focus the next, Space or a click checks.
 */
export function RadioGroup<T extends string>(props: {
	label: string;
	options: readonly T[];
	value: T;
	onChange: (value: T) => void;
	renderOption: (value: T, checked: boolean) => Child;
	class?: string;
}) {
	const group = useRef<HTMLDivElement>(null);
	const onKeyDown = (event: KeyboardEvent, index: number) => {
		if (event.key === " ") {
			event.preventDefault();
			props.onChange(props.options[index] as T);
			return;
		}
		const next = target(event.key, index, props.options.length);
		if (next === null) return;
		event.preventDefault();
		props.onChange(props.options[next] as T);
		group.current
			?.querySelectorAll<HTMLElement>('[role="radio"]')
			[next]?.focus();
	};
	return (
		<div
			ref={group}
			class={props.class}
			role="radiogroup"
			aria-label={props.label}
		>
			{props.options.map((option, index) => {
				const checked = option === props.value;
				return (
					<div
						key={option}
						role="radio"
						class="radio"
						aria-checked={checked ? "true" : "false"}
						tabindex={checked ? 0 : -1}
						onClick={() => props.onChange(option)}
						onKeyDown={(event: KeyboardEvent) => onKeyDown(event, index)}
					>
						{props.renderOption(option, checked)}
					</div>
				);
			})}
		</div>
	);
}
