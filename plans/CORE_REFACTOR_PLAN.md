# Core refactor: astro-free data layer, arktype only, external data dir, prod parity, embedded MCP

Status: ACTIVE build plan (2026-10-18). When finished, AGENTS.md and `data/kb/ctxman` win over this file, like every other file in `plans/`.

## 0. Why, decisions, non-goals

**Problem.** Markdown and YAML data is read through Astro content collections (`src/content.config.ts`). That couples the data lifecycle to the dev server: (1) `astro build` snapshots the collections, so a built server (`pnpm run build && pnpm run start`) goes stale and needs rebuilds for new entries; (2) in dev, every write under `data/` (API saves, IDE edits, scripts) makes Vite push a full browser reload ~0.7 s later, which the UI works around with timers, sessionStorage and e2e "settle" helpers; (3) the content layer re-reads a written file ~1 s late, so pages compare collection bodies with the disk; (4) two validators exist (zod for runtime, arktype only to generate `schemas/*.json`) with a parity test; (5) unit/e2e tests depend on the committed `./data`, which the owner wants to replace with real data; (6) saving in a prod build fails with `cross-origin request from http://127.0.0.1:4321 is not allowed`.

**Root cause of (6)** (verified in `node_modules/astro/dist/core/app/node.js`): Astro 7's node server trusts the `Host` header only when it matches `security.allowedDomains`; otherwise `Request.url` is rebuilt as `http://localhost:<port>/...`. Our `checkOrigin` compares the browser `Origin` (`http://127.0.0.1:4321`) with `url.origin` (`http://localhost:4321`) and refuses. In dev Vite builds the URL from the Host header, so it never showed.

**Decisions (owner, 2026-10-18).**
1. `CTXMAN_DATA_DIR` is REQUIRED (no `./data` default). `.env` is honoured (`node --env-file-if-exists=.env`). A missing/invalid value gives a clear error (CLI exit 2; server: 503 page/JSON from a middleware).
2. The committed corpus moves `data/` -> `tests/data/` (git mv, history kept). It is the e2e seed and the realistic unit fixture, and it keeps hosting ctxman's own docs (`kb/ctxman`, `skill/ctxman-add-entry`) and self-tracking entries. `/data/` is gitignored (a local real-data dir may live there, but only via the env var).
3. YAML `# yaml-language-server:` modeline points at the RUNNING app: `$schema=http://127.0.0.1:4321/api/schemas/<ds>` (origin from `CTXMAN_SERVER_ORIGIN`, default `http://127.0.0.1:4321`). The check accepts any loopback origin/port for that dataset. The in-browser monaco-yaml editors are unaffected (they never show the modeline; they match on the fake `file:///data/<ds>/...yaml` model path).
4. arktype is the ONLY validator (runtime JSON/YAML validation, types, JSON Schema generation). zod is removed from our code (an oxlint `no-restricted-imports` rule bans it). The MCP SDK may depend on zod transitively; that is fine.
5. Markdown is rendered at request time with the same Sätteri processor Astro used (`@astrojs/markdown-satteri` `createSatteriMarkdownProcessor`, already used by `src/lib/markdown.ts`), so the HTML is identical to today's.
6. No file watcher for data. A browser reload shows the new state (lists, details and the search index are computed from disk per request with mtime caches). After an in-browser write the page reloads itself (what the prod build already does).
7. MCP: Streamable HTTP endpoint at `POST /mcp` inside the same Astro server (stateless, JSON responses), read tools + a small write set + resources. Spec in §7.
8. Everything the user sees stays the same otherwise (routes, URL state, islands, CSS, API contracts) except where this plan says so (§8 "visible changes").

**Non-goals.** No new UI. No renaming of check rule ids (`collections/*` stays). No change to Inflate behaviour. No Windows testing.

## 1. Current coupling points (what to change)

| Area | Files | Today | Target |
| --- | --- | --- | --- |
| Collections | `src/content.config.ts` | one collection per dataset + `docs` | DELETED |
| Read layer | `src/lib/entries.ts` (SERVER-ASTRO) | `getCollection/getEntry` for rendered HTML, references, `docs` search corpus | SERVER module, zero `astro:*`; reads disk, renders with Sätteri, lists references through `reference-io.ts` |
| List page | `src/pages/[dataset]/index.astro` | `getCollection('reference')` for the Owner column | `EntrySummary.owner` (already present) |
| Markdown | `src/lib/markdown.ts`, `markdown-config.ts`, `astro.config.ts` `markdown:` | runtime renderer for notes only | runtime renderer for everything (+ small memo cache); `markdown:` config removed |
| Validators | `src/datasets/schemas.ts` (zod), `src/datasets/arktypes.ts` (arktype mirror), `src/lib/json-schema.ts`, `tests/unit/arktypes-parity.test.ts` | two validators | one arktype module `schemas.ts` + PURE facade `src/datasets/validate.ts`; `arktypes.ts` and the parity test deleted |
| zod call sites | `okf.ts`, `links.ts`, `entry-index.ts`, `entry-io.ts`, `entry-summary.ts`, `entry-create.ts`, `context-io.ts`, `recipe-io.ts`, `reference-yaml.ts`, `collections-check.ts`, `skill-check.ts`, `yaml-doc.ts`, `forms/codecs.ts`, `forms/fields.ts`, `context-yaml.ts`, `inflate/recipe.ts`, `inflate/fs-sources.ts`, `inflate/output-dir.ts`, `stores/forge.ts`, `entries.ts`, `findings.ts` (wording) | `.safeParse`, `ZodType`, `z.infer/z.input` | `validate(schema, x)`, `Type<T>`, `typeof t.infer` / `typeof t.inferIn` |
| Data dir | `src/lib/data-dir.ts`, `scripts/*.ts`, `src/lib/run-script.ts`, `tests/e2e/paths.ts`, `vitest.config.ts`, `playwright.config.ts`, `package.json` | `CTXMAN_DATA_DIR` or `./data` | required; `.env` loaded by node; vitest setup pins a temp dir; e2e copies `tests/data` |
| Schema modeline | `src/lib/schema-comment.ts`, writers (`context-io`, `recipe-io`, `reference-io`, `templates.ts`), `collections-check.ts`, `scripts/fix-yaml-comments.ts`, `src/pages/api/schemas/[dataset].ts` | fixed relative path | server URL (§4 T1.7) |
| Dev-reload workarounds | `src/stores/doc-editor.ts`, `src/ui/entry/after-write.ts`, `src/scripts/shell.ts` (`import.meta.env.DEV`), `src/stores/data-form.ts` (resume navigation), `tests/e2e/dev-reload.ts`, `helpers.ts#settleDevReload`, 13 specs | wait for Vite's reload, fallback timers, settle reload | reload/navigate at once after a write; helpers become no-ops then disappear |
| Origin check | `src/lib/http.ts#checkOrigin`, `astro.config.ts` | `Origin === url.origin` | `security.allowedDomains` for 127.0.0.1/localhost + Host-based loopback-tolerant check |
| Commands | `package.json` `check` (`astro sync`), `dev`, `start`, `preview`, `add:*`, `check:*` | | `check` without `astro sync`; node `--env-file-if-exists=.env` everywhere a data dir is needed; new `test:prod`, `test:all` includes it |
| Docs | AGENTS.md, `tests/data/kb/ctxman/concepts/{architecture,runtime-modes,datasets,compliance-checks,routes-and-api,editing,search}.md`, new `mcp.md`, `tests/data/skill/ctxman-add-entry/SKILL.md`, `log.md`, `index.md` | content-layer era | updated in Phase 6 |

Sizes (lines): `src/lib` 16k (inflate 6k), `src/ui` 15k, `src/stores` 4.5k, `src/pages` 1.7k, `src/components` 2.4k, `tests/unit` 29.6k, `tests/e2e` 9.4k, `scripts` 0.5k.

## 2. Target architecture

```text
process.env.CTXMAN_DATA_DIR  ──► src/lib/data-dir.ts (NODE)  resolveDataDir() throws DataDirError when unset
                                  dataDirStatus()  ok | unset | missing | not-directory
                                  resolveServerOrigin()  CTXMAN_SERVER_ORIGIN | http://127.0.0.1:4321
src/middleware.ts (Astro)    ──► 503 (JSON for /api/* and /mcp*, HTML elsewhere) while dataDirStatus() is not ok

READ PATH (every request, disk is the truth)
  entry-index.ts   okf main.md + skill SKILL.md frontmatter, bodies, relations, mentions   (per-dir (mtimeMs,size) cache, 200 ms memo)  — unchanged
  reference-io.ts  readReference / listReferences (NEW)                                   — yaml, validated, invalid files reported
  context-io.ts / recipe-io.ts                                                             — unchanged
  bundles.ts       walkFiles / listBundleFiles / readBundleText                            — unchanged
  markdown.ts      renderMarkdown(body) via Sätteri + ctxman-cyber Shiki; memo Map keyed by sha1(body), max 256 entries
  entries.ts (SERVER, no astro:*)  listEntries / listAllEntries / getEntryDetail / getDocDetail / buildSearchIndex / getRelationGraph
  search-index.ts  SearchDoc builders                                                       — unchanged (buildSearchIndex walks bundle files on disk)

VALIDATION
  src/datasets/schemas.ts (PURE, arktype)   every dataset Type + api-only Types + json-schema hint exports (ex arktypes.ts)
  src/datasets/validate.ts (PURE)           validate(type, input) -> { success, data } | { success, issues: ValidationIssue[] }
  src/lib/json-schema.ts                    toJsonSchema of the 3 yaml Types (unchanged output)
  schemas/*.schema.json                     committed, `check:schemas` verifies, served by GET /api/schemas/:ds

WRITE PATH                                                                                   — unchanged (atomic writes, invalidateEntryIndex())
MCP (SERVER)  src/lib/mcp/{tools,resources,server,http}.ts + src/pages/mcp.ts               — §7
TESTS         vitest: tests/unit/setup.ts pins CTXMAN_DATA_DIR to an empty OS temp dir; fixtures stay in temp dirs; the realistic corpus is copied from tests/data when a test wants it
              playwright: copies tests/data -> .tmp/e2e-data (as today)
              tests/prod-smoke.ts: builds nothing, starts dist/server/entry.mjs on a free port against a temp copy of tests/data, exercises pages, API save (with Origin), search index, /mcp
```

Layering rule after the refactor: `src/lib` kinds are PURE, NODE, SERVER. **There is no SERVER-ASTRO kind anymore**: no file under `src/lib` imports `astro:*`. Pages/API routes import `astro` types only.

## 3. Execution model (for the orchestrator)

* Work on branch `refactor/astro-free-data-layer`. Conventional commits at the end of every phase; a `fix:` commit after a checkpoint when needed. Never `git add -A` (the owner's uncommitted data edits, if any, stay theirs).
* Coding agents: **sonnet / high**, one agent per wave, given the phase text below verbatim plus the AGENTS.md rules. Agents do NOT commit; the orchestrator commits.
* Validation checkpoints: **haiku / xhigh** runs the listed commands, reports failures tersely (file, test name, first assertion/compile error); fixes go back to the wave's coding agent (SendMessage) so it keeps its context.
* Waves (big swaths, few checkpoints):
  * **Wave 1** = Phase 1 + Phase 2 (one sonnet agent, sequential). Checkpoint A.
  * **Wave 2** = Phase 3 (one sonnet agent). Checkpoint B (adds `pnpm run build`).
  * **Wave 3** = Phase 4 and Phase 5 IN PARALLEL (two sonnet agents, disjoint files; Phase 5 must not touch `astro.config.ts`, `http.ts`, `package.json` scripts other than adding its dependency through the orchestrator). Checkpoint C = full `test:all` + `test:prod` + e2e.
  * **Phase 6** docs (sonnet) while Checkpoint C fallout is fixed; final full run; final commit.
* Validation commands (run from the repo root; the data dir for checks is `tests/data`):
  ```
  pnpm run typecheck && pnpm run lint && pnpm run fmt:check && pnpm run test
  CTXMAN_DATA_DIR=tests/data pnpm run check            # data checks + schema drift
  pnpm run build && pnpm run test:prod                   # from Phase 4 on
  pnpm run test:e2e                                      # Checkpoint C and final
  ```
  `pnpm run fmt` (not `fmt:check`) is allowed before a checkpoint to fix formatting.

## 4. Phase 1 — Data dir, corpus move, env, schema modeline (Wave 1, part 1)

Goal: the repo has no default data dir; the committed corpus is `tests/data`; every entry point reads `CTXMAN_DATA_DIR` (optionally from `.env`); YAML modelines point at the server.

**T1.1 Move the corpus.** `git mv data tests/data`. `.gitignore`: add `/data/` (keep everything else). `.oxlintrc.json` `ignorePatterns`: keep `"data"`, add `"tests/data"`. `.oxfmtrc.json` `ignorePatterns`: add `"tests/data/**"`. `tsconfig.json` `exclude`: add `"tests/data"`. `tests/e2e/paths.ts`: `SOURCE_DATA_DIR = path.resolve('tests', 'data')`; update the comment in `prepare-data.ts` and `helpers.ts` (`data/recipe/...` -> `tests/data/recipe/...`). grep the repo for `'data/` and `./data` in comments of `src`, `scripts`, `tests` and fix the ones that mean the repo path (leave "data dir" prose alone).

**T1.2 `src/lib/data-dir.ts`.**
```ts
export const DATA_DIR_ENV = 'CTXMAN_DATA_DIR';
export const SERVER_ORIGIN_ENV = 'CTXMAN_SERVER_ORIGIN';
export const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:4321';
export class DataDirError extends Error { code: 'unset' | 'missing' | 'not-directory'; dir?: string }
/** Absolute data dir from env; throws DataDirError('unset') when the variable is absent or blank. Relative values resolve against process.cwd(). */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string
/** Sync; stat-based. */
export function dataDirStatus(env = process.env): { ok: true; dir: string } | { ok: false; code: DataDirError['code']; message: string; dir?: string }
export function datasetDir(dataset, dataDir = resolveDataDir()): string   // unchanged
export function resolveSchemasDir(cwd = process.cwd()): string             // unchanged
/** `CTXMAN_SERVER_ORIGIN` without a trailing slash, else DEFAULT_SERVER_ORIGIN. Must parse as a URL with http(s) protocol, else DEFAULT. */
export function resolveServerOrigin(env = process.env): string
```
Remove `dirUrl` when `content.config.ts` goes (T2.5). Message for `unset`: `CTXMAN_DATA_DIR is not set. Point it at the directory that holds your ctxman data (kb/, task/, reference/ ...), e.g. CTXMAN_DATA_DIR=/Users/you/ctxman-data, or put that line in a .env file at the repo root.`

**T1.3 Astro middleware `src/middleware.ts`** (`defineMiddleware`): compute `dataDirStatus()` at most every 2 s (module-level memo); when not ok: requests whose pathname starts with `/api/` or equals `/mcp` or starts with `/mcp/` get `json({ error: 'data-dir', message }, 503)` from `http.ts`; everything else gets a minimal self-contained HTML page (status 503, inline styles, dark background, the message in a `<pre>`, the two ways to fix it). When ok, `next()`. Log the resolved dir once per process (`[ctxman] data dir: <abs>`).

**T1.4 `package.json` scripts** (pnpm only; keep names):
```
"dev":      "node --env-file-if-exists=.env node_modules/astro/bin/astro.mjs dev",
"build":    "astro build",
"start":    "node --env-file-if-exists=.env ./dist/server/entry.mjs",
"preview":  "node --env-file-if-exists=.env node_modules/astro/bin/astro.mjs preview",
"add:<ds>": "node --env-file-if-exists=.env scripts/add-entry.ts <ds>",          (all 11)
"check":    "node --env-file-if-exists=.env scripts/check-all.ts && node scripts/check-schemas.ts",
"check:data|okf|links|collections": node --env-file-if-exists=.env scripts/<x>.ts
"fix:yaml-comments": "node --env-file-if-exists=.env scripts/fix-yaml-comments.ts",
"test:prod": "node tests/prod-smoke.ts",                                           (Phase 4 adds the file)
"test:all":  "pnpm run typecheck && pnpm run lint && pnpm run fmt:check && pnpm run test && pnpm run check && pnpm run build && pnpm run test:prod && pnpm run test:e2e"
```
`gen:schemas`, `check:schemas`, `typecheck`, `lint*`, `fmt*`, `test*` unchanged. Add `.env.example`:
```
# Required: the directory that holds your ctxman data (kb/, task/, reference/, context/ ...)
CTXMAN_DATA_DIR=/absolute/path/to/your/ctxman-data
# Optional: the origin written into YAML schema modelines (default http://127.0.0.1:4321)
# CTXMAN_SERVER_ORIGIN=http://127.0.0.1:4321
```
`pnpm run check` must keep working when `.env` is absent and the env var is set in the shell.

**T1.5 Scripts.** `scripts/cli.ts`: `runCheckCli` wraps `resolveDataDir()` in try/catch -> `DataDirError` prints the message to stderr and exits `EXIT_USAGE` (2); usage text says `CTXMAN_DATA_DIR (required)`. `scripts/add-entry.ts`: same handling; delete the `usesDefault` branch. `scripts/fix-yaml-comments.ts`: same; it passes `resolveServerOrigin()` to `fixSchemaComment`. `src/lib/run-script.ts#runNodeFile`: keep pinning `env.CTXMAN_DATA_DIR = resolveDataDir(env)`; a `DataDirError` must surface as a `ScriptResult` with `code: 2` and the message in `stderr` (never throw out of the API route). `tests/unit/run-script.test.ts` and `scripts.test.ts` already pass explicit dirs.

**T1.6 Vitest guard.** `vitest.config.ts`: `setupFiles: ['tests/unit/setup.ts']`. `tests/unit/setup.ts`: in `beforeAll` create `mkdtempSync(path.join(os.tmpdir(), 'ctxman-vitest-'))`, set `process.env.CTXMAN_DATA_DIR` to it, set `process.env.CTXMAN_SERVER_ORIGIN = 'http://127.0.0.1:4321'`; in `afterAll` `rmSync` it. Add `tests/unit/fixtures/corpus.ts`: `copyCorpus(): string` copies `tests/data` into a new temp dir (`cpSync`) for tests that want realistic data (returns the dir; caller cleans up with `trackTemp`-style helper). Fix tests that assumed a `./data` default: `tests/unit/inflate-write.test.ts` ("defaults the data directory …") now asserts that `checkOutputPath` refuses a path INSIDE `process.env.CTXMAN_DATA_DIR`.

**T1.7 Schema modeline -> server URL.** `src/lib/schema-comment.ts` (stays PURE/browser-safe; takes the origin as a parameter):
```ts
export const SCHEMA_API_PATH = '/api/schemas/';
export function schemaUrl(ds, origin): string          // `${origin}${SCHEMA_API_PATH}${ds}`
export function schemaCommentLine(ds, origin): string  // `# yaml-language-server: $schema=${schemaUrl(ds, origin)}`
export function withSchemaComment(ds, body, origin): string
/** 'ok' when line 1 is a modeline whose $schema is http(s)://(127.0.0.1|localhost|[::1])(:port)?/api/schemas/<ds> (optional trailing `.schema.json`, no query); 'wrong' when a modeline exists but is anything else; 'missing' otherwise. */
export function schemaCommentStatus(ds, source): 'ok' | 'missing' | 'wrong'
export function fixSchemaComment(ds, source, origin): string   // same EOL/BOM behaviour as today
```
Callers: `context-io.ts`, `recipe-io.ts`, `reference-io.ts`, `templates.ts` pass `resolveServerOrigin()` (NODE side). `collections-check.ts` `collections/yaml-schema-comment`: message `first line must be "<schemaCommentLine(ds, resolveServerOrigin())>" (pnpm run fix:yaml-comments adds it)` / `schema comment must point at this server's /api/schemas/<ds> (pnpm run fix:yaml-comments fixes it)`. `tests/unit/fixtures/data-fixtures.ts#withYamlComments` passes `'http://127.0.0.1:4321'`. `src/pages/api/schemas/[dataset].ts`: add header `access-control-allow-origin: *` and also accept `<ds>.schema.json` as the param (strip the suffix) so both URL forms work. Run `CTXMAN_DATA_DIR=tests/data node scripts/fix-yaml-comments.ts` to migrate the 13 corpus files. `src/lib/json-schema.ts` DESCRIPTIONS: `data/reference/<name>.yaml` -> `reference/<name>.yaml` (then `pnpm run gen:schemas`; the committed schemas change text).
Unit tests to update: `schema-comment.test.ts` (new signatures, URL acceptance matrix: 127.0.0.1:4321 ok, localhost:4322 ok, `.schema.json` suffix ok, other host wrong, other dataset wrong), `collections-check.test.ts`, `scripts.test.ts`, `templates.test.ts`, `context-io.test.ts`, `recipe-io.test.ts`, `reference-io.test.ts` wherever the old relative line is asserted.

Acceptance (Phase 1 alone is not validated; see Checkpoint A after Phase 2).

## 5. Phase 2 — Remove the content layer; disk-only read path; self-reload after writes (Wave 1, part 2)

**T2.1 `src/lib/markdown.ts`** -> header kind `NODE (no fs)`. Keep `renderMarkdown(markdown)`; add a memo: `Map<string, string>` keyed by `createHash('sha1').update(markdown).digest('hex')` (node:crypto), capped at 256 entries (delete the oldest key when full). Export `clearMarkdownCache()` for tests. Keep `SHIKI_CONFIG` usage.

**T2.2 `src/lib/reference-io.ts`**: add
```ts
export async function listReferences(dataDir = resolveDataDir()): Promise<{ items: ReferenceRecord[]; invalid: { slug: string; file: string; issues: Issue[]; lastModified: string }[] }>
```
mirroring `listContexts` (readdir `reference/*.yaml`, sorted; `readReference` per file; a `ReferenceIoError` of code `parse`/`invalid`/`invalid-file`/`name-mismatch` goes to `invalid` with its issues; other errors rethrow). `ReferenceRecord` must carry `lastModified` (ISO) if it does not already.

**T2.3 `src/lib/entries.ts`** -> header kind `SERVER (no astro:*)`. Changes, nothing else:
* Delete `import { getCollection, getEntry } from 'astro:content'`, `RawEntry`, `CollectionDatasetId`, `loadCollection`, `loadEntry`, `loadDoc`, `htmlFor`, `sameBody`.
* `listEntries('reference')`: `listReferences()` -> `summarize('reference', slug, record.reference, new Date(record.lastModified), nowMs)` for items; for `invalid` files push a summary built from `{ name: slug, description: '' }` with `summary.invalid = issues` (so lists and the dashboard flag broken reference files like okf ones).
* `targetInfo` for references: `readReference(slug)` inside try/catch (`ReferenceIoError` -> `{ missing: false }` when the file exists but is invalid; ENOENT -> missing).
* `getEntryDetail` okf/skill: `html = rewriteRenderedHtml(await renderMarkdown(indexed.body), {...})`. `data` keeps the "validated output when valid" logic through the new facade (Phase 3 swaps the call; for now `.safeParse` stays).
* `getEntryDetail` reference: `readReference(slug)`; `ReferenceIoError` `not-found`/`bad-slug` -> null; other codes -> a detail with `summary.invalid` set and `data` as parsed-but-unvalidated yaml is NOT possible for the typed `ReferenceData`, so return null for invalid files (the list shows them flagged; the detail 404s). Keep `exists` check first (cheap).
* `getDocDetail`: `html = rewriteRenderedHtml(await renderMarkdown(disk.body), ...)`; `DocData` type becomes a local `Record<string, unknown>`-based interface exported from `entries.ts` (`DocFrontmatter`), until Phase 3 types it from arktype `docSchema`.
* `buildSearchIndex`: okf entries from `getEntryIndex()` (`entry.data`, `entry.body`); other bundle files: for every indexed okf entry, `walkFiles(bundleDir)` -> every `.md` except `main.md`, `index.md`, `log.md` (exact base names at any depth, as today), read + `parseDiskMarkdown`; skills from the index (`skillToSearchDoc(slug, data as SkillData, body)`); references from `listReferences().items`. Keep sort order and `generatedAt`.
* `backRefs(await safeContexts(), ...)` unchanged.

**T2.4 `src/pages/[dataset]/index.astro`**: delete the `getCollection` import and the `owners` map; `EntryTable.astro`: drop the `owners` prop and read `e.owner` (`OWNER_LABELS[e.owner] ?? ''`). grep `owners=` in other callers.

**T2.5 Delete the content layer.** `rm src/content.config.ts`. `astro.config.ts`: remove the `markdown:` key and the `SHIKI_CONFIG` import, remove the content-layer comment, add
```ts
security: { allowedDomains: [{ protocol: 'http', hostname: '127.0.0.1' }, { protocol: 'http', hostname: 'localhost' }] },
```
(part of the prod fix; Phase 4 adds the Host-based check). Remove `dirUrl` from `data-dir.ts`. Check `.astro/types.d.ts` references nothing broken (`astro sync` regenerates it). `src/env.d.ts` (if any) untouched.

**T2.6 Commands.** Already in T1.4: `check` without `astro sync`. `typecheck` keeps `astro sync` (page types).

**T2.7 Self-reload after writes (no dev-reload dependence).**
* `src/scripts/shell.ts`: delete the `if (!import.meta.env.DEV)` guard; always `setTimeout(reload-unless-[data-edit-locked], STATE_RELOAD_FALLBACK_MS)` and shrink that constant to 150 ms (name it `STATE_RELOAD_MS`).
* `src/ui/entry/after-write.ts`: remove `devReload`; `afterWrite(key, message, opts)` remembers the message and reloads at once unless `isEditing()` is true (then it sets nothing else; the editor's own flow handles it). Update `tests/unit/entry-tools-after-write.test.ts` and callers (`grep -rn afterWrite src/ui`).
* `src/stores/doc-editor.ts`: after a successful save: remember `{ message, warnings }` (drop the `reloads` counter and `MAX_SETTLE_RELOADS`, `SETTLE_RELOAD_MS`, `scheduleSettleReload`, `cancelSettleReload`), switch to preview, mark `data-stale`, and `location.reload()` after `RELOAD_AFTER_SAVE_MS = 150` unless the user re-entered edit mode. Keep `RELOAD_FALLBACK_MS` export name only if other modules import it (after-write no longer does) — otherwise delete. Rewrite the header comment (no content layer, no dev reload). `tests/unit/doc-editor.test.ts`: adapt (one reload, record without `reloads`).
* `src/stores/data-form.ts`: the "park navigation, resume after the dev reload" logic for a deleted reference (`resumeNavigation`) becomes a direct `location.assign(listUrl)` after a DELETE; keep the 404-tolerant page branch in `[slug]/index.astro` harmless or remove `gone` if nothing needs it (prefer remove + simplify).
* e2e: `tests/e2e/dev-reload.ts#settleAfter(browser, baseURL, writes)` -> just `await writes()` (keep the signature so 13 specs compile), mark `@deprecated` for Phase 6 cleanup; `helpers.ts#settleDevReload(ms)` -> `Promise.resolve()`. `global-setup.ts` stays (Vite still reloads once on first connect). Specs that wait for `page.waitForEvent('load')` after a save still pass because the page reloads itself.

**T2.8 Comments/docs in code**: `vitest.config.ts` comment (no `astro:content` anymore); `src/lib/context-io.ts`, `recipe-io.ts`, `reference-io.ts`, `collections-check.ts` headers that mention `getCollection`/`astro sync` -> "schema compliance of every data file" wording. Do not rename rule ids.

**Checkpoint A** (haiku): `pnpm run typecheck && pnpm run lint && pnpm run fmt:check && pnpm run test && CTXMAN_DATA_DIR=tests/data pnpm run check`. Then a quick manual-equivalent: `CTXMAN_DATA_DIR=tests/data pnpm exec astro dev --port 4330 --ignore-lock` in background, curl `/`, `/kb/ctxman`, `/kb/ctxman/doc/concepts/search`, `/reference`, `/api/search-index.json` (expect 200 and `docs.length > 40`), kill it. Report failures to the Wave 1 agent.

Commits: `refactor(data-dir): require CTXMAN_DATA_DIR, move seed corpus to tests/data, schema modelines as server URLs` and `refactor(core): remove content collections; render markdown and build the search index from disk`.

## 6. Phase 3 — arktype as the only validator (Wave 2)

**T3.1 Facade `src/datasets/validate.ts`** (PURE, browser-safe):
```ts
import { type } from 'arktype';
import type { Type } from 'arktype';
export interface ValidationIssue {
  path: PropertyKey[];      // ArkError.path (array of keys)
  message: string;          // ArkError.message ("name must be a string (was missing)")
  code: string;             // ArkError.code: 'domain' | 'required' | 'predicate' | 'pattern' | 'union' | 'unit' | ...
  /** 'unknown-key' = an undeclared key of a `'+': 'reject'` object (ArkError.expected === 'removed'); 'custom' = a narrow / morph predicate (code 'predicate' that is not unknown-key); 'other' = everything JSON Schema can express. */
  kind: 'unknown-key' | 'custom' | 'other';
}
export type ParseResult<T> = { success: true; data: T } | { success: false; issues: ValidationIssue[] };
export function validate<T>(schema: Type<T, any>, input: unknown): ParseResult<T>;   // schema(input); instanceof type.errors -> issues
export function assertValid<T>(schema: Type<T, any>, input: unknown, what: string): T; // throws Error(`${what}: ${issueMessage}`) for internal invariants
```
Verified arktype 2.2.8 behaviour (probe 2026-10-18): unknown key -> `{code:'predicate', path:['extra'], message:'extra must be removed', expected:'removed'}`; missing key -> `{code:'required', message:'name must be a string (was missing)'}`; wrong type -> `code:'domain'`; `string.date.parse` failure -> `code:'predicate', message:'d must be a parsable date (was "nope")'`; `ctx.reject({ path: ['links', 1], message })` -> `{code:'predicate', path:['links',1], message}`; `type('Date | string.date.parse')` outputs a Date.

**T3.2 Rewrite `src/datasets/schemas.ts` with arktype** (header: PURE, "arktype is the only validator"). Move everything from `arktypes.ts` into it (the three yaml Types, `REMOTE_URI_HINT_PATTERN`, `CLONE_DIR_PATTERN`, `GIT_REF_PATTERN`, `NAME_MESSAGE`, `gitUriNarrow`, `skillUriNarrow`, `YAML_DATASET_TYPES`), delete `arktypes.ts`, point `json-schema.ts` at `schemas.ts`. Keep every exported NAME that other modules import (`nameSchema`, `dateSchema`, `okfEventSchema`, `okfSourceSchema`, `OKF_STATUSES`, `okfConceptSchema`, `entryLinkSchema`, `entryLinksSchema`, `okfEntrySchema`, `kbSchema` … `projectSchema`, `okfIndexSchema`, `docSchema`, `skillSchema`, `localRepoReferenceSchema`, `remoteRepoReferenceSchema`, `remoteSkillReferenceSchema`, `referenceSchema`, `contextLinkSchema`, `contextSchema`, `inflateOptionsSchema`, `recipeItemSchema`, `recipeMarkdownSchema`, `materialOptionsSchema`, `contextFileSchema`, `primaryKeySchema`, `recipeStubsSchema`, `recipeOutputSchema`, `recipeOverrideSchema`, `recipeDefaultsSchema`, `recipeSchema`, `runItemOverrideSchema`, `runOverridesSchema`, `DATASET_SCHEMAS`) but as arktype `Type`s; keep every exported TYPE alias (`OkfEntry`, `SkillData`, `ReferenceData`, `ReferenceInput`, `EntryLink`, `EntryLinkInput`, `ContextLink`, `ContextData`, `ContextInput`, `DocData`, `RecipeData`, `RecipeInput`, `InflateRunOverrides`, `InflateRunOverridesInput`, …) as `typeof x.infer` / `typeof x.inferIn`. Semantics to preserve exactly:
* loose objects = plain `type({...})` (arktype keeps undeclared keys); strict = `'+': 'reject'`.
* `nameSchema` = `type('string <= 64').and(NAME_PATTERN)` with `NAME_MESSAGE` (existing `name`).
* `z.string().trim().min(1)` -> existing `nonBlank` (`/\S/`); `z.string().min(1)` -> `'string > 0'`; max lengths -> `'string <= n'`; regex -> `.and(/re/)` or `type(/re/)` with `.describe(message)` where zod had a custom message.
* `dateSchema = type('Date | string.date.parse')`; `okfEventSchema = type({ by: 'string > 0', at: dateSchema })`.
* `tags` default `[]`; `rel` default `'related'`; recipe defaults (`target 'claude-code'`, `layout 'grouped'`, arrays `[]`, `defaults {}`, `output.contextFile DEFAULT_CONTEXT_FILE`) — already in the moved yaml Types.
* `z.discriminatedUnion('type', …)` -> `.or()` (already in the moved reference Type).
* `superRefine` duplicates/applicability -> `.narrow((v, ctx) => ... ctx.reject({ path, message }))` — exact messages as today (`duplicate link x`, `duplicate context x`, `duplicate item x`, `duplicate markdown block id x`, `duplicate override x`, `duplicate order key x`, `mode "m" does not apply to <label> items`, `material "m" does not apply to …`).
* `z.record(z.string(), z.string())` -> `'Record<string, string>'`; `runOverridesSchema.items` = `type({ '[string]': runItemOverrideSchema })` plus a `.narrow` rejecting keys that fail `ITEM_KEY_PATTERN` (path `[key]`, message `must be <dataset>/<slug> of a linkable dataset`), default `{}`.
* `okfIndexSchema = type({ '+': 'reject', 'okf_version?': "'0.2'" })`.
* `skillSchema` strict: `name`, `description: nonBlank & string <= 1024`, `'license?': 'string'`, `'compatibility?': '1 <= string <= 500'`, `'metadata?': 'Record<string, string>'`, `"'allowed-tools'?": 'string'`.
* `DATASET_SCHEMAS` typed `Record<DatasetId, Type>` (use `as const satisfies Record<DatasetId, Type<any, any>>`).
Run `pnpm run gen:schemas` afterwards; the three JSON files should be byte-identical to before (same Types). If not, inspect the diff; a difference caused only by the moved `DESCRIPTIONS` text (T1.7) is expected.

**T3.3 Call sites** (mechanical; every `X.safeParse(v)` -> `validate(X, v)`; `.success` stays; `.data` stays; `.error.issues` -> `.issues`; `issue.path` is already an array; `issue.code === 'custom'` -> `issue.kind === 'custom'`):
`okf.ts` (concept/entry/index schemas; `PathIssue` stays `{path, message}`), `links.ts#302`, `entry-index.ts#293,#338`, `entry-io.ts#172,#293,#488`, `entry-summary.ts#98`, `entry-create.ts#55`, `context-io.ts#80,#198,#297,#310` (`.parse(item)` -> `assertValid`), `recipe-io.ts`/`inflate/recipe.ts` (`parseRecipe`, `runOverridesSchema`), `reference-yaml.ts#54`, `collections-check.ts#98,#121,#211`, `skill-check.ts#30`, `inflate/fs-sources.ts#78,#112`, `inflate/output-dir.ts` (rewrite `manifestEntrySchema`/`dirManifestSchema` in arktype: strict objects, `type.enumerated`, `'number.integer >= 0'`, `'string | null'`, sha256 `/^[0-9a-f]{64}$/`), `forms/codecs.ts` (`schema: Type<unknown>` -> the facade), `forms/fields.ts`, `yaml-doc.ts` (`schema: Type<T, any>`; `parsed.error.issues` -> facade issues; `unrecognizedKeys(issue)` -> `issue.kind === 'unknown-key'` with `key = String(issue.path.at(-1))` and `issue.path.slice(0, -1)` as the parent path; `coveredBySchema: issue.kind !== 'custom'`), `context-yaml.ts`, `stores/forge.ts`, `entries.ts#590`, `findings.ts#describeIssue`:
```ts
// arktype wording -> friendly wording (keep the function signature)
if (/\(was missing\)$/.test(issue.message) || (missing && /\(was undefined\)$/.test(issue.message))) return 'Required';
if (/must be a parsable date/.test(issue.message)) return 'Invalid date (use YYYY-MM-DD or an ISO 8601 timestamp)';
if (/ must be removed$/.test(issue.message)) return `Unrecognized key "${String(issue.path.at(-1))}"`;   // path points at the key
```
Note arktype prefixes messages with the path (`name must be a string`); `issueMessage()` already prepends `path: ` -> strip a leading `<dotted path> ` from `issue.message` when it equals the path so messages do not read `name: name must be …` (implement in `describeIssue`: if `message.startsWith(`${issuePath(path)} `)` drop that prefix). Add unit tests for these three rules in `tests/unit/findings.test.ts` (new file).

**T3.4 Dependencies.** `pnpm remove zod`; `pnpm remove arktype && pnpm add arktype@2.2.8` (runtime dependency now); `astro.config.ts` `optimizeDeps.include` += `'arktype'`. `.oxlintrc.json` `no-restricted-imports.paths` += `{ "name": "zod", "message": "ctxman validates with arktype (src/datasets/schemas.ts + validate.ts)" }`. `pnpm-lock.yaml` updates accordingly (never edit it by hand).

**T3.5 Tests.** Delete `tests/unit/arktypes-parity.test.ts`. `tests/unit/schemas.test.ts`: same cases through `validate()`; include the json-schema hint exports (ex `arktypes`) assertions from the deleted parity test that still make sense (CLONE_DIR_PATTERN/GIT_REF_PATTERN equivalence with `isSafeRelativeDir`/`isSafeGitRef` over the sample lists). New `tests/unit/validate.test.ts` (facade classification). Update message expectations in `http.test.ts`, `context-io.test.ts`, `entry-io.test.ts`, `yaml-doc.test.ts`, `reference-yaml.test.ts`, `okf.test.ts`, `collections-check.test.ts`, `inflate-recipe.test.ts`, `inflate-output-dir.test.ts`, `entry-create.test.ts`, `doc-io.test.ts`, `forms-fields.test.ts`, `data-form-store.test.ts`, `forge-store.test.ts`: keep the SEMANTICS asserted (which paths fail), relax exact wording to arktype's where a test asserted zod's text. `json-schema.test.ts` imports hints from `schemas.ts`.

**Checkpoint B** (haiku): Checkpoint A commands + `pnpm run build` (must succeed WITHOUT `CTXMAN_DATA_DIR` set) + `pnpm run check:schemas`. Commit: `refactor(schemas): arktype is the only validator; drop zod and the parity mirror`.

## 7. Phase 4 — Prod parity: origin check, prod smoke test (Wave 3a)

**T4.1 `src/lib/http.ts#checkOrigin(request, url)`**: a request without `Origin` passes (unchanged). With `Origin`: pass when `origin === url.origin`; else parse both (`new URL(origin)`), compare protocol + port, and treat the hostnames `127.0.0.1`, `localhost`, `::1`/`[::1]` as one loopback class: pass when both are loopback or both are equal; also pass when the `Host` request header (with the url's protocol) equals the Origin's host:port. Otherwise 403 as today. Unit tests: `Origin http://127.0.0.1:4321` vs `url http://localhost:4321` passes; `http://evil.test` fails; `null` origin fails; same-origin passes; port mismatch fails.

**T4.2 `tests/prod-smoke.ts`** (Node 24, no test framework; exit 1 on failure, prints each check): preconditions `dist/server/entry.mjs` exists (else print `run pnpm run build first` and exit 2); copy `tests/data` to a temp dir; pick a free port (`net.createServer().listen(0)`); spawn `process.execPath dist/server/entry.mjs` with `env: { HOST: '127.0.0.1', PORT, CTXMAN_DATA_DIR: tempDir }`; wait for `GET /` 200 (poll ≤ 30 s). Checks: `GET /` contains `Dashboard`; `GET /kb/ctxman` 200 contains `data-testid="..."` of the detail (use `<h1`); `GET /kb/ctxman/doc/concepts/search` 200; `GET /api/entries?dataset=task` JSON with ≥ 4 entries; `GET /api/search-index.json` `docs.length > 40`; `GET /api/doc/kb/ctxman/main.md` -> `{ markdown, lastModified }`; `PUT /api/doc/kb/ctxman/main.md` with headers `origin: http://127.0.0.1:<port>`, `content-type: application/json`, body `{ markdown, ifUnmodifiedSince: lastModified }` -> 200 (the prod save that failed before); `PUT` again with `origin: http://evil.test` -> 403; `POST /api/entry/task` with Origin, `{ name: 'prod-smoke-task', description: 'x' }` -> 201 and `GET /task/prod-smoke-task` 200 WITHOUT restart (disk is the truth); `GET /api/schemas/reference` 200 `application/schema+json`; `POST /mcp` initialize + `tools/list` (Phase 5; skip with a note if the route 404s). Kill the child (SIGTERM, then SIGKILL after 3 s), remove the temp dir. Add `"test:prod"` (T1.4) and the `test:all` order `… && pnpm run build && pnpm run test:prod && pnpm run test:e2e`.

**T4.3 `.env.example`** committed (T1.4). AGENTS.md command table row for `test:prod` (Phase 6).

## 8. Phase 5 — Embedded MCP server (Wave 3b)

Owner decision: read tools + a small write set + resources. Endpoint: `/mcp` (Streamable HTTP, stateless; the SDK handler answers GET/DELETE with its own 405 JSON-RPC error, 415 for a wrong content type, 406 for a 2025-era POST without `Accept: application/json, text/event-stream`). Host and Origin are validated with the SDK's loopback helpers (403 otherwise; an absent Origin passes, which is what MCP clients send). 2026-07-28 clients get plain JSON answers; 2025-era clients get one-event SSE answers (spec-compliant, clients accept both).

**Dependency**: `@modelcontextprotocol/server@2.3.1` (v2 line; the orchestrator runs `pnpm add` before Wave 3 and records it in AGENTS.md). All SDK facts, the verified route glue and the testing approach are in `plans/MCP_SDK_NOTES.md`; follow it. Our code never imports zod (it stays a transitive dependency of the SDK): tools are registered with the high-level `McpServer.registerTool` whose `inputSchema` is an **arktype Type passed directly** (Standard Schema with JSON Schema); the SDK validates arguments and answers `isError: true` on bad input. Tool input Types must stay JSON-Schema-expressible (no `.narrow`, no `string.date.parse`; use `type(NAME_PATTERN)` for slugs, `type.enumerated(...)` for datasets).

**Files** (all SERVER kind, astro-free, unit-testable):
```text
src/lib/mcp/tools.ts       TOOLS: readonly ToolDef[]  { name, description, input: Type, output?: Type, handler(args, ctx) -> ToolResult }   ctx = { dataDir, nowMs, serverOrigin }
src/lib/mcp/resources.ts   resource templates + list + read (ctxman://{dataset}/{slug} and ctxman://{dataset}/{slug}/{path})
src/lib/mcp/server.ts      createMcpServer(ctx): McpServer   (name 'ctxman', version from package.json, capabilities tools + resources, instructions; registers tools + resources)
src/lib/mcp/http.ts        handleMcpRequest(request: Request, ctx?): Promise<Response>   (module-level createMcpHandler; Host + Origin loopback checks from the SDK; factory per request)
src/pages/mcp.ts           export const ALL = ({ request }) => handleMcpRequest(request)   (GET/DELETE get the SDK's 405)
tests/unit/mcp-tools.test.ts      every tool against a temp corpus copy (tests/unit/fixtures/corpus.ts), through the SDK Client + InMemoryTransport pair
tests/unit/mcp-http.test.ts       handleMcpRequest with raw JSON-RPC Requests (initialize, tools/list, tools/call, bad content type, GET 405)
```
All text results are markdown; every tool ALSO returns `structuredContent` (JSON) so agents can parse. Tool names and inputs (kebab-case names; arktype Types; `limit` defaults 20, max 200):

| tool | input | output |
| --- | --- | --- |
| `search` | `{ query: string, datasets?: DatasetId[], limit? }` | ranked hits `{ id, dataset, slug, path, title, description, url, score, snippet }` using fuse.js with `src/lib/search-config.ts` over `buildSearchIndex()` (reuse the island's options: same keys/weights/threshold) |
| `list-datasets` | `{}` | registry: id, label, kind, states, entry file, count |
| `list-entries` | `{ dataset: DatasetId, q?, state?: string[], tag?: string[], project?: string, limit? }` | `EntrySummary[]` via `listEntries` + `filterEntries` (same filter as the UI) |
| `get-entry` | `{ dataset, slug, includeBody?: boolean = true }` | frontmatter, body markdown (okf/skill), yaml data (reference/context/recipe), relations (linksTo/linkedFrom/children/parents), bundle files, `url`, lastModified; for context: resolved links; for recipe: contexts/items |
| `list-bundle-files` | `{ dataset: OkfDatasetId \| 'skill', slug }` | `BundleFile[]` |
| `read-bundle-file` | `{ dataset, slug, path }` | text of one bundle file (`readBundleText`, 512 KB cap; `safeJoin` protects) + lastModified |
| `get-context` | `{ slug }` | the context with resolved links (titles, states, missing flags, notes) |
| `render-recipe` | `{ recipe: string } \| { contexts?: string[], items?: {dataset, slug}[], target?, layout?, preamble? }` | the Inflate DOCUMENT markdown (`src/lib/inflate/pipeline.ts` render with `createFsSources`) + manifest summary + warnings; never writes |
| `check-data` | `{ scope?: ('okf'\|'links'\|'collections')[] }` | the findings report (`checkOkf`, `checkLinks`, `checkCollections` in-process) |
| `create-entry` (write) | `{ dataset, name, description, title?, state?, tags?, parent? }` | same as `POST /api/entry/:ds` (`createEntry`) / `createContext` / `createRecipe` / reference needs `type` + `path`/`uri` + `owner` → use `entry-create.ts` + templates; returns the summary + file |
| `patch-entry` (write) | `{ dataset: okf\|skill, slug, state?, title?, description?, tags?, addLinks?, removeLinks? }` | `patchEntry` result (no `ifUnmodifiedSince`; last write wins) |
| `append-context-links` (write) | `{ slug, links: {dataset, slug, notes?}[] }` | `appendContextLinks` -> `{ added, skipped }` |
| `append-log` (write) | `{ dataset: OkfDatasetId, slug, text }` | adds `## YYYY-MM-DD` (today, local) heading if the top heading is not today, then the text as a bullet; creates `log.md` when missing; returns the new log head (reuse `doc-io.ts#addCreateToLog` logic: extract a shared `appendLogEntry(source, date, line)` PURE helper) |

Every tool runs `invalidateEntryIndex()` after a write (the io modules already do). Errors from io modules map to `isError: true` text `code: message` (reuse the codes of `http.ts` mappers; do not import `http.ts` into `tools.ts` — wrap errors in a tiny local mapper). Keep results compact: bodies over 50 KB are truncated with a `… (truncated, N more characters; use read-bundle-file with …)` note; `search` snippets ≤ 200 chars.

Resources: `resources/templates/list` -> `ctxman://{dataset}/{slug}` (`text/markdown` for okf/skill = frontmatter + body as on disk; `application/yaml` for reference/context/recipe) and `ctxman://{dataset}/{slug}/doc/{+path}` (bundle file, mime by extension: `.md` -> `text/markdown`, else `text/plain`); `resources/list` -> every entry (`uri`, `name` = title or slug, `description`, `mimeType`); `resources/read` -> the content. Instructions string (server `instructions` capability): a 6–8 line guide: search first, then `get-entry`, `read-bundle-file` for concepts, `render-recipe` for a full brief, write tools are available and immediate.

Docs for users (Phase 6): `claude mcp add --transport http ctxman http://127.0.0.1:4321/mcp` and `.mcp.json` `{ "mcpServers": { "ctxman": { "type": "http", "url": "http://127.0.0.1:4321/mcp" } } }`; Codex `config.toml` equivalent noted as "see your client's HTTP MCP docs".

**Checkpoint C** (haiku): everything in §3 including `pnpm run build && pnpm run test:prod && pnpm run test:e2e`. Commits: `fix(http): accept loopback origins in a built server; add prod smoke test` and `feat(mcp): embedded Streamable HTTP MCP server at /mcp`.

## 9. Phase 6 — Docs, cleanup, memory

* AGENTS.md: repo map (`tests/data`, `src/middleware.ts`, `src/lib/mcp`, `tests/prod-smoke.ts`, delete `content.config.ts`, `arktypes.ts`, `docs` collection mentions), Routes (`/mcp`), API (`POST /mcp`, 405s, 503 `data-dir`), Datasets section (YAML modeline = server URL; `CTXMAN_SERVER_ORIGIN`), Tech (arktype only; zod banned; `@modelcontextprotocol/sdk`; "Node >= 24, `--env-file-if-exists`"), Commands (`test:prod`, `check` without sync, env requirement), Coding rules (layering: PURE/NODE/SERVER only; `validate()` facade; read path paragraph; no dev-reload caveats), Testing rules (`tests/data` corpus, `setup.ts`, `copyCorpus`, prod smoke; e2e seed names unchanged), Keeping docs current (paths), Caveats (REWRITE: no content layer; no dev reload on data writes; pages reload themselves; built server is current; `CTXMAN_DATA_DIR` required; `.env`).
* `tests/data/kb/ctxman/concepts/`: `architecture.md` (stack row Data: "files on disk read per request, arktype validation"; "One validator"; layout; layering with no Server-Astro), `runtime-modes.md` (rewrite: dev and built servers behave the same; what still differs = Vite HMR for code, first-connection reload), `datasets.md` (modeline), `compliance-checks.md` (yaml-schema-comment wording), `routes-and-api.md` (`/mcp`, 503, `/api/schemas/<ds>[.schema.json]`), `editing.md` (save -> immediate reload), `search.md` (index from disk), new `mcp.md` (tools, resources, client setup) listed in `index.md`; `log.md` dated entry; `main.md` mention of MCP. `tests/data/skill/ctxman-add-entry/SKILL.md`: `CTXMAN_DATA_DIR` requirement + `.env`. Run `CTXMAN_DATA_DIR=tests/data pnpm run check` -> 0/0.
* Delete `tests/e2e/dev-reload.ts` and `settleDevReload` if every spec compiles without them (replace `settleAfter(browser, baseURL, fn)` calls with `await fn()`); otherwise leave the no-op wrappers and note it.
* Memory (orchestrator): update `project-data-dir-is-throwaway.md` (superseded: corpus at `tests/data`, env required), record the refactor's decisions in a new project memory, update the delegation preference memory (opus/xhigh research, sonnet/high coding, haiku/xhigh validation).
* Final: `pnpm run test:all`; commit `docs: describe the astro-free data layer, env, MCP and prod smoke`.

## 10. Visible changes (intentional)

1. The server refuses to serve data without `CTXMAN_DATA_DIR` (503 page with instructions).
2. After Save / state change / Details / relations / create, the page reloads itself ~150 ms later in BOTH modes (before: dev waited for Vite, prod used a 2 s fallback).
3. Invalid `reference/*.yaml` files are listed with an "invalid" flag instead of silently disappearing; their detail page is a 404 until fixed.
4. YAML files get `# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/<ds>`; VS Code resolves it while ctxman runs.
5. Validation messages use arktype wording (`must be a string (was a number)`), with "Required" / date / unrecognized-key wording preserved.
6. `pnpm run check` no longer runs `astro sync`; `pnpm run build` needs no data dir.
7. New: `POST /mcp`, `pnpm run test:prod`, `.env.example`.

## 11. Gotchas for implementers

* Node runs `.ts` directly: erasable syntax only (no enums, no parameter properties); relative imports carry `.ts`/`.tsx`.
* `astro sync` is still part of `typecheck` (page types); it must not need data.
* `resolveDataDir()` now THROWS: never call it at module top level in a module that pages import at build time; call it inside functions (today's code already does this except `content.config.ts`, which is deleted).
* `tests/unit/setup.ts` pins an empty temp data dir: a test that forgets to pass its own dir sees an empty corpus, not the repo.
* arktype objects keep unknown keys (loose by default); `'+': 'reject'` for strict; defaults only inside object literals; `.narrow` for refinements; `typeof t.inferIn` for input types; morphs (`string.date.parse`) make `infer` differ from `inferIn` like zod did.
* arktype `toJsonSchema` must keep the committed `schemas/*.json` byte-identical except for the DESCRIPTIONS text change; `pnpm run check:schemas` is the gate.
* Keep `rewriteRenderedHtml` and `renderMarkdown` order: render first, rewrite links second.
* Streaming/SSE is NOT used by the MCP route (stateless + JSON responses); do not add session handling.
* Never write under `tests/data` from tests; e2e copies it, unit tests copy it (`copyCorpus`) or build fixtures.

## 12. Phase 7 — `index.md` is the okf entry file; `main.md` is gone (owner request 2026-10-18)

**Decision.** An okf bundle is `<ds>/<name>/index.md` (REQUIRED, the entry) + optional `log.md` + concept files. The root `index.md` carries the entry frontmatter — `okf_version: "0.2"` first, then `type`, `name`, `title?`, `description`, `state` (lifecycle datasets), `tags`, `links`, `stale_after`, provenance — and its body is the entry content (which may end with a navigation section, `## Concepts`, that `addConceptToIndex` keeps maintaining). Nested `index.md` files stay frontmatter-free navigation, `log.md` is unchanged, every other `.md` is a concept. Skills stay `SKILL.md`. There is NO `main.md` anywhere: not in templates, code, tests, docs or the corpus. (This deviates from the OKF v0.2 reference skill, which keeps root `index.md` free of concept semantics; ctxman owns its format and documents the deviation in `kb/okf-format`.)

**T7.1 Registry + schemas.** `src/datasets/registry.ts`: `entryFile: 'index.md'` for kb, rca, idea, task, bug, feature, project; export `OKF_ENTRY_FILE = 'index.md'`; grep every `'main.md'` / `'main'` literal in `src`, `scripts`, `tests` and replace it with `datasetDef(ds).entryFile` / `OKF_ENTRY_FILE` (or `'index.md'` where a bundle path is spelled out). `src/datasets/schemas.ts`: `okfEntrySchema` gains `'okf_version?': "'0.2'"`; delete `okfIndexSchema` (nothing else needs it) and its tests.

**T7.2 `src/lib/okf.ts`.** `classifyOkfPath`: unchanged names (`root-index` | `index` | `log` | `concept`). `validateOkfFile`: `root-index` is validated like the old `main.md` (concept schema + `DATASET_SCHEMAS[dataset]` + `okf/name-mismatch` + `okf/type-mismatch`) PLUS `okf/index-frontmatter` as an error when `okf_version` is present and not `"0.2"`, and as a WARNING `okf/index-version` when it is absent (`root index.md should declare okf_version: "0.2"`). Nested `index` and `log`: no frontmatter, as today (`okf/reserved-frontmatter`). `listBundles`/`checkOkf`: `okf/missing-index` is now the "bundle has no index.md (the entry)" ERROR; delete `okf/missing-main`. Update `tests/unit/okf.test.ts` accordingly (and `compliance-checks.md` in T7.9).

**T7.3 Read/write libs.** `entry-index.ts`, `entry-io.ts` (`locateEntry`, PATCH keeps `okf_version` because splicing keeps every other key), `freshness.ts`, `bundles.ts`, `entry-summary.ts`, `search-index.ts` (`okfDocToSearchDoc` title rule for the entry file), `entries.ts` (`getEntryDetail` `fromRelPath: entryFile`; `getDocDetail('index')` returns null — the entry page serves it; `buildSearchIndex`: the entry doc is the root `index.md`; skip `log.md` anywhere and `index.md` only when nested), `links.ts#rewriteRenderedHtml` (a bundle link to the ROOT `index.md` -> the entry page; nested `x/index.md` -> its doc page; drop the `main.md` case), `doc-io.ts` (`normalizeDocPath`/concept creation: reserved names are `index.md` and `log.md` only; saving `index.md` through `PUT /api/doc/<ds>/<slug>/index.md` validates it as the entry; `addConceptToIndex` unchanged — it appends a `## Concepts` section when the body has none), `collections-check.ts` (glob `*/index.md` is the entry; other `.md` loose).

**T7.4 Templates + create.** `templates.ts#planNewEntry` for okf: TWO files. `index.md` = `---\n` + yaml of `{ okf_version: '0.2', type, name, title, description, state?, tags? … }` in that key order + `---\n# <title>\n\n<description>\n`; `log.md` = `# Update log\n\n## <ymd>\n* **Create**: Created [<title>](/index.md).\n`. No `main.md`. `entry-create.ts`, `scripts/add-entry.ts` help text, `/new/<ds>` (NewEntryForm) unchanged otherwise. `tests/unit/templates.test.ts`, `entry-create.test.ts`, `scripts.test.ts`, fixtures `tests/unit/fixtures/data-fixtures.ts` (`validKbBundle`, `validDataTree`, every `main.md` key -> the frontmatter moves into `index.md`).

**T7.5 Inflate.** `fs-sources.ts` reads the entry file from the registry; `catalog.ts`: keep the mode IDS (`inline-main` etc. are stored in recipes; JSON Schema must not change) but relabel: `inline-main` -> label `Inline entry`, description `Embed the entry's index.md.`; the "main.md and every concept file" description -> `index.md`; `render.ts`/`markdown.ts`/`pipeline.ts`/`expand.ts`: every `main.md` path, pointer or heading rule -> the entry file; `dir-plan`/`material-plan` untouched unless they name the file. Unit tests under `tests/unit/inflate-*.test.ts` + `fixtures/inflate-seed.ts`.

**T7.6 UI.** `DetailAside.astro` (entry path), `FileTree.astro` (`current`), `IdeOpenButton`, `MetaPanel` (`file`), `src/pages/[dataset]/[slug]/index.astro`, `src/pages/[dataset]/[slug]/doc/[...path].astro` (`docPath === 'index'` -> 301 to the entry page, like `main` did; `index.md` URL form too), `src/ui/markdown/DocEditor.tsx` / `src/stores/doc-editor.ts` (the entry page edits `index.md`), `src/ui/entry/*` (New concept reserved-name message), `src/ui/inflate/*` labels, `src/lib/mcp/tools.ts` + `server.ts` INSTRUCTIONS (`concepts/x.md, log.md, SKILL.md`; mention `index.md` is the entry). **Also do here (Phase 8 prerequisite):** in `DetailAside.astro` and the doc page aside, render `FileTree` BEFORE `MetaPanel` (Ide button stays first) so switching files never moves the file list.

**T7.7 Migration script `scripts/migrate-index.ts`** (`pnpm run migrate:index`, add to package.json with `--env-file-if-exists=.env`; NOT in the `/tools` allowlist): for every okf bundle under `CTXMAN_DATA_DIR` that has `main.md`: new `index.md` = frontmatter of `main.md` with `okf_version: "0.2"` inserted as the FIRST key (taken from the old `index.md` when present, else added), then the `main.md` body, then — when the old `index.md` body has sections other than the title and an `## Entry` section — a blank line and those remaining sections verbatim; delete `main.md`; in every `.md` of the bundle rewrite link destinations `/main.md`, `./main.md`, `main.md`, `../main.md` (any depth) to the `index.md` equivalent (fragments kept). Idempotent (a bundle without `main.md` is skipped), `--dry-run` prints the plan, `--json`, exit 0/1/2 like the other CLIs, atomic writes. Unit test with a temp fixture. RUN IT on `tests/data` (22 bundles) and verify `CTXMAN_DATA_DIR=tests/data pnpm run check` is 0/0 afterwards; fix the corpus prose by hand where it still says `main.md` (kb/ctxman concepts, okf-format, SKILL.md).

**T7.8 Tests.** Unit: every file that names `main.md` (fixtures first). E2E: `doc-edit.spec.ts` (`MAIN` -> `index.md`), `api-doc.spec.ts`, `detail.spec.ts` (`doc/main` redirect test -> `doc/index`), `entry-tools.spec.ts`, `relations.spec.ts`, `api-entry.spec.ts`, `forms.spec.ts`, `smoke.spec.ts`, helpers; `tests/prod-smoke.ts` (`/api/doc/kb/ctxman/index.md`). Seed names and counts do not change.

**T7.9 Docs.** AGENTS.md (dataset table `entry file` column; the OKF bullet: root `index.md` = entry frontmatter + `okf_version`, nested `index.md` no frontmatter; Routes: `doc/index` 301; reserved names; `migrate:index` command), kb concepts `datasets.md`, `adding-entries.md`, `editing.md`, `compliance-checks.md` (rule table), `relations.md`, `context-inflate.md`, `mcp.md`, `kb/okf-format/index.md` (deviation note), `skill/ctxman-add-entry/SKILL.md`, `log.md` entry.

Validation: Checkpoint A commands + `pnpm run build && pnpm run test:prod` + the full e2e suite (the agent runs e2e itself at the end; nothing else edits `src` meanwhile). Commit: `refactor(okf)!: index.md is the entry file of an okf bundle; main.md removed`.

## 13. Phase 8 — Keyboard shortcuts (owner request 2026-10-18)

* `?` opens a "Keyboard shortcuts" dialog (kit `Modal`/`Dialog`, `Kbd` for keys; react-aria handles focus trap/Esc). `c` creates a new item for the page's context. `l` opens the "+ Link" (add-relation) dialog on an okf entry page. Nothing else yet.
* **Context from SSR.** `Base.astro` gets optional props `createHref?: string` and `linkShortcut?: boolean`, rendered as `<body data-shortcut-create="…" data-shortcut-link>`; pages pass: list page `newHref` (already computes `/new/<ds>` or `/new/<ds>?parent=<project>`); detail page `/new/<ds>` (project pages: `/new/task?parent=<slug>`) and `linkShortcut = detail.kind === 'okf'`; doc page `/new/<ds>`; dashboard and tools `/new/task`; `/forge` `/forge?context=new`; `/inflate` `/inflate?recipe=new`; `/new/<ds>`, 404, search: none.
* **Island** `src/ui/shortcuts/Shortcuts.tsx` (`client:only="react"` in `Base.astro`, the 10th island; Monaco-free, kit parts imported by file). `useEffect` registers `window.addEventListener('keydown', fn, true)` (capture, like the search store) and calls PURE `shortcutAction(keyInfo, ctx)` from `src/lib/shortcuts.ts`; actions: `help` -> open the dialog; `navigate` -> `location.assign(href)`; `click` -> `document.querySelector('[data-entry-action="add-relation"]:not([disabled])')?.click()`. Ignore: `defaultPrevented`, `isComposing`, meta/ctrl/alt, typing targets (input, textarea, select, contenteditable, inside `.monaco-editor`), any open `[role="dialog"]`; `?` requires `event.key === '?'` (shift allowed), `c`/`l` require no shift. `SHORTCUTS` table (key(s), label, where): `?` show shortcuts; `Mod+K` search; `c` new entry (dataset of the page; child of the project in scope; new context/recipe on Forge/Inflate); `l` add a link (okf entry pages); `Mod+S` save (editors); `Mod+Alt+K` insert link to entry (markdown editors); `Esc` close. `modKeyLabel` from `src/stores/platform.ts`. Footer gets a small `ck-button--glow` "?" button (`data-shortcuts-open`) the island listens for. Styles in `src/styles` (new `shortcuts.css` imported by `global.css`, layer `cx-app`); test ids `shortcuts-dialog`, `shortcut-row`, `footer-shortcuts`.
* Tests: `tests/unit/shortcuts.test.ts` (pure matrix: each key with/without modifiers, typing target, dialog open, missing context); `tests/e2e/shortcuts.spec.ts`: `?` opens the dialog and Esc closes it; `c` on `/task` -> `/new/task`; `c` on `/task?project=ctxman-v1` -> `/new/task?parent=ctxman-v1`; `c` on `/project/ctxman-v1` -> `/new/task?parent=ctxman-v1`; `c` on `/forge` -> `forge-new-dialog` visible; `l` on `/kb/ctxman` (wait for `relation-add` enabled) -> `relation-picker` visible; typing `c` in the search box (Mod+K first) does not navigate.
* Docs: AGENTS.md (islands = 10, the shortcut context props, URL state unchanged), new kb concept `keyboard-shortcuts.md` (+ `index.md`, `log.md`), `editing.md` one line. Commit: `feat(ui): keyboard shortcuts (?, c, l) and Files panel first in detail asides`.
