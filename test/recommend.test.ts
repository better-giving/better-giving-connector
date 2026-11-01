import { beforeEach, expect, test } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import {
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import { BASE, env, MCP_VERSIONS, mcpRequest, rpc, warmUp } from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { freshDb } from "./support";

// recommend_campaign_presets end to end: the connector reads the org's ended
// campaigns, their results and its gifts from the fake deployment, and
// answers each field with the evidence behind it.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let bearer: string;
let rpcId = 0;

beforeEach(async () => {
	db = await freshDb();
	deployment = fakeDeployment({ name: "Hope Shelter" });
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
	return () => db.close();
});

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
	locale?: string,
): Promise<Result> =>
	(
		await rpc(
			await send("tools/call", {
				name,
				arguments: args,
				...(locale ? { _meta: { "openai/locale": locale } } : {}),
			}),
		)
	).result;

const recommend = (args: Record<string, unknown> = {}, locale?: string) =>
	tool("recommend_campaign_presets", args, locale);

const usd = (amount: string) => ({ amount, currency: "USD" });

// Three ended campaigns, two of them year-end appeals, and a live one whose
// gift counts among the gifts but whose campaign is not past.
function seedHistory() {
	const yearEnd = deployment.seedCampaign("Year-End Appeal 2024", "ended");
	const holiday = deployment.seedCampaign("Holiday giving 2025", "ended");
	const flood = deployment.seedCampaign("Flood relief", "ended");
	const live = deployment.seedCampaign("Spring gala", "published");
	for (const [amount, date, campaign_id] of [
		["100.00", "2024-11-15", yearEnd],
		["250.00", "2024-12-31", yearEnd],
		["50.00", "2025-12-01", holiday],
		["75.00", "2025-12-31", holiday],
		["300.00", "2025-06-01", flood],
		["1000.00", "2026-04-01", live],
	] as const) {
		deployment.seedGift({ amount, date, campaign_id });
	}
}

test("with enough history, each field comes from it with the evidence behind it", async () => {
	seedHistory();

	const result = await recommend();

	expect(result.isError).toBeUndefined();
	expect(result.structuredContent).toEqual({
		basedOnHistory: true,
		goal: {
			value: usd("300.00"),
			evidence: "Your 3 past campaigns raised a median of $300.00.",
		},
		suggestedAmounts: {
			value: ["50.00", "75.00", "100.00", "300.00", "1000.00"].map(usd),
			evidence:
				"Your 6 gifts had a median of $100.00, and 9 in 10 were $1,000.00 or less.",
		},
		endDays: {
			value: 45,
			evidence:
				"Your 2 past year-end appeals took gifts over a median of 39 days.",
		},
		theme: {
			value: "year_end",
			evidence:
				"2 of your past campaigns were year-end appeals, raising $475.00 together.",
		},
	});
	expect(result.content).toEqual([
		{ type: "text", text: JSON.stringify(result.structuredContent) },
		{
			type: "text",
			text: "Recommended from your history: a year-end appeal with a goal of $300.00, 5 suggested amounts and a 45-day run.",
		},
	]);
});

test("it reads only: ended campaigns, results and gifts, each a GET", async () => {
	seedHistory();

	await recommend();

	expect(
		deployment.calls.map((c) => `${c.method} ${c.path} ${JSON.stringify(c.query)}`),
	).toEqual([
		'GET /connector/v1/campaigns {"status":"ended","limit":"100"}',
		"GET /connector/v1/results {}",
		'GET /connector/v1/donations {"limit":"100"}',
	]);
});

test("money and the summary read in the request's locale, in the gifts' own currency", async () => {
	seedHistory();

	const result = await recommend({}, "de-DE");

	const body = result.structuredContent as Record<
		string,
		{ value: unknown; evidence: string }
	>;
	expect(body.goal).toEqual({
		value: usd("300.00"),
		evidence: "Your 3 past campaigns raised a median of 300,00 $.",
	});
	expect(result.content[1]?.text).toBe(
		"Recommended from your history: a year-end appeal with a goal of 300,00 $, 5 suggested amounts and a 45-day run.",
	);
});

test("below the threshold, every field is the theme's default and says it is a starting point", async () => {
	const only = deployment.seedCampaign("Spring meals", "ended");
	deployment.seedGift({ amount: "40.00", date: "2026-03-01", campaign_id: only });

	const result = await recommend({ theme: "capital" });

	expect(result.structuredContent).toEqual({
		basedOnHistory: false,
		goal: {
			value: usd("250000.00"),
			evidence:
				"$250,000.00 is a common starting goal for a capital campaign; there isn't enough history yet to base one on yours.",
		},
		suggestedAmounts: {
			value: ["100.00", "250.00", "500.00", "1000.00", "5000.00"].map(usd),
			evidence:
				"These are common amounts for a capital campaign; there isn't enough history yet to base them on your gifts.",
		},
		endDays: {
			value: 180,
			evidence:
				"180 days is a common run for a capital campaign; there isn't enough history yet to base one on yours.",
		},
		theme: { value: "capital", evidence: "You asked for a capital campaign." },
	});
	expect(result.content[1]?.text).toBe(
		"Starting points for a capital campaign, with too little history to tune them: a goal of $250,000.00, 5 suggested amounts and a 180-day run.",
	);
});

test("an empty org gets the year-end starting points without asking for results", async () => {
	const result = await recommend({}, "de-DE");

	expect(result.isError).toBeUndefined();
	const body = result.structuredContent as Record<string, unknown>;
	expect(body.basedOnHistory).toBe(false);
	expect(body.theme).toEqual({
		value: "year_end",
		evidence:
			"There isn't enough history yet to point to one kind of appeal, so a year-end appeal is a starting point.",
	});
	expect(result.content[1]?.text).toBe(
		"Starting points for a year-end appeal, with too little history to tune them: a goal of 50.000,00 $, 5 suggested amounts and a 45-day run.",
	);
	expect(deployment.calls.map((c) => c.path)).toEqual([
		"/connector/v1/campaigns",
		"/connector/v1/donations",
	]);
});

test("a deployment's failure is worded as get_results words the same failure", async () => {
	seedHistory();
	deployment.intercept((req) =>
		new URL(req.url).pathname === "/connector/v1/results"
			? Response.json(
					{ type: "about:blank", title: "Server error", status: 500 },
					{ status: 500, headers: { "content-type": "application/problem+json" } },
				)
			: undefined,
	);

	const recommended = await recommend();
	const results = await tool("get_results");

	expect(recommended.isError).toBe(true);
	expect(recommended.structuredContent).toBeUndefined();
	expect(recommended.content).toEqual(results.content);
	expect(results.isError).toBe(true);
});

test("a site that doesn't answer is worded as an action tool's", async () => {
	seedHistory();
	deployment.loseAnswers(10);

	const recommended = await recommend();

	expect(recommended.isError).toBe(true);
	expect(recommended.content[0]?.text).toBe(
		"Hope Shelter's donation site didn't answer. Try again in a moment.",
	);
});
