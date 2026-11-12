import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/live/**/*.live.ts"],
		// one test makes ~20 sequential real tool calls; vitest's default is 5 s
		testTimeout: 120_000,
	},
});
