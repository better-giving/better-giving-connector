import type { z } from "zod";
import type { ActionName, DeploymentClient } from "../deployment";
import type { LocalToolName } from "../log";
import type { ToolConnection } from "./run-tool";

/** A tool's hints, every one stated: a client reads a missing hint as its riskiest default. */
export type Hints = {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
	openWorldHint: boolean;
};

/** A tool's `_meta`: ChatGPT's status lines while it runs and once it has, at most 64 characters each. */
export type ToolMeta = {
	"openai/toolInvocation/invoking": string;
	"openai/toolInvocation/invoked": string;
} & Record<string, unknown>;

export const statusLines = (invoking: string, invoked: string): ToolMeta => ({
	"openai/toolInvocation/invoking": invoking,
	"openai/toolInvocation/invoked": invoked,
});

/** What a summary line reads beside the body: the reader's locale, the call's arguments, and whether a keyed write replayed. */
export type SummaryContext = {
	locale: string;
	input: Record<string, unknown>;
	replayed: boolean;
};

/**
 * A tool's structured result: the schema its `structuredContent` is listed
 * and checked against, and the one-line summary of a body that schema
 * accepted. A tool whose text is its own summary has none.
 */
export type ToolOutput = {
	schema: z.ZodObject;
	summary?: (body: Record<string, unknown>, cx: SummaryContext) => string;
};

type Common = {
	title: string;
	description: string;
	input: z.ZodObject;
	output: ToolOutput;
	annotations: Hints;
	_meta: ToolMeta;
};

/** A tool that runs one `/connector/v1` action. */
export type ActionSpec<Tool extends string = string> = Common & {
	tool: Tool;
	action: ActionName;
	/** A write's read tool: what shows whether it went through when its answer was lost. */
	checkWith?: NoInfer<Tool>;
};

/** What a local tool answers: the text the chat reads, and the structured result beside it. */
export type LocalAnswer = {
	text: string;
	structured: Record<string, unknown>;
};

export type LocalCall = {
	connection: ToolConnection;
	locale: string;
	input: Record<string, unknown>;
	client: Pick<DeploymentClient, "call">;
};

/**
 * A tool the connector answers itself, or composes from actions. It is
 * offered only where the deployment serves every action it `needs`; a throw
 * from `client.call` is worded as an action tool's failure is.
 */
export type LocalSpec = Common & {
	tool: LocalToolName;
	needs: readonly ActionName[];
	checkWith?: string;
	run(call: LocalCall): Promise<LocalAnswer>;
};

export type ToolSpec = ActionSpec | LocalSpec;

export const isActionSpec = (spec: ToolSpec): spec is ActionSpec =>
	"action" in spec;

/** The name a tool's log line carries: its action, or a local tool's own name. */
export const loggedName = (spec: ToolSpec): ActionName | LocalToolName =>
	isActionSpec(spec) ? spec.action : spec.tool;
