import { fileURLToPath } from "node:url";
import { moduleSource, WIDGET_QUERY, widgetHtml } from "./widget-html.mjs";

export async function load(url, context, nextLoad) {
	if (!url.endsWith(WIDGET_QUERY)) return nextLoad(url, context);
	const entry = fileURLToPath(url.slice(0, -WIDGET_QUERY.length));
	return {
		format: "module",
		source: moduleSource(await widgetHtml(entry)),
		shortCircuit: true,
	};
}
