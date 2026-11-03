/** @jsxImportSource hono/jsx/dom */
import type { Child } from "hono/jsx";
import { type KeyboardEvent, useId, useRef } from "hono/jsx/dom";

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
 * A radio group as one tab stop: native radio inputs, each inside a label the
 * option draws as a card. The checked option takes focus; arrows (and
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
	const name = useId();
	const group = useRef<HTMLDivElement>(null);
	// handled here rather than left to the browser, so wrapping, Home/End and
	// the focus move behave the same in every host frame
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
			?.querySelectorAll<HTMLInputElement>('input[type="radio"]')
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
					<label key={option} class="radio">
						<input
							type="radio"
							class="radio-input"
							name={name}
							value={option}
							checked={checked}
							tabindex={checked ? 0 : -1}
							onChange={() => props.onChange(option)}
							onKeyDown={(event: KeyboardEvent) => onKeyDown(event, index)}
						/>
						{props.renderOption(option, checked)}
					</label>
				);
			})}
		</div>
	);
}
