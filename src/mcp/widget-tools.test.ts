import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { WIDGETS } from "../widgets/html";
import { RENDER_TOOLS } from "../widgets/model";
import { ACTIONS } from "./actions";
import { LOCAL_TOOLS } from "./local";
import { WIDGET_MIME, widgetMeta } from "./widget-resources";

const EVERY = [...ACTIONS, ...LOCAL_TOOLS];
const ORIGIN = "https://app.connect.better.giving";

test("each render tool links a widget resource that exists, by both the standard key and ChatGPT's alias", () => {
	for (const { tool } of Object.values(RENDER_TOOLS)) {
		const spec = LOCAL_TOOLS.find((s) => s.tool === tool);
		const ui = spec?._meta.ui as { resourceUri: string } | undefined;
		expect(ui?.resourceUri, tool).toMatch(/^ui:\/\/better-giving\/.+\.html$/);
		expect(spec?._meta["openai/outputTemplate"], tool).toBe(ui?.resourceUri);
		expect(
			Object.values(WIDGETS).map((w) => w.uri),
			tool,
		).toContain(ui?.resourceUri);
	}
});

test("a widget resource is an MCP App with its asset origins, no connect domains and the service's own domain", () => {
	expect(WIDGET_MIME).toBe("text/html;profile=mcp-app");
	expect(widgetMeta(ORIGIN).ui).toMatchObject({
		csp: {
			resourceDomains: [ORIGIN, "https://*.public.blob.vercel-storage.com"],
			connectDomains: [],
		},
		domain: ORIGIN,
	});
	for (const widget of Object.values(WIDGETS))
		expect(widget.html).toContain("<script");
});

test("the tools a widget's buttons call are app-only; the render tools stay visible to the model", () => {
	const visibility = (tool: string) =>
		(
			LOCAL_TOOLS.find((s) => s.tool === tool)?._meta.ui as
				| { visibility?: string[] }
				| undefined
		)?.visibility;
	for (const spec of LOCAL_TOOLS.filter((s) => s.tool.startsWith("app_")))
		expect(visibility(spec.tool), spec.tool).toEqual(["app"]);
	for (const { tool } of Object.values(RENDER_TOOLS))
		expect(visibility(tool), tool).toContain("model");
});

test("every tool names its progress lines within 64 characters", () => {
	for (const spec of EVERY) {
		for (const key of [
			"openai/toolInvocation/invoking",
			"openai/toolInvocation/invoked",
		] as const) {
			const line = spec._meta[key];
			expect(line.length, `${spec.tool} ${key}`).toBeGreaterThan(0);
			expect(line.length, `${spec.tool} ${key}`).toBeLessThanOrEqual(64);
		}
	}
});

test("nothing in the service asks the operator through elicitation", () => {
	for (const file of ["index.ts", "run-tool.ts", "widget-tools.ts"])
		expect(readFileSync(new URL(file, import.meta.url), "utf8")).not.toMatch(
			/elicitInput|elicitation\/create/,
		);
});

test("the photo tool takes its file as a file parameter, and get_profile marks itself the profile", () => {
	const meta = (tool: string) =>
		LOCAL_TOOLS.find((s) => s.tool === tool)?._meta;
	expect(meta("set_campaign_photo")?.["openai/fileParams"]).toEqual(["photo"]);
	expect(meta("get_profile")?.["openai/profile"]).toBe(true);
});
