import type { Origin } from "../deployment/origin";
import type { Db } from "./index";

export type CampaignDraftKey = {
	userId: string;
	origin: Origin;
	campaignId: string;
};

export type CampaignDraft = CampaignDraftKey & {
	/** The campaign version the edit starts from, or null when the deployment returned none. */
	baseVersion: string | null;
	/** null when settings weren't edited. */
	settings: unknown | null;
	/** null when the page wasn't edited. */
	page: unknown | null;
	/** null exactly when page is. */
	pageKind: "blocks" | "content" | null;
	updatedAt: Date;
};

export interface CampaignDrafts {
	get(key: CampaignDraftKey): Promise<CampaignDraft | null>;
	/** Replaces the whole row for draft's key, stamping updatedAt with now. */
	put(draft: Omit<CampaignDraft, "updatedAt">): Promise<void>;
	/** Whether a draft was there to remove. */
	delete(key: CampaignDraftKey): Promise<boolean>;
	/** Removes drafts last put strictly before cutoff; returns how many. */
	deleteIdleSince(cutoff: Date): Promise<number>;
	/** Removes every draft of userId, on any origin; returns how many. */
	deleteForUser(userId: string): Promise<number>;
}

export function campaignDrafts(db: Db): CampaignDrafts {
	return {
		async get(key) {
			const { rows } = await db.execute({
				sql: "SELECT base_version, settings, page, page_kind, updated_at FROM campaign_draft WHERE user_id = ? AND origin = ? AND campaign_id = ?",
				args: [key.userId, key.origin, key.campaignId],
			});
			const row = rows[0];
			if (!row) return null;
			const page = parseJson(row.page);
			return {
				userId: key.userId,
				origin: key.origin,
				campaignId: key.campaignId,
				baseVersion:
					row.base_version === null ? null : String(row.base_version),
				settings: parseJson(row.settings),
				page,
				pageKind:
					page === null ? null : (row.page_kind as CampaignDraft["pageKind"]),
				updatedAt: new Date(Number(row.updated_at)),
			};
		},
		async put(d) {
			await db.execute({
				sql: "INSERT OR REPLACE INTO campaign_draft (user_id, origin, campaign_id, base_version, settings, page, page_kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				args: [
					d.userId,
					d.origin,
					d.campaignId,
					d.baseVersion,
					d.settings === null ? null : JSON.stringify(d.settings),
					d.page === null ? null : JSON.stringify(d.page),
					d.pageKind,
					Date.now(),
				],
			});
		},
		async delete(key) {
			const { rowsAffected } = await db.execute({
				sql: "DELETE FROM campaign_draft WHERE user_id = ? AND origin = ? AND campaign_id = ?",
				args: [key.userId, key.origin, key.campaignId],
			});
			return rowsAffected > 0;
		},
		async deleteIdleSince(cutoff) {
			const { rowsAffected } = await db.execute({
				sql: "DELETE FROM campaign_draft WHERE updated_at < ?",
				args: [cutoff.getTime()],
			});
			return rowsAffected;
		},
		async deleteForUser(userId) {
			const { rowsAffected } = await db.execute({
				sql: "DELETE FROM campaign_draft WHERE user_id = ?",
				args: [userId],
			});
			return rowsAffected;
		},
	};
}

// A NULL column, or one JSON can't read, is "not edited" (null).
function parseJson(value: unknown): unknown | null {
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
