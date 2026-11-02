import type { z } from "zod";
import type { ActionName } from "../deployment";
import type { LocalCall } from "./spec";

// The most pages of 100 read of each list: 500 ended campaigns, 500 gifts.
const PAGE_SIZE = 100;
const MAX_PAGES = 5;

export type Body = Record<string, unknown>;
export const isBody = (value: unknown): value is Body =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Every item of a paged list the schema accepts, up to MAX_PAGES pages; an item it refuses is left out. */
export async function readPages<T>(
	{ connection, client }: LocalCall,
	action: ActionName,
	query: Body,
	item: z.ZodType<T>,
): Promise<T[]> {
	const items: T[] = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const answer = (
			await client.call(connection, action, {
				...query,
				limit: PAGE_SIZE,
				...(cursor === undefined ? {} : { cursor }),
			})
		).body;
		const data =
			isBody(answer) && Array.isArray(answer.data) ? answer.data : [];
		for (const raw of data) {
			const parsed = item.safeParse(raw);
			if (parsed.success) items.push(parsed.data);
		}
		if (!isBody(answer) || typeof answer.next_cursor !== "string") break;
		cursor = answer.next_cursor;
	}
	return items;
}
