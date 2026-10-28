import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	buildChatgptPackage,
	LISTING,
	mcpManifest,
	packageEntries,
	pluginManifest,
	zipEntries,
	zipStore,
} from "../scripts/chatgpt-package";
import { actionsFor } from "../src/mcp/actions";

/** WCAG relative-luminance contrast of a #RRGGBB color against white. */
function contrastAgainstWhite(hex: string): number {
	const channels = [0, 2, 4].map((at) => {
		const channel = Number.parseInt(hex.slice(at + 1, at + 3), 16) / 255;
		return channel <= 0.04045
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
	const red = channels[0] ?? 0;
	const green = channels[1] ?? 0;
	const blue = channels[2] ?? 0;
	const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
	return 1.05 / (luminance + 0.05);
}

// sha256 of each entry in the submitted ChatGPT package.
// A deliberate package change updates these.
const CURATED_SHA256: Record<string, string> = {
	"plugin.json":
		"901cf0b46b13695279dd0868e8f99de0ac5730d775e411b8b4c53204491e7a1e",
	"mcp.json":
		"358381dab7af77a6735d4337b26d2ada12800295c97e6d1fea0d66f618721f30",
	"assets/icon.png":
		"dbcb899331bc2b64e733cb9fe244d206a779382a0f5a083242399b3d5eb76b76",
	"assets/logo.png":
		"866ff337a58861cd687c121d64ffde2dafce5094689177d6097652b8ed409aa8",
	"skills/get-started/SKILL.md":
		"94e01531ca76156dddd84667f1b11043170f7eeb8ead0d49255fc6dda27359f8",
};

const sha256 = (data: Buffer) =>
	createHash("sha256").update(data).digest("hex");

const PNG_SIGNATURE = "89504e470d0a1a0a";

const registeredTools = new Set(actionsFor(true).map((spec) => spec.tool));

const manifest = pluginManifest();
const iface = manifest.extensions["com.openai"].interface;
const review = manifest.extensions["com.openai"].review;

test("plugin.json matches the packet's listing and the recommended listing values", () => {
	expect(manifest.name).toBe("better-giving");
	expect(manifest.version).toBe("1.0.0");
	expect(iface.displayName.length).toBeLessThanOrEqual(30);
	expect(iface.shortDescription.length).toBeLessThanOrEqual(30);
	expect(iface.longDescription.length).toBeLessThanOrEqual(4000);
	expect(iface.longDescription).toMatch(/moves no money/i);
	expect(iface.longDescription).toMatch(/cannot charge a card, refund a gift/);
	expect(iface.longDescription).toContain("only on the one account");
	expect(manifest.description).not.toMatch(
		/self-hosted|Claude|ChatGPT|bank transfer/i,
	);
	expect(iface.longDescription).not.toMatch(
		/self-hosted|Claude|bank transfer/i,
	);
	expect(iface.defaultPrompt).toHaveLength(3);
	for (const prompt of iface.defaultPrompt) {
		expect(prompt.length).toBeLessThanOrEqual(128);
	}
	expect(iface.privacyPolicyURL).toBe(
		"https://app.connect.better.giving/privacy",
	);
	expect(iface.termsOfServiceURL).toBe(
		"https://app.connect.better.giving/terms",
	);
	expect(iface.supportURL).toBe("https://app.connect.better.giving/support");
	expect(iface.logo).toBe("./assets/logo.png");
	expect(iface.composerIcon).toBe("./assets/icon.png");
	expect(review.commerce).toBe(false);
	expect(review.test_cases.positive).toHaveLength(5);
	expect(review.test_cases.negative).toHaveLength(3);
	expect(review.commerce_description).toMatch(/move money/);
	expect(JSON.stringify(pluginManifest())).not.toMatch(
		/record_donation|cash or by check|offline/i,
	);
	expect(manifest.license).toBe("MIT");
	expect(manifest.homepage).toBe("https://better.giving");
	expect(iface.websiteURL).toBe("https://better.giving");
	expect(manifest.author).toMatchObject({
		name: "Better Giving",
		email: "hi@better.giving",
		url: "https://better.giving",
	});
	expect(iface.brandColor).toBe("#1E6DAB");
	expect(contrastAgainstWhite(iface.brandColor)).toBeGreaterThanOrEqual(2);
	expect(iface.category).toBe("Business & Operations");
	expect(review.demo_recording_url).toBe(
		"https://app.connect.better.giving/demo.mp4",
	);
	expect(LISTING).toEqual({
		category: "Business & Operations",
		countries: [],
	});
	expect(iface.category).toBe(LISTING.category);
	expect(manifest.extensions["com.openai"].publication.countries).toEqual([]);
});

test("release notes are present and promise no money movement", () => {
	const notes = manifest.extensions["com.openai"].publication.release_notes;
	expect(notes.trim()).not.toBe("");
	expect(notes).toMatch(/no money movement/i);
});

test("every tool the review cases and the onboarding skill name is registered", () => {
	const cases = review.test_cases.positive;
	const triggered = cases.flatMap((c) => c.tools_triggered.split(", "));
	expect(triggered.length).toBeGreaterThanOrEqual(cases.length);
	const skill = packageEntries()
		.find((e) => e.name === "skills/get-started/SKILL.md")
		?.data.toString();
	const mentioned = [...(skill ?? "").matchAll(/`([a-z_]+)`/g)].map(
		(m) => m[1],
	);
	expect(mentioned.length).toBeGreaterThan(0);
	for (const tool of [...triggered, ...mentioned]) {
		expect(registeredTools, `"${tool}" is not a registered tool`).toContain(
			tool,
		);
	}
});

test("mcp.json points at the production server and declares DCR with no secret", () => {
	const mcp = mcpManifest();
	const server = mcp.mcpServers["better-giving"];

	expect(server).toMatchObject({
		type: "streamable-http",
		url: "https://app.connect.better.giving/mcp",
	});
	expect(server.extensions["com.openai"].auth).toEqual({
		type: "oauth",
		client: { mode: "dcr" },
	});
	expect(JSON.stringify(mcp)).not.toMatch(/secret/i);
});

test("the zip holds exactly the curated package's entries, byte for byte", () => {
	const archive = zipStore(packageEntries());
	const entries = zipEntries(archive);

	expect([...entries.keys()]).toEqual(Object.keys(CURATED_SHA256));
	for (const [name, expected] of Object.entries(CURATED_SHA256)) {
		const data = entries.get(name);
		expect(data, `${name} is in the zip`).toBeDefined();
		expect(sha256(data as Buffer), `sha256 of ${name}`).toBe(expected);
	}
	expect(archive.includes(Buffer.from("://connect.better.giving"))).toBe(false);
	expect(
		archive.includes(Buffer.from("https://app.connect.better.giving")),
	).toBe(true);
});

test.each([
	["icon.png", 512],
	["logo.png", 2048],
])("%s is a square PNG of the expected size", (name, size) => {
	const png = readFileSync(
		new URL(`../assets/chatgpt/${name}`, import.meta.url),
	);
	expect(png.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
	expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(
		{
			width: size,
			height: size,
		},
	);
});

test("plugin.json's onboarding skill is a zip entry with get-started frontmatter", () => {
	const entries = zipEntries(zipStore(packageEntries()));
	const packed = JSON.parse(String(entries.get("plugin.json"))) as {
		name: string;
		extensions: { "com.openai": { onboardingSkill: string } };
	};
	expect(packed.name).toBe("better-giving");
	const skillPath = packed.extensions["com.openai"].onboardingSkill.replace(
		/^\.\//,
		"",
	);
	expect(entries.has(skillPath), `${skillPath} is in the zip`).toBe(true);
	const skill = String(entries.get(skillPath));
	expect(skill).toMatch(/^---\nname: get-started\ndescription: .+\n---\n/);
	expect(skill).toContain("moves no money");
});

test("buildChatgptPackage writes that zip, the same bytes on every build", () => {
	const dir = mkdtempSync(join(tmpdir(), "chatgpt-package-"));
	try {
		const first = join(dir, "first.zip");
		const second = join(dir, "second.zip");
		buildChatgptPackage(first);
		buildChatgptPackage(second);
		const written = readFileSync(first);
		expect(sha256(written)).toBe(sha256(zipStore(packageEntries())));
		expect(sha256(readFileSync(second))).toBe(sha256(written));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
