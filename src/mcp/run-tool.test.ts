import { afterEach, expect, test, vi } from "vitest";
import { memoryDrafts } from "../../test/memory-drafts";
import type { CallAnswer } from "../deployment";
import { parseOrigin } from "../deployment/origin";
import { Secret } from "../secret";
import { ACTIONS } from "./actions";
import { LOCAL_TOOLS } from "./local";
import { runTool, type ToolConnection } from "./run-tool";
import type { ToolSpec } from "./spec";

const origin = parseOrigin("https://give.example.org");
const KEY = "bgk_secret_key";

const specOf = (tool: string): ToolSpec => {
	const spec = [...ACTIONS, ...LOCAL_TOOLS].find((s) => s.tool === tool);
	if (!spec) throw new Error(`no ${tool} spec`);
	return spec;
};

const connection = (key = KEY): ToolConnection => {
	if (!origin) throw new Error("bad origin");
	return {
		userId: "user_1",
		origin,
		orgName: "Give",
		actions: null,
		platform: false,
		key: new Secret(key),
		createdAt: new Date(),
	};
};

const answering = (answer: CallAnswer | Error) => ({
	client: {
		call: async () => {
			if (answer instanceof Error) throw answer;
			return answer;
		},
	},
	drafts: memoryDrafts(),
	publicOrigin: "https://app.connect.better.giving",
	fetch,
	dropConnection: async () => {},
});

const RESULTS = {
	total: { amount: "12480.00", currency: "USD" },
	gift_count: 31,
	donor_count: 20,
	campaigns: [],
};

afterEach(() => {
	vi.restoreAllMocks();
});

test("an empty connection key is not used as a redaction pattern", async () => {
	const answer = { note: "keep every character" };

	const result = await runTool(
		specOf("get_campaign"),
		connection(""),
		{ id: "cmp_1" },
		answering({ status: 200, body: answer }),
		"en-US",
	);

	expect(result.content[0]).toEqual({
		type: "text",
		text: `From Give's Better Giving site:\n${JSON.stringify(answer)}`,
	});
});

test("a body its output schema accepts is the structured result, with the text answer first and a summary line after it", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});

	const result = await runTool(
		specOf("get_results"),
		connection(),
		{},
		answering({ status: 200, body: RESULTS }),
		"en-US",
	);

	expect(result).toEqual({
		content: [
			{
				type: "text",
				text: `Give raised $12,480.00 from 31 gifts.\n${JSON.stringify(RESULTS)}`,
			},
			{
				type: "text",
				text: "$12,480.00 raised from 31 gifts by 20 donors",
			},
		],
		structuredContent: RESULTS,
	});
});

test("the request's locale formats the money in the text answer and the summary, in the campaign's currency", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});

	const result = await runTool(
		specOf("get_results"),
		connection(),
		{},
		answering({ status: 200, body: RESULTS }),
		"de-DE",
	);

	expect(result.content.map((c) => (c.type === "text" ? c.text : ""))).toEqual([
		`Give raised 12.480,00 $ from 31 gifts.\n${JSON.stringify(RESULTS)}`,
		"12.480,00 $ raised from 31 gifts by 20 donors",
	]);
});

test("a body its output schema refuses is answered as text alone, and logged by tool name only", async () => {
	const out = vi.spyOn(console, "log").mockImplementation(() => {});
	const odd = { total: "lots", gift_count: 3, secret: "SENTINEL" };

	const result = await runTool(
		specOf("get_results"),
		connection(),
		{},
		answering({ status: 200, body: odd }),
		"en-US",
	);

	expect(result).toEqual({
		content: [
			{
				type: "text",
				text: `From Give's Better Giving site:\n${JSON.stringify(odd)}`,
			},
		],
	});
	expect(out.mock.calls.map(([line]) => line)).toEqual([
		'{"kind":"output_invalid","tool":"results.summary"}',
		expect.stringMatching(
			/^\{"kind":"tool","tool":"results.summary","outcome":"ok","ms":\d+\}$/,
		),
	]);
});

test("a body that isn't an object is answered as text alone", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});

	const result = await runTool(
		specOf("create_form"),
		connection(),
		{ name: "Gala" },
		answering({ status: 202, body: null }),
		"en-US",
	);

	expect(result.structuredContent).toBeUndefined();
	expect(result.content).toHaveLength(1);
});

test("an error carries no structured result", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});

	const result = await runTool(
		specOf("get_results"),
		connection(),
		{},
		answering(new TypeError("boom")),
		"en-US",
	);

	expect(result.isError).toBe(true);
	expect(result.structuredContent).toBeUndefined();
	expect(result.content).toHaveLength(1);
});

test("a key the deployment echoes is redacted from the structured result too", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	const echoed = {
		id: "frm_1",
		name: `Form ${KEY}`,
		nested: [{ [KEY]: KEY }],
	};

	const result = await runTool(
		specOf("get_form"),
		connection(),
		{ id: "frm_1" },
		answering({ status: 200, body: echoed }),
		"en-US",
	);

	expect(JSON.stringify(result)).not.toContain(KEY);
	expect(result.structuredContent).toEqual({
		id: "frm_1",
		name: "Form [redacted]",
		nested: [{ "[redacted]": "[redacted]" }],
	});
});

test("get_profile answers with the connection's user id and org name, as structured content and as the same JSON in its one text item", async () => {
	const out = vi.spyOn(console, "log").mockImplementation(() => {});
	const call = vi.fn();

	const result = await runTool(
		specOf("get_profile"),
		connection(),
		{},
		{
			client: { call },
			drafts: memoryDrafts(),
			publicOrigin: "https://app.connect.better.giving",
			fetch,
			dropConnection: async () => {},
		},
		"en-US",
	);

	expect(result).toEqual({
		content: [{ type: "text", text: '{"id":"user_1","name":"Give"}' }],
		structuredContent: { id: "user_1", name: "Give" },
	});
	expect(call).not.toHaveBeenCalled();
	expect(out.mock.calls.map(([line]) => line)).toEqual([
		expect.stringMatching(
			/^\{"kind":"tool","tool":"get_profile","outcome":"ok","ms":\d+\}$/,
		),
	]);
});
