# AGENTS.md

ctxman (context manager): a local-only Astro SSR app (Node backend, never deployed) that keeps knowledge, work items, skills and external references as files under `data/`, and assembles them into reusable **contexts** (evergreen link sets) for agentic coding sessions. Not built, out of scope: the "context inflate" tool (planned; see `data/idea/context-inflate`); add no UI or code for it.

**pnpm only** (never npm/npx/yarn; no `package-lock.json`). Node >= 24. Run the app with `pnpm run dev` (http://127.0.0.1:4321).

## Repo map

```text
data/                    ALL datasets (override dir with CTXMAN_DATA_DIR, read at startup). Not linted/formatted.
  <ds>/<name>/           okf datasets: index.md, main.md, log.md?, concepts/**.md
  skill/<name>/          SKILL.md (+ scripts/ references/ assets/)     reference|context/<name>.yaml
  kb/ctxman/             ctxman's own docs (keep current); skill/ctxman-add-entry = agent how-to for add scripts
scripts/                 Node-run TS CLIs: add-entry, check-{okf,links,collections,all}; cli.ts = shared helpers
src/datasets/            registry.ts = SINGLE SOURCE OF TRUTH (ids, kind, states, labels, okfType); schemas.ts = zod 4
src/content.config.ts    one collection per dataset + `docs` (every .md in okf bundles); `context` loader has no watcher
src/lib/                 shared TS modules (layering below); src/pages/ routes + api/**; src/layouts, src/components (.astro)
src/ui/kit/              react-aria-components wrappers + CSS; ui/{search,forge,tools}/ islands; ui/editor/ Monaco (browser-only)
src/stores/              nanostores (URL-synced); src/scripts/shell.ts vanilla shell script; src/styles/ global.css = only CSS entry
tests/unit/ (vitest)     tests/e2e/ (Playwright: specs, global-setup, prepare-data, paths)
plans/                   historical build specs (PLAN, ARCHITECTURE, UI_SPEC, FOLLOWUP): NOT maintained, code + this file win
.agents/skills, .claude/skills   reference skills (astro, cybercore, nanostores, okf, oxfmt, oxlint, react, react-aria, react-compiler)
```

Routes: `/` dashboard, `/<ds>` list, `/<ds>/<slug>` detail, `/<ds>/<slug>/doc/<path>` (okf only, no `.md`), `/forge` (build contexts), `/tools` (run allowlisted scripts), `/search` (302 to `/?search=1&sq=&in=`), 404. Global search modal on every page (Cmd/Ctrl+K). API (`src/pages/api`): `GET /api/search-index.json`, `GET /api/entries?dataset=`, `GET|PUT|DELETE /api/context/:slug`, `POST /api/context`, `POST /api/scripts/:name`.

## Datasets (10; `name` == dir/file stem == slug == collection id; `^[a-z0-9]+(-[a-z0-9]+)*$`, max 64)

| id                     | kind               | entry file (under `data/`) | `state` (kebab-case; first = default)                                                                             |
| ---------------------- | ------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| kb, rca                | okf bundle         | `<id>/<name>/main.md`      | none                                                                                                              |
| idea                   | okf bundle         | `idea/<name>/main.md`      | pending, in-progress, complete, abandoned                                                                         |
| task, feature, project | okf bundle         | `<id>/<name>/main.md`      | pending, in-progress, complete, wont-do                                                                           |
| bug                    | okf bundle         | `bug/<name>/main.md`       | pending, in-progress, fixed, wont-fix                                                                             |
| skill                  | agentskills.io dir | `skill/<name>/SKILL.md`    | none                                                                                                              |
| reference              | yaml               | `reference/<name>.yaml`    | none; `type` local-repo / remote-repo / remote-skill (uri: git, or https archive for skills), `owner` me / not-me |
| context                | yaml               | `context/<name>.yaml`      | none; `links: [{dataset, slug, notes?}]`                                                                          |

- **OKF v0.2** (okf datasets): root `index.md` frontmatter is ONLY `okf_version: "0.2"`; nested `index.md` and `log.md` have no frontmatter; `main.md` needs `type` (registry `okfType`), `name`, `description`, plus `state` for lifecycle datasets; every other `*.md` concept needs a non-empty `type`; `log.md` = `## YYYY-MM-DD` headings newest first; `stale_after` = `YYYY-MM-DD`; unknown keys are kept.
- **Links**: inside a bundle `/x.md` (bundle root) or `./x.md` must resolve to an existing file; across entries ONLY `ctxman:<dataset>/<slug>` (a `/feature/x` path would be read as a bundle path). Missing `ctxman:` targets are warnings.
- **reference** `uri` (rules in `src/lib/remote-uri.ts`, never `z.url()`): `remote-repo` = git URI (`git@host:org/repo.git`, `ssh://git@host/org/repo.git`, `https://host/org/repo[.git]`); `remote-skill` = git URI OR `https://…(.tar.gz|.tgz|.zip)` archive, shown with a derived `git`/`archive` badge.
- **skill** frontmatter is strict: `name` (== dir), `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`.
- **context** = pointers, never vendored content; no duplicate links, no link to `context`, `name` immutable. Always read/written through `src/lib/context-io.ts` (atomic write), NEVER `getCollection('context')`.
- Freshness = fs mtime (max over the entry dir) computed per request; `stale_after` reached = stale.
- Create entries with the scripts (never copy folders); finish with `pnpm run check` at 0 errors / 0 warnings.

## Tech (binding; the why is in italics)

- **Runtime**: Node 24 runs `.ts` directly, never transpile (scripts, e2e helpers). _Type stripping: erasable syntax only._ pnpm 11 (`packageManager`).
- **TypeScript**: `typescript@next` 7.1 nightly (native `tsc`). _`@astrojs/ts-content-mapper` (tsconfig `contentMappers`) makes the same `tsc` check `.astro` files, so `astro check` is NOT used and `@astrojs/check` must not be installed._ `noUncheckedIndexedAccess` stays off (Astro's own components fail under it).
- **Framework**: Astro 7.4.0, `output: 'server'`, `@astrojs/node` standalone, content collections for every dataset. Markdown via Satteri (`@astrojs/markdown-satteri`); never add `@astrojs/markdown-remark`.
- **UI**: React 19 islands (exactly 3, all `client:only="react"`: SearchWidget in `Base.astro`, Forge, ToolsRunner) + react-aria-components kit + vanilla CSS. Everything else is SSR Astro.
- **Theme**: `cybercore-css` 0.3 (dark only) as base layer; Inter Variable + Hack self-hosted from npm (no CDN, no Google Fonts). Information-dense layout.
- **Editing**: Monaco (`monaco-editor` + `@monaco-editor/react`, loaded locally via Vite workers) for EVERY multi-line markdown/JSON/YAML input; plain `TextField` for single-line values.
- **State**: nanostores + `@nanostores/react`; the URL carries all page state.
- **Other**: zod 4 imported from `zod`, not `astro:content` (_so Node scripts share the schemas_); fuse.js 7 search; `yaml`; oxlint + oxfmt (`.oxlintrc.json`, `.oxfmtrc.json`); vitest 5; Playwright 1.64.
- New dependency: `pnpm add`, record it here. Add new client deps to `vite.optimizeDeps.include` in `astro.config.ts` (prevents mid-session dev reloads).

## Commands (`pnpm run <name>`)

| command                                                       | does                                                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `dev`                                                         | `astro dev` on 127.0.0.1:4321 (primary runtime)                                                           |
| `build`, `start`                                              | `astro build`, then `node dist/server/entry.mjs`; the built server is a SNAPSHOT, rebuild for new entries |
| `add:<ds> <name> [flags]`                                     | scaffold an entry, `<ds>` = any of the 10 ids (flags below)                                               |
| `check`                                                       | `check:data` + `astro sync` (sync fails on the first invalid data file)                                   |
| `check:data`, `check:okf`, `check:links`, `check:collections` | data compliance; `--json` supported; errors exit 1, warnings never fail                                   |
| `typecheck`                                                   | `astro sync && tsc --noEmit --runExternalCode` (.ts .tsx .astro)                                          |
| `lint`, `lint:fix`, `fmt`, `fmt:check`                        | oxlint, oxfmt (oxfmt skips `.astro`, `data/`, `plans/`)                                                   |
| `test`, `test:watch`                                          | vitest, `tests/unit/**/*.test.ts`                                                                         |
| `test:e2e`                                                    | Playwright; run `pnpm run test:e2e:install` once (chromium); starts its own `astro dev` on :4322          |
| `test:all`                                                    | typecheck, lint, fmt:check, test, check, test:e2e. **Run before finishing any change**                    |

- `add` flags: `--title T --description D --state S --json`; reference only: `--type local-repo|remote-repo|remote-skill --path P --uri U --subpath S --owner me|not-me`. Example: `pnpm run add:task fix-login --title "Fix login" --description "..."`. Never overwrites; exit 0 ok, 1 refused, 2 usage. `/tools` runs the same script. Pass flags directly to any `pnpm run` script (`pnpm run check:okf --json`); do NOT add a `--` separator, pnpm 11 forwards it literally and the scripts reject it.
- Agents: Astro 7 auto-backgrounds `astro dev` when it detects an AI agent (one tracked server in `.astro/dev.json`). For a throwaway server run `pnpm exec astro dev --port 4330 --ignore-lock` in a background shell and kill it after, or use `pnpm exec astro dev stop`.

## Coding rules

- **TypeScript only.** Erasable syntax: no `enum`, `namespace` with values, constructor parameter properties, `import x = require`; use `as const` + unions. Relative imports carry the extension (`./x.ts`, `./X.tsx`); `import type` for types; `.ts`/`.tsx` never import `.astro`. Import CSS packages from CSS, not TS (TS 7 side-effect import check).
- **Layering of `src/lib`** (each file's header comment names its kind): PURE (no fs, no `astro:*`; browser-safe), NODE (`node:fs` ok), SERVER (`http`, `run-script`, `markdown`: no `astro:*`, server only), SERVER-ASTRO (`entries.ts`: `astro:content`; pages and API only). Scripts import only `src/datasets/*` and PURE/NODE libs; tests may add SERVER libs; neither imports `astro:*`. `src/ui/editor` touches `self`/Monaco: import it only from `client:only` islands.
- **Kit**: use `src/ui/kit` wrappers; raw `ListBoxItem` from react-aria-components is banned outside the kit (oxlint). The barrel `kit/index.ts` re-exports `CodeEditor` and so pulls in Monaco; code that must stay Monaco-free (the search island, on every page) imports kit parts by file (`../kit/Button.tsx`).
- **CSS**: one entry `src/styles/global.css` (imported by `Base.astro`). No Astro `<style>` blocks (unlayered CSS beats every layer). No CSS imports in `.tsx`. All our rules live in `@layer cx-tokens|cx-base|cx-kit|cx-app|cx-prose|cx-utilities`, declared AFTER cybercore's `reset…utilities`. Astro components use HTML twins of kit classes (`ck-*`); never put `cyber-*` classes on `ck-*` elements or form controls. Dataset colors: `--ds-<id>` in `tokens.css`.
- **URL is state**: anything that selects data lives in the URL. List: `q`, repeated `state`/`tag`, `sort` (modified|name|state), `type` (reference). Search: `search=1&sq=<query>&in=<ds,ds>` (never `q`). Forge: `context`, `dataset`, `q`, `state`, `tag`. Tools: `add`. Use `src/lib/url-state.ts`. Not URL state: unsaved edits, action results, ephemeral UI.
- **nanostores pattern**: URL-synced stores read `location` in `onMount`; actions are plain functions that set stores and call `history.pushState/replaceState`; `popstate` re-reads the URL and never writes history; time comes from `$now`, not `Date.now()` in render; `useState` only for local transient drafts.
- **React**: follow the Rules of React (pure render, no setState in effects, no ref reads in render, no mutation). React Compiler is off, but oxlint `react-hooks-js/*` rules enforce compatibility.
- **API**: JSON only via `src/lib/http.ts` (`json`, `apiError`, `readJson`): `cache-control: no-store`, errors `{error, message, issues?}`; mutating routes answer 415 (not JSON), 403 (Origin differs), 400 (bad body), 404, 409 (exists). `/api/scripts/:name` runs only `src/lib/scripts-allowlist.ts` entries, answers 200 even when the script exits non-zero, 404 for an unknown name.
- **Cross-platform**: OS-level work uses `node:fs`/`node:path`/`node:util`; spawn `process.execPath` with argv, `shell: false`; no bash/sh scripts.

## Testing rules

- Unit (`tests/unit`): PURE/NODE/SERVER libs and stores only (no `astro:*`). Build fixtures in OS temp dirs (`tests/unit/fixtures/data-fixtures.ts`); NEVER read or write `./data`; CLIs run with `CTXMAN_DATA_DIR` set. New lib behavior or bugfix = new test.
- E2E (`tests/e2e`): Playwright, 1 worker, data = fresh copy of `./data` in `.tmp/e2e-data` via `CTXMAN_DATA_DIR`, port 4322. Specs rely on seed entry names (e.g. `kb/ctxman`, `context/ctxman-dev`): do not rename seeds without updating specs; `e2e-*` names are reserved for specs. Locate by `data-testid` (registry: `plans/UI_SPEC.md` §L; `grep -rn data-testid src`). Islands render only after mount: wait for their test ids. New interactive UI gets a test id.

## Keeping docs current (in the same change as the code)

- Command, dependency, tooling config, directory layout or rule changed: update this file; update the `.oxlintrc.json`/`.oxfmtrc.json` ignore lists when adding top-level dirs.
- Dataset, state, field or template changed, in this order: `registry.ts`, `schemas.ts`, `content.config.ts`, `templates.ts` + `add-entry.ts`, check libs (`okf`, `links`, `collections-check`), UI (`--ds-*` tokens, kit/search/forge/tools tables), `package.json` `add:<id>`, tests; then docs: `data/kb/ctxman/concepts/datasets.md` + `adding-entries.md`, `data/skill/ctxman-add-entry/SKILL.md`, the dataset table here.
- Route, URL param or API endpoint: `data/kb/ctxman/concepts/routes-and-api.md` (+ `search.md` / `context-forge.md`) and the lists here.
- Check rule: `compliance-checks.md`. Run-mode or content-layer behavior: `runtime-modes.md` and Caveats here. Stack or layering: `architecture.md`, Tech and Coding rules here.
- Editing `data/kb/ctxman`: add a dated line at the top of its `log.md`, list new concepts in `index.md`, then `pnpm run check`. ctxman tracks its own work in its datasets: set the `state` of the matching `task`/`bug`/`feature`; record non-obvious root causes with `pnpm run add:rca`.

## Caveats

- `astro dev` sends a full browser reload ~0.7s after a change under `data/` that a glob loader sees (not `context/*.yaml`); the first browser connection after start gets one reload too. Tools output survives via `sessionStorage`.
- Stuck or looping dev reloads, "new dependency" errors: stop the server and `rm -rf node_modules/.vite/deps`.
- Freshness is fs mtime, so `git checkout`/clone resets "modified" times.
- `astro build` snapshots collections; runtime reads (contexts, freshness, search index) go to the filesystem.
