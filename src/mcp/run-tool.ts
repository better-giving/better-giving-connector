import type { CallToolResult } from "@modelcontextprotocol/server";
import type { CampaignDrafts, Connection } from "../db";
import {
	type DeploymentClient,
	DeploymentFailed,
	DeploymentRejected,
	isKeyedAction,
	isPerCallKeyed,
	KeyRefused,
	Moved,
	NeedsUpdate,
	replacementOf,
	TOOL_ACTIONS,
	Unreachable,
} from "../deployment";
import { log, type ToolOutcome } from "../log";
import type { Secret } from "../secret";
import { answerText } from "./answer";
import {
	type ActionSpec,
	isActionSpec,
	type LocalAnswer,
	loggedName,
	type SummaryContext,
	ToolRefusal,
	type ToolSpec,
} from "./spec";

export type RunToolContext = {
	client: Pick<DeploymentClient, "call">;
	drafts: CampaignDrafts;
	dropConnection(userId: string): Promise<void>;
};

/** A stored connection as this session uses it: Platform or not, and on Platform the actions its hello lists now. */
export type ToolConnection = Connection & { platform: boolean };

type Settled = { outcome: ToolOutcome; result: CallToolResult };

/**
 * Runs one tool call: an action on the connection's deployment, or a local
 * tool's own run. The one place a deployment's failure becomes the sentence
 * the chat shows; it never throws. `locale` formats the money and dates the
 * answer prints, never its currency.
 */
export async function runTool(
	spec: ToolSpec,
	connection: ToolConnection,
	input: Record<string, unknown>,
	ctx: RunToolContext,
	locale: string,
): Promise<CallToolResult> {
	const started = performance.now();
	const { outcome, result } = await settle(
		spec,
		connection,
		input,
		ctx,
		locale,
	);
	const ms = Math.round(performance.now() - started);
	log({ kind: "tool", tool: loggedName(spec), outcome, ms });
	return redactConnectionKey(result, connection.key);
}

// A deployment that echoes the connection key must not hand it to the chat,
// in the text or the structured result. An empty key is not a pattern:
// splitting on it would rewrite the whole text.
function redactConnectionKey(
	result: CallToolResult,
	key: Secret,
): CallToolResult {
	const value = key.reveal();
	if (value.length === 0) return result;
	const redact = (text: string) => text.replaceAll(value, "[redacted]");
	const redacted: CallToolResult = {
		...result,
		content: result.content.map((part) =>
			part.type === "text" && part.text.includes(value)
				? { ...part, text: redact(part.text) }
				: part,
		),
	};
	if (result.structuredContent !== undefined) {
		redacted.structuredContent = redactStrings(
			result.structuredContent,
			redact,
		) as Record<string, unknown>;
	}
	return redacted;
}

// Every string in a JSON value, object keys included, through `redact`.
function redactStrings(
	value: unknown,
	redact: (text: string) => string,
): unknown {
	if (typeof value === "string") return redact(value);
	if (Array.isArray(value)) return value.map((v) => redactStrings(v, redact));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				redact(k),
				redactStrings(v, redact),
			]),
		);
	}
	return value;
}

async function settle(
	spec: ToolSpec,
	connection: ToolConnection,
	input: Record<string, unknown>,
	ctx: RunToolContext,
	locale: string,
): Promise<Settled> {
	try {
		const call = {
			connection,
			locale,
			input,
			client: ctx.client,
			drafts: ctx.drafts,
		};
		const answered = ({ text, structured }: LocalAnswer) =>
			ok(present(spec, text, structured, { locale, input, replayed: false }));
		if (!isActionSpec(spec)) return answered(await spec.run(call));
		const composed = await spec.compose?.(call);
		if (composed) return answered(composed);
		const answer = await ctx.client.call(connection, spec.action, input);
		const replayed = isKeyedAction(spec.action) && answer.status === 200;
		const text = await answerText(spec, connection, input, answer, ctx, locale);
		const cx = { locale, input, replayed };
		return ok(present(spec, text, answer.body, cx));
	} catch (error) {
		// A throw out of here would reach the chat as its message, so whatever
		// `failure` can't word (its own drop included) is answered by `unexpected`.
		return await failure(error, spec, connection, ctx).catch((thrown) =>
			unexpected(thrown, spec, connection),
		);
	}
}

const ok = (result: CallToolResult): Settled => ({ outcome: "ok", result });

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A successful answer as the chat gets it: the text first, then, for a body
 * the tool's output schema accepts, its summary line, with the body as the
 * structured result. A body the schema refuses, or whose summary can't be
 * worded, never fails the call: it is logged by tool name alone and answered
 * as text.
 */
function present(
	spec: ToolSpec,
	text: string,
	body: unknown,
	cx: SummaryContext,
): CallToolResult {
	const textOnly: CallToolResult = { content: [{ type: "text", text }] };
	if (!isObject(body)) return textOnly;
	const parsed = spec.output.schema.safeParse(body);
	let summary: string | undefined;
	try {
		if (!parsed.success) throw parsed.error;
		summary = spec.output.summary?.(parsed.data, cx);
	} catch {
		log({ kind: "output_invalid", tool: loggedName(spec) });
		return textOnly;
	}
	return {
		content:
			summary === undefined
				? textOnly.content
				: [...textOnly.content, { type: "text", text: summary }],
		structuredContent: body,
	};
}

async function failure(
	error: unknown,
	spec: ToolSpec,
	connection: ToolConnection,
	ctx: RunToolContext,
): Promise<Settled> {
	const org = connection.orgName;
	if (error instanceof ToolRefusal) return said(error.outcome, error.text);
	if (error instanceof KeyRefused) {
		await ctx.dropConnection(connection.userId);
		return said(
			"key_refused",
			`Better Giving at ${org} no longer accepts this connection. Reconnect Better Giving in your AI assistant's connector settings to keep going.`,
		);
	}
	if (error instanceof Moved) {
		await ctx.dropConnection(connection.userId);
		return said(
			"moved",
			`${org}'s Better Giving site has moved to a new address. Reconnect Better Giving in your AI assistant's connector settings.`,
		);
	}
	if (error instanceof NeedsUpdate) {
		return said(
			"needs_update",
			`${org} can't do this through the connector yet. The other tools still work.`,
		);
	}
	if (error instanceof DeploymentFailed) {
		const problem = JSON.stringify(error.problem);
		const check = spec.checkWith
			? `It may or may not have been saved; check with ${spec.checkWith} before trying again.`
			: undefined;
		return said(
			"server_error",
			check === undefined ? problem : `${problem}\n\n${check}`,
		);
	}
	if (error instanceof DeploymentRejected) {
		// What a refusal says to do next is worded for the action that was
		// refused; a local tool's refusal is the problem alone.
		const action = isActionSpec(spec) ? spec : null;
		const replaced = action && replacedText(error, action, connection);
		if (replaced) return said("replaced", replaced);
		const next =
			action && connection.platform ? platformNextStep(error, action) : null;
		if (next !== null && error.problem) {
			return said("rejected", `${next}\n\n${JSON.stringify(error.problem)}`);
		}
		return said(
			"rejected",
			error.problem
				? JSON.stringify(error.problem)
				: `${org}'s Better Giving refused this request.`,
		);
	}
	if (error instanceof Unreachable) {
		return said(
			"unreachable",
			unconfirmed(spec, org) ??
				`${org}'s donation site didn't answer. Try again in a moment.`,
		);
	}
	throw error;
}

// Standalone answers a block action it retired with 422 `replaced`, naming
// the content action in its place. The chat is told the tool that runs it; a
// connection whose stored actions predate that tool offers it only after a
// reconnect, which reads the site's actions afresh.
function replacedText(
	error: DeploymentRejected,
	spec: ActionSpec,
	connection: Connection,
): string | null {
	if (error.status !== 422 || error.problem?.code !== "replaced") return null;
	const action = replacementOf(spec.action);
	const tool = Object.entries(TOOL_ACTIONS).find(
		([, served]) => served === action,
	)?.[0];
	if (action === null || tool === undefined) return null;
	const text = `Better Giving at ${connection.orgName} no longer serves ${spec.tool}. It now edits a page's content and arranges the page from it. Use ${tool} instead.`;
	return connection.actions === null || connection.actions.includes(action)
		? text
		: `${text} If ${tool} isn't offered yet, reconnect Better Giving in your AI assistant's connector settings to get it.`;
}

// What the chat does next about a Platform refusal whose code names it; the
// problem itself follows, for the fields and detail behind it.
function platformNextStep(
	error: DeploymentRejected,
	spec: ActionSpec,
): string | null {
	const code = error.problem?.code;
	if (error.status === 409) {
		switch (code) {
			case "stale_read":
				if (spec.action === "forms.update") {
					return "Nothing was saved: this form changed after it was read. Read it again with get_form, make the change against what it shows now (with the updated_at it returns), and try again.";
				}
				// Only a tool that takes expected_version can be told to send it.
				return Object.hasOwn(spec.input.shape, "expected_version")
					? "Nothing was saved: this campaign changed after it was read. Read it again with get_campaign, make the change against what it shows now, and send the version it returns as expected_version."
					: "Nothing was saved: this campaign changed after it was read. Read it again with get_campaign, and make the change against what it shows now.";
			case "campaign_ended":
				return "Nothing was saved: this campaign has ended, and an ended campaign stays ended. It can't be edited, published, or given a new photo. Tell the operator; a new appeal needs a new campaign.";
			case "already_published":
				return "This campaign is already live, so where its gifts go can't be changed here. The operator changes it in the Better Giving dashboard.";
			case "confirm_required":
				return "Nothing was saved: this form is live, so donors would see this change. Tell the operator what will change and ask them to confirm. Only after they say yes, call update_form again with the same change and confirm: true.";
		}
		if (isPerCallKeyed(spec.action)) {
			if (code === "idempotency_in_progress") {
				return `The site is still working on this request. Wait a few seconds, then check with ${spec.checkWith} whether it went through before calling ${spec.tool} again: a new call would make a second one.`;
			}
			if (code === "idempotency_conflict") {
				return `Nothing was made: the site matched this request to a different one. Check with ${spec.checkWith}, then call ${spec.tool} again if it is still needed.`;
			}
		}
	}
	if (
		error.status === 422 &&
		spec.action === "campaigns.update_blocks" &&
		error.problem?.errors?.some((e) => e.path.endsWith(".image_url"))
	) {
		return "Nothing was saved: the hero photo must be one uploaded for this campaign. Make a link with create_photo_upload_link and have the operator upload the photo there; it becomes the campaign's hero, which get_campaign then shows. Otherwise send the hero as get_campaign returns it, or null.";
	}
	return null;
}

function unexpected(
	error: unknown,
	spec: ToolSpec,
	connection: Connection,
): Settled {
	const errorName = error instanceof Error ? error.name : "unknown";
	log({ kind: "error", where: "mcp", errorName });
	return said(
		"failed",
		unconfirmed(spec, connection.orgName) ??
			"Something went wrong on Better Giving's side. Try again in a moment.",
	);
}

// A write whose answer was lost may still have landed on the deployment.
const unconfirmed = ({ checkWith }: ToolSpec, org: string) =>
	checkWith
		? `${org}'s donation site didn't confirm this. It may have gone through. Check with ${checkWith} before trying again.`
		: undefined;

const said = (outcome: ToolOutcome, text: string): Settled => ({
	outcome,
	result: { isError: true, content: [{ type: "text", text }] },
});
