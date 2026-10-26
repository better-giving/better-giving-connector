import { describe, expect, test } from "vitest";
import { PLATFORM_HELLO } from "../../test/platform-hello";
import { helloBody, knownActions } from "./contract";

describe("knownActions", () => {
	test("reads Standalone's contract names", () => {
		expect(knownActions(["campaigns.list", "donations.record"])).toEqual([
			"campaigns.list",
			"donations.record",
		]);
	});

	test("reads tool names as their contract names", () => {
		expect(
			knownActions([
				"list_campaigns",
				"get_block_catalog",
				"record_donation",
				"create_photo_upload_link",
			]),
		).toEqual([
			"campaigns.list",
			"blocks.catalog",
			"donations.record",
			"photos.upload_link",
		]);
	});

	test("reads the content tools' names as Standalone's content actions", () => {
		expect(
			knownActions([
				"update_campaign_content",
				"update_donation_page_content",
				"get_content_catalog",
			]),
		).toEqual([
			"campaigns.update_content",
			"donation_page.update_content",
			"content.catalog",
		]);
	});

	test("reads a mixed list once per action", () => {
		expect(
			knownActions([
				"campaigns.list",
				"list_campaigns",
				"get_results",
				"results.summary",
				"forms.get",
			]),
		).toEqual(["campaigns.list", "results.summary", "forms.get"]);
	});

	test("drops a name that is neither a contract name nor a tool name", () => {
		expect(
			knownActions([
				"hello",
				"exchange",
				"disconnect",
				"campaigns.teleport",
				"teleport_campaign",
				"toString",
				"__proto__",
				42,
				null,
			]),
		).toEqual([]);
	});
});

test("Platform's hello serves its twelve actions", () => {
	expect(helloBody.parse(PLATFORM_HELLO).actions).toEqual([
		"campaigns.list",
		"campaigns.get",
		"campaigns.create",
		"donation_page.get",
		"blocks.catalog",
		"forms.list",
		"forms.get",
		"results.summary",
		"donations.list",
		"donors.list",
		"donors.get",
		"recurring.list",
	]);
});
