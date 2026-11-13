## Design system

- Components and tokens come from the Better Giving design registry (better-giving/design-system, served at https://design.better.giving/registry) through the `bg-design` CLI. `bg-design.json` at the repo root lists every copied item and its folder; those copied files are this repo's design system. Take values from them and never invent a token, color or variant.
- The doop canvas `_gTDOwL8my` (https://doop-justin.fly.dev/c/_gTDOwL8my) and its guidelines doc `better-giving-design-system` are a picture of the registry. When they disagree, the registry wins.
- A part the registry lacks is a registry gap for the design-system PM, not something to draw or build ad hoc.
- Contrast: the registry uses the official Radix 12-step scale and keeps each step's role (6–8 borders, with the focus ring on step 8 of Radix's focus-ring steps 7–8; 9–10 solid fills; 11–12 text), and judges contrast in APCA (Lc). Don't move a step, add a color or override a token to reach a WCAG contrast ratio, and decline review findings that ask for one. This covers text, non-text and focus indicators alike: never use or cite WCAG contrast ratios, including WCAG 1.4.3, 1.4.11 and 2.4.13. Report an APCA miss to this repo's PM, who files it as a registry gap for the design-system PM.

@../AGENTS.md

<!-- kru v0.194.0 · derived 2026-11-13 · `skills/setup/SKILL.md` to re-derive -->
## Team

Load **`kru:lead`** before building, reviewing, or dispatching a seat — it carries how the
team works.

One package at the repo root; seats and versions are read from `package.json`:

- **api** → `kru:hono-builder` — `src/app.ts`, `src/cron.ts`, `src/index.ts`, `src/dev.ts`, `src/env.ts`, `src/log.ts`, `src/secret.ts`, `src/format.ts` and the `.test.ts` files beside them, `src/presets/`, the route modules `src/connect/index.tsx` (signed cookies, `csrf`, the login exchange) and `src/site/index.tsx` (the public pages' routes, the icon and demo routes, the OpenAI apps challenge) with the files those routes serve, `src/site/icon.ts` and `src/site/demo.mp4`, `src/mcp/`, `src/deployment/` and the `test/` harness and integration tests (every file directly in `test/`, and `test/live/`) ← hono 4.13.13, `@modelcontextprotocol/server` 2.2.0
- **auth** → `kru:better-auth-specialist` — `src/auth/` ← better-auth 1.7.7
- **data** → `kru:turso-specialist` — `src/db/` and `migrations/` ← `@libsql/client` 0.18.0, kysely 0.29.6
- **platform** → `kru:vercel-platform-engineer` — `vercel.json`, `scripts/vercel-ignore-build.sh`, `.env.example`, `.gitignore`, `.gitattributes`, `.github/workflows/` (`ci.yml`, `bg-design-update.yml`), env and secrets (the key-encryption secret among them), the `app.connect.better.giving` domain ← `vercel.json`, AGENTS.md
- **tooling** → `kru:toolchain-engineer` — `package.json` scripts, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.nvmrc`, `biome.json`, `lint/`, `tsconfig.json`, `tsconfig.widgets.json`, `vitest.config.ts`, `vitest.live.config.ts`, the build and loader scripts in `scripts/` (`build.ts`, `widget-html.mjs`, `widget-hook.mjs`, `binary-hook.mjs`, `binary-register.mjs`, `design-check.sh`) and their type declarations (`scripts/widget-html.d.mts`, `src/widgets.d.ts`, `src/binary.d.ts`) ← biome 2.5.15, typescript 7.0.2, pnpm 12.4.2, node 24 (`.nvmrc`), esbuild 0.28.2
- **ui** → `kru:hono-ui-builder` — `src/widgets/`, `bg-design.json`, `test/widget-host/`, `test/fixtures/widget/`, `scripts/widget-shots.ts`, `scripts/surface-shots.ts`, and the server-rendered pages: `src/connect/page.tsx`, `src/connect/connect.css`, `src/connect/assets/`, `src/pages/` and everything in `src/site/` but `index.tsx`, `icon.ts` and `demo.mp4` ← `hono` 4.13.13 in `package.json`, `jsxImportSource` `hono/jsx` (`tsconfig.json`) and `hono/jsx/dom` (`tsconfig.widgets.json`)
- **package** → `kru:node-developer` — `scripts/chatgpt-package.ts` and `assets/chatgpt/`: the ChatGPT app package `pnpm chatgpt:package` writes ← `package.json` scripts
- **cursor** → no kru seat, on purpose. `.cursor/` holds the cloud-agent environment and the `verify-better-giving-connector` skill's scripts (`drive.ts`, `fake-server.ts`, launch scripts); the routing table has no lane for it.
- **cloud** → `.claude/cloud-setup.md` and `.claude/cloud-install.sh` are `skills/setup/SKILL.md`'s output: re-derive them with this sheet ← the SessionStart hook in `.claude/settings.json`
- **no seat** → `AGENTS.md` and `LICENSE`
- **skills** → `kru:vitest`, `kru:zod` — vitest 5.0.3, zod 4.6.5
- **screens** → the site and connect pages and the widgets are UI; they take the registry (`## Design system` above)
- **verify** → `.claude/skills/verify/`, before each commit
- **mcp** → Vercel (claude.ai connector) for live project state; the `turso@turso` plugin (`.claude/settings.json`); context7 (`.mcp.json`)

A slice reaching a stack no seat above covers is a question for the user, naming the seat it would
need — never a nearby seat pressed into the gap.
