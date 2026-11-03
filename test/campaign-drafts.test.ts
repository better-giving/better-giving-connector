import { beforeEach, expect, test } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import {
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import {
	BASE,
	env,
	MCP_VERSIONS,
	mcpOpen,
	mcpRequest,
	rpc,
	warmUp,
} from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { countRows, freshDb } from "./support";

// Edits to a live Platform campaign, end to end: kept by the connector as a
// draft, shown beside the campaign, and sent when it is published again.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let bearer: string;
let rpcId = 0;

beforeEach(async () => {
	db = await freshDb();
	deployment = fakeDeployment({ name: "Hope Shelter", platform: true });
	const app = createApp({
		env,
		db,
		fetch: fakeNetwork(deployment),
		platformOrigin: deployment.origin,
	});
	call = async (req) => app.request(req);
	await warmUp(call);
	bearer = `Bearer ${(await connectFlow(call, deployment, BASE).connect()).access_token}`;
	return () => db.close();
});

type Result = {
	isError?: boolean;
	content: { text: string }[];
	structuredContent?: Record<string, unknown>;
};

const send = (method: string, params?: Record<string, unknown>) =>
	call(mcpRequest(MCP_VERSIONS[0], bearer, method, params, ++rpcId));

const tool = async (
	name: string,
	args: Record<string, unknown> = {},
): Promise<Result> =>
	(await rpc(await send("tools/call", { name, arguments: args }))).result;

type Campaign = {
	id: string;
	version: string;
	status: string;
	blocks: Record<string, unknown>[];
	settings: { goal: unknown; end_date: string | null };
};

const usd = (amount: string) => ({ amount, currency: "USD" });

const get = async (id: string) =>
	(await tool("get_campaign", { id })).structuredContent as Campaign & {
		pendingDraft?: Record<string, unknown>;
	};

/** A live campaign, its goal set before it went live. */
async function live(): Promise<Campaign> {
	const k = (await tool("create_campaign", { title: "Winter coats" }))
		.structuredContent as Campaign;
	await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("1000.00"),
	});
	await tool("publish_campaign", { id: k.id, gifts_go_to: null });
	deployment.calls.length = 0;
	return get(k.id);
}

const writes = () =>
	deployment.calls
		.filter((c) => c.method !== "GET")
		.map((c) => ({ method: c.method, path: c.path, body: c.body }));

const withStory = (k: Campaign, story: string) =>
	k.blocks.map((b) => (b.type === "story" ? { ...b, text: story } : b));

test("an edit to a live campaign's settings is kept as a draft and nothing is sent", async () => {
	const k = await live();

	const result = await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("5000.00"),
		expected_version: k.version,
	});

	expect(result.isError).toBeUndefined();
	expect(result.structuredContent).toEqual({
		saved: "draft",
		campaign_id: k.id,
		base_version: k.version,
	});
	expect(result.content[0]?.text).toMatch(/saved as a draft/);
	expect(writes()).toEqual([]);
	expect((await get(k.id)).settings.goal).toEqual(usd("1000.00"));
});

test("an edit to a live campaign's blocks is kept as a draft and nothing is sent", async () => {
	const k = await live();

	const result = await tool("update_campaign_blocks", {
		id: k.id,
		blocks: withStory(k, "Every coat counts."),
		expected_version: k.version,
	});

	expect(result.isError).toBeUndefined();
	expect(result.structuredContent).toEqual({
		saved: "draft",
		campaign_id: k.id,
		base_version: k.version,
	});
	expect(result.content.at(-1)?.text).toBe(
		"Saved as a draft: goes live when the campaign is published",
	);
	expect(writes()).toEqual([]);
	const read = await get(k.id);
	expect(read.blocks).toEqual(k.blocks);
	expect(read.pendingDraft).toMatchObject({
		page: withStory(k, "Every coat counts."),
		page_kind: "blocks",
		settings: null,
	});
});

test("an edit to a draft-status campaign goes straight through and keeps no draft", async () => {
	const k = (await tool("create_campaign", { title: "Spring gala" }))
		.structuredContent as Campaign;
	deployment.calls.length = 0;

	const settings = await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("2000.00"),
		expected_version: k.version,
	});
	const after = settings.structuredContent as Campaign;
	const blocks = await tool("update_campaign_blocks", {
		id: k.id,
		blocks: withStory(after, "A spring night."),
		expected_version: after.version,
	});

	expect(settings.structuredContent).toMatchObject({
		id: k.id,
		settings: { goal: usd("2000.00") },
	});
	expect(blocks.structuredContent).toMatchObject({ id: k.id });
	expect(writes().map((w) => [w.method, w.path])).toEqual([
		["PATCH", `/connector/v1/campaigns/${k.id}/settings`],
		["PATCH", `/connector/v1/campaigns/${k.id}/blocks`],
	]);
	const read = await get(k.id);
	expect(read.pendingDraft).toBeUndefined();
	expect(read.blocks).toContainEqual({
		type: "story",
		text: "A spring night.",
	});
	expect(await countRows(db, "campaign_draft")).toBe(0);
});

test("draft settings merge key by key, the later value winning", async () => {
	const k = await live();

	await tool("update_campaign_settings", { id: k.id, goal: usd("5000.00") });
	await tool("update_campaign_settings", { id: k.id, end_date: "2027-01-31" });
	await tool("update_campaign_settings", { id: k.id, goal: usd("6000.00") });

	expect((await get(k.id)).pendingDraft).toMatchObject({
		settings: { goal: usd("6000.00"), end_date: "2027-01-31" },
		base_version: k.version,
	});
	expect(writes()).toEqual([]);
});

test("a later blocks edit replaces the draft's page whole and keeps its settings", async () => {
	const k = await live();

	await tool("update_campaign_settings", { id: k.id, goal: usd("5000.00") });
	await tool("update_campaign_blocks", {
		id: k.id,
		blocks: withStory(k, "First story."),
	});
	await tool("update_campaign_blocks", {
		id: k.id,
		blocks: withStory(k, "Second story."),
	});

	expect((await get(k.id)).pendingDraft).toMatchObject({
		settings: { goal: usd("5000.00") },
		page: withStory(k, "Second story."),
		page_kind: "blocks",
		base_version: k.version,
	});
});

test("get_campaign shows the draft under pendingDraft, in the text's JSON and the structured result alike", async () => {
	const k = await live();
	await tool("update_campaign_settings", { id: k.id, goal: usd("5000.00") });

	const result = await tool("get_campaign", { id: k.id });

	const pending = {
		settings: { goal: usd("5000.00") },
		page: null,
		page_kind: null,
		base_version: k.version,
		updated_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
	};
	const lines = result.content[0]?.text.split("\n") ?? [];
	expect(lines.slice(0, 2)).toEqual([
		"From Hope Shelter's Better Giving site:",
		"This live campaign has draft edits donors don't see yet, under pendingDraft; publish_campaign sends them once the operator says yes.",
	]);
	expect(JSON.parse(lines.at(-1) ?? "")).toMatchObject({
		id: k.id,
		settings: { goal: usd("1000.00") },
		pendingDraft: pending,
	});
	expect(result.structuredContent).toMatchObject({
		id: k.id,
		settings: { goal: usd("1000.00") },
		pendingDraft: pending,
	});
	expect(result.content.at(-1)?.text).toMatch(/draft edits pending$/);
});

const PATCH = (id: string, part: "settings" | "blocks") => ({
	method: "PATCH",
	path: `/connector/v1/campaigns/${id}/${part}`,
});

test("publishing a live campaign sends its settings at the draft's base version, then its page at the version that write returned", async () => {
	const k = await live();
	await tool("update_campaign_settings", { id: k.id, goal: usd("5000.00") });
	await tool("update_campaign_blocks", {
		id: k.id,
		blocks: withStory(k, "Every coat counts."),
	});

	const result = await tool("publish_campaign", { id: k.id });

	expect(result.isError).toBeUndefined();
	const sent = writes();
	expect(sent).toMatchObject([PATCH(k.id, "settings"), PATCH(k.id, "blocks")]);
	expect(sent[0]?.body).toEqual({
		goal: usd("5000.00"),
		expected_version: k.version,
	});
	expect(sent[1]?.body).toMatchObject({
		expected_version: String(Number(k.version) + 1),
	});
	// the page carries the draft's goal, not the one it was read with
	expect(
		(sent[1]?.body as { blocks: unknown } | undefined)?.blocks,
	).toContainEqual({
		type: "goal-bar",
		goal: usd("5000.00"),
	});
	expect(deployment.calls.map((c) => c.path)).not.toContain(
		`/connector/v1/campaigns/${k.id}/publish`,
	);
	expect(result.structuredContent).toMatchObject({
		id: k.id,
		status: "published",
		draft: { applied: ["settings", "page"], pending: [] },
	});
	expect(result.content[0]?.text.split("\n")[0]).toBe(
		"Winter coats is live, and its draft settings and page edits are now live too: donors see them.",
	);
	const read = await get(k.id);
	expect(read.pendingDraft).toBeUndefined();
	expect(read.settings.goal).toEqual(usd("5000.00"));
	expect(read.blocks).toContainEqual({
		type: "story",
		text: "Every coat counts.",
	});
});

/** The site answers the first request matching `part`'s PATCH with a problem; later ones reach it. */
function refuseOnce(
	part: "settings" | "blocks",
	status: number,
	code: string,
	detail: string,
) {
	let refused = false;
	deployment.intercept((req) => {
		if (refused || req.method !== "PATCH") return undefined;
		if (!new URL(req.url).pathname.endsWith(`/${part}`)) return undefined;
		refused = true;
		return new Response(JSON.stringify({ title: code, status, detail, code }), {
			status,
			headers: { "content-type": "application/problem+json" },
		});
	});
}

/** A live campaign with a draft of its goal and its story. */
async function liveWithDraft(): Promise<Campaign> {
	const k = await live();
	await tool("update_campaign_settings", { id: k.id, goal: usd("5000.00") });
	await tool("update_campaign_blocks", {
		id: k.id,
		blocks: withStory(k, "Every coat counts."),
	});
	deployment.calls.length = 0;
	return k;
}

test("a draft the campaign moved past is kept whole, and the chat is told to read it again", async () => {
	const k = await liveWithDraft();
	const before = (await get(k.id)).pendingDraft;
	refuseOnce("settings", 409, "stale_read", "This campaign changed.");

	const result = await tool("publish_campaign", { id: k.id });

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toBe(
		"Nothing was published: this campaign changed on the site after its draft edits were started, and publishing them would overwrite that change. Read it with get_campaign, which shows the campaign as it is now and the draft under pendingDraft, and tell the operator what changed. To keep the draft, re-make its edit with the version get_campaign returns as expected_version, which moves the draft onto that version, then publish again; or drop it with discard_campaign_draft.",
	);
	expect(writes()).toMatchObject([PATCH(k.id, "settings")]);
	expect((await get(k.id)).pendingDraft).toEqual(before);
});

test("a page write that fails leaves the settings live and the page kept, on the version the settings write returned", async () => {
	const k = await liveWithDraft();
	refuseOnce("blocks", 422, "invalid", "The story is too long.");

	const result = await tool("publish_campaign", { id: k.id });

	expect(result.isError).toBeUndefined();
	expect(result.structuredContent).toMatchObject({
		draft: { applied: ["settings"], pending: ["page"] },
	});
	expect(result.content[0]?.text.split("\n")[0]).toBe(
		"Winter coats's draft settings edits are live now, but its page edits are still a draft: The story is too long. Read the campaign with get_campaign, fix the draft, and publish again, or drop it with discard_campaign_draft.",
	);
	const read = await get(k.id);
	expect(read.settings.goal).toEqual(usd("5000.00"));
	expect(read.pendingDraft).toMatchObject({
		settings: null,
		page: withStory(k, "Every coat counts."),
		page_kind: "blocks",
		base_version: read.version,
	});
	expect(read.version).toBe(String(Number(k.version) + 1));
});

test("the kept page goes live on the next publish, at the version it was kept on", async () => {
	const k = await liveWithDraft();
	refuseOnce("blocks", 422, "invalid", "The story is too long.");
	await tool("publish_campaign", { id: k.id });
	deployment.intercept(null);
	deployment.calls.length = 0;

	const result = await tool("publish_campaign", { id: k.id });

	expect(result.structuredContent).toMatchObject({
		draft: { applied: ["page"], pending: [] },
	});
	expect(writes()).toMatchObject([
		{
			...PATCH(k.id, "blocks"),
			body: { expected_version: String(Number(k.version) + 1) },
		},
	]);
	expect((await get(k.id)).pendingDraft).toBeUndefined();
});

test("publishing a live campaign with no draft sends nothing and never publishes it again", async () => {
	const k = await live();

	const result = await tool("publish_campaign", { id: k.id });

	expect(result.isError).toBeUndefined();
	expect(result.content[0]?.text.split("\n")[0]).toBe(
		"Winter coats is already live, with no draft edits pending, so nothing changed.",
	);
	expect(result.structuredContent).toMatchObject({
		id: k.id,
		draft: { applied: [], pending: [] },
	});
	expect(writes()).toEqual([]);
});

test("publishing a draft-status campaign publishes it as before", async () => {
	const k = (await tool("create_campaign", { title: "Spring gala" }))
		.structuredContent as Campaign;
	deployment.calls.length = 0;

	const result = await tool("publish_campaign", {
		id: k.id,
		gifts_go_to: null,
	});

	expect(writes()).toEqual([
		{
			method: "POST",
			path: `/connector/v1/campaigns/${k.id}/publish`,
			body: { gifts_go_to: null },
		},
	]);
	expect(result.structuredContent).toMatchObject({
		id: k.id,
		status: "published",
	});
	expect(result.structuredContent).not.toHaveProperty("draft");
});

test("an edit to a live campaign against a version it moved past is refused, and no draft is kept", async () => {
	const k = await live();

	const result = await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("5000.00"),
		expected_version: String(Number(k.version) - 1),
	});

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toMatch(/^Nothing was saved/);
	expect(await countRows(db, "campaign_draft")).toBe(0);
});

const revisionOf = async (id: string) =>
	(await get(id)).pendingDraft?.revision as number;

test("discard_campaign_draft drops the draft and sends nothing; a second discard finds none", async () => {
	const k = await liveWithDraft();
	const revision = await revisionOf(k.id);

	const first = await tool("discard_campaign_draft", { id: k.id, revision });
	const second = await tool("discard_campaign_draft", { id: k.id, revision });

	expect(first.isError).toBeUndefined();
	expect(first.structuredContent).toEqual({ discarded: true });
	expect(first.content[0]?.text.split("\n")[0]).toBe(
		"Dropped the draft edits of this campaign: they will never go live, and the live campaign is as it was.",
	);
	expect(second.structuredContent).toEqual({ discarded: false });
	expect(second.content[0]?.text.split("\n")[0]).toBe(
		"This campaign had no draft edits, so nothing was dropped.",
	);
	expect(writes()).toEqual([]);
	const read = await get(k.id);
	expect(read.pendingDraft).toBeUndefined();
	expect(read.settings.goal).toEqual(usd("1000.00"));
});

test("a discard of a draft saved since it was read is refused, and the newer draft stays", async () => {
	const k = await liveWithDraft();
	const seen = await revisionOf(k.id);
	await tool("update_campaign_settings", { id: k.id, goal: usd("7000.00") });

	const result = await tool("discard_campaign_draft", {
		id: k.id,
		revision: seen,
	});

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toBe(
		"Nothing was dropped: this campaign's draft changed since it was read. Read it again with get_campaign, tell the operator what it holds now, and discard it with the revision get_campaign returns only if they still want to.",
	);
	expect((await get(k.id)).pendingDraft).toMatchObject({
		settings: { goal: usd("7000.00") },
	});
});

const onSite = async (id: string, settings: Record<string, unknown>) =>
	deployment.handle(
		new Request(`${deployment.origin}/connector/v1/campaigns/${id}/settings`, {
			method: "PATCH",
			headers: {
				authorization: `Bearer ${deployment.issuedKeys.at(-1)}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(settings),
		}),
	);

test("a draft the site moved past goes live once its edit is re-made against the campaign as it is now", async () => {
	const k = await liveWithDraft();
	await onSite(k.id, { end_date: "2031-01-31" });
	const refused = await tool("publish_campaign", { id: k.id });
	const now = await get(k.id);

	const resaved = await tool("update_campaign_settings", {
		id: k.id,
		goal: usd("5000.00"),
		expected_version: now.version,
	});
	const published = await tool("publish_campaign", { id: k.id });

	expect(refused.isError).toBe(true);
	expect(resaved.structuredContent).toMatchObject({
		base_version: now.version,
	});
	expect(published.isError).toBeUndefined();
	expect(published.structuredContent).toMatchObject({
		draft: { applied: ["settings", "page"], pending: [] },
	});
	const after = await get(k.id);
	expect(after.settings).toMatchObject({
		goal: usd("5000.00"),
		end_date: "2031-01-31",
	});
	expect(after.pendingDraft).toBeUndefined();
});

test("the card's Publish on a draft the site moved past says what to do in the card, not in the chat", async () => {
	const k = await liveWithDraft();
	await onSite(k.id, { end_date: "2031-01-31" });

	const result = await tool("app_publish_campaign", {
		id: k.id,
		giftsGoTo: null,
	});

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toBe(
		"Nothing was published: this campaign was changed on the site after these draft edits were saved, and publishing them would overwrite that change. Discard the draft edits, then make them again on the campaign as it is now.",
	);
});

test("a read-only token can't discard a draft, and the draft stays", async () => {
	const k = await liveWithDraft();
	const readOnly = `Bearer ${(await connectFlow(call, deployment, BASE, { scope: "offline_access read_only" }).connect()).access_token}`;

	const { result } = await rpc(
		await call(
			mcpRequest(
				MCP_VERSIONS[0],
				readOnly,
				"tools/call",
				{ name: "discard_campaign_draft", arguments: { id: k.id } },
				++rpcId,
			),
		),
	);

	expect(result.isError).toBe(true);
	expect(result.content[0].text).toMatch(
		/^This connection to Better Giving is read-only, so discard_campaign_draft can't be used\./,
	);
	expect((await get(k.id)).pendingDraft).toBeDefined();
});

/** A Standalone deployment and its MCP session, beside the Platform one. */
async function standaloneSession() {
	const standalone = fakeDeployment({ name: "Hope Shelter" });
	const app = createApp({
		env,
		db,
		fetch: fakeNetwork(standalone),
		platformOrigin: deployment.origin,
	});
	const standaloneCall: Call = async (req) => app.request(req);
	await warmUp(standaloneCall);
	const token = (await connectFlow(standaloneCall, standalone, BASE).connect())
		.access_token;
	const send = async (method: string, params?: Record<string, unknown>) =>
		(
			await rpc(
				await standaloneCall(
					mcpRequest(
						MCP_VERSIONS[0],
						`Bearer ${token}`,
						method,
						params,
						++rpcId,
					),
				),
			)
		).result;
	const tool = async (
		name: string,
		args: Record<string, unknown> = {},
	): Promise<Result> => send("tools/call", { name, arguments: args });
	/** A published Standalone campaign as its editor card shows it, the calls so far forgotten. */
	const live = async (): Promise<{ id: string; version: string }> => {
		const k = (await tool("create_campaign", { title: "Winter coats" }))
			.structuredContent as Campaign;
		await tool("publish_campaign", { id: k.id, gifts_go_to: null });
		const editor = await tool("app_get_campaign_editor", { id: k.id });
		standalone.calls.length = 0;
		return (editor.structuredContent as { campaign: Campaign }).campaign;
	};
	return { deployment: standalone, send, tool, live };
}

test("a Standalone connection is not offered discard_campaign_draft", async () => {
	const { send } = await standaloneSession();

	const result = await send("tools/list", {});

	const names = result.tools.map((t: { name: string }) => t.name);
	expect(names).toContain("get_profile");
	expect(names).not.toContain("discard_campaign_draft");
});

test("on Standalone, the editor's save to a live campaign is written through and keeps no draft", async () => {
	const standalone = await standaloneSession();
	const k = await standalone.live();

	const result = await standalone.tool("app_save_campaign_edit", {
		id: k.id,
		expectedVersion: k.version,
		page: { pageKind: "content", content: { heading: "Every coat counts" } },
	});

	expect(result.isError).toBeUndefined();
	expect(
		standalone.deployment.calls
			.filter((c) => c.method !== "GET")
			.map((c) => [c.method, c.path]),
	).toEqual([["PATCH", `/connector/v1/campaigns/${k.id}/content`]]);
	expect(result.structuredContent).toMatchObject({ pendingDraft: false });
	expect(await countRows(db, "campaign_draft")).toBe(0);
});

test("the instructions say a live campaign's edits wait as a draft, and publishing still waits for a yes", async () => {
	const opened = await rpc(await call(mcpOpen(MCP_VERSIONS[0], bearer)));

	const { instructions } = opened.result;
	expect(instructions).toContain(
		"An edit to a live campaign is saved as a draft donors don't see until publish_campaign sends it; get_campaign shows it under pendingDraft.",
	);
	expect(instructions).toMatch(
		/Before publish_campaign or end_campaign, say what will change and wait for the operator's explicit yes in this chat\.$/,
	);
});

const widgetSave = (
	id: string,
	expectedVersion: string | null,
	blocks: Record<string, unknown>[],
) =>
	tool("app_save_campaign_edit", {
		id,
		expectedVersion,
		page: { pageKind: "blocks", blocks },
	});

test("the editor card's save of a live campaign against a version it moved past is refused, and no draft is kept", async () => {
	const k = await live();

	const result = await widgetSave(
		k.id,
		String(Number(k.version) - 1),
		withStory(k, "Stale."),
	);

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toMatch(/^Nothing was saved/);
	expect(await countRows(db, "campaign_draft")).toBe(0);
	expect(writes()).toEqual([]);
});

test("the editor card's save of a live campaign at its current version is kept as a draft on that version, sending nothing", async () => {
	const k = await live();

	const result = await widgetSave(k.id, k.version, withStory(k, "Fresh."));

	expect(result.isError).toBeUndefined();
	expect(result.structuredContent).toMatchObject({ pendingDraft: true });
	expect(writes()).toEqual([]);
	expect((await get(k.id)).pendingDraft).toMatchObject({
		base_version: k.version,
		page_kind: "blocks",
	});
});

test("the editor card's save of a draft campaign sends its version to the site as expected_version, and none when it has none", async () => {
	const k = (await tool("create_campaign", { title: "Spring gala" }))
		.structuredContent as Campaign;
	deployment.calls.length = 0;

	await widgetSave(k.id, k.version, withStory(k, "Versioned."));
	await widgetSave(k.id, null, withStory(k, "Unversioned."));

	expect(writes().map((w) => w.path)).toEqual([
		`/connector/v1/campaigns/${k.id}/blocks`,
		`/connector/v1/campaigns/${k.id}/blocks`,
	]);
	expect(writes()[0]?.body).toMatchObject({ expected_version: k.version });
	expect(writes()[1]?.body).not.toHaveProperty("expected_version");
});

test("the card's Publish that sends only part of a draft says which part is still a draft, and why", async () => {
	const k = await liveWithDraft();
	refuseOnce("blocks", 422, "invalid", "The story is too long.");

	const result = await tool("app_publish_campaign", {
		id: k.id,
		giftsGoTo: null,
	});

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toBe(
		"The settings edits are live now, but the page edits are still a draft: The story is too long. Fix them in the editor and publish again, or discard the draft edits.",
	);
	expect((await get(k.id)).pendingDraft).toMatchObject({ page_kind: "blocks" });
});

test("the editor card's save onto a draft the site has moved past is refused, so the site's change isn't overwritten at publish", async () => {
	const k = await liveWithDraft();
	await onSite(k.id, { end_date: "2031-01-31" });
	const opened = (await tool("app_get_campaign_editor", { id: k.id }))
		.structuredContent as { campaign: { version: string } };
	const before = (await get(k.id)).pendingDraft;
	deployment.calls.length = 0;

	const result = await widgetSave(
		k.id,
		opened.campaign.version,
		withStory(k, "One word changed."),
	);

	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toBe(
		"Nothing was saved: this campaign was changed on the site after its draft edits were started, and saving onto them would overwrite that change when they're published. Discard the draft edits to start again from the campaign as it is now.",
	);
	expect((await get(k.id)).pendingDraft).toEqual(before);
	expect(writes()).toEqual([]);
});

test("the editor shows the campaign's page, not a leftover draft, once the campaign has ended", async () => {
	const k = await liveWithDraft();
	await tool("end_campaign", { id: k.id });

	const opened = (await tool("app_get_campaign_editor", { id: k.id }))
		.structuredContent as { page: { blocks: unknown }; pendingDraft: boolean };

	expect(opened.pendingDraft).toBe(false);
	expect(opened.page.blocks).toEqual(k.blocks);
});

test("the editor says a Platform campaign's live edits wait as a draft, and a Standalone one's don't", async () => {
	const k = await live();
	const standalone = await standaloneSession();
	const s = await standalone.live();

	const platform = await tool("open_campaign_editor", { id: k.id });
	const direct = await standalone.tool("open_campaign_editor", { id: s.id });

	expect(platform.structuredContent).toMatchObject({ draftsLiveEdits: true });
	expect(direct.structuredContent).toMatchObject({ draftsLiveEdits: false });
	const description = async (
		list: () => Promise<{ tools: { name: string; description: string }[] }>,
	) =>
		(await list()).tools.find((t) => t.name === "open_campaign_editor")
			?.description;
	expect(
		await description(
			async () => (await rpc(await send("tools/list", {}))).result,
		),
	).toMatch(/saved as a draft until it is published again/);
	expect(await description(() => standalone.send("tools/list", {}))).toMatch(
		/donors see a live campaign's edits as soon as they're saved/,
	);
});
