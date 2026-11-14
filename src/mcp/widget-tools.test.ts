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

test("a widget resource is an MCP App with its asset origins, no connect domains and the domain it is given", () => {
	expect(WIDGET_MIME).toBe("text/html;profile=mcp-app");
	expect(widgetMeta(ORIGIN, ORIGIN).ui).toMatchObject({
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

test("the photo tools take the file as ChatGPT sends it, with its type and name", () => {
	const chatgptFile = {
		download_url: "https://files.example/photo.png",
		file_id: "file_1",
		mime_type: "image/png",
		file_name: "photo.png",
	};
	for (const tool of ["set_campaign_photo", "show_photo"]) {
		const spec = LOCAL_TOOLS.find((s) => s.tool === tool);
		if (!spec) throw new Error(`no ${tool} spec`);
		expect(
			spec.input.safeParse({ campaign_id: "cmp_1", photo: chatgptFile })
				.success,
			tool,
		).toBe(true);
		const photo = (
			spec.input.toJSONSchema({ io: "input" }) as {
				properties: Record<string, unknown>;
			}
		).properties.photo;
		expect(photo, tool).toMatchObject({
			properties: {
				download_url: { type: "string" },
				file_id: { type: "string" },
				mime_type: { type: "string" },
				file_name: { type: "string" },
			},
			required: ["download_url", "file_id"],
		});
	}
});

test("the campaigns summary totals each currency on its own, never adding one to another", () => {
	const summary = LOCAL_TOOLS.find((s) => s.tool === "show_campaigns")?.output
		.summary;
	const card = (status: string, amount: string, currency: string) => ({
		status,
		raised: { amount, currency },
	});
	const cx = { locale: "en-US", input: {}, replayed: false };

	expect(
		summary?.(
			{
				campaigns: [
					card("published", "1000.00", "USD"),
					card("ended", "250.50", "USD"),
					card("published", "300.00", "EUR"),
				],
			},
			cx,
		),
	).toBe("3 campaigns, 2 live, $1,250.50 and €300.00 raised");
	expect(
		summary?.(
			{
				campaigns: [card("draft", "0.00", "GBP"), card("ended", "5.25", "GBP")],
			},
			cx,
		),
	).toBe("2 campaigns, 0 live, £5.25 raised");
});
