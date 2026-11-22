// Serves every widget state in the fake MCP Apps host, light and dark, 1440 and
// 375, in a browser. A fixture page for review and Sky previews; nothing in the
// built service serves it. Not part of `pnpm test` or CI.
//
//   pnpm preview:widgets            http://localhost:4173 (PORT overrides)
//
// Paths: / lists every state; /<widget>/<state>?theme=light|dark&width=1440|375
// shows one (see test/widget-host/preview.ts).

import { serve } from "@hono/node-server";
import "./binary-register.mjs";

// after the loader hooks register: html.ts imports each widget as `?widget`
const { WIDGETS } = await import("../src/widgets/html");
const { previewApp } = await import("../test/widget-host/preview");

const port = Number(process.env.PORT ?? 4173);
serve({ fetch: previewApp(WIDGETS).fetch, port, hostname: "0.0.0.0" }, () => {
	process.stdout.write(`widget preview on http://localhost:${port}\n`);
});
