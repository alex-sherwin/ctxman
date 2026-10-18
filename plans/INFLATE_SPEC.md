# Context Inflate — implementation spec (v1, 2026-10-17)

**Status: IMPLEMENTED 2026-10-17 (Q1-Q3 code, Q4 docs; e2e specs written by the e2e packet).** Kept for history and not maintained: the code, `AGENTS.md` and `data/kb/ctxman/concepts/context-inflate.md` win. Known deviations of the shipped code from this text: the dashboard and preview panes carry a few extra test ids (`dashboard-recipe`, `dashboard-recipe-new`, `inflate-manifest-warnings`).

Binding for the coding packets Q1–Q4 (§12). Read `AGENTS.md` first; its rules (pnpm only, erasable TS, layering,
URL-is-state, kit-only UI, Monaco for multi-line markdown, test ids) apply everywhere. Where this file names an
existing function, it was read in the source on 2026-10-17; call it exactly as named. Unknowns are decided here;
do not invent alternatives. Markdown examples use `~~~~` outer fences; `<D>` = absolute data dir
(`resolveDataDir()`), `<R>` = repo root (`process.cwd()`), `<H>` = `os.homedir()`.

## 0. Summary and deviations

The tool composes a **recipe** (new dataset `recipe`, `data/recipe/<name>.yaml`): selected contexts + ad hoc items +
per-item include modes + ordering + injected markdown + a preamble. Generating it produces one markdown document
plus a JSON manifest, for Claude Code, Codex or a generic agent. Contexts stay evergreen: expansion happens at
generate time.

Deviations from the orchestrator decisions (all small, with reasons):

| # | decision | change | why |
|---|---|---|---|
| D1 | `defaults: { [datasetId]: … }` | keyed by **ItemKind** (`kb`…`project`, `skill`, `local-repo`, `remote-repo`, `remote-skill`) | the three reference types have disjoint modes; a `reference` default would be ambiguous |
| D2 | order keys `ds/slug`, `md:<id>`, `ctx:<slug>` | plus one fixed key `sec:extra` ("Additional items" intro, grouped layout only) | ad hoc items that no context links need their own `##` section in grouped layout |
| D3 | Claude Code file pointers `@/abs/path` | `@path` is used **only** for "eager" pointers (option `eager`); every other path is a backticked absolute path for all targets | Claude Code expands `@path` (prompt or CLAUDE.md import) by loading the file; a lazy "read if relevant" pointer must not force-load. Backticks suppress expansion |
| D4 | archive install via `/tmp/<name>.tgz` | `.ctxman/tmp/<name>.(tgz|zip)` inside the project | `/tmp` is not cross-platform; one scratch dir (`.ctxman/`) for clones and downloads |
| D5 | `ctxman:` link → "title + absolute path" | destination replaced by the target's absolute entry-file path; link text kept | the link text already names the target; appending titles mangles sentences |
| D6 | tree limit "number input" | kit `Select` with fixed values 10/25/50/100/200/500 | no free-text validation state; still an option control |
| D7 | `/api/inflate/options` endpoint | not built; the catalog is the PURE module `src/lib/inflate/catalog.ts` imported by the island | one source of truth, no request, typed |
| D8 | write path: refuse outside home? | NOT restricted to home; refused: relative, non-`.md`, any `node_modules`/`.git` segment, inside the data dir | os.tmpdir() on macOS is outside home (e2e writes there); the server is local-only and Origin-checked |
| D9 | "exactly 3 islands" (AGENTS.md) | 4 islands: + `Inflate` (`client:only="react"`, prop `outDir`) | new tool page |
| D10 | composition list from server | the island runs the same PURE `expandRecipe` over cached `/api/entries` + `/api/context/:slug` data | instant reorder/mode feedback; the server re-expands for the real render |

## 1. Files (owner packet in brackets)

```text
src/datasets/registry.ts            [Q1] + recipe DatasetDef; LINKABLE_DATASETS unchanged (recipe NOT linkable)
src/datasets/schemas.ts             [Q1] + recipe zod schemas, DATASET_SCHEMAS.recipe, types
src/content.config.ts               [Q1] watcher-less yaml loader shared by context + recipe
src/lib/templates.ts                [Q1] recipe template           package.json "add:recipe" [Q1]
src/lib/recipe-io.ts         NODE   [Q1] new: read/list/create/write/delete recipe yaml (mirror of context-io.ts)
src/lib/collections-check.ts        [Q1] recipe yaml + reachability warnings
src/lib/entry-summary.ts            [Q1] EntrySummary.recipeTarget/contextCount/itemCount
src/lib/search-index.ts             [Q1] recipeToSearchDoc
src/lib/entries.ts   SERVER-ASTRO   [Q1] listEntries/getEntryDetail/buildSearchIndex for recipe
src/lib/url-state.ts                [Q1] parseInflateUrl, inflateHref
src/lib/inflate/catalog.ts   PURE   [Q1] targets, layouts, item kinds, modes, options, keys (the UI contract, §4)
src/lib/inflate/recipe.ts    PURE   [Q1] parseRecipe, recipeToYamlObject, serializeRecipe, sameRecipe (§3.3)
src/lib/inflate/expand.ts    PURE   [Q1] ExpandLookup, expandRecipe, applyOrder, itemMetaFromSummary (§5)
src/lib/inflate/markdown.ts  NODE*  [Q1] shiftHeadings, stripLeadingTitle, rewriteLinks, fenced, inlineCode, shQuote, guidance (§6.1)
src/lib/inflate/render.ts    NODE*  [Q1] renderPlan (§6)
src/lib/inflate/pipeline.ts  NODE*  [Q1] InflateSources, loadExpandInputs, gatherContent, inflateRecipe (§5.6, §6.2)
src/lib/inflate/fs-sources.ts NODE  [Q1] createFsSources (§5.7)
src/lib/inflate/write.ts     NODE   [Q1] checkOutputPath, writeOutput (§7.4)
data/recipe/ctxman-dev-brief.yaml   [Q1] seed (§10)
tests/unit/**                       [Q1] §11.1
src/lib/http.ts                     [Q2] recipeErrorResponse
src/pages/api/recipe/index.ts, [slug].ts, api/inflate/render.ts, write.ts   [Q2] §7
src/pages/[dataset]/index.astro, [dataset]/[slug]/index.astro, index.astro  [Q2] §8
src/components/{Header,MetaPanel,EntryTable,RecipeComposition(new)}.astro, src/layouts/Base.astro, src/styles/app.css [Q2]
src/pages/inflate.astro             [Q3] §9
src/ui/inflate/** (Inflate.tsx, RecipeBar.tsx, SourcesPane.tsx, AdhocDiscover.tsx, CompositionPane.tsx,
  SegmentRow.tsx, OptionControls.tsx, PreviewPane.tsx, NewRecipeDialog.tsx, format.ts, inflate.css)  [Q3]
src/stores/inflate.ts               [Q3]
src/styles/global.css, src/styles/tokens.css   [Q3] --ds-recipe + [data-ds='recipe'] + @import inflate.css
src/ui/tools/AddEntryForm.tsx       [Q3] "Open in Inflate" for created recipes
.gitignore, .oxlintrc.json, .oxfmtrc.json      [Q1] add `out/` (gitignore `out/`; lint/fmt ignore `out`/`out/**`)
tests/e2e/**, AGENTS.md, data/kb/ctxman/**, data/skill/ctxman-add-entry/SKILL.md, data/idea/context-inflate/**,
  data/context/ctxman-dev.yaml notes     [Q4]
```
`NODE*` = no fs calls of its own, but imports `src/lib/okf.ts` / `src/lib/links.ts` (NODE modules). Never import
`markdown.ts`, `render.ts`, `pipeline.ts`, `fs-sources.ts`, `write.ts` or `recipe-io.ts` from the island. The island
may import `catalog.ts`, `recipe.ts`, `expand.ts` (PURE). No barrel `index.ts` in `src/lib/inflate/`.

## 2. Registry (`src/datasets/registry.ts`)

- `DATASET_IDS` gets `'recipe'` appended (after `'context'`). `LINKABLE_DATASETS` is unchanged (its comment becomes
  "everything except context and recipe"). `OKF_DATASET_IDS` unchanged.
- `DATASETS` appends:
  ```ts
  {
    id: 'recipe',
    label: 'Inflate recipes',
    navLabel: 'Recipes',
    plural: 'recipes',
    singular: 'recipe',
    kind: 'data',
    entryFile: '.yaml',
    description: 'Saved Context Inflate compositions: contexts, extra items, include modes and ordering.',
  },
  ```
- Effects that need no code: nav link `nav-recipe`, dashboard tile `dataset-card-recipe`, search chip, `/tools` Add
  entry option, `freshness.ts` paths (`recipe/<slug>.yaml`), `run-script.ts` `created.path`, `collections/unknown-dir`.

## 3. Recipe data model

### 3.1 YAML example (exact serializer output for the seed, §10)
See §10. Key order is fixed by `recipeToYamlObject` (§3.3).

### 3.2 Zod (`src/datasets/schemas.ts`, appended after the context section)

```ts
import {
  BLOCK_ID_PATTERN, INFLATE_LAYOUTS, INFLATE_TARGETS, ITEM_KEY_PATTERN, ITEM_KINDS, MODE_IDS,
  SEGMENT_KEY_PATTERN, CLONE_DIR_MESSAGE, isModeFor, isSafeRelativeDir, parseItemKey, REFERENCE_MODE_IDS,
} from '../lib/inflate/catalog.ts';

export const inflateOptionsSchema = z.strictObject({
  includeFrontmatter: z.boolean().optional(),
  includeLog: z.boolean().optional(),
  shiftHeadings: z.boolean().optional(),
  rewriteLinks: z.boolean().optional(),
  eager: z.boolean().optional(),
  symlink: z.boolean().optional(),
  treeLimit: z.number().int().min(1).max(500).optional(),
  cloneDir: z.string().min(1).max(200).refine(isSafeRelativeDir, { error: CLONE_DIR_MESSAGE }).optional(),
  shallow: z.boolean().optional(),
  sparse: z.boolean().optional(),
});
export const recipeItemSchema = z.strictObject({ dataset: z.enum(LINKABLE_DATASETS), slug: nameSchema });
export const recipeMarkdownSchema = z.strictObject({
  id: z.string().min(1).max(NAME_MAX_LENGTH).regex(BLOCK_ID_PATTERN, 'must be kebab-case, e.g. b1'),
  body: z.string(),
});
export const recipeOverrideSchema = z.strictObject({
  key: z.string().regex(ITEM_KEY_PATTERN, 'must be <dataset>/<slug> of a linkable dataset'),
  mode: z.enum(MODE_IDS).optional(),
  options: inflateOptionsSchema.optional(),
  exclude: z.boolean().optional(),
});
const kindDefaultSchema = z.strictObject({ mode: z.enum(MODE_IDS).optional(), options: inflateOptionsSchema.optional() });
export const recipeDefaultsSchema = z.partialRecord(z.enum(ITEM_KINDS), kindDefaultSchema);
// VERIFIED (zod 4.6.7): z.partialRecord(z.enum([...]), …) accepts {} and partial keys, rejects unknown keys
// with code 'unrecognized_keys'.

export const recipeSchema = z
  .strictObject({
    name: nameSchema,
    description: z.string().trim().min(1),
    tags: tagsSchema,
    target: z.enum(INFLATE_TARGETS).default('claude-code'),
    layout: z.enum(INFLATE_LAYOUTS).default('grouped'),
    /** Top-of-document markdown instructions from the user (verbatim). */
    preamble: z.string().optional(),
    contexts: z.array(nameSchema).default([]),
    items: z.array(recipeItemSchema).default([]),
    markdown: z.array(recipeMarkdownSchema).default([]),
    overrides: z.array(recipeOverrideSchema).default([]),
    order: z.array(z.string().regex(SEGMENT_KEY_PATTERN, 'must be <dataset>/<slug>, md:<id>, ctx:<context> or sec:extra')).default([]),
    defaults: recipeDefaultsSchema.default({}),
  })
  .superRefine((r, issues) => { /* rules below */ });
```
superRefine rules (each `issues.addIssue({ code: 'custom', path, message })`):

| path | rule | message |
|---|---|---|
| `['contexts', i]` | duplicate slug | `duplicate context ${slug}` |
| `['items', i]` | duplicate `${dataset}/${slug}` | `duplicate item ${key}` |
| `['markdown', i, 'id']` | duplicate id | `duplicate markdown block id ${id}` |
| `['overrides', i, 'key']` | duplicate key | `duplicate override ${key}` |
| `['order', i]` | duplicate key | `duplicate order key ${key}` |
| `['defaults', kind, 'mode']` | `!isModeFor(kind, mode)` | `mode "${mode}" does not apply to ${ITEM_KIND_LABELS[kind]} items` |
| `['overrides', i, 'mode']` | key dataset ≠ reference and `!isModeFor(dataset, mode)`; or dataset = reference and mode ∉ `REFERENCE_MODE_IDS` | `mode "${mode}" does not apply to ${key}` |

Types (export):
```ts
export type InflateOptionsInput = z.infer<typeof inflateOptionsSchema>;
export type RecipeItem = z.infer<typeof recipeItemSchema>;
export type RecipeMarkdown = z.infer<typeof recipeMarkdownSchema>;
export type RecipeOverride = z.infer<typeof recipeOverrideSchema>;
export type RecipeData = z.infer<typeof recipeSchema>;    // all arrays + defaults present
export type RecipeInput = z.input<typeof recipeSchema>;   // API bodies
```
`DATASET_SCHEMAS` gets `recipe: recipeSchema`. `schemas.ts` → `catalog.ts` → `registry.ts` only (no cycle:
`catalog.ts` never imports `schemas.ts`).

### 3.3 `src/lib/inflate/recipe.ts` (PURE)

```ts
import { recipeSchema } from '../../datasets/schemas.ts';
import type { RecipeData } from '../../datasets/schemas.ts';
import { describeIssue, issuePath } from '../findings.ts';   // PURE
import { ITEM_KINDS, OPTION_IDS } from './catalog.ts';
import { stringifyYaml } from '../yaml.ts';

export interface RecipeIssue { path: string; message: string }        // same shape as context-io Issue
/** recipeSchema.safeParse + optional `name === expectedName` check (message: `name must equal "${expectedName}" (recipe names cannot be changed)`, path 'name', code 'name-mismatch'). */
export function parseRecipe(input: unknown, expectedName?: string):
  | { ok: true; recipe: RecipeData }
  | { ok: false; code: 'invalid' | 'name-mismatch'; issues: RecipeIssue[] };
/** CRLF→LF, trimEnd; '' when blank, else text + '\n'. */
export function normalizeText(text: string): string;
/** Plain object in serializer key order (below). */
export function recipeToYamlObject(r: RecipeData): Record<string, unknown>;
export function serializeRecipe(r: RecipeData): string;   // stringifyYaml(recipeToYamlObject(r))
export function sameRecipe(a: RecipeData | null, b: RecipeData | null): boolean;  // JSON of recipeToYamlObject equal; null === null only
```
Issues: `{ path: issuePath(i.path), message: describeIssue(i, input ?? {}) }` (exactly like `context-io.zodIssues`).

`recipeToYamlObject` key order and omission rules:

| key | written when | value |
|---|---|---|
| `name`, `description` | always | as is |
| `tags` | non-empty | array |
| `target`, `layout` | always | as is |
| `preamble` | `normalizeText(preamble) !== ''` | normalized (literal block) |
| `contexts`, `items` | always (also `[]`) | `items[]` = `{dataset, slug}` |
| `markdown` | non-empty | `{id, body: normalizeText(body)}` |
| `overrides` | non-empty, after dropping entries with no mode, no non-undefined option and no `exclude: true` | `{key, mode?, options?, exclude?}`; `options` keys in `OPTION_IDS` order, undefined dropped, `{}` dropped; `exclude` only when `true` |
| `order` | non-empty | array |
| `defaults` | at least one kind with a mode or option | keys in `ITEM_KINDS` order, each `{mode?, options?}`, empty dropped |

## 4. Catalog (`src/lib/inflate/catalog.ts`, PURE) — the UI contract

Imports: `OKF_DATASET_IDS, LINKABLE_DATASETS, NAME_PATTERN, datasetDef, REFERENCE_TYPE_LABELS` (+ types) from
`../../datasets/registry.ts`. Nothing else.

```ts
// ---- targets
export const INFLATE_TARGETS = ['claude-code', 'codex', 'generic'] as const;
export type InflateTarget = (typeof INFLATE_TARGETS)[number];
export interface TargetDef {
  id: InflateTarget;
  label: string;                    // 'Claude Code' | 'Codex' | 'Generic agent'
  sessionLine: string;              // header line 1 (§6.3)
  skillsDir: string;                // '.claude/skills' | '.agents/skills' | '.agents/skills'
  instructionsFile: string | null;  // 'CLAUDE.md' | 'AGENTS.md' | null
  /** Header line 3; null = omitted. */
  skillsLine: string | null;
  /** Sentence that makes the agent load `abs` up front (option `eager`). */
  eagerClause(abs: string): string;
}
export const TARGETS: Readonly<Record<InflateTarget, TargetDef>>;
export function isInflateTarget(v: unknown): v is InflateTarget;
/** n = (longest run of '`' in s) + 1 backticks around s; one space of padding inside when s starts or ends with '`'.
 *  inlineCode('/a/b') === '`/a/b`'. Lives here so eagerClause can use it; markdown.ts re-exports it. */
export function inlineCode(s: string): string;

// ---- layouts
export const INFLATE_LAYOUTS = ['grouped', 'flat'] as const;
export type InflateLayout = (typeof INFLATE_LAYOUTS)[number];
export const LAYOUT_LABELS = { grouped: 'Grouped', flat: 'Flat' } as const satisfies Record<InflateLayout, string>;

// ---- item kinds (dataset, or reference type)
export const ITEM_KINDS = ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project', 'skill', 'local-repo', 'remote-repo', 'remote-skill'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>>;  // okf ids: datasetDef(id).okfType ('Knowledge Base', 'Root Cause Analysis', 'Idea', 'Task', 'Bug', 'Feature', 'Project'); skill: 'Skill'; refs: REFERENCE_TYPE_LABELS
export type ModeFamily = 'okf' | 'skill' | 'local-repo' | 'remote-repo' | 'remote-skill';
export function familyOf(kind: ItemKind): ModeFamily;
/** dataset ≠ reference → dataset; reference → refType; reference without refType → null. */
export function itemKindOf(dataset: LinkableDatasetId, refType?: ReferenceType): ItemKind | null;

// ---- modes
export const MODE_IDS = ['inline-main', 'inline-bundle', 'summary', 'pointer', 'inline', 'install', 'describe', 'tree', 'clone'] as const;
export type ModeId = (typeof MODE_IDS)[number];
export const REFERENCE_MODE_IDS = ['describe', 'tree', 'clone', 'install'] as const satisfies readonly ModeId[];
export interface ModeDef { id: ModeId; label: string; description: string; options: readonly OptionId[] }
export const FAMILY_MODES: Readonly<Record<ModeFamily, readonly ModeDef[]>>;   // table §4.2, in that order
export function modesFor(kind: ItemKind): readonly ModeDef[];
export function modeDef(kind: ItemKind, mode: ModeId): ModeDef | undefined;
export function isModeFor(kind: ItemKind, mode: string): mode is ModeId;
export function defaultModeFor(kind: ItemKind, target: InflateTarget): ModeId;        // table §4.3

// ---- options
export const OPTION_IDS = ['includeFrontmatter', 'includeLog', 'shiftHeadings', 'rewriteLinks', 'eager', 'symlink', 'treeLimit', 'cloneDir', 'shallow', 'sparse'] as const;
export type OptionId = (typeof OPTION_IDS)[number];
export interface InflateOptions {
  includeFrontmatter: boolean; includeLog: boolean; shiftHeadings: boolean; rewriteLinks: boolean;
  eager: boolean; symlink: boolean; treeLimit: number; cloneDir: string; shallow: boolean; sparse: boolean;
}
export type BooleanOptionId = { [K in OptionId]: InflateOptions[K] extends boolean ? K : never }[OptionId];
export type OptionDef =
  | { id: BooleanOptionId; control: 'checkbox'; label: string; help: string; default: boolean }
  | { id: 'treeLimit'; control: 'select-number'; label: string; help: string; default: number; choices: readonly number[] }
  | { id: 'cloneDir'; control: 'text'; label: string; help: string; default: string };
export const OPTION_DEFS: Readonly<Record<OptionId, OptionDef>>;    // table §4.4
export const TREE_LIMIT_CHOICES = [10, 25, 50, 100, 200, 500] as const;
/** Resolved options for one item: only the mode's options, each = override ?? recipe default ?? OPTION_DEFS default; `{name}` in cloneDir → slug. */
export function resolveOptions(
  kind: ItemKind, mode: ModeId, slug: string,
  layers: { recipe?: Partial<InflateOptions>; override?: Partial<InflateOptions> },
): Partial<InflateOptions>;
/** What `resolveOptions` would give without the override layer (UI uses it to drop no-op overrides). */
export function baseOptionValue(kind: ItemKind, mode: ModeId, option: OptionId, slug: string, recipe?: Partial<InflateOptions>): InflateOptions[OptionId];
export const CLONE_DIR_MESSAGE = 'must be a relative path inside the project (letters, digits, . _ - /, optional {name})';
/** `{name}` → 'x', then /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/ and no segment '.' or '..'. */
export function isSafeRelativeDir(value: string): boolean;

// ---- keys
export const EXTRA_KEY = 'sec:extra';
export const itemKey = (dataset: LinkableDatasetId, slug: string): string => `${dataset}/${slug}`;
export const mdKey = (id: string): string => `md:${id}`;
export const ctxKey = (slug: string): string => `ctx:${slug}`;
export function parseItemKey(key: string): { dataset: LinkableDatasetId; slug: string } | null;
export const ITEM_KEY_PATTERN: RegExp;     // ^(kb|rca|idea|task|bug|feature|project|skill|reference)\/<NAME>$  (built from LINKABLE_DATASETS + NAME_PATTERN.source without anchors)
export const BLOCK_ID_PATTERN: RegExp;     // = NAME_PATTERN
export const SEGMENT_KEY_PATTERN: RegExp;  // item key | md:<NAME> | ctx:<NAME> | sec:extra
/** 'b' + (1 + max N over ids matching /^b(\d+)$/), starting at 'b1'. */
export function nextBlockId(existing: readonly string[]): string;
```

### 4.1 TARGETS (exact)

| field | claude-code | codex | generic |
|---|---|---|---|
| label | `Claude Code` | `Codex` | `Generic agent` |
| sessionLine | `Prepared by ctxman for a Claude Code session.` | `Prepared by ctxman for a Codex session.` | `Prepared by ctxman for an AI coding agent.` |
| skillsDir | `.claude/skills` | `.agents/skills` | `.agents/skills` |
| instructionsFile | `CLAUDE.md` | `AGENTS.md` | `null` |
| skillsLine | ``Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.`` | ``Skills go in `.agents/skills/<name>/`; project-wide instructions belong in `AGENTS.md`.`` | `null` |
| eagerClause(abs) | `` `Read it before starting: @${abs}` `` (bare `@path`, no backticks) | `` `Read ${inlineCode(abs)} before starting.` `` | same as codex |

Example: claude-code `Read it before starting: @/d/kb/demo/main.md`; codex ``Read `/d/kb/demo/main.md` before starting.``

### 4.2 FAMILY_MODES (order = Select order)

| family | id | label | description | options |
|---|---|---|---|---|
| okf | `inline-main` | Inline main.md | Embed the entry's main.md. | includeFrontmatter, shiftHeadings, rewriteLinks |
| okf | `inline-bundle` | Inline bundle | Embed main.md and every concept file, in index order. | includeFrontmatter, includeLog, shiftHeadings, rewriteLinks |
| okf | `summary` | Summary | Title, state, tags, description and the file path. | — |
| okf | `pointer` | Pointer | One line with the file path. | eager |
| skill | `install` | Install | Copy (or symlink) the skill folder into the harness skills directory. | symlink |
| skill | `inline` | Inline SKILL.md | Embed SKILL.md and list the skill's other files. | includeFrontmatter, shiftHeadings, rewriteLinks |
| skill | `pointer` | Pointer | Description plus the SKILL.md path. | eager |
| local-repo | `describe` | Describe | Name, description, path and owner. | — |
| local-repo | `tree` | Describe + tree | Also list the top-level entries of the path. | treeLimit |
| remote-repo | `describe` | Describe | Name, description, URI and subpath. | — |
| remote-repo | `clone` | Clone | git clone instructions into the project. | cloneDir, shallow, sparse |
| remote-skill | `install` | Install | Clone or download the skill into the harness skills directory. | — |
| remote-skill | `describe` | Describe | Name, description, URI and skill folder. | — |

### 4.3 defaultModeFor

| kind | claude-code | codex | generic |
|---|---|---|---|
| kb, rca | inline-main | inline-main | inline-main |
| idea, task, bug, feature, project | summary | summary | summary |
| skill | install | install | pointer |
| local-repo | describe | describe | describe |
| remote-repo | describe | describe | describe |
| remote-skill | install | install | describe |

### 4.4 OPTION_DEFS

| id | control | label | default | help |
|---|---|---|---|---|
| includeFrontmatter | checkbox | Frontmatter | false | Include the raw YAML frontmatter. |
| includeLog | checkbox | Update log | false | Append log.md. |
| shiftHeadings | checkbox | Shift headings | true | Nest the item's headings under its section. |
| rewriteLinks | checkbox | Absolute links | true | Rewrite bundle and ctxman: links to absolute file paths. |
| eager | checkbox | Load up front | false | Claude Code: @-mention the file; others: "read before starting". |
| symlink | checkbox | Symlink | false | Symlink instead of copying the skill folder. |
| treeLimit | select-number | Entries | 50 | Maximum entries listed. (choices `TREE_LIMIT_CHOICES`) |
| cloneDir | text | Clone into | `.ctxman/refs/{name}` | Project-relative directory; {name} = reference name. |
| shallow | checkbox | Shallow | true | Clone with --depth 1. |
| sparse | checkbox | Sparse subpath | false | Check out only the subpath (git sparse-checkout). |

## 5. Expansion (`src/lib/inflate/expand.ts`, PURE)

### 5.1 Types
```ts
import type { ContextLink, ReferenceData, RecipeData } from '../../datasets/schemas.ts';
import type { EntrySummary } from '../entry-summary.ts';

export interface ItemMeta {
  dataset: LinkableDatasetId; slug: string;
  title: string;            // summary.title ?? summary.name
  description: string; tags: string[];
  state?: string; staleAfter?: string; stale: boolean;
  refType?: ReferenceType; uriKind?: RemoteUriKind;
  /** Full reference data: server only (fs-sources); undefined in the browser. */
  ref?: ReferenceData;
}
export interface ContextLike { name: string; description: string; links: ContextLink[] }
export type ContextLookup = { status: 'ready'; context: ContextLike } | { status: 'missing' } | { status: 'invalid'; message: string } | { status: 'loading' };
export type ItemLookup = { status: 'ready'; meta: ItemMeta } | { status: 'missing' } | { status: 'invalid'; message: string } | { status: 'loading' };
export interface ExpandLookup { context(slug: string): ContextLookup; item(dataset: LinkableDatasetId, slug: string): ItemLookup }

export type InflateWarningCode = 'context-missing' | 'context-invalid' | 'item-missing' | 'item-invalid' | 'mode-invalid'
  | 'override-stale' | 'path-missing' | 'file-unreadable' | 'large-output';
export interface InflateWarning { code: InflateWarningCode; message: string; key?: string }
export type SegmentStatus = 'included' | 'excluded' | 'missing' | 'invalid' | 'loading';
export interface Note { context: string; notes: string }

export interface ItemSegment {
  type: 'item'; key: string; dataset: LinkableDatasetId; slug: string;
  kind: ItemKind | null; meta: ItemMeta | null; title: string;       // meta?.title ?? slug
  via: string[]; adhoc: boolean; notes: Note[];
  mode: ModeId | null; modeSource: 'default' | 'recipe' | 'override' | null;
  options: Partial<InflateOptions>;
  status: SegmentStatus; group: string | null; warnings: InflateWarning[];
}
export interface MarkdownSegment { type: 'markdown'; key: string; id: string; body: string; status: 'included'; group: string | null; warnings: InflateWarning[] }
export interface ContextIntroSegment { type: 'context-intro'; key: string; slug: string; title: string; description: string; crossRefs: string[]; status: 'included'; group: null; warnings: InflateWarning[] }
export interface SectionIntroSegment { type: 'section-intro'; key: 'sec:extra'; title: 'Additional items'; status: 'included'; group: null; warnings: InflateWarning[] }
export type Segment = ItemSegment | MarkdownSegment | ContextIntroSegment | SectionIntroSegment;
export interface ExpandedPlan {
  recipe: RecipeData;
  segments: Segment[];
  contexts: { slug: string; status: 'ready' | 'missing' | 'invalid' | 'loading' }[];
  warnings: InflateWarning[];
  staleOverrides: string[];
  /** Some lookup is still loading (browser only). */
  pending: boolean;
}
export function itemMetaFromSummary(s: EntrySummary): ItemMeta;
export function applyOrder(defaultOrder: readonly string[], order: readonly string[]): string[];
export function expandRecipe(recipe: RecipeData, lookup: ExpandLookup): ExpandedPlan;
```

### 5.2 `applyOrder` (exact)
1. `result` = `order` filtered to keys in `new Set(defaultOrder)`, duplicates dropped (first kept).
2. For `i` in `0..defaultOrder.length-1`, `k = defaultOrder[i]`; skip if in `result`. Find the nearest `j < i` with
   `defaultOrder[j]` in `result`; insert `k` right after `defaultOrder[j]` in `result`; if none, insert at index 0.

Tests: `([a,b,c],[]) → [a,b,c]`; `([a,b,c,d],[c,a]) → [c,d,a,b]`; `([a,b],[x,b,a]) → [b,a]`;
`([a,b,c],[c]) → [a,b,c]` (a has no kept predecessor → index 0; b after a).

### 5.3 `expandRecipe` (exact steps)
1. Contexts: for each slug in `recipe.contexts` (schema guarantees uniqueness): `lookup.context(slug)`.
   `ready` → kept; `missing` → warning `context-missing` `context "${slug}" does not exist`, key `ctx:${slug}`;
   `invalid` → `context-invalid` `context "${slug}" is invalid: ${message}`; `loading` → `pending = true`.
   `plan.contexts` lists all with their status.
2. Item registry (insertion order = first seen): for each READY context in recipe order, for each link:
   `key = itemKey(link.dataset, link.slug)`; create `{dataset, slug, via: [], adhoc: false, notes: []}` if absent;
   push context slug to `via`; if `link.notes?.trim()` → `notes.push({ context: slug, notes: link.notes })`.
   Then each `recipe.items` entry: create if absent, set `adhoc = true`.
3. Default order:
   - grouped: for each READY context: `ctx:<slug>`, then the keys of its links whose `via[0] === slug` (link order).
     Then, if any registry entry has `via.length === 0`: `sec:extra`, then those keys in `recipe.items` order.
     Then `md:<id>` for each `recipe.markdown` (array order).
   - flat: registry keys (insertion order), then `md:<id>` keys.
4. `keys = applyOrder(defaultOrder, recipe.order)`.
5. Overrides: `byKey = Map(override.key → override)`; keys absent from the registry → `staleOverrides` (in
   `recipe.overrides` order) + warning `override-stale` `override for ${key} matches no item in this recipe`.
6. For each item key: `lookup.item(dataset, slug)`:
   - `ready`: `kind = itemKindOf(dataset, meta.refType)`; if null → status `invalid`, warning `item-invalid`
     (`${key} could not be read: unknown reference type`).
   - `missing` → status `missing`, warning `item-missing` `${key} does not exist (linked from ${via.join(', ') || 'ad hoc'})`.
   - `invalid` → status `invalid`, warning `item-invalid` `${key} could not be read: ${message}`; `loading` → status `loading`, `pending = true`.
   - With a kind: `built = defaultModeFor(kind, recipe.target)`. `rd = recipe.defaults[kind]?.mode`: valid → mode `rd`,
     source `recipe`; present but `!isModeFor` → warning `mode-invalid` (once per kind, key `defaults.${kind}`):
     `default mode "${rd}" does not apply to ${ITEM_KIND_LABELS[kind]} items; using "${built}"`. `om = byKey.get(key)?.mode`:
     valid → mode `om`, source `override`; invalid → warning `mode-invalid` key `key`:
     `mode "${om}" does not apply to ${key} (${ITEM_KIND_LABELS[kind]}); using "${fallback}"` where `fallback` = the valid recipe default, else `built`. Neither → mode `built`, source `default`.
   - `options = resolveOptions(kind, mode, slug, { recipe: recipe.defaults[kind]?.options, override: byKey.get(key)?.options })`.
   - Ready and `override.exclude === true` → status `excluded`; else `included`.
   - Without a kind: `mode = null`, `modeSource = null`, `options = {}`.
7. Build segments in `keys` order (`ctx:` → ContextIntroSegment with the context's name/description; `sec:extra` →
   SectionIntroSegment; `md:` → MarkdownSegment from `recipe.markdown`).
8. Groups: walk segments; `current = null`; an intro sets `current = its key` (intro's own `group` stays null);
   items and markdown get `group = current`. Flat layout has no intros, so every group is null.
9. `crossRefs` of `ctx:<slug>`: keys of that context's links (link order) whose segment is `included` and whose
   `group !== 'ctx:<slug>'`.
10. `plan.warnings` = context warnings (step 1), then default-mode warnings, then segment warnings in segment order,
    then override-stale warnings. Each segment's own warnings are also on the segment.

### 5.4 `itemMetaFromSummary`
`{ dataset: s.dataset as LinkableDatasetId, slug: s.slug, title: s.title ?? s.name, description: s.description,
tags: s.tags, stale: s.stale }` plus `state`, `staleAfter`, `refType`, `uriKind` when defined. Same function on the
server (fs-sources builds an `EntrySummary` with `summarize`, §5.7), so titles match in UI and document.

### 5.5 Browser lookup (Q3, in `src/stores/inflate.ts`)
`context(slug)`: `$contextDocs[slug]` ?? `{status:'loading'}`. `item(ds, slug)`: `$entries[ds]` undefined or
`loading` → loading; `error` → `{status:'invalid', message: 'Couldn't load entries'}`; ready → summary found →
`{status:'ready', meta: itemMetaFromSummary(summary)}`, else missing.

### 5.6 Server lookups (`src/lib/inflate/pipeline.ts`)
```ts
export interface EntryRef { title: string; abs: string }
export interface BundleFileRef { rel: string; abs: string; kind: 'markdown' | 'text' | 'binary' }
export interface InflateSources {
  readContext(slug: string): Promise<ContextLookup>;                                // never 'loading'
  readItem(dataset: LinkableDatasetId, slug: string): Promise<ItemLookup>;          // never 'loading'
  /** Any dataset (ctxman: link targets). null = invalid slug or entry file missing. */
  entryRef(dataset: DatasetId, slug: string): Promise<EntryRef | null>;
  itemPaths(dataset: LinkableDatasetId, slug: string): { rootAbs: string; entryAbs: string };
  listFiles(dataset: OkfDatasetId | 'skill', slug: string): Promise<BundleFileRef[]>;
  readText(dataset: OkfDatasetId | 'skill', slug: string, rel: string): Promise<string | null>;
  /** '~' / '~/x' → home; relative → resolved against cwd; then joined with subpath segments. */
  localPaths(path: string, subpath?: string): { root: string; target: string };
  statPath(abs: string): Promise<'dir' | 'file' | null>;
  /** Direct children, names starting with '.' and 'node_modules' skipped; dirs first, then case-insensitive name; null = not a directory. */
  listDir(abs: string): Promise<{ name: string; dir: boolean }[] | null>;
}
export interface ExpandInputs { contexts: Map<string, ContextLookup>; items: Map<string, ItemLookup> }
/** Reads every recipe context, then every item key reachable (links of ready contexts + recipe.items), in parallel. */
export async function loadExpandInputs(recipe: RecipeData, sources: InflateSources): Promise<ExpandInputs>;
export function lookupFrom(inputs: ExpandInputs): ExpandLookup;   // missing map entries → {status:'missing'}
export async function gatherContent(plan: ExpandedPlan, sources: InflateSources): Promise<PlanContent>;  // §6.2
export async function inflateRecipe(recipe: RecipeData, sources: InflateSources, now: Date): Promise<InflateResult>;
// = renderPlan(expandRecipe(recipe, lookupFrom(await loadExpandInputs(…))), await gatherContent(…), { generatedAt: now.toISOString() })
```

### 5.7 `createFsSources` (`src/lib/inflate/fs-sources.ts`, NODE) — exact calls
```ts
export function createFsSources(opts?: { dataDir?: string; nowMs?: number; homeDir?: string; cwd?: string }): InflateSources;
// defaults: resolveDataDir(), Date.now(), os.homedir(), process.cwd()
```
| method | implementation |
|---|---|
| readContext | `readContext(slug, dataDir)` (context-io) → `ready` with `record.context`; `ContextIoError` code `not-found`/`bad-slug` → `missing`; `parse`/`invalid` → `invalid`, message = `error.message` + `: ` + issues `path: message` joined `; ` (as `listContexts` does) |
| readItem okf | `!isValidName(slug)` → missing. `readBundleText(ds, slug, 'main.md', dataDir)` null → missing. `parseFrontmatterLoose(text)` throws → invalid (message). `DATASET_SCHEMAS[ds].safeParse(data)` fail → invalid, message `issueMessage(issues[0], data)` (findings.ts). OK → `itemMetaFromSummary(summarize(ds, slug, data, new Date(0), nowMs))` |
| readItem skill | same with `readBundleText('skill', slug, 'SKILL.md')` and `skillSchema` |
| readItem reference | `readFile(path.join(datasetDir('reference', dataDir), slug + '.yaml'), 'utf8')`; ENOENT → missing; `parseYaml` throws → invalid; `referenceSchema.safeParse` fail → invalid; OK → meta from `summarize('reference', …)` + `ref: parsed.data` |
| entryRef | `!isValidName` → null; abs = `path.join(dataDir, ...entryFileRelPath(ds, slug).split('/'))`; not a file → null; title: linkable → `readItem` ready meta.title else slug; `context` → slug; `recipe` → slug |
| itemPaths | `rootAbs = entryAbsPath(ds, slug, dataDir)`, `entryAbs = path.join(dataDir, ...entryFileRelPath(ds, slug).split('/'))` (freshness.ts) |
| listFiles | `listBundleFiles(ds, slug, dataDir)` → `{ rel: f.path, abs: path.join(rootAbs, ...f.path.split('/')), kind: f.kind }` (keeps its tree order) |
| readText | `readBundleText(ds, slug, rel, dataDir)` (null for unsafe/missing/binary/>512 KB) |
| localPaths | `p === '~'` → home; `p.startsWith('~/') \|\| p.startsWith('~\\')` → `path.join(home, p.slice(2))`; else `path.resolve(cwd, p)`; `target = subpath?.trim() ? path.join(root, ...subpath.split(/[\\/]+/).filter(Boolean)) : root` |
| statPath / listDir | `stat` (follows symlinks) / `readdir(abs, { withFileTypes: true })`, symlinks classified with `stat` |

## 6. Rendering

### 6.1 `src/lib/inflate/markdown.ts` (NODE*: imports `maskMarkdownCode`, `splitFrontmatter`, `parseFrontmatterLoose` from `../okf.ts`; `classifyHref`, `resolveBundleHref`, `parseCtxmanHref` from `../links.ts`)

```ts
export { inlineCode } from './catalog.ts';
export function fenced(text: string, lang: string): string;   // fence = max(3, longest ^ {0,3}`+ run + 1) backticks; `${f}${lang}\n${text without trailing \n}\n${f}`
export function shiftHeadings(body: string, base: number): string;
export function stripLeadingTitle(body: string, title: string): string;
export function rewriteLinks(body: string, ctx: { fromRel: string; files: ReadonlyMap<string, string>; targets: Readonly<Record<string, EntryRef | null>> }): string;
export function shQuote(s: string): string;                   // /^[A-Za-z0-9._\/:@%+=,-]+$/ → s; else `'${s.replaceAll("'", "'\\''")}'`
export function guidance(notes: readonly Note[]): string;      // '' when empty
export function headingText(level: number, text: string): string;  // `${'#'.repeat(clamp(level,1,6))} ${text.replace(/\s+/g,' ').trim()}`
```
- **shiftHeadings** (VERIFIED prototype on `data/kb/ctxman/main.md` and a fenced `# not a heading`):
  `HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/`; `masked = maskMarkdownCode(body)` (length-preserving, so line `i` of
  masked = line `i` of body); `min` = smallest `#` count over masked lines matching HEADING; none → return body.
  `delta = min(base, 6) - min`; each matching line → `indent + '#'.repeat(clamp(level + delta, 1, 6)) + rest`.
  Setext headings are not touched (documented limitation).
- **stripLeadingTitle**: first non-blank line of `body`; if it matches `/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/`
  and `norm(text) === norm(title)` (`norm` = trim, collapse whitespace, lowercase) → drop that line and the blank lines
  directly after it; otherwise unchanged. Applied before `shiftHeadings`.
- **rewriteLinks**: `masked = maskMarkdownCode(body)`. Destinations: (a) inline links/images
  `/\]\([ \t]*(<[^>\n]*>|[^\s)]+)/g` (group 1); (b) reference definitions `/^( {0,3}\[[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm`
  (group 2). Matches are found on `masked`, replacements spliced into `body` at the same offsets, last match first.
  For destination `d` (strip `<…>`): `fragment` = text after the first `#` (or none).
  `classifyHref(d)`: `'bundle'` → `resolveBundleHref(d, fromRel)`; `{path}` with `files.has(path)` → `files.get(path)`;
  `'ctxman'` → `parseCtxmanHref(d)` → `targets[`${dataset}/${slug}`]?.abs`; anything else, or no hit → unchanged.
  New destination = `abs + (fragment ? '#' + fragment : '')`, wrapped in `<…>` when it matches `/[\s()<>]/`.
- **guidance**: per note: `lines = note.notes.replace(/\r\n?/g, '\n').trim().split('\n')`; first line
  ``> **From context `${note.context}`:** ${lines[0]}``; others `'>'` if blank else `'> ' + line`. Notes joined
  with `'\n>\n'`.

### 6.2 Content gathering (`gatherContent`, pipeline.ts)
```ts
export interface ItemContent {
  rootAbs: string; entryAbs: string;
  files?: BundleFileRef[];
  texts?: Record<string, string | null>;     // rel → text
  /** inline-main / inline-bundle: concept files in index order (§ below). */
  concepts?: string[];
  local?: { root: string; target: string; exists: boolean };
  tree?: { entries: { name: string; dir: boolean }[]; total: number } | null;   // null = target not a directory
}
export interface PlanContent { items: Record<string, ItemContent>; targets: Record<string, EntryRef | null>; warnings: InflateWarning[] }
```
Only `included` item segments are gathered. Always: `itemPaths`. Then by family/mode:

| family / mode | reads |
|---|---|
| okf inline-main, inline-bundle | `listFiles`; `readText` of `index.md` (if listed) and `main.md`; inline-bundle also every rel in `concepts`, and `log.md` when `includeLog` |
| skill inline | `listFiles`; `readText('SKILL.md')` |
| local-repo describe | `localPaths(ref.path, ref.subpath)`, `statPath(target) === 'dir'` → `exists` |
| local-repo tree | as describe + `listDir(target)` → `tree = { entries, total: entries.length }` or null |
| everything else | nothing beyond `itemPaths` |

`concepts` (okf inline modes): from `index.md` body (`parseFrontmatterLoose`), `extractLinks` (links.ts) in order,
keep `classifyHref === 'bundle'` → `resolveBundleHref(href, 'index.md')` paths that are markdown files in `files`,
not `main.md`, basename not `index.md`/`log.md`, unique; then append every other markdown file of `files` (tree
order) with the same exclusions. A `readText` null for a needed rel → warning `file-unreadable`
`${key}: ${rel} could not be read (missing, binary or larger than 512 KB)`; that file is skipped. Local target
missing → warning `path-missing` `${key}: path ${target} does not exist`.
`targets`: for every text rendered with `rewriteLinks: true`, `extractLinks(body)` hrefs with
`classifyHref === 'ctxman'` → `parseCtxmanHref` → `sources.entryRef` once per `ds/slug`.

### 6.3 `renderPlan` (`src/lib/inflate/render.ts`, NODE*)
```ts
export interface ManifestSegment {
  key: string; type: Segment['type']; title: string; status: Exclude<SegmentStatus, 'loading'>;
  dataset?: LinkableDatasetId; slug?: string; kind?: ItemKind; mode?: ModeId; modeLabel?: string;
  options?: Partial<InflateOptions>; via: string[]; adhoc: boolean;
  source?: string;         // entryAbs (items)
  bytes: number;           // UTF-8 bytes of this segment's text (0 when not rendered)
  warnings: InflateWarning[];
}
export interface InflateManifest {
  recipe: string; target: InflateTarget; layout: InflateLayout; generatedAt: string;
  bytes: number;                                          // whole document
  counts: { included: number; excluded: number; missing: number };   // item segments; invalid counts as missing
  contexts: { slug: string; status: 'ready' | 'missing' | 'invalid' }[];
  segments: ManifestSegment[];
  warnings: InflateWarning[];                             // plan + content + render, deduped on code+key+message
}
export interface InflateResult { markdown: string; manifest: InflateManifest }
export const LARGE_OUTPUT_BYTES = 512 * 1024;
export function renderPlan(plan: ExpandedPlan, content: PlanContent, ctx: { generatedAt: string }): InflateResult;
```
Bytes: `new TextEncoder().encode(s).length`. Document = `[header, preamble?, ...renderedSegments].join('\n\n') + '\n'`,
each part with no leading/trailing blank lines; empty parts dropped. Output > `LARGE_OUTPUT_BYTES` → warning
`large-output` `the document is ${kb} KB (over 512 KB); use summary or pointer modes for large items`.

**Header** (`T = TARGETS[target]`), then the preamble verbatim (`normalizeText(preamble).trimEnd()`, omitted when blank):
~~~~
# <recipe.name>

> <T.sessionLine>
> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.
> <T.skillsLine>            ← line omitted when null
~~~~

**Levels**: intro segments `##`. Item level `L = group === null ? 2 : 3` (flat → always 2). Item body base `L + 1`.

**Segments**:
- `context-intro`: `## Context: <name>`, blank, description (if non-blank); if `crossRefs` non-empty, blank, then
  ``Also relevant here, included in another section: **<title>** (`<key>`), **<title>** (`<key>`).``
  (titles from the referenced segments).
- `section-intro`: `## Additional items`.
- `markdown`: `normalizeText(body).trimEnd()`; blank → not rendered (bytes 0).
- items with status ≠ `included`: not rendered.
- items: parts joined by blank lines: `headingText(L, title)`, meta line (or the pointer line), `guidance(notes)`
  (if any), then the mode body. `abs(x)` below = `inlineCode(x)`.

**Meta line** = parts joined by ` · `: `inlineCode(key)`, `ITEM_KIND_LABELS[kind]`, [remote-skill: `uriKind`],
[`state: ${stateLabel(state)}`], [`stale since ${staleAfter}`], [references: `owner: ${OWNER_LABELS[owner]}`],
[`tags: ${tags.join(', ')}` when non-empty], location: okf → `abs(entryAbs)`; skill inline → `abs(entryAbs)`;
skill install → `abs(rootAbs)`; local-repo → `abs(local.root)`; remote → `abs(ref.uri)`.

**Mode bodies** (B = body after `parseFrontmatterLoose(text).body` → `stripLeadingTitle(·, title)` →
`shiftHeadings(·, L+1)` if `shiftHeadings` → `rewriteLinks(·, {fromRel, files: Map(rel→abs), targets})` if `rewriteLinks`;
`trim()`; FM = `fenced(splitFrontmatter(text).raw, 'yaml')` when `includeFrontmatter` and frontmatter exists):

| mode | body after meta line + guidance |
|---|---|
| okf inline-main | [FM], B(main.md), then when `concepts` non-empty: ``More in this bundle (under `<rootAbs>`): `concepts/a.md`, `concepts/b.md`.`` |
| okf inline-bundle | [FM], B(main.md); per concept rel: `headingText(L+1, fileTitle)`, ``inlineCode(rel) · abs(fileAbs)``, body (same pipeline, base `L+2`, `stripLeadingTitle(·, fileTitle)`, `fromRel = rel`); if `includeLog` and `log.md` read: `headingText(L+1, 'Update log')`, `` `log.md` · abs `` , body base `L+2`; then, if bundle has non-markdown files: `Other files in this bundle:` + list `` - `rel` — abs `` . `fileTitle` = frontmatter `title` ?? first ATX H1 text ?? basename without `.md` |
| okf summary | description (if non-blank) |
| okf pointer | (replaces the meta line) ``<key> · <kindLabel> · <description> Read `<entryAbs>` if relevant.`` ; eager → ``… <description> <T.eagerClause(entryAbs)>`` |
| skill inline | [FM], B(SKILL.md, `fromRel='SKILL.md'`), then if other files: ``Files in this skill (under `<rootAbs>`):`` + `` - `rel` — abs `` per file except SKILL.md |
| skill pointer | (replaces meta line) ``<key> · Skill · <description> Read `<entryAbs>` and follow it when the task matches.``; eager → ``… <description> <eagerClause(entryAbs)>`` |
| skill install | description; `Install this skill into the project (run from the project root):`; sh block (below) |
| local-repo describe | description; `` Read the code at `<target>` when the task needs it. `` (with subpath: ``Read the code at `<target>` (inside the repository `<root>`) when the task needs it.``); `exists === false` → append `` The path `<target>` does not exist on this machine. `` |
| local-repo tree | describe body, then (exists) ``Top-level entries of `<target>` (<shown> of <total>):`` + `fenced(lines, 'text')`, lines = `name/` for dirs, `name` for files, first `treeLimit`; not a dir → the "does not exist" sentence only |
| remote-repo describe | description; ``Git repository `<uri>`<subpath ? `, relevant path \`${subpath}\`` : ''>. Clone it only if the task needs its contents.`` |
| remote-repo clone | description; ``Clone it into the project (run from the project root; keep `.ctxman/` out of version control):``; sh block; subpath → ``Then read `<cloneDir>/<subpath>`.`` |
| remote-skill describe | description; git: ``Agent skill in the git repository `<uri>`<subpath? ` (skill folder \`${subpath}\`)`>. Install it only if the task needs it.``; archive: ``Agent skill packaged as an archive at `<uri>`…`` (same tail) |
| remote-skill install | description; ``Install this skill into `<skillsDir>/<name>/` (run from the project root):``; sh block; archive → also `The skill folder is the one that contains SKILL.md; if the archive wraps it in a top-level folder, copy that folder instead.` |

In the templates above, `<key>` renders as `inlineCode(key)`, `` `<x>` `` as `inlineCode(x)`, and a blank
`<description>` is dropped together with the space after it. Template sentences are separate paragraphs (joined by
a blank line) except where a list or code block directly follows its lead-in line (lead-in, blank line, block).

sh blocks (`fenced(lines.join('\n'), 'sh')`, every interpolated value through `shQuote`; `S = T.skillsDir`, `n` = slug):

| case | lines |
|---|---|
| skill install copy | `mkdir -p S` · `cp -R <rootAbs> S/n` |
| skill install symlink | `mkdir -p S` · `ln -s <rootAbs> S/n` |
| clone (shallow; no sparse or no subpath) | `git clone --depth 1 <uri> <dir>` (no `--depth 1` when `shallow: false`) |
| clone sparse + subpath | `git clone [--depth 1] --filter=blob:none --sparse <uri> <dir>` · `git -C <dir> sparse-checkout set <subpath>` |
| remote-skill git, no subpath | `mkdir -p S` · `git clone --depth 1 <uri> S/n` · `rm -rf S/n/.git` |
| remote-skill git + subpath | `mkdir -p S .ctxman/tmp` · `git clone --depth 1 <uri> .ctxman/tmp/n` · `cp -R .ctxman/tmp/n/<subpath> S/n` · `rm -rf .ctxman/tmp/n` |
| remote-skill archive (.tar.gz/.tgz) | `mkdir -p S .ctxman/tmp/n` · `curl -fsSL <uri> -o .ctxman/tmp/n.tgz` · `tar -xzf .ctxman/tmp/n.tgz -C .ctxman/tmp/n` · `cp -R .ctxman/tmp/n[/<subpath>] S/n` · `rm -rf .ctxman/tmp/n .ctxman/tmp/n.tgz` |
| remote-skill archive (.zip) | as tar with `n.zip` and `unzip -q .ctxman/tmp/n.zip -d .ctxman/tmp/n` |

`<dir>` = resolved `cloneDir`. Archive extension: `/\.zip$/i` on the URI path → zip, else tar. Kind detection via
`classifyRemoteUri(ref.uri)` (remote-uri.ts); `subpath` = `ref.subpath?.trim()` with leading/trailing `/` removed.

### 6.4 Golden example (fixture = `validDataTree()` + a recipe, claude-code, grouped)
Recipe: `{ name: 'demo-brief', description: 'Demo.', target: 'claude-code', layout: 'grouped', preamble: 'Follow the repo rules.\n', contexts: ['ctx'], items: [{ dataset: 'skill', slug: 'my-skill' }] }`.
~~~~
# demo-brief

> Prepared by ctxman for a Claude Code session.
> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.
> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.

Follow the repo rules.

## Context: ctx

A context.

### Demo

`kb/demo` · Knowledge Base · tags: demo · `<D>/kb/demo/main.md`

> **From context `ctx`:** Read this.

See [one](<D>/kb/demo/concepts/one.md) and [ctxman](<D>/kb/demo/main.md).

More in this bundle (under `<D>/kb/demo`): `concepts/one.md`.

### do-it

`task/do-it` · Task · state: In progress · `<D>/task/do-it/main.md`

Do the thing.

## Additional items

### my-skill

`skill/my-skill` · Skill · `<D>/skill/my-skill`

A skill.

Install this skill into the project (run from the project root):

```sh
mkdir -p .claude/skills
cp -R <D>/skill/my-skill .claude/skills/my-skill
```
~~~~
Tests build `<D>` with `path.join(tmpDir, …)` (temp dirs contain no characters that `shQuote`/`<…>` wrapping would
change on macOS/Linux; assert with the same helpers otherwise). Same recipe with `layout: 'flat'`: no `## Context`
or `## Additional items` sections, items at `##`. With `target: 'codex'`: line 3 of the header uses
`.agents/skills` / `AGENTS.md` and the install block `mkdir -p .agents/skills` / `cp -R … .agents/skills/my-skill`.
`target: 'generic'`: header has two quote lines; `my-skill` defaults to pointer:
``…`skill/my-skill` · Skill · A skill. Read `<D>/skill/my-skill/SKILL.md` and follow it when the task matches.``

## 7. API (Q2; every route uses `src/lib/http.ts`: `json`, `apiError`, `readJson`, `checkOrigin`, `methodNotAllowed`, `internalError`; `export const ALL` → 405)

### 7.1 recipe-io (`src/lib/recipe-io.ts`, Q1, NODE) — mirror of context-io.ts
```ts
export interface RecipeRecord { slug: string; recipe: RecipeData; lastModified: string; file: string /* 'recipe/<slug>.yaml' */ }
export class RecipeIoError extends Error { code: 'not-found' | 'exists' | 'invalid' | 'bad-slug' | 'name-mismatch' | 'parse'; issues: RecipeIssue[] }
export function recipeFile(slug: string, dataDir?: string): string;
export function validateRecipe(input: unknown, slug: string): ReturnType<typeof parseRecipe>;   // parseRecipe(input, slug)
export async function readRecipe(slug: string, dataDir?: string): Promise<RecipeRecord>;
export async function listRecipes(dataDir?: string): Promise<{ items: RecipeRecord[]; errors: { file: string; message: string }[] }>;
export async function createRecipe(input: unknown, dataDir?: string): Promise<RecipeRecord>;   // flag 'wx', 'exists'
export async function writeRecipe(slug: string, input: unknown, dataDir?: string): Promise<RecipeRecord>;  // must exist; atomic tmp+rename
export async function deleteRecipe(slug: string, dataDir?: string): Promise<void>;
```
Same semantics, messages (`context` → `recipe`) and error codes as the context-io functions of the same shape.
Files are written with `serializeRecipe`.

### 7.2 `src/lib/http.ts` (Q2)
Refactor the body of `contextErrorResponse` into a private `ioErrorResponse(error: { code; message; issues }, mode)`;
`contextErrorResponse` (unchanged signature) and new `recipeErrorResponse(error: unknown, mode: 'read' | 'write')`
call it when the error is a `ContextIoError` / `RecipeIoError` respectively, else `internalError`.

### 7.3 Routes
| route | file | behaviour |
|---|---|---|
| `GET /api/recipe/:slug` | `api/recipe/[slug].ts` | 200 `{ recipe: RecipeData, lastModified }` · 400 bad-slug · 404 · 422 invalid-file |
| `PUT /api/recipe/:slug` | same | body RecipeInput, `name === :slug` → 200 `{ recipe, lastModified }` · 400 invalid/name-mismatch/bad-json/bad-slug · 404 · 415 · 403 |
| `DELETE /api/recipe/:slug` | same | 204 · 400 · 404 · 403 |
| `POST /api/recipe` | `api/recipe/index.ts` | 201 `{ recipe, lastModified }` + `location: /recipe/<name>` · 400 · 409 exists · 415 · 403 |
| `POST /api/inflate/render` | `api/inflate/render.ts` | body = RecipeInput (unsaved is fine; `name` must be a valid name, no file needed) → `parseRecipe(body)`; fail → 400 `invalid` `{ issues }`; ok → 200 `InflateResult` from `inflateRecipe(recipe, createFsSources(), new Date())` · 415 · 403 · 400 bad-json · 500 |
| `POST /api/inflate/write` | `api/inflate/write.ts` | body `{ recipe: RecipeInput, path: string }` (body not an object or `path` not a string → 400 `invalid` with issue path `path`); recipe issues prefixed `recipe.`; `checkOutputPath` fail → 400 `bad-path` `{message}`; render as above; `writeOutput` fail → 400 `write-failed` `{message}`; ok → 200 `{ path: string /* normalized absolute */, bytes: number, manifest: InflateManifest }` |
| `GET /api/entries?dataset=recipe` | existing | works via `listEntries('recipe')` (§8.1) |
No `GET /api/inflate/options` (D7).

### 7.4 `src/lib/inflate/write.ts` (Q1, NODE)
```ts
export type OutputPathCheck = { ok: true; path: string } | { ok: false; message: string };
export function checkOutputPath(raw: unknown, opts?: { dataDir?: string }): OutputPathCheck;
export async function writeOutput(absPath: string, markdown: string): Promise<{ path: string; bytes: number }>;
```
checkOutputPath, in order (first failure wins; messages exact):
1. not a string / trimmed empty → `path is required`; length > 1024 or contains `\0` → `path is not valid`.
2. `!path.isAbsolute(p)` → `path must be absolute`.
3. `abs = path.resolve(p)`; `path.extname(abs).toLowerCase() !== '.md'` → `path must end in .md`.
4. any segment of `abs` (split on `path.sep`) lower-cased is `node_modules` or `.git` → `path must not be inside node_modules or .git`.
5. `rel = path.relative(dataDir, abs)`; inside (`rel === ''` or (`!rel.startsWith('..')` and `!path.isAbsolute(rel)`)) → `path must not be inside the data directory`.
writeOutput: `mkdir(dirname, { recursive: true })`; existing directory at `abs` → throw `Error('a directory exists at that path')`;
write `${abs}.${process.pid}.tmp` then `rename` (unlink tmp on failure); returns `{ path: abs, bytes: Buffer.byteLength(markdown) }`.
Default UI path `<R>/out/<recipe>.md`; `out/` is gitignored (VERIFIED: writing `out/*.md` while `astro dev` runs
causes no browser reload).

## 8. Pages and server data (Q1 libs, Q2 pages)

### 8.1 `entries.ts` / `entry-summary.ts` / `search-index.ts` / `content.config.ts` / `collections-check.ts` (Q1)
- `content.config.ts`: rename `contextYamlLoader(dir)` → `yamlDirLoader(name: string, dir: string)` (loader
  `name` = `ctxman-${name}-yaml`, otherwise identical, no watcher: the Inflate UI writes recipes at runtime and a
  glob loader would full-reload `astro dev` on every save). `recipe: defineCollection({ loader: yamlDirLoader('recipe', datasetDir('recipe', dataDir)), schema: recipeSchema })`.
  Comment: NEVER `getCollection('recipe')` in pages/APIs; read through recipe-io.
- `EntrySummary` += `recipeTarget?: InflateTarget; contextCount?: number; itemCount?: number` (recipe only; from
  `data.target` when `isInflateTarget`, `contexts.length`, `items.length`, arrays missing → 0).
- `search-index.ts`: `recipeToSearchDoc(slug: string, data: RecipeData): SearchDoc` → id `recipe/<slug>`, title = name,
  path null, tags, headings `[]`, url `/recipe/<slug>`, body = `truncate([description, `target: ${TARGETS[target].label} · layout: ${layout}`, `contexts: ${contexts.join(', ')}` (if any), ...items.map(itemKey), markdownToText(preamble ?? ''), ...markdown.map(b => markdownToText(b.body))].filter(nonEmpty).join('\n'), MAX_BODY_CHARS)`.
- `entries.ts`: `CollectionDatasetId = Exclude<DatasetId, 'context' | 'recipe'>`. `listEntries('recipe')` →
  `listRecipes()` items → `summarize('recipe', …)`. `buildSearchIndex` appends `recipeToSearchDoc` for every recipe.
  `getEntryDetail('recipe', slug)` → `readRecipe` (RecipeIoError → null) and:
  ```ts
  | { kind: 'recipe'; data: RecipeData; contexts: RecipeContextRef[]; items: RecipeItemRef[]; preambleHtml?: string; blocks: { id: string; html: string }[] }
  export interface RecipeContextRef { slug: string; url: string; missing: boolean; description?: string; linkCount?: number }
  export interface RecipeItemRef { key: string; dataset: LinkableDatasetId; slug: string; url: string; title?: string; missing: boolean }
  ```
  contexts via `readContext` (ContextIoError → missing); items like `resolveLinks` (existence by `entryFileRelPath`,
  title via `loadEntry`); HTML via `renderMarkdown` + `rewriteRenderedHtml(…, { dataset: 'recipe', slug, fromRelPath: '' })`
  (non-okf dataset: only `ctxman:` and external links are rewritten, like context notes). `backRefs: []`.
- `collections-check.ts`: `checkYamlDataset(ctx, 'recipe')` runs after `'context'`; keep a
  `Map<contextSlug, Set<itemKey>>` of schema-valid contexts. Per schema-valid recipe (all warnings, `file` = `recipe/<x>.yaml`):
  `collections/recipe-context-missing` (`context ${slug} does not exist`), `collections/recipe-item-missing`
  (`item ${key} does not exist`), and, only when every listed context exists and is valid,
  `collections/recipe-override-stale` (`override ${key} matches no item of this recipe`) and
  `collections/recipe-order-stale` (`order key ${key} matches nothing in this recipe`; valid keys: `ctx:` of listed
  contexts, reachable item keys, `md:` of blocks, `sec:extra`).
- `templates.ts`: `planNewEntry('recipe', name, …)` → `[{ relPath: 'recipe/<name>.yaml', content: stringifyYaml({ name, description, target: 'claude-code', layout: 'grouped', contexts: [], items: [] }) }]` (equals `serializeRecipe` of the parsed result).
- `package.json`: `"add:recipe": "node scripts/add-entry.ts recipe"` after `add:context`. `scripts/add-entry.ts` needs
  no logic change (`DATASET_SCHEMAS` validates).

### 8.2 Pages and components (Q2)
- `Header.astro`: `active` type += `'inflate'`; tool links become Forge, **Inflate** (`href="/inflate"`,
  `data-testid="nav-inflate"`), Tools. `Base.astro` Props `active` type += `'inflate'`.
- `[dataset]/index.astro`: `newHref` for recipe = `/inflate?recipe=new`.
- `EntryTable.astro`: columns for recipe `['entry', 'desc', 'target', 'contexts', 'tags', 'modified']`; labels Target
  (`TARGETS[e.recipeTarget].label`), Contexts (`e.contextCount ?? 0`, `cx-mono`).
- `[dataset]/[slug]/index.astro`: recipe → action `<a class="ck-button ck-button--primary ck-button--sm" href="/inflate?recipe=<slug>" data-testid="detail-open-inflate">Open in Inflate</a>`;
  main = lede description + `<RecipeComposition slug data contexts items preambleHtml blocks />`; BackRefs hidden for
  context and recipe. `MetaPanel` `kind` += `'recipe'` with rows Target (label) and Layout (`LAYOUT_LABELS`).
- `RecipeComposition.astro` (`<section data-testid="recipe-composition">`), panels in order:
  Contexts (n): `<li data-testid="recipe-context" data-slug data-missing?>` link `/context/<slug>`, description,
  `N links`, `missing` badge. Ad hoc items (n): `<li data-testid="recipe-item" data-key data-missing?>` DatasetBadge
  twin + title link. Preamble: rendered HTML in `cx-prose` (if any). Markdown blocks (n): `<details>` per block with
  `<summary><code>id</code></summary>` + HTML. Overrides (n): table key / mode / options (`k=v` joined `, `) /
  `excluded`. Custom order: `<ol>` of keys when `order` non-empty. Empty panels show "None".
- Dashboard `index.astro`: a `Panel title="Recipes" count id="h-recipes" testid="dashboard-recipes"` below Contexts,
  same markup as the Contexts panel: row = slug link, description, ``${contextCount} ctx · ${target label}``, button
  `Inflate` → `/inflate?recipe=<slug>`; actions New → `/inflate?recipe=new`; empty state "No recipes yet." + New recipe.
- `app.css` (`@layer cx-app`): `cx-recipe__*` rules for RecipeComposition only (reuse `cx-panel`, `cx-minilist`).

## 9. UI (Q3) — `/inflate`

### 9.1 Page, URL, island
`src/pages/inflate.astro`:
```astro
---
import path from 'node:path';
import Base from '../layouts/Base.astro';
import Inflate from '../ui/inflate/Inflate.tsx';
const outDir = path.join(process.cwd(), 'out') + path.sep;
---
<Base title="Context Inflate" active="inflate" fill>
  <h1 class="ck-sr-only">Context Inflate</h1>
  <Inflate client:only="react" outDir={outDir}><div slot="fallback" class="cx-island-fallback">Loading Inflate…</div></Inflate>
</Base>
```
`src/lib/url-state.ts` (Q1):
```ts
export const INFLATE_VIEWS = ['compose', 'preview'] as const;
export type InflateView = (typeof INFLATE_VIEWS)[number];
export interface InflateUrl { recipe: string | null /* slug | 'new' */; view: InflateView; dataset: LinkableDatasetId; q: string }
export const INFLATE_DEFAULT_DATASET: LinkableDatasetId = 'kb';
export function parseInflateUrl(params: URLSearchParams): InflateUrl;   // invalid recipe → null, invalid view → compose, invalid dataset → kb
export function inflateHref(u: InflateUrl, pathname = '/inflate'): string;   // withParams, defaults dataset kb, view compose omitted
```
| param | write mode |
|---|---|
| `recipe` | pushState (`new` pushes state `{ ctxmanInflateNew: true }`) |
| `view` | replaceState |
| `dataset` | pushState |
| `q` | replaceState, debounced 150 ms |

### 9.2 Store `src/stores/inflate.ts` (pattern = `src/stores/forge.ts`; copy its structure)
```ts
export const $inflateUrl = map<InflateUrl>({ recipe: null, view: 'compose', dataset: 'kb', q: '' });
export const $baseline = atom<RecipeData | null>(null);
export const $working = atom<RecipeData | null>(null);
export const $recipeLoad = atom<{ status: 'none' | 'loading' | 'ready' | 'not-found' | 'error'; message?: string }>({ status: 'none' });
export const $saveStatus = atom<SaveStatus>({ kind: 'idle' });        // same type as forge
export const $dirty = computed([$working, $baseline], (w, b) => w !== null && b !== null && !sameRecipe(w, b));
export const $contextDocs = map<Record<string, ContextLookup>>({});
export const $plan = computed([$working, $contextDocs, $entries], (w, c, e) => w === null ? null : expandRecipe(w, browserLookup(c, e)));
export const $render = atom<{ status: 'idle' | 'loading' | 'ready' | 'error'; result: InflateResult | null; message?: string }>({ status: 'idle', result: null });
export const $writePath = atom<string | null>(null);                  // null = default path
export const $writeStatus = atom<{ kind: 'idle' | 'writing' | 'written' | 'error'; message?: string; path?: string; bytes?: number }>({ kind: 'idle' });
export const $lastAddedBlock = atom<string | null>(null);
export const $pendingSwitch = atom<{ next: string | null } | null>(null);
export const $newRecipePrefill = atom<string>('');
```
- `onMount($inflateUrl)`: `applyUrl()`; `ensureEntries` for every `LINKABLE_DATASETS` id plus `'context'` and
  `'recipe'`; `syncRecipe()`; listeners popstate / beforeunload (`$dirty`) / keydown Cmd/Ctrl+S (`saveIfDirty`,
  skip `e.defaultPrevented`), and `$working.listen(scheduleRender)`. Cleanup removes them and flushes `q`.
- `loadRecipe(slug)` = forge `loadContext` against `GET /api/recipe/<slug>` (body `{ recipe }`); `adopt(recipe)` sets
  baseline/working clones, calls `ensureContext(slug)` for each `recipe.contexts`, and `renderNow()`.
- `ensureContext(slug)`: no-op if present; sets `loading`; `GET /api/context/<slug>` → 200 `ready` with `body.context`;
  404 → `missing`; 422 → `invalid` (body message); else `invalid` with `HTTP <status>`.
- Render: `scheduleRender()` = clear timer, `setTimeout(renderNow, 400)`. `renderNow()`: working null → idle;
  `seq++`, status loading (keep previous result), `POST /api/inflate/render` body `$working`; drop responses with
  an old `seq`; 200 → ready; else error with message.
- Edit actions (all immutable, all call `touch()` like forge, never write history):
  | action | effect on working |
  |---|---|
  | `setDescription(t)` | description |
  | `setTarget(t)`, `setLayout(l)` | target / layout |
  | `setPreamble(md)` | `preamble` (`''` → key deleted) |
  | `toggleContext(slug, on)` | on: append + `ensureContext`; off: remove + `prune` |
  | `addItem(ds, slug)` | append `{dataset, slug}` if absent |
  | `removeItem(key)` | drop from `items` + `prune` |
  | `setExcluded(key, on)` | override.exclude (`false` → delete key) |
  | `setMode(key, mode)` | override.mode; deleted when equal to the mode the plan would pick without it |
  | `setOption(key, id, value)` | override.options[id]; deleted when equal to `baseOptionValue(…)` |
  | `setDefaultMode(kind, mode \| null)` | `defaults[kind].mode` (null / equal to `defaultModeFor` → deleted) |
  | `moveSegment(key, dir)` | `order = $plan` keys with `key` swapped with its neighbour |
  | `insertMarkdownAfter(key \| null)` | `id = nextBlockId(ids)`; push `{id, body: ''}`; `order = plan keys` with `md:id` after `key` (null → end); `$lastAddedBlock.set(id)` |
  | `setMarkdownBody(id, body)` | body |
  | `removeMarkdown(id)` | drop block + `prune` |
  | `resetOrder()` | `order = []` |
  | `pruneStale()` | `prune` on current working |
  Overrides left with no mode/options/exclude are removed. `prune(next)`: `p = expandRecipe(next, lookup)`; when
  `!p.pending`: `order` keeps keys present in `p.segments`, `overrides` keeps keys of item segments.
- `save/revert/deleteRecipe/createRecipe/selectRecipe/confirmSwitch/cancelSwitch/cancelNewRecipe/saveIfDirty`:
  forge semantics against the recipe API; `createRecipe({ name, description, target })` POSTs
  `{ name, description, target, layout: 'grouped', contexts: [], items: [] }`; 409 → name field error
  `A recipe with this name already exists.`; `invalidateEntries('recipe')` after create/save/delete.
- `setView(v)`, `setDataset(ds)`, `setQuery(q)`, `flushQuery()`: forge semantics.
- `writeOutput(path)`: `$writeStatus` writing → `POST /api/inflate/write { recipe: $working, path }` → 200 written
  (`path`, `bytes`) / error (body message). `setWritePath(v)`.
- `reloadSources()`: `invalidateEntries` for all ids above, refetch every key of `$contextDocs`, then `renderNow()`.

### 9.3 Layout (`Inflate.tsx`, default export `Inflate({ outDir }: { outDir: string })`)
```html
<div class="cx-inflate" data-testid="inflate">
  <RecipeBar/>                                  <!-- .cx-inflate__bar -->
  <div class="cx-inflate__body" data-view={view}>
    compose: <SourcesPane/> <CompositionPane/>
    preview: <PreviewPane outDir/>
  </div>
  <NewRecipeDialog/> <DiscardDialog/>           <!-- discard = forge DiscardDialog with inflate-* ids -->
</div>
```
No recipe selected → body shows `EmptyState title="No recipe selected"` + text "Pick a recipe or create one. A recipe
lists contexts and extra items, how to include each one, and their order." + `Button primary "New recipe"`
(`inflate-empty-new`). Loading / not-found / error states exactly as the Forge context pane (texts with "recipe").
Panes reuse the Forge classes `cx-forge__pane`, `cx-forge__pane-header`, `cx-forge__pane-title`, `cx-forge__pane-body`,
`cx-forge__toolbar`, `cx-forge__count`, `cx-forge__status`, and `cx-discover*` for rows.

**RecipeBar** (left → right): `Select` recipes (`triggerTestId="inflate-recipe-select"`, items = `$entries.recipe`
sorted by slug + `ListBoxItem id="__new__"` "+ New recipe…" `data-testid="inflate-recipe-new"`); when working:
`Select` target (`inflate-target`, items `INFLATE_TARGETS` labels); `ChipGroup` single "Layout"
(`inflate-layout-toggle`, chips `inflate-layout-grouped` / `inflate-layout-flat`); `ChipGroup` single "View"
(`inflate-view-toggle`, `inflate-view-compose` / `inflate-view-preview`); `ButtonLink` "View page ↗"
(`inflate-view-recipe`, `/recipe/<name>`); spacer; Save `<Kbd>{modKeyLabel}S</Kbd>` (`inflate-save`), Revert
(`inflate-revert`), Delete… (`inflate-delete` → ConfirmDialog `inflate-delete-dialog`, title
`Delete recipe "<name>"?`, body "This deletes data/recipe/<name>.yaml. Contexts and entries are not affected."),
status `<span role="status" data-testid="inflate-status" data-kind>` with forge texts.

**SourcesPane** (`<section data-testid="inflate-sources">`, scrolls):
1. `TextField label="Description"` (`inflate-description`, single line).
2. `Disclosure title="Instructions (preamble)" meta={line count or 'none'} triggerTestId="inflate-preamble-toggle"` →
   `CodeEditor language="markdown" compact` auto 8→24 lines, `testId="inflate-preamble"`, `onSave={saveIfDirty}`,
   placeholder "Markdown instructions placed at the top of the document…".
3. "Contexts" list (`<ul data-testid="inflate-contexts">`): per context of `$entries.context`, kit `Checkbox`
   `isSelected={working.contexts.includes(slug)}` `onChange={(on) => toggleContext(slug, on)}`
   `data-testid="inflate-context" data-slug={slug}`, label `name` + `cx-subtle` `${linkCount} links`. Contexts
   listed in the recipe but absent from `$entries` are shown checked with a `missing` badge.
4. `Disclosure title="Default modes"`: one row per `ITEM_KINDS` entry: label + `Select` (`inflate-default-<kind>`)
   with `modesFor(kind)` plus "Default (<defaultModeFor label>)" option id `__default__` → `setDefaultMode(kind, null)`.
5. "Add items" = `AdhocDiscover`: Tabs over `LINKABLE_DATASETS` (`inflate-tab-<ds>`), `SearchField`
   (`inflate-filter-q`, URL `q`), count line (`inflate-result-count`), `GridList` (`inflate-results`) rows as the
   Forge `DiscoverRow` (`data-testid="inflate-result" data-slug data-added`), action button `inflate-add`
   ("+ Add" / "✓ Added", added = in `working.items`). Filtering = `filterEntries(entries, { q, sort: 'modified' })`, cap 200.
6. `Button "+ Markdown block"` (`inflate-add-markdown`) → `insertMarkdownAfter(null)`.

**CompositionPane** (`<section data-testid="inflate-composition">`): header "Composition" + count `${n} segments`,
`Button "Reset order"` (`inflate-reset-order`, disabled when `order` empty), `Button "Reload sources"`
(`inflate-reload`); plan warnings `<ul data-testid="inflate-plan-warnings">` (each `<li>` text = message) with
`Button "Prune stale"` (`inflate-prune-stale`) when `!plan.pending` and (`staleOverrides` non-empty or some `order` key is not a key of `plan.segments`); then
`<ol class="cx-segs" data-testid="inflate-segments">` of `SegmentRow`.

**SegmentRow** `<li class="cx-seg" data-testid="inflate-segment" data-key data-type data-status data-ds?>`:
- head: index, then by type:
  - item: `DatasetBadge`, title (link to `/<ds>/<slug>` new tab), `<code>` slug, kind badge for references
    (+ `uriKind`), via chips (`Badge tone="muted"` per context) + `Badge tone="info"` "ad hoc", status badges
    (`missing`/`invalid` danger, `excluded` muted, `loading` = Spinner), notes badge (`${n} note(s)`, `title` = notes
    text), size (`formatBytes` of the last manifest segment with this key, `cx-mono`).
  - context-intro: "Context:" + name + description (`cx-subtle`, truncated) + "also: <keys>" when crossRefs.
  - section-intro: "Additional items".
  - markdown: `Disclosure title={`Markdown ${id}`} meta={firstLine(body, 60) || 'empty'}`
    `triggerTestId="inflate-md-toggle"` `defaultExpanded={id === $lastAddedBlock}` → `CodeEditor` markdown compact
    auto 6→24 `testId="inflate-md-editor"` `onSave={saveIfDirty}`.
- `Toolbar` (`cx-seg__actions`): ↑ `inflate-segment-up`, ↓ `inflate-segment-down`, `+ md` `inflate-segment-insert-md`
  (→ `insertMarkdownAfter(key)`), item with `via.length > 0`: toggle button "Exclude"/"Include"
  (`inflate-segment-exclude`), item with `adhoc` or markdown: × `inflate-segment-remove`. Focus after move = forge
  rule (same-direction button of the moved row, else the opposite one).
- item with a kind and status included/excluded: options row `OptionControls`:
  `Select size="sm" aria-label={`Mode for ${title}`} triggerTestId="inflate-segment-mode"` over
  `modesFor(kind)` (`ListBoxItem id=mode.id description=mode.description`); then for each option of the mode:
  checkbox → kit `Checkbox` `data-testid={`inflate-opt-${id}`}`; `select-number` → `Select size="sm"`
  `triggerTestId="inflate-opt-treeLimit"`; text → `TextField size="sm" mono inputTestId="inflate-opt-cloneDir"`
  (value = resolved option; invalid per `isSafeRelativeDir` → `errorMessage` and not committed).
- segment warnings: `<p class="cx-seg__warn" data-testid="inflate-segment-warning">` per message.

**PreviewPane** (`<section data-testid="inflate-preview">`): header: render status
(`<span role="status" data-testid="inflate-render-status" data-kind="loading|ready|error">`: "Rendering…",
`${formatBytes(bytes)} · ${counts.included} items`, `Render failed: ${message}`), `Button "Copy"` (`inflate-copy`,
`navigator.clipboard.writeText`, transient "Copied" label 1.5 s via local state), `Button "Download .md"`
(`inflate-download`, `Blob` + `a[download="<name>.md"]`). Body grid: left `CodeEditor language="markdown" readOnly
height={{ mode: 'fill' }} testId="inflate-preview-editor" ariaLabel="Generated markdown"`; right column:
`TextField label="Write to path" mono inputTestId="inflate-write-path"` value `$writePath ?? outDir + name + '.md'`,
`Button primary "Write file"` (`inflate-write`), `<p role="status" data-testid="inflate-write-status">`
("Wrote <path> (<size>)" / error); manifest warnings list; table `data-testid="inflate-manifest"` columns #, Item
(title + `<code>key</code>`), Mode (`modeLabel` or type), Size, Status; rows `<tr data-testid="inflate-manifest-row" data-key data-status>`.

**NewRecipeDialog** = forge `NewContextDialog` with ids `inflate-new-dialog`, `inflate-new-name`,
`inflate-new-description`, `inflate-new-target` (Select, default claude-code), `inflate-new-cancel`,
`inflate-new-create`; extra name rule: `new` → `"new" is reserved`; exists message "A recipe with this name already exists".

`src/ui/inflate/format.ts` (PURE): `formatBytes(n)` → `< 1024` `${n} B`; `< 1048576` `${(n/1024).toFixed(1)} KB`;
else `${(n/1048576).toFixed(1)} MB`. `firstLine(text, max)`, `lineCount(text)` (copy forge `notes.ts` helpers or
import them from `../forge/notes.ts`).

### 9.4 CSS (`src/ui/inflate/inflate.css`, `@layer cx-app`; `global.css` imports it after `forge.css`)
```css
.cx-inflate { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.cx-inflate__bar { display: flex; align-items: center; gap: var(--sp-3); min-height: 40px; padding: 0 var(--sp-4); border-bottom: 1px solid var(--accent-line); background: var(--bg-deep); flex-wrap: wrap; }
.cx-inflate__spacer { flex: 1; }
.cx-inflate__body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(340px, 0.9fr) minmax(520px, 1.4fr); }
.cx-inflate__body[data-view='preview'] { grid-template-columns: minmax(0, 1.6fr) minmax(320px, 1fr); }
.cx-segs { display: flex; flex-direction: column; border: 1px solid var(--border); margin: var(--sp-3) var(--sp-4); }
.cx-seg { padding: 0 var(--sp-3); background: var(--surface); border-bottom: 1px solid var(--border); border-left: 2px solid var(--ds-c, var(--border-strong)); }
.cx-seg:last-child { border-bottom: 0; }
.cx-seg[data-type='context-intro'], .cx-seg[data-type='section-intro'] { background: var(--bg-deep); border-left-color: var(--ds-context); }
.cx-seg[data-type='markdown'] { border-left-color: var(--accent); }
.cx-seg[data-status='excluded'] { opacity: 0.6; border-left-style: dashed; }
.cx-seg[data-status='missing'], .cx-seg[data-status='invalid'] { border-left-color: var(--danger); background: var(--danger-bg); }
.cx-seg__head { display: flex; align-items: center; gap: var(--sp-2); min-height: var(--row-h); min-width: 0; }
.cx-seg__actions { margin-left: auto; }
.cx-seg__opts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-3); padding: 0 0 var(--sp-2) 26px; }
.cx-seg__warn { padding: 0 0 var(--sp-1) 26px; font-size: var(--fs-xs); color: var(--warn-fg); }
.cx-preview__side { display: flex; flex-direction: column; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); overflow: auto; border-left: 1px solid var(--accent-line); }
@media (max-width: 899px) { .cx-inflate__body, .cx-inflate__body[data-view='preview'] { grid-template-columns: minmax(0, 1fr); } }
```
`tokens.css`: `--cx-neon-teal: #2ee6c5;` in the ours block, `--ds-recipe: var(--cx-neon-teal); --ds-recipe-fg: var(--cx-neon-teal);`.
`global.css`: `[data-ds='recipe'] { --ds-c: var(--ds-recipe); --ds-fg: var(--ds-recipe-fg); }` after `context`.
(`cyber-palette.ts` is NOT changed: the color is not used by Monaco/Shiki.)

`AddEntryForm.tsx`: `created.dataset === 'recipe'` → extra `ButtonLink "Open in Inflate"` → `/inflate?recipe=<slug>`.

## 10. Seed `data/recipe/ctxman-dev-brief.yaml` (Q1; exact file content)
```yaml
name: ctxman-dev-brief
description: Session brief for working on ctxman itself, built from the ctxman-dev context plus the add-entry skill.
tags:
  - ctxman
target: claude-code
layout: grouped
preamble: |
  You are working on ctxman, a local-only Astro app. Use pnpm only, never npm.

  Before finishing any change, run `pnpm run test:all`.
contexts:
  - ctxman-dev
items:
  - dataset: skill
    slug: ctxman-add-entry
markdown:
  - id: b1
    body: |
      ## Ground rules

      - Keep `AGENTS.md` current in the same change as the code.
      - Never call `getCollection('context')` or `getCollection('recipe')` at runtime.
overrides:
  - key: kb/ctxman
    mode: inline-bundle
  - key: bug/stale-badge-timezone
    exclude: true
  - key: reference/astro-docs
    mode: clone
    options:
      sparse: true
order:
  - md:b1
  - ctx:ctxman-dev
```
Expected plan keys (grouped): `md:b1, ctx:ctxman-dev, kb/ctxman, kb/astro-content-layer, rca/astro-dev-full-reload-on-save,
idea/context-inflate, task/write-agents-md, bug/stale-badge-timezone (excluded), feature/context-forge, project/ctxman-v1,
skill/okf-authoring, reference/astro-docs, sec:extra, skill/ctxman-add-entry`. `pnpm run check` must stay at 0/0.

## 11. Tests

### 11.1 Vitest (Q1; fixtures via `tests/unit/fixtures/data-fixtures.ts`, never `./data`)
- Update: `registry.test.ts` (ids incl. recipe, navLabels incl. `Recipes`, LINKABLE = all minus context and recipe),
  `schemas.test.ts` (MINIMAL.recipe `{ name: 'x', description: 'd' }`), `templates.test.ts`, `run-script.test.ts`
  (`recipe: 'recipe/x.yaml'`), `scripts.test.ts` (add recipe → passes check-all), `entry-summary.test.ts`,
  `search-index.test.ts`, `url-state.test.ts`, `collections-check.test.ts` (add a recipe to `validDataTree()`,
  bump `filesChecked`, one test per new rule).
- New: `recipe-io.test.ts` (mirror `context-io.test.ts`); `inflate-catalog.test.ts` (tables §4.1–4.4 exactly,
  `itemKindOf`, `isSafeRelativeDir` accepts `.ctxman/refs/{name}`, `refs/a-b`, rejects `/x`, `../x`, `a/../b`, `C:/x`,
  `a b`; `nextBlockId([])='b1'`, `(['b1','b7','x'])='b8'`; key patterns); `inflate-recipe.test.ts` (schema
  superRefine table, `partialRecord` unknown kind rejected, serializer key order + omissions, round-trip
  `serializeRecipe(parse(serializeRecipe(r)))` stable, `sameRecipe` ignores CRLF/trailing-space differences);
  `inflate-expand.test.ts` (applyOrder cases §5.2; dedupe across two contexts with both notes kept in context order;
  ad hoc + context item → one segment `adhoc: true`; missing context/item warnings; loading → `pending`; defaults
  precedence built-in < recipe < override; invalid modes fall back with warnings; exclude; groups + crossRefs;
  flat layout has no intros; new context link appended after its predecessor; stale override listed);
  `inflate-markdown.test.ts` (shiftHeadings incl. fenced `#`, `~~~` fences, clamp at 6, no headings; stripLeadingTitle;
  rewriteLinks cases: `/concepts/one.md`, `./one.md` from `concepts/x.md`, `../main.md#demo`, `ctxman:kb/demo`, image,
  external, `#anchor`, inside code fence, unresolved target unchanged, path with space → `<…>`; fenced with inner
  ``` ; shQuote; guidance multi-line + two contexts); `inflate-render.test.ts` (golden §6.4 exact string; flat; codex;
  generic; every mode of §6.3 at least once incl. inline-bundle with includeLog + includeFrontmatter, pointer eager per
  target, tree with limit + missing path warning, clone shallow/sparse, remote-skill git/subpath/tar/zip; manifest
  counts/bytes/warnings; large-output); `inflate-fs-sources.test.ts` (fixture dir: each lookup status, `~` expansion with
  injected homeDir, listDir order/skips, entryRef for context); `inflate-write.test.ts` (every checkOutputPath rule
  and message; writeOutput creates parent dirs, overwrites a file, rejects a directory, no `.tmp` left).

### 11.2 Playwright (Q4) — `tests/e2e/inflate.spec.ts`, plus `smoke.spec.ts` and `api.spec.ts` additions
Tests that save first create a copy of the seed via `POST /api/recipe` (body = `GET /api/recipe/ctxman-dev-brief`
recipe with `name: uniqueName('e2e-rcp')`); the seed is never modified. Wait for `inflate` and for
`[data-testid="inflate-segment"][data-key="kb/ctxman"]` before interacting.
1. Seed loads: segment keys in order (§10, via `data-key`); `bug/stale-badge-timezone` has `data-status="excluded"`;
   `kb/ctxman` mode trigger shows "Inline bundle".
2. Mode toggle: set `kb/astro-content-layer` mode to "Summary" → manifest row (preview view) shows mode "Summary";
   toggle `inflate-opt-includeFrontmatter` on `kb/ctxman` → render status returns to ready; save → YAML override has
   `options.includeFrontmatter: true`.
3. Insert markdown after `kb/ctxman` (`inflate-segment-insert-md`), its editor opens; `typeIntoMonaco(page,
   'inflate-md-editor', 'E2E-MARKER')`; Cmd/Ctrl+S; YAML: block body contains `E2E-MARKER`, `order` has `md:b2`
   right after `kb/ctxman`.
4. Reorder: ↑ on `task/write-agents-md` → it precedes `idea/context-inflate` in the DOM; save; YAML `order` matches.
5. Preview: `?view=preview` → `inflate-render-status` `data-kind="ready"`; `inflate-preview-editor .view-lines`
   contains `# <name>`; `inflate-manifest-row` count ≥ 13; `POST /api/inflate/render` (request fixture) body contains
   `## Context: ctxman-dev`, `### ctxman`, `## Additional items`, `.claude/skills/ctxman-add-entry`.
6. Write: fill `inflate-write-path` with `path.join(os.tmpdir(), 'ctxman-e2e-<rand>', 'brief.md')`, click
   `inflate-write`, status contains the path; file exists and starts with `# <name>\n`.
7. Copy (grant `clipboard-read`/`clipboard-write`) → clipboard starts with `# `; Download → `suggestedFilename()` = `<name>.md`.
8. New recipe: `/inflate?recipe=new` → dialog; `new` is rejected; valid name + description → Create → URL has
   `recipe=<name>`, `recipe/<name>.yaml` exists; check a context (`inflate-context[data-slug="okf-authoring"]`) →
   segments appear; save; YAML `contexts: [okf-authoring]`.
9. Dirty guard: edit description, select another recipe → `inflate-discard-dialog` visible.
10. `/recipe` lists `ctxman-dev-brief` (`list-row[data-slug]`); `/recipe/ctxman-dev-brief` shows `recipe-composition`,
    `recipe-context[data-slug="ctxman-dev"]`, `recipe-item[data-key="skill/ctxman-add-entry"]`; `detail-open-inflate`
    navigates to `/inflate?recipe=ctxman-dev-brief`. Dashboard has `dataset-card-recipe`, `dashboard-recipes`, nav `nav-inflate`.
11. api.spec: recipe CRUD statuses (201/200/204/404/409/400 name-mismatch/415/403); render 400 on invalid body;
    write 400 `bad-path` for relative, `.txt`, inside `E2E_DATA_DIR`, and `node_modules`.
12. smoke.spec: `DATASETS` += `'recipe'`; `/inflate` returns 200 and shows `inflate` (or its fallback then island).

### 11.3 Test-id registry additions (append to the §L table style in AGENTS-referenced docs)
| area | test ids |
|---|---|
| shell / dashboard / detail | `nav-recipe`, `nav-inflate`, `dataset-card-recipe`, `dashboard-recipes`, `detail-open-inflate`, `recipe-composition`, `recipe-context` (+ `data-slug`, `data-missing`), `recipe-item` (+ `data-key`, `data-missing`) |
| inflate bar | `inflate`, `inflate-recipe-select`, `inflate-recipe-new`, `inflate-empty-new`, `inflate-target`, `inflate-layout-toggle`, `inflate-layout-grouped`, `inflate-layout-flat`, `inflate-view-toggle`, `inflate-view-compose`, `inflate-view-preview`, `inflate-view-recipe`, `inflate-save`, `inflate-revert`, `inflate-delete`, `inflate-status`, `inflate-delete-dialog`, `inflate-discard-dialog`, `inflate-new-dialog`, `inflate-new-name`, `inflate-new-description`, `inflate-new-target`, `inflate-new-cancel`, `inflate-new-create` |
| sources | `inflate-sources`, `inflate-description`, `inflate-preamble-toggle`, `inflate-preamble`, `inflate-contexts`, `inflate-context` (+ `data-slug`), `inflate-default-<kind>`, `inflate-tab-<ds>`, `inflate-filter-q`, `inflate-result-count`, `inflate-results`, `inflate-result` (+ `data-slug`, `data-added`), `inflate-add`, `inflate-add-markdown` |
| composition | `inflate-composition`, `inflate-reset-order`, `inflate-reload`, `inflate-plan-warnings`, `inflate-prune-stale`, `inflate-segments`, `inflate-segment` (+ `data-key`, `data-type`, `data-status`), `inflate-segment-mode`, `inflate-opt-<optionId>`, `inflate-segment-up`, `inflate-segment-down`, `inflate-segment-insert-md`, `inflate-segment-exclude`, `inflate-segment-remove`, `inflate-segment-warning`, `inflate-md-toggle`, `inflate-md-editor` |
| preview | `inflate-preview`, `inflate-render-status`, `inflate-copy`, `inflate-download`, `inflate-preview-editor`, `inflate-write-path`, `inflate-write`, `inflate-write-status`, `inflate-manifest`, `inflate-manifest-row` (+ `data-key`, `data-status`) |

## 12. Work packets

All packets: pnpm only; run `pnpm run typecheck && pnpm run lint && pnpm run fmt:check && pnpm run test` for
what you touched before handing back; never edit another packet's files (list §1).

- **Q1 — data layer + inflate libs + unit tests + seed.** Order: catalog.ts → schemas/registry → recipe.ts →
  expand.ts → markdown.ts → render.ts → pipeline.ts/fs-sources.ts → write.ts → recipe-io.ts → content.config,
  templates, package.json, collections-check, entry-summary, search-index, entries.ts, url-state → seed →
  `.gitignore`/`.oxlintrc.json`/`.oxfmtrc.json` (`out`) → tests §11.1. Done when `pnpm run check` is 0/0 with the seed
  and every §11.1 test passes.
- **Q2 — API + SSR pages** (parallel with Q1 against §3, §5.6, §6.3, §7, §8 contracts): http.ts, api routes, Header,
  Base, list/detail/dashboard pages, MetaPanel, EntryTable, RecipeComposition, app.css. Verify with
  `pnpm exec astro dev --port 4330 --ignore-lock` + curl once Q1 lands.
- **Q3 — UI** (parallel against §4 catalog exports, §5 expand types, §7.3 API shapes, §9): `src/pages/inflate.astro`,
  `src/ui/inflate/**`, `src/stores/inflate.ts`, tokens.css/global.css, AddEntryForm. React rules (no setState in
  effects, `$now` for time, history writes only in actions/onMount). Kit by `../kit/index.ts` (pulls Monaco: fine here).
- **Q4 — e2e + docs** (after Q1–Q3): §11.2 specs; `AGENTS.md` (repo map: `recipe/<name>.yaml`, `out/`, `src/lib/inflate`,
  `ui/inflate`; routes `/inflate`, `/recipe`; API list; dataset table row `recipe | yaml | recipe/<name>.yaml | none;
  contexts, items, overrides, order, markdown, preamble`; islands = 4; URL params Inflate: `recipe`, `view`, `dataset`,
  `q`; remove the "Not built … context inflate" sentence; `add:<ds>` = 11 ids; recipe read through recipe-io, never
  `getCollection('recipe')`); `data/kb/ctxman`: new concept `concepts/context-inflate.md` (type `Concept`; modes table,
  targets table, output format, API), updates to `datasets.md`, `routes-and-api.md`, `architecture.md` (4 islands,
  inflate libs layering), `runtime-modes.md` (recipe watcher-less loader), `compliance-checks.md` (4 new rules),
  `search.md` (recipes indexed), `adding-entries.md` (`add:recipe`), `index.md` entry, dated `log.md` line;
  `data/skill/ctxman-add-entry/SKILL.md` (recipe); `data/idea/context-inflate/main.md` state `complete` + "Status:
  built" paragraph + log line; `data/context/ctxman-dev.yaml` notes for `idea/context-inflate` → "Built: see
  [Context inflate](ctxman:kb/ctxman) concepts/context-inflate.md." (plain text, notes are markdown). grep specs for
  the old note text before changing it. Finish with `pnpm run test:all` green.
