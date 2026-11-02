// What the editor calls things: block labels, field labels and the plain text
// of a rich-text document. Pure.

const BLOCK_LABELS: Record<string, string> = {
	hero: "Hero photo",
	title: "Title & story",
	story: "Title & story",
	title_story: "Title & story",
	goal: "Goal bar",
	progress: "Goal bar",
	donate: "Donation form",
	donation_form: "Donation form",
	form: "Donation form",
	faq: "FAQ",
};

/** The block types "Add block" offers: one of each kind the page is made of. */
export const ADDABLE_BLOCKS: readonly { type: string; label: string }[] = [
	{ type: "hero", label: "Hero photo" },
	{ type: "story", label: "Title & story" },
	{ type: "goal", label: "Goal bar" },
	{ type: "donate", label: "Donation form" },
	{ type: "faq", label: "FAQ" },
];

/** "hero_image" → "Hero image". */
export function humanize(key: string): string {
	const spaced = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function blockLabel(type: string): string {
	return BLOCK_LABELS[type.toLowerCase()] ?? humanize(type);
}

/** The text of a rich-text document (ProseMirror-shaped), paragraphs separated by a blank line. */
export function plainText(node: unknown): string {
	const paragraphs: string[] = [];
	const walk = (n: unknown): string => {
		if (typeof n !== "object" || n === null) return "";
		const rec = n as { text?: unknown; content?: unknown; type?: unknown };
		if (typeof rec.text === "string") return rec.text;
		const inner = Array.isArray(rec.content) ? rec.content.map(walk) : [];
		const isBlock = rec.type !== undefined && rec.type !== "doc";
		if (isBlock && Array.isArray(rec.content) && rec.content.every((c) => (c as { text?: unknown }).text !== undefined)) {
			paragraphs.push(inner.join(""));
			return "";
		}
		return inner.join("");
	};
	const rest = walk(node);
	if (rest) paragraphs.push(rest);
	return paragraphs.filter((p) => p.length > 0).join("\n\n");
}

/** The first https URL-looking string among a block's fields. */
export function firstImageUrl(block: Record<string, unknown>): string | null {
	for (const value of Object.values(block)) {
		if (typeof value === "string" && /^https:\/\//.test(value)) return value;
	}
	return null;
}
