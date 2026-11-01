import { expect, test } from "vitest";
import { mergeDraft } from "./campaign-drafts";

// Platform serves no content action, so a content page's merge is checked
// here rather than through the tools.

const content = (page: Record<string, unknown>) =>
	({ part: "page", kind: "content", page }) as const;
const blocks = (page: unknown[]) =>
	({ part: "page", kind: "blocks", page }) as const;

test("a content edit merges key by key into a content page, the later value winning", () => {
	const first = mergeDraft(null, content({ story: "One.", hero: "a.jpg" }));
	const second = mergeDraft(first, content({ story: "Two." }));

	expect(second).toEqual({
		settings: null,
		page: { story: "Two.", hero: "a.jpg" },
		pageKind: "content",
	});
});

test("a page of the other kind replaces the draft's page, and the settings stay", () => {
	const stored = mergeDraft(
		mergeDraft(null, { part: "settings", settings: { goal: null } }),
		blocks([{ type: "story", text: "Blocks." }]),
	);

	const asContent = mergeDraft(stored, content({ story: "Content." }));
	const backToBlocks = mergeDraft(asContent, blocks([{ type: "title" }]));

	expect(asContent).toEqual({
		settings: { goal: null },
		page: { story: "Content." },
		pageKind: "content",
	});
	expect(backToBlocks).toEqual({
		settings: { goal: null },
		page: [{ type: "title" }],
		pageKind: "blocks",
	});
});

test("a settings edit leaves the draft's page as it is", () => {
	const stored = mergeDraft(null, content({ story: "Kept." }));

	expect(
		mergeDraft(stored, { part: "settings", settings: { end_date: null } }),
	).toEqual({
		settings: { end_date: null },
		page: { story: "Kept." },
		pageKind: "content",
	});
});
