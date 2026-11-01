import type {
	CampaignDraft,
	CampaignDraftKey,
	CampaignDrafts,
} from "../src/db";

/** The draft store in a Map, for a test or harness that has no database. Keeps src/db's contract. */
export function memoryDrafts(): CampaignDrafts {
	const rows = new Map<string, CampaignDraft>();
	const id = (k: CampaignDraftKey) =>
		`${k.userId}\n${k.origin}\n${k.campaignId}`;
	const removeWhere = (match: (d: CampaignDraft) => boolean) => {
		let n = 0;
		for (const [key, d] of rows) {
			if (match(d)) {
				rows.delete(key);
				n++;
			}
		}
		return n;
	};
	return {
		get: async (key) => structuredClone(rows.get(id(key)) ?? null),
		put: async (draft) => {
			rows.set(id(draft), structuredClone({ ...draft, updatedAt: new Date() }));
		},
		delete: async (key) => rows.delete(id(key)),
		deleteIdleSince: async (cutoff) =>
			removeWhere((d) => d.updatedAt.getTime() < cutoff.getTime()),
		deleteForUser: async (userId) => removeWhere((d) => d.userId === userId),
	};
}
