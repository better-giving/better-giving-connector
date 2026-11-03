import { expect, test } from "vitest";
import type { Host } from "../host";
import { callTool } from "./tools";

test("an answer the card can't read after a write says to check the campaign, not to try again", async () => {
	const host = {
		callTool: async () => ({ ok: true, data: { campaign: "unexpected" } }),
	} as unknown as Host;

	const res = await callTool(host, "app_end_campaign", { id: "c1" });

	expect(res.ok).toBe(false);
	if (res.ok) return;
	expect(res.error).toMatch(/Check the campaign before trying again\.$/);
	expect(res.error).not.toMatch(/Try again in a moment/);
});
