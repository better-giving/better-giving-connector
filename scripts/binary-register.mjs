import { register } from "node:module";

// tsx has no binary loader. A video, image or font import is the file's
// bytes, the same shape esbuild's binary loader and the vitest plugin produce.
register("./binary-hook.mjs", import.meta.url);
