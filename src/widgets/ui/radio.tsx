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

/** What one option shows: the registry radio card's cover, title and description. */
export type RadioCardContent = {
	cover: Child;
	title: Child;
	description: Child;
};

/**
 * A radio group as one tab stop, drawn as the registry's radio cards
 * (`radio-card-css`): a fieldset of native radio inputs, each lying over its
 * card and named by the card's title. The checked option takes focus; arrows
 * (and Home/End) check and focus the next, Space or a press on the card checks.
 */
export function RadioGroup<T extends string>(props: {
	label: string;
	options: readonly T[];
	value: T;
	onChange: (value: T) => void;
	renderOption: (value: T) => RadioCardContent;
	class?: string;
}) {
	const name = useId();
	const group = useRef<HTMLFieldSetElement>(null);
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
		<fieldset
			ref={group}
			class={props.class ? `radio-group ${props.class}` : "radio-group"}
		>
			<legend class="sr-only">{props.label}</legend>
			<div class="ds-radio-cards">
				{props.options.map((option, index) => {
					const checked = option === props.value;
					const content = props.renderOption(option);
					const titleId = `${name}-${index}-title`;
					const descId = `${name}-${index}-desc`;
					return (
						<div key={option} class="ds-radio-card">
							<div class="ds-radio-card-cover">{content.cover}</div>
							<span class="ds-radio-card-badge">
								<svg
									aria-hidden="true"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M20 6 9 17l-5-5" />
								</svg>
							</span>
							<div class="ds-radio-card-body">
								<span class="ds-radio-card-title" id={titleId}>
									{content.title}
								</span>
								<div class="ds-radio-card-desc" id={descId}>
									{content.description}
								</div>
							</div>
							<input
								type="radio"
								name={name}
								value={option}
								checked={checked}
								tabindex={checked ? 0 : -1}
								aria-labelledby={titleId}
								aria-describedby={descId}
								onChange={() => props.onChange(option)}
								onKeyDown={(event: KeyboardEvent) => onKeyDown(event, index)}
							/>
						</div>
					);
				})}
			</div>
		</fieldset>
	);
}
