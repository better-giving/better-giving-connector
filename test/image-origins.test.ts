// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { imageOrigins } from "../src/mcp/widget-data";
import { isAllowedImage } from "../src/widgets/ui/image";

const PUBLIC_ORIGIN = "https://app.connect.better.giving";

// The server's list and the widget's matcher live on either side of a lint
// wall, so only a test can hold them to each other.
test("a logo on any host the server lists is one the widget draws, and a host it doesn't list is not", () => {
	const origins = imageOrigins({ publicOrigin: PUBLIC_ORIGIN });

	for (const url of [
		`${PUBLIC_ORIGIN}/assets/logo.png`,
		"https://abc123.public.blob.vercel-storage.com/logo.png",
		"https://endow-profiles.s3.amazonaws.com/logos/a.png",
		"https://res.cloudinary.com/demo/image/upload/a.jpg",
	])
		expect(isAllowedImage(url, origins), url).toBe(true);

	for (const url of [
		"https://example.com/logo.png",
		"https://other-bucket.s3.amazonaws.com/a.png",
	])
		expect(isAllowedImage(url, origins), url).toBe(false);
});
