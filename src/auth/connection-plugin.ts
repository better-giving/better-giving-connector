import { createHash } from "node:crypto";
import {
	getIssuer,
	getOAuthProviderApi,
	getOAuthProviderState,
	type OAuthOptions,
	type Scope,
} from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import {
	APIError,
	createAuthEndpoint,
	createAuthMiddleware,
	isAPIError,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import {
	createDpopReplayStore,
	enforceDpopBinding,
	isDpopBindingError,
	parseAccessTokenAuthorization,
} from "better-auth/oauth2";
import { z } from "zod";
import { isAllowedRedirectUri } from "./redirect-uris";
import { isReadOnly, OFFLINE_ACCESS_SCOPE, READ_ONLY_SCOPE } from "./scopes";

// oauth-provider's default `storeTokens: "hashed"`
export const storedToken = (token: string) =>
	createHash("sha256").update(token).digest("base64url");

// Where oauth-provider's authorize reads its parameters: the form body of a
// POST to /oauth2/authorize, else the query. Its resume after sign-in
// dispatches with `authorizeSettings` set and reads the query whatever the
// method (`getAuthorizationRequestParameters` in its dist).
function authorizeParameters(ctx: {
	method?: string;
	request?: Request;
}): "body" | "query" {
	const { authorizeSettings } = ctx as {
		authorizeSettings?: { isAuthorize?: boolean };
	};
	const isAuthorize =
		authorizeSettings === undefined || authorizeSettings.isAuthorize === true;
	const method = ctx.method ?? ctx.request?.method;
	return method === "POST" && isAuthorize ? "body" : "query";
}

// Server-only endpoints: never on the HTTP router, callable only as
// `auth.api.*` from this module's facade.
export const connectionPlugin = (opts: {
	provider: OAuthOptions<Scope[]>;
	resource: string;
	/**
	 * Called with the request's token after `/oauth2/revoke` succeeds. The
	 * revoke's answer waits for it, up to the disconnect timeout on the
	 * nonprofit's site.
	 */
	revoked: (token: string) => Promise<void>;
}) =>
	({
		id: "better-giving-connection",
		// oauth-provider's `validateRedirectUri` guards authorize only; this
		// refuses the client at registration too
		hooks: {
			before: [
				{
					matcher: (ctx) => ctx.path === "/oauth2/register",
					handler: createAuthMiddleware(async (ctx) => {
						const uris: unknown = ctx.body?.redirect_uris;
						const allowed =
							Array.isArray(uris) &&
							uris.every(
								(u) => typeof u === "string" && isAllowedRedirectUri(u),
							);
						if (allowed) return;
						throw new APIError("BAD_REQUEST", {
							error: "invalid_redirect_uri",
							error_description: "redirect_uris must be an allowed callback",
						});
					}),
				},
				{
					matcher: (ctx) => ctx.path === "/oauth2/authorize",
					handler: createAuthMiddleware(async (ctx) => {
						const where = authorizeParameters(ctx);
						const params: Record<string, unknown> = ctx[where] ?? {};
						const scope = params.scope;
						// oauth-provider grants a client's whole capability set to an
						// authorize without `scope`, and every registered client holds
						// read_only; read_only is granted only when asked for
						if (scope === undefined) {
							return {
								context: {
									[where]: { ...params, scope: OFFLINE_ACCESS_SCOPE },
								},
							};
						}
						const clientId = params.client_id;
						if (typeof scope !== "string" || !isReadOnly(scope)) return;
						if (typeof clientId !== "string") return;
						// a client stored before read_only was offered (a CIMD client
						// until its document is fetched again) holds offline_access
						// alone; widening its allowed set to read_only lets it connect
						// asking for every advertised scope. The request is untouched.
						const client = await ctx.context.adapter.findOne<{
							scopes?: string[] | null;
						}>({
							model: "oauthClient",
							where: [{ field: "clientId", value: clientId }],
						});
						if (!client?.scopes || client.scopes.includes(READ_ONLY_SCOPE)) {
							return;
						}
						await ctx.context.adapter.update({
							model: "oauthClient",
							where: [{ field: "clientId", value: clientId }],
							update: { scopes: [...client.scopes, READ_ONLY_SCOPE] },
						});
					}),
				},
				{
					// oauth-provider lets a refresh narrow its scopes, and dropping
					// read_only narrows the scope string while widening the token
					matcher: (ctx) =>
						ctx.path === "/oauth2/token" &&
						ctx.body?.grant_type === "refresh_token" &&
						typeof ctx.body.scope === "string" &&
						!isReadOnly(ctx.body.scope),
					handler: createAuthMiddleware(async (ctx) => {
						const token: unknown = ctx.body?.refresh_token;
						if (typeof token !== "string") return;
						const row = await ctx.context.adapter.findOne<{
							scopes: string[];
						}>({
							model: "oauthRefreshToken",
							where: [{ field: "token", value: storedToken(token) }],
						});
						if (!row?.scopes.includes(READ_ONLY_SCOPE)) return;
						throw new APIError("BAD_REQUEST", {
							error: "invalid_scope",
							error_description: `a refresh must keep ${READ_ONLY_SCOPE}`,
						});
					}),
				},
			],
			after: [
				{
					matcher: (ctx) => ctx.path === "/oauth2/revoke",
					handler: createAuthMiddleware(async (ctx) => {
						if (isAPIError(ctx.context.returned)) return;
						const token: unknown = ctx.body?.token;
						if (typeof token === "string") await opts.revoked(token);
					}),
				},
			],
		},
		endpoints: {
			// Signs a connection's user in. The `oauth_query` in the body is what
			// lets oauth-provider's after-hook resume the authorize request once
			// the session cookie is set; its answer replaces this one.
			signInConnection: createAuthEndpoint.serverOnly(
				{
					method: "POST",
					body: z.object({ userId: z.string(), oauth_query: z.string() }),
				},
				async (ctx) => {
					const user = await ctx.context.internalAdapter.findUserById(
						ctx.body.userId,
					);
					if (!user) throw new APIError("NOT_FOUND");
					const session = await ctx.context.internalAdapter.createSession(
						user.id,
					);
					await setSessionCookie(ctx, { session, user });
					return ctx.json(null);
				},
			),
			// The refusal oauth-provider's consent endpoint sends on `accept: false`
			// (RFC 6749 §4.1.2.1, `iss` per RFC 9207), without the session that
			// endpoint demands. oauth-provider's `oauth_query` before-hook has
			// verified the signature and stored the query; authorize had already
			// checked its redirect_uri against the client before signing it.
			denyConnection: createAuthEndpoint.serverOnly(
				{ method: "POST", body: z.object({ oauth_query: z.string() }) },
				async (ctx) => {
					const query = new URLSearchParams(
						(await getOAuthProviderState())?.query,
					);
					const redirectUri = query.get("redirect_uri");
					if (!redirectUri) throw new APIError("BAD_REQUEST");
					const url = new URL(redirectUri);
					url.searchParams.append("error", "access_denied");
					url.searchParams.append("error_description", "User denied access");
					const state = query.get("state");
					if (state) url.searchParams.append("state", state);
					url.searchParams.append("iss", getIssuer(ctx, opts.provider));
					return ctx.json({ url: url.toString() });
				},
			),
			// The resource-server check oauth-provider runs for its own userinfo
			// endpoint, plus the audience: active in the database (so deleting
			// its rows revokes it), sender-bound when DPoP-bound, not issued for
			// another resource.
			verifyMcpAccessToken: createAuthEndpoint.serverOnly(
				{
					method: "POST",
					body: z.object({
						authorization: z.string().optional(),
						dpop: z.string().optional(),
						method: z.string(),
						url: z.string(),
					}),
				},
				async (ctx) => {
					const authorization = parseAccessTokenAuthorization(
						ctx.body.authorization,
					);
					// opaque tokens carry no "."; with the JWT plugin off a dotted bearer
					// is never ours, and oauth-provider's JWT path throws a plain Error
					// (a 500) on one
					if (!authorization || authorization.token.includes(".")) {
						return ctx.json(null);
					}
					const provider = getOAuthProviderApi(ctx, opts.provider);
					try {
						const payload = await provider.requireActiveAccessToken(
							authorization.token,
						);
						await enforceDpopBinding({
							payload,
							authorization,
							proofJwt: ctx.body.dpop,
							method: ctx.body.method,
							url: ctx.body.url,
							replayStore: createDpopReplayStore(ctx.context.internalAdapter),
							proofMaxAgeSeconds: opts.provider.dpop?.proofMaxAgeSeconds,
							signingAlgorithms: opts.provider.dpop?.signingAlgorithms,
						});
						// a token issued without `resource` has no audience; /mcp is this
						// server's only resource, so it is /mcp's
						const audience = [payload.aud ?? []].flat();
						const forMcp =
							audience.length === 0 || audience.includes(opts.resource);
						if (!payload.sub || !forMcp) {
							return ctx.json(null);
						}
						// RFC 7662 `scope`: the space-delimited scopes the token was granted
						const { scope } = payload;
						return ctx.json({
							userId: payload.sub,
							readOnly: isReadOnly(typeof scope === "string" ? scope : null),
						});
					} catch (error) {
						if (isAPIError(error) || isDpopBindingError(error)) {
							return ctx.json(null);
						}
						throw error;
					}
				},
			),
		},
	}) satisfies BetterAuthPlugin;
