import { randomInt } from "node:crypto";
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
	/** Moves on every write; put and delete take the one the caller read. */
	revision: number;
};

export type CampaignDraftWrite = Omit<CampaignDraft, "updatedAt" | "revision">;

export interface CampaignDrafts {
	get(key: CampaignDraftKey): Promise<CampaignDraft | null>;
	/**
	 * Replaces the whole row for draft's key, stamping updatedAt with now and
	 * moving the revision, only while the stored revision is still `read`:
	 * null means no draft may be stored. Whether it wrote; false means the
	 * draft changed since it was read, so read it again.
	 */
	put(draft: CampaignDraftWrite, read: number | null): Promise<boolean>;
	/** @deprecated Overwrites a draft saved since the caller read it: pass the revision read. */
	put(draft: CampaignDraftWrite): Promise<boolean>;
	/**
	 * Whether a draft was removed. Given the revision the caller read, removes
	 * the draft only while it is still that one; without, whichever is stored.
	 */
	delete(key: CampaignDraftKey, read?: number): Promise<boolean>;
	/** Removes drafts last put strictly before cutoff; returns how many. */
	deleteIdleSince(cutoff: Date): Promise<number>;
	/** Removes every draft of userId, on any origin; returns how many. */
	deleteForUser(userId: string): Promise<number>;
}

export function campaignDrafts(db: Db): CampaignDrafts {
	return {
		async get(key) {
			const { rows } = await db.execute({
				sql: "SELECT base_version, settings, page, page_kind, updated_at, revision FROM campaign_draft WHERE user_id = ? AND origin = ? AND campaign_id = ?",
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
				revision: Number(row.revision),
			};
		},
		async put(d: CampaignDraftWrite, read?: number | null) {
			const parts = [
				d.baseVersion,
				d.settings === null ? null : JSON.stringify(d.settings),
				d.page === null ? null : JSON.stringify(d.page),
				d.pageKind,
				Date.now(),
			];
			const key = [d.userId, d.origin, d.campaignId];
			const { rowsAffected } = await db.execute(
				read === null
					? {
							sql: `${INSERT} ON CONFLICT DO NOTHING`,
							args: [...key, ...parts, firstRevision()],
						}
					: read === undefined
						? {
								sql: `${INSERT} ON CONFLICT DO UPDATE SET base_version = excluded.base_version, settings = excluded.settings, page = excluded.page, page_kind = excluded.page_kind, updated_at = excluded.updated_at, revision = excluded.revision`,
								args: [...key, ...parts, firstRevision()],
							}
						: {
								sql: "UPDATE campaign_draft SET base_version = ?, settings = ?, page = ?, page_kind = ?, updated_at = ?, revision = revision + 1 WHERE user_id = ? AND origin = ? AND campaign_id = ? AND revision = ?",
								args: [...parts, ...key, read],
							},
			);
			return rowsAffected > 0;
		},
		async delete(key, read) {
			const args = [key.userId, key.origin, key.campaignId];
			const { rowsAffected } = await db.execute(
				read === undefined
					? {
							sql: "DELETE FROM campaign_draft WHERE user_id = ? AND origin = ? AND campaign_id = ?",
							args,
						}
					: {
							sql: "DELETE FROM campaign_draft WHERE user_id = ? AND origin = ? AND campaign_id = ? AND revision = ?",
							args: [...args, read],
						},
			);
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

const INSERT =
	"INSERT INTO campaign_draft (user_id, origin, campaign_id, base_version, settings, page, page_kind, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

// Random, not 1: a draft deleted and stored again must refuse a revision read
// from the deleted one. Never 0, which 0005 gave rows already stored.
const firstRevision = () => randomInt(1, 2 ** 47);

// A NULL column, or one JSON can't read, is "not edited" (null).
function parseJson(value: unknown): unknown | null {
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
