// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { startFakeHost } from "../../test/widget-host/fake-host";
import { CAMPAIGNS, type Fixture } from "../../test/widget-host/fixtures";
import { connectHost } from "./host";
import { linkedPair } from "./test-dom";

async function connect(fixture: Fixture, theme: "light" | "dark" = "dark") {
	const [viewSide, hostSide] = linkedPair();
	const fake = await startFakeHost(hostSide, {
		fixture,
		theme,
		locale: "de-DE",
		width: 375,
	});
	const host = await connectHost({ transport: viewSide });
	// the fixture's result lands on a later task than the handshake
	await vi.waitFor(() => expect(host.toolResult()).toBeDefined());
	return { fake, host };
}

describe("fake host", () => {
	it("serves the fixture's result as the render tool's structuredContent", async () => {
		const { host } = await connect({
			result: { structuredContent: CAMPAIGNS },
			toolInput: { limit: 5 },
		});
		expect(host.toolInput()).toEqual({ limit: 5 });
		expect(host.toolResult()).toEqual({
			ok: true,
			data: CAMPAIGNS,
			text: "",
		});
	});

	it("serves a failing render tool as its sentence", async () => {
		const { host } = await connect({ result: { error: "Reconnect." } });
		expect(host.toolResult()).toEqual({ ok: false, error: "Reconnect." });
	});

	it("sets the theme, locale and a phone's touch context", async () => {
		const { host } = await connect({ result: { error: "x" } });
		expect(host.context()).toEqual({
			theme: "dark",
			locale: "de-DE",
			displayMode: "inline",
			touch: true,
		});
	});

	it("answers tool calls from the fixture's script, and records them", async () => {
		const { fake, host } = await connect({
			result: { error: "x" },
			calls: {
				publish_campaign_app: (args) => ({
					structuredContent: { published: args.id },
					text: "Published.",
				}),
			},
		});
		expect(await host.callTool("publish_campaign_app", { id: "c-1" })).toEqual({
			ok: true,
			data: { published: "c-1" },
			text: "Published.",
		});
		expect(await host.callTool("end_campaign_app", {})).toEqual({
			ok: false,
			error: "The fake host has no scripted answer for end_campaign_app.",
		});
		expect(fake.log.calls).toEqual([
			{ name: "publish_campaign_app", args: { id: "c-1" } },
			{ name: "end_campaign_app", args: {} },
		]);
	});

	it("records follow-up messages and links, and grants fullscreen", async () => {
		const { fake, host } = await connect({ result: { error: "x" } });
		await host.sendFollowUp("Show the results.");
		await host.openLink("https://give.example.org/x");
		expect(await host.requestFullscreen()).toBe("fullscreen");
		await vi.waitFor(() =>
			expect(host.context().displayMode).toBe("fullscreen"),
		);
		expect(fake.log.messages).toEqual(["Show the results."]);
		expect(fake.log.links).toEqual(["https://give.example.org/x"]);
	});
});
