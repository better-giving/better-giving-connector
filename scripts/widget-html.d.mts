export const WIDGET_QUERY: "?widget";
export function buildWidget(
	entry: string,
): Promise<{ html: string; inputs: string[] }>;
export function widgetHtml(entry: string): Promise<string>;
export function widgetEntry(specifier: string, importerDir: string): string;
export function moduleSource(html: string): string;
export const CSS_QUERY: "?css";
export const PAGE_FONT_DIR: "/assets/fonts";
export function buildCss(
	entry: string,
): Promise<{ css: string; inputs: string[] }>;
export function cssEntry(specifier: string, importerDir: string): string;
