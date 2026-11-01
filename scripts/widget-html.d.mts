export const WIDGET_QUERY: "?widget";
export function buildWidget(
	entry: string,
): Promise<{ html: string; inputs: string[] }>;
export function widgetHtml(entry: string): Promise<string>;
export function widgetEntry(specifier: string, importerDir: string): string;
export function moduleSource(html: string): string;
