// Reading a served page's parts: its one <style>, its prose without it, and
// the full preload tags.

export const styleOf = (html: string) =>
	html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";

/** The page without its stylesheet, for checks on what a reader sees. */
export const stripStyle = (html: string) =>
	html.replace(/<style>[\s\S]*?<\/style>/, "");

export type Preload = {
	href: string;
	as: string;
	type: string;
	crossorigin: boolean;
};

/** Each `<link rel="preload">` as the browser reads it. */
export const preloads = (html: string): Preload[] =>
	[...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map(([tag]) => ({
		href: tag.match(/\bhref="([^"]*)"/)?.[1] ?? "",
		as: tag.match(/\bas="([^"]*)"/)?.[1] ?? "",
		type: tag.match(/\btype="([^"]*)"/)?.[1] ?? "",
		crossorigin: /\bcrossorigin(=|\s|\/|>)/.test(tag),
	}));

/** A stylesheet that asks nothing of another origin: no absolute or protocol-relative url, no @import. */
export const reachesOutside = (css: string) =>
	css.match(/https?:|url\(\s*["']?\/\/|@import/i)?.[0];
