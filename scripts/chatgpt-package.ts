import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// ChatGPT app package (plugin.json + mcp.json + assets/ + the get-started skill).
// Every entry stays byte-identical to the submitted package;
// test/chatgpt-package.test.ts pins their hashes.
// Category and publication countries are the recommended listing values.
// The demo recording is the walkthrough served at /demo.mp4.
// homepage and websiteURL are https://better.giving, which resolves to the
// public site.
// brandColor is the brand blue from AngelProtocolFinance/better-giving
// packages/brand (design-system.md and colors.ts `primary`): #1E6DAB, the
// Radix accent `accent-light=1E6DAB`, `--blue-9` / `--primary`.
// The icon and logo are the files in assets/chatgpt/; the logo is the
// official one served at https://better.giving/logo.png.
// Auth is OAuth dynamic client registration.
// The Agent Plugins mcp schema does not list `extensions`, and OpenAI's
// submission guide puts DCR on the server anyway.

const ORIGIN = "https://app.connect.better.giving";

/**
 * Better Giving brand blue. `#1E6DAB` is `--primary` / `--blue-9` in
 * AngelProtocolFinance/better-giving `packages/brand/src/colors.ts`, the hex
 * twin of the light palette. `packages/brand/design-system.md` names it the
 * brand blue and the unmodified step-9 input
 * `accent-light=1E6DAB` on the Radix custom palette.
 * Contrast against white is about 5.48:1, above the directory's 2:1 floor.
 */
export const BRAND_COLOR = "#1E6DAB";

/** Contact address on the directory listing. */
export const AUTHOR_EMAIL = "hi@better.giving";

/**
 * Recommended listing values included in the package. Finance would read as
 * if the connector moves money. An empty countries array is no country allowlist.
 */
export const LISTING = {
	category: "Business & Operations",
	countries: [] as readonly string[],
} as const;

const DEMO_RECORDING_URL = `${ORIGIN}/demo.mp4`;

const LONG_DESCRIPTION = [
	"Connect ChatGPT to your nonprofit's Better Giving account.",
	"Read campaigns, the donation page, donation forms, donors, gifts, monthly gifts and fundraising totals.",
	"Create and edit draft campaigns and donation forms, and publish or end a campaign once you confirm.",
	"The connector moves no money: it cannot charge a card, refund a gift, change a monthly gift or pay out funds.",
	"It acts only on the one account you sign in with.",
].join(" ");

const RELEASE_NOTES =
	"Initial release. Better Giving for nonprofit operators: read campaigns, donation page, forms, donors, gifts, monthly gifts and fundraising totals; create and edit draft campaigns and forms; publish or end a campaign after confirmation. No money movement.";

const ONBOARDING_SKILL_PATH = "skills/get-started/SKILL.md";

/** The onboarding skill ChatGPT runs right after install. */
const ONBOARDING_SKILL = [
	"---",
	"name: get-started",
	"description: Help a nonprofit operator connect their Better Giving account and try the first tasks, such as listing campaigns, checking fundraising results and creating a draft campaign.",
	"---",
	"",
	"# Get started with Better Giving",
	"",
	"Use this when someone has just installed Better Giving or asks what it can do.",
	"",
	"1. If the Better Giving tools are not connected yet, ask the user to connect and sign in with their Better Giving account.",
	"2. Call `list_campaigns` and show their campaigns with status and public link.",
	"3. Offer next steps: check results with `get_results`, look up donors with `list_donors`, or create a draft campaign with `create_campaign`.",
	"",
	"Rules:",
	"- The connector moves no money. It cannot charge a card, refund a gift, change a monthly gift or pay out funds. Say so if asked.",
	"- Act only on the connected account.",
	"- Before `publish_campaign` or `end_campaign`, ask where the gifts go and wait for an explicit yes.",
	"",
].join("\n");

export function pluginManifest() {
	return {
		$schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
		name: "better-giving",
		version: "1.0.0",
		description:
			"Manage a Better Giving account: campaigns, forms, the donation page, donations and donors. Moves no money.",
		author: {
			name: "Better Giving",
			email: AUTHOR_EMAIL,
			url: "https://better.giving",
		},
		homepage: "https://better.giving",
		license: "MIT",
		repository: "https://github.com/better-giving/better-giving-connector",
		keywords: ["nonprofit", "donations", "fundraising"],
		extensions: {
			"com.openai": {
				interface: {
					displayName: "Better Giving",
					shortDescription: "Run your donation site",
					longDescription: LONG_DESCRIPTION,
					developerName: "Better Giving",
					capabilities: [
						"Manage campaigns",
						"Manage donation forms",
						"Review donations and donors",
						"See fundraising results",
					],
					websiteURL: "https://better.giving",
					brandColor: BRAND_COLOR,
					category: LISTING.category,
					supportURL: `${ORIGIN}/support`,
					privacyPolicyURL: `${ORIGIN}/privacy`,
					termsOfServiceURL: `${ORIGIN}/terms`,
					defaultPrompt: [
						"List my published campaigns.",
						"How much did we raise this month?",
						"Create a draft campaign for our winter appeal.",
					],
					composerIcon: "./assets/icon.png",
					logo: "./assets/logo.png",
				},
				review: {
					demo_recording_url: DEMO_RECORDING_URL,
					test_cases: {
						positive: [
							{
								description: "List published campaigns",
								prompt: "List my published campaigns.",
								tools_triggered: "list_campaigns",
								expected_behavior:
									"Returns the connected site's campaigns, each with a status and a public link.",
							},
							{
								description: "Campaign results this month",
								prompt: "How much has the Winter Appeal raised this month?",
								tools_triggered: "list_campaigns, get_results",
								expected_behavior:
									"Finds the campaign and returns the total raised, gift count and donor count for the date range.",
							},
							{
								description: "Top donors and one donor's gifts",
								prompt:
									"Who are our top donors and what has the top one given?",
								tools_triggered: "list_donors, get_donor",
								expected_behavior:
									"Lists donors with their totals, then shows the top donor's gifts.",
							},
							{
								description: "Create a draft campaign",
								prompt: "Create a draft campaign called Spring Food Drive.",
								tools_triggered: "create_campaign",
								expected_behavior:
									"Creates a draft campaign with an id and link. Donors cannot see it until it is published.",
							},
							{
								description: "Set goal and end date",
								prompt:
									"Set the Spring Food Drive goal to $5,000 and end date Dec 31.",
								tools_triggered:
									"list_campaigns, get_campaign, update_campaign_settings",
								expected_behavior:
									"Updates only the goal and end date, with the version checked.",
							},
						],
						negative: [
							{
								description: "No refunds",
								prompt: "Refund Jane Doe's last donation.",
								expected_behavior:
									"Makes no change, or reads only. Explains that the connector cannot move money or refund a gift.",
							},
							{
								description: "Not a donor tool",
								prompt: "Donate $20 to a food bank for me.",
								expected_behavior:
									"Calls no Better Giving tool. Explains that the connector manages a nonprofit's own account and does not make donations.",
							},
							{
								description: "Publish waits for confirmation",
								prompt: "Publish the Spring Food Drive campaign.",
								expected_behavior:
									"Does not call publish_campaign until it asks where the gifts go and the user gives an explicit yes.",
							},
						],
					},
					commerce: false,
					commerce_description:
						"Does not sell goods, process payments, or move money.",
				},
				publication: {
					countries: LISTING.countries,
					release_notes: RELEASE_NOTES,
				},
				onboardingSkill: `./${ONBOARDING_SKILL_PATH}`,
			},
		},
	};
}

export function mcpManifest() {
	return {
		$schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
		mcpServers: {
			"better-giving": {
				type: "streamable-http",
				url: `${ORIGIN}/mcp`,
				extensions: {
					"com.openai": {
						auth: {
							type: "oauth",
							client: { mode: "dcr" },
						},
					},
				},
			},
		},
	};
}

const json = (value: unknown) =>
	Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

const asset = (file: string) =>
	readFileSync(new URL(`../assets/chatgpt/${file}`, import.meta.url));

export function packageEntries(): { name: string; data: Buffer }[] {
	return [
		{ name: "plugin.json", data: json(pluginManifest()) },
		{ name: "mcp.json", data: json(mcpManifest()) },
		{ name: "assets/icon.png", data: asset("icon.png") },
		{ name: "assets/logo.png", data: asset("logo.png") },
		{ name: ONBOARDING_SKILL_PATH, data: Buffer.from(ONBOARDING_SKILL) },
	];
}

// Fixed so two builds of the same bytes are the same zip. 2026-10-15.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 15;

export function zipStore(entries: { name: string; data: Buffer }[]): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name);
		const crc = crc32(entry.data);
		const local = Buffer.alloc(30 + name.length);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt16LE(DOS_TIME, 10);
		local.writeUInt16LE(DOS_DATE, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(entry.data.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		name.copy(local, 30);
		locals.push(local, entry.data);

		const central = Buffer.alloc(46 + name.length);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt16LE(DOS_TIME, 12);
		central.writeUInt16LE(DOS_DATE, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(entry.data.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		name.copy(central, 46);
		centrals.push(central);
		offset += local.length + entry.data.length;
	}
	const centralDir = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(entries.length, 8);
	eocd.writeUInt16LE(entries.length, 10);
	eocd.writeUInt32LE(centralDir.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...locals, centralDir, eocd]);
}

export function zipEntries(archive: Buffer): Map<string, Buffer> {
	const eocd = archive.length - 22;
	if (archive.readUInt32LE(eocd) !== 0x06054b50) {
		throw new Error("zip is missing its end record");
	}
	const count = archive.readUInt16LE(eocd + 8);
	let cursor = archive.readUInt32LE(eocd + 16);
	const out = new Map<string, Buffer>();
	for (let i = 0; i < count; i++) {
		if (archive.readUInt32LE(cursor) !== 0x02014b50) {
			throw new Error("zip central directory is truncated");
		}
		const size = archive.readUInt32LE(cursor + 20);
		const nameLen = archive.readUInt16LE(cursor + 28);
		const extraLen = archive.readUInt16LE(cursor + 30);
		const commentLen = archive.readUInt16LE(cursor + 32);
		const localAt = archive.readUInt32LE(cursor + 42);
		const name = archive
			.subarray(cursor + 46, cursor + 46 + nameLen)
			.toString();
		const localNameLen = archive.readUInt16LE(localAt + 26);
		const localExtraLen = archive.readUInt16LE(localAt + 28);
		const dataAt = localAt + 30 + localNameLen + localExtraLen;
		out.set(name, archive.subarray(dataAt, dataAt + size));
		cursor += 46 + nameLen + extraLen + commentLen;
	}
	return out;
}

export function buildChatgptPackage(outPath: string): void {
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, zipStore(packageEntries()));
}

function crc32(data: Buffer): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc ^= data[i] ?? 0;
		for (let bit = 0; bit < 8; bit++) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
	const out = process.argv[2] ?? "dist/better-giving-chatgpt.zip";
	buildChatgptPackage(out);
	process.stdout.write(`${out}\n`);
}
