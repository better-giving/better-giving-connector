import { fileURLToPath } from "node:url";
import {
	buildCss,
	CSS_QUERY,
	moduleSource,
	WIDGET_QUERY,
	widgetHtml,
} from "./widget-html.mjs";

export async function load(url, context, nextLoad) {
	if (url.endsWith(CSS_QUERY)) {
		const entry = fileURLToPath(url.slice(0, -CSS_QUERY.length));
		return {
			format: "module",
			source: moduleSource((await buildCss(entry)).css),
			shortCircuit: true,
		};
	}
	if (!url.endsWith(WIDGET_QUERY)) return nextLoad(url, context);
	const entry = fileURLToPath(url.slice(0, -WIDGET_QUERY.length));
	return {
		format: "module",
		source: moduleSource(await widgetHtml(entry)),
		shortCircuit: true,
	};
}
