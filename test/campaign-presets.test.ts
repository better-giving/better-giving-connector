import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import { storyDocument, THEMES } from "../src/presets/themes";
import {
	CONTENT_ACTIONS,
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import { BASE, env, MCP_VERSIONS, mcpRequest, rpc, warmUp } from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { freshDb } from "./support";

// create_campaign with a preset, end to end: the connector composes the
// deployment's own writes, in order, against a fake keeping each stack's rules.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let bearer: string;
let rpcId = 0;

async function serve(opts: { platform: boolean; actions?: readonly string[] }) {
	db = await freshDb();
	deployment = fakeDeployment({
		name: "Hope Shelter",
		platform: opts.platform,
	});
	if (opts.actions) deployment.setActions(opts.actions);
	const app = createApp({
		env,
		db,
		fetch: fakeNetwork(deployment),
		platformOrigin: deployment.origin,
	});
	call = async (req) => app.request(req);
	await warmUp(call);
	bearer = `Bearer ${(await connectFlow(call, deployment, BASE).connect()).access_token}`;
	// hello is asked on the connection's first request; only the tool is under test
	await send("tools/list");
	deployment.calls.length = 0;
}

type Result = {
	isError?: boolean;
	content: { text: string }[];
	structuredContent?: Record<string, unknown>;
};

const send = (method: string, params?: Record<string, unknown>) =>
	call(mcpRequest(MCP_VERSIONS[0], bearer, method, params, ++rpcId));

const tool = async (
	name: string,
	args: Record<string, unknown> = {},
): Promise<Result> =>
	(await rpc(await send("tools/call", { name, arguments: args }))).result;

const usd = (amount: string) => ({ amount, currency: "USD" });
const PRESET = {
	theme: "emergency",
	goal: usd("30000.00"),
	end_date: "2026-12-31",
	suggested_amounts: [usd("25.00"), usd("75.00"), usd("150.00")],
};
const STORY = THEMES.emergency.story;

const writes = () =>
	deployment.calls
		.filter((c) => c.method !== "GET" || c.path.endsWith("/forms"))
		.map((c) => ({ method: c.method, path: c.path, body: c.body }));

const failNext = (
	method: string,
	path: RegExp,
	status = 422,
	code = "invalid",
) =>
	deployment.intercept((req) =>
		req.method === method && path.test(new URL(req.url).pathname)
			? Response.json(
					{ title: code, code, detail: "Refused by the test." },
					{
						status,
						headers: { "content-type": "application/problem+json" },
					},
				)
			: undefined,
	);

describe("on Platform", () => {
	beforeEach(async () => {
		await serve({ platform: true });
		return () => db.close();
	});

	test("creates, sets the goal and end date, the form's amounts and the starter page, each write on the version the one before returned", async () => {
		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.isError).toBeUndefined();
		expect(writes()).toEqual([
			{
				method: "POST",
				path: "/connector/v1/campaigns",
				body: { title: "Flood relief" },
			},
			{
				method: "PATCH",
				path: "/connector/v1/campaigns/cmp_1/settings",
				body: {
					goal: PRESET.goal,
					end_date: "2026-12-31",
					expected_version: "1",
				},
			},
			{ method: "GET", path: "/connector/v1/forms", body: null },
			{
				method: "PATCH",
				path: "/connector/v1/forms/frm_2",
				body: expect.objectContaining({
					suggested_amounts: PRESET.suggested_amounts,
				}),
			},
			{
				method: "PATCH",
				path: "/connector/v1/campaigns/cmp_1/blocks",
				body: {
					blocks: [
						{ type: "title", text: "Flood relief" },
						{ type: "story", text: STORY },
						{ type: "hero", image_url: null },
						{ type: "goal-bar", goal: PRESET.goal },
					],
					expected_version: "2",
				},
			},
		]);
		expect(result.structuredContent).toEqual({
			campaign: {
				id: "cmp_1",
				title: "Flood relief",
				version: "3",
				status: "draft",
			},
			steps: [
				{ step: "create", status: "done" },
				{ step: "settings", status: "done" },
				{ step: "form", status: "done" },
				{ step: "page", status: "done" },
			],
			failedStep: null,
			replayed: false,
		});
		expect(result.content[0]?.text).toMatch(
			/^Created a draft campaign "Flood relief" for Hope Shelter/,
		);
	});

	test("the same preset create again replays onto the first draft, overwrites nothing, and says no new draft was made", async () => {
		await tool("create_campaign", { title: "Flood relief", preset: PRESET });
		const story = "Our own words.";
		await tool("update_campaign_blocks", {
			id: "cmp_1",
			blocks: [
				{ type: "title", text: "Flood relief" },
				{ type: "story", text: story },
				{ type: "hero", image_url: null },
				{ type: "goal-bar", goal: PRESET.goal },
			],
		});
		deployment.calls.length = 0;

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.isError).toBeUndefined();
		expect(writes().filter((w) => w.method !== "GET")).toEqual([
			expect.objectContaining({
				method: "POST",
				path: "/connector/v1/campaigns",
			}),
		]);
		expect(result.structuredContent).toMatchObject({
			replayed: true,
			failedStep: null,
		});
		expect(result.content[0]?.text).toMatch(
			/^A draft campaign "Flood relief" already exists for Hope Shelter, so no new one was made\./,
		);
		expect(result.content[1]?.text).toBe("Already created: Flood relief");
	});

	test("the card's Create draft pressed again for the same title says the draft already exists", async () => {
		const args = {
			title: "Flood relief",
			theme: "emergency",
			goal: PRESET.goal,
			endDate: PRESET.end_date,
			suggestedAmounts: PRESET.suggested_amounts,
		};
		await tool("app_create_campaign", args);

		const again = await tool("app_create_campaign", args);

		expect(again.structuredContent).toMatchObject({ replayed: true });
		expect(again.content[1]?.text).toBe("Already created: Flood relief");
	});

	test("a campaign with no form gets one made for it, holding the amounts", async () => {
		deployment.setCampaignForms(false);

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.structuredContent?.failedStep).toBeNull();
		expect(writes()[3]).toEqual({
			method: "POST",
			path: "/connector/v1/forms",
			body: {
				name: "Flood relief form",
				campaign_id: "cmp_1",
				suggested_amounts: PRESET.suggested_amounts,
			},
		});
		const forms = (await tool("list_forms")).structuredContent?.data as {
			campaign_id: string | null;
			suggested_amounts?: unknown;
		}[];
		expect(forms.find((f) => f.campaign_id === "cmp_1")).toMatchObject({
			suggested_amounts: PRESET.suggested_amounts,
		});
	});

	test.each([
		[
			"settings",
			"PATCH",
			/\/settings$/,
			["done", "failed", "skipped", "skipped"],
			"1",
		],
		["form", "PATCH", /\/forms\//, ["done", "done", "failed", "skipped"], "2"],
		["page", "PATCH", /\/blocks$/, ["done", "done", "done", "failed"], "2"],
	])(
		"a refused %s step answers with the draft as it stands and that step failed, and undoes nothing",
		async (step, method, path, statuses, version) => {
			failNext(method, path);

			const result = await tool("create_campaign", {
				title: "Flood relief",
				preset: PRESET,
			});

			expect(result.isError).toBeUndefined();
			expect(result.structuredContent).toMatchObject({
				campaign: {
					id: "cmp_1",
					title: "Flood relief",
					version,
					status: "draft",
				},
				failedStep: step,
			});
			const steps = result.structuredContent?.steps as {
				status: string;
				detail?: string;
			}[];
			expect(steps.map((s) => s.status)).toEqual(statuses);
			expect(steps.find((s) => s.status === "failed")?.detail).toBe(
				"Refused by the test.",
			);
			expect(result.content[0]?.text).toMatch(
				new RegExp(
					`^Partly created "Flood relief" for Hope Shelter: the ${step} step failed\\.`,
				),
			);
			expect(
				deployment.calls.some(
					(c) => c.method === "POST" && c.path.endsWith("/end"),
				),
			).toBe(false);
			deployment.intercept(null);
			const listed = await tool("list_campaigns");
			expect(listed.structuredContent?.data).toHaveLength(1);
		},
	);

	test("a refused create is today's error, with nothing else tried", async () => {
		failNext("POST", /\/campaigns$/);

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.isError).toBe(true);
		expect(deployment.calls).toHaveLength(1);
	});

	test("a seventh suggested amount is refused before anything is sent", async () => {
		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: {
				...PRESET,
				suggested_amounts: ["5", "10", "25", "50", "100", "250", "500"].map(
					(n) => usd(`${n}.00`),
				),
			},
		});

		expect(result.isError).toBe(true);
		expect(deployment.calls).toEqual([]);
	});

	test("without a preset, create_campaign sends the title alone and answers as before", async () => {
		const result = await tool("create_campaign", { title: "Flood relief" });

		expect(writes()).toEqual([
			{
				method: "POST",
				path: "/connector/v1/campaigns",
				body: { title: "Flood relief" },
			},
		]);
		expect(result.structuredContent).toMatchObject({
			id: "cmp_1",
			title: "Flood relief",
			status: "draft",
		});
		expect(result.content[1]?.text).toBe("Draft created: Flood relief");
	});
});

describe("on Standalone", () => {
	test("the content release answers blocks replaced, so the story goes in as content", async () => {
		await serve({ platform: false, actions: CONTENT_ACTIONS });

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.structuredContent?.failedStep).toBeNull();
		expect(writes()).toEqual([
			expect.objectContaining({
				method: "POST",
				path: "/connector/v1/campaigns",
			}),
			{
				method: "PATCH",
				path: "/connector/v1/campaigns/cmp_1/settings",
				body: { goal: PRESET.goal, end_date: "2026-12-31" },
			},
			{ method: "GET", path: "/connector/v1/forms", body: null },
			{
				method: "PATCH",
				path: "/connector/v1/forms/frm_2",
				body: { amounts: ["25.00", "75.00", "150.00"] },
			},
			{
				method: "PATCH",
				path: "/connector/v1/campaigns/cmp_1/content",
				body: { story: storyDocument(STORY) },
			},
		]);
		db.close();
	});

	test("a page that shows blocks but whose block edit answers 422 replaced gets the story as content", async () => {
		await serve({ platform: false });
		failNext("PATCH", /\/blocks$/, 422, "replaced");

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.structuredContent?.failedStep).toBeNull();
		expect(writes().slice(-2)).toEqual([
			expect.objectContaining({ path: "/connector/v1/campaigns/cmp_1/blocks" }),
			{
				method: "PATCH",
				path: "/connector/v1/campaigns/cmp_1/content",
				body: { story: storyDocument(STORY) },
			},
		]);
		db.close();
	});

	test("a block release gets the story as text blocks after the page's first block", async () => {
		await serve({ platform: false });

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		expect(result.structuredContent?.failedStep).toBeNull();
		expect(writes().at(-1)).toEqual({
			method: "PATCH",
			path: "/connector/v1/campaigns/cmp_1/blocks",
			body: {
				blocks: [
					{ type: "hero", heading: "Support our work", subheading: null },
					...STORY.split("\n\n").map((body) => ({ type: "text", body })),
					{ type: "goal_meter" },
					{ type: "donate_form", form_id: "frm_2" },
				],
			},
		});
		db.close();
	});

	test("a site that doesn't serve settings skips that step and says why", async () => {
		await serve({
			platform: false,
			actions: CONTENT_ACTIONS.filter((a) => a !== "campaigns.update_settings"),
		});

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		const steps = result.structuredContent?.steps as {
			step: string;
			status: string;
			detail?: string;
		}[];
		expect(steps[1]).toEqual({
			step: "settings",
			status: "skipped",
			detail: expect.stringContaining("goal or end date"),
		});
		expect(result.structuredContent?.failedStep).toBeNull();
		db.close();
	});

	test("the answer's first line names only the steps that finished", async () => {
		await serve({
			platform: false,
			actions: CONTENT_ACTIONS.filter((a) => a !== "campaigns.update_settings"),
		});

		const result = await tool("create_campaign", {
			title: "Flood relief",
			preset: PRESET,
		});

		const [first, second] = (result.content[0]?.text ?? "").split("\n");
		expect(first).toBe(
			`Created a draft campaign "Flood relief" for Hope Shelter from the emergency appeal preset: 3 suggested amounts and a starter story for the operator to replace. Donors can't see it until it's published.`,
		);
		expect(second).toMatch(/^Skipped the settings step: /);
		db.close();
	});
});
