import { expect, test } from "vitest";
import { TOOL_ACTIONS } from "../deployment";
import { ACTIONS } from "./actions";

test("the contract's tool names are exactly the tools' names and actions", () => {
	expect(TOOL_ACTIONS).toEqual(
		Object.fromEntries(ACTIONS.map((spec) => [spec.tool, spec.action])),
	);
});
