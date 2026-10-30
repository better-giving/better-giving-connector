import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import {
	ALL_ACTIONS,
	type FakeDeployment,
	fakeDeployment,
} from "../../test/fake-deployment";
import { mcpRequest, rpc } from "../../test/harness";
import { PLATFORM_HELLO, PLATFORM_TOOLS } from "../../test/platform-hello";
import { advance, freshDb, MINUTE } from "../../test/support";
import { type Connections, connections, type Db } from "../db";
import { type ActionName, deploymentClient } from "../deployment";
import type { Origin } from "../deployment/origin";
import type { Secret } from "../secret";
import { ACTIONS } from "./actions";
import { mcpRoute } from "./index";

// mcpRoute on its own: the real tools, a stub for who is signed in. The whole
// service, OAuth included, is test/tools.test.ts's.

const USER = "user_1";

let db: Db;
let deployment: FakeDeployment;
let key: Secret;
let store: Connections;
let signedInAs: string | null;
// what the signed-in token was granted
let readOnly: boolean;
let dropped: string[];
let route: ReturnType<typeof mcpRoute>;

// Re-stores USER's connection with the actions its deployment serves, as a new
// connect would: null for a connection made before actions were stored.
async function reconnect(actions: ActionName[] | null) {
	await store.delete(USER);
	await store.insert({
		userId: USER,
		origin: deployment.origin,
		orgName: "Give Example",
		actions,
		key,
	});
}

beforeEach(async () => {
	db = await freshDb();
	deployment = fakeDeployment({ name: "Give Example" });
	const client = deploymentClient({ fetch: deployment.fetch });
	key = (await client.exchange(deployment.origin, deployment.mintCode())).key;
	store = connections(db, "test-connection-key-secret-aaaaaaaaaaaa");
	await store.insert({
		userId: USER,
		origin: deployment.origin,
		orgName: "Give Example",
		actions: null,
		key,
	});
	signedInAs = USER;
	readOnly = false;
	dropped = [];
	route = mcpRoute({
		auth: {
			authenticateMcp: async () =>
				signedInAs === null ? null : { userId: signedInAs, readOnly },
			dropConnection: async (userId) => {
				dropped.push(userId);
			},
		},
		connections: store,
		client,
		resource: new URL("https://connect.example/mcp"),
	});
	return () => db.close();
});

// The route answers at its own root; app.ts mounts it at /mcp.
const send = (method: string, params?: Record<string, unknown>) =>
	route.request(
		new Request(
			"https://connect.example/",
			mcpRequest("2025-06-18", "Bearer any", method, params),
		),
	);

test("a tool call runs its action on the connection's deployment with its key", async () => {
	const res = await send("tools/call", {
		name: "list_campaigns",
		arguments: { status: "draft" },
	});

	const { result } = await rpc(res);
	expect(JSON.parse(result.content[0].text.split("\n").at(-1))).toEqual({
		data: [],
		next_cursor: null,
	});
	// An empty filtered list is followed by an unfiltered one, for its counts.
	expect(deployment.calls.at(-2)).toMatchObject({
		path: "/connector/v1/campaigns",
		query: { status: "draft" },
		authorization: `Bearer ${key.reveal()}`,
	});
});

test("a refused key drops the signed-in user's connection and nobody else's", async () => {
	deployment.refuseKeys();

	const res = await send("tools/call", { name: "list_campaigns" });

	expect((await rpc(res)).result.isError).toBe(true);
	expect(dropped).toEqual([USER]);
});

test("a signed-in user with no connection is asked to sign in again and the leftovers are dropped", async () => {
	signedInAs = "user_without_a_row";

	const res = await send("tools/list");

	expect(res.status).toBe(401);
	expect(res.headers.get("www-authenticate")).toContain(
		'resource_metadata="https://connect.example/.well-known/oauth-protected-resource/mcp"',
	);
	expect(dropped).toEqual(["user_without_a_row"]);
	expect(deployment.calls).toHaveLength(1);
});

test("no signed-in user is asked to sign in and nothing is dropped", async () => {
	signedInAs = null;

	const res = await send("tools/list");

	expect(res.status).toBe(401);
	expect(dropped).toEqual([]);
});

test("the sign-in challenge names offline_access as the scope to request", async () => {
	signedInAs = null;

	const res = await send("tools/list");

	expect(res.headers.get("www-authenticate")).toMatch(
		/, scope="offline_access",/,
	);
});

const toolNames = async (): Promise<string[]> =>
	(await rpc(await send("tools/list"))).result.tools.map(
		(t: { name: string }) => t.name,
	);

test("a connection with no stated actions offers every tool", async () => {
	await reconnect(null);

	const names = await toolNames();

	expect(names).toHaveLength(ACTIONS.length);
});

test("tools/list offers only the tools whose action the deployment serves", async () => {
	const serves = ALL_ACTIONS.filter((a) => a !== "photos.upload_link");
	await reconnect(serves);

	const names = await toolNames();

	expect(names).not.toContain("create_photo_upload_link");
	expect(names).toContain("publish_campaign");
	expect(names).toContain("list_campaigns");
	expect(names).toHaveLength(serves.length);
});

test("tools/list offers a Platform deployment's tools from the tool names its hello lists", async () => {
	deployment.intercept((req) =>
		new URL(req.url).pathname === "/connector/v1/hello"
			? Response.json(PLATFORM_HELLO)
			: undefined,
	);
	const { actions } = await deploymentClient({
		fetch: deployment.fetch,
	}).hello(deployment.origin);
	await reconnect(actions);

	expect((await toolNames()).sort()).toEqual([...PLATFORM_TOOLS].sort());
});

const READ_TOOLS: string[] = ACTIONS.filter(
	(s) => s.annotations.readOnlyHint,
).map((s) => s.tool);

test("a read-only token is offered only the read tools", async () => {
	await reconnect(null);
	readOnly = true;

	const names = await toolNames();

	expect(names.sort()).toEqual([...READ_TOOLS].sort());
	expect(names).toContain("list_campaigns");
	expect(names).not.toContain("publish_campaign");
});

test("a read-only token's tools are listed as a full token lists them", async () => {
	await reconnect(null);
	const full = (await rpc(await send("tools/list"))).result.tools;
	readOnly = true;

	const { tools } = (await rpc(await send("tools/list"))).result;

	expect(tools).toEqual(
		full.filter((t: { name: string }) => READ_TOOLS.includes(t.name)),
	);
});

test("a read-only token's write call is refused without reaching the deployment", async () => {
	await reconnect(null);
	readOnly = true;
	const before = deployment.calls.length;

	const { result } = await rpc(
		await send("tools/call", {
			name: "publish_campaign",
			arguments: { id: "camp_1" },
		}),
	);

	expect(result).toEqual({
		isError: true,
		content: [
			{
				type: "text",
				text: "This connection to Better Giving is read-only, so publish_campaign can't be used. To make changes, reconnect Better Giving in your AI assistant's connector settings without read-only access.",
			},
		],
	});
	expect(deployment.calls.slice(before).map((c) => c.path)).toEqual([
		"/connector/v1/hello",
	]);
});

test("a full token's same write call reaches the deployment", async () => {
	await reconnect(null);
	const before = deployment.calls.length;

	// the call runs as its answer is read
	await rpc(
		await send("tools/call", {
			name: "publish_campaign",
			arguments: { id: "camp_1" },
		}),
	);

	expect(deployment.calls.slice(before).map((c) => c.path)).toEqual([
		"/connector/v1/hello",
		"/connector/v1/campaigns/camp_1/publish",
	]);
});

type ListedTool = { title: string; annotations: { title?: string } };

test("every Standalone tool carries its title in its annotations", async () => {
	await reconnect(null);

	const { tools } = (await rpc(await send("tools/list"))).result;

	expect(tools).toHaveLength(ACTIONS.length);
	for (const t of tools as ListedTool[]) {
		expect(t.title).toMatch(/\S/);
		expect(t.annotations.title).toBe(t.title);
	}
});

test("every Platform tool carries its title in its annotations", async () => {
	deployment.intercept((req) =>
		new URL(req.url).pathname === "/connector/v1/hello"
			? Response.json(PLATFORM_HELLO)
			: undefined,
	);
	const { actions } = await deploymentClient({
		fetch: deployment.fetch,
	}).hello(deployment.origin);
	await reconnect(actions);

	const { tools } = (await rpc(await send("tools/list"))).result;

	expect(tools).toHaveLength(PLATFORM_TOOLS.length);
	for (const t of tools as ListedTool[]) {
		expect(t.title).toMatch(/\S/);
		expect(t.annotations.title).toBe(t.title);
	}
});

test("a connection serving no actions offers no tools", async () => {
	await reconnect([]);

	const list = await rpc(await send("tools/list"));

	expect(list.result.tools).toEqual([]);
});

test("a connection serving no actions has instructions with no confirm clause", async () => {
	await reconnect([]);

	const { instructions } = (
		await rpc(
			await send("initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "chat-app", version: "1.0.0" },
			}),
		)
	).result;

	// Only the lead sentence: with no spec registered there is no tool to wait on.
	expect(instructions).toContain(
		"the operator's live Better Giving donation site",
	);
	expect(instructions).not.toContain("Before");
});

const instructions = async () =>
	(
		await rpc(
			await send("initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "chat-app", version: "1.0.0" },
			}),
		)
	).result.instructions;

const VIEW_ONLY =
	"This connection is read-only: it can view the site but not change anything.";

test("a read-only token's instructions say it can view but not change the site, with no confirm clause", async () => {
	readOnly = true;

	const text = await instructions();

	expect(text).toContain(VIEW_ONLY);
	expect(text).not.toContain("Before");
});

test("a full token's instructions don't call the connection read-only", async () => {
	const text = await instructions();

	expect(text).not.toContain(VIEW_ONLY);
	expect(text).toContain("Before");
});

test("a Platform hello answered from another origin leaves the connection Standalone, and is asked again after five minutes", async () => {
	onTestFinished(() => {
		vi.useRealTimers();
	});
	const client = deploymentClient({ fetch: deployment.fetch });
	let asked = 0;
	const elsewhere = mcpRoute({
		auth: {
			authenticateMcp: async () => ({ userId: USER, readOnly: false }),
			dropConnection: async () => {},
		},
		connections: store,
		client: {
			...client,
			hello: async (origin) => {
				asked++;
				return {
					...(await client.hello(origin)),
					origin: "https://elsewhere.example.org" as Origin,
					platform: true,
				};
			},
		},
		resource: new URL("https://connect.example/mcp"),
	});

	const listElsewhere = async () =>
		rpc(
			await elsewhere.request(
				new Request(
					"https://connect.example/",
					mcpRequest("2025-06-18", "Bearer any", "tools/list"),
				),
			),
		);
	const list = await listElsewhere();

	const photo = list.result.tools.find(
		(t: { name: string }) => t.name === "create_photo_upload_link",
	);
	expect(photo.description).toBe(
		ACTIONS.find((s) => s.tool === "create_photo_upload_link")?.description,
	);

	advance(4 * MINUTE);
	await listElsewhere();
	expect(asked).toBe(1);
	advance(1 * MINUTE + 1);
	await listElsewhere();
	expect(asked).toBe(2);
});
