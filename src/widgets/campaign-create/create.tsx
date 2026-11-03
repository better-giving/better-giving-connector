/** @jsxImportSource hono/jsx/dom */
import { useState } from "hono/jsx/dom";
import { THEME_NAMES, THEMES, type ThemeName } from "../../presets/themes";
import type { CampaignCreateData, CreateResult, Preset } from "../model";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Check } from "../ui/check";
import { RadioGroup } from "../ui/radio";
import { useWidgetState } from "../ui/state";
import { useDate, useWholeMoney } from "../ui/text";
import { callTool } from "../ui/tools";
import { useSession } from "../ui/widget";
import { ThemeArt } from "./art";
import "./create.css";

const isTheme = (value: unknown): value is ThemeName =>
	typeof value === "string" &&
	(THEME_NAMES as readonly string[]).includes(value);

const STEP_LABEL: Record<CreateResult["steps"][number]["step"], string> = {
	create: "Campaign created",
	settings: "Goal and end date set",
	form: "Donation form set up",
	page: "Campaign page filled in",
};

function PresetCard(props: { preset: Preset; checked: boolean }) {
	const money = useWholeMoney();
	const date = useDate();
	const { preset } = props;
	return (
		<div class={props.checked ? "preset preset-checked" : "preset"}>
			<div class="preset-media">
				<ThemeArt theme={preset.theme} />
				{props.checked && (
					<span class="preset-badge" aria-hidden="true">
						✓
					</span>
				)}
			</div>
			<div class="preset-body">
				<span class="preset-theme">
					{THEMES[preset.theme].label}
					{props.checked && <span class="sr-only"> (selected)</span>}
				</span>
				<strong class="preset-title">{preset.title}</strong>
				<p class="preset-line">
					Goal <b>{money(preset.goal)}</b>
				</p>
				<p class="preset-line">
					Ends {date(preset.endDate, { month: "short", day: "numeric" })}
				</p>
				<ul class="pills" aria-label="Gift amounts">
					{preset.suggestedAmounts.map((a) => (
						<li key={a.amount} class="pill-amount">
							{money(a)}
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}

function Recommendations(props: { data: CampaignCreateData }) {
	const money = useWholeMoney();
	const { recommendations: r } = props.data;
	const items = [
		{ name: "Goal", value: money(r.goal.value), evidence: r.goal.evidence },
		{
			name: "Gift amounts",
			value: r.suggestedAmounts.value.map(money).join(", "),
			evidence: r.suggestedAmounts.evidence,
		},
		{
			name: "Length",
			value: `${r.endDays.value} days`,
			evidence: r.endDays.evidence,
		},
		{
			name: "Theme",
			value: THEMES[r.theme.value].label,
			evidence: r.theme.evidence,
		},
	];
	return (
		<section class="recs" aria-labelledby="recs-title">
			<h3 id="recs-title" class="recs-title">
				{r.basedOnHistory
					? "Recommended from your past results"
					: "Starting points: not enough history yet"}
			</h3>
			<dl class="recs-list">
				{items.map((item) => (
					<div key={item.name} class="rec">
						<dt>{item.name}</dt>
						<dd class="rec-value">{item.value}</dd>
						<dd class="rec-evidence">{item.evidence}</dd>
					</div>
				))}
			</dl>
		</section>
	);
}

function Created(props: { result: CreateResult; onOpen: () => void }) {
	const { campaign, steps, failedStep } = props.result;
	return (
		<Card class="created" label="Draft created">
			<p class="eyebrow">
				{failedStep ? "Draft created, not finished" : "Draft created"}
			</p>
			<h3 class="title">{campaign.title}</h3>
			<ul class="checks">
				{steps.map((s) => (
					<Check
						key={s.step}
						state={
							s.status === "done"
								? "done"
								: s.status === "failed"
									? "failed"
									: "todo"
						}
						word={s.status === "skipped" ? "Skipped" : undefined}
					>
						{STEP_LABEL[s.step]}
						{s.detail ? <span class="muted"> · {s.detail}</span> : null}
					</Check>
				))}
			</ul>
			<p class="muted">
				It is a draft, so donors can't see it until you publish.
			</p>
			<div class="row">
				<Button variant="primary" onClick={props.onOpen}>
					Open draft
				</Button>
			</div>
		</Card>
	);
}

export function CampaignCreate(props: { data: CampaignCreateData }) {
	const { host } = useSession();
	const money = useWholeMoney();
	const { data } = props;
	const [theme, setTheme] = useWidgetState<ThemeName>(
		"preset",
		data.selected,
		isTheme,
	);
	const [busy, setBusy] = useState<"create" | "customize" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [created, setCreated] = useState<CreateResult | null>(null);

	const preset = data.presets.find((p) => p.theme === theme) ?? data.presets[0];
	const byTheme = new Map(data.presets.map((p) => [p.theme, p]));

	const openEditor = (result: CreateResult) =>
		host
			.sendFollowUp(
				`Open the editor for the draft campaign "${result.campaign.title}" (id ${result.campaign.id}).`,
			)
			.catch(() =>
				setError(
					"Couldn't ask the chat to open it. Ask for the draft by name instead.",
				),
			);

	const create = async (then: "stay" | "edit") => {
		if (!preset) return;
		setBusy(then === "edit" ? "customize" : "create");
		setError(null);
		const res = await callTool(host, "app_create_campaign", preset);
		setBusy(null);
		if (!res.ok) {
			setError(res.error);
			return;
		}
		setCreated(res.data);
		if (then === "edit") await openEditor(res.data);
	};

	if (created) {
		return <Created result={created} onOpen={() => void openEditor(created)} />;
	}
	const date = useDate();
	const summary = preset
		? `${preset.title} · ${money(preset.goal)} by ${date(preset.endDate)}`
		: "";
	return (
		<Card class="create" label="Start a campaign">
			<div class="head">
				<div>
					<h2 class="title">Start a campaign</h2>
					<p class="subtitle">
						Pick a starting point. Everything stays editable — nothing goes live
						until you publish.
					</p>
				</div>
				<span class="chip chip-draft">Draft</span>
			</div>
			<RadioGroup
				class="presets"
				label="Campaign preset"
				options={THEME_NAMES}
				value={theme}
				onChange={setTheme}
				renderOption={(t, checked) => {
					const p = byTheme.get(t);
					return p ? <PresetCard preset={p} checked={checked} /> : null;
				}}
			/>
			<Recommendations data={data} />
			<p class="error-line" role="alert">
				{error}
			</p>
			<div class="foot">
				<span class="summary">{summary}</span>
				<div class="foot-actions">
					<Button
						variant="secondary"
						busy={busy === "customize"}
						disabled={busy !== null}
						onClick={() => void create("edit")}
					>
						Customize
					</Button>
					<Button
						variant="primary"
						busy={busy === "create"}
						disabled={busy !== null}
						onClick={() => void create("stay")}
					>
						Create draft
					</Button>
				</div>
			</div>
		</Card>
	);
}
