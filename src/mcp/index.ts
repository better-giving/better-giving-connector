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
	type Connection,
	ConnectionKeyUnreadable,
	type Connections,
} from "../db";
import type { ActionName, DeploymentClient } from "../deployment";
import { log } from "../log";
import { type ActionSpec, actionsFor } from "./actions";
import { type RunToolContext, runTool, type ToolConnection } from "./run-tool";

export type McpDeps = {
	auth: Pick<AuthFacade, "authenticateMcp" | "dropConnection">;
	connections: Connections;
	client: DeploymentClient;
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
		// Built per request, each bound to one caller's connection: the SDK's
		// per-request channel, AuthInfo, needs a clientId and scopes that
		// authenticateMcp doesn't return.
		const handler = createMcpHandler(
			() =>
				connectionServer(session, who.readOnly, {
					client: deps.client,
					dropConnection: deps.auth.dropConnection,
				}),
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
): McpServer {
	// null `actions` (a connection made before this was stored, or a hello that
	// didn't state them) keeps every tool; otherwise only the actions the
	// deployment serves, so the chat is never offered one that can only fail.
	const served = actionsFor(connection.platform).filter(
		(spec) =>
			connection.actions === null || connection.actions.includes(spec.action),
	);
	const specs = readOnly ? served.filter(isRead) : served;
	const server = new McpServer(
		{ name: "Better Giving", version: "1.0.0" },
		{
			capabilities: { tools: {} },
			instructions: instructionsFor(connection.orgName, specs, readOnly),
		},
	);
	for (const spec of specs) {
		server.registerTool(
			spec.tool,
			{
				title: spec.title,
				description: spec.description,
				inputSchema: loggedInput(spec),
				annotations: { ...spec.annotations, title: spec.title },
			},
			(input) => runTool(spec, connection, input, ctx),
		);
	}
	if (readOnly)
		refuseWrites(
			server,
			specs,
			served.filter((s) => !isRead(s)),
		);
	return server;
}

const isRead = (spec: ActionSpec) => spec.annotations.readOnlyHint === true;

// McpServer lists every tool it can call, and answers a call to one it doesn't
// have with a bare "not found". So a read-only token's writes are registered,
// each answering with why it can't run, and tools/list is answered from the
// read tools alone, each listed as McpServer lists a registered tool.
function refuseWrites(
	server: McpServer,
	reads: readonly ActionSpec[],
	writes: readonly ActionSpec[],
): void {
	for (const spec of writes) {
		// no inputSchema: the arguments are never read, so never logged
		server.registerTool(spec.tool, { title: spec.title }, () => {
			log({ kind: "tool", tool: spec.action, outcome: "read_only", ms: 0 });
			return {
				isError: true,
				content: [{ type: "text", text: readOnlyRefusal(spec.tool) }],
			};
		});
	}
	server.server.setRequestHandler("tools/list", () => ({
		tools: reads.map((spec) => ({
			name: spec.tool,
			title: spec.title,
			description: spec.description,
			inputSchema: {
				type: "object" as const,
				...spec.input["~standard"].jsonSchema.input({
					target: "draft-2020-12",
				}),
			},
			annotations: { ...spec.annotations, title: spec.title },
		})),
	}));
}

const readOnlyRefusal = (tool: string) =>
	`This connection to Better Giving is read-only, so ${tool} can't be used. To make changes, reconnect Better Giving in your AI assistant's connector settings without read-only access.`;

// The name only: the SDK's messages quote the request.
const logError = (error: Error) =>
	log({ kind: "error", where: "mcp", errorName: error.name });

// The SDK answers a call its schema refuses before runTool runs, so that
// refusal is logged here, where the schema runs.
function loggedInput(
	spec: ActionSpec,
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
						tool: spec.action,
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
	specs: readonly ActionSpec[],
	readOnly: boolean,
): string {
	const lines = [
		`These tools act on ${JSON.stringify(orgName)}, the operator's live Better Giving donation site: what they change, donors see.`,
	];
	if (readOnly) {
		lines.push(
			"This connection is read-only: it can view the site but not change anything.",
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
	return lines.join(" ");
}

// "a", "a or b", "a, b or c": the tool names as one English list.
const orList = (names: readonly string[]): string =>
	names.length <= 1
		? names.join("")
		: `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
