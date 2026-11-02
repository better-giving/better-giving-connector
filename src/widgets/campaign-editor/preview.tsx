/** @jsxImportSource hono/jsx/dom */
import { formatMoney } from "../../format";
import type { Block, CampaignEditorData, PageContent } from "../model";
import { ImageWithPlaceholder } from "../ui/image";
import { useLocale } from "../ui/widget";
import { blockLabel, firstImageUrl, humanize, plainText } from "./labels";
import { minorFactor } from "./fields";

export type Device = "desktop" | "phone";

const TEXTY = /^(title|heading|headline|name)$/i;
const BODY = /body|text|story|description|lede|summary/i;

function Paragraphs(props: { text: string }) {
	return (
		<>
			{props.text.split(/\n{2,}/).map((p, i) => (
				<p key={i}>{p}</p>
			))}
		</>
	);
}

function amountButtons(data: CampaignEditorData, locale: string) {
	return data.formAmounts.map((m) => formatMoney(m.amount, m.currency, locale));
}

function Donate(props: { amounts: string[] }) {
	return (
		<div class="pv-form">
			<div class="pv-amounts">
				{props.amounts.map((a) => (
					<span key={a} class="pv-amount">
						{a}
					</span>
				))}
			</div>
			<span class="pv-donate">Donate</span>
		</div>
	);
}

function PreviewBlock(props: { block: Block; data: CampaignEditorData; amounts: string[] }) {
	const { block } = props;
	const type = block.type.toLowerCase();
	const strings = Object.entries(block).filter(
		(e): e is [string, string] => typeof e[1] === "string" && e[0] !== "type" && !/^https:/.test(e[1]),
	);
	const heading = strings.find(([k]) => TEXTY.test(k))?.[1];
	const body = strings.find(([k]) => BODY.test(k))?.[1];
	if (type === "hero") {
		return (
			<ImageWithPlaceholder
				class="pv-hero"
				src={firstImageUrl(block)}
				alt={strings.find(([k]) => /alt/i.test(k))?.[1] ?? ""}
				origins={props.data.imageOrigins}
			/>
		);
	}
	if (type === "goal" || type === "progress") {
		return (
			<div class="pv-goal">
				<div class="pv-bar">
					<span />
				</div>
				<p>Progress toward the goal shows here once gifts come in.</p>
			</div>
		);
	}
	if (/donat|form/.test(type)) return <Donate amounts={props.amounts} />;
	if (type === "faq") {
		const items = strings.filter(([k]) => !/title|heading/i.test(k));
		return (
			<section class="pv-section">
				<h2>{heading ?? "Questions"}</h2>
				{items.map(([k, v]) => (
					<p key={k}>{v}</p>
				))}
			</section>
		);
	}
	return (
		<section class="pv-section">
			<h2>{heading ?? blockLabel(block.type)}</h2>
			{body ? <Paragraphs text={body} /> : strings.filter(([k]) => !TEXTY.test(k)).map(([k, v]) => <p key={k}><b>{humanize(k)}:</b> {v}</p>)}
		</section>
	);
}

function ContentPreview(props: { content: PageContent; data: CampaignEditorData; amounts: string[] }) {
	const { content, data } = props;
	const locale = useLocale();
	const currency = data.formAmounts[0]?.currency ?? "USD";
	const factor = minorFactor(currency, locale);
	const heroUrl = content.hero ? (data.images[content.hero.imageId] ?? null) : null;
	return (
		<>
			{content.hero && (
				<ImageWithPlaceholder
					class="pv-hero"
					src={heroUrl}
					alt={content.hero.alt ?? ""}
					origins={data.imageOrigins}
				/>
			)}
			<section class="pv-section">
				<h1>{content.heading ?? data.campaign.title}</h1>
				{content.lede && <p class="pv-lede">{content.lede}</p>}
				{content.story && <Paragraphs text={plainText(content.story)} />}
			</section>
			{content.tiers && content.tiers.length > 0 ? (
				<div class="pv-form">
					<div class="pv-tiers">
						{content.tiers.map((t, i) => (
							<p key={i} class="pv-tier">
								<b>{formatMoney(String(t.amountMinor / factor), currency, locale)}</b> {t.buys}
							</p>
						))}
					</div>
					<span class="pv-donate">Donate</span>
				</div>
			) : (
				<Donate amounts={props.amounts} />
			)}
			{content.faq && content.faq.length > 0 && (
				<section class="pv-section">
					<h2>Questions</h2>
					{content.faq.map((q, i) => (
						<div key={i}>
							<p>
								<b>{q.question}</b>
							</p>
							<Paragraphs text={plainText(q.answer)} />
						</div>
					))}
				</section>
			)}
		</>
	);
}

/** The donor page as it will look: Quicksand, 4px corners, on a light surface whatever the host's theme. */
export function PagePreview(props: {
	data: CampaignEditorData;
	page: CampaignEditorData["page"];
	device: Device;
}) {
	const locale = useLocale();
	const amounts = amountButtons(props.data, locale);
	const { page } = props;
	return (
		<div class="preview-scroll">
			<div class={`preview preview-${props.device}`} aria-label={`Donor page preview, ${props.device}`} role="group">
				<p class="pv-org">{props.data.orgName}</p>
				{page.pageKind === "blocks" ? (
					<>
						<h1 class="pv-title">{props.data.campaign.title}</h1>
						{page.blocks.map((block, i) => (
							<PreviewBlock key={`${block.type}-${i}`} block={block} data={props.data} amounts={amounts} />
						))}
						{page.blocks.length === 0 && <p class="pv-empty">This page has no blocks yet.</p>}
					</>
				) : (
					<ContentPreview content={page.content} data={props.data} amounts={amounts} />
				)}
			</div>
		</div>
	);
}
