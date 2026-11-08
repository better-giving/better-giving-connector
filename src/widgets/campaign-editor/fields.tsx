/** @jsxImportSource hono/jsx/dom */
import { useId, useState } from "hono/jsx/dom";
import { storyDocument } from "../../presets/themes";
import type { Block, PageContent } from "../model";
import { Button } from "../ui/button";
import { callTool } from "../ui/tools";
import { useLocale, useSession } from "../ui/widget";
import { humanize, plainText } from "./labels";

const HIDDEN = new Set(["type", "id", "key"]);
const LONG = /body|text|story|description|lede|summary|answer/i;

function Text(props: {
	label: string;
	value: string;
	long?: boolean;
	rows?: number;
	onInput: (value: string) => void;
}) {
	const id = useId();
	const common = {
		id,
		class: "ds-field-input",
		value: props.value,
		onInput: (e: Event) =>
			props.onInput((e.target as HTMLInputElement | HTMLTextAreaElement).value),
	};
	return (
		<div class="field">
			<label class="ds-label" for={id}>
				{props.label}
			</label>
			{props.long ? (
				<textarea rows={props.rows ?? 4} {...common} />
			) : (
				<input type="text" {...common} />
			)}
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
			<label class="ds-label" for={id}>
				{props.label}
			</label>
			<input
				id={id}
				class="ds-field-input"
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

/** Replaces the cover through the site's own upload page: a single-use link the operator opens. */
export function PhotoReplace(props: { campaignId: string }) {
	const { host } = useSession();
	const [error, setError] = useState<string | null>(null);
	const open = async () => {
		setError(null);
		const res = await callTool(host, "app_photo_upload_link", {
			id: props.campaignId,
		});
		if (!res.ok) {
			setError(res.error);
			return;
		}
		const { url } = res.data;
		await host.openLink(url).catch(() => {
			setError(
				`Couldn't open the page. It's at ${url} if you'd like to copy it.`,
			);
		});
	};
	return (
		<div class="field">
			<Button variant="secondary" onClick={() => void open()}>
				Replace photo
			</Button>
			<p class="hint">
				Opens a one-time upload page. Reopen the editor afterwards to see the
				new photo.
			</p>
			{error && (
				<p class="error-line" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

/** The settings of one block that are plain text, numbers or switches. */
export function BlockFields(props: {
	campaignId: string;
	block: Block;
	onChange: (block: Block) => void;
}) {
	const { block } = props;
	const set = (key: string, value: unknown) =>
		props.onChange({ ...block, [key]: value });
	const entries = Object.entries(block).filter(([key]) => !HIDDEN.has(key));
	const simple = entries.filter(([, v]) =>
		["string", "number", "boolean"].includes(typeof v),
	);
	const more = entries.length - simple.length;
	return (
		<div class="stack">
			{props.block.type.toLowerCase() === "hero" && (
				<PhotoReplace campaignId={props.campaignId} />
			)}
			{simple.map(([key, value]) => {
				const label = humanize(key);
				if (typeof value === "number") {
					return (
						<NumberField
							key={key}
							label={label}
							value={value}
							onInput={(n) => set(key, n)}
						/>
					);
				}
				if (typeof value === "boolean") {
					return (
						<label key={key} class="switch">
							<input
								type="checkbox"
								checked={value}
								onChange={(e: Event) =>
									set(key, (e.target as HTMLInputElement).checked)
								}
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
			{simple.length === 0 && (
				<p class="muted">This block has no settings to edit here.</p>
			)}
			{more > 0 && (
				<p class="hint">
					{more === 1 ? "One more setting" : `${more} more settings`} can be
					changed by asking in the chat.
				</p>
			)}
		</div>
	);
}

export type ContentSection = "hero" | "title" | "form" | "faq";

export const CONTENT_SECTIONS: readonly {
	key: ContentSection;
	label: string;
}[] = [
	{ key: "hero", label: "Hero photo" },
	{ key: "title", label: "Title & story" },
	{ key: "form", label: "Donation form" },
	{ key: "faq", label: "FAQ" },
];

/** Minor units per major unit of `currency` in `locale` (100 for USD, 1 for JPY). */
export function minorFactor(currency: string, locale: string): number {
	const digits =
		new Intl.NumberFormat(locale, {
			style: "currency",
			currency,
		}).resolvedOptions().maximumFractionDigits ?? 2;
	return 10 ** digits;
}

/** The fields of one section of a standalone (content) page. */
export function ContentFields(props: {
	campaignId: string;
	section: ContentSection;
	content: PageContent;
	currency: string;
	onChange: (content: PageContent) => void;
}) {
	const { content } = props;
	const locale = useLocale();
	const set = (patch: Partial<PageContent>) =>
		props.onChange({ ...content, ...patch });
	switch (props.section) {
		case "hero":
			return (
				<div class="stack">
					{content.hero && (
						<Text
							label="Photo description (alt text)"
							value={content.hero.alt ?? ""}
							onInput={(alt) =>
								set({
									hero: { ...(content.hero as { imageId: string }), alt },
								})
							}
						/>
					)}
					<PhotoReplace campaignId={props.campaignId} />
				</div>
			);
		case "title":
			return (
				<div class="stack">
					<Text
						label="Heading"
						value={content.heading ?? ""}
						onInput={(heading) => set({ heading })}
					/>
					<Text
						label="Lede"
						long
						value={content.lede ?? ""}
						onInput={(lede) => set({ lede })}
					/>
					<Text
						label="Story"
						long
						rows={8}
						value={plainText(content.story)}
						onInput={(story) => set({ story: storyDocument(story) })}
					/>
					<p class="hint">Leave a blank line between paragraphs.</p>
				</div>
			);
		case "form": {
			const factor = minorFactor(props.currency, locale);
			const tiers = content.tiers ?? [];
			if (tiers.length === 0)
				return <p class="muted">No suggested amounts yet.</p>;
			return (
				<div class="stack">
					{tiers.map((tier, i) => (
						<div key={`${tier.amountMinor}-${i}`} class="tier">
							<NumberField
								label={`Amount ${i + 1} (${props.currency})`}
								step={factor === 1 ? "1" : "any"}
								value={tier.amountMinor / factor}
								onInput={(n) => {
									// no minor unit: a fraction stays unsaved, and step="1" marks the field
									if (factor === 1 && !Number.isInteger(n)) return;
									const minor = Math.round(n * factor);
									if (minor <= 0) return;
									set({
										tiers: tiers.map((t, j) =>
											j === i ? { ...t, amountMinor: minor } : t,
										),
									});
								}}
							/>
							<Text
								label={`What amount ${i + 1} buys`}
								value={tier.buys}
								onInput={(buys) =>
									set({
										tiers: tiers.map((t, j) => (j === i ? { ...t, buys } : t)),
									})
								}
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
						<div key={`q-${i}`} class="stack">
							<Text
								label={`Question ${i + 1}`}
								value={item.question}
								onInput={(question) =>
									set({
										faq: faq.map((q, j) => (j === i ? { ...q, question } : q)),
									})
								}
							/>
							<Text
								label={`Answer ${i + 1}`}
								long
								value={plainText(item.answer)}
								onInput={(answer) =>
									set({
										faq: faq.map((q, j) =>
											j === i ? { ...q, answer: storyDocument(answer) } : q,
										),
									})
								}
							/>
						</div>
					))}
				</div>
			);
		}
	}
}
