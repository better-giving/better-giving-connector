import {
	type ActionName,
	type DeploymentClient,
	DeploymentFailed,
	DeploymentRejected,
	NeedsUpdate,
	Unreachable,
} from "../deployment";
import { formatDate, formatMoney } from "../format";
import {
	type Money,
	storyDocument,
	THEMES,
	type ThemeName,
} from "../presets/themes";
import type { ToolConnection } from "./run-tool";

export type Preset = {
	theme: ThemeName;
	goal: Money;
	/** YYYY-MM-DD */
	end_date: string;
	/** At most six. */
	suggested_amounts: Money[];
};

export const PRESET_STEPS = ["create", "settings", "form", "page"] as const;
export type PresetStep = (typeof PRESET_STEPS)[number];

export type PresetStepResult = {
	step: PresetStep;
	status: "done" | "failed" | "skipped";
	detail?: string;
};

export type PresetCreated = {
	campaign: { id: string; title: string; version?: string; status: string };
	steps: PresetStepResult[];
	failedStep: PresetStep | null;
};

export type DeploymentDeps = {
	connection: ToolConnection;
	client: Pick<DeploymentClient, "call">;
};

type Body = Record<string, unknown>;
const isBody = (value: unknown): value is Body =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const bodyOf = (value: unknown): Body => (isBody(value) ? value : {});

/** A campaign's version as Platform shows it (digits as a string), or undefined where the deployment shows none. */
export const versionOf = (campaign: Body): string | undefined =>
	typeof campaign.version === "string" ? campaign.version : undefined;
const versioned = (campaign: Body) => {
	const version = versionOf(campaign);
	return version === undefined ? {} : { expected_version: version };
};

/** A failure one step can end on; anything else (a refused key, a moved site) ends the call. */
export const isStepFailure = (error: unknown): boolean =>
	error instanceof DeploymentRejected ||
	error instanceof DeploymentFailed ||
	error instanceof Unreachable ||
	error instanceof NeedsUpdate;

export function failureDetail(error: unknown): string {
	if (error instanceof Unreachable)
		return "The site didn't answer, so this step may or may not have been saved.";
	if (error instanceof NeedsUpdate)
		return "The site can't do this through the connector yet.";
	const problem =
		error instanceof DeploymentRejected || error instanceof DeploymentFailed
			? error.problem
			: null;
	return problem?.detail ?? problem?.title ?? "The site refused this step.";
}

class StepSkipped extends Error {
	override readonly name = "StepSkipped";
}

/**
 * Creates a draft campaign and dresses it from `preset`, composing the
 * deployment's own writes: the create, the goal and end date, the campaign's
 * form's suggested amounts, then the theme's starter page. Each campaign write
 * carries the version the one before it returned. A failure on the create
 * throws as a plain create's would; one after it ends the run there and is
 * reported in the result, the draft left as it stands (donors can't see it).
 */
export async function createCampaignWithPreset(
	deps: DeploymentDeps,
	title: string,
	preset: Preset,
): Promise<PresetCreated> {
	const { connection, client } = deps;
	const serves = (action: ActionName) =>
		connection.actions === null || connection.actions.includes(action);

	const created = await client.call(connection, "campaigns.create", { title });
	let campaign = bodyOf(created.body);
	const id = String(campaign.id);
	// A replayed create answers with the campaign as it was first made.
	if (created.status === 200) {
		campaign = bodyOf(
			(await client.call(connection, "campaigns.get", { id })).body,
		);
	}

	const run: Record<Exclude<PresetStep, "create">, () => Promise<void>> = {
		settings: async () => {
			if (!serves("campaigns.update_settings"))
				throw new StepSkipped(
					"This site doesn't set a campaign's goal or end date through the connector.",
				);
			const answer = await client.call(
				connection,
				"campaigns.update_settings",
				{
					id,
					goal: preset.goal,
					end_date: preset.end_date,
					...versioned(campaign),
				},
			);
			campaign = bodyOf(answer.body);
		},
		form: () =>
			setFormAmounts(deps, serves, id, title, preset.suggested_amounts),
		page: async () => {
			campaign = await starterPage(deps, serves, campaign, id, preset.theme);
		},
	};

	const steps: PresetStepResult[] = [{ step: "create", status: "done" }];
	let failedStep: PresetStep | null = null;
	for (const step of ["settings", "form", "page"] as const) {
		if (failedStep !== null) {
			steps.push({
				step,
				status: "skipped",
				detail: `Not tried: the ${failedStep} step failed.`,
			});
			continue;
		}
		try {
			await run[step]();
			steps.push({ step, status: "done" });
		} catch (error) {
			if (error instanceof StepSkipped) {
				steps.push({ step, status: "skipped", detail: error.message });
			} else if (isStepFailure(error)) {
				failedStep = step;
				steps.push({ step, status: "failed", detail: failureDetail(error) });
			} else throw error;
		}
	}

	const version = versionOf(campaign);
	return {
		campaign: {
			id,
			title: typeof campaign.title === "string" ? campaign.title : title,
			...(version === undefined ? {} : { version }),
			status: typeof campaign.status === "string" ? campaign.status : "draft",
		},
		steps,
		failedStep,
	};
}

// The campaign's own form (its campaign_id is the campaign's) takes the
// amounts; a campaign with none gets one made with them.
async function setFormAmounts(
	{ connection, client }: DeploymentDeps,
	serves: (action: ActionName) => boolean,
	campaignId: string,
	title: string,
	amounts: Money[],
): Promise<void> {
	if (!serves("forms.list"))
		throw new StepSkipped(
			"This site doesn't list its donation forms through the connector.",
		);
	const form = await findCampaignForm({ connection, client }, campaignId);
	// Platform keeps amounts as money, Standalone as decimal strings.
	const platformShape = form
		? Object.hasOwn(form, "suggested_amounts")
		: connection.platform;
	const field = platformShape
		? { suggested_amounts: amounts }
		: { amounts: amounts.map((m) => m.amount) };
	if (form) {
		if (!serves("forms.update"))
			throw new StepSkipped(
				"This site doesn't edit donation forms through the connector.",
			);
		await client.call(connection, "forms.update", {
			id: form.id,
			...field,
			...(typeof form.updated_at === "string"
				? { updated_at: form.updated_at }
				: {}),
			// Platform holds a change to a live form for a confirm; this form
			// belongs to a draft no donor can reach, made in this same call.
			...(connection.platform ? { confirm: true } : {}),
		});
		return;
	}
	if (!serves("forms.create"))
		throw new StepSkipped(
			"This campaign has no donation form, and this site doesn't make one through the connector.",
		);
	await client.call(connection, "forms.create", {
		name: `${title} form`,
		campaign_id: campaignId,
		...field,
	});
}

const MAX_FORM_PAGES = 50;

async function findCampaignForm(
	{ connection, client }: DeploymentDeps,
	campaignId: string,
): Promise<Body | null> {
	let cursor: string | undefined;
	for (let page = 0; page < MAX_FORM_PAGES; page++) {
		const answer = bodyOf(
			(
				await client.call(connection, "forms.list", {
					limit: 100,
					...(cursor === undefined ? {} : { cursor }),
				})
			).body,
		);
		const data = Array.isArray(answer.data) ? answer.data : [];
		const found = data.find(
			(f): f is Body => isBody(f) && f.campaign_id === campaignId,
		);
		if (found) return found;
		if (typeof answer.next_cursor !== "string") return null;
		cursor = answer.next_cursor;
	}
	return null;
}

// The theme's story on the campaign's page: as blocks where the site edits
// blocks, or as content where it answers that blocks were replaced.
async function starterPage(
	{ connection, client }: DeploymentDeps,
	serves: (action: ActionName) => boolean,
	campaign: Body,
	id: string,
	theme: ThemeName,
): Promise<Body> {
	const story = THEMES[theme].story;
	const asContent = async () =>
		bodyOf(
			(
				await client.call(connection, "campaigns.update_content", {
					id,
					story: storyDocument(story),
				})
			).body,
		);
	if (serves("campaigns.update_blocks") && Array.isArray(campaign.blocks)) {
		try {
			const answer = await client.call(connection, "campaigns.update_blocks", {
				id,
				blocks: withStory(campaign.blocks, story),
				...versioned(campaign),
			});
			return bodyOf(answer.body);
		} catch (error) {
			const replaced =
				error instanceof DeploymentRejected &&
				error.status === 422 &&
				error.problem?.code === "replaced";
			if (!replaced) throw error;
			return asContent();
		}
	}
	if (serves("campaigns.update_content")) return asContent();
	throw new StepSkipped(
		"This site doesn't edit a campaign's page through the connector.",
	);
}

// Platform's page holds one `story` block of plain text; a block release's
// story is `text` blocks, one per paragraph, after the page's first block.
function withStory(blocks: unknown[], story: string): unknown[] {
	if (blocks.some((b) => isBody(b) && b.type === "story")) {
		return blocks.map((b) =>
			isBody(b) && b.type === "story" ? { ...b, text: story } : b,
		);
	}
	const kept = blocks.filter((b) => !(isBody(b) && b.type === "text"));
	const paragraphs = story
		.split("\n\n")
		.map((body) => ({ type: "text", body }));
	return [...kept.slice(0, 1), ...paragraphs, ...kept.slice(1)];
}

const STEP_TOOLS: Record<Exclude<PresetStep, "create">, string> = {
	settings: "update_campaign_settings",
	form: "update_form (or create_form)",
	page: "update_campaign_blocks or update_campaign_content",
};

/** What the chat reads of a preset create: what was made, and on a failure what is left to do and with which tool. */
export function presetCreatedText(
	created: PresetCreated,
	preset: Preset,
	org: string,
	locale: string,
): string {
	const { campaign, steps, failedStep } = created;
	const lines: string[] = [];
	if (failedStep === null) {
		const goal = formatMoney(preset.goal.amount, preset.goal.currency, locale);
		const ends = formatDate(preset.end_date, locale);
		lines.push(
			`Created a draft campaign "${campaign.title}" for ${org} from the ${THEMES[preset.theme].label.toLowerCase()} preset: goal ${goal}, ending ${ends}, with ${preset.suggested_amounts.length} suggested amounts and a starter story for the operator to replace. Donors can't see it until it's published.`,
		);
	} else {
		const failed = steps.find((s) => s.step === failedStep);
		const left = steps
			.filter((s) => s.status !== "done" && s.step !== "create")
			.map(
				(s) =>
					`${s.step} with ${STEP_TOOLS[s.step as keyof typeof STEP_TOOLS]}`,
			);
		lines.push(
			`Partly created "${campaign.title}" for ${org}: the ${failedStep} step failed. ${failed?.detail ?? ""} The draft exists, donors can't see it, and nothing was undone. Finish it by setting the ${left.join(", then ")}.`,
		);
	}
	const skipped = steps.filter(
		(s) => s.status === "skipped" && failedStep === null,
	);
	for (const s of skipped)
		lines.push(`Skipped the ${s.step} step: ${s.detail}`);
	lines.push(JSON.stringify(created));
	return lines.join("\n");
}
