import { beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app";
import type { Db } from "../src/db";
import { TITLE_MAX } from "../src/mcp/actions";
import {
	type FakeDeployment,
	fakeDeployment,
	fakeNetwork,
} from "./fake-deployment";
import { BASE, env, MCP_VERSIONS, mcpRequest, rpc, warmUp } from "./harness";
import type { Call } from "./oauth";
import { connectFlow } from "./operator";
import { PLATFORM_TOOLS } from "./platform-hello";
import { freshDb } from "./support";

// The Platform writes through the connector, end to end: a chat app's tool
// call, the connector, and a fake deployment keeping Platform's rules.

let db: Db;
let deployment: FakeDeployment;
let call: Call;
let bearer: string;
let rpcId = 0;

async function serve(opts: { nonprofitSlug?: boolean } = {}) {
	db = await freshDb();
	deployment = fakeDeployment({
		name: "Hope Shelter",
		platform: true,
		...opts,
	});
	const app = createApp({
		env,
		db,
		fetch: fakeNetwork(deployment),
		platformOrigin: deployment.origin,
	});
	call = async (req) => app.request(req);
	await warmUp(call);
	bearer = `Bearer ${(await connectFlow(call, deployment, BASE).connect()).access_token}`;
}

beforeEach(async () => {
	await serve();
	return () => db.close();
});

type Result = { isError?: boolean; content: { text: string }[] };

const send = (method: string, params?: Record<string, unknown>) =>
	call(mcpRequest(MCP_VERSIONS[0], bearer, method, params, ++rpcId));

const tool = async (
	name: string,
	args: Record<string, unknown> = {},
): Promise<Result> =>
	(await rpc(await send("tools/call", { name, arguments: args }))).result;

const textOf = (result: Result) => result.content.map((c) => c.text).join("\n");
/** The lead line naming the org, above the JSON. */
const leadOf = (result: Result) => textOf(result).split("\n")[0];
/** The deployment's JSON: the last line, below the lead. */
const json = (result: Result) =>
	JSON.parse(textOf(result).split("\n").at(-1) ?? "");

/** The guidance line, and the deployment's problem below it. */
const refusal = (result: Result) => {
	const [next, problem] = textOf(result).split("\n\n");
	return { next, problem: JSON.parse(problem ?? "null") };
};

async function draft(title = "Winter coats") {
	return json(await tool("create_campaign", { title }));
}

type Campaign = { id: string; version: string; blocks: unknown[] };

const blocksOf = (
	k: Campaign,
	change: { title?: string; story?: string; hero?: string | null } = {},
) =>
	k.blocks.map((b) => {
		const block = b as Record<string, unknown>;
		if (block.type === "title" && change.title !== undefined)
			return { ...block, text: change.title };
		if (block.type === "story" && change.story !== undefined)
			return { ...block, text: change.story };
		if (block.type === "hero" && change.hero !== undefined)
			return { ...block, image_url: change.hero };
		return block;
	});

test("a Platform connection offers its writes and none it doesn't serve", async () => {
	const tools: { name: string }[] = (await rpc(await send("tools/list"))).result
		.tools;
	const names = tools.map((t) => t.name);

	expect(names.sort()).toEqual([...PLATFORM_TOOLS].sort());
	for (const absent of [
		"update_donation_page_blocks",
		"update_donation_page_content",
		"update_campaign_content",
		"reset_donation_page",
		"record_donation",
		"get_content_catalog",
		"unpublish_campaign",
	]) {
		expect(names).not.toContain(absent);
	}
});

test("update_campaign_settings offers a goal and end date, and no time zone or share message", async () => {
	const tools: { name: string; inputSchema: { properties: object } }[] = (
		await rpc(await send("tools/list"))
	).result.tools;
	const settings = tools.find((t) => t.name === "update_campaign_settings");

	expect(Object.keys(settings?.inputSchema.properties ?? {}).sort()).toEqual([
		"end_date",
		"expected_version",
		"goal",
		"id",
	]);
});

test("a campaign changed since it was read, on a tool with no expected_version, is not told to send one", async () => {
	const k = await draft();
	deployment.intercept((req) =>
		req.method === "POST"
			? Response.json(
					{ code: "stale_read" },
					{
						status: 409,
						headers: { "content-type": "application/problem+json" },
					},
				)
			: undefined,
	);

	const { next } = refusal(await tool("publish_campaign", { id: k.id }));

	expect(next).toBe(
		"Nothing was saved: this campaign changed after it was read. Read it again with get_campaign, and make the change against what it shows now.",
	);
});

test("create_campaign answered in progress or conflict is the problem alone, not create_form's advice", async () => {
	for (const code of ["idempotency_in_progress", "idempotency_conflict"]) {
		deployment.intercept((req) =>
			req.method === "POST"
				? Response.json(
						{ code },
						{
							status: 409,
							headers: { "content-type": "application/problem+json" },
						},
					)
				: undefined,
		);

		const result = await tool("create_campaign", { title: "Winter coats" });

		expect(textOf(result)).toBe(JSON.stringify({ code }));
	}
});

describe("expected_version", () => {
	test("a change sent against the campaign's current version is saved", async () => {
		const k = await draft();

		const result = await tool("update_campaign_settings", {
			id: k.id,
			expected_version: k.version,
			goal: { amount: "5000.00", currency: "USD" },
		});

		expect(result.isError).toBeUndefined();
		expect(deployment.calls.at(-1)?.body).toEqual({
			expected_version: k.version,
			goal: { amount: "5000.00", currency: "USD" },
		});
		expect(json(result).version).not.toBe(k.version);
	});

	test("is left out of the request when the caller leaves it out", async () => {
		const k = await draft();

		await tool("update_campaign_settings", { id: k.id, end_date: null });

		expect(deployment.calls.at(-1)?.body).toEqual({ end_date: null });
	});

	test("a version that isn't one get_campaign returns is refused before any request", async () => {
		const k = await draft();
		const before = deployment.calls.length;

		const result = await tool("update_campaign_blocks", {
			id: k.id,
			blocks: blocksOf(k),
			expected_version: "v7",
		});

		expect(result.isError).toBe(true);
		expect(deployment.calls).toHaveLength(before);
	});

	test.each([
		[
			"update_campaign_settings",
			(k: Campaign) => ({ end_date: null, id: k.id }),
		],
		[
			"update_campaign_blocks",
			(k: Campaign) => ({ id: k.id, blocks: blocksOf(k, { story: "Coats." }) }),
		],
	])(
		"%s against an older version saves nothing and says to read the campaign again",
		async (name, args) => {
			const k = await draft();
			await tool("update_campaign_settings", {
				id: k.id,
				goal: { amount: "100.00", currency: "USD" },
			});

			const result = await tool(name, {
				...args(k),
				expected_version: k.version,
			});

			expect(result.isError).toBe(true);
			const { next, problem } = refusal(result);
			expect(next).toBe(
				"Nothing was saved: this campaign changed after it was read. Read it again with get_campaign, make the change against what it shows now, and send the version it returns as expected_version.",
			);
			expect(problem).toMatchObject({ code: "stale_read" });
		},
	);
});

describe("campaign writes", () => {
	const ENDED =
		"Nothing was saved: this campaign has ended, and an ended campaign stays ended. It can't be edited, published, or given a new photo. Tell the operator; a new appeal needs a new campaign.";

	test("update_campaign_blocks edits the title and story", async () => {
		const k = await draft();

		const result = await tool("update_campaign_blocks", {
			id: k.id,
			blocks: blocksOf(k, { title: "Warm coats", story: "Every coat." }),
			expected_version: k.version,
		});

		expect(json(result).blocks).toEqual([
			{ type: "title", text: "Warm coats" },
			{ type: "story", text: "Every coat." },
			{ type: "hero", image_url: null },
			{ type: "goal-bar", goal: null },
		]);
	});

	test("publish_campaign puts a draft live, and moving its gifts afterwards points at the dashboard", async () => {
		const k = await draft();

		const published = await tool("publish_campaign", {
			id: k.id,
			gifts_go_to: null,
		});
		const moved = await tool("publish_campaign", {
			id: k.id,
			gifts_go_to: "prog_1",
		});

		expect(json(published)).toMatchObject({ status: "published" });
		const { next, problem } = refusal(moved);
		expect(next).toBe(
			"This campaign is already live, so where its gifts go can't be changed here. The operator changes it in the Better Giving dashboard.",
		);
		expect(problem).toMatchObject({ code: "already_published" });
	});

	test("end_campaign ends it, and every later write says an ended campaign stays ended", async () => {
		const k = await draft();

		const ended = await tool("end_campaign", { id: k.id });
		const after = await get(k.id);
		const writes = [
			await tool("update_campaign_settings", { id: k.id, end_date: null }),
			await tool("update_campaign_blocks", {
				id: k.id,
				blocks: blocksOf(after, { story: "More." }),
			}),
			await tool("publish_campaign", { id: k.id, gifts_go_to: null }),
			await tool("create_photo_upload_link", {
				target: { kind: "campaign", id: k.id },
			}),
		];

		expect(json(ended)).toMatchObject({ status: "ended" });
		for (const write of writes) {
			expect(write.isError).toBe(true);
			const { next, problem } = refusal(write);
			expect(next).toBe(ENDED);
			expect(problem).toMatchObject({ code: "campaign_ended" });
		}
	});
});

const get = async (id: string): Promise<Campaign> =>
	json(await tool("get_campaign", { id }));

describe("photos", () => {
	test("an upload link lasts 15 minutes, works once, and its photo becomes the hero", async () => {
		const k = await draft();
		const started = Date.now();

		const result = await tool("create_photo_upload_link", {
			target: { kind: "campaign", id: k.id },
			slot: "hero",
		});
		const { url, expires_at } = json(result);
		const stored = deployment.uploadPhoto(url);
		const again = deployment.uploadPhoto(url);
		const after = await get(k.id);

		const lasts = Date.parse(expires_at) - started;
		expect(lasts).toBeGreaterThan(14 * 60_000);
		expect(lasts).toBeLessThanOrEqual(15 * 60_000 + 1_000);
		expect(stored).not.toBeNull();
		expect(again).toBeNull();
		expect(after.blocks).toContainEqual({ type: "hero", image_url: stored });
		expect(after.version).not.toBe(k.version);
	});

	test("a hero photo stays on the campaign it was uploaded for; on any other it is refused with how to add one", async () => {
		const k = await draft();
		const other = await draft("Spring drive");
		const link = json(
			await tool("create_photo_upload_link", {
				target: { kind: "campaign", id: other.id },
			}),
		);
		const othersPhoto = deployment.uploadPhoto(link.url);

		const refused = await tool("update_campaign_blocks", {
			id: k.id,
			blocks: blocksOf(k, { hero: othersPhoto }),
			expected_version: k.version,
		});
		const theirs = await get(other.id);
		const kept = await tool("update_campaign_blocks", {
			id: other.id,
			blocks: blocksOf(theirs, { story: "Spring." }),
			expected_version: theirs.version,
		});

		expect(refused.isError).toBe(true);
		const { next, problem } = refusal(refused);
		expect(next).toBe(
			"Nothing was saved: the hero photo must be one uploaded for this campaign. Make a link with create_photo_upload_link and have the operator upload the photo there; it becomes the campaign's hero, which get_campaign then shows. Otherwise send the hero as get_campaign returns it, or null.",
		);
		expect(problem).toMatchObject({
			code: "invalid",
			errors: [{ path: "blocks[2].image_url" }],
		});
		expect(kept.isError).toBeUndefined();
		expect(json(kept).blocks).toContainEqual({
			type: "hero",
			image_url: othersPhoto,
		});
	});

	test.each([
		["with the hero slot", { slot: "hero" }],
		["with no slot", {}],
	])("a campaign's link is asked for %s, as sent", async (_, slot) => {
		const k = await draft();

		await tool("create_photo_upload_link", {
			target: { kind: "campaign", id: k.id },
			...slot,
		});

		const asked = deployment.calls.at(-1);
		expect(asked?.path).toBe("/connector/v1/photos/upload-link");
		expect(asked?.body).toEqual({
			target: { kind: "campaign", id: k.id },
			...slot,
		});
	});

	test("the donation page takes no photo on Platform: its schema refuses it before the site is asked", async () => {
		const result = await tool("create_photo_upload_link", {
			target: { kind: "donation_page" },
		});

		expect(result.isError).toBe(true);
		expect(
			deployment.calls.filter(
				(c) => c.path === "/connector/v1/photos/upload-link",
			),
		).toEqual([]);
	});

	test("a slot other than the hero is refused before the site is asked", async () => {
		const k = await draft();

		const result = await tool("create_photo_upload_link", {
			target: { kind: "campaign", id: k.id },
			slot: "cover",
		});

		expect(result.isError).toBe(true);
		expect(
			deployment.calls.filter(
				(c) => c.path === "/connector/v1/photos/upload-link",
			),
		).toEqual([]);
	});
});

describe("create_form", () => {
	test("creates a form under a fresh Idempotency-Key", async () => {
		const result = await tool("create_form", { name: "Gala" });

		expect(result.isError).toBeUndefined();
		expect(json(result)).toMatchObject({ name: "Gala", status: "live" });
		expect(deployment.calls.at(-1)?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
	});

	const creates = () =>
		deployment.calls.filter(
			(c) => c.method === "POST" && c.path === "/connector/v1/forms",
		);

	test.each(["dropped", "502"] as const)(
		"an answer lost as %s is retried once under the same key: one form, shown as made",
		async (how) => {
			// Hello is asked on the connection's first request; only the create's answer is lost.
			await send("tools/list");
			deployment.loseAnswers(1, how);

			const result = await tool("create_form", { name: "Gala" });
			const forms = json(await tool("list_forms")).data;

			expect(creates()).toHaveLength(2);
			expect(creates()[1]?.idempotencyKey).toBe(creates()[0]?.idempotencyKey);
			expect(result.isError).toBeUndefined();
			const galas = forms.filter((f: { name: string }) => f.name === "Gala");
			expect(galas).toHaveLength(1);
			expect(json(result).id).toBe(galas[0].id);
		},
	);

	test("a second lost answer is not retried: two tries, and the chat is told to check list_forms", async () => {
		// Hello is asked on the connection's first request; only the create's answers are lost.
		await send("tools/list");
		deployment.loseAnswers(2);

		const result = await tool("create_form", { name: "Gala" });

		expect(creates()).toHaveLength(2);
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain(
			"Check with list_forms before trying again.",
		);
	});

	test("a first try still running is retried under the same key: one form, shown as made", async () => {
		deployment.stallCreates(1);
		deployment.setRetryAfter("0");

		const result = await tool("create_form", { name: "Gala" });
		const forms = json(await tool("list_forms")).data;

		expect(creates()).toHaveLength(3);
		expect(new Set(creates().map((c) => c.idempotencyKey)).size).toBe(1);
		expect(result.isError).toBeUndefined();
		expect(textOf(result)).not.toContain("Already done");
		expect(json(result)).toMatchObject({ name: "Gala" });
		expect(
			forms.filter((f: { name: string }) => f.name === "Gala"),
		).toHaveLength(1);
	});

	test("a create still in progress after the retries says to wait and check list_forms", async () => {
		deployment.stallCreates();
		deployment.setRetryAfter("0");

		const result = await tool("create_form", { name: "Gala" });

		expect(result.isError).toBe(true);
		const { next, problem } = refusal(result);
		expect(next).toBe(
			"The site is still working on this request. Wait a few seconds, then check with list_forms whether it went through before calling create_form again: a new call would make a second one.",
		);
		expect(problem).toMatchObject({ code: "idempotency_in_progress" });
	});

	test("a key the site matched to another request says nothing was made", async () => {
		deployment.intercept((req) =>
			req.method === "POST"
				? new Response(
						JSON.stringify({
							code: "idempotency_conflict",
							detail: "This Idempotency-Key was already used.",
						}),
						{
							status: 409,
							headers: { "content-type": "application/problem+json" },
						},
					)
				: undefined,
		);

		const result = await tool("create_form", { name: "Gala" });

		const { next, problem } = refusal(result);
		expect(next).toBe(
			"Nothing was made: the site matched this request to a different one. Check with list_forms, then call create_form again if it is still needed.",
		);
		expect(problem).toMatchObject({ code: "idempotency_conflict" });
	});
});

describe("update_form", () => {
	const AMOUNTS = [
		{ amount: "10.00", currency: "USD" },
		{ amount: "20.00", currency: "USD" },
	];

	test("renaming a live form needs no confirm; donors never see the name", async () => {
		const result = await tool("update_form", { id: "frm_1", name: "Main" });

		expect(json(result)).toMatchObject({ name: "Main" });
	});

	test("a change donors would see on a live form waits for confirm, then saves with it", async () => {
		const held = await tool("update_form", {
			id: "frm_1",
			suggested_amounts: AMOUNTS,
		});
		const unchanged = json(await tool("get_form", { id: "frm_1" }));
		const confirmed = await tool("update_form", {
			id: "frm_1",
			suggested_amounts: AMOUNTS,
			confirm: true,
		});

		expect(held.isError).toBe(true);
		const { next, problem } = refusal(held);
		expect(next).toBe(
			"Nothing was saved: this form is live, so donors would see this change. Tell the operator what will change and ask them to confirm. Only after they say yes, call update_form again with the same change and confirm: true.",
		);
		expect(problem).toMatchObject({ code: "confirm_required" });
		expect(unchanged.suggested_amounts).toBeUndefined();
		expect(json(confirmed)).toMatchObject({ suggested_amounts: AMOUNTS });
	});

	test("a change sent against an older updated_at says to read the form again", async () => {
		const read = json(await tool("get_form", { id: "frm_1" }));
		await tool("update_form", { id: "frm_1", name: "Main" });

		const result = await tool("update_form", {
			id: "frm_1",
			name: "Other",
			updated_at: read.updated_at,
		});

		const { next, problem } = refusal(result);
		expect(next).toBe(
			"Nothing was saved: this form changed after it was read. Read it again with get_form, make the change against what it shows now (with the updated_at it returns), and try again.",
		);
		expect(problem).toMatchObject({ code: "stale_read" });
	});
});

describe("results lead with the org", () => {
	test("a tool with a tailored summary, and one without", async () => {
		await draft("Winter coats");

		expect(leadOf(await tool("list_campaigns"))).toBe(
			"Hope Shelter: 1 campaign.",
		);
		expect(leadOf(await tool("list_campaigns", { status: "draft" }))).toBe(
			"Hope Shelter: 1 draft.",
		);
		expect(leadOf(await tool("get_block_catalog"))).toBe(
			"From Hope Shelter's Better Giving site:",
		);
	});
});

describe("campaign links", () => {
	test("create_campaign's result is the site's own, with no link the site didn't send", async () => {
		const result = await tool("create_campaign", { title: "Winter coats" });
		const k = json(result);

		expect(k).not.toHaveProperty("edit_url");
		expect(k.public_url).toBeNull();
		expect(leadOf(result)).toBe(
			`Created a draft campaign "Winter coats" for Hope Shelter. Donors can't see it until it's published.`,
		);
	});

	test("a live campaign whose nonprofit has no slug keeps the site's null public_url", async () => {
		db.close();
		await serve({ nonprofitSlug: false });
		const live = await draft("Winter Coats 2026");
		const kept = await draft("Spring fund");
		const published = json(
			await tool("publish_campaign", { id: live.id, gifts_go_to: null }),
		);

		const listed = json(await tool("list_campaigns")).data;
		const got = json(await tool("get_campaign", { id: live.id }));

		for (const k of [published, got, ...listed]) {
			expect(k.public_url).toBeNull();
			expect(k).not.toHaveProperty("edit_url");
		}
		expect(listed.map((k: { id: string }) => k.id)).toEqual([live.id, kept.id]);
	});

	test("no campaign-returning write adds an edit_url", async () => {
		const k = await draft();

		const settings = json(
			await tool("update_campaign_settings", {
				id: k.id,
				end_date: "2099-12-31",
				expected_version: k.version,
			}),
		);
		const blocks = json(
			await tool("update_campaign_blocks", {
				id: k.id,
				blocks: blocksOf(settings, { story: "Every coat." }),
				expected_version: settings.version,
			}),
		);
		await tool("publish_campaign", { id: k.id, gifts_go_to: null });
		const ended = json(await tool("end_campaign", { id: k.id }));

		for (const answer of [settings, blocks, ended]) {
			expect(answer).not.toHaveProperty("edit_url");
		}
	});
});

describe("an empty list says what exists", () => {
	const lists = () =>
		deployment.calls.filter(
			(c) => c.method === "GET" && c.path === "/connector/v1/campaigns",
		);

	test("a filtered empty list counts the other statuses with one more request", async () => {
		await draft("One");
		await draft("Two");
		const ended = await draft("Three");
		await tool("publish_campaign", { id: ended.id, gifts_go_to: null });
		await tool("end_campaign", { id: ended.id });
		const before = lists().length;

		const result = await tool("list_campaigns", { status: "published" });

		expect(result.isError).toBeUndefined();
		expect(leadOf(result)).toBe(
			'Hope Shelter has no published campaigns. It has 2 drafts and 1 ended campaign; call list_campaigns with status "draft" or "ended" to see them.',
		);
		expect(json(result)).toEqual({ data: [], next_cursor: null });
		expect(
			lists()
				.slice(before)
				.map((c) => c.query),
		).toEqual([{ status: "published" }, { limit: "100" }]);
	});

	test("past 100 campaigns it says more than 100", async () => {
		deployment.intercept((req) =>
			req.method === "GET" &&
			new URL(req.url).searchParams.get("limit") === "100"
				? Response.json({
						data: [{ id: "cmp_1", status: "draft" }],
						next_cursor: "100",
					})
				: undefined,
		);

		const result = await tool("list_campaigns", { status: "ended" });

		expect(leadOf(result)).toBe(
			"Hope Shelter has no ended campaigns. It has more than 100 campaigns in all; call list_campaigns without a status to see them.",
		);
	});

	test("with no campaigns at all it says none yet", async () => {
		const result = await tool("list_campaigns", { status: "draft" });

		expect(leadOf(result)).toBe(
			"Hope Shelter has no campaigns yet. create_campaign starts one as a draft.",
		);
	});

	test("an unfiltered empty list says none yet with no second request", async () => {
		await send("tools/list");
		const before = lists().length;

		const result = await tool("list_campaigns");

		expect(leadOf(result)).toBe(
			"Hope Shelter has no campaigns yet. create_campaign starts one as a draft.",
		);
		expect(lists()).toHaveLength(before + 1);
	});

	test("a failed count still answers the filtered list", async () => {
		await draft();
		deployment.intercept((req) =>
			new URL(req.url).searchParams.get("limit") === "100"
				? new Response("down", { status: 500 })
				: undefined,
		);

		const result = await tool("list_campaigns", { status: "published" });

		expect(result.isError).toBeUndefined();
		expect(leadOf(result)).toBe("Hope Shelter has no published campaigns.");
		expect(json(result)).toEqual({ data: [], next_cursor: null });
	});

	test("a key refused on the count still answers the filtered list", async () => {
		await draft();
		deployment.intercept((req) => {
			if (new URL(req.url).searchParams.get("limit") === "100") {
				deployment.refuseKeys();
			}
			return undefined;
		});

		const result = await tool("list_campaigns", { status: "published" });

		expect(result.isError).toBeUndefined();
		expect(leadOf(result)).toBe("Hope Shelter has no published campaigns.");
		expect(json(result)).toEqual({ data: [], next_cursor: null });
	});

	test("the count never names the status the filter just found empty", async () => {
		const counted = (data: { id: string; status: string }[]) =>
			deployment.intercept((req) =>
				new URL(req.url).searchParams.get("limit") === "100"
					? Response.json({ data, next_cursor: null })
					: undefined,
			);

		counted([
			{ id: "cmp_1", status: "published" },
			{ id: "cmp_2", status: "draft" },
		]);
		expect(leadOf(await tool("list_campaigns", { status: "published" }))).toBe(
			'Hope Shelter has no published campaigns. It has 1 draft; call list_campaigns with status "draft" to see it.',
		);

		counted([{ id: "cmp_1", status: "published" }]);
		expect(leadOf(await tool("list_campaigns", { status: "published" }))).toBe(
			"Hope Shelter has no published campaigns.",
		);
	});
});

test("create_campaign refuses a title longer than Platform's before any request", async () => {
	await send("tools/list");
	const before = deployment.calls.length;

	const result = await tool("create_campaign", {
		title: "x".repeat(TITLE_MAX + 1),
	});

	expect(TITLE_MAX).toBe(200);
	expect(result.isError).toBe(true);
	expect(deployment.calls).toHaveLength(before);
});

describe("descriptions", () => {
	const LINKS_ONLY =
		"Link only to URLs a Better Giving tool returned; never describe click-paths or invent URLs.";

	test("every campaign tool says to show only returned URLs, and no tool describes a click-path", async () => {
		const tools: { name: string; description: string }[] = (
			await rpc(await send("tools/list"))
		).result.tools;

		for (const name of [
			"list_campaigns",
			"get_campaign",
			"create_campaign",
			"update_campaign_blocks",
			"update_campaign_settings",
			"publish_campaign",
			"end_campaign",
			"create_photo_upload_link",
		]) {
			expect({
				name,
				says: tools
					.find((t) => t.name === name)
					?.description.includes(LINKS_ONLY),
			}).toEqual({ name, says: true });
		}
		const text = JSON.stringify(tools);
		expect(text).not.toContain("Not yet available");
		expect(text).not.toContain("→");
	});

	test("create_campaign asks once for everything, then fills in the rest without asking again", async () => {
		const tools: { name: string; description: string }[] = (
			await rpc(await send("tools/list"))
		).result.tools;
		const create = tools.find((t) => t.name === "create_campaign")?.description;

		expect(create).toContain("in one message");
		expect(create).toContain("update_campaign_settings");
		expect(create).toContain("update_campaign_blocks");
		expect(create).not.toContain("edit_url");
	});

	test("list and get campaign name no edit_url; an empty filtered list reports counts", async () => {
		const tools: { name: string; description: string }[] = (
			await rpc(await send("tools/list"))
		).result.tools;
		const list = tools.find((t) => t.name === "list_campaigns")?.description;
		const get = tools.find((t) => t.name === "get_campaign")?.description;

		expect(list).not.toContain("edit_url");
		expect(list).toContain("no need to list again");
		expect(get).not.toContain("edit_url");
	});
});
