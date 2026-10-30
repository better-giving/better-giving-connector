import { expect, test } from "vitest";
import { TOOL_ACTIONS } from "../deployment";
import { ACTIONS, actionsFor } from "./actions";

test("the contract's tool names are exactly the tools' names and actions", () => {
	expect(TOOL_ACTIONS).toEqual(
		Object.fromEntries(ACTIONS.map((spec) => [spec.tool, spec.action])),
	);
});

test("Standalone gets the specs as they are; Platform changes eight, and only their wording and inputs", () => {
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
		"create_form",
		"update_form",
		"create_photo_upload_link",
	]);
	const photo = platform.find((s) => s.tool === "create_photo_upload_link");
	expect(photo?.description).toContain("JPEG, PNG or WebP of at most 4 MB");
	expect(photo?.description).toContain("15 minutes");
});
