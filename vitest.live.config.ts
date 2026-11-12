import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/live/**/*.live.ts"],
		// one test makes dozens of real tool calls in turn; vitest's default is 5 s
		testTimeout: 120_000,
	},
});
