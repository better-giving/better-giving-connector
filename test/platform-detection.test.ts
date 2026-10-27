import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import { ACTIONS } from "../src/mcp/actions";
import {
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import { BASE, env, MCP_VERSIONS, mcpRequest, rpc, warmUp } from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { PLATFORM_TOOLS } from "./platform-hello";
import { advance, freshDb, MINUTE } from "./support";

// Whether a connection is Platform is read from its deployment's hello once per
// connection, not stored on the row: a row written with no platform field still
// gets Platform's tools, and a hello that fails leaves it Standalone.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let bearer: string;
let rpcId = 0;

beforeEach(async () => {
	db = await freshDb();
	deployment = fakeDeployment({ name: "Hope Shelter", platform: true });
	const app = createApp({ env, db, fetch: fakeNetwork(deployment) });
	call = async (req) => app.request(req);
	await warmUp(call);
	bearer = `Bearer ${(await connectFlow(call, deployment, BASE).connect()).access_token}`;
	deployment.calls.length = 0;
	return () => db.close();
});

afterEach(() => {
	vi.useRealTimers();
});

type Tool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};
type Result = { isError?: boolean; content: { text: string }[] };

const send = (method: string, params?: Record<string, unknown>) =>
	call(mcpRequest(MCP_VERSIONS[0], bearer, method, params, ++rpcId));

const listTools = async (): Promise<Tool[]> =>
	(await rpc(await send("tools/list"))).result.tools;

const toolNamed = async (name: string): Promise<Tool | undefined> =>
	(await listTools()).find((t) => t.name === name);

const tool = async (
	name: string,
	args: Record<string, unknown> = {},
): Promise<Result> =>
	(await rpc(await send("tools/call", { name, arguments: args }))).result;

const hellos = () =>
	deployment.calls.filter((c) => c.path === "/connector/v1/hello");

const formCreates = () =>
	deployment.calls.filter(
		(c) => c.method === "POST" && c.path === "/connector/v1/forms",
	);

const failHello = (answer: () => Response | Promise<Response>) =>
	deployment.intercept((req) =>
		new URL(req.url).pathname === "/connector/v1/hello" ? answer() : undefined,
	);

const standalonePhoto = ACTIONS.find(
	(s) => s.tool === "create_photo_upload_link",
);

test("the connection row has no platform column", async () => {
	const { rows } = await db.execute(`PRAGMA table_info("connection")`);

	expect(rows.map((r) => r.name)).not.toContain("platform");
});

test("a row written with no platform field is Platform when its hello says so", async () => {
	const tools = await listTools();
	const photo = tools.find((t) => t.name === "create_photo_upload_link");

	expect(tools.map((t) => t.name).sort()).toEqual([...PLATFORM_TOOLS].sort());
	expect(photo?.description).toContain("campaign's hero photo");
	expect(photo?.inputSchema).toMatchObject({
		properties: {
			target: {
				type: "object",
				properties: { kind: { const: "campaign" } },
				required: ["kind", "id"],
			},
			slot: { const: "hero" },
		},
		required: ["target"],
	});

	await tool("create_form", { name: "Gala" });
	expect(formCreates().at(-1)?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test.each([
	["answers 500", () => new Response("down", { status: 500 })],
	["answers 404", () => new Response("not found", { status: 404 })],
	[
		"throws",
		() => {
			throw new TypeError("fetch failed");
		},
	],
])("a hello that %s leaves the connection Standalone", async (_, answer) => {
	failHello(answer);

	const body = await rpc(await send("tools/list"));

	expect(body).not.toHaveProperty("error");
	const { result } = body;
	const photo = (result.tools as Tool[]).find(
		(t) => t.name === "create_photo_upload_link",
	);
	expect(photo?.description).toBe(standalonePhoto?.description);
	expect(JSON.stringify(photo?.inputSchema)).toContain("donation_page");

	await tool("create_form", { name: "Gala" });
	expect(formCreates().at(-1)?.idempotencyKey).toBeNull();
});

test("hello is asked once for several requests on one connection", async () => {
	await listTools();
	await tool("list_campaigns");
	await tool("create_form", { name: "Gala" });

	expect(hellos()).toHaveLength(1);
});

test("concurrent first requests share one hello", async () => {
	await Promise.all([listTools(), listTools(), tool("list_campaigns")]);

	expect(hellos()).toHaveLength(1);
});

test("a failed hello is asked again once five minutes have passed", async () => {
	failHello(() => new Response("down", { status: 500 }));
	await listTools();
	deployment.intercept(null);

	advance(4 * MINUTE);
	const meanwhile = await toolNamed("create_photo_upload_link");
	expect(meanwhile?.description).toBe(standalonePhoto?.description);
	expect(hellos()).toHaveLength(1);

	advance(1 * MINUTE + 1);
	const after = await toolNamed("create_photo_upload_link");
	expect(after?.description).toContain("campaign's hero photo");
	expect(hellos()).toHaveLength(2);

	await listTools();
	expect(hellos()).toHaveLength(2);
});

test("a hello answered as Platform is not asked again after five minutes", async () => {
	await listTools();

	advance(30 * MINUTE);
	await listTools();

	expect(hellos()).toHaveLength(1);
});
