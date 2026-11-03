import { expect, test } from "vitest";
import { TOOL_ACTIONS } from "../deployment";
import { ACTIONS, actionsFor } from "./actions";
import { LOCAL_TOOLS } from "./local";
import type { ToolSpec } from "./spec";

test("the contract's tool names are exactly the tools' names and actions", () => {
	expect(TOOL_ACTIONS).toEqual(
		Object.fromEntries(ACTIONS.map((spec) => [spec.tool, spec.action])),
	);
});

test("Standalone gets the specs as they are; Platform changes nine, and only their wording and inputs", () => {
	expect(actionsFor(false)).toBe(ACTIONS);
	const platform = actionsFor(true);
	expect(platform.map((s) => [s.tool, s.action, s.annotations])).toEqual(
		ACTIONS.map((s) => [s.tool, s.action, s.annotations]),
	);
	const changed = platform
		.filter(
			(s, i) =>
				s.description !== ACTIONS[i]?.description ||
				s.input !== ACTIONS[i]?.input,
		)
		.map((s) => s.tool);
	expect(changed).toEqual([
		"list_campaigns",
		"get_campaign",
		"create_campaign",
		"update_campaign_blocks",
		"update_campaign_settings",
		"publish_campaign",
		"create_form",
		"update_form",
		"create_photo_upload_link",
	]);
	const photo = platform.find((s) => s.tool === "create_photo_upload_link");
	expect(photo?.description).toContain("JPEG, PNG or WebP of at most 4 MB");
	expect(photo?.description).toContain("15 minutes");
});

const EVERY_SPEC: readonly ToolSpec[] = [
	...actionsFor(false),
	...actionsFor(true),
	...LOCAL_TOOLS,
];

test("every spec, Platform's and the connector's own included, sets readOnlyHint and destructiveHint", () => {
	for (const spec of EVERY_SPEC) {
		expect(typeof spec.annotations.readOnlyHint, spec.tool).toBe("boolean");
		expect(typeof spec.annotations.destructiveHint, spec.tool).toBe("boolean");
	}
});

test("only publishing, ending, resetting and discarding a draft are destructive; a read never is", () => {
	const destructive = EVERY_SPEC.filter((s) => s.annotations.destructiveHint);

	expect([...new Set(destructive.map((s) => s.tool))]).toEqual([
		"publish_campaign",
		"end_campaign",
		"reset_donation_page",
		"discard_campaign_draft",
		"app_publish_campaign",
		"app_end_campaign",
		"app_discard_campaign_draft",
	]);
	for (const spec of EVERY_SPEC.filter((s) => s.annotations.readOnlyHint)) {
		expect(spec.annotations.destructiveHint, spec.tool).toBe(false);
	}
});

test("an edit overwrites without being destructive, and stays idempotent and open-world", () => {
	const edits = ACTIONS.filter((s) => /^update_/.test(s.tool));

	expect(edits.map((s) => s.tool)).toEqual([
		"update_campaign_blocks",
		"update_campaign_content",
		"update_campaign_settings",
		"update_donation_page_blocks",
		"update_donation_page_content",
		"update_form",
	]);
	for (const spec of edits) {
		expect(spec.annotations, spec.tool).toEqual({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		});
	}
});

test("every tool states what it is doing and what it did, each in at most 64 characters", () => {
	for (const spec of EVERY_SPEC) {
		const invoking = spec._meta["openai/toolInvocation/invoking"];
		const invoked = spec._meta["openai/toolInvocation/invoked"];
		expect(invoking, spec.tool).toMatch(/\S…$/);
		expect(invoked, spec.tool).toMatch(/\S$/);
		expect(invoking.length, spec.tool).toBeLessThanOrEqual(64);
		expect(invoked.length, spec.tool).toBeLessThanOrEqual(64);
	}
});

test("every tool's output schema is an object that lets a field it doesn't name through", () => {
	for (const spec of [...actionsFor(false), ...actionsFor(true)]) {
		const json = spec.output.schema["~standard"].jsonSchema.output({
			target: "draft-2020-12",
		});
		expect(json.type, spec.tool).toBe("object");
		expect(json.additionalProperties, spec.tool).toEqual({});
	}
});
