import { expect, test } from "vitest";
import { type ActionName, DeploymentRejected } from "../deployment";
import { parseOrigin } from "../deployment/origin";
import { storyDocument, THEMES } from "../presets/themes";
import { Secret } from "../secret";
import { createCampaignWithPreset, type Preset } from "./campaign-presets";
import type { ToolConnection } from "./run-tool";
import { ToolRefusal } from "./spec";

const origin = parseOrigin("https://give.example.org");
if (!origin) throw new Error("bad origin");
const connection: ToolConnection = {
	userId: "user_1",
	origin,
	orgName: "Give",
	actions: null,
	platform: true,
	key: new Secret("bgk_test"),
	createdAt: new Date(),
};
const usd = (amount: string) => ({ amount, currency: "USD" as const });
const PRESET: Preset = {
	theme: "giving_day",
	goal: usd("5000.00"),
	end_date: "2026-12-02",
	suggested_amounts: [usd("10.00"), usd("20.00")],
};
const CAMPAIGN = {
	id: "cmp_9",
	title: "Giving day",
	status: "draft",
	version: "4",
	blocks: [{ type: "story", text: "" }],
};

/** A client answering each action from `answers`, recording what it was sent. */
function scripted(
	answers: Partial<
		Record<ActionName, (input: Record<string, unknown>) => unknown>
	>,
	status: Partial<Record<ActionName, number>> = {},
) {
	const sent: { action: ActionName; input: Record<string, unknown> }[] = [];
	return {
		sent,
		client: {
			async call(
				_: unknown,
				action: ActionName,
				input: Record<string, unknown>,
			) {
				sent.push({ action, input });
				const answer = answers[action];
				if (!answer) throw new Error(`unexpected ${action}`);
				return { status: status[action] ?? 200, body: answer(input) };
			},
		},
	};
}

test("the campaign's form is found by paging forms.list with next_cursor", async () => {
	const { sent, client } = scripted(
		{
			"campaigns.create": () => CAMPAIGN,
			"campaigns.update_settings": () => ({ ...CAMPAIGN, version: "5" }),
			"forms.list": ({ cursor }) =>
				cursor === undefined
					? { data: [{ id: "frm_a", campaign_id: null }], next_cursor: "p2" }
					: {
							data: [
								{
									id: "frm_b",
									campaign_id: "cmp_9",
									suggested_amounts: [],
									updated_at: "2026-10-01T00:00:00.000Z",
								},
							],
							next_cursor: null,
						},
			"forms.update": () => ({}),
			"campaigns.update_blocks": () => ({ ...CAMPAIGN, version: "6" }),
		},
		{ "campaigns.create": 201 },
	);

	const created = await createCampaignWithPreset(
		{ connection, client },
		"Giving day",
		PRESET,
	);

	expect(created.failedStep).toBeNull();
	expect(
		sent.filter((s) => s.action === "forms.list").map((s) => s.input),
	).toEqual([{ limit: 100 }, { limit: 100, cursor: "p2" }]);
	expect(sent.find((s) => s.action === "forms.update")?.input).toEqual({
		id: "frm_b",
		suggested_amounts: PRESET.suggested_amounts,
		updated_at: "2026-10-01T00:00:00.000Z",
		confirm: true,
	});
});

test("a replayed create reads the draft afresh and fills in only what it still lacks, on its current version", async () => {
	const { sent, client } = scripted({
		"campaigns.create": () => CAMPAIGN,
		"campaigns.get": () => ({
			...CAMPAIGN,
			version: "8",
			settings: { goal: usd("900.00"), end_date: null },
		}),
		"campaigns.update_settings": () => ({ ...CAMPAIGN, version: "9" }),
		"forms.list": () => ({ data: [], next_cursor: null }),
		"forms.create": () => ({}),
		"campaigns.update_blocks": () => ({ ...CAMPAIGN, version: "10" }),
	});

	const created = await createCampaignWithPreset(
		{ connection, client },
		"Giving day",
		PRESET,
	);

	expect(created.replayed).toBe(true);
	expect(
		sent.find((s) => s.action === "campaigns.update_settings")?.input,
	).toEqual({ id: "cmp_9", end_date: "2026-12-02", expected_version: "8" });
	expect(created.steps[1]).toEqual({
		step: "settings",
		status: "done",
		detail: "Set the end date only: the campaign already had a goal.",
	});
	expect(sent.map((s) => s.action)).toContain("forms.create");
	expect(
		sent.find((s) => s.action === "campaigns.update_blocks")?.input,
	).toMatchObject({ expected_version: "9" });
	expect(created.campaign.version).toBe("10");
});

test("a replayed create onto a draft already filled in overwrites nothing and says it replayed", async () => {
	const { sent, client } = scripted({
		"campaigns.create": () => CAMPAIGN,
		"campaigns.get": () => ({
			...CAMPAIGN,
			version: "8",
			settings: { goal: usd("900.00"), end_date: "2027-01-15" },
			blocks: [{ type: "story", text: "Our own words." }],
		}),
		"forms.list": () => ({
			data: [{ id: "frm_b", campaign_id: "cmp_9", suggested_amounts: [] }],
			next_cursor: null,
		}),
	});

	const created = await createCampaignWithPreset(
		{ connection, client },
		"Giving day",
		PRESET,
	);

	expect(created.replayed).toBe(true);
	expect(created.failedStep).toBeNull();
	expect(created.steps.map((s) => s.status)).toEqual([
		"done",
		"skipped",
		"skipped",
		"skipped",
	]);
	expect(sent.map((s) => s.action)).toEqual([
		"campaigns.create",
		"campaigns.get",
		"forms.list",
	]);
});

const replaced = new DeploymentRejected(422, {
	title: "replaced",
	code: "replaced",
});

test.each([
	[true, { expected_version: "5" }],
	[false, {}],
])(
	"the story sent as content after blocks answer replaced carries the version on Platform (%s) alone",
	async (platform, version) => {
		const { sent, client } = scripted(
			{
				"campaigns.create": () => CAMPAIGN,
				"campaigns.update_settings": () => ({ ...CAMPAIGN, version: "5" }),
				"forms.list": () => ({ data: [], next_cursor: null }),
				"forms.create": () => ({}),
				"campaigns.update_blocks": () => {
					throw replaced;
				},
				"campaigns.update_content": () => ({ ...CAMPAIGN, version: "6" }),
			},
			{ "campaigns.create": 201 },
		);

		const created = await createCampaignWithPreset(
			{ connection: { ...connection, platform }, client },
			"Giving day",
			PRESET,
		);

		expect(created.failedStep).toBeNull();
		expect(
			sent.find((s) => s.action === "campaigns.update_content")?.input,
		).toEqual({
			id: "cmp_9",
			story: storyDocument(THEMES.giving_day.story),
			...version,
		});
	},
);

test("a replayed create on a campaign that is no longer a draft leaves it untouched and says it exists", async () => {
	const { sent, client } = scripted({
		"campaigns.create": () => CAMPAIGN,
		"campaigns.get": () => ({ ...CAMPAIGN, status: "published", version: "8" }),
	});

	const refused = createCampaignWithPreset(
		{ connection, client },
		"Giving day",
		PRESET,
	);

	await expect(refused).rejects.toBeInstanceOf(ToolRefusal);
	await expect(refused).rejects.toMatchObject({
		text: expect.stringContaining('"Giving day" already exists'),
	});
	expect(sent.map((s) => s.action)).toEqual([
		"campaigns.create",
		"campaigns.get",
	]);
});
