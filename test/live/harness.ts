import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deploymentClient } from "../../src/deployment";
import { parseOrigin } from "../../src/deployment/origin";
import { DEFAULT_LOCALE } from "../../src/format";
import { ACTIONS, type ActionSpec, actionsFor } from "../../src/mcp/actions";
import {
	type RunToolContext,
	runTool,
	type ToolConnection,
} from "../../src/mcp/run-tool";
import { MVP_ACTIONS } from "../fake-deployment";
import { memoryDrafts } from "../memory-drafts";

const REPLAY =
	"Already done: this matches an earlier call with the same details, so nothing new was recorded. The original result follows.";
const UNKNOWN = "can't do this through the connector yet";
const REFUSED = "no longer accepts this connection";

const MVP = new Set<string>(MVP_ACTIONS);

/** The largest `limit` a list tool's input takes (`page` in src/mcp/actions.ts). */
const MAX_LIMIT = 100;

export type LiveRow = {
	tool: string;
	outcome:
		| "ok"
		| "replay"
		| "unknown_action"
		| "key_refused"
		| "error"
		// never called: a write or publish the deployment serves, or get_donor
		// when list_donors lists no donor to read
		| "skipped";
	ms: number;
	bytes: number;
};

export type LiveHarnessOptions = {
	origin: string;
	code: string;
	fetch: typeof fetch;
	/** Overwritten with one JSON line per tool: tool, outcome, ms, bytes. */
	resultsPath: string;
	now?: Date;
};

/**
 * Hello, exchange, the 13 minimum tools (create and record twice), the other
 * 12 as actions this deployment does not serve, then disconnect and one refused
 * call. On Platform a form is created first when create_form is served, because
 * a nonprofit starts with none. A deployment that does not serve
 * donations.record (Platform) gets record_donation once, refused, and get_donor
 * reads the first donor list_donors lists, or is skipped when there is none.
 * An other tool the deployment serves is skipped, not called: it would write,
 * publish or reset real records. The results file never receives arguments,
 * response bodies, or the key.
 */
export async function runLiveHarness(opts: LiveHarnessOptions): Promise<void> {
	const rows: LiveRow[] = [];
	try {
		const origin = parseOrigin(opts.origin);
		if (!origin) throw new Error("origin is not a public https origin");
		const client = deploymentClient({ fetch: opts.fetch });
		const hello = await client.hello(origin);
		const exchanged = await client.exchange(hello.origin, opts.code);
		const connection: ToolConnection = {
			userId: "live-harness",
			origin: hello.origin,
			orgName: hello.orgName,
			actions: hello.actions,
			platform: hello.platform,
			key: exchanged.key,
			createdAt: opts.now ?? new Date(),
		};
		let dropped = false;
		const ctx: RunToolContext = {
			client,
			drafts: memoryDrafts(),
			publicOrigin: "https://app.connect.better.giving",
			fetch,
			dropConnection: async () => {
				dropped = true;
			},
		};
		const now = opts.now ?? new Date();
		const stamp = `connector live test ${now.toISOString()}`;
		const day = now.toISOString().slice(0, 10);
		const ids = { campaign: "", form: "", donor: "" };

		const mvp = ACTIONS.filter((spec) => MVP.has(spec.action));
		const rest = ACTIONS.filter((spec) => !MVP.has(spec.action));
		if (mvp.length !== 13 || rest.length !== 12) {
			throw new Error(
				"the connector does not list 13 minimum tools and 12 others",
			);
		}

		const created = await run(rows, ctx, connection, "create_campaign", {
			title: stamp,
		});
		await run(rows, ctx, connection, "create_campaign", { title: stamp });
		expectOutcome(rows.at(-2), "create_campaign", "ok");
		expectOutcome(rows.at(-1), "create_campaign", "replay");
		ids.campaign = stringField(created, (value) => value.id, "create_campaign");

		for (const tool of [
			"list_campaigns",
			"get_campaign",
			"get_donation_page",
			"get_block_catalog",
		] as const) {
			await run(rows, ctx, connection, tool, minimumArgs(tool, ids));
			expectOutcome(rows.at(-1), tool, "ok");
		}

		// Platform never makes a default form, so its list starts empty.
		// Unstated actions (null) offer every action, as runTool reads them.
		const serves = (action: string): boolean =>
			hello.actions === null ||
			(hello.actions as readonly string[]).includes(action);
		const makesForm = hello.platform && serves("forms.create");
		if (makesForm) {
			const made = await run(rows, ctx, connection, "create_form", {
				name: stamp,
			});
			expectOutcome(rows.at(-1), "create_form", "ok");
			ids.form = stringField(made, (value) => value.id, "create_form");
		}
		// Every run on Platform leaves a form behind, so the one just made can be
		// past the first page: follow pages until it shows or there are no more.
		const listedIds: string[] = [];
		const cursors = new Set<string>();
		let cursor: string | undefined;
		do {
			const listed = await run(rows, ctx, connection, "list_forms", {
				limit: MAX_LIMIT,
				...(cursor === undefined ? {} : { cursor }),
			});
			expectOutcome(rows.at(-1), "list_forms", "ok");
			listedIds.push(...dataIds(listed, "list_forms"));
			cursor =
				makesForm && !listedIds.includes(ids.form)
					? nextCursor(listed, "list_forms")
					: undefined;
			if (cursor !== undefined && cursors.has(cursor)) {
				throw new Error("list_forms repeats a cursor");
			}
			if (cursor !== undefined) cursors.add(cursor);
		} while (cursor !== undefined);
		if (makesForm) {
			if (!listedIds.includes(ids.form)) {
				throw new Error("list_forms does not list the form create_form made");
			}
		} else {
			const first = listedIds[0];
			if (first === undefined) {
				throw new Error("no form and create_form not served");
			}
			ids.form = first;
		}
		await run(rows, ctx, connection, "get_form", { id: ids.form });
		expectOutcome(rows.at(-1), "get_form", "ok");
		let donorsListed = "";
		for (const tool of [
			"get_results",
			"list_donations",
			"list_donors",
		] as const) {
			const text = await run(rows, ctx, connection, tool, {});
			expectOutcome(rows.at(-1), tool, "ok");
			if (tool === "list_donors") donorsListed = text;
		}

		if (serves("donations.record")) {
			const recorded = await run(
				rows,
				ctx,
				connection,
				"record_donation",
				gift(stamp, day),
			);
			await run(rows, ctx, connection, "record_donation", gift(stamp, day));
			expectOutcome(rows.at(-2), "record_donation", "ok");
			expectOutcome(rows.at(-1), "record_donation", "replay");
			ids.donor = stringField(
				recorded,
				(value) => value.donor_id,
				"record_donation",
			);
		} else {
			// Platform does not record a gift: the call is refused, and get_donor
			// reads a donor the site already lists.
			await run(rows, ctx, connection, "record_donation", gift(stamp, day));
			expectOutcome(rows.at(-1), "record_donation", "unknown_action");
			ids.donor = dataIds(donorsListed, "list_donors")[0] ?? "";
		}

		if (ids.donor === "") {
			rows.push({ tool: "get_donor", outcome: "skipped", ms: 0, bytes: 0 });
		} else {
			await run(rows, ctx, connection, "get_donor", {
				id: ids.donor,
				limit: 5,
			});
			expectOutcome(rows.at(-1), "get_donor", "ok");
		}
		await run(rows, ctx, connection, "list_recurring_gifts", {});
		expectOutcome(rows.at(-1), "list_recurring_gifts", "ok");
		if (dropped) throw new Error("a minimum tool dropped the connection");

		for (const spec of rest) {
			if (makesForm && spec.tool === "create_form") continue;
			if (serves(spec.action)) {
				rows.push({ tool: spec.tool, outcome: "skipped", ms: 0, bytes: 0 });
				continue;
			}
			await run(
				rows,
				ctx,
				connection,
				spec.tool,
				otherArgs(spec.tool, ids, stamp, day),
			);
			expectOutcome(rows.at(-1), spec.tool, "unknown_action");
		}
		if (dropped) throw new Error("an unknown action dropped the connection");

		await client.disconnect(connection);
		await run(rows, ctx, connection, "list_campaigns", {});
		expectOutcome(rows.at(-1), "list_campaigns", "key_refused");
	} finally {
		await mkdir(dirname(opts.resultsPath), { recursive: true });
		const body = rows.map((row) => JSON.stringify(row)).join("\n");
		await writeFile(opts.resultsPath, body === "" ? "" : `${body}\n`);
	}
}

function gift(stamp: string, day: string): Record<string, unknown> {
	return {
		amount: { amount: "1.00", currency: "USD" },
		date: day,
		donor: { name: stamp },
		method: "cash",
		note: stamp,
	};
}

function minimumArgs(
	tool: string,
	ids: { campaign: string },
): Record<string, unknown> {
	if (tool === "get_campaign") return { id: ids.campaign };
	return {};
}

function otherArgs(
	tool: string,
	ids: { campaign: string; form: string },
	stamp: string,
	day: string,
): Record<string, unknown> {
	switch (tool) {
		case "update_campaign_blocks":
			return { id: ids.campaign, blocks: [] };
		case "update_campaign_content":
			return { id: ids.campaign, heading: stamp };
		case "update_campaign_settings":
			return { id: ids.campaign, end_date: day };
		case "publish_campaign":
			return { id: ids.campaign, gifts_go_to: null };
		case "end_campaign":
			return { id: ids.campaign };
		case "update_donation_page_blocks":
			return { blocks: [] };
		case "update_donation_page_content":
			return { heading: stamp };
		case "reset_donation_page":
			return { confirm: true };
		case "create_form":
			return { name: stamp };
		case "update_form":
			return { id: ids.form, name: stamp };
		case "create_photo_upload_link":
			return { target: { kind: "donation_page" } };
		default:
			return {};
	}
}

async function run(
	rows: LiveRow[],
	ctx: RunToolContext,
	connection: ToolConnection,
	tool: string,
	args: Record<string, unknown>,
): Promise<string> {
	const spec = specNamed(tool, connection.platform);
	const started = performance.now();
	const result = await runTool(spec, connection, args, ctx, DEFAULT_LOCALE);
	// the text answer; a success's summary line follows it
	const first = result.content[0];
	const text = first?.type === "text" ? first.text : "";
	rows.push({
		tool: spec.tool,
		outcome: outcomeOf(text, result.isError),
		ms: Math.round(performance.now() - started),
		bytes: Buffer.byteLength(text),
	});
	return text;
}

// The specs the connector serves this connection, as `servedSpecs` in src/mcp/index.ts does.
const specNamed = (tool: string, platform: boolean): ActionSpec => {
	const spec = actionsFor(platform).find((item) => item.tool === tool);
	if (!spec) throw new Error(`no tool ${tool}`);
	return spec;
};

function outcomeOf(
	text: string,
	isError: boolean | undefined,
): LiveRow["outcome"] {
	if (text.split("\n").includes(REPLAY)) return "replay";
	if (text.includes(UNKNOWN)) return "unknown_action";
	if (text.includes(REFUSED)) return "key_refused";
	if (isError === true) return "error";
	return "ok";
}

function expectOutcome(
	row: LiveRow | undefined,
	tool: string,
	outcome: LiveRow["outcome"],
): void {
	if (!row || row.tool !== tool || row.outcome !== outcome) {
		throw new Error(
			`${tool} returned ${row?.outcome ?? "nothing"}, expected ${outcome}`,
		);
	}
}

function lastJson(text: string, label: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		// The JSON is the last line, below the lead and any replay notice.
		parsed = JSON.parse(text.split("\n").at(-1) ?? "");
	} catch {
		throw new Error(`${label} was not json`);
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new Error(`${label} returned no id`);
	}
	return parsed as Record<string, unknown>;
}

/** The ids in a list answer's `data`, in the order the site sends them. */
function dataIds(text: string, label: string): string[] {
	const data = lastJson(text, label).data;
	if (!Array.isArray(data)) return [];
	return data.flatMap((form) => {
		const id = (form as { id?: unknown } | null)?.id;
		return typeof id === "string" && id !== "" ? [id] : [];
	});
}

function nextCursor(text: string, label: string): string | undefined {
	const cursor = lastJson(text, label).next_cursor;
	return typeof cursor === "string" && cursor !== "" ? cursor : undefined;
}

function stringField(
	text: string,
	read: (value: Record<string, unknown>) => unknown,
	label: string,
): string {
	const value = read(lastJson(text, label));
	if (typeof value !== "string" || value === "") {
		throw new Error(`${label} returned no id`);
	}
	return value;
}
