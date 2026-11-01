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
import { countRows, freshDb } from "./support";

// Edits to a live Platform campaign, end to end: kept by the connector as a
// draft, shown beside the campaign, and sent when it is published again.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let bearer: string;
let rpcId = 0;

beforeEach(async () => {
	db = await freshDb();
	deployment = fakeDeployment({ name: "Hope Shelter", platform: true });
	const app = createApp({
		env,
		db,
		fetch: fakeNetwork(deployment),
		platformOrigin: deployment.origin,
	});
	call = async (req) => app.request(req);
	await warmUp(call);
	bearer = `Bearer ${(await connectFlow(call, deployment, BASE).connect()).access_token}`;
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
): Promise<Result> =>
	(await rpc(await send("tools/call", { name, arguments: args }))).result;

type Campaign = {
	id: string;
	version: string;
	status: string;
	blocks: Record<string, unknown>[];
	settings: { goal: unknown; end_date: string | null };
};

const usd = (amount: string) => ({ amount, currency: "USD" });

const get = async (id: string) =>
	(await tool("get_campaign", { id })).structuredContent as Campaign & {
		pendingDraft?: Record<string, unknown>;
	};

/** A live campaign, its goal set before it went live. */
async function live(): Promise<Campaign> {
	const k = (await tool("create_campaign", { title: "Winter coats" }))
		.structuredContent as Campaign;
	await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("1000.00"),
	});
	await tool("publish_campaign", { id: k.id, gifts_go_to: null });
	deployment.calls.length = 0;
	return get(k.id);
}

const writes = () =>
	deployment.calls
		.filter((c) => c.method !== "GET")
		.map((c) => ({ method: c.method, path: c.path, body: c.body }));

const withStory = (k: Campaign, story: string) =>
	k.blocks.map((b) => (b.type === "story" ? { ...b, text: story } : b));

test("an edit to a live campaign's settings is kept as a draft and nothing is sent", async () => {
	const k = await live();

	const result = await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("5000.00"),
		expected_version: k.version,
	});

	expect(result.isError).toBeUndefined();
	expect(result.structuredContent).toEqual({
		saved: "draft",
		campaign_id: k.id,
		base_version: k.version,
	});
	expect(result.content[0]?.text).toMatch(/saved as a draft/);
	expect(writes()).toEqual([]);
	expect((await get(k.id)).settings.goal).toEqual(usd("1000.00"));
});
