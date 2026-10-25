import { type ActionName, knownActions } from "../deployment";
import type { Origin } from "../deployment/origin";
import type { Secret } from "../secret";
import type { Db } from "./index";
import { keyCipher } from "./key-cipher";

export type Connection = {
	userId: string;
	origin: Origin;
	orgName: string;
	/** The actions the deployment serves, or null when it didn't state them. */
	actions: ActionName[] | null;
	key: Secret;
	createdAt: Date;
};

export interface Connections {
	insert(r: {
		userId: string;
		origin: Origin;
		orgName: string;
		actions: ActionName[] | null;
		key: Secret;
	}): Promise<void>;
	get(userId: string): Promise<Connection | null>;
	delete(userId: string): Promise<void>;
}

export function connections(db: Db, cipherSecret: string): Connections {
	const cipher = keyCipher(cipherSecret);
	return {
		async insert(r) {
			await db.execute({
				sql: "INSERT INTO connection (user_id, origin, org_name, key_ct, actions, created_at) VALUES (?, ?, ?, ?, ?, ?)",
				args: [
					r.userId,
					r.origin,
					r.orgName,
					await cipher.seal(r.key, bindTo(r.userId, r.origin)),
					r.actions === null ? null : JSON.stringify(r.actions),
					Date.now(),
				],
			});
		},
		async get(userId) {
			const { rows } = await db.execute({
				sql: "SELECT origin, org_name, key_ct, actions, created_at FROM connection WHERE user_id = ?",
				args: [userId],
			});
			const row = rows[0];
			if (!row) return null;
			const origin = String(row.origin) as Origin;
			return {
				userId,
				origin,
				orgName: String(row.org_name),
				actions: parseActions(row.actions),
				key: await cipher.open(String(row.key_ct), bindTo(userId, origin)),
				createdAt: new Date(Number(row.created_at)),
			};
		},
		async delete(userId) {
			await db.execute({
				sql: "DELETE FROM connection WHERE user_id = ?",
				args: [userId],
			});
		},
	};
}

// A NULL column, or one JSON can't read, is "not stated" (null); a stored name
// this contract no longer carries is dropped, as hello's `actions` are.
function parseActions(value: unknown): ActionName[] | null {
	if (typeof value !== "string") return null;
	try {
		return knownActions(JSON.parse(value));
	} catch {
		return null;
	}
}

// the AAD: a key_ct copied to another user or origin no longer decrypts
const bindTo = (userId: string, origin: Origin) => `${userId}\n${origin}`;
