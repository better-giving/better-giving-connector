import { z } from "zod";
import { READ } from "./actions";
import { DISCARD_CAMPAIGN_DRAFT } from "./discard-draft";
import { RECOMMEND_CAMPAIGN_PRESETS } from "./recommend-tool";
import { type LocalSpec, statusLines } from "./spec";

const profile = z.strictObject({ id: z.string(), name: z.string() });

/** The tools the connector answers itself, offered beside the action tools. */
export const LOCAL_TOOLS: readonly LocalSpec[] = [
	{
		tool: "get_profile",
		title: "Get the connected account",
		description:
			"Returns the connected Better Giving account: a stable id for it and the nonprofit's name.",
		input: z.strictObject({}),
		output: { schema: profile },
		annotations: READ,
		_meta: {
			...statusLines("Reading the connected account…", "Account read"),
			"openai/profile": true,
		},
		needs: [],
		// The user id and the org name alone: never the origin, never the key.
		async run({ connection }) {
			const structured = profile.parse({
				id: connection.userId,
				name: connection.orgName,
			});
			return { text: JSON.stringify(structured), structured };
		},
	},
	DISCARD_CAMPAIGN_DRAFT,
	RECOMMEND_CAMPAIGN_PRESETS,
];
