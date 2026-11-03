import { expect, test } from "vitest";
import type { ActionName } from "../deployment";
import { parseOrigin } from "../deployment/origin";
import { Secret } from "../secret";
import type { LocalCall } from "./spec";
import { resultsData } from "./widget-data";

const origin = parseOrigin("https://give.example.org");
if (!origin) throw new Error("bad origin");
const usd = (amount: string) => ({ amount, currency: "USD" });
const DAY_MS = 86_400_000;
const daysAgo = (n: number) =>
	new Date(Date.now() - n * DAY_MS).toISOString().slice(0, 10);

/** A LocalCall whose deployment answers each action from `answers`, recording what it was sent. */
function scripted(
	answers: Partial<
		Record<ActionName, (input: Record<string, unknown>) => unknown>
	>,
) {
	const sent: { action: ActionName; input: Record<string, unknown> }[] = [];
	const call = {
		connection: {
			userId: "user_1",
			origin,
			orgName: "Give",
			actions: Object.keys(answers) as ActionName[],
			platform: true,
			key: new Secret("bgk_test"),
			createdAt: new Date(),
		},
		locale: "en-US",
		input: {},
		client: {
			async call(
				_: unknown,
				action: ActionName,
				input: Record<string, unknown>,
			) {
				sent.push({ action, input });
				const answer = answers[action];
				if (!answer) throw new Error(`unexpected ${action}`);
				return { status: 200, body: answer(input) };
			},
		},
		drafts: { get: async () => null },
		publicOrigin: "https://app.connect.better.giving",
		fetch,
	} as unknown as LocalCall;
	return { sent, call };
}

const gift = (amount: string, date: string) => ({ amount: usd(amount), date });

test("a campaign with more gifts than the read reaches shows no median, and its last two weeks come from a read of those weeks alone", async () => {
	const { sent, call } = scripted({
		"campaigns.get": () => ({
			id: "cmp_1",
			title: "Coats",
			status: "published",
		}),
		"results.summary": () => ({
			total: usd("90000.00"),
			donor_count: 700,
			gift_count: 900,
		}),
		"donations.list": ({ from, cursor }) =>
			from === undefined
				? {
						data: Array.from({ length: 100 }, () =>
							gift("10.00", "2025-01-01T00:00:00Z"),
						),
						next_cursor: String(Number(cursor ?? 0) + 1),
					}
				: {
						data: [gift("250.00", `${daysAgo(0)}T12:00:00Z`)],
						next_cursor: null,
					},
	});

	const data = await resultsData(call, "cmp_1");

	expect(data.medianGift).toBeNull();
	expect(data.averageGift).toEqual(usd("100.00"));
	expect(data.daily.at(-1)).toEqual({ date: daysAgo(0), total: usd("250.00") });
	expect(
		sent
			.filter(
				(s) => s.action === "donations.list" && s.input.from !== undefined,
			)
			.map((s) => s.input),
	).toEqual([{ campaign_id: "cmp_1", from: daysAgo(13), limit: 100 }]);
});

test("a campaign whose gifts all fit in the read shows their median", async () => {
	const { call } = scripted({
		"campaigns.get": () => ({
			id: "cmp_1",
			title: "Coats",
			status: "published",
		}),
		"results.summary": () => ({
			total: usd("60.00"),
			donor_count: 3,
			gift_count: 3,
		}),
		"donations.list": () => ({
			data: [
				gift("10.00", "2025-01-01T00:00:00Z"),
				gift("20.00", "2025-01-02T00:00:00Z"),
				gift("30.00", "2025-01-03T00:00:00Z"),
			],
			next_cursor: null,
		}),
	});

	const data = await resultsData(call, "cmp_1");

	expect(data.medianGift).toEqual(usd("20.00"));
});
