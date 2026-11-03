import type { Host } from "../host";
import {
	APP_TOOLS,
	type AppToolArgs,
	type AppToolName,
	type AppToolResult,
} from "../model";

export type Called<T> = { ok: true; data: T } | { ok: false; error: string };

// A write's change may have landed before its answer failed to parse, so a
// blind retry could make it twice.
const UNREADABLE =
	"Better Giving answered, but the answer wasn't one this card can read. Check the campaign before trying again.";

/**
 * Calls an app-only (or get_profile) tool through the host and parses its
 * answer with the contract's schema. A failure is the tool's own sentence.
 */
export async function callTool<N extends AppToolName>(
	host: Host,
	name: N,
	args: AppToolArgs<N>,
): Promise<Called<AppToolResult<N>>> {
	const outcome = await host.callTool(name, args as Record<string, unknown>);
	if (!outcome.ok) return outcome;
	const parsed = APP_TOOLS[name].result.safeParse(outcome.data);
	if (!parsed.success) return { ok: false, error: UNREADABLE };
	return { ok: true, data: parsed.data as AppToolResult<N> };
}
