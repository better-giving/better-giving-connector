import { Hono } from "hono";
import { timingSafeEqual } from "hono/utils/buffer";
import type { AuthFacade } from "./auth";
import type { CampaignDrafts } from "./db";
import { log } from "./log";

// Under the function's maxDuration, with time left to answer.
const SWEEP_BUDGET_MS = 50_000;

/** A draft of a live campaign untouched this long is dropped. */
export const DRAFT_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

export type CronDeps = {
	auth: Pick<AuthFacade, "sweep">;
	drafts: Pick<CampaignDrafts, "deleteIdleSince">;
	secret: string;
	/** Milliseconds from any fixed start; `performance.now` unless given. */
	clock?: () => number;
};

/** The jobs Vercel's cron calls, each with `Authorization: Bearer <CRON_SECRET>`. */
export function cronRoutes(deps: CronDeps): Hono {
	const expected = `Bearer ${deps.secret}`;
	const app = new Hono();
	// Not hono/bearer-auth: it answers a malformed header 400 and carries a body.
	app.use(async (c, next) => {
		const given = c.req.header("authorization") ?? "";
		if (!(await timingSafeEqual(expected, given))) return c.body(null, 401);
		await next();
	});
	app.get("/sweep", async (c) => {
		const clock = deps.clock ?? (() => performance.now());
		const started = clock();
		const failures: unknown[] = [];
		let connections = 0;
		try {
			let more: boolean;
			do {
				const batch = await deps.auth.sweep();
				connections += batch.connections;
				more = batch.more;
			} while (more && clock() - started < SWEEP_BUDGET_MS);
		} catch (error) {
			failures.push(error);
		}
		let drafts = 0;
		try {
			drafts = await deps.drafts.deleteIdleSince(
				new Date(Date.now() - DRAFT_IDLE_MS),
			);
		} catch (error) {
			failures.push(error);
		}
		log({
			kind: "sweep",
			connections,
			drafts,
			ms: Math.round(clock() - started),
		});
		for (const error of failures) {
			log({
				kind: "error",
				where: "sweep",
				errorName: error instanceof Error ? error.name : "unknown",
			});
		}
		if (failures.length > 0) return c.json({ error: "internal_error" }, 500);
		return c.json({ connections, drafts }, 200);
	});
	return app;
}
