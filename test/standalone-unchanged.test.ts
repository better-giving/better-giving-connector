import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import {
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import { BASE, env, mcpOpen, mcpRequest, rpc, warmUp } from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import ADDITIONS from "./standalone-additions.json";
import STANDALONE from "./standalone-tools.json";
import { freshDb } from "./support";

// Platform's writes change what Platform connections see and send; a
// Standalone connection sees and sends what it did before them.
//
// standalone-tools.json is the part that must not move: tools/list and the
// instructions as they stood at d1a35fb, plus each tool's title and
// annotations, every description and input schema included.
// It is never re-dumped; a deliberate Standalone change edits the entry it
// changes, and `git diff d1a35fb -- test/standalone-tools.json` shows exactly
// that. standalone-additions.json is what was added on top, each piece named:
// an outputSchema and _meta on every tool, six overwriting tools no longer
// destructiveHint, create_campaign's optional preset, and the tools
// added since. Those may be re-dumped when a tool is added.

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
	return () => db.close();
});

const send = (method: string, params?: Record<string, unknown>) =>
	call(mcpRequest("2025-06-18", bearer, method, params, ++rpcId));

const tool = async (name: string, args: Record<string, unknown>) =>
	(await rpc(await send("tools/call", { name, arguments: args }))).result;

test("tools/list and the instructions are as before, every description and input schema included", async () => {
	const opened = await rpc(await call(mcpOpen("2025-06-18", bearer)));
	const listed = await rpc(await send("tools/list"));

	const before = new Map<string, Record<string, unknown>>(
		STANDALONE.tools.map((t) => [t.name, t]),
	);
	const now = (name: string) => {
		const kept = before.get(name);
		if (!kept) return ADDITIONS.addedTools.find((t) => t.name === name);
		const schema = structuredClone(kept.inputSchema) as {
			properties: Record<string, unknown>;
		};
		if (name === "create_campaign")
			schema.properties.preset = ADDITIONS.createCampaignPreset;
		return {
			...kept,
			inputSchema: schema,
			annotations: {
				...(kept.annotations as object),
				...(ADDITIONS.annotationChanges as Record<string, object>)[name],
			},
			...(ADDITIONS.changedTools as Record<string, object>)[name],
		};
	};
	expect(opened.result.instructions).toBe(STANDALONE.instructions);
	expect(listed.result.tools).toEqual(ADDITIONS.order.map(now));
});

test("create_form sends no Idempotency-Key and is tried once while the site says in progress", async () => {
	// Hello is asked on the connection's first request; only the create is under test.
	await send("tools/list");
	deployment.calls.length = 0;
	const problem = { code: "idempotency_in_progress" };
	deployment.intercept(
		() =>
			new Response(JSON.stringify(problem), {
				status: 409,
				headers: {
					"content-type": "application/problem+json",
					"retry-after": "1",
				},
			}),
	);

	const result = await tool("create_form", { name: "Gala" });

	expect(deployment.calls).toMatchObject([
		{
			method: "POST",
			path: "/connector/v1/forms",
			idempotencyKey: null,
			body: { name: "Gala" },
		},
	]);
	expect(result.content).toEqual([
		{ type: "text", text: JSON.stringify(problem) },
	]);
});

test("create_form whose answer is lost is tried once, with no Idempotency-Key", async () => {
	await send("tools/list");
	deployment.calls.length = 0;
	deployment.loseAnswers(1);

	const result = await tool("create_form", { name: "Gala" });

	expect(deployment.calls).toMatchObject([
		{ method: "POST", path: "/connector/v1/forms", idempotencyKey: null },
	]);
	expect(result.isError).toBe(true);
});

describe("a refusal is the problem alone, with no Platform advice before it", () => {
	// Hello is asked before the blanket intercept, so the connection is
	// Standalone because the site is, not because its hello failed.
	beforeEach(async () => {
		await send("tools/list");
	});

	test.each([
		{
			name: "update_campaign_settings",
			args: { id: "cmp_1" },
			code: "stale_read",
		},
		{
			name: "update_form",
			args: { id: "frm_1", name: "Main" },
			code: "stale_read",
		},
		{
			name: "update_form",
			args: { id: "frm_1", name: "Main" },
			code: "confirm_required",
		},
		{ name: "publish_campaign", args: { id: "cmp_1" }, code: "campaign_ended" },
		{
			name: "publish_campaign",
			args: { id: "cmp_1" },
			code: "already_published",
		},
		{
			name: "create_form",
			args: { name: "Gala" },
			code: "idempotency_conflict",
		},
	])("$name answered 409 $code", async ({ name, args, code }) => {
		const problem = { title: "Refused", code };
		deployment.intercept(() =>
			Response.json(problem, {
				status: 409,
				headers: { "content-type": "application/problem+json" },
			}),
		);

		const result = await tool(name, args);

		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify(problem) },
		]);
	});

	test("update_campaign_blocks answered 422 on a hero image", async () => {
		const problem = {
			title: "Invalid",
			code: "invalid",
			errors: [{ path: "blocks.0.image_url", message: "not this campaign's" }],
		};
		deployment.intercept(() =>
			Response.json(problem, {
				status: 422,
				headers: { "content-type": "application/problem+json" },
			}),
		);

		const result = await tool("update_campaign_blocks", {
			id: "cmp_1",
			blocks: [{ type: "hero", image_url: null }],
		});

		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify(problem) },
		]);
	});
});
