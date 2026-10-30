import { afterEach, expect, test, vi } from "vitest";
import { parseOrigin } from "../deployment/origin";
import { Secret } from "../secret";
import { ACTIONS } from "./actions";
import { answerText } from "./answer";

const spec = ACTIONS.find((action) => action.tool === "list_campaigns");
const origin = parseOrigin("https://give.example.org");

const connection = () => {
	if (!origin) throw new Error("bad origin");
	return {
		userId: "user",
		origin,
		orgName: "Give",
		actions: null,
		platform: false,
		key: new Secret("bgk_test"),
		createdAt: new Date(),
	};
};

afterEach(() => {
	vi.useRealTimers();
});

test("a count that never answers falls back to the plain lead after 3 seconds and leaves no timer", async () => {
	if (!spec) throw new Error("no list_campaigns spec");
	vi.useFakeTimers();
	const empty = { data: [], next_cursor: null };

	const text = answerText(
		spec,
		connection(),
		{ status: "published" },
		{ status: 200, body: empty },
		{
			client: { call: () => new Promise(() => {}) },
			dropConnection: async () => {},
		},
	);
	await vi.advanceTimersByTimeAsync(2_999);
	const early = await Promise.race([text, Promise.resolve("pending")]);
	await vi.advanceTimersByTimeAsync(1);

	expect(early).toBe("pending");
	expect(await text).toBe(
		`Give has no published campaigns.\n${JSON.stringify(empty)}`,
	);
	expect(vi.getTimerCount()).toBe(0);
});

test("a count that answers leaves no timer behind", async () => {
	if (!spec) throw new Error("no list_campaigns spec");
	vi.useFakeTimers();

	await answerText(
		spec,
		connection(),
		{ status: "published" },
		{ status: 200, body: { data: [], next_cursor: null } },
		{
			client: {
				call: async () => ({
					status: 200,
					body: { data: [{ status: "draft" }], next_cursor: null },
				}),
			},
			dropConnection: async () => {},
		},
	);

	expect(vi.getTimerCount()).toBe(0);
});
