import { afterEach, expect, test, vi } from "vitest";
import { memoryDrafts } from "../../test/memory-drafts";
import { type CallAnswer, DeploymentRejected } from "../deployment";
import { parseOrigin } from "../deployment/origin";
import { logoRoutes } from "../logo";
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
	logoSecret: "test-logo-secret",
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
			logoSecret: "test-logo-secret",
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

const cardRefusal = async (
	tool: string,
	refusal: DeploymentRejected,
	input: Record<string, unknown> = { id: "cmp_1" },
) =>
	(
		await runTool(
			specOf(tool),
			{ ...connection(), platform: true },
			input,
			answering(refusal),
			"en-US",
		)
	).content;

test("a card button's refusal is a sentence for the operator, never the site's problem JSON", async () => {
	const ended = await cardRefusal(
		"app_end_campaign",
		new DeploymentRejected(409, {
			code: "campaign_ended",
			title: "Campaign ended",
		}),
	);
	const stale = await cardRefusal(
		"app_save_campaign_edit",
		new DeploymentRejected(409, { code: "stale_read", title: "Stale read" }),
		{
			id: "cmp_1",
			expectedVersion: "3",
			page: { pageKind: "blocks", blocks: [] },
		},
	);
	const invalid = await cardRefusal(
		"app_publish_campaign",
		new DeploymentRejected(422, {
			code: "invalid",
			errors: [
				{ path: "settings.goal", message: "A goal is required." },
				{ path: "settings.end_date", message: "An end date is required." },
			],
		}),
		{ id: "cmp_1", giftsGoTo: null },
	);

	expect(ended).toEqual([
		{
			type: "text",
			text: "Nothing changed: this campaign has ended, and an ended campaign stays ended.",
		},
	]);
	expect(stale).toEqual([
		{
			type: "text",
			text: "Nothing was saved: this campaign changed on the site after the card read it. Open the campaign again to see it as it is now, then make the change again.",
		},
	]);
	expect(invalid).toEqual([
		{
			type: "text",
			text: "Give's Better Giving didn't accept this: A goal is required. An end date is required.",
		},
	]);
});

test("a refusal with nothing to word says the site refused, and a model tool still gets the problem itself", async () => {
	const bare = await cardRefusal(
		"app_end_campaign",
		new DeploymentRejected(403, { code: "forbidden" }),
	);
	const forModel = await cardRefusal(
		"show_campaign_results",
		new DeploymentRejected(403, { code: "forbidden" }),
	);

	expect(bare).toEqual([
		{ type: "text", text: "Give's Better Giving refused this request." },
	]);
	expect(forModel).toEqual([{ type: "text", text: '{"code":"forbidden"}' }]);
});

test("list_nonprofits draws a logo on a logo host from this service's /logo route, and leaves every other logo as it came", async () => {
	const row = (id: string, logo_url?: string | null) => ({
		id,
		name: `Nonprofit ${id}`,
		current: id === "1",
		...(logo_url === undefined ? {} : { logo_url }),
	});
	const rows = [
		row("1", "https://endow-profiles.s3.amazonaws.com/a.png"),
		row("2", "https://res.cloudinary.com/everydotorg/image/upload/b.jpg"),
		row("3", "https://x1.public.blob.vercel-storage.com/c.png"),
		row("4", "https://endow-profiles.s3.amazonaws.com.evil.io/d.png"),
		row("5", "http://res.cloudinary.com/e.png"),
		row("6", "res.cloudinary.com/f.png"),
		row("7", null),
		row("8"),
		row("9", "https://res.cloudinary.com/other/g.png"),
		row("10", "https://res.cloudinary.com/everydotorg/image/fetch/h.png"),
	];

	const result = await runTool(
		specOf("list_nonprofits"),
		connection(),
		{},
		answering({ status: 200, body: { data: rows, next_cursor: null } }),
		"en-US",
	);

	const data = (
		result.structuredContent as { data: { logo_url?: string | null }[] }
	).data;
	const own = "https://app.connect.better.giving/logo/";
	expect(data[0]?.logo_url?.startsWith(own)).toBe(true);
	expect(data[1]?.logo_url?.startsWith(own)).toBe(true);
	expect(data.slice(2)).toEqual(rows.slice(2));
});

test("each row's rewritten logo leads back to that row's own logo URL", async () => {
	const s3 = "https://endow-profiles.s3.amazonaws.com/logos/harbor.png";
	const cloudinary =
		"https://res.cloudinary.com/everydotorg/image/upload/bayanihan.jpg";
	const rows = [
		{ id: "1", name: "Harbor", current: true, logo_url: s3 },
		{ id: "2", name: "Bayanihan", current: false, logo_url: cloudinary },
	];

	const result = await runTool(
		specOf("list_nonprofits"),
		connection(),
		{},
		answering({ status: 200, body: { data: rows, next_cursor: null } }),
		"en-US",
	);

	const drawn = (result.structuredContent as { data: { logo_url: string }[] })
		.data;
	const fetcher = vi.fn(
		async (_url: unknown) =>
			new Response(new Uint8Array([137, 80, 78, 71]), {
				headers: { "content-type": "image/png" },
			}),
	);
	const logos = logoRoutes({
		secret: "test-logo-secret",
		fetch: fetcher as typeof fetch,
	});
	for (const row of drawn) {
		const served = await logos.request(new URL(row.logo_url).pathname);
		expect(served.status).toBe(200);
	}
	// one fetch per row, in row order: each ref named its own row's URL
	expect(fetcher.mock.calls.map(([url]) => url)).toEqual([s3, cloudinary]);
});

const donors = (n: number) => ({
	data: Array.from({ length: n }, (_, i) => ({
		id: `don_${i}`,
		name: `Donor ${i} ${"x".repeat(900)}`,
		email: `d${i}@example.org`,
		total: { amount: "10.00", currency: "USD" },
		gift_count: 1,
	})),
	next_cursor: "page_2",
});

test("a donor list too big for the chat is cut to fit, with the note saying how many rows were left out", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	const body = donors(100);

	const result = await runTool(
		specOf("list_donors"),
		connection(),
		{ limit: 100 },
		answering({ status: 200, body }),
		"en-US",
	);

	const kept = (result.structuredContent as typeof body).data;
	const sent = result.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("");
	expect(kept.length).toBeGreaterThan(0);
	expect(kept.length).toBeLessThan(100);
	expect(kept).toEqual(body.data.slice(0, kept.length));
	expect(
		sent.length + JSON.stringify(result.structuredContent).length,
	).toBeLessThanOrEqual(120_000 + 1_000);
	const note = result.content[1];
	expect(note).toEqual({
		type: "text",
		text: `This result was too big to show whole: ${kept.length} of 100 donors are shown and ${100 - kept.length} were left out. Call it again with q to match a name or email, or with a smaller limit and the same cursor.`,
	});
	expect((result.structuredContent as typeof body).next_cursor).toBeNull();
});

test("a donor list that fits is answered whole", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	const body = donors(20);

	const result = await runTool(
		specOf("list_donors"),
		connection(),
		{},
		answering({ status: 200, body }),
		"en-US",
	);

	expect(result.structuredContent).toEqual(body);
	expect(result.content).toHaveLength(2);
});

test("results too big keep their totals exact and cut only the campaign rows", async () => {
	vi.spyOn(console, "log").mockImplementation(() => {});
	const body = {
		...RESULTS,
		campaigns: Array.from({ length: 800 }, (_, i) => ({
			id: `cmp_${i}`,
			title: `Campaign ${i} ${"y".repeat(100)}`,
			total: { amount: "1.00", currency: "USD" },
		})),
	};

	const result = await runTool(
		specOf("get_results"),
		connection(),
		{},
		answering({ status: 200, body }),
		"en-US",
	);

	const shown = result.structuredContent as typeof body;
	expect(shown.total).toEqual(RESULTS.total);
	expect(shown.gift_count).toBe(31);
	expect(shown.donor_count).toBe(20);
	expect(shown.campaigns.length).toBeLessThan(800);
	expect(result.content[1]).toMatchObject({
		text: expect.stringContaining(
			`${shown.campaigns.length} of 800 campaign totals are shown`,
		),
	});
});
