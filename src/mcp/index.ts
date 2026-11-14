import {
	bearerAuthChallengeResponse,
	createMcpHandler,
	getOAuthProtectedResourceMetadataUrl,
	McpServer,
	OAuthError,
	OAuthErrorCode,
	originValidationResponse,
	type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import { Hono } from "hono";
import type { AuthFacade } from "../auth";
import { OFFLINE_ACCESS_SCOPE } from "../auth/scopes";
import {
	type CampaignDrafts,
	type Connection,
	ConnectionKeyUnreadable,
	type Connections,
} from "../db";
import type { ActionName, DeploymentClient } from "../deployment";
import { localeOf } from "../format";
import { log } from "../log";
import { RENDER_TOOLS, type WidgetName } from "../widgets/model";
import { actionsFor, LINKS_ONLY, LIVE_EDITS_DRAFT } from "./actions";
import { type Caller, callerOf, claudeDomain, rendersApps } from "./host";
import { LOCAL_TOOLS } from "./local";
import { type RunToolContext, runTool, type ToolConnection } from "./run-tool";
import { isAppOnly, loggedName, type ToolSpec } from "./spec";
import { registerWidgetResources } from "./widget-resources";

export type McpDeps = {
	auth: Pick<AuthFacade, "authenticateMcp" | "dropConnection">;
	connections: Connections;
	client: DeploymentClient;
	drafts: CampaignDrafts;
	fetch: typeof fetch;
	/** This endpoint's own URL, the resource its tokens are issued for. */
	resource: URL;
};

export function mcpRoute(deps: McpDeps): Hono {
	const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(
		deps.resource,
	);
	const signIn = () =>
		bearerAuthChallengeResponse(
			new OAuthError(OAuthErrorCode.InvalidToken, "Sign in to Better Giving"),
			// a client given no scope here requests all of `scopes_supported`,
			// read_only among them
			{ resourceMetadataUrl, requiredScopes: [OFFLINE_ACCESS_SCOPE] },
		);

	// A missing row or an undecryptable key can never be used again, so the
	// connection ends here, its tokens with it: the chat app's next refresh
	// fails and its sign-in makes a new one.
	async function connectionOf(userId: string): Promise<Connection | null> {
		try {
			const connection = await deps.connections.get(userId);
			if (connection) return connection;
		} catch (error) {
			if (!(error instanceof ConnectionKeyUnreadable)) throw error;
		}
		await deps.auth.dropConnection(userId);
		return null;
	}

	const sessionOf = sessionDetector(deps.client);

	// Chat apps call from their servers and send no Origin, which passes; a
	// browser page on another site is refused before its bearer is read.
	const ownHost = [deps.resource.hostname];

	return new Hono().all("/", async (c) => {
		const foreign = originValidationResponse(c.req.raw, ownHost);
		if (foreign) return foreign;
		const who = await deps.auth.authenticateMcp(c.req.raw);
		if (!who) return signIn();
		const connection = await connectionOf(who.userId);
		if (!connection) return signIn();
		const session = await sessionOf(connection);
		const caller = await callerOf(c.req.raw);
		// Built per request, each bound to one caller's connection: the SDK's
		// per-request channel, AuthInfo, needs a clientId and scopes that
		// authenticateMcp doesn't return.
		const handler = createMcpHandler(
			() =>
				connectionServer(
					session,
					who.readOnly,
					{
						client: deps.client,
						drafts: deps.drafts,
						publicOrigin: deps.resource.origin,
						fetch: deps.fetch,
						dropConnection: deps.auth.dropConnection,
					},
					caller,
					deps.resource.href,
				),
			{ onerror: logError },
		);
		return handler.fetch(c.req.raw);
	});
}

// A hello that failed, or answered from another origin, stays Standalone this
// long before hello is asked again, so a brief outage or a temporary redirect
// doesn't pin a Platform site to Standalone.
const UNSETTLED_HELLO_MS = 5 * 60 * 1000;
const MAX_DETECTED = 1000;

// What a hello settled for a connection: Platform's actions as it lists them
// now, or null for Standalone. Only this is cached, never the row and its key.
type Detection = { platformActions: ActionName[] | null } | null;
type Detected = { detection: Promise<Detection>; expiresAt: number };

/**
 * The connection as this session uses it: Platform or not, asked of its
 * deployment's hello (keyless) once per connection row this process sees; a
 * reconnect writes a new row, with a new createdAt, and is asked afresh.
 * Platform takes the actions its hello lists now, so a row stored before
 * Platform served its writes is offered them. Never throws: a hello that fails,
 * or answers from another origin, is Standalone with the stored actions, and
 * the real tool call meets whatever went wrong.
 */
function sessionDetector(client: Pick<DeploymentClient, "hello">) {
	const detected = new Map<string, Detected>();

	function detect(connection: Connection): Promise<Detection> {
		const id = `${connection.userId}\n${connection.origin}\n${connection.createdAt.getTime()}`;
		const known = detected.get(id);
		if (known && known.expiresAt > Date.now()) return known.detection;
		const unsettled = () => {
			entry.expiresAt = Date.now() + UNSETTLED_HELLO_MS;
			return null;
		};
		const entry: Detected = {
			expiresAt: Number.POSITIVE_INFINITY,
			detection: client.hello(connection.origin).then((hello) => {
				if (hello.origin !== connection.origin) return unsettled();
				return hello.platform ? { platformActions: hello.actions } : null;
			}, unsettled),
		};
		detected.delete(id);
		detected.set(id, entry);
		if (detected.size > MAX_DETECTED) {
			const oldest = detected.keys().next().value;
			if (oldest !== undefined) detected.delete(oldest);
		}
		return entry.detection;
	}

	return async (connection: Connection): Promise<ToolConnection> => {
		const detection = await detect(connection);
		return detection === null
			? { ...connection, platform: false }
			: { ...connection, platform: true, actions: detection.platformActions };
	};
}

function connectionServer(
	connection: ToolConnection,
	readOnly: boolean,
	ctx: RunToolContext,
	caller: Caller,
	serverUrl: string,
): McpServer {
	// A client that declared no MCP Apps support gets no cards: its model
	// writes the answer as text.
	const cards = caller.rendersApps !== false;
	const served = servedSpecs(connection, cards);
	const specs = readOnly ? served.filter(isRead) : served;
	const server = new McpServer(
		{ name: "Better Giving", version: "1.0.0" },
		{
			capabilities: { tools: {}, resources: {} },
			instructions: instructionsFor(connection.orgName, specs, readOnly, cards),
		},
	);
	for (const spec of specs) {
		// No outputSchema here: the SDK fails a call whose result has none, and
		// a body its schema refuses is answered as text. runTool checks it;
		// tools/list below lists it. @modelcontextprotocol/client applies the
		// same rule on its side: it throws on a result that isn't an error and
		// has no structuredContent when tools/list gave the tool a schema, so a
		// client built on it fails that text answer.
		server.registerTool(
			spec.tool,
			{ title: spec.title, inputSchema: loggedInput(spec) },
			(input, request) =>
				runTool(spec, connection, input, ctx, localeOf(request.mcpReq._meta)),
		);
	}
	if (specs.some((spec) => "openai/outputTemplate" in spec._meta))
		registerWidgetResources(
			server,
			ctx.publicOrigin,
			caller.host === "claude" ? claudeDomain(serverUrl) : ctx.publicOrigin,
		);
	if (readOnly)
		refuseWrites(
			server,
			served.filter((s) => !isRead(s)),
		);
	server.server.setRequestHandler("tools/list", (_request, ctx) => {
		const shown =
			rendersApps(ctx.mcpReq.envelope) === false
				? specs.filter((spec) => !isAppOnly(spec))
				: specs;
		return { tools: shown.map(listed) };
	});
	return server;
}

// null `actions` (a connection made before this was stored, or a hello that
// didn't state them) keeps every tool; otherwise only the tools whose actions
// the deployment serves, so the chat is never offered one that can only fail.
function servedSpecs(connection: ToolConnection, cards: boolean): ToolSpec[] {
	const serves = (action: ActionName) =>
		connection.actions === null || connection.actions.includes(action);
	const specs = [
		...actionsFor(connection.platform).filter((spec) => serves(spec.action)),
		...LOCAL_TOOLS.filter(
			(spec) =>
				spec.needs.every(serves) &&
				(spec.platformOnly !== true || connection.platform),
		).map((spec) =>
			spec.standaloneDescription === undefined || connection.platform
				? spec
				: { ...spec, description: spec.standaloneDescription },
		),
	];
	return cards ? pointDataToolsAtCards(specs) : specs;
}

// What each card is for, in the words the instructions use for when to call
// it; `readOnly` is those words on a read-only connection, null for a card
// whose work goes through app-only writes a read-only token refuses. Key order
// is how the instructions list them.
const CARD_FOR: Record<WidgetName, { when: string; readOnly: string | null }> =
	{
		campaigns: {
			when: "browsing campaigns",
			readOnly: "browsing campaigns",
		},
		"campaign-results": {
			when: "one campaign's status, goal, progress, results, publishing and ending",
			readOnly: "one campaign's status, goal, progress and results",
		},
		"campaign-editor": { when: "editing a campaign page", readOnly: null },
		"campaign-create": { when: "starting a campaign", readOnly: null },
		photo: { when: "a cover photo", readOnly: null },
	};

const isRegistered = (specs: readonly ToolSpec[], card: WidgetName) =>
	specs.some((spec) => spec.tool === RENDER_TOOLS[card].tool);

function cardsIn(specs: readonly ToolSpec[], readOnly: boolean): string[] {
	return (Object.keys(CARD_FOR) as WidgetName[]).flatMap((card) => {
		const when = readOnly ? CARD_FOR[card].readOnly : CARD_FOR[card].when;
		return when !== null && isRegistered(specs, card)
			? [`${RENDER_TOOLS[card].tool} for ${when}`]
			: [];
	});
}

// list_campaigns and get_campaign return the data their cards show, so a model
// that sees only them writes the campaign out as text. Each one's description
// names its own card, when that card is registered.
const DATA_TOOL_CARD: Record<string, { card: WidgetName; shows: string }> = {
	list_campaigns: { card: "campaigns", shows: "campaigns" },
	get_campaign: { card: "campaign-results", shows: "a campaign" },
};

function pointDataToolsAtCards(specs: ToolSpec[]): ToolSpec[] {
	return specs.map((spec) => {
		const target = DATA_TOOL_CARD[spec.tool];
		if (target === undefined || !isRegistered(specs, target.card)) return spec;
		const pointer = `To show ${target.shows} to the operator, call ${RENDER_TOOLS[target.card].tool} instead: this tool is for your own reasoning, such as finding an id or checking a value before an edit.`;
		return { ...spec, description: beforeLinksOnly(spec, pointer) };
	});
}

// Throws rather than dropping the pointer when the description no longer ends
// with LINKS_ONLY, so a reworded description fails every /mcp request.
function beforeLinksOnly(spec: ToolSpec, sentence: string): string {
	if (!spec.description.endsWith(LINKS_ONLY))
		throw new Error(`${spec.tool}'s description must end with LINKS_ONLY`);
	return `${spec.description.slice(0, -LINKS_ONLY.length)}${sentence} ${LINKS_ONLY}`;
}

const isRead = (spec: ToolSpec) => spec.annotations.readOnlyHint;

// A tool as tools/list shows it, its schemas converted as McpServer converts
// a registered tool's.
function listed(spec: ToolSpec) {
	const target = { target: "draft-2020-12" } as const;
	return {
		name: spec.tool,
		title: spec.title,
		description: spec.description,
		inputSchema: {
			type: "object" as const,
			...spec.input["~standard"].jsonSchema.input(target),
		},
		outputSchema: {
			type: "object" as const,
			...spec.output.schema["~standard"].jsonSchema.output(target),
		},
		annotations: { ...spec.annotations, title: spec.title },
		_meta: spec._meta,
	};
}

// McpServer answers a call to a tool it doesn't have with a bare "not found".
// So a read-only token's writes are registered, each answering with why it
// can't run, and left out of tools/list.
function refuseWrites(server: McpServer, writes: readonly ToolSpec[]): void {
	for (const spec of writes) {
		// no inputSchema: the arguments are never read, so never logged
		server.registerTool(spec.tool, { title: spec.title }, () => {
			log({
				kind: "tool",
				tool: loggedName(spec),
				outcome: "read_only",
				ms: 0,
			});
			return {
				isError: true,
				content: [{ type: "text", text: readOnlyRefusal(spec.tool) }],
			};
		});
	}
}

const readOnlyRefusal = (tool: string) =>
	`This connection to Better Giving is read-only, so ${tool} can't be used. To make changes, reconnect Better Giving in your AI assistant's connector settings without read-only access.`;

// The name only: the SDK's messages quote the request.
const logError = (error: Error) =>
	log({ kind: "error", where: "mcp", errorName: error.name });

// The SDK answers a call its schema refuses before runTool runs, so that
// refusal is logged here, where the schema runs.
function loggedInput(
	spec: ToolSpec,
): StandardSchemaWithJSON<Record<string, unknown>> {
	const schema = spec.input["~standard"];
	return {
		"~standard": {
			...schema,
			async validate(value) {
				const started = performance.now();
				const result = await schema.validate(value);
				if (result.issues) {
					const ms = Math.round(performance.now() - started);
					log({
						kind: "tool",
						tool: loggedName(spec),
						outcome: "invalid_input",
						ms,
					});
				}
				return result;
			},
		},
	};
}

// The tools that change what donors see say so in their own description; the
// instructions name only those that are registered, so one its deployment
// doesn't serve is never asked for.
const WAITS_FOR_YES = "operator confirms it in the chat first";

function instructionsFor(
	orgName: string,
	specs: readonly ToolSpec[],
	readOnly: boolean,
	cards: boolean,
): string {
	const lines = [
		`These tools act on ${JSON.stringify(orgName)}, the operator's live Better Giving donation site: what they change, donors see.`,
	];
	if (readOnly) {
		lines.push(
			"This connection is read-only: it can view the site but not change anything.",
		);
	}
	const shown = cards ? cardsIn(specs, readOnly) : [];
	if (shown.length > 0) {
		lines.push(
			`Show the operator a card, not the campaign written out as text: ${shown.join("; ")}.`,
			"After a card, add at most one short line and don't restate what it shows.",
		);
	} else if (!cards) {
		lines.push(
			"This client shows no cards: write what the tools return out as text for the operator.",
		);
	}
	if (specs.some((spec) => spec.description.includes(LIVE_EDITS_DRAFT))) {
		lines.push(
			"An edit to a live campaign is saved as a draft donors don't see until publish_campaign sends it; get_campaign shows it under pendingDraft.",
		);
	}
	const waiting = specs
		.filter((spec) => spec.description.includes(WAITS_FOR_YES))
		.map((spec) => spec.tool);
	if (waiting.length > 0) {
		lines.push(
			`Before ${orList(waiting)}, say what will change and wait for the operator's explicit yes in this chat.`,
		);
	}
	const buttons = cards ? cardButtonsIn(specs) : [];
	if (buttons.length > 0) {
		lines.push(
			`Once the operator says they pressed a card's ${orList(buttons)} button, that press already made the change: don't call the tool for it again, and don't ask.`,
		);
	}
	return lines.join(" ");
}

// The card buttons that change what donors see, by their labels. A press calls
// an app-only tool the model never sees, so it learns of one only from the
// operator; a label is named only when its card and its tool are registered.
function cardButtonsIn(specs: readonly ToolSpec[]): string[] {
	const has = (tool: string) => specs.some((spec) => spec.tool === tool);
	const results = isRegistered(specs, "campaign-results");
	const publishes =
		has("app_publish_campaign") &&
		(results || isRegistered(specs, "campaign-editor"));
	const ends = has("app_end_campaign") && results;
	return [
		...(publishes ? ["Publish", "Publish changes"] : []),
		...(ends ? ["End campaign"] : []),
	];
}

// "a", "a or b", "a, b or c": the tool names as one English list.
const orList = (names: readonly string[]): string =>
	names.length <= 1
		? names.join("")
		: `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
