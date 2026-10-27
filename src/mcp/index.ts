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
import {
	type Connection,
	ConnectionKeyUnreadable,
	type Connections,
} from "../db";
import type { DeploymentClient } from "../deployment";
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
			{ resourceMetadataUrl },
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

	const isPlatform = platformDetector(deps.client);

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
		const platform = await isPlatform(connection);
		// Built per request, each bound to one caller's connection: the SDK's
		// per-request channel, AuthInfo, needs a clientId and scopes that
		// authenticateMcp doesn't return.
		const handler = createMcpHandler(
			() =>
				connectionServer(
					{ ...connection, platform },
					{
						client: deps.client,
						dropConnection: deps.auth.dropConnection,
					},
				),
			{ onerror: logError },
		);
		return handler.fetch(c.req.raw);
	});
}

// A failed hello stays Standalone this long before hello is asked again, so a
// brief outage doesn't pin a Platform site to Standalone.
const FAILED_HELLO_MS = 5 * 60 * 1000;
const MAX_DETECTED = 1000;

type Detected = { platform: Promise<boolean>; expiresAt: number };

/**
 * Whether a connection's deployment is Platform, asked of its hello (keyless)
 * once per connection row this process sees; a reconnect writes a new row, with
 * a new createdAt, and is asked afresh. Never throws: a hello that fails, or
 * answers from another origin, is Standalone, and the real tool call meets
 * whatever went wrong.
 */
function platformDetector(client: Pick<DeploymentClient, "hello">) {
	const detected = new Map<string, Detected>();
	return (connection: Connection): Promise<boolean> => {
		const id = `${connection.userId}\n${connection.origin}\n${connection.createdAt.getTime()}`;
		const now = Date.now();
		const known = detected.get(id);
		if (known && known.expiresAt > now) return known.platform;
		const entry: Detected = {
			expiresAt: Number.POSITIVE_INFINITY,
			platform: client.hello(connection.origin).then(
				(hello) => hello.platform && hello.origin === connection.origin,
				() => {
					entry.expiresAt = Date.now() + FAILED_HELLO_MS;
					return false;
				},
			),
		};
		detected.delete(id);
		detected.set(id, entry);
		if (detected.size > MAX_DETECTED) {
			const oldest = detected.keys().next().value;
			if (oldest !== undefined) detected.delete(oldest);
		}
		return entry.platform;
	};
}

function connectionServer(
	connection: ToolConnection,
	ctx: RunToolContext,
): McpServer {
	// null `actions` (a connection made before this was stored, or a hello that
	// didn't state them) keeps every tool; otherwise only the actions the
	// deployment serves, so the chat is never offered one that can only fail.
	const specs = actionsFor(connection.platform).filter(
		(spec) =>
			connection.actions === null || connection.actions.includes(spec.action),
	);
	const server = new McpServer(
		{ name: "Better Giving", version: "1.0.0" },
		{
			capabilities: { tools: {} },
			instructions: instructionsFor(connection.orgName, specs),
		},
	);
	for (const spec of specs) {
		server.registerTool(
			spec.tool,
			{
				title: spec.title,
				description: spec.description,
				inputSchema: loggedInput(spec),
				annotations: spec.annotations,
			},
			(input) => runTool(spec, connection, input, ctx),
		);
	}
	return server;
}

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
): string {
	const lines = [
		`These tools act on ${JSON.stringify(orgName)}, the operator's live Better Giving donation site: what they change, donors see.`,
	];
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
