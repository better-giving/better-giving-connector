import { beforeEach, expect, onTestFinished, test, vi } from "vitest";
import {
	ALL_ACTIONS,
	type FakeDeployment,
	fakeDeployment,
} from "../../test/fake-deployment";
import { MCP_APPS_CLIENT, mcpPost, mcpRequest, rpc } from "../../test/harness";
import { memoryDrafts } from "../../test/memory-drafts";
import { PLATFORM_HELLO, PLATFORM_TOOLS } from "../../test/platform-hello";
import { advance, freshDb, MINUTE } from "../../test/support";
import { type Connections, connections, type Db } from "../db";
import { type ActionName, deploymentClient } from "../deployment";
import type { Origin } from "../deployment/origin";
import type { Secret } from "../secret";
import { WIDGETS } from "../widgets/html";
import { ACTIONS } from "./actions";
import { mcpRoute } from "./index";
import { LOCAL_TOOLS } from "./local";

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
		drafts: memoryDrafts(),
		client,
		fetch,
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

const STANDALONE_LOCAL = LOCAL_TOOLS.filter((s) => s.platformOnly !== true);

const toolNames = async (): Promise<string[]> =>
	(await rpc(await send("tools/list"))).result.tools.map(
		(t: { name: string }) => t.name,
	);

test("a connection with no stated actions offers every tool", async () => {
	await reconnect(null);

	const names = await toolNames();

	expect(names).toHaveLength(ACTIONS.length + STANDALONE_LOCAL.length);
	expect(names).toContain("get_profile");
});

test("tools/list offers only the tools whose action the deployment serves", async () => {
	const serves = ALL_ACTIONS.filter((a) => a !== "photos.upload_link");
	await reconnect(serves);

	const names = await toolNames();

	expect(names).not.toContain("create_photo_upload_link");
	expect(names).toContain("publish_campaign");
	expect(names).toContain("list_campaigns");
	const offered = STANDALONE_LOCAL.filter((s) =>
		s.needs.every((a) => (serves as string[]).includes(a)),
	);
	expect(names).toHaveLength(serves.length + offered.length);
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

const APP_ONLY = LOCAL_TOOLS.filter(
	(s) =>
		JSON.stringify(
			(s._meta.ui as { visibility?: string[] } | undefined)?.visibility,
		) === '["app"]',
).map((s) => s.tool);
const STANDALONE_APP_ONLY = APP_ONLY.filter((tool) =>
	STANDALONE_LOCAL.some((s) => s.tool === tool),
);

const listedTo = async (
	version: "2026-07-28" | "2025-06-18",
	capabilities?: Record<string, unknown>,
) => {
	const res = await route.request(
		new Request(
			"https://connect.example/",
			mcpRequest(version, "Bearer any", "tools/list", {}, 1, capabilities),
		),
	);
	return (await rpc(res)).result.tools.map((t: { name: string }) => t.name);
};

test("a client that declares no MCP Apps support is not offered the cards' button tools", async () => {
	await reconnect(null);

	const names = await listedTo("2026-07-28", {});

	expect(APP_ONLY).toContain("app_end_campaign");
	for (const tool of APP_ONLY) expect(names).not.toContain(tool);
	expect(names).toContain("show_campaign_results");
	expect(names).toContain("end_campaign");
});

test("a client that declares MCP Apps support is offered the cards' button tools", async () => {
	await reconnect(null);

	const names = await listedTo("2026-07-28", MCP_APPS_CLIENT);

	for (const tool of STANDALONE_APP_ONLY) expect(names).toContain(tool);
});

test("a 2025 client, whose capabilities this request doesn't carry, is offered the cards' button tools, each saying the chat never calls it", async () => {
	await reconnect(null);

	const names = await listedTo("2025-06-18");

	for (const tool of STANDALONE_APP_ONLY) {
		expect(names).toContain(tool);
		expect(LOCAL_TOOLS.find((s) => s.tool === tool)?.description, tool).toMatch(
			/Only the card calls this tool/,
		);
	}
});

const READ_TOOLS: string[] = [...ACTIONS, ...LOCAL_TOOLS]
	.filter((s) => s.annotations.readOnlyHint)
	.map((s) => s.tool);

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

	expect(tools).toHaveLength(ACTIONS.length + STANDALONE_LOCAL.length);
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

test("a connection serving no actions offers only the tools that need none", async () => {
	await reconnect([]);

	expect(await toolNames()).toEqual(["get_profile"]);
});

type ListedSchemas = {
	name: string;
	outputSchema: { type: string; additionalProperties: unknown };
	_meta: Record<string, unknown>;
};

test.each([
	["a full token", false],
	["a read-only token", true],
])(
	"%s's tools/list carries every tool's output schema and _meta",
	async (_, readOnlyToken) => {
		await reconnect(null);
		readOnly = readOnlyToken;

		const { tools } = (await rpc(await send("tools/list"))).result;

		expect(tools.length).toBeGreaterThan(LOCAL_TOOLS.length);
		for (const t of tools as ListedSchemas[]) {
			expect(t.outputSchema.type, t.name).toBe("object");
			expect(t._meta["openai/toolInvocation/invoking"], t.name).toMatch(/…$/);
			expect(t._meta["openai/toolInvocation/invoked"], t.name).toMatch(/\S/);
		}
	},
);

test("get_profile's output schema is exactly an id and a name, and it's the profile tool", async () => {
	const { tools } = (await rpc(await send("tools/list"))).result;

	const profile = tools.find((t: { name: string }) => t.name === "get_profile");

	expect(profile._meta["openai/profile"]).toBe(true);
	expect(profile.annotations).toMatchObject({
		readOnlyHint: true,
		destructiveHint: false,
	});
	expect(profile.outputSchema).toMatchObject({
		type: "object",
		additionalProperties: false,
		required: ["id", "name"],
	});
	expect(Object.keys(profile.outputSchema.properties)).toEqual(["id", "name"]);
});

test("get_profile answers with the signed-in user's id and the org's name, and nothing of the origin or key", async () => {
	const { result } = await rpc(
		await send("tools/call", { name: "get_profile", arguments: {} }),
	);

	expect(result).toEqual({
		content: [{ type: "text", text: `{"id":"${USER}","name":"Give Example"}` }],
		structuredContent: { id: USER, name: "Give Example" },
	});
	expect(JSON.stringify(result)).not.toContain(deployment.host);
	expect(JSON.stringify(result)).not.toContain(key.reveal());
});

test("the locale the chat app states in the call's _meta formats the money, and the currency stays", async () => {
	deployment.intercept((req) =>
		new URL(req.url).pathname === "/connector/v1/results"
			? Response.json({
					total: { amount: "1250.00", currency: "USD" },
					gift_count: 2,
					donor_count: 1,
					campaigns: [],
				})
			: undefined,
	);

	const { result } = await rpc(
		await send("tools/call", {
			name: "get_results",
			arguments: {},
			_meta: { "openai/locale": "de-DE" },
		}),
	);

	expect(result.content[0].text).toMatch(
		/^Give Example raised 1\.250,00\u00a0\$ from 2 gifts\./,
	);
	expect(result.content[1].text).toBe(
		"1.250,00\u00a0$ raised from 2 gifts by 1 donor",
	);
});

test("a body its output schema refuses still answers the call, as text with no structured result", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	onTestFinished(() => {
		vi.restoreAllMocks();
	});
	deployment.intercept((req) =>
		new URL(req.url).pathname === "/connector/v1/results"
			? Response.json({ total: 5 })
			: undefined,
	);

	const { result } = await rpc(
		await send("tools/call", { name: "get_results", arguments: {} }),
	);

	expect(result).toEqual({
		content: [
			{
				type: "text",
				text: `From Give Example's Better Giving site:\n{"total":5}`,
			},
		],
	});
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
		drafts: memoryDrafts(),
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
		fetch,
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

// The domain Claude validates `_meta.ui.domain` against: the SHA-256 of
// https://connect.example/mcp, the URL this route is built for, as `sha256sum`
// prints it.
const CLAUDE_DOMAIN = "66315fbf870468b7566b50d158bb8fc0.claudemcpcontent.com";
const ORIGIN = "https://connect.example";
const CLAUDE = { name: "claude-ai", version: "0.1.0" };
const CHATGPT = { name: "openai-mcp", version: "1.0.0" };

const widgetUri = Object.values(WIDGETS)[0]?.uri ?? "";

const asClient = (
	client: { name: string; version: string },
	method: string,
	params?: Record<string, unknown>,
	capabilities: Record<string, unknown> = MCP_APPS_CLIENT,
) =>
	route.request(
		new Request(
			"https://connect.example/",
			mcpRequest(
				"2026-07-28",
				"Bearer any",
				method,
				params,
				1,
				capabilities,
				client,
			),
		),
	);

const uiOf = (meta: { ui: Record<string, unknown> }) => meta.ui;

test("resources/read gives Claude the domain computed from the server URL and ChatGPT the origin", async () => {
	await reconnect(null);
	const read = async (client: typeof CLAUDE) =>
		(await rpc(await asClient(client, "resources/read", { uri: widgetUri })))
			.result.contents[0]._meta;

	expect(uiOf(await read(CLAUDE)).domain).toBe(CLAUDE_DOMAIN);
	expect(uiOf(await read(CHATGPT)).domain).toBe(ORIGIN);
	// each request is its own: the host asking second does not inherit the first's
	expect(uiOf(await read(CLAUDE)).domain).toBe(CLAUDE_DOMAIN);
});

test("resources/list gives each host its own domain, and the rest of the sandbox is the same", async () => {
	await reconnect(null);
	const list = async (client: typeof CLAUDE) =>
		(await rpc(await asClient(client, "resources/list"))).result.resources.map(
			(r: { _meta: { ui: Record<string, unknown> } }) => r._meta.ui,
		);

	const claude = await list(CLAUDE);
	const chatgpt = await list(CHATGPT);

	expect(claude.length).toBeGreaterThan(0);
	for (const ui of claude) expect(ui.domain).toBe(CLAUDE_DOMAIN);
	for (const ui of chatgpt) expect(ui.domain).toBe(ORIGIN);
	expect(
		claude.map(({ domain: _, ...rest }: Record<string, unknown>) => rest),
	).toEqual(
		chatgpt.map(({ domain: _, ...rest }: Record<string, unknown>) => rest),
	);
});

test("a 2025 request after the initialize is told apart by its User-Agent; one that says nothing keeps the origin", async () => {
	await reconnect(null);
	const read = async (headers: Record<string, string>) =>
		(
			await rpc(
				await route.request(
					new Request(
						"https://connect.example/",
						mcpPost(
							{
								jsonrpc: "2.0",
								id: 1,
								method: "resources/read",
								params: { uri: widgetUri },
							},
							"Bearer any",
							{ "mcp-protocol-version": "2025-06-18", ...headers },
						),
					),
				),
			)
		).result.contents[0]._meta.ui.domain;

	expect(await read({ "user-agent": "Claude-User" })).toBe(CLAUDE_DOMAIN);
	expect(await read({})).toBe(ORIGIN);
});

test("a host that names itself neither Claude nor ChatGPT keeps the origin", async () => {
	await reconnect(null);

	const res = await asClient(
		{ name: "some-agent", version: "1" },
		"resources/read",
		{
			uri: widgetUri,
		},
	);

	expect((await rpc(res)).result.contents[0]._meta.ui.domain).toBe(ORIGIN);
});

const discoverInstructions = async (capabilities?: Record<string, unknown>) =>
	(
		await rpc(
			await asClient(CLAUDE, "server/discover", undefined, capabilities),
		)
	).result.instructions as string;

const CARD_LINE =
	"Show the operator a card, not the campaign written out as text";

test("a client that declares MCP Apps support is told to show cards", async () => {
	await reconnect(null);

	const text = await discoverInstructions(MCP_APPS_CLIENT);

	expect(text).toContain(CARD_LINE);
	expect(text).toContain("show_campaign_results for");
	expect(text).toContain("pressed a card's");
	expect(text).not.toContain("shows no cards");
});

test("a client that declares no MCP Apps support is told to write text, never to call a card tool, and still waits for the operator's yes", async () => {
	await reconnect(null);

	const text = await discoverInstructions({});

	expect(text).toContain(
		"This client shows no cards: write what the tools return out as text",
	);
	expect(text).not.toContain(CARD_LINE);
	expect(text).not.toContain("show_campaign_results");
	expect(text).not.toContain("pressed a card's");
	expect(text).toMatch(
		/Before .*publish_campaign.*end_campaign.*explicit yes in this chat/,
	);
});

const WAIT_FOR_YES =
	"Before publish_campaign, end_campaign or reset_donation_page, say what will change and wait for the operator's explicit yes in this chat.";

test("a client declaring MCP Apps is told to wait for the operator's yes before every tool that changes what donors see", async () => {
	await reconnect(null);

	expect(await discoverInstructions(MCP_APPS_CLIENT)).toContain(WAIT_FOR_YES);
});

test("a client declaring no MCP Apps support is told the same wait for the operator's yes", async () => {
	await reconnect(null);

	expect(await discoverInstructions({})).toContain(WAIT_FOR_YES);
});

test("a 2025-06-18 client that declares no capabilities keeps the card instructions", async () => {
	await reconnect(null);

	const text = await instructions();

	expect(text).toContain(CARD_LINE);
	expect(text).not.toContain("shows no cards");
});

test("without MCP Apps support the data tools stop pointing at the cards", async () => {
	await reconnect(null);
	const description = async (capabilities: Record<string, unknown>) =>
		(
			await rpc(await asClient(CLAUDE, "tools/list", {}, capabilities))
		).result.tools.find((t: { name: string }) => t.name === "get_campaign")
			.description as string;

	expect(await description(MCP_APPS_CLIENT)).toContain(
		"call show_campaign_results instead",
	);
	expect(await description({})).not.toContain("show_campaign_results");
});
