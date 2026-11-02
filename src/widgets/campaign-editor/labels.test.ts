import { describe, expect, it } from "vitest";
import { blockLabel, humanize, plainText } from "./labels";

describe("editor labels", () => {
	it("names the catalog's blocks as the design does", () => {
		expect(blockLabel("hero")).toBe("Hero photo");
		expect(blockLabel("donation_form")).toBe("Donation form");
		expect(blockLabel("faq")).toBe("FAQ");
	});

	it("falls back to a readable form of an unknown type", () => {
		expect(blockLabel("impact_numbers")).toBe("Impact numbers");
		expect(humanize("heroImageUrl")).toBe("Hero image url");
	});

	it("reads a rich-text document as paragraphs", () => {
		const doc = {
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{ type: "text", text: "One " },
						{ type: "text", text: "two." },
					],
				},
				{ type: "paragraph", content: [{ type: "text", text: "Three." }] },
			],
		};
		expect(plainText(doc)).toBe("One two.\n\nThree.");
	});
});
