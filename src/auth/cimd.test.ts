import type { ClientMetadataResourceFetch } from "@better-auth/oauth-provider";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeDeployment } from "../../test/fake-deployment";
import { BASE, env, INITIALIZE, mcpPost } from "../../test/harness";
import {
	type Authorization,
	authorization,
	type Call,
	discover,
	type Endpoints,
	exchangeCode,
	REDIRECT_URI,
	redirectTarget,
	refresh,
	type Tokens,
} from "../../test/oauth";
import {
	advance,
	connectionRows,
	countRows,
	DAY,
	freshDb,
	NO_CONNECTION_ROWS,
} from "../../test/support";
import { type Connections, connections, type Db } from "../db";
import { deploymentClient } from "../deployment";
import type { Origin } from "../deployment/origin";
import { Secret } from "../secret";
import { type AuthFacade, createAuth } from "./index";
import { OFFLINE_ACCESS_SCOPE, READ_ONLY_SCOPE } from "./scopes";

// Claude's custom-connector sign-in sends this URL as its client_id; the
// document lives at the same URL.
const CIMD_CLIENT_ID = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const ORIGIN = "https://give.example.org" as Origin;
const KEY = "bgk_live_sentinel_51c0";

// biome-ignore lint/suspicious/noExplicitAny: a metadata document, field by field
type Doc = Record<string, any>;

const validDoc = (
	clientId: string = CIMD_CLIENT_ID,
	redirectUris: string[] = [REDIRECT_URI],
): Doc => ({
	client_id: clientId,
	client_name: "Claude",
	redirect_uris: redirectUris,
	token_endpoint_auth_method: "none",
	grant_types: ["authorization_code", "refresh_token"],
	response_types: ["code"],
});

// What the fake transport returns for a client_id URL: a document to serve, or
// an Error to throw the way the SSRF-safe transport throws for a private
// address. An unmapped URL is a 404.
type Served = Doc | Error;

function metadataFetch(docs: Map<string, Served>): ClientMetadataResourceFetch {
	return async (input) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const served = docs.get(url);
		if (served instanceof Error) throw served;
		if (served === undefined) return new Response("not found", { status: 404 });
		return new Response(JSON.stringify(served), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	};
}

let db: Db;
let store: Connections;
let auth: AuthFacade;
let call: Call;
let ep: Endpoints;

function buildWith(docs: Map<string, Served>) {
	const deployment = fakeDeployment();
	auth = createAuth({
		db,
		connections: store,
		env,
		client: deploymentClient({ fetch: deployment.fetch }),
		fetchClientMetadata: metadataFetch(docs),
	});
	call = (req) => auth.handler(req);
}

beforeEach(async () => {
	db = await freshDb();
	store = connections(db, env.CONNECTION_KEY_SECRET);
	buildWith(new Map([[CIMD_CLIENT_ID, validDoc()]]));
	ep = await discover(call, BASE);
	return () => db.close();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// The browser navigation that opens the authorize URL, unfollowed.
const navigate = (a: Authorization) =>
	call(
		new Request(a.url, {
			headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
		}),
	);

function reachedConnect(res: Response): boolean {
	if (res.status !== 302) return false;
	const location = res.headers.get("location");
	return location ? new URL(location, BASE).pathname === "/connect" : false;
}

test("authorization-server metadata advertises CIMD, the none auth method and S256", async () => {
	const as = await call(
		new Request(`${BASE}/.well-known/oauth-authorization-server/api/auth`),
	);
	const metadata = (await as.json()) as {
		client_id_metadata_document_supported?: unknown;
		token_endpoint_auth_methods_supported?: unknown;
		code_challenge_methods_supported?: unknown;
	};

	expect(metadata.client_id_metadata_document_supported).toBe(true);
	expect(metadata.token_endpoint_auth_methods_supported).toContain("none");
	expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
});

// --- the full CIMD flow -----------------------------------------------------

async function cimdConnect(
	clientId = CIMD_CLIENT_ID,
	redirectUri = REDIRECT_URI,
	scope?: string,
): Promise<{ a: Authorization; code: string }> {
	const a = authorization(ep, clientId, {
		redirectUri,
		...(scope === undefined ? {} : { scope }),
	});
	const login = redirectTarget(await navigate(a), a.url);
	if (login.pathname !== "/connect")
		throw new Error("authorize did not reach /connect");
	const request = await auth.readLoginRequest(login);
	if (!request) throw new Error("login request refused");
	const res = await auth.completeConnection({
		oauthQuery: request.oauthQuery,
		origin: ORIGIN,
		orgName: "Example Org",
		actions: null,
		key: new Secret(KEY),
	});
	const back = redirectTarget(res, `${BASE}/connect/return`);
	const code = back.searchParams.get("code");
	if (!code) throw new Error("no code in the resumed redirect");
	expect(back.origin + back.pathname).toBe(redirectUri);
	return { a, code };
}

async function cimdTokens(): Promise<{ a: Authorization; tokens: Tokens }> {
	const { a, code } = await cimdConnect();
	const res = await exchangeCode(call, ep, a, code);
	if (res.status !== 200)
		throw new Error(`token: ${res.status} ${await res.text()}`);
	return { a, tokens: (await res.json()) as Tokens };
}

test("a URL client_id drives authorize, connect, code, a public-client token, and /mcp", async () => {
	const { tokens } = await cimdTokens();

	expect(tokens.access_token).toMatch(/\S/);
	expect(tokens.refresh_token).toMatch(/\S/);

	const who = await auth.authenticateMcp(
		mcpPost(INITIALIZE, `Bearer ${tokens.access_token}`),
	);
	expect((await store.get(who?.userId ?? ""))?.origin).toBe(ORIGIN);
});

test("a CIMD client stored before read_only existed connects asking for read_only while its document is still cached", async () => {
	await cimdConnect();
	await db.execute({
		sql: 'UPDATE "oauthClient" SET "scopes" = ? WHERE "clientId" = ?',
		args: [JSON.stringify([OFFLINE_ACCESS_SCOPE]), CIMD_CLIENT_ID],
	});

	const { a, code } = await cimdConnect(
		CIMD_CLIENT_ID,
		REDIRECT_URI,
		`${OFFLINE_ACCESS_SCOPE} ${READ_ONLY_SCOPE}`,
	);
	const tokens = (await (
		await exchangeCode(call, ep, a, code)
	).json()) as Tokens;

	expect(
		await auth.authenticateMcp(
			mcpPost(INITIALIZE, `Bearer ${tokens.access_token}`),
		),
	).toMatchObject({ readOnly: true });
});

test("the CIMD client is a public client stored from the document", async () => {
	await cimdConnect();

	const { rows } = await db.execute({
		sql: 'SELECT "clientDiscoveryId", "tokenEndpointAuthMethod", "redirectUris", "clientSecret" FROM "oauthClient" WHERE "clientId" = ?',
		args: [CIMD_CLIENT_ID],
	});
	expect(rows[0]?.clientDiscoveryId).toBe("cimd");
	expect(rows[0]?.tokenEndpointAuthMethod).toBe("none");
	expect(rows[0]?.clientSecret).toBeNull();
	expect(JSON.parse(String(rows[0]?.redirectUris))).toEqual([REDIRECT_URI]);
});

test("a CIMD refresh rotates the refresh token and issues a working access token", async () => {
	const { a, tokens } = await cimdTokens();

	const res = await refresh(call, ep, a.clientId, tokens.refresh_token);
	expect(res.status).toBe(200);
	const next = (await res.json()) as Tokens;

	expect(next.refresh_token).not.toBe(tokens.refresh_token);
	expect(next.access_token).not.toBe(tokens.access_token);
	expect(
		await auth.authenticateMcp(
			mcpPost(INITIALIZE, `Bearer ${next.access_token}`),
		),
	).not.toBeNull();
});

// --- refusals ---------------------------------------------------------------

test("a redirect_uri in the document but outside the chat apps' callbacks is refused at authorize", async () => {
	const inDocButNotAllowed = "https://claude.ai/oauth/not-a-callback";
	buildWith(
		new Map([[CIMD_CLIENT_ID, validDoc(CIMD_CLIENT_ID, [inDocButNotAllowed])]]),
	);
	const a = authorization(ep, CIMD_CLIENT_ID, {
		redirectUri: inDocButNotAllowed,
	});

	const res = await navigate(a);

	const target = redirectTarget(res, a.url);
	expect(target.origin + target.pathname).toBe(`${BASE}/api/auth/error`);
	expect(target.searchParams.get("error")).toBe("invalid_redirect");
});

test("a redirect_uri absent from the document is refused at authorize", async () => {
	// the document only allows Claude's callback; ask for ChatGPT's
	const a = authorization(ep, CIMD_CLIENT_ID, {
		redirectUri: "https://chatgpt.com/connector_platform_oauth_redirect",
	});

	const res = await navigate(a);

	const target = redirectTarget(res, a.url);
	expect(target.origin + target.pathname).toBe(`${BASE}/api/auth/error`);
	expect(target.searchParams.get("error")).toBe("invalid_redirect");
});

test("a loopback redirect_uri in the document is refused, so Claude Code cannot connect", async () => {
	// Claude Code's own CIMD document carries loopback redirects; the allowlist
	// refuses them even though its host is allowed (out of scope here).
	const loopback = "http://127.0.0.1:53682/callback";
	buildWith(new Map([[CIMD_CLIENT_ID, validDoc(CIMD_CLIENT_ID, [loopback])]]));
	const a = authorization(ep, CIMD_CLIENT_ID, { redirectUri: loopback });

	const res = await navigate(a);

	expect(reachedConnect(res)).toBe(false);
	expect(await countRows(db, "connection")).toBe(0);
});

async function expectAuthorizeRefused(
	docs: Map<string, Served>,
	clientId: string,
) {
	buildWith(docs);
	const a = authorization(ep, clientId);

	const res = await navigate(a);

	expect(reachedConnect(res)).toBe(false);
	// the authorize refused before any login, so nothing was created
	expect(await countRows(db, "user")).toBe(0);
	expect(await countRows(db, "connection")).toBe(0);
	return res;
}

test("a document whose client_id does not equal the URL is refused", async () => {
	await expectAuthorizeRefused(
		new Map([[CIMD_CLIENT_ID, validDoc("https://claude.ai/oauth/other")]]),
		CIMD_CLIENT_ID,
	);
});

test("a client_id on a host outside the allowlist is refused without a fetch", async () => {
	const evil = "https://evil.example/oauth/client.json";
	const docs = new Map<string, Served>([[evil, validDoc(evil)]]);
	await expectAuthorizeRefused(docs, evil);
	// the gate rejected the URL before the transport was ever reached
	expect(await countRows(db, "oauthClient")).toBe(0);
});

test("an http client_id is refused", async () => {
	const insecure = "http://claude.ai/oauth/client.json";
	await expectAuthorizeRefused(
		new Map([[insecure, validDoc(insecure)]]),
		insecure,
	);
});

test("a client_id whose fetch resolves to a private address is refused", async () => {
	// the transport throws the way the SSRF-safe Node transport does
	const docs = new Map<string, Served>([
		[
			CIMD_CLIENT_ID,
			new TypeError(
				"metadata hostname must resolve only to public-routable addresses",
			),
		],
	]);
	await expectAuthorizeRefused(docs, CIMD_CLIENT_ID);
});

// --- the sweep and CIMD client rows -----------------------------------------

async function connectedCimdUser(): Promise<string> {
	const { tokens } = await cimdTokens();
	const who = await auth.authenticateMcp(
		mcpPost(INITIALIZE, `Bearer ${tokens.access_token}`),
	);
	if (!who) throw new Error("bearer refused");
	return who.userId;
}

test("the sweep keeps a CIMD connection that is still live, and its client row", async () => {
	await connectedCimdUser();

	const swept = await auth.sweep();

	expect(swept.connections).toBe(0);
	expect(await countRows(db, "connection")).toBe(1);
	expect(await countRows(db, "oauthClient")).toBe(1);
});

test("the sweep drops an expired CIMD connection but leaves the reusable client row", async () => {
	const userId = await connectedCimdUser();
	advance(91 * DAY);

	const swept = await auth.sweep();

	expect(swept.connections).toBe(1);
	expect(await store.get(userId)).toBeNull();
	expect(await connectionRows(db)).toEqual(NO_CONNECTION_ROWS);
	// the CIMD client stays, keyed by its URL, so a reconnect reuses it rather
	// than piling up rows
	expect(await countRows(db, "oauthClient")).toBe(1);

	const { tokens } = await cimdTokens();
	expect(tokens.access_token).toMatch(/\S/);
	expect(await countRows(db, "oauthClient")).toBe(1);
});
