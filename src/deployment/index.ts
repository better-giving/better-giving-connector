import { randomUUID } from "node:crypto";
import { Secret } from "../secret";
import {
	type ActionName,
	ALLOW_PATH,
	BASE_PATH,
	type ChatClient,
	exchangeBody,
	helloBody,
	type Problem,
	problemOf,
	ROUTES,
} from "./contract";
import {
	CodeInvalid,
	DeploymentFailed,
	DeploymentRejected,
	KeyRefused,
	Moved,
	NeedsUpdate,
	Unreachable,
} from "./errors";
import { idempotencyKey, isKeyedAction, isPerCallKeyed } from "./idempotency";
import { type Origin, parseOrigin } from "./origin";

export {
	type ActionName,
	type ChatClient,
	isActionName,
	knownActions,
	replacementOf,
	TOOL_ACTIONS,
} from "./contract";
export {
	CodeInvalid,
	DeploymentFailed,
	DeploymentRejected,
	KeyRefused,
	Moved,
	NeedsUpdate,
	Unreachable,
} from "./errors";
export {
	idempotencyKey,
	isKeyedAction,
	isPerCallKeyed,
} from "./idempotency";

export type Hello = {
	/** Where hello answered: the origin asked, or the one it moved to. */
	origin: Origin;
	release: string;
	orgName: string;
	/** The actions this deployment serves, or null when hello didn't state them. */
	actions: ActionName[] | null;
	/** Platform rather than Standalone: hello listed tool names. */
	platform: boolean;
};

export type DeploymentClient = {
	/**
	 * Unauthenticated probe: is there a Better Giving speaking this contract at
	 * `origin`? Follows one redirect to another origin `parseOrigin` accepts, so
	 * a stored Standalone origin whose site moved between apex and www still
	 * answers; the answering origin comes back in `Hello.origin`.
	 */
	hello(origin: Origin): Promise<Hello>;
	/**
	 * The deployment's Allow screen; it returns the browser to an address fixed
	 * in its own code. `client` only picks the chat app's name and logo there;
	 * null leaves the param out.
	 */
	allowUrl(origin: Origin, state: string, client?: ChatClient | null): URL;
	exchange(origin: Origin, code: string): Promise<Exchanged>;
	/**
	 * Runs one contract action with the connection's key. Path params (`:id`)
	 * are taken from `input`; the rest goes as query on GET, JSON body otherwise.
	 * On Platform, a per-call keyed write is tried up to three times under one
	 * key: once more when an answer is lost (no answer, or a 5xx), and again
	 * whenever the site answers that an earlier try under that key is still
	 * running, after its Retry-After held to five seconds.
	 */
	call(
		conn: DeploymentTarget,
		action: ActionName,
		input: Record<string, unknown>,
	): Promise<CallAnswer>;
	/** Revokes the connection's key at the deployment; a key already refused counts as done. */
	disconnect(conn: DeploymentTarget): Promise<void>;
};

export type Exchanged = { key: Secret; orgName: string };

/** What a keyed write distinguishes: 201 created, 200 replayed the same call. */
export type CallAnswer = { status: number; body: unknown };

export type DeploymentTarget = {
	origin: Origin;
	key: Secret;
	/** Present on a stored connection. Keyed writes derive their Idempotency-Key from it. */
	userId?: string;
	/** Platform, whose per-call keyed writes carry a key and may be retried. */
	platform?: boolean;
};

const TIMEOUT_MS = 15_000;
// disconnect runs while a connection is dropped, inside a tool call or the sweep.
const DISCONNECT_TIMEOUT_MS = 5_000;
// The tries one per-call keyed write gets, and the longest wait between two.
// At most one retry follows a lost answer.
const KEYED_TRIES = 3;
const MAX_RETRY_WAIT_MS = 5_000;
// hello runs unauthenticated, before sign-in, so an unbounded read would let
// whoever answers it stream the function out of memory.
const MAX_BODY_BYTES = 1024 * 1024;
const NOT_JSON = Symbol("not json");

type Answer = {
	status: number;
	body: unknown;
	location: string | null;
	contentType: string | null;
	retryAfter: string | null;
};

export function deploymentClient(deps: {
	fetch: typeof fetch;
	/** Waits between keyed tries; tests pass one that records the wait instead. */
	sleep?: (ms: number) => Promise<void>;
}): DeploymentClient {
	const sleep =
		deps.sleep ??
		((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

	// Any throw from fetch or the body read — refused redirect, DNS, reset, the
	// timeout's abort, a body over the cap — is AnswerLost, an Unreachable that
	// a per-call keyed write on Platform retries once; the original error is
	// dropped, not chained, because its message can carry the URL and so a
	// tool input.
	async function send(
		url: string,
		init: RequestInit = {},
		redirect: "error" | "manual" = "error",
		timeoutMs = TIMEOUT_MS,
	): Promise<Answer> {
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), timeoutMs);
		try {
			const res = await deps.fetch(url, {
				...init,
				redirect,
				signal: abort.signal,
			});
			return {
				status: res.status,
				body: parseJson(await readBody(res)),
				location: res.headers.get("location"),
				contentType: res.headers.get("content-type"),
				retryAfter: res.headers.get("retry-after"),
			};
		} catch {
			abort.abort();
			throw new AnswerLost();
		} finally {
			clearTimeout(timer);
		}
	}

	const client: DeploymentClient = {
		async hello(asked) {
			const helloUrl = (at: Origin) => `${at}${BASE_PATH}/hello`;
			let origin = asked;
			let answer = await send(helloUrl(origin), {}, "manual");
			if (isRedirect(answer.status)) {
				const target = redirectTarget(answer, helloUrl(origin));
				if (!target || target === origin) throw new Unreachable();
				origin = target;
				// A second hop fails the fetch, so it is Unreachable.
				answer = await send(helloUrl(origin));
			}
			const { status, body } = answer;
			// Only a 404 or a body that isn't ours means "not this contract"; a 401, 403
			// or 429 is a wall in front of the site (protection, a challenge, a rate limit).
			if (status !== 404 && !isSuccess(status)) throw new Unreachable();
			const hello = helloBody.safeParse(body);
			if (status === 404 || !hello.success) throw new NeedsUpdate();
			const { release, orgName, actions, platform } = hello.data;
			// a name that cleans to nothing is shown as the site's own host
			return {
				origin,
				release,
				orgName: orgName || new URL(origin).hostname,
				actions,
				platform,
			};
		},

		allowUrl(origin, state, client) {
			const url = new URL(ALLOW_PATH, origin);
			url.searchParams.set("state", state);
			if (client) url.searchParams.set("client", client);
			return url;
		},

		async exchange(origin, code) {
			const answer = await send(`${origin}${BASE_PATH}/exchange`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json",
				},
				body: JSON.stringify({ code }),
			});
			if (answer.status === 400 && codeOf(answer.body) === "code_invalid") {
				throw new CodeInvalid();
			}
			// exchange sends no key, so a 401 is a wall in front of the site, not a refused key.
			if (answer.status === 401) throw new Unreachable();
			const parsed = exchangeBody.safeParse(succeeded(answer).body);
			if (!parsed.success) throw new Unreachable();
			return { key: new Secret(parsed.data.key), orgName: parsed.data.orgName };
		},

		async call(conn, action, input) {
			if (conn.platform !== true || !isPerCallKeyed(action)) {
				return succeeded(await attempt(conn, action, input));
			}
			const key = randomUUID();
			let lostRetried = false;
			for (let tries = 1; ; tries++) {
				const final = tries === KEYED_TRIES;
				const answer = await attempt(conn, action, input, key).catch(
					(error: unknown) => {
						if (error instanceof AnswerLost) return null;
						throw error;
					},
				);
				// The site may have made the form; the same key gets its replay.
				if (
					!final &&
					!lostRetried &&
					(answer === null || answer.status >= 500)
				) {
					lostRetried = true;
					continue;
				}
				if (answer === null) throw new Unreachable();
				if (final || !inProgress(answer)) return succeeded(answer);
				await sleep(retryWait(answer));
			}
		},

		async disconnect(conn) {
			// A 3xx is Unreachable, with no Moved probe: the key goes to this origin or nowhere.
			const answer = await send(
				`${conn.origin}${BASE_PATH}/disconnect`,
				{
					method: "POST",
					headers: {
						authorization: `Bearer ${conn.key.reveal()}`,
						accept: "application/json",
					},
				},
				"manual",
				DISCONNECT_TIMEOUT_MS,
			);
			if (isSuccess(answer.status)) return;
			try {
				succeeded(answer);
			} catch (error) {
				if (error instanceof KeyRefused) return;
				throw error;
			}
		},
	};

	// One request for `action`; a 3xx ends here, any other answer is the caller's.
	async function attempt(
		conn: DeploymentTarget,
		action: ActionName,
		input: Record<string, unknown>,
		perCallKey?: string,
	): Promise<Answer> {
		const { method, path } = ROUTES[action];
		const rest = { ...input };
		// Encoded, so an id can't add a path segment, let alone change the host.
		const filled = path.replace(/:(\w+)/g, (_, name: string) => {
			const value = rest[name];
			delete rest[name];
			return encodeURIComponent(String(value));
		});
		const url = new URL(`${conn.origin}${BASE_PATH}${filled}`);
		const headers: Record<string, string> = {
			authorization: `Bearer ${conn.key.reveal()}`,
			accept: "application/json",
		};
		// Derived from the validated input for the two writes that replay, or
		// the call's own for a per-call keyed write. The value is a header,
		// never a log field.
		if (isKeyedAction(action) && conn.userId !== undefined) {
			headers["idempotency-key"] = idempotencyKey(conn.userId, action, input);
		}
		if (perCallKey !== undefined) headers["idempotency-key"] = perCallKey;
		let body: string | undefined;
		if (method === "GET") {
			for (const [name, value] of Object.entries(rest)) {
				if (value !== undefined && value !== null)
					url.searchParams.set(name, String(value));
			}
		} else {
			headers["content-type"] = "application/json";
			body = JSON.stringify(rest);
		}
		// Not followed, so the key never travels to wherever the site now points.
		const answer = await send(url.href, { method, headers, body }, "manual");
		if (isRedirect(answer.status)) {
			const target = redirectTarget(answer, url.href);
			// Dropping a connection is permanent, so a hop alone never proves a
			// move: a temporary redirect, a maintenance page or a CDN hiccup
			// would otherwise end every user's connection to the site. Moved
			// needs a permanent status and hello (keyless) answering at the
			// same new origin; anything less is Unreachable, which a retry may pass.
			if (
				!target ||
				target === conn.origin ||
				!isPermanentRedirect(answer.status)
			) {
				throw new Unreachable();
			}
			const confirmed = await client.hello(conn.origin).then(
				(hello) => hello.origin === target,
				() => false,
			);
			throw confirmed ? new Moved() : new Unreachable();
		}
		return answer;
	}

	return client;
}

// No answer reached us: the request may or may not have run.
class AnswerLost extends Unreachable {}

// The one status → error mapping for authenticated and exchange requests.
function succeeded(answer: Answer): CallAnswer {
	const { status, body } = answer;
	if (isSuccess(status) && body !== NOT_JSON) return { status, body };
	if (status === 401) {
		// Only the contract's own refusal drops the connection; any other 401 is
		// a wall in front of the site (protection, SSO), which a retry may pass.
		if (codeOf(body) === "key_refused") throw new KeyRefused();
		throw new Unreachable();
	}
	if (status === 404) {
		// Only `not_found` is a missing resource; any other 404 is a release
		// without this action, or without /connector/v1 at all.
		const problem = problemOf(body);
		if (problem?.code === "not_found")
			throw new DeploymentRejected(404, problem);
		throw new NeedsUpdate();
	}
	if (status >= 400 && status < 500) {
		throw new DeploymentRejected(status, problemOf(body));
	}
	if (status >= 500) {
		const problem = problemResponse(answer);
		if (problem) throw new DeploymentFailed(status, problem);
	}
	throw new Unreachable();
}

/** A 5xx problem the chat can read. Any other 5xx body stays unreachable. */
function problemResponse(answer: Answer): Problem | null {
	const type = answer.contentType?.toLowerCase() ?? "";
	if (!type.includes("application/problem+json")) return null;
	return problemOf(answer.body);
}

/** The origin a 3xx points at, if `parseOrigin` accepts it. */
const redirectTarget = ({ location }: Answer, from: string): Origin | null =>
	location ? parseOrigin(new URL(location, from).href) : null;

const isSuccess = (status: number) => status >= 200 && status < 300;
const isRedirect = (status: number) => status >= 300 && status < 400;
const isPermanentRedirect = (status: number) =>
	status === 301 || status === 308;

const codeOf = (body: unknown) => problemOf(body)?.code;

// The site still runs an earlier try under the same key.
const inProgress = (answer: Answer) =>
	answer.status === 409 && codeOf(answer.body) === "idempotency_in_progress";

// Retry-After in seconds, held to the longest wait; no usable header waits the most.
function retryWait({ retryAfter }: Answer): number {
	const seconds = Number(retryAfter ?? Number.NaN);
	return retryAfter !== null && retryAfter.trim() !== "" && seconds >= 0
		? Math.min(seconds * 1000, MAX_RETRY_WAIT_MS)
		: MAX_RETRY_WAIT_MS;
}

async function readBody(res: Response): Promise<string> {
	if (Number(res.headers.get("content-length")) > MAX_BODY_BYTES) {
		throw new RangeError("response over the size cap");
	}
	if (!res.body) return "";
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return new TextDecoder().decode(Buffer.concat(chunks));
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel();
			throw new RangeError("response over the size cap");
		}
		chunks.push(value);
	}
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return NOT_JSON;
	}
}
