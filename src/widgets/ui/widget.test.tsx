/** @jsxImportSource hono/jsx/dom */
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Host, ToolOutcome } from "../host";
import { flush } from "../test-dom";
import { renderWidget } from "./widget";

function fakeHost(onSubscribe: (set: (o: ToolOutcome) => void) => void): Host {
	let outcome: ToolOutcome | undefined;
	return {
		toolResult: () => outcome,
		context: () => ({
			theme: undefined,
			locale: "en-US",
			displayMode: "inline",
			touch: false,
		}),
		subscribe() {
			// the result lands as the widget subscribes, announcing itself to no one
			onSubscribe((o) => {
				outcome = o;
			});
			return () => {};
		},
	} as unknown as Host;
}

describe("renderWidget", () => {
	it("shows a result that arrived between the first render and the subscription", async () => {
		const host = fakeHost((set) =>
			set({ ok: true, data: { name: "Harbor" }, text: "" }),
		);
		document.body.replaceChildren();
		const root = document.createElement("div");
		document.body.append(root);
		renderWidget(
			root,
			host,
			z.object({ name: z.string() }),
			(props) => <p class="name">{props.data.name}</p>,
			"Loading…",
		);
		await flush(10);
		expect(root.querySelector(".name")?.textContent).toBe("Harbor");
	});
});
