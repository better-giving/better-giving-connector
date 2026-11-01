import { expect, test } from "vitest";
import type { ActionName } from "../deployment";
import { parseOrigin } from "../deployment/origin";
import { Secret } from "../secret";
import { createCampaignWithPreset, type Preset } from "./campaign-presets";
import type { ToolConnection } from "./run-tool";

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

test("a create that replays an earlier one reads the campaign afresh, so the settings write carries its current version", async () => {
	const { sent, client } = scripted({
		"campaigns.create": () => CAMPAIGN,
		"campaigns.get": () => ({ ...CAMPAIGN, version: "8" }),
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

	expect(
		sent.find((s) => s.action === "campaigns.update_settings")?.input,
	).toMatchObject({ expected_version: "8" });
	expect(created.campaign.version).toBe("10");
});
