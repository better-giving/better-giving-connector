import { type ActionName, isActionName } from "./deployment";

// The only place this service writes a log line. Each line is built from the
// fields its kind names, so a field riding along on the event object never
// reaches it; a tool name outside the contract's actions is written as
// "unknown". `errorName` is the one free string: pass `err.name`, never a message.

/** The tools the connector answers itself, beside the contract's actions; a tool's log line names one or the other. */
export const LOCAL_TOOL_NAMES = [
	"get_profile",
	"discard_campaign_draft",
	"recommend_campaign_presets",
] as const;
export type LocalToolName = (typeof LOCAL_TOOL_NAMES)[number];
type LoggedTool = ActionName | LocalToolName;

const toolName = (tool: string): LoggedTool | "unknown" =>
	isActionName(tool) || LOCAL_TOOL_NAMES.some((name) => name === tool)
		? (tool as LoggedTool)
		: "unknown";

export type ToolOutcome =
	| "ok"
	| "invalid_input"
	| "read_only"
	| "key_refused"
	| "moved"
	| "needs_update"
	| "rejected"
	| "replaced"
	| "unreachable"
	| "server_error"
	| "failed";

/** Where a connect request ended: GET /connect, the return's stages, or Cancel. */
export type ConnectStep =
	| "open"
	| "return"
	| "exchange"
	| "complete"
	| "cancel";

export type ConnectOutcome =
	| "ok"
	| "expired"
	| "needs_update"
	| "unreachable"
	| "denied"
	| "state_mismatch"
	| "issuer_mismatch"
	| "code_invalid"
	| "failed";

export type LogEvent =
	| { kind: "tool"; tool: LoggedTool; outcome: ToolOutcome; ms: number }
	// a successful call whose body its output schema refused, answered as text alone
	| { kind: "output_invalid"; tool: LoggedTool }
	| { kind: "connect"; step: ConnectStep; outcome: ConnectOutcome }
	| { kind: "sweep"; connections: number; ms: number }
	| {
			kind: "error";
			where: "mcp" | "connect" | "auth" | "app" | "sweep" | "disconnect";
			errorName: string;
	  };

export function log(event: LogEvent): void {
	switch (event.kind) {
		case "tool": {
			const { kind, tool, outcome, ms } = event;
			console.log(JSON.stringify({ kind, tool: toolName(tool), outcome, ms }));
			return;
		}
		case "output_invalid": {
			const { kind, tool } = event;
			console.log(JSON.stringify({ kind, tool: toolName(tool) }));
			return;
		}
		case "connect": {
			const { kind, step, outcome } = event;
			console.log(JSON.stringify({ kind, step, outcome }));
			return;
		}
		case "sweep": {
			const { kind, connections, ms } = event;
			console.log(JSON.stringify({ kind, connections, ms }));
			return;
		}
		case "error": {
			const { kind, where, errorName } = event;
			console.error(JSON.stringify({ kind, where, errorName }));
			return;
		}
	}
}
