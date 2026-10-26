// Platform's hello body as it serves it (better-giving/better-giving-platform,
// apps/platform/.server/connector/actions.ts): tool names, not contract names.
export const PLATFORM_HELLO = {
	service: "better-giving",
	contract: 1,
	release: "0f3c2a1",
	name: "Better Giving",
	actions: [
		"hello",
		"exchange",
		"disconnect",
		"list_campaigns",
		"get_campaign",
		"create_campaign",
		"update_campaign_settings",
		"update_campaign_blocks",
		"publish_campaign",
		"end_campaign",
		"get_donation_page",
		"get_block_catalog",
		"list_forms",
		"get_form",
		"create_form",
		"update_form",
		"get_results",
		"list_donations",
		"list_donors",
		"get_donor",
		"list_recurring_gifts",
		"create_photo_upload_link",
	],
};

/** The tools a Platform connection offers. */
export const PLATFORM_TOOLS = PLATFORM_HELLO.actions.filter(
	(name) => !["hello", "exchange", "disconnect"].includes(name),
);

/** Each Platform tool's contract action, as the fake deployment serves it. */
export const PLATFORM_ACTION_OF: Record<string, string> = {
	list_campaigns: "campaigns.list",
	get_campaign: "campaigns.get",
	create_campaign: "campaigns.create",
	update_campaign_settings: "campaigns.update_settings",
	update_campaign_blocks: "campaigns.update_blocks",
	publish_campaign: "campaigns.publish",
	end_campaign: "campaigns.end",
	get_donation_page: "donation_page.get",
	get_block_catalog: "blocks.catalog",
	list_forms: "forms.list",
	get_form: "forms.get",
	create_form: "forms.create",
	update_form: "forms.update",
	get_results: "results.summary",
	list_donations: "donations.list",
	list_donors: "donors.list",
	get_donor: "donors.get",
	list_recurring_gifts: "recurring.list",
	create_photo_upload_link: "photos.upload_link",
};
