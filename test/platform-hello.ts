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
		"get_donation_page",
		"get_block_catalog",
		"list_forms",
		"get_form",
		"get_results",
		"list_donations",
		"list_donors",
		"get_donor",
		"list_recurring_gifts",
	],
};

/** The tools a Platform connection offers. */
export const PLATFORM_TOOLS = [
	"list_campaigns",
	"get_campaign",
	"create_campaign",
	"get_donation_page",
	"get_block_catalog",
	"list_forms",
	"get_form",
	"get_results",
	"list_donations",
	"list_donors",
	"get_donor",
	"list_recurring_gifts",
];
