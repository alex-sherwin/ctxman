# Round 3 spec: link data in the UI (UX review Top 10)

Source: `plans/UX_REVIEW_FINDINGS.md` (UX-xx ids), `plans/UX_REVIEW_BRIEF.md`. Binding: `AGENTS.md` (explicit Save,
layering, kit, URL is state, API conventions, docs chain). Where this spec and the code disagree on something not
listed here, the code + AGENTS.md win. Every packet (§L) ends with `pnpm run typecheck && pnpm run lint &&
pnpm run fmt:check && pnpm run test` plus its listed e2e specs (`pnpm exec playwright test tests/e2e/<spec>`); W10
runs `pnpm run test:all`.

Scope: Top 10 in full (UX-02, 03, 01, 07, 06, 09, 05, 10, 04, 08, 11, 12, 13). Folded in because they sit in files
already touched: UX-17 (list "New" → `/new/<ds>` for every dataset), UX-21 (tab strips wrap), UX-22 (index.md/log.md
out of search), UX-25 (seed prose without hand-written states), UX-26 (TagEditor splits/commits), UX-29 (manifest
block titles), UX-32 (`…/doc/<path>.md` redirect), UX-34 (empty template headings dropped). Not in this round:
UX-14/15/16/18/19/20/23/24/27/28/30/31/33/35/36/37/38/39/40.

## A. Decisions and deviations

| # | decision | why |
|---|---|---|
| A1 | Structured relations live in okf `main.md` frontmatter `links: [{dataset, slug, rel}]`, `rel ∈ child \| related \| depends-on` (§B). The **project owns its children** (`rel: child` on the project). Body `ctxman:` links stay valid prose links and count as *mentions*. | Orchestrator 1/3. One file holds a project's ordered child set; the Children panel edits one file. |
| A2 | **Entry index** `src/lib/entry-index.ts` (NODE): scans every okf `main.md` / skill `SKILL.md` frontmatter + every `.md` body of those dirs, cached per file by `(mtimeMs, size)`. `src/lib/relations.ts` (PURE) builds the graph from it. | Orchestrator 1. Measured (§C.4). |
| A3 | **DEVIATION (extends orchestrator 8):** `entries.ts` builds okf + skill `EntrySummary`s and the detail-page frontmatter (`detail.data`) from the entry index (disk), not from `getCollection`. Collections keep providing rendered HTML (`entry.rendered`), the `docs` collection and the search index. No loader / watcher / content.config change. | The content layer re-reads a written file ~1 s late (`data/rca/stale-preview-after-browser-save`) and silently keeps the OLD entry when the new frontmatter fails the schema (UX-08). With disk-backed summaries a state change, a PATCH or a create is visible on the very next request (no settle reload, `waitForEntry` resolves at once), and invalid files are listed with their issues. Cost ≈ the `lastModifiedOf` walk the list already does (§C.4). |
| A4 | **DEVIATION:** no arktype mirror for `links`. `src/datasets/arktypes.ts` models only the three yaml datasets (it exists to generate `schemas/*.schema.json`); okf frontmatter has no arktype/JSON Schema. zod in `schemas.ts` is the only definition. | Verified: `arktypes.ts` exports reference/context/recipe types only. |
| A5 | **DEVIATION:** contexts are NOT edges of the relation graph; the existing "Linked from contexts" panel (`backRefs()`) stays the place for them. | Avoids two panels listing the same context. |
| A6 | **DEVIATION:** no "context-from-project" endpoint. "Build context from this project" = `POST /api/context` (new) or the new `POST /api/context/:slug/links` (append), with the link list computed from SSR props. | One new endpoint instead of two; the server already validates both. |
| A7 | Frontmatter PATCH API `GET|PATCH /api/entry/<ds>/<slug>` (§D.1) edits ONLY the given top-level keys by **range-based text splicing** of the frontmatter (§B.4), never by re-stringifying the document; the result must pass the dataset schema or nothing is written (400). | Verified in scratch: `yaml` `Document.toString()` re-flows folded scalars, re-pads flow seqs and, parsed with the `timestamp` tag, rewrites `2026-10-17T12:05:00Z` as `2026-10-17T12:05:00` (drops `Z`). Splicing keeps every untouched byte (§B.4 algorithm, verified). |
| A8 | **DEVIATION (orchestrator 2 "Frontmatter panel"):** frontmatter editing is a **dialog** opened by an "Edit" button on the Details panel (title, description, tags, state, stale_after, status). Relations are edited in the Links / Children panels, not the dialog. | The aside is narrow; the dialog keeps the SSR read view and matches the popup editors. |
| A9 | State select (UX-01) = **SSR native `<select>` + vanilla delegation in `src/scripts/shell.ts`** (no island), on list rows (lifecycle datasets) and in the detail header. A change PATCHes `{state}`; the dev reload re-renders the list with its URL filters intact. | Lists are SSR; one implementation for both places; works with `?state=` filters (URL untouched). |
| A10 | Create forms: `/new/<ds>` for **every** dataset. okf + skill get a new `NewEntryForm` island backed by `POST /api/entry/<ds>` that reuses `templates.ts` `planNewEntry` and a write helper extracted from `scripts/add-entry.ts` (same files, same validation, same rollback). reference/context/recipe keep `DataForm`. Tools' Add Entry panel becomes a **thin link** (dataset Select + "Open the form" button + CLI hint); its follow-navigation logic is deleted. | Orchestrator 3: one create path per dataset, no placeholder URI (reference goes through DataForm). |
| A11 | `parent` on create: the **project** gets `{dataset, slug: <new>, rel: child}` appended (server-side, after the entry is written). | Orchestrator 3 recommendation; consistent with A1. |
| A12 | Monaco completion triggers on `ctxman:` (target), `](` (destination) and **`[[`** (whole link), plus Ctrl+Space anywhere (whole link). **DEVIATION:** not a bare `[` (fires on every task list `- [ ]` and footnote). Trigger characters `: ( [ /`. | Verified in `monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestModel.js` `_updateTriggerCharacters`: trigger characters fire independently of `quickSuggestions: false` (only `suggestOnTriggerCharacters`, default true, and not read-only). |
| A13 | "Insert link" shortcut **Mod+Alt+K** (DEVIATION from UX-02's Cmd+Shift+K: Monaco binds Ctrl/Cmd+Shift+K to *delete line*). Also a context-menu item. | |
| A14 | **DEVIATION (orchestrator 5):** drafts move from `sessionStorage` to **`localStorage`** (14-day TTL); DocEditor, MarkdownModal, Forge and Inflate persist drafts and **drop the native `beforeunload` prompt**. DataForm keeps its prompt (no persistence). A draft whose base changed on disk is **restored with a warning** (not dropped). | sessionStorage dies with the tab: without the prompt a real tab close would lose work silently. A dev reload cannot be told apart from a close, so persistence must survive both. |
| A15 | Children panel on **project** pages only; `child` is valid on any okf entry's `links` (data model), and the list filter param is `project=<slug>`. | Orchestrator 1; YAGNI for feature→task UI. |
| A16 | Brief defaults: every okf kind defaults to `inline-main`; inline okf items also print the entry `description` when the body does not contain it; empty template sections are dropped; markdown blocks nest under their group; unresolved links warn (§H). | UX-11/12/13/34. |
| A17 | AGENTS.md says "exactly 4 islands": stale (round 2 made 7). This round adds `EntryTools` and `NewEntryForm` → **9**. | W10 fixes the text. |

## B. Data model

### B.1 `src/datasets/registry.ts` (W1)

```ts
/** Structured relation kinds of an okf entry's frontmatter `links` (from = the entry that declares it). */
export const ENTRY_RELS = ['child', 'related', 'depends-on'] as const;
export type EntryRel = (typeof ENTRY_RELS)[number];
export const ENTRY_REL_LABELS: Readonly<Record<EntryRel, string>> = {
  child: 'Child', related: 'Related', 'depends-on': 'Depends on',
};
/** What the TARGET's page calls an incoming edge. */
export const ENTRY_REL_INVERSE_LABELS: Readonly<Record<EntryRel, string>> = {
  child: 'Parent', related: 'Related', 'depends-on': 'Required by',
};
export function isEntryRel(value: unknown): value is EntryRel; // ENTRY_RELS includes
```

### B.2 `src/datasets/schemas.ts` (W1)

```ts
export const entryLinkSchema = z.strictObject({
  dataset: z.enum(LINKABLE_DATASETS),
  slug: nameSchema,
  /** Absent in hand-written files = 'related'. ctxman always writes it. */
  rel: z.enum(ENTRY_RELS).default('related'),
});
/** Array-level refine (NOT object-level: kb/rca schemas are `.extend`ed per lifecycle dataset). */
export const entryLinksSchema = z.array(entryLinkSchema).superRefine((links, ctx) => {
  const seen = new Set<string>();
  links.forEach((l, i) => {
    const key = `${l.dataset}/${l.slug}`;
    if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [i], message: `duplicate link ${key}` });
    seen.add(key);
  });
});
export const okfEntrySchema = z.looseObject({
  ...okfConceptShape,
  name: nameSchema,
  description: z.string().trim().min(1),
  links: entryLinksSchema.optional(),
});
export type EntryLink = z.infer<typeof entryLinkSchema>;        // rel required (after default)
export type EntryLinkInput = z.input<typeof entryLinkSchema>;
```

Verified (scratch, zod 4.6.7): the array refine reports `path: ['links', 1]`; `.extend({state})` keeps it; a missing
`rel` parses to `'related'`. `okfConceptSchema` (concept files) does NOT get `links`. `docSchema` (loose) needs no
change. `skillSchema` (strict) does not get `links`: skills have mentions only.

Rules (enforced where noted):
- one link per target (zod, `okf/entry-schema` + `collections/schema` errors);
- no link to itself (`links/relation-self`, error, §B.3); target must exist (`links/relation-target`, warning, §B.3);
- `rel` semantics: `child` = "this entry contains the target" (projects); `related` symmetric; `depends-on` = "this
  needs the target first". Cycles are not checked.

Canonical on-disk form (what ctxman writes; block style, key order dataset/slug/rel):
```yaml
links:
  - dataset: task
    slug: write-agents-md
    rel: child
```

### B.3 New check rules (W1, `src/lib/links.ts`; documented in `compliance-checks.md`)

| rule | severity | where | message |
|---|---|---|---|
| `links/relation-target` | warning | `<ds>/<slug>/main.md`, line of the `links:` key | `relation target <ds>/<slug> does not exist` |
| `links/relation-self` | error | same | `an entry cannot link to itself` |

Both come from a new `checkFrontmatterLinks(...)` run for every okf `main.md` inside `checkLinks`, and from
`validateDoc` (doc-io) for `main.md` (§D.4). Malformed items are already `okf/entry-schema` errors; skip them here.

### B.4 Frontmatter patch algorithm — `src/lib/frontmatter-patch.ts` (PURE, W2)

```ts
/** undefined = delete the key; any other value = set it. */
export type FrontmatterChanges = Readonly<Record<string, unknown>>;
export type PatchResult = { ok: true; source: string; changed: boolean } | { ok: false; error: string };
export function patchFrontmatter(source: string, changes: FrontmatterChanges): PatchResult;
```
1. Keep a leading BOM; `eol = source.includes('\r\n') ? '\r\n' : '\n'`; work on LF text, join the result with `eol`.
2. Line 0 must be `---` (trimEnd) and a closing `---` line must follow (same test as `okf.splitFrontmatter`);
   else `{ok:false, error:'missing frontmatter'}`. `raw` = the lines between. Body bytes after the closing line are
   never touched.
3. `doc = parseDocument(raw, { schema: 'core', merge: true })` — **no `timestamp` custom tag** (the parse is only for
   ranges). `doc.errors.length > 0` → `{ok:false, error: first.message}` (covers `DUPLICATE_KEY`).
   `doc.contents` null → empty map (append only); not a map → `{ok:false, error:'frontmatter is not a mapping'}`.
4. Span of an existing top-level pair: `start = lineStart(key.range[0])`,
   `end = lineEnd(max(value.range[1] - 1, key.range[1]))` (`value` null → `end = lineEnd(key.range[1])`); `lineStart`
   = index after the previous `\n`, `lineEnd` = index of the next `\n` (or `raw.length`). Full-line comments above a
   key are outside its span (kept). A trailing comment on a replaced single-line value is dropped (documented).
5. Replacement text `stringifyPair(key, value, flow)`: `const d = new Document({ [key]: value }); if (flow)
   (d.get(key, true) as YAMLSeq).flow = true;` → `d.toString({ lineWidth: 0, blockQuote: 'literal',
   flowCollectionPadding: false })` minus the final `\n`. `flow` = the old value `isSeq(...) && .flow` (keeps
   `tags: [a, b]` style). Verified output: `tags: [ctxman, roadmap, v1]`, `stale_after: 2027-01-01` (plain),
   `title: "New: title with colon"`, `links:` block list.
6. Set on a missing key: insert `\n` + text after the span of the first present anchor, else at the end of `raw`:
   `title`→after `name`; `state`→after `description`; `tags`→after `state`, else `description`;
   `stale_after`,`status`→after `tags`; `links`→end. Delete of a missing key: no-op.
7. Delete = remove `[start, end + 1)` (span plus its newline; the last line of `raw`: `[start - 1, end)`). Apply
   edits bottom-up (descending `start`). `changed = result !== source`.

## C. Entry index and relation graph

### C.1 `src/lib/entry-index.ts` (NODE, W1)

```ts
export type IndexedDataset = OkfDatasetId | 'skill';
export interface Mention { dataset: LinkableDatasetId; slug: string; /** bundle-relative */ file: string; line: number }
export interface IndexedEntry {
  dataset: IndexedDataset;
  slug: string;
  /** 'task/x/main.md' | 'skill/x/SKILL.md' (data-dir relative) */
  file: string;
  /** parseFrontmatterLoose(...).data (timestamp tag, like astro); {} when unparseable */
  data: Record<string, unknown>;
  /** markdown body of the entry file (after frontmatter) */
  body: string;
  /** [] = valid. YAML error → [{path:'', message}], else DATASET_SCHEMAS[ds] issues as
   *  `{ path: issuePath(i.path), message: describeIssue(i, data) }` (findings.ts), plus
   *  `{path:'name', message:'name "<x>" must equal the directory name "<slug>"'}`. */
  issues: Issue[];
  /** okf only: data.links items that parse with entryLinkSchema individually (bad items skipped), file order */
  relations: EntryLink[];
  /** ctxman: links in every .md of the dir (frontmatter excluded, code masked), targets in LINKABLE_DATASETS,
   *  self-links skipped, document order (main.md first, then walkFiles order) */
  mentions: Mention[];
  /** max mtime over walkFiles(dir) (dot names skipped), else the dir's mtime == freshness.lastModifiedOf */
  lastModified: Date;
  /** ISO mtime of the entry file itself: the `ifUnmodifiedSince` base of PATCH */
  fileModified: string;
}
export interface EntryIndex {
  entries: readonly IndexedEntry[];           // registry dataset order, then slug
  byKey: ReadonlyMap<string, IndexedEntry>;   // 'task/x'
  /** Files (re)parsed by this build (tests assert caching). */
  parsed: number;
}
export function getEntryIndex(dataDir?: string): Promise<EntryIndex>;
export function invalidateEntryIndex(dataDir?: string): void; // drop the 200 ms memo (not the per-file cache)
```
Rules: an okf entry = a non-dot dir under `data/<okf ds>/` that contains `main.md`; a skill = dir under `data/skill/`
with `SKILL.md`. Invalid dir names (not `isValidName`) are skipped (check-okf reports them).

### C.2 Caching (W1)
- Per data dir: `Map<entryDirAbs, { sig: string; entry: IndexedEntry }>`. `sig` = `rel:mtimeMs:size` of every
  `walkFiles` result joined by `\n`. Same sig → reuse the entry (no read); else re-read every `.md` of that dir.
  Dirs that vanished are dropped.
- Memo: a finished build is returned again for calls within **200 ms** (one page render calls it several times);
  concurrent calls share the in-flight promise. `invalidateEntryIndex()` clears the memo; every write route of §D
  calls it after writing.

### C.3 `src/lib/relations.ts` (PURE, W1)

```ts
export type OutRel = EntryRel | 'mentions';
export interface RelationEdge {
  from: string; to: string;            // keys 'ds/slug'
  rel: OutRel;
  source: 'frontmatter' | 'body';
  /** bundle-relative files the mention appears in (body edges), first occurrence first */
  files: string[];
}
export interface RelationGraph {
  out: ReadonlyMap<string, readonly RelationEdge[]>;
  in: ReadonlyMap<string, readonly RelationEdge[]>;
}
export function buildRelationGraph(entries: readonly Pick<IndexedEntry,'dataset'|'slug'|'relations'|'mentions'>[]): RelationGraph;
/** Outgoing: frontmatter edges in file order, then one 'mentions' edge per other target (first-occurrence order).
 *  A target that has a frontmatter edge gets no extra 'mentions' edge from the same entry. */
export function linksTo(g: RelationGraph, key: string): readonly RelationEdge[];
/** Incoming edges, sorted: child (Parent) → depends-on (Required by) → related → mentions (Mentioned by), then from-key. */
export function linkedFrom(g: RelationGraph, key: string): readonly RelationEdge[];
export function childrenOf(g: RelationGraph, key: string): string[]; // out child edges, file order
export function parentsOf(g: RelationGraph, key: string): string[];  // in child edges
```
`entries.ts` (W3) adds `getRelationGraph(): Promise<RelationGraph>` (memoized per `EntryIndex` object via `WeakMap`).

### C.4 Performance (measured on this machine, Node 24, scratch benchmark over the real libs)

| data | cold build (read + parse + zod + links) | warm (stat walk only) |
|---|---|---|
| `./data` (21 bundles, 79 `.md`) | 26 ms first, 14 ms second | 1.7 ms |
| synthetic 1050 bundles, 3950 `.md` | 556 ms | 73 ms |

Targets: warm ≤ 5 ms and cold ≤ 50 ms for the seed; warm ≤ 120 ms at 1000 bundles. No perf test in CI (flaky);
`entry-index.test.ts` asserts `parsed` counts instead (§J).

## D. API contracts

All: JSON via `src/lib/http.ts` (`json`, `apiError`, `readJson`), `cache-control: no-store`, errors
`{error, message, issues?}`, 403 `forbidden-origin`, 415 `unsupported-media-type`, 400 `bad-json`, 405 via `ALL`.
Write routes call `invalidateEntryIndex()` after a successful write. `Issue = { path, message }` (context-io).

### D.1 `GET|PATCH /api/entry/:dataset/:slug` — `src/pages/api/entry/[dataset]/[slug].ts` (W2)

`dataset` ∈ okf ids ∪ `skill`. Logic in `src/lib/entry-io.ts` (NODE).

GET → 200 `{ frontmatter, lastModified, issues }`: `frontmatter` = JSON-safe frontmatter (a `Date` at
`T00:00:00.000Z` → `'YYYY-MM-DD'`, other Dates → ISO), `lastModified` = ISO mtime of the entry file, `issues` = schema
issues (may be non-empty).

PATCH body (all keys optional, at least one patch key; unknown keys → 400):

| key | okf | skill | value | written as |
|---|---|---|---|---|
| `state` | lifecycle ds only | — | one of the registry states | `state: <id>` |
| `title` | ✓ | — | string ≤ 200 or `null`; trimmed, newlines collapsed; `''`/`null` → delete | `title: …` |
| `description` | ✓ | ✓ | non-blank string ≤ 1024, newlines collapsed | |
| `tags` | ✓ | — | string[] ≤ 50; each `normalizeTag` then `TAG_PATTERN`; dedupe, order kept | `tags: […]` (`[]` kept) |
| `stale_after` | ✓ | — | real date `YYYY-MM-DD` or `null`/`''` (delete) | plain `stale_after: 2027-01-01` |
| `status` | ✓ | — | `draft\|stable\|deprecated` or `null` (delete) | |
| `links` | ✓ | — | full replacement, `EntryLinkInput[]` ≤ 500; `[]` → delete key | block list, `rel` always written |
| `addLinks` | ✓ | — | `EntryLinkInput[]`: appended unless the target is already linked (then its `rel` is replaced) | |
| `removeLinks` | ✓ | — | `{dataset, slug}[]`: removed when present | |
| `ifUnmodifiedSince` | ✓ | ✓ | ISO; must EQUAL the file mtime | |

`links` with `addLinks`/`removeLinks` → 400. Self links → 400 (`links/relation-self` text). Flow: per-file lock
(`withFileLock`, §D.6) → read file → compute the new frontmatter object → if equal to the current one: 200 without
writing → `patchFrontmatter` → re-parse the new source with `parseYaml` (timestamp) → `DATASET_SCHEMAS[ds]` +
name check + for okf `validateOkfFile` errors of rule `okf/stale-after-format` → any problem: 400 `invalid`, nothing
written → atomic write (mode kept) → 200.

PATCH 200 `{ frontmatter, lastModified, changed, warnings }` (`warnings` = `links/relation-target` findings of the
written file).

| status | error | when |
|---|---|---|
| 400 | `bad-dataset` | not okf/skill |
| 400 | `bad-slug` | invalid name |
| 400 | `invalid` | body shape, a key not allowed for the dataset, bad value, or resulting frontmatter fails the schema (issues: paths are the body keys, e.g. `stale_after`, `links.2.slug`) |
| 404 | `not-found` | entry file missing |
| 409 | `conflict` | `ifUnmodifiedSince` ≠ mtime; body `{error, message, lastModified}` |
| 422 | `invalid-file` | frontmatter missing / unparseable / not a mapping (issues) |

### D.2 `POST /api/entry/:dataset` — `src/pages/api/entry/[dataset]/index.ts` (W2)

Body: `{ name, description, title?, state?, tags?, parent? }` (`title`, `state`, `tags` okf only; `state` lifecycle
only; `parent` = a project slug). Flow: validate (paths `name`, `description`, `title`, `state`, `tags`, `parent`) →
parent project must exist (else 400 `invalid`, path `parent`, nothing written) → `planNewEntry(ds, name, {title,
description, state, tags, now})` (templates.ts gains `tags?: readonly string[]`, default `[]`) →
`writePlannedEntry` (§D.6) → if `parent`: `patchEntry('project', parent, {addLinks:[{dataset, slug:name,
rel:'child'}]})`; a failure there keeps the entry and answers `parentLinked: false` + `parentError`.

201 `{ dataset, slug, path, url, files, parentLinked? , parentError? }` + `Location: /<ds>/<slug>`. Errors: 400
`bad-dataset` (not okf/skill), 400 `invalid` (issues), 409 `exists`, 500 (template self-check failed — never with
valid input).

### D.3 `POST /api/doc/:dataset/:slug/*path` — create a concept (W2, same route file as GET/PUT)

okf datasets only (`skill` → 400 `bad-dataset`). Body `{ title, type?, description? }` (`title` 1..200 one line;
`type` default `'Concept'`, non-blank ≤ 100; `description` ≤ 1024 one line). Path: `normalizeDocPath`, must classify
as `concept` (`okf.classifyOkfPath`) and not be `main.md` → else 400 `bad-path`; bundle must exist (404); file must not
exist (409 `exists`). Writes (dirs created inside the bundle via `safeJoin`):
```md
---
type: <type>
title: <title>
description: <description>      ← only when given
---

# <title>
```
Then updates, each only when the file exists, each atomically:
- root `index.md`: find the ATX `## Concepts` heading (case-insensitive, outside code); insert
  `* [<escaped title>](/<path>) - <description or title>` after the last list line (`^\s*[*-] `) of that section
  (section ends at the next `#`/`##` heading or EOF; no list → after the heading + one blank line); bullet char =
  the section's first bullet, else `*`. No such heading → append `\n## Concepts\n\n<line>\n` (exactly one blank line
  before). Link-text escaping = `templates.ts` `linkText` (export it).
- `log.md`: today (UTC `YYYY-MM-DD`, like templates) — if the first `## ` heading is today, insert
  `* **Create**: Created [<title>](/<path>).` right after it; else insert `## <today>\n* **Create**: …\n\n` before the
  first `## ` heading (or append at EOF when none).

201 `{ path, url, lastModified, warnings }` (`url` = `docUrl`). Errors: `bad-dataset`, `bad-slug`, `bad-path`,
`invalid` 400; `not-found` 404; `exists` 409. Lives in `doc-io.ts` as `createDoc(dataset, slug, rawPath, body,
dataDir)`.

### D.4 `PUT /api/doc` warnings (W2 in doc-io; the link functions are W1's)
W1 extracts `checkFileLinks({ dataset, name, relPath, source, dataDir }): Finding[]` from `checkLinks`' inner loop
(`links/broken`, `links/escapes-bundle`, `links/ctxman-invalid`, `links/ctxman-target`; it also runs
`checkFrontmatterLinks` (§B.3) when `relPath === 'main.md'` of an okf dataset) and `checkLinks` calls it (no CLI
behaviour change). W2: `validateDoc(dataset, slug, relPath, source, dataDir)` gains `dataDir` and appends
`checkFileLinks(...)` for that one file. GET and PUT both return them in `warnings`; the save still never blocks.

### D.5 `POST /api/context/:slug/links` — `src/pages/api/context/[slug]/links.ts` (W2)

Body `{ links: { dataset, slug, notes? }[] }` (1..200; schema = `contextLinkSchema`). `appendContextLinks(slug,
input, dataDir)` in context-io: read (`readContext`) → append links not yet present (a present one is left as is,
its notes untouched) → `writeContext` path (validate + atomic). 200 `{ context, lastModified, added: string[],
skipped: string[] }` (keys `ds/slug`). Errors: 400 `bad-slug`, 400 `invalid` (issues, paths `links.N.*`), 404
`not-found`, 422 `invalid-file` (the existing file fails to parse/validate). If Astro reports a route conflict between
`[slug].ts` and `[slug]/links.ts`, move `[slug].ts` to `[slug]/index.ts` unchanged.

### D.6 Shared NODE helpers (W2)
- `src/lib/atomic-write.ts`: `writeFileAtomic(abs, text, mode?)` (hidden temp file next to the real target, `wx`,
  chmod, rename; the code now inline in `doc-io.writeDoc`, which switches to it) and `withFileLock(abs, fn)`
  (in-process promise chain per path).
- `src/lib/entry-create.ts`: `writePlannedEntry(dataset, name, planned, dataDir)` and `plannedProblems(...)` moved
  from `scripts/add-entry.ts` (`problemsOf`, write loop, re-validate, rollback). Throws
  `EntryCreateError(code: 'exists' | 'invalid' | 'io', message)`. `add-entry.ts` maps them to its exit codes; its
  stdout/stderr texts stay byte-identical (`tests/unit/scripts.test.ts` must pass unchanged).
- `src/lib/http.ts`: `entryErrorResponse(error)` for `EntryIoError` (table D.1/D.2) and `DocIoError` gains `exists`
  (409) for D.3.

## E. UI

Kit parts are imported **by file** in every new island (never `kit/index.ts`); Monaco only via `LazyCodeEditor`.
New islands (both `client:only="react"`): **EntryTools** (`src/ui/entry/EntryTools.tsx`), **NewEntryForm**
(`src/ui/forms/NewEntryForm.tsx`). CSS: `src/ui/entry/entry.css`, `src/ui/pickers/pickers.css` (`@layer cx-app`),
imported from `global.css` after `forms.css` (W5 adds both imports and creates the files as layer stubs).

### E.1 Detail pages — `src/pages/[dataset]/[slug]/index.astro` (W8a)

`getEntryDetail` (W3) adds to `EntryDetail` (all kinds except context/recipe):
```ts
relations: {
  linksTo: RelationRow[];      // okf/skill only ([] for reference)
  linkedFrom: RelationRow[];
  /** project only */ children?: RelationRow[];
  parents: RelationRow[];      // in child edges
};
/** ISO mtime of main.md / SKILL.md */ fileModified?: string;
interface RelationRow {
  key: string; dataset: LinkableDatasetId; slug: string;
  rel: OutRel; label: string;        // ENTRY_REL_LABELS / ENTRY_REL_INVERSE_LABELS / 'Mentions' / 'Mentioned by'
  title: string; state?: string; missing: boolean;
  source: 'frontmatter' | 'body'; files: string[];
}
```
Titles/states come from `listAllEntries()` (a `Map` by key); a target not in it is `missing: true`, title = slug.

Layout additions (okf + skill; reference gets Linked from + Add to context only):

| where | what | DOM / test ids |
|---|---|---|
| header meta | state select replaces `StateBadge` (lifecycle) | `StateSelect.astro` (E.3) `data-testid="state-select"` |
| header meta | one chip per parent: `Part of <title>` → parent URL | `<a class="ck-badge ck-badge--ds" data-ds="project" data-testid="detail-parent">` |
| header actions | `Add to context` | `<button class="ck-button ck-button--secondary ck-button--sm" data-entry-action="add-to-context" disabled data-testid="entry-add-to-context">` |
| header actions | EntryTools island + its status line | `entry-status` |
| above content (main col) | invalid banner when `summary.invalid` | `InvalidBanner.astro`: `<div class="cx-invalid" role="alert" data-testid="invalid-banner">` heading "This entry's file is invalid", `<ul>` of `<code>path</code> message`, text "Lists and this page show the file as it is on disk; fix it in the editor.", link `?edit=1` `invalid-fix` (okf/skill) |
| project, main col, before DocEditor | Children panel | `ChildrenPanel.astro` (E.2) |
| aside, after FileTree (okf/skill) / after MetaPanel (reference) | Links to / Linked from (reference: Linked from only) | `RelationPanels.astro` (E.2) |
| Details panel title | `Edit` button (okf + skill) | `data-entry-action="frontmatter"` `data-testid="meta-edit"` (MetaPanel gets `editable?: boolean`) |
| Files panel title | `+ New concept` (okf) | `data-entry-action="new-concept"` `data-testid="files-new-concept"` (FileTree gets `canCreate?: boolean`) |

All `data-entry-action` buttons render `disabled`; EntryTools enables them on mount (MarkdownTargets pattern).

Doc page `src/pages/[dataset]/[slug]/doc/[...path].astro` (W8a): `docPath` ending `.md` → 301 to the extensionless
URL (UX-32). Missing file but existing bundle and `normalizeDocPath(docPath + '.md')` classifies as `concept` →
status 404 page (Base, breadcrumbs) with `<section data-testid="doc-missing">` "`<path>.md` doesn't exist yet in this
bundle." + `<button data-entry-action="new-concept" data-path="<path>.md" disabled data-testid="doc-missing-create">
Create <path>.md</button>` and the EntryTools island (kind okf). Every existing doc page also mounts EntryTools
(minimal props: `relationKeys: []`, `children: []`, `related: []`, `linkedContexts` from its backRefs) and passes
`canCreate` to its FileTree, so `+ New concept` works there too. `getDocDetail` (W3) falls back to reading the file
from disk + `renderMarkdown` when the `docs` collection has no entry yet (new concepts open at once).

### E.2 SSR panels (W8a, `src/components/`)

`RelationPanels.astro` props `{ dataset, slug, linksTo, linkedFrom, canEdit: boolean }`:
- `<section class="cx-panel" data-testid="detail-links-to">` title "Links to" + count; actions: `+ Link`
  (`data-entry-action="add-relation"`, `data-testid="relation-add"`, only `canEdit` = okf). Rows `<li class="cx-minilist__row
  cx-rowlink cx-relrow" data-testid="relation-row" data-key data-rel data-source>`: rel label (`cx-relrow__rel`),
  `DatasetBadge`, title link (`cx-rowlink__main`), `StateBadge`, `missing` badge (`ck-badge--danger`), body
  mentions show `in concepts/x.md` for files ≠ the entry file, frontmatter rows (canEdit) get a ghost `×` button
  `data-entry-action="remove-relation" data-key data-rel disabled data-testid="relation-remove"`. Empty: "No links
  yet." + (canEdit) "Use + Link or type `[[` in the editor."
- `<section data-testid="detail-linked-from">` "Linked from", same rows (no remove). Empty: "Nothing links here yet."

`ChildrenPanel.astro` (project) props `{ slug, children: RelationRow[] }`:
`<section class="cx-panel cx-children" data-testid="children-panel">` title "Children" + count +
`<span data-testid="children-progress">N of M done</span>` (M = children with a lifecycle state, N = group `done`;
omitted when M = 0). Actions: `+ Add existing` (`data-entry-action="add-child"`, `children-add`), `Build context`
(`data-entry-action="build-context"`, `entry-build-context`). Rows `data-testid="children-row" data-key`: DatasetBadge,
title, StateBadge, remove `data-entry-action="remove-child" data-key` (`children-remove`). Footer: "New:" links
`/new/<ds>?parent=<slug>` for task, feature, idea, bug (`children-new-<ds>`) and "View:" links per dataset present
`/<ds>?project=<slug>` with counts (`children-view-<ds>`).

`InvalidBadge.astro` `{ issues }` → `<span class="ck-badge ck-badge--danger" title="<first issue>"
data-testid="invalid-badge">invalid</span>`; used in `EntryTable` (entry cell), `EntryMiniList`, `InvalidBanner`.

### E.3 State select (W8a: `StateSelect.astro`, `shell.ts`, `app.css`)

```html
<span class="cx-statesel" data-state-group="<group>">
  <label class="ck-sr-only" for="ss-<ds>-<slug>">State of <title></label>
  <select id="ss-<ds>-<slug>" class="ck-native-select cx-statesel__select" data-state-select
          data-dataset="<ds>" data-slug="<slug>" data-testid="state-select">
    <!-- current value not a registry state: first option value=<raw> selected disabled "<raw> (invalid)" -->
    <option value="<id>" selected?>Label</option> …
  </select>
  <output class="cx-statesel__status" data-state-status data-testid="state-select-status" aria-live="polite"></output>
</span>
```
`shell.ts` section "State select": delegated `change` on `select[data-state-select]` → remember the previous value
(`data-prev`, set on `focusin`/initial), disable, `fetch('PATCH /api/entry/<ds>/<slug>', {state})` → 200: update
`data-state-group` of the wrapper, status "Saved" (cleared after 4 s); the dev reload re-renders the page with the
same URL. Error: restore `data-prev`, status = server message (`data-kind="error"`), re-enable. CSS: `.cx-statesel
select` small height (`--row-h`), the dot color by `data-state-group` like `.ck-badge--state`; inside `cx-rowlink`
rows the select already sits above the overlay (`select` is in the G.5 rule).
List rows: `EntryTable` column `state` renders `StateSelect` (lifecycle datasets). Detail header: same component.
EntryTools disables every `select[data-state-select]` and `[data-entry-action]` while `$docEdit` is true
(`title="Leave the editor first"`), so a PATCH can never invalidate an open draft's base.

### E.4 Lists and dashboard (W8a)

- `src/pages/[dataset]/index.astro`: `newHref = /new/<ds>` for every dataset (`?parent=<project>` added when the
  `project` filter is active). `params.project` (W3, §E.9) → `keys = new Set(childrenOf(graph, 'project/<p>'))`,
  passed to `filterEntries`. `FilterForm.astro` (gets `projectTitle?: string`): when `project` is set, a
  `<fieldset class="cx-filters__facet">` legend "Project" with one checked `ChipCheckbox` (`name="project"`,
  `value=<slug>`, label = the project's title, else the slug + " (missing)", `id="f-project"`,
  `testid="list-project-chip"`); unticking it submits through the existing enhanced-form `change` handler, which
  drops the param. `anyActive` includes it.
- `EntryTable` / `EntryMiniList`: `InvalidBadge` when `e.invalid`.
- Dashboard `src/pages/index.astro`: Panel "Invalid files" (`dashboard-invalid`, count) listing every summary with
  `invalid` (EntryMiniList), rendered only when non-empty, first in `cx-dash__side`.

### E.5 EntryTools island (W8b) — `src/ui/entry/`

Files: `EntryTools.tsx` (default export), `FrontmatterDialog.tsx`, `RelationDialog.tsx`, `AddToContextDialog.tsx`,
`BuildContextDialog.tsx`, `NewConceptDialog.tsx`, `entry-api.ts` (browser-safe wrappers over `ui/edit/api.ts`
`sendJson`/`getJson`: `getEntry`, `patchEntry`, `appendContextLinks`, `createContext`, `createConcept`),
`after-write.ts` (`STATUS_KEY = (ds, slug) => 'entry:' + ds + '/' + slug`; `afterWrite(key, message, { devReload })`
= `rememberSave` then `location.reload()` — at once when `devReload` is false, after `RELOAD_FALLBACK_MS` (2000)
otherwise, the dev reload normally comes first), `entry.css`.

Props (SSR, from `getEntryDetail`):
```ts
export interface EntryToolsProps {
  dataset: LinkableDatasetId; slug: string; title: string;
  kind: 'okf' | 'skill' | 'reference';
  /** frontmatter relation keys (okf) → excluded from the pickers */ relationKeys: string[];
  /** project only */ children: { key: string; title: string }[];
  /** related + depends-on targets (build-context, unchecked by default) */ related: { key: string; title: string }[];
  /** contexts that already link this entry (backRefs) */ linkedContexts: string[];
}
```
On mount: enable `[data-entry-action]`, delegate clicks (`closest('[data-entry-action]')`), show
`takeSave(STATUS_KEY)` in `<p role="status" class="cx-entry__status" data-testid="entry-status">` for 6 s. React state
(`useState`) holds which dialog is open (ephemeral UI, not URL state). Disable rule of E.3.

| action | dialog / effect | test ids | write | after |
|---|---|---|---|---|
| `frontmatter` | `FrontmatterDialog`: on open GET `/api/entry`; fields okf: Title (`TextField`), Description, Tags (`TagEditor` prefix `fm`), State (`Select`, lifecycle), Stale after (`TextField` mono, placeholder `YYYY-MM-DD`, live date check, buttons +30 d / +90 d / Clear), Status (`Select`: None/Draft/Stable/Deprecated); skill: Description only. SaveBar sends only changed keys + `ifUnmodifiedSince`. 400 issues shown on their fields; 409 → inline "Changed on disk" + `Reload` (re-GET). | `fm-dialog`, `fm-title`, `fm-description`, `fm-tags`, `fm-add-tag`, `fm-state`, `fm-stale-after`, `fm-stale-plus30`, `fm-stale-plus90`, `fm-stale-clear`, `fm-okf-status`, `fm-save`, `fm-cancel`, `fm-status`, `fm-reload` | PATCH | `afterWrite('Saved details', devReload)` |
| `add-relation` | `RelationDialog` mode `relation`: `EntryPicker` (all linkable datasets, exclude self + `relationKeys`) with `extra` = rel `Select` (Related default, Depends on, Child) | `relation-picker`, `relation-rel` | PATCH `addLinks` | `afterWrite('Linked <title>')` |
| `add-child` | `RelationDialog` mode `child` (rel fixed `child`, no Select) | `relation-picker` (`data-mode="child"`) | PATCH `addLinks` | same |
| `remove-relation` / `remove-child` | `ConfirmDialog` "Remove the link to <title>?" (button data carries key + rel) | `relation-remove-dialog` | PATCH `removeLinks` | `afterWrite('Removed link')` |
| `add-to-context` | `AddToContextDialog`: context `Select` (`ensureEntries('context')`; `linkedContexts` disabled "already linked"; last option "New context…" shows a name `TextField` with `nameProblem` against existing contexts); Notes `LazyCodeEditor` compact markdown (optional) | `add-to-context-dialog`, `add-to-context-select`, `add-to-context-name`, `add-to-context-notes`, `add-to-context-submit`, `add-to-context-error` | POST `/api/context/:slug/links` or POST `/api/context` (`description: "Context for <title>."`) | `afterWrite('Added to <ctx>', {devReload:false})` |
| `build-context` | `BuildContextDialog`: Checkbox list: the project (checked, disabled), `children` (checked), `related` (unchecked); Target `Select` "New context" (default; name `TextField`, default = project slug when free) / existing contexts | `build-context-dialog`, `build-context-item` (`data-key`), `build-context-target`, `build-context-name`, `build-context-submit`, `build-context-error` | POST `/api/context` (`description: "Working set for <title>: the project and its children."`) or append | `location.assign('/forge?context=<name>')` |
| `new-concept` | `NewConceptDialog`: File name (kebab, `nameProblem`, preview `concepts/<name>.md`) — replaced by the fixed path when the button has `data-path`; Title (required; default from the name via `titleFromName`); Type (default `Concept`); Description (optional) | `new-concept-dialog`, `new-concept-name`, `new-concept-path`, `new-concept-title`, `new-concept-type`, `new-concept-description`, `new-concept-submit`, `new-concept-error` | POST `/api/doc/<ds>/<slug>/<path>` | `location.assign(url + '?edit=1')` |

### E.6 EntryPicker (W5) — `src/ui/pickers/EntryPicker.tsx`

```ts
export interface EntryPickerProps {
  isOpen: boolean;
  title: string;                                  // 'Insert link to entry', 'Add child', 'Link to entry'
  datasets?: readonly LinkableDatasetId[];        // default LINKABLE_DATASETS; >1 → an 'All' chip first (default)
  exclude?: ReadonlySet<string>;                  // 'ds/slug': row disabled, label "added"
  actionLabel?: string;                           // row button, default 'Insert'
  extra?: ReactNode;                              // above the list (e.g. the rel Select)
  onPick(entry: EntrySummary): void;              // caller closes
  onClose(): void;
  testId?: string;                                // default 'link-picker'
}
```
Kit `Modal` + `Dialog` (`cx-picker`, width `min(720px, 92vw)`), `SearchField` (`<testId>-search`, autofocus),
`ChipGroup` single-select of datasets (`<testId>-ds-<id|all>`), `GridList` rows reusing the Discover row markup
(`cx-discover__*` classes: title, slug, DatasetBadge, StateBadge, description), `<testId>-row` `data-key`; Enter /
`onAction` / the row button (`<testId>-pick`) picks; footer Cancel (`<testId>-cancel`). Data: `$entries` +
`ensureAllEntries()` on open; filter with `filterEntries({ q })`; sort by registry dataset order then title; cap 200
rows ("Showing 200 of N — refine the filter"). Search text and chip are `useState` (ephemeral).

### E.7 Create forms (W9)

`src/pages/new/[dataset].astro`: every dataset. yaml → `DataForm` (unchanged); okf + skill → `<NewEntryForm
client:only="react" dataset={id} parent={parseNewEntryUrl(Astro.url.searchParams).parent}>` (fallback
`cx-island-fallback`).

`NewEntryForm` (`<form class="cx-dform" data-testid="new-entry-form">`, kit `Form`, `validationBehavior="aria"`):
Name (`new-name`, mono, autofocus, `nameProblem(v, existing, singular)` live; existing = `ensureEntries(ds)` slugs),
Title (okf; placeholder `titleFromName(name)`; `new-title`), Description (required; `new-description`), State (lifecycle
`Select`, default first state; `new-state`), Tags (okf, `TagEditor` prefix `new` → `new-tags`, `new-add-tag`), Part of
project (`Select` "None" + projects from `ensureEntries('project')`, prefilled from `parent`; `new-parent`), buttons
`Create <singular>` (`new-submit`) and Cancel link to `/<ds>` (`new-cancel`), status/error `new-error`. Submit → POST
`/api/entry/<ds>`; 409 → name error "A <singular> with this name already exists"; 400 → issues on fields; 201 →
`rememberSave('new-entry-nav', Date.now() + '|' + url)` → `location.assign(url)`; on mount, a fresh (< 15 s) parked
URL resumes the navigation (the `data-form.ts` `resumeNavigation` pattern; covers a dev reload landing first). The
reference placeholder URI is gone because reference creation only goes through DataForm.

Tools (`src/ui/tools/AddEntryForm.tsx` → rewritten, `src/stores/tools.ts`): the panel keeps
`<section id="add-entry" data-testid="tools-add">` (smoke.spec) and the dataset `Select`
(`tools-add-dataset`, `?add=` URL state — `select.spec.ts` unchanged) and shows `ButtonLink` "Open the New <singular>
form" → `/new/<ds>` (`tools-add-open-form`) + `<code>pnpm run add:<ds> <name></code>` hint (`tools-add-cli`). Delete
the name/title/description fields, `runScript('add')` call site, `follow`/`followUntil`/`followTimedOut`, the
`created` result panel and `waitForEntry` import from the tools store; check-script runs and their sessionStorage
persistence stay. `add` stays in the scripts allowlist (CLI and e2e API use it).

### E.8 Forge / Inflate (W7)

- **All tab** (UX-10): `ForgeUrl.dataset` / `InflateUrl.dataset` type `DiscoverDataset = LinkableDatasetId | 'all'`
  (§E.9). Tab `all` first, label "All", count = sum (`forge-tab-all`, `inflate-tab-all`). `$discover` (forge) and the
  ad hoc list (inflate) for `'all'` merge every linkable dataset (status `ready` only when all are; state chips
  hidden; tag chips over the merge); rows show a `DatasetBadge`. PURE helper `mergeEntries(map, datasets)` in
  `entry-filter.ts` (W3).
- **Add with children** (UX-10): Discover rows whose `entry.relations` has `child` edges get `+ Add with N children`
  (`forge-add-children`, N = children not yet linked); store action `addLinks(keys: {dataset, slug}[])` appends the
  row entry then its children (file order), skipping present ones.
- Tab strips wrap: `.cx-forge__tablist { flex-wrap: wrap; }` (UX-21; also used by Inflate).
- **Drafts** (§G).

### E.9 URL state (W3, `src/lib/url-state.ts`)

| page | param | values |
|---|---|---|
| `/<ds>` list | `project` | a valid name; children of `project/<slug>` only (any dataset) |
| `/forge` | `dataset` | adds `all` (default stays `kb`) |
| `/inflate` | `dataset` | adds `all` (default stays `kb`) |
| `/new/<ds>` | `parent` | a valid project slug (prefill only) |

`ListParams.project: string | null`; `parseNewEntryUrl(params): { parent: string | null }`; `forgeHref` /
`inflateHref` unchanged otherwise. `EntryFilter.keys?: ReadonlySet<string> | null` (`ds/slug`; null/undefined = all).

## F. Monaco completion + Insert link

### F.1 PURE `src/lib/link-insert.ts` (W5)

```ts
export type LinkCompletionKind = 'target' | 'paren' | 'wiki' | 'word';
export interface LinkCompletionContext { kind: LinkCompletionKind; /** 0-based start of the replaced text in `before` */ start: number; typed: string }
/** `before` = line text left of the cursor. First match wins:
 *  target: /(?:^|[\s(<\[])ctxman:([a-z0-9/-]*)$/i → start = before.length - m[1].length
 *  paren:  /\]\(([^\s()]*)$/ and 'ctxman:'.startsWith(m[1].toLowerCase()) → start = before.length - m[1].length
 *  wiki:   /\[\[([^[\]]*)$/ → start = m.index (the `[[` is replaced)
 *  word:   only when opts.explicit (Ctrl+Space): /[\w-]*$/ → start = before.length - m[0].length
 *  else null */
export function linkCompletionContext(before: string, opts: { explicit: boolean }): LinkCompletionContext | null;
export function escapeLinkText(s: string): string;                  // \ [ ] escaped (== templates linkText)
export function markdownLink(title: string, ds: string, slug: string): string; // `[${esc}](ctxman:${ds}/${slug})`
/** target `ds/slug`; paren `ctxman:ds/slug` + (after.startsWith(')') ? '' : ')'); wiki/word markdownLink */
export function linkInsertText(kind: LinkCompletionKind, e: { dataset: string; slug: string; title: string }, after: string): string;
/** target `ds/slug title`; paren `ctxman:ds/slug title`; wiki `[[title ds/slug`; word `title ds/slug` */
export function linkFilterText(kind: LinkCompletionKind, e: { dataset: string; slug: string; title: string }): string;
```
`escapeLinkText` must give the same output as `templates.ts` `linkText` (test both on `a[b]\c`); templates.ts is
not changed for this.

### F.2 `src/ui/editor/link-completion.ts` (BROWSER, W5) + `monaco-setup.ts`

`registerLinkCompletion(monaco)` is called once from `monaco-setup.ts` after `defineTheme`:
```ts
monaco.languages.registerCompletionProvider('markdown', {
  triggerCharacters: [':', '(', '[', '/'],
  async provideCompletionItems(model, position, context) {
    const line = model.getLineContent(position.lineNumber);
    const before = line.slice(0, position.column - 1), after = line.slice(position.column - 1);
    const ctx = linkCompletionContext(before, { explicit: context.triggerKind === monaco.languages.CompletionTriggerKind.Invoke });
    if (ctx === null) return { suggestions: [] };
    const entries = await loadAllEntries();           // stores/entries.ts (W5)
    const range = new monaco.Range(position.lineNumber, ctx.start + 1, position.lineNumber, position.column);
    return { suggestions: entries.map((e, i) => ({
      label: { label: e.title ?? e.name, description: `${e.dataset}/${e.slug}` },
      kind: monaco.languages.CompletionItemKind.Reference,
      detail: datasetDef(e.dataset).label + (e.state ? ` · ${stateLabel(e.state)}` : ''),
      documentation: e.description,
      insertText: linkInsertText(ctx.kind, t(e), after), filterText: linkFilterText(ctx.kind, t(e)),
      sortText: String(i).padStart(5, '0'), range })) };
  },
});
```
`loadAllEntries(datasets = LINKABLE_DATASETS, timeoutMs = 3000): Promise<EntrySummary[]>` (new in
`src/stores/entries.ts`): `ensureAllEntries`, resolves when every dataset is `ready`/`error` or at the timeout, with
the entries of the ready ones, sorted registry dataset order then title. Applies to every markdown Monaco model:
DocEditor, popups, Forge notes, Inflate blocks/preamble, DataForm preamble. Read-only models never trigger.

### F.3 Editor API (W5, `src/ui/editor/CodeEditor.tsx`)
`CodeEditorApi` gains `insertText(text)` (replace the primary selection via `executeEdits('ctxman', [{range:
selection, text, forceMoveMarkers: true}])`, push an undo stop, focus) and `selectedText(): string`. New prop
`onInsertLink?: () => void`: when given, `addAction({ id: 'ctxman.insertLink', label: 'Insert link to entry…',
keybindings: [CtrlCmd | Alt | KeyK], contextMenuGroupId: 'navigation', run: () => ref.current?.() })`.
`LazyCodeEditor` re-exports the types unchanged.

### F.4 Insert link buttons (W6)
- DocEditor (edit mode toolbar, before the SaveBar): `Button size="sm" variant="ghost"` "Insert link…"
  (`doc-insert-link`) + `onInsertLink` → `EntryPicker` (`testId="link-picker"`, all datasets, actionLabel 'Insert').
  Pick → `api.insertText(markdownLink(selectedText() || title, ds, slug))`.
- MarkdownModal: a `Toolbar` above the editor with the same button (`md-insert-link`), same picker.

## G. Draft persistence (UX-09)

`src/ui/edit/draft-backup.ts` (W5): storage = `localStorage` (wrapped in try/catch as today); stored value
`{ text, base, savedAt }`; `loadDraft` returns `{ text, base }` and removes + returns null when `Date.now() - savedAt
> DRAFT_TTL_MS` (14 days; a value without `savedAt` counts as fresh); new `hasDraft(key)`. Keys keep the
`ctxman:draft:` prefix.

| editor | key | text | base | restore | banner (test ids) | W |
|---|---|---|---|---|---|---|
| DocEditor | `doc:<ds>/<slug>/<path>` (unchanged) | markdown | `lastModified` | in `loadDoc`: draft ≠ disk text → restore; base ≠ `lastModified` → restore with `stale` | `doc-draft-restored` (`data-stale` when stale), `doc-draft-discard`; preview mode with `hasDraft` → `doc-draft-available` "Unsaved changes to this file · Resume editing" button `doc-draft-resume` (= `enterEdit`) | W6 |
| MarkdownModal | `md:<endpoint>#<target.id>` | notes/body | loaded `lastModified` | on load | `md-draft-restored`, `md-draft-discard` | W6 |
| Forge | `forge:<slug>` | `JSON.stringify(working)` | `lastModified` of GET/PUT/POST (new `$baselineModified`) | after `adopt` in `loadContext`: parse JSON, `contextSchema.safeParse`, `name === slug`, `!sameContext(draft, baseline)` → `$working.set`; else clear | `forge-draft-restored` (`data-stale`), `forge-draft-discard` (= `revert`) | W7 |
| Inflate | `inflate:<slug>` | `JSON.stringify(working)` | `lastModified` | same with `parseRecipe` / `sameRecipe` | `inflate-draft-restored`, `inflate-draft-discard` | W7 |

Write: Forge/Inflate `$working.listen` (registered in the URL store's `onMount`): dirty → `saveDraft`, clean →
`clearDraft`. Save success, revert, delete, confirmed context/recipe switch → `clearDraft` + banner off. `new` is
never persisted. Banner texts: fresh "Restored unsaved changes from earlier." / stale "Restored unsaved changes; the
file changed on disk since — saving overwrites it." Remove: `onBeforeUnload` + its listeners in `forge.ts` and
`inflate.ts`; `useUnsavedGuard` calls in `DocEditor.tsx` and `MarkdownModal.tsx`. Keep: DataForm's guard, every
in-app discard/confirm dialog, the Forge/Inflate `popstate` confirm.

## H. Brief quality (W4, `src/lib/inflate/`)

1. `catalog.ts` `defaultModeFor`: okf family → `'inline-main'` for every kind (kb, rca, idea, task, bug, feature,
   project).
2. `markdown.ts` new `dropEmptySections(body)`: remove an ATX heading line (outside code) whose next non-blank line
   is EOF or an ATX heading of the same or a higher level (fewer or equal `#`); repeat until stable. `render.ts`
   `renderBody` applies it after `stripLeadingTitle`, before `shiftHeadings`.
3. `render.ts` `okfBody` (inline-main and inline-bundle): when `includeFrontmatter` is off and the rendered main body
   (normalized: whitespace collapsed, lower case) does not contain the normalized `meta.description`, push the
   description (trimmed) as the FIRST part (before the frontmatter block / body).
4. Markdown blocks: `markdown.ts` `nestHeadings(body, base)` = `min ATX level < base ? shiftHeadings(body, base) :
   body`; `renderSegment` `'markdown'` uses `base = segment.group === null ? 2 : 3` (the level of items there).
   Manifest title of a block = its first ATX heading text, else `Markdown <id>` (UX-29).
5. Unresolved links: `rewriteLinks` takes `onUnresolved?(destination, reason: 'no-entry' | 'no-file' | 'escapes' |
   'malformed')`; called for a bundle destination that resolves to no bundle file or escapes, and a `ctxman:` one
   that is malformed or whose target is `null`. Destinations stay unchanged. `renderBody` forwards to a per-render
   collector; `renderPlan` emits `{ code: 'unresolved-link', key: <segment key>, message: '<ds>/<slug>/<rel>:
   link "<dest>" does not resolve (no such entry | no such file in the bundle | points outside the bundle |
   malformed ctxman: link)' }`, deduped by the existing `warningKey`. Add `'unresolved-link'` to
   `InflateWarningCode` (expand.ts).

Golden deltas (update the expected strings by exactly these lines; any other diff is a bug):
- `tests/unit/inflate-render.test.ts` "renderPlan golden document": after `'> **From context `ctx`:** Read this.', ''`
  insert `'A demo knowledge base entry.', ''`. `task/do-it` output unchanged (now inline-main: `# Do it` is an empty
  section, the description is printed — same text as the old summary). Flat/codex/generic: only `toContain` checks.
- "renderPlan with output: golden document (§9.6 seed)": insert the description paragraph (+ blank line) after the
  meta/notes of `kb/ctxman` ("What ctxman is, …checks."), `kb/astro-content-layer` ("How Astro 7 content
  collections, loaders and schemas work.") and `rca/astro-dev-full-reload-on-save` ("Saving a context in the forge
  reloaded the whole page, because the loader watched the file."). idea/task/feature/project unchanged.
- line ~961 manifest row title `'Markdown b1'` → stays (that block has no heading) — if the fixture block has a
  heading, expect the heading text.
- `tests/unit/inflate-catalog.test.ts` `defaultModeFor` table: idea/task/bug/feature/project → `inline-main` ×3.
New tests: `dropEmptySections`, `nestHeadings`, description rule (body containing the description → not repeated),
unresolved-link warnings (missing ctxman target, missing bundle file, escaping path), block title.

## I. Seeds (W1) and e2e impact

- `data/project/ctxman-v1/main.md` frontmatter gains (block style, this order):
  `links:` child → feature/global-search, feature/context-forge, feature/tools-runner, task/write-agents-md,
  task/forge-e2e-coverage, task/seed-sample-data, task/windows-smoke-test, bug/forge-reorder-focus,
  bug/stale-badge-timezone, idea/okf-graph-view; related → kb/ctxman, idea/context-inflate, idea/git-based-freshness,
  feature/inflate-working-dir. Body "Related": drop the hand-written "(in progress)" / "(pending)" / "(complete)"
  states (UX-25).
- `data/task/forge-e2e-coverage/main.md`: `links: [{dataset: feature, slug: context-forge, rel: depends-on}]`.
- Add a dated line to each bundle's `log.md`; `pnpm run check` 0 errors / 0 warnings.

E2E assertions that change: `api.spec.ts` "search index … documented shape" `docs.length > 50` → `> 40` (index.md and
log.md leave the index, 52 docs remain); `tools.spec.ts` add-entry tests (rewritten, §J); `recipe.spec.ts` keeps
`/new/recipe`; no other existing assertion depends on the seed project's frontmatter. Specs that add children must
use their own `e2e-*` project (never `ctxman-v1`), so `/task?project=ctxman-v1` stays exactly the 4 seed tasks.

## J. Tests

Unit (vitest; fixtures in temp dirs via `tests/unit/fixtures/data-fixtures.ts`, never `./data`):

| file | packet | covers |
|---|---|---|
| `schemas.test.ts` (+) | W1 | `links` default rel, duplicate → `links.1` issue, extend keeps it, strict item |
| `registry.test.ts` (+) | W1 | `isEntryRel`, label tables complete |
| `entry-index.test.ts` (new) | W1 | entries + issues (bad YAML, schema, name mismatch), relations (bad item skipped), mentions (code masked, self skipped, non-linkable dropped), `lastModified` == `lastModifiedOf`, `parsed` = N then 0 then 1 after touching one file, vanished dir dropped, memo + `invalidateEntryIndex` |
| `relations.test.ts` (new) | W1 | out/in, inverse ordering, frontmatter beats mention, children/parents order |
| `links.test.ts` (+) | W1 | `checkFileLinks` parity with `checkLinks`, `relation-target`, `relation-self`, `rewriteRenderedHtml` broken marking (§W1) |
| `frontmatter-patch.test.ts` (new) | W2 | untouched bytes identical (comments, folded scalars, flow seqs, timestamps with `Z`, unknown keys), set/replace/delete, anchors, flow kept, CRLF + BOM kept, duplicate key / no frontmatter / non-map fail, `changed:false` no-op |
| `entry-io.test.ts` (new) | W2 | GET JSON-safe dates; PATCH each key + normalization; invalid → nothing written; conflict; invalid-file; add/removeLinks merge; skill only description; lock serializes two concurrent PATCHes |
| `entry-create.test.ts` (new) | W2 | create okf (tags, state) + skill, exists, rollback on invalid, parent link appended / parent missing → 400 nothing written |
| `doc-io.test.ts` (+) | W2 | `createDoc` (index `## Concepts` insert/append, bullet style, log today/new heading, 409, reserved paths), PUT warnings include link findings |
| `context-io.test.ts` (+) | W2 | `appendContextLinks` added/skipped, invalid, invalid-file |
| `http.test.ts` (+), `templates.test.ts` (+ tags) | W2 | mappings; template output unchanged without tags |
| `entry-summary.test.ts` (+), `entry-filter.test.ts` (+), `url-state.test.ts` (+) | W3 | `relations` only when present; `keys`, `mergeEntries`; `project`, `dataset=all`, `parseNewEntryUrl` |
| `inflate-catalog/markdown/render.test.ts` (±) | W4 | §H |
| `link-insert.test.ts` (new), `entries-store.test.ts` (+ `loadAllEntries`), `edit-helpers.test.ts` (localStorage, TTL, `hasDraft`) | W5 | |
| `doc-editor.test.ts` (±) | W6 | localStorage stub; stale-base draft restored (was: cleared); `hasDraft` → available flag |
| `forge-store.test.ts` (+), `inflate-store.test.ts` (+) | W7 | draft save/clear/restore (fresh, stale, invalid JSON dropped), no beforeunload listener, `addLinks`, `dataset=all` view |
| `tools-store.test.ts` (−) | W9 | delete the follow describes; keep run persistence tests |

E2E (Playwright, own `e2e-*` names, create via `POST /api/entry`, use `settleDevReload()` after API writes before
asserting a page):

| spec | packet | cases |
|---|---|---|
| `api-entry.spec.ts` (new) | W2 | PATCH state → file has new state + body/unknown key intact; invalid state → 400, file unchanged; 409; 415/403; POST create with parent → project has child link; POST concept → 201, index.md line, 409 again; context links append added/skipped |
| `api-doc.spec.ts` (+) | W2 | PUT with a broken `./x.md` and `ctxman:idea/e2e-nope` → `warnings` has `links/broken` + `links/ctxman-target` |
| `api.spec.ts` (±) | W3 | search docs count; `/api/entries?dataset=project` → `ctxman-v1.relations` has 10 `child` |
| `doc-edit.spec.ts` (+) | W6 | `[[Write` → suggest widget (`.monaco-editor .suggest-widget.visible`) shows "Write AGENTS.md", Enter → text has `[Write AGENTS.md](ctxman:task/write-agents-md)`; `](` → `ctxman:` items; `doc-insert-link` → `link-picker` → search `okf-format` → pick → `](ctxman:kb/okf-format)`; save with broken links → `doc-status` "Saved · 2 warnings", `doc-warnings` lists both rules, preview has 2 `a.cx-link--broken`; reload with a dirty draft: no `dialog` event, `doc-draft-restored` |
| `md-popup.spec.ts` (+) | W6 | `md-insert-link` inserts; draft survives `page.reload()` (`md-draft-restored`) |
| `forge.spec.ts` (+) | W7 | `forge-tab-all` lists rows of several datasets; add from All; `forge-add-children` on `project/ctxman-v1` adds 11; dirty + `page.reload()` → no `dialog`, `forge-draft-restored`, link present; Discard → back to saved |
| `inflate.spec.ts` (+) | W7 | `inflate-tab-all`; draft restore after reload |
| `entry-tools.spec.ts` (new) | W8a | `meta-edit` → `fm-dialog` title/tags/stale/status → Save → header title changes after reload, file keeps an unknown key + body; `entry-add-to-context` → existing e2e context → `entry-status` "Added to …", backrefs lists it; new context path; `files-new-concept` → URL `…/doc/concepts/<n>?edit=1`, Files panel lists it, index.md has the line; doc 404 → `doc-missing-create` → created; `….md` URL → redirect |
| `relations.spec.ts` (new) | W8a | e2e project + 2 tasks (one via `parent`, one via `children-add` picker) → `children-panel` rows, `children-progress`; task page `detail-parent` + `detail-linked-from` "Parent"; `relation-add` with Depends on → both pages show it; `relation-remove` / `children-remove` → gone, file has no `links:` when empty; `/task?project=<p>` lists exactly its tasks + checked `list-project-chip`, unticking it drops `project` from the URL; `entry-build-context` → `/forge?context=<p>` with 3 links |
| `list-filters.spec.ts` (+) | W8a | `/task?state=pending`: change an e2e task's `state-select` to in-progress → `state-select-status` "Saved", after reload the row is gone, URL unchanged; invalid file (write `state: done` with fs) → `invalid-badge` in the list and `dashboard-invalid`, `invalid-banner` on the detail page, header select shows "done (invalid)" |
| `smoke.spec.ts` (+) | W8a | `/project/ctxman-v1` (`children-panel`); `/new/task`, `/new/skill` (`new-entry-form`) |
| `forms.spec.ts` (+) | W9 | `/new/task?parent=<e2e project>`: name/title/description/state/tags → Create → `/task/<n>` with state badge + tags, project lists the child; 409 name error; `/new/skill` create; `/kb` `list-new-entry` href `/new/kb` |
| `tools.spec.ts` (±) | W9 | keep `?add=` preselect + select tests; `tools-add-open-form` href `/new/<ds>`; delete the create/follow tests |

## K. Docs chain (W10)

AGENTS.md: repo map (`src/lib/{entry-index,relations,frontmatter-patch,entry-io,entry-create,atomic-write,
link-insert}.ts`, `src/ui/{entry,pickers}`), islands sentence (9, list them), routes (`/new/<ds>` for all) and API
list (`GET|PATCH /api/entry/:dataset/:slug`, `POST /api/entry/:dataset`, `POST /api/doc/…` create, `POST
/api/context/:slug/links`), URL state (`project`, `dataset=all`, `parent`), datasets table note (okf `links` field,
`rel`), layering lines for the new libs (entry-index NODE, relations PURE, frontmatter-patch PURE, link-insert PURE),
Caveats: entries read okf/skill frontmatter from disk (collections only render), drafts in localStorage (14 days) and
no beforeunload prompt except DataForm, PATCH never writes invalid frontmatter while the doc editor saves invalid
markdown with warnings, "Create entries with the scripts or the `/new/<ds>` forms".

`data/kb/ctxman`: new `concepts/relations.md` (type Concept: `links` field, rels + inverse labels, mentions, the
index and its caching, panels, `project=` filter, Children/Build context, check rules) listed in `index.md`;
update `datasets.md` (links field), `adding-entries.md` (`/new/<ds>`, parent, Tools link), `routes-and-api.md`,
`editing.md` (frontmatter dialog, state select, drafts, completion/picker, no native prompt, entries from disk),
`compliance-checks.md` (`links/relation-target`, `links/relation-self`), `context-forge.md` (All tab, add with
children, Add to context, Build context), `context-inflate.md` (defaults, description rule, empty sections, block
nesting/titles, `unresolved-link`), `search.md` (index/log excluded), `architecture.md` (new modules + layering,
islands), `runtime-modes.md` (disk-backed summaries vs collections); dated line at the top of `log.md`.
`data/skill/ctxman-add-entry/SKILL.md`: UI create forms, `parent`, `links` frontmatter. Track the work: `pnpm run
add:feature entry-relations --title "Entry relations" --description "Structured links between entries, managed in
the UI." --state complete`, then link it as `related` from `kb/ctxman` main.md frontmatter. Finish with `pnpm run check`
0/0 and `pnpm run test:all`.

## L. Work packets

Disjoint file ownership; a file not listed is not touched. Dependencies are by API/module contract.

| packet | owns | depends on | acceptance |
|---|---|---|---|
| **W1 Model + index + checks** | `src/datasets/{registry,schemas}.ts`, `src/lib/{entry-index,relations}.ts` (new), `src/lib/links.ts` (`checkFileLinks`, `checkFrontmatterLinks`, `checkLinks` refactor; `rewriteRenderedHtml(html, ctx & { dataDir?: string })`: with `dataDir`, a `ctxman:` target whose entry file is missing, a malformed `ctxman:` href, or a bundle target that does not exist gets `class="cx-link--broken"` (merged into an existing class) and `title="Missing: <ds>/<slug>"` / `"Missing file: <path>"` / `"Invalid ctxman: link"`), `data/project/ctxman-v1/**`, `data/task/forge-e2e-coverage/**`, tests `schemas`, `registry`, `entry-index`, `relations`, `links` | — | unit; `pnpm run check` 0/0 |
| **W2 Write APIs** | `src/lib/{frontmatter-patch,entry-io,entry-create,atomic-write}.ts` (new), `src/lib/{templates,doc-io,context-io,http}.ts`, `scripts/add-entry.ts`, `src/pages/api/entry/**` (new), `src/pages/api/doc/[dataset]/[slug]/[...path].ts`, `src/pages/api/context/[slug]/links.ts` (new; + move of `[slug].ts` only if needed), tests `frontmatter-patch`, `entry-io`, `entry-create`, `doc-io`, `context-io`, `http`, `templates`, `scripts` (must stay green), e2e `api-entry.spec.ts`, `api-doc.spec.ts` | W1 | unit; those e2e |
| **W3 Read path** | `src/lib/{entries,entry-summary,entry-filter,url-state}.ts`, tests `entry-summary`, `entry-filter`, `url-state`, e2e `api.spec.ts` | W1 | unit; `api.spec.ts`, `smoke.spec.ts`, `detail.spec.ts`, `list-filters.spec.ts` stay green |
| **W4 Brief quality** | `src/lib/inflate/{catalog,markdown,render,expand}.ts`, tests `inflate-catalog`, `inflate-markdown`, `inflate-render` (+ any inflate test whose expectation follows from §H) | — | unit; `inflate.spec.ts`, `api-inflate*.spec.ts` green |
| **W5 Editor infra** | `src/lib/link-insert.ts` (new), `src/ui/editor/{link-completion.ts (new),monaco-setup.ts,CodeEditor.tsx,LazyCodeEditor.tsx}`, `src/stores/entries.ts`, `src/ui/pickers/**` (new), `src/ui/edit/{draft-backup.ts,TagEditor.tsx}` (UX-26: split typed text on `,` and whitespace into tags on change; commit pending text on blur; placeholder "add tags"), `src/styles/global.css` (imports of `../ui/pickers/pickers.css` and `../ui/entry/entry.css`; create `src/ui/entry/entry.css` as `@layer cx-app {}` stub owned by W8b afterwards), tests `link-insert`, `entries-store`, `edit-helpers` | — | unit; `forge.spec.ts`, `forms.spec.ts` green |
| **W6 Doc editor + popups** | `src/ui/markdown/{DocEditor,MarkdownModal}.tsx`, `src/ui/markdown/markdown.css`, `src/stores/doc-editor.ts`, tests `doc-editor`, e2e `doc-edit.spec.ts`, `md-popup.spec.ts` | W2 (warnings), W5 | unit; those e2e |
| **W7 Forge + Inflate** | `src/stores/{forge,inflate}.ts`, `src/ui/forge/**`, `src/ui/inflate/{AdhocDiscover,RecipeBar,Inflate}.tsx`, `src/ui/inflate/inflate.css`, tests `forge-store`, `inflate-store`, e2e `forge.spec.ts`, `inflate.spec.ts` | W3, W5 | unit; those e2e |
| **W8b EntryTools island** | `src/ui/entry/**` | W2, W5 | typecheck/lint/unit (e2e in W8a) |
| **W8a Pages + SSR** | `src/pages/[dataset]/index.astro`, `src/pages/[dataset]/[slug]/index.astro`, `src/pages/[dataset]/[slug]/doc/[...path].astro`, `src/pages/index.astro`, `src/components/{EntryTable,EntryMiniList,DetailAside,FileTree,FilterForm,MetaPanel}.astro`, new `src/components/{StateSelect,RelationPanels,ChildrenPanel,InvalidBanner,InvalidBadge}.astro`, `src/scripts/shell.ts`, `src/styles/{app,prose}.css` (`cx-statesel`, `cx-relrow`, `cx-children`, `cx-invalid`, `.cx-prose a.cx-link--broken` = dashed danger underline + `cursor: help`), e2e `entry-tools.spec.ts`, `relations.spec.ts`, `list-filters.spec.ts`, `smoke.spec.ts`, `detail.spec.ts` | W3, W8b | those e2e |
| **W9 Create forms + Tools** | `src/pages/new/[dataset].astro`, `src/ui/forms/NewEntryForm.tsx` (new), `src/ui/forms/forms.css`, `src/ui/tools/**`, `src/stores/tools.ts`, `src/pages/tools.astro` (meta text), tests `tools-store`, e2e `forms.spec.ts`, `tools.spec.ts`, `select.spec.ts` (green) | W2, W3, W5 | those e2e |
| **W10 Docs + final** | `AGENTS.md`, `data/kb/ctxman/**`, `data/skill/ctxman-add-entry/**`, `data/feature/entry-relations/**` (new via script) | all | `pnpm run check` 0/0; `pnpm run test:all` |

Order: W1 → (W2 ∥ W3); W4 and W5 have no dependency and start at once; (W6 ∥ W7 ∥ W8b ∥ W9) start when their
dependencies (table) are in; then W8a; then W10.

Packet notes:
- W3 `entries.ts`: `listEntries(okf|skill)` = index entries of that dataset → `summarize(ds, slug, data, lastModified,
  nowMs)` + `invalid` (when `issues.length > 0`) — drop the `lastModifiedOf` calls there; `getEntryDetail(okf|skill)`
  = index entry (null → 404) + `html` from `loadEntry(...).rendered` when the collection has it, else
  `renderMarkdown(index body)`, both through `rewriteRenderedHtml(..., { dataDir })`; `data` = index `data`;
  `relations` + `fileModified` (§E.1); reference detail gets `relations.linkedFrom`/`parents`; context notes and
  recipe html pass `dataDir` too. `buildSearchIndex`: skip `docs` ids whose last segment is `index` or `log`.
  `summarize` (entry-summary.ts) adds `relations` when `data.links` parses (items via `entryLinkSchema.safeParse`,
  invalid ones skipped) and is non-empty; `EntrySummary` gains `invalid?: Issue[]` and `relations?: EntryLink[]`
  (`Issue` imported as a type from `context-io.ts`).
- W2 `patchEntry` and `createDoc` reject while another write to the same file is in flight only by waiting
  (`withFileLock`), never by erroring.
- W8b uses `$docEdit` from `src/stores/doc-editor.ts` (shared module instance across islands) for the disable rule.
- W9 `NewEntryForm` never imports Monaco (no markdown fields).
