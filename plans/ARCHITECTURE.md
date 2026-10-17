# ctxman architecture (orchestrator draft, 2026-10-17)

Source of requirements: `INITIAL_INSTRUCTIONS.md` (read it first; every MUST there is binding).
Installed toolchain (already in node_modules): astro 7.4.0 (vite 8.3.4, zod 4), @astrojs/react 7, @astrojs/node 11,
react 19.3, react-aria-components 1.22, nanostores 1.5 + @nanostores/react 2, fuse.js 7.5, yaml 2.9, zod 4.6,
vitest 5, @playwright/test 1.64, oxfmt 0.73, oxlint 1.88, eslint-plugin-react-hooks 7, typescript 7.0.2 (Go-native `tsc`, no JS API).
Node 24.18 runs `.ts` directly (type stripping) — scripts use erasable syntax only and explicit `.ts` import extensions.

## Repo layout

```
AGENTS.md                      # agent-facing repo guide (MUST exist, kept current)
astro.config.ts                # output: 'server', adapter @astrojs/node standalone, react() integration
tsconfig.json                  # extends astro/tsconfigs/strict; allowImportingTsExtensions, erasableSyntaxOnly, verbatimModuleSyntax
vitest.config.ts               # getViteConfig from 'astro/config'
playwright.config.ts           # webServer: astro dev against a temp copy of data/ (CTXMAN_DATA_DIR)
.oxfmtrc.json / .oxlintrc.json # keep in sync with layout (already present, need adjusting)
data/                          # ALL datasets live here (the "local repository of information")
  kb/<name>/        index.md (bundle root nav, okf_version only) + main.md (entry concept) + any other concept .md files
  rca/<name>/       same shape
  idea/<name>/      same shape
  task/<name>/      same shape
  bug/<name>/       same shape
  feature/<name>/   same shape
  project/<name>/   same shape
  skill/<name>/     SKILL.md (+ scripts/, references/, assets/ per agentskills.io)
  reference/<name>.yaml
  context/<name>.yaml
scripts/                       # node-run TS CLIs (cross-platform, node:fs etc). add-entry.ts, check-okf.ts, check-links.ts, check-collections.ts, check-all.ts
src/
  content.config.ts            # defineCollection per dataset (glob loaders), schemas imported from src/datasets
  datasets/registry.ts         # SINGLE SOURCE OF TRUTH: dataset ids, labels, kind, lifecycle states, template defaults
  datasets/schemas.ts          # zod schemas (import z from 'zod', NOT astro:content, so scripts can import them)
  lib/                         # pure TS: okf parsing/validation, link checking, freshness (fs mtime), search-index building, url-state helpers, context file IO, run-script (child_process spawn of process.execPath)
  ui/kit/                      # RAC wrappers + vanilla CSS (oxlint override expects src/ui/kit/**)
  ui/search/                   # global fuzzy search widget (React island)
  ui/forge/                    # Context Forge (React island)
  stores/                      # nanostores (search open state, forge working state) + URL param sync helpers
  layouts/, components/ (.astro), styles/ (global.css tokens)
  pages/                       # see routes
tests/unit/**                  # vitest
tests/e2e/**                   # playwright
plans/                         # planning docs (ignored by oxfmt)
```

## Datasets (10) — registry drives everything

| id | kind | entry file | lifecycle `state` enum |
|---|---|---|---|
| kb | okf | main.md | — |
| rca | okf | main.md | — |
| idea | okf | main.md | pending, in-progress, complete, abandoned |
| task | okf | main.md | pending, in-progress, complete, wont-do |
| bug | okf | main.md | pending, in-progress, fixed, wont-fix |
| feature | okf | main.md | pending, in-progress, complete, wont-do |
| project | okf | main.md | pending, in-progress, complete, wont-do |
| skill | skill | SKILL.md | — |
| reference | data | <name>.yaml | — (discriminated `type`: local-repo, remote-repo, remote-skill) |
| context | data | <name>.yaml | — |

Store enum values as kebab-case in data; registry supplies human labels ("in progress", "won't do").

### OKF bundle entry (kb, rca, idea, task, bug, feature, project)
- Directory name == `name` (required, unique, kebab-case; it is the collection entry id / slug). Check script enforces equality.
- `index.md`: OKF bundle-root nav. Frontmatter ONLY `okf_version: "0.2"`. Body: heading-grouped markdown list of concepts with descriptions. (OKF: index.md has no other frontmatter.)
- `main.md`: the entry concept. Frontmatter: `type` (OKF-required, descriptive string e.g. "Knowledge Base", "Root Cause Analysis", "Idea", "Task", "Bug", "Feature", "Project"), `name`, `title?`, `description` (required), `tags?`, `state` (lifecycle datasets only), optional OKF provenance keys `sources`, `generated`, `verified`, `status`, `stale_after`. Unknown keys preserved (zod passthrough).
- Any other `*.md` in the bundle is a concept: must have frontmatter with non-empty `type`. `log.md` reserved (newest-first `## YYYY-MM-DD` headings).
- Freshness `lastModified`: computed at request time in `src/lib/freshness.ts` = max fs mtime over all files in the bundle dir (cross-platform, no git dependency). Also honoured: OKF `stale_after` -> "stale" badge.
- Links inside bundle markdown: bundle-root-relative `/path.md` or relative `./x.md`. Check script validates every intra-bundle link resolves to an existing file (external URLs and anchors skipped). Site rewrites those links to the sub-doc route.

### Astro collections
- One collection per dataset via `glob` loader (`import { glob } from 'astro/loaders'`):
  - okf datasets: `pattern: '*/main.md'`, `base: '<dataDir>/<id>'`, `generateId` -> directory name.
  - skill: `pattern: '*/SKILL.md'`, base `<dataDir>/skill`, id -> directory name.
  - reference/context: `pattern: '*.yaml'`, id -> file stem.
- Plus one `docs` collection: `pattern: '**/*.md'`, base `<dataDir>`, restricted to okf dataset dirs; id = path without `.md` (e.g. `kb/ctxman/index`). Loose schema (`type` optional because index/log are reserved), used for rendering sub-docs and search indexing of ALL markdown.
- `dataDir` = `process.env.CTXMAN_DATA_DIR ?? './data'` (resolved absolute) so e2e tests can point at a temp copy.
- Schemas live in `src/datasets/schemas.ts` using `zod` directly (zod 4, same major astro uses). VERIFY in plan that defineCollection accepts plain-zod schemas in astro 7.4 (if not, use `astro/zod` in content.config and keep a zod-only mirror for scripts, or re-export).
- `render(entry)` from `astro:content` renders main.md / docs markdown.

### reference.yaml
```yaml
name: <must equal file stem>
description: ...
type: local-repo | remote-repo | remote-skill
# local-repo: path, subpath?, owner: me | not-me
# remote-repo: uri, subpath?, owner
# remote-skill: uri, subpath? (null/empty = repo root), owner
```
### context.yaml
```yaml
name: <stem>
description: ...
tags?: []
links:
  - dataset: kb|rca|idea|task|bug|feature|skill|reference|project
    slug: <entry id>
    notes?: |
      optional markdown guidance for the consuming agent
```
Context items NEVER vendor linked content; they are evergreen pointers. Dangling links are reported by the check script, not fatal.

## Routes (all SSR, URL params carry page state for deep-linking + back/forward)
- `/` dashboard: counts per dataset, recent by lastModified, stale items, quick links.
- `/[dataset]` list (dataset ∈ registry): filters via URL params `?q=` (text), `?state=` (multi), `?tag=` (multi), `?sort=`; `/reference` adds `?type=`.
- `/[dataset]/[slug]` detail: rendered main.md (or SKILL.md / yaml fields), metadata panel (state, tags, freshness, OKF status/stale_after), bundle file tree, "contexts that link here" back-references.
- `/[dataset]/[slug]/doc/[...path]` renders another concept/index/log file in the bundle; rewrites intra-bundle links.
- `/forge` Context Forge: URL params `?context=<slug>` (selected/new), `?dataset=`, `?q=`, `?state=`, `?tag=`. Left: discovery browser (dataset tabs, filters, results list). Right: the context being built (links list with per-link notes editor, reorder/remove). Save -> PUT /api/context/[slug]. Create -> POST /api/context.
- `/tools` run allowlisted local scripts (checks, add-entry) and show stdout/stderr/exit code.
- `/search?q=&in=` — the search widget is global (modal, keyboard shortcut) but ALSO deep-linkable: when open, it syncs `?search=1&q=...&in=kb,task` into the URL via history API; opening a URL with those params opens the widget pre-filled.

## API routes (src/pages/api/**, `export const prerender = false` implied by output:'server')
- `GET /api/search-index.json` — fuse-ready documents built server-side from collections: one doc per markdown file in every okf bundle (dataset, slug, path, title, description, tags, headings, body text) + one doc per skill (SKILL.md body) + one per reference/context (field values flattened to text). Cache per process with invalidation on dev HMR not required (recompute per request is fine locally; keep it cheap).
- `GET /api/context/[slug]`, `PUT /api/context/[slug]` (validate with zod, write yaml via `yaml` pkg), `POST /api/context` (create, 409 on exists), `DELETE /api/context/[slug]`.
- `GET /api/entries?dataset=&q=&state=&tag=` — JSON listing used by the Forge browser.
- `POST /api/scripts/[name]` — allowlisted {check, add} -> spawns `process.execPath` with `scripts/<file>.ts` and args; returns {code, stdout, stderr}. Cross-platform: never shell=true, never bash.

## npm scripts (target)
dev, build, start, preview; `add:<dataset>` for each of the 10 datasets -> `node scripts/add-entry.ts <dataset> <name> [--description ...] [--title ...]`;
`check` (all), `check:okf`, `check:links`, `check:collections` (validate every data file with the shared zod schemas + astro sync/build), `check:astro` (astro check if feasible — see open question), `typecheck` (`tsc --noEmit` = TS7 Go), `lint` (oxlint), `lint:fix`, `fmt` (oxfmt), `fmt:check`, `test` (vitest run), `test:e2e` (playwright), `test:all`.

## Open questions for the planner to resolve EMPIRICALLY (install/try things, read node_modules)
1. `astro check`: @astrojs/check peers typescript ^5||^6; root typescript is 7 (Go-only). Try an isolated sub-install `tools/astro-check/package.json` (own node_modules with typescript@6 + @astrojs/check) and run its `astro-check` bin against the repo root. If that works, wire `check:astro`. If not, drop it and document why; compliance is then covered by check:collections + astro build.
2. Exact Astro 7.4 APIs: `glob` loader options (`generateId` signature), `render()`, `getCollection`, `defineCollection` schema typing with plain zod 4, how `astro:content` is unavailable to node scripts (hence schemas.ts in plain zod), `APIRoute` typing, `Astro.url.searchParams`, adapter config, `security.checkOrigin`, `vite.server.fs` if data/ outside src needs allow-listing.
3. Vitest 5 + `getViteConfig` from astro/config with vite 8: confirm it runs a trivial test. Decide environment (node) and include patterns.
4. Node 24 `node file.ts`: confirm no warning, confirm `.ts` extension imports work, confirm `import yaml from 'yaml'` works from scripts/.
5. Playwright 1.64 webServer config with `CTXMAN_DATA_DIR` env; browsers install command (`npx playwright install chromium`).
6. oxlint 1.88 + eslint-plugin-react-hooks 7 jsPlugins config validity; oxfmt 0.73 config validity. Adjust .oxlintrc.json/.oxfmtrc.json to this repo's layout (remove ksa-mods/thirdparty, add .astro, data, test-results, playwright-report; stop ignoring scripts/).
7. RAC 1.22: confirm component names needed by the UI spec exist (Dialog, Modal, SearchField, ListBox, GridList, Tabs, ToggleButtonGroup, Select, TagGroup, Tooltip, Menu, Disclosure, Table, Toolbar, TextField, Form).

## Amendments (2026-10-17, after UI_SPEC.md) — these override anything above
1. Search widget URL params are `search=1&sq=<query>&in=kb,task` (NOT `q`, which is the list/forge text filter). No standalone `/search` route is required; if present it only redirects to `/?search=1&sq=...&in=...`.
2. A context's `name` is immutable after creation (it is the file stem and slug). Description, tags, links, notes are editable.
3. Islands are exactly three: SearchWidget (in Base.astro), Forge, ToolsRunner — all `client:only="react"`. List-page filters are a plain GET form + small vanilla Astro `<script>`.
4. Backend contracts the UI depends on (see UI_SPEC.md §0.5): `GET /api/entries?dataset=` returns for EVERY dataset: id/slug, title, name, description, tags, state?, lastModified (ISO), stale (bool), url, refType? (reference), linkCount? (context). `GET /api/search-index.json` returns `{ generatedAt, docs }` with `path` and `url` on each doc. `POST /api/scripts/:name` returns `{ code, stdout, stderr, durationMs, created?: { dataset, slug, path } }`. Registry exposes a `stateGroup()` helper; pure helpers exist for allowlist, `filterEntries` (shared by list pages and forge), relative time formatting, URL params.
5. Sub-doc URLs drop `.md`: `/kb/ctxman/doc/concepts/search`.
6. `astro.config.ts` sets markdown `shikiConfig.themes = { light: 'github-light', dark: 'github-dark' }`.
7. (User decision) `astro check` runs the default way: root devDeps `typescript@^6` (what @astrojs/check supports) + `@astrojs/check`. Native TypeScript 7 comes from the official `@typescript/native-preview` package (`tsgo`) used by `npm run typecheck`. No nested sub-installs, no npm overrides, no `tools/` directory.

## Amendments round 2 (2026-10-17, user decisions) — override anything above
8. Package manager is **pnpm exclusively** (`pnpm install`, `pnpm run`, `pnpm exec`, `pnpm dlx`). No npm/yarn. `package-lock.json` must never exist; `pnpm-lock.yaml` is committed. `packageManager: pnpm@11.22.0`.
9. TypeScript: root `typescript` is the **`next` dist-tag (7.1 nightly, currently 7.1.0-dev.20261016.1)**. `.astro` files are type-checked by TypeScript itself via **`@astrojs/ts-content-mapper`** registered in tsconfig `contentMappers` (this is Astro's official successor to `astro check`, which does not support TS 7 and is being deprecated). `@astrojs/check` is NOT installed and `astro check` is NOT used. `typecheck` script = `tsc --noEmit --runExternalCode -p tsconfig.json` (verified: exit 0 on the scaffold). `noUncheckedIndexedAccess` must stay OFF (Astro's own bundled .astro components fail under it). Amendment 7 above is void.
10. Theme: **cyberpunk, built on `cybercore-css` 0.3.0** (installed). cybercore is the base layer (dark-only, `cyber-*` BEM classes, `--cyber-*` variables, `@layer reset, base, theme, components, utilities`). Our RAC kit is still styled with our own vanilla CSS (MUST), but it consumes cybercore variables/fonts/effects and may compose `cyber-*` classes on HTML twins. Read `.agents/skills/cybercore/SKILL.md` (checked against the real 0.3.0 stylesheet; follow its Gotchas). Fonts via Google Fonts link (Exo 2, Rajdhani, JetBrains Mono). Use effects sparingly (header glitch/glow, panel scanlines), one dominant accent (cyan) per region, magenta=danger, yellow=warning, green=success. No light theme.
11. **Monaco editor for ALL user input of markdown, JSON or YAML** (`monaco-editor` 0.57 + `@monaco-editor/react` 4.7, installed): Forge per-link notes (markdown), a raw YAML mode for the whole context document in the Forge (with validation feedback from the zod schema before save), and any future reference/entry editing. Plain TextField stays for single-line fields (name, description, tags). Monaco must be loaded locally through Vite (not from a CDN): `loader.config({ monaco })` with `import * as monaco from 'monaco-editor'` and `self.MonacoEnvironment.getWorker` using Vite `?worker` imports (editor worker + json + yaml-less: yaml has no built-in worker, use editor.worker). Planner verifies this works inside an Astro `client:only="react"` island and documents the exact snippet. Define one Monaco theme `ctxman-cyber` matching cybercore colors.
12. Fonts (user decision): **Inter** for all UI text and **Hack** for every monospace surface (Monaco editor, code blocks, slugs/paths, kbd). Self-hosted from npm, no Google Fonts link: `@fontsource-variable/inter` (import `@fontsource-variable/inter/index.css` → family `'Inter Variable'`) and `hack-font` (import `hack-font/build/web/hack.css` → family `'Hack'`). Override cybercore's font variables (`--cyber-font-*` or equivalent — check the real variable names in node_modules/cybercore-css/dist/cybercore.css) so cybercore components also use Inter/Hack; Exo 2 / Rajdhani / JetBrains Mono are NOT used. Monaco: `fontFamily: 'Hack, monospace'`, `fontLigatures: false`.
13. Density (user decision): the whole UI leans **information-dense** with relatively small margins and padding between components. Tight spacing scale (e.g. 2/4/6/8/12px steps), compact row heights (~28px), small type for metadata (12-13px), tables/rows over cards where there is a list, minimal whitespace around panels. Override cybercore's default component padding where it is roomy.
