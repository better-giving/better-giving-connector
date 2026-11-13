## Design system

- Components and tokens come from the Better Giving design registry (better-giving/design-system, served at https://design.better.giving/registry) through the `bg-design` CLI. `bg-design.json` at the repo root lists every copied item and its folder; those copied files are this repo's design system. Take values from them and never invent a token, color or variant.
- The doop canvas `_gTDOwL8my` (https://doop-justin.fly.dev/c/_gTDOwL8my) and its guidelines doc `better-giving-design-system` are a picture of the registry. When they disagree, the registry wins.
- A part the registry lacks is a registry gap for the design-system PM, not something to draw or build ad hoc.
- Contrast: the registry uses the official Radix 12-step scale and keeps each step's role (6–8 borders, with the focus ring on step 8 of Radix's focus-ring steps 7–8; 9–10 solid fills; 11–12 text), and judges contrast in APCA (Lc). Don't move a step, add a color or override a token to reach a WCAG contrast ratio, and decline review findings that ask for one. This covers text, non-text and focus indicators alike: never use or cite WCAG contrast ratios, including WCAG 1.4.3, 1.4.11 and 2.4.13. Report an APCA miss to this repo's PM, who files it as a registry gap for the design-system PM.

<!-- kru v0.193.0 · derived 2026-11-13 · `skills/setup/SKILL.md` to re-derive -->
@../AGENTS.md

## Team

Load **`kru:lead`** before building, reviewing, or dispatching a seat — it carries how the
team works.

One package at the repo root; seats and versions are read from `package.json` and `pnpm-workspace.yaml`:

- **api** → `kru:hono-builder` — `src/app.ts`, `src/cron.ts`, `src/mcp/` (the `/mcp` endpoint, one tool per `/connector/v1` action) and `src/deployment/` (the `/connector/v1` client) ← hono 4.13.13, `@modelcontextprotocol/server` 2.2.0; `hono-builder` leaves `hono/jsx` pages out of its lane (`ROSTER.md`)
- **auth** → `kru:better-auth-specialist` — `src/auth/`: the OAuth sign-in Claude and ChatGPT start, with dynamic client registration ← better-auth 1.7.7
- **data** → `kru:turso-specialist` — `src/db/` and `migrations/`: the connection row, and every `@libsql/client` call ← `@libsql/client` 0.18.0, kysely 0.29.6
- **platform** → `kru:vercel-platform-engineer` — `vercel.json`, env and secrets (the key-encryption secret among them), the `app.connect.better.giving` domain ← `vercel.json`, AGENTS.md
- **tooling** → `kru:toolchain-engineer` — `package.json` scripts, `biome.json`, `lint/`, `tsconfig.json`, `tsconfig.widgets.json`, `scripts/` build tooling ← biome 2.5.15, typescript 7.0.2, pnpm 12.4.2, node 24, esbuild 0.28.2
- **widgets** → no kru seat. `src/widgets/` (`hono/jsx/dom` components, the plain-CSS registry parts under `src/widgets/registry/`, `scripts/widget-html.mjs`, `pnpm widget-shots`) and the server-rendered pages in `src/connect/`, `src/site/` and `src/pages/` need a `hono/jsx` UI builder. `react-ui-builder` is React-only (no `react` dependency here), `hono-builder` excludes `hono/jsx`, and `web-components-builder` is for custom elements ← `ROSTER.md`, `package.json`
- **skills** → `kru:vitest`, `zod` — vitest 5.0.3, zod 4.6.5 (widget unit tests run on happy-dom 21.0.4)
- **screens** → the connect pages and the widgets are UI; they take the registry (`## Design system` above), and `pnpm design:check` is the gate that holds `src/widgets/registry/` to `bg-design.json`
- **test** → `pnpm test` (`vitest run`), hermetic: in-memory libSQL and a fake deployment, no env and no network ← AGENTS.md → Commands
- **verify** → `.claude/skills/verify/`, before each commit
- **mcp** → Vercel (claude.ai connector) for live project state; the `turso@turso` plugin (`.claude/settings.json`); context7 (`.mcp.json`)

A slice reaching a stack no seat above covers is a question for the user, naming the seat it would
need — never a nearby seat pressed into the gap.
