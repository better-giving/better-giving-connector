## Design system

- Components and tokens come from the Better Giving design registry (better-giving/design-system, served at https://design.better.giving/registry) through the `bg-design` CLI. `bg-design.json` at the repo root lists every copied item and its folder; those copied files are this repo's design system. Take values from them and never invent a token, color or variant.
- The doop canvas `_gTDOwL8my` (https://doop-justin.fly.dev/c/_gTDOwL8my) and its guidelines doc `better-giving-design-system` are a picture of the registry. When they disagree, the registry wins.
- A part the registry lacks is a registry gap for the design-system PM, not something to draw or build ad hoc.

<!-- kru v0.148.0 · derived 2026-10-11 · /kru:setup to re-derive -->
@../AGENTS.md

## Team

Load **`kru:lead`** before building, reviewing, or dispatching a seat — it carries how the
team works.

One package at the repo root, the `nonprofits` stack (decided 2026-10-11 · /setup, versions from `nonprofits`' workspace catalog until this repo's own lockfile carries them):

- **api** → `kru:hono-builder` — `src/`: the `/mcp` endpoint, one tool per `/connector/v1` action, and the connect flow's pages and routes in `hono/jsx` (hono 4.13.13, `@modelcontextprotocol/server` 2.2.0)
- **auth** → `kru:better-auth-specialist` — `src/auth/`: the OAuth sign-in Claude and ChatGPT start, with dynamic client registration (better-auth 1.7.7)
- **data** → `kru:turso-specialist` — `src/db/` and `migrations/`: the connection row, and every `@libsql/client` 0.18.0 call
- **platform** → `kru:vercel-platform-engineer` — `vercel.json`, env and secrets (the key-encryption secret among them), the `app.connect.better.giving` domain
- **tooling** → `kru:toolchain-engineer` — `package.json` scripts, `biome.json`, `tsconfig.json` (biome 2.5.15, typescript 7, pnpm 12.4.2, node 24)
- **skills** → `kru:vitest`, `zod` — vitest 5.0.3, zod 4.6.5
- **screens** → the connect flow's address page only, server-rendered; no token file yet
- **verify** → `.claude/skills/verify/`, before each commit
- **mcp** → Vercel (claude.ai connector) for live project state; the `turso@turso` plugin (`.claude/settings.json`); context7 (`.mcp.json`)

A slice reaching a stack no seat above covers is a question for the user, naming the seat it would
need — never a nearby seat pressed into the gap.
