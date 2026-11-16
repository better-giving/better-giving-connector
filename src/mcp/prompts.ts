import type { McpServer } from "@modelcontextprotocol/server";

/**
 * A prompt a chat app lists for the operator to pick (Claude shows them as
 * slash commands). `text` is the message it sends, worded as the operator
 * would ask, and `needs` the tools its task takes: a prompt is registered only
 * where every one of them is. The text names a tool only where the task
 * depends on it, so the server's instructions still choose between a card
 * and its tools.
 */
export type PromptSpec = {
	name: string;
	title: string;
	description: string;
	text: string;
	needs: readonly string[];
};

export const PROMPTS: readonly PromptSpec[] = [
	{
		name: "start-campaign",
		title: "Start a campaign",
		description: "Set up a new campaign from recommended settings.",
		text: "Start a new campaign for our nonprofit, with its goal, suggested amounts, run length and theme recommended from our past campaigns.",
		needs: ["recommend_campaign_presets", "create_campaign"],
	},
	{
		name: "campaign-results",
		title: "How is my campaign doing",
		description: "Show a campaign's status, progress and results.",
		text: "How is my campaign doing? Show me its status, its progress toward the goal and its results.",
		needs: ["get_campaign"],
	},
	{
		name: "publish-draft",
		title: "Publish my draft",
		description: "Send a campaign's draft changes live.",
		text: "Publish my campaign draft. Say what will change and wait for my explicit yes in this chat before calling publish_campaign.",
		needs: ["publish_campaign"],
	},
];

/** Registers the prompts whose tools are all among `tools`. */
export function registerPrompts(
	server: McpServer,
	tools: ReadonlySet<string>,
): void {
	for (const prompt of PROMPTS) {
		if (!prompt.needs.every((tool) => tools.has(tool))) continue;
		server.registerPrompt(
			prompt.name,
			{ title: prompt.title, description: prompt.description },
			() => ({
				messages: [
					{ role: "user", content: { type: "text", text: prompt.text } },
				],
			}),
		);
	}
}
