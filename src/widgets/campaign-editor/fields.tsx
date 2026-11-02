/** @jsxImportSource hono/jsx/dom */
import { useId } from "hono/jsx/dom";
import type { Block, PageContent } from "../model";
import { useLocale } from "../ui/widget";
import { humanize } from "./labels";

const HIDDEN = new Set(["type", "id", "key"]);
const LONG = /body|text|story|description|lede|summary|answer/i;

function Text(props: {
	label: string;
	value: string;
	long?: boolean;
	onInput: (value: string) => void;
}) {
	const id = useId();
	const common = {
		id,
		class: "input",
		value: props.value,
		onInput: (e: Event) =>
			props.onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value),
	};
	return (
		<div class="field">
			<label for={id}>{props.label}</label>
			{props.long ? <textarea rows={4} {...common} /> : <input type="text" {...common} />}
		</div>
	);
}

function NumberField(props: {
	label: string;
	value: number;
	step?: string;
	onInput: (value: number) => void;
}) {
	const id = useId();
	return (
		<div class="field">
			<label for={id}>{props.label}</label>
			<input
				id={id}
				class="input"
				type="number"
				step={props.step}
				value={props.value}
				onInput={(e: Event) => {
					const n = Number((e.target as HTMLInputElement).value);
					if (Number.isFinite(n)) props.onInput(n);
				}}
			/>
		</div>
	);
}

/** The settings of one block that are plain text, numbers or switches. */
export function BlockFields(props: {
	block: Block;
	onChange: (block: Block) => void;
}) {
	const { block } = props;
	const set = (key: string, value: unknown) =>
		props.onChange({ ...block, [key]: value });
	const entries = Object.entries(block).filter(([key]) => !HIDDEN.has(key));
	const simple = entries.filter(([, v]) => ["string", "number", "boolean"].includes(typeof v));
	const more = entries.length - simple.length;
	return (
		<div class="stack">
			{simple.map(([key, value]) => {
				const label = humanize(key);
				if (typeof value === "number") {
					return <NumberField key={key} label={label} value={value} onInput={(n) => set(key, n)} />;
				}
				if (typeof value === "boolean") {
					return (
						<label key={key} class="switch">
							<input
								type="checkbox"
								checked={value}
								onChange={(e: Event) => set(key, (e.target as HTMLInputElement).checked)}
							/>
							{label}
						</label>
					);
				}
				return (
					<Text
						key={key}
						label={label}
						value={String(value)}
						long={LONG.test(key) || String(value).length > 80}
						onInput={(v) => set(key, v)}
					/>
				);
			})}
			{simple.length === 0 && <p class="muted">This block has no settings to edit here.</p>}
			{more > 0 && (
				<p class="hint">
					{more === 1 ? "One more setting" : `${more} more settings`} can be changed
					by asking in the chat.
				</p>
			)}
		</div>
	);
}

export type ContentSection = "hero" | "title" | "form" | "faq";

export const CONTENT_SECTIONS: readonly { key: ContentSection; label: string }[] = [
	{ key: "hero", label: "Hero photo" },
	{ key: "title", label: "Title & story" },
	{ key: "form", label: "Donation form" },
	{ key: "faq", label: "FAQ" },
];

/** Minor units per major unit of `currency` in `locale` (100 for USD, 1 for JPY). */
export function minorFactor(currency: string, locale: string): number {
	const digits = new Intl.NumberFormat(locale, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
	return 10 ** digits;
}

/** The fields of one section of a standalone (content) page. */
export function ContentFields(props: {
	section: ContentSection;
	content: PageContent;
	currency: string;
	onChange: (content: PageContent) => void;
}) {
	const { content } = props;
	const locale = useLocale();
	const set = (patch: Partial<PageContent>) => props.onChange({ ...content, ...patch });
	switch (props.section) {
		case "hero":
			return content.hero ? (
				<Text
					label="Photo description (alt text)"
					value={content.hero.alt ?? ""}
					onInput={(alt) => set({ hero: { ...(content.hero as { imageId: string }), alt } })}
				/>
			) : (
				<p class="muted">This page has no cover photo yet. Ask in the chat to set one.</p>
			);
		case "title":
			return (
				<div class="stack">
					<Text label="Heading" value={content.heading ?? ""} onInput={(heading) => set({ heading })} />
					<Text label="Lede" long value={content.lede ?? ""} onInput={(lede) => set({ lede })} />
					<p class="hint">The story is written in the chat; it stays as it is here.</p>
				</div>
			);
		case "form": {
			const factor = minorFactor(props.currency, locale);
			const tiers = content.tiers ?? [];
			if (tiers.length === 0) return <p class="muted">No suggested amounts yet.</p>;
			return (
				<div class="stack">
					{tiers.map((tier, i) => (
						<div key={`${tier.amountMinor}-${i}`} class="tier">
							<NumberField
								label={`Amount ${i + 1} (${props.currency})`}
								step={factor === 1 ? "1" : "0.01"}
								value={tier.amountMinor / factor}
								onInput={(n) => {
									const minor = Math.round(n * factor);
									if (minor <= 0) return;
									set({ tiers: tiers.map((t, j) => (j === i ? { ...t, amountMinor: minor } : t)) });
								}}
							/>
							<Text
								label={`What amount ${i + 1} buys`}
								value={tier.buys}
								onInput={(buys) => set({ tiers: tiers.map((t, j) => (j === i ? { ...t, buys } : t)) })}
							/>
						</div>
					))}
				</div>
			);
		}
		case "faq": {
			const faq = content.faq ?? [];
			if (faq.length === 0) return <p class="muted">No questions yet.</p>;
			return (
				<div class="stack">
					{faq.map((item, i) => (
						<Text
							key={`q-${i}`}
							label={`Question ${i + 1}`}
							value={item.question}
							onInput={(question) =>
								set({ faq: faq.map((q, j) => (j === i ? { ...q, question } : q)) })
							}
						/>
					))}
					<p class="hint">Answers are written in the chat; they stay as they are here.</p>
				</div>
			);
		}
	}
}
