import { Hono } from "hono";
import displayBold from "../widgets/registry/styles/fonts/RedHatRoundDisplay-Bold.woff2";
import displaySemiBold from "../widgets/registry/styles/fonts/RedHatRoundDisplay-SemiBold.woff2";
import monoRegular from "../widgets/registry/styles/fonts/RedHatRoundMono-Regular.woff2";
import textBold from "../widgets/registry/styles/fonts/RedHatRoundText-Bold.woff2";
import textMedium from "../widgets/registry/styles/fonts/RedHatRoundText-Medium.woff2";
import textRegular from "../widgets/registry/styles/fonts/RedHatRoundText-Regular.woff2";
import textSemiBold from "../widgets/registry/styles/fonts/RedHatRoundText-SemiBold.woff2";

// Where a page's stylesheet finds its faces (PAGE_FONT_DIR in
// scripts/widget-html.mjs, which writes these urls into it).
export const FONT_DIR = "/assets/fonts";

const FONTS = {
	"RedHatRoundText-Regular.woff2": textRegular,
	"RedHatRoundText-Medium.woff2": textMedium,
	"RedHatRoundText-SemiBold.woff2": textSemiBold,
	"RedHatRoundText-Bold.woff2": textBold,
	"RedHatRoundDisplay-SemiBold.woff2": displaySemiBold,
	"RedHatRoundDisplay-Bold.woff2": displayBold,
	"RedHatRoundMono-Regular.woff2": monoRegular,
} satisfies Record<string, Uint8Array<ArrayBuffer>>;

type FontFile = keyof typeof FONTS;

const isFontFile = (file: string): file is FontFile =>
	Object.hasOwn(FONTS, file);

const preload = (...files: FontFile[]) =>
	files.map((file) => `${FONT_DIR}/${file}`);

/** The site's faces above the fold: body text, the nav links (`nav a`, 600) and the heading. */
export const SITE_PRELOAD = preload(
	"RedHatRoundText-Regular.woff2",
	"RedHatRoundText-SemiBold.woff2",
	"RedHatRoundDisplay-Bold.woff2",
);

/** The connect card's faces: body text, the heading and the button (`.btn`, 700). */
export const CONNECT_PRELOAD = preload(
	"RedHatRoundText-Regular.woff2",
	"RedHatRoundDisplay-Bold.woff2",
	"RedHatRoundText-Bold.woff2",
);

/** Every face a page's stylesheet names, served from this origin. */
export function fontRoutes(): Hono {
	const app = new Hono();
	app.get(`${FONT_DIR}/:file`, (c) => {
		const file = c.req.param("file");
		if (!isFontFile(file)) return c.notFound();
		return c.body(FONTS[file], 200, {
			"content-type": "font/woff2",
			"x-content-type-options": "nosniff",
			"cache-control": "public, max-age=3600",
		});
	});
	return app;
}
