import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import { actionsFor } from "../src/mcp/actions";
import {
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import {
	BASE,
	env,
	MCP_VERSIONS,
	type McpVersion,
	mcpRequest,
	rpc,
	warmUp,
} from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { PLATFORM_TOOLS } from "./platform-hello";
import { freshDb } from "./support";

// The read_only scope end to end: the chat app's authorize, the token it is
// issued, and what /mcp then offers and runs for it.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let rpcId = 0;

function serve(platform: boolean) {
	deployment = fakeDeployment({ name: "Hope Shelter", platform });
	const app = createApp({
		env,
		db,
		fetch: fakeNetwork(deployment),
		platformOrigin: deployment.origin,
	});
	call = async (req) => app.request(req);
	return warmUp(call);
}

beforeEach(async () => {
	db = await freshDb();
	await serve(false);
	return () => db.close();
});

const bearerFor = async (scope?: string) =>
	`Bearer ${(await connectFlow(call, deployment, BASE, { scope }).connect()).access_token}`;

const send = (
	bearer: string,
	method: string,
	params?: Record<string, unknown>,
	version: McpVersion = MCP_VERSIONS[0],
) => call(mcpRequest(version, bearer, method, params, ++rpcId));

const toolNames = async (bearer: string): Promise<string[]> =>
	(await rpc(await send(bearer, "tools/list"))).result.tools
		.map((t: { name: string }) => t.name)
		.sort();

const readTools = (platform: boolean) =>
	actionsFor(platform)
		.filter((s) => s.annotations.readOnlyHint === true)
		.map((s) => s.tool)
		.sort();

const expected = (platform: boolean) =>
	platform
		? [...PLATFORM_TOOLS].sort()
		: actionsFor(false)
				.map((s) => s.tool)
				.sort();

describe.each([
	["Standalone", false],
	["Platform", true],
])("a full token on %s", (_, platform) => {
	test("is issued by authorizing with the scope /mcp's challenge names, and gets every tool", async () => {
		await serve(platform);
		const challenge = await send("", "tools/list");
		const scope = /, scope="([^"]*)"/.exec(
			challenge.headers.get("www-authenticate") ?? "",
		)?.[1];

		const names = await toolNames(await bearerFor(scope));

		expect(scope).toBe("offline_access");
		expect(names).toContain("publish_campaign");
		expect(names).toEqual(expected(platform));
	});

	test("is issued by asking for offline_access alone, and gets every tool", async () => {
		await serve(platform);

		const names = await toolNames(await bearerFor("offline_access"));

		expect(names).toEqual(expected(platform));
	});
});

describe.each([
	["Standalone", false],
	["Platform", true],
])("on %s", (_, platform) => {
	test("a read-only token is offered only the read tools a full token is", async () => {
		await serve(platform);
		const full = await toolNames(await bearerFor("offline_access"));

		const names = await toolNames(await bearerFor("offline_access read_only"));

		expect(names).toEqual(full.filter((n) => readTools(platform).includes(n)));
		expect(names).toContain("list_campaigns");
		expect(names).not.toContain("create_campaign");
	});
});

describe.each(MCP_VERSIONS)("over MCP %s", (version) => {
	test("a read-only token's write call is refused and never reaches the deployment", async () => {
		const bearer = await bearerFor("offline_access read_only");
		const before = deployment.calls.length;

		const { result } = await rpc(
			await send(
				bearer,
				"tools/call",
				{ name: "create_campaign", arguments: { title: "Winter coats" } },
				version,
			),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toBe(
			"This connection to Better Giving is read-only, so create_campaign can't be used. To make changes, reconnect Better Giving in your AI assistant's connector settings without read-only access.",
		);
		expect(
			deployment.calls.slice(before).map((c) => `${c.method} ${c.path}`),
		).toEqual(["GET /connector/v1/hello"]);
	});

	test("a read-only token's read call runs on the deployment", async () => {
		const bearer = await bearerFor("offline_access read_only");

		const { result } = await rpc(
			await send(
				bearer,
				"tools/call",
				{ name: "list_campaigns", arguments: {} },
				version,
			),
		);

		expect(result.isError).toBeUndefined();
		expect(JSON.parse(result.content[0].text)).toEqual({
			data: [],
			next_cursor: null,
		});
	});

	test("a full token's write call runs on the deployment", async () => {
		const bearer = await bearerFor("offline_access");
		const before = deployment.calls.length;

		const { result } = await rpc(
			await send(
				bearer,
				"tools/call",
				{ name: "create_campaign", arguments: { title: "Winter coats" } },
				version,
			),
		);

		expect(result.isError).toBeUndefined();
		expect(
			deployment.calls.slice(before).map((c) => `${c.method} ${c.path}`),
		).toEqual(["GET /connector/v1/hello", "POST /connector/v1/campaigns"]);
	});
});
