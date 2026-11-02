import { randomInt } from "node:crypto";
import type {
	CampaignDraft,
	CampaignDraftKey,
	CampaignDrafts,
	CampaignDraftWrite,
} from "../src/db";

// Random, as in src/db: a draft deleted and stored again must refuse a
// revision read from the deleted one.
const firstRevision = () => randomInt(1, 2 ** 47);

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
		put: async (draft: CampaignDraftWrite, read?: number | null) => {
			const stored = rows.get(id(draft));
			if (read === null && stored) return false;
			if (typeof read === "number" && stored?.revision !== read) return false;
			rows.set(
				id(draft),
				structuredClone({
					...draft,
					updatedAt: new Date(),
					revision: stored ? stored.revision + 1 : firstRevision(),
				}),
			);
			return true;
		},
		delete: async (key, read) => {
			const stored = rows.get(id(key));
			if (read !== undefined && stored?.revision !== read) return false;
			return rows.delete(id(key));
		},
		deleteIdleSince: async (cutoff) =>
			removeWhere((d) => d.updatedAt.getTime() < cutoff.getTime()),
		deleteForUser: async (userId) => removeWhere((d) => d.userId === userId),
	};
}
