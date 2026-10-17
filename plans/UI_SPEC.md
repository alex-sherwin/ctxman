# ctxman UI spec (v2, 2026-10-17)

Binding for every UI implementer. Read `INITIAL_INSTRUCTIONS.md` and `plans/ARCHITECTURE.md` (including amendments
10–13) first; this file designs inside those routes/datasets/APIs. Where this spec deliberately deviates from
ARCHITECTURE it says so (§0.4) — implement this spec. "Context inflate" is out of scope; no UI for it anywhere.

Conventions: `ck-` = kit class (src/ui/kit), `cx-` = app class, `cyber-` = cybercore-css 0.3.0 class (never defined by
us). BEM-ish: `block__element--modifier`. All RAC imports come from the package root `react-aria-components`
(verified against 1.22.1 `dist/types/exports/index.d.ts`). Every `cyber-*` class named here was verified with
`grep -c` against `node_modules/cybercore-css/dist/cybercore.css`.

### Changelog
- **v2** (amendments 10–13):
  1. Theme is cyberpunk on **cybercore-css 0.3.0**, dark only. The light theme and every `prefers-color-scheme` rule
     are gone. Our layers come after cybercore's (§0.2). Tokens map onto `--cyber-*` variables. Dataset and state
     colors are re-derived from the neon palette, with ≥ 4.5:1 text contrast checked (§A).
  2. Fonts are **Inter Variable** (all UI text) and **Hack** (all monospace), self-hosted from npm, with no Google
     Fonts link. cybercore's `--font-body`, `--font-display` and `--font-mono` are overridden (§A.1).
  3. **Monaco** is used for all markdown/JSON/YAML input. New kit `CodeEditor` (§B.22) and Monaco theme `ctxman-cyber`
     (§B.23). Forge link notes now use Monaco, and the Forge has a YAML view of the whole context with live
     parse + zod validation (§H.7). Shiki shares the palette (§J.0).
  4. **Dense layout**: 2/4/6/8/12/16 px spacing scale, 28 px rows/controls, 11–12 px metadata. cybercore's roomy
     component padding is overridden. Rows replace cards for lists (§A, B, D–H).
  5. Context description is a single-line `TextField` (amendment 11). Notes disclosures start collapsed, so Monaco
     only mounts on expand.
  6. New test ids for editors and the YAML view (§L).
- **v1**: initial spec.

---

## 0. Ground rules and decisions

### 0.1 Rendering model
- `.astro` pages SSR all layout, navigation, lists, detail rendering. React is used for exactly three islands:
  | island | file | mounted in | directive |
  |---|---|---|---|
  | `SearchWidget` | `src/ui/search/SearchWidget.tsx` | `Base.astro` (every page) | `client:only="react"` |
  | `Forge` | `src/ui/forge/Forge.tsx` | `src/pages/forge.astro` | `client:only="react"` + `<div slot="fallback" class="cx-island-fallback">Loading Forge…</div>` |
  | `ToolsRunner` | `src/ui/tools/ToolsRunner.tsx` | `src/pages/tools.astro` | `client:only="react"` + fallback "Loading tools…" |
  Why `client:only`: island stores initialize from `window.location` inside nanostores `onMount`. No server-side store
  state means no hydration mismatch and no module-singleton store shared across SSR requests. Monaco also needs
  `window`.
- No island props except `ToolsRunner` (see §I). Islands import registry/allowlist modules directly (pure TS).
- `/[dataset]` list filters are a plain GET `<form>` (works with JS disabled) enhanced by a vanilla Astro `<script>`
  (§E.4). No React there.
- The kit (`src/ui/kit`) is React-only and **styled only by our CSS**. Astro components emit **HTML twins**: the
  same `ck-*` classes on native elements (`<a class="ck-button …">`, `<span class="ck-badge …">`, `<kbd class="ck-kbd">`,
  `<label class="ck-chip">`, `<input class="ck-input">`, `<select class="ck-native-select">`). The class names are
  the contract. Kit CSS styles RAC state via `[data-*]` and twins via native pseudo-classes, told apart by RAC's
  `data-rac` attribute (e.g. `.ck-button[data-hovered]` vs `.ck-button:not([data-rac]):hover`).
- **Composing `cyber-*` classes** (rules):
  1. Never on an element that has a `ck-*` class, and never on form controls or buttons. cybercore's `cyber-btn` /
     `cyber-input` pseudo-elements and clip-paths would fight the kit.
  2. Allowed only on app containers and effects, and only at these places:
     | where | classes |
     |---|---|
     | header brand (§C.2) | `cyber-glitch cyber-glitch--subtle cyber-text-glow` + `data-text` |
     | dashboard dataset tiles (§D) | `cyber-card cyber-card--interactive` |
     | search overlay decorative layer (§G.7) | `cyber-scanlines cyber-scanlines--fine` |
     | Tools output panel (§I.4) | `cyber-terminal`, `cyber-terminal__header`, `cyber-terminal__dot cyber-terminal__dot--red|--yellow|--green`, `cyber-terminal__title`, `cyber-terminal__body` |
     | Tools output panel decorative layer | `cyber-scanlines cyber-scanlines--fine` |
     Any new use needs the class verified (`grep -c "\.cyber-foo\b" node_modules/cybercore-css/dist/cybercore.css`).
     Avoid the SKILL.md "do not exist" list.
- **No Astro `<style>` blocks** (they emit unlayered CSS, which beats every layer and breaks §0.2). All CSS lives in
  the global chain.

### 0.2 CSS loading and cascade layers (one chain)
- `src/styles/global.css` is the only stylesheet entry; `Base.astro` does `import '../styles/global.css'` in frontmatter.
- Exact head of `global.css` (order matters):
  ```css
  /* 1. Full layer order, declared FIRST. cybercore's five layers, then ours. cybercore.css re-declares
        `@layer reset, base, theme, components, utilities;` at its top; re-declaring existing names is a no-op,
        so this statement fixes the final order. */
  @layer reset, base, theme, components, utilities,
         cx-tokens, cx-base, cx-kit, cx-app, cx-prose, cx-utilities;

  /* 2. Fonts: @font-face only, unlayered (has no effect on cascade). */
  @import "@fontsource-variable/inter/index.css";   /* family 'Inter Variable' (exports "./*.css") */
  @import "hack-font/build/web/hack.css";            /* family 'Hack', 400/700 + italics */

  /* 3. cybercore: all its rules live in its own layers reset…utilities. */
  @import "cybercore-css/dist/cybercore.css";        /* package exports "./dist/*" */

  /* 4. Ours. Each file wraps all of its rules in the named layer block, e.g. `@layer cx-kit { … }`. */
  @import "./tokens.css";          /* @layer cx-tokens */
  @import "../ui/kit/kit.css";     /* @imports every src/ui/kit/<Name>.css; each wraps in @layer cx-kit */
  @import "./app.css";             /* @layer cx-app — shell, pages, astro components */
  @import "../ui/search/search.css";  /* @layer cx-app */
  @import "../ui/forge/forge.css";    /* @layer cx-app */
  @import "../ui/tools/tools.css";    /* @layer cx-app */
  @import "./prose.css";           /* @layer cx-prose */
  /* 5. then the @layer cx-base { … } and @layer cx-utilities { … } blocks from §A.2 in this file */
  ```
- **Effective precedence, lowest → highest:** cybercore `reset` < `base` < `theme` < `components` < `utilities` <
  `cx-tokens` < `cx-base` < `cx-kit` < `cx-app` < `cx-prose` < `cx-utilities` < **unlayered** (Monaco's injected
  CSS, @font-face, inline `style`).
  Consequences:
  - Our token overrides in `cx-tokens` beat cybercore's `:root` theme values, e.g. `--font-body` and `--card-accent`
    set on a class.
  - Any property our `cx-*` rule sets beats cybercore, **including cybercore utilities**. A `cyber-p-*` utility on
    an element we style has no effect when our rule sets `padding`. Don't mix them.
  - Monaco's own unlayered CSS always wins over ours. Style Monaco only through its theme (§B.23) and options, plus
    a few container rules.
  - Layer names must stay `cx-*`. Reusing `reset`, `base` or `utilities` would merge our rules into cybercore's
    layers.
- Kit `.tsx` files and island `.tsx` files **never import CSS** (so twins on pages without islands are styled and
  there is no duplicate CSS). Exception: Monaco's own CSS, which `monaco-editor` imports itself through the local
  Vite loader (§B.22).
- **Dark only.** No `prefers-color-scheme` queries anywhere. cybercore sets `color-scheme: dark` on `html`.
  `Base.astro` adds `<meta name="color-scheme" content="dark">`.
- cybercore's reset zeroes **all** margin/padding (`* { margin:0; padding:0 }`), forces `html { font-size:16px }`,
  and makes `h1`–`h6` uppercase display-font at `--text-5xl`…`--text-lg`. It also gives `code` a box. §A.2 `cx-base`
  re-establishes our dense typography. Every list, `dd` and table cell that needs spacing gets it from our classes.

### 0.3 State policy (URL is the page state)
- **URL state** = anything that changes which data is shown or selected: filters, sort, selected dataset tab, selected
  context, search open/query/dataset filter, preselected add-entry dataset.
- **Not URL state** (explicit exceptions): unsaved edits (Forge working copy — protected by dirty flag + `beforeunload`
  + confirm), action results (script output, save status), ephemeral presentation (disclosure expanded, tooltip,
  hover, focus).
- **Markdown/JSON/YAML input is always a `CodeEditor` (Monaco, §B.22)**, never a TextArea. This covers today's
  Forge notes and YAML view and any future reference/entry editors (amendment 11). Single-line plain fields stay
  `TextField`.
- **nanostores** hold all island state that is shared between components or URL-synced. `useState` is allowed only
  for component-local transient drafts (e.g. New Context dialog fields before submit, add-tag input).
- **Sync pattern** (React-rules safe — no setState in effects, no impure render):
  1. Each URL-synced store module registers `onMount($store, () => { applyUrl(); addEventListener('popstate', …);
     …; return cleanup })`. `applyUrl()` parses `location.search` and `.set()`s stores. `useStore` in the island
     triggers mount.
  2. Actions are plain exported functions in `src/stores/*.ts`, called from event handlers. They `.set()` stores and
     call `history.pushState/replaceState` themselves.
  3. Components only `useStore(...)` and call actions. Time comes from `$now` (§0.6), never `Date.now()` in render.
  4. `popstate` handlers re-run `applyUrl()` and never write history.
- **URL helpers** `src/lib/url-state.ts` (pure, unit-tested):
  - `readList(params, key): string[]` — repeated keys (`state=a&state=b`); for `in` only, comma-split.
  - `withParams(href: string, patch: Record<string, string | readonly string[] | null>, defaults?: Record<string,string>): string`
    — returns `pathname + ?search + hash`; removes a key when value is `null`, `''`, `[]`, or equals `defaults[key]`;
    keeps unrelated params in original order; appends patched keys in patch order; arrays become repeated keys
    except `in` (comma-joined, sorted in registry order).
  - Debounced writers use one module-level `setTimeout` handle per store; expose `flush()`.

### 0.4 Deviations from ARCHITECTURE (orchestrator: please reflect)
1. **Search params namespaced**: ARCHITECTURE says `?search=1&q=…&in=…`. `q` collides with `/[dataset]` and `/forge`
   `q`. The widget uses **`search=1`, `sq` (query), `in` (comma-separated dataset ids)**. If a `/search` route is
   built it only 302-redirects `/search?q=X&in=Y` → `/?search=1&sq=X&in=Y`.
2. **Context name is read-only after creation** (name == file stem == slug; rename = new file + broken history/back-refs).
   Forge edits description, tags, links, notes. Rename is out of scope for v1.
3. **Forge links list is an `<ol>` + per-row RAC `Toolbar`, not a GridList**: rows contain a TextArea; GridList
   keyboard handling (arrow keys, typeahead) conflicts with text editing inside rows.

### 0.5 Data contracts the UI depends on (lib/API implementers must provide exactly these)
```ts
// src/datasets/registry.ts (UI requirements)
export type DatasetId = 'kb'|'rca'|'idea'|'task'|'bug'|'feature'|'project'|'skill'|'reference'|'context';
export type LinkableDatasetId = Exclude<DatasetId, 'context'>;
export type StateGroup = 'neutral'|'active'|'done'|'closed';
export interface DatasetDef {
  id: DatasetId; label: string /* 'Knowledge base' */; navLabel: string /* 'KB' */; plural: string /* 'knowledge base entries' */;
  singular: string /* 'kb entry', 'task', … used in "New task" */; kind: 'okf'|'skill'|'data';
  states?: readonly { id: string; label: string; group: StateGroup }[]; // lifecycle order
}
export const DATASETS: readonly DatasetDef[];          // order: kb rca idea task bug feature project skill reference context
export const LINKABLE_DATASETS: readonly LinkableDatasetId[]; // same order minus context
export function getDataset(id: string): DatasetDef | undefined;
export function stateGroup(dataset: DatasetId, state: string): StateGroup;
// groups: pending→neutral; in-progress→active; complete|fixed→done; abandoned|wont-do|wont-fix→closed
```
navLabel values: KB, RCA, Ideas, Tasks, Bugs, Features, Projects, Skills, References, Contexts.

```ts
// Entry summary — returned by src/lib/entries.ts (SSR) and GET /api/entries?dataset=<id> → { entries: EntrySummary[] }
export interface EntrySummary {
  dataset: DatasetId; slug: string; name: string; title?: string; description: string; tags: string[];
  state?: string;                // lifecycle datasets only
  lastModified: string;          // ISO. ALL datasets: okf = max mtime in bundle; skill = max mtime in dir; yaml = file mtime
  staleAfter?: string;           // OKF stale_after YYYY-MM-DD
  stale: boolean;                // today(local) >= staleAfter
  okfStatus?: 'draft'|'stable'|'deprecated';
  refType?: 'local-repo'|'remote-repo'|'remote-skill'; // reference only
  linkCount?: number;            // context only
  url: string;                   // '/kb/foo'
}
// GET /api/search-index.json → { generatedAt: string; docs: SearchDoc[] }
export interface SearchDoc {
  id: string /* 'kb/foo/concepts/x' or 'reference/bar' */; dataset: DatasetId; slug: string;
  path: string | null /* bundle-relative file e.g. 'concepts/x.md'; null for the entry itself (main.md/SKILL.md/yaml) */;
  title: string; name: string; description: string; tags: string[]; headings: string[]; body: string;
  state?: string; url: string /* '/kb/foo' or '/kb/foo/doc/concepts/x' */;
}
// Context API
export interface ContextLink { dataset: LinkableDatasetId; slug: string; notes?: string }
export interface ContextDoc { name: string; description: string; tags?: string[]; links: ContextLink[] }
// GET /api/context/:slug → 200 {context} | 404 {error}
// PUT /api/context/:slug body ContextDoc → 200 {context} | 400 {error, issues: {path: string; message: string}[]}
// POST /api/context body ContextDoc → 201 {context} | 409 {error} | 400 {error, issues}
// DELETE /api/context/:slug → 204 | 404
// Scripts: POST /api/scripts/:name
//   check-kind body {} ; add body { dataset, name, description, title? }
//   → 200 { code: number; stdout: string; stderr: string; durationMs: number; created?: { dataset; slug; path } }
//   (`created` present iff name==='add' && code===0; non-allowlisted name → 404)
```
- `src/lib/scripts-allowlist.ts` (pure): `export const SCRIPTS: readonly { name: string; label: string; description: string; kind: 'check'|'add' }[]`.
  UI renders every `kind:'check'` entry in the script list; the `add` entry powers the Add Entry form.
- `src/lib/entry-filter.ts` (pure, shared by SSR list pages and Forge):
  `filterEntries(entries, { q, states, tags, type, sort }) → EntrySummary[]` and `tagCounts(entries) → {tag,count}[]`
  (count desc, then tag asc). Semantics: `q` lowercased, split on whitespace, every term must be a substring of
  `name + title + description + tags.join(' ')`; `states` OR; `tags` AND; `type` equals `refType`;
  sort `name` (title ?? name, asc, `localeCompare`), `modified` (lastModified desc, default), `state` (registry
  lifecycle order, then name). Unknown sort → `modified`.
- `src/lib/time.ts` (pure): `formatRelative(iso: string, nowMs: number): string` (Intl.RelativeTimeFormat 'en',
  numeric:'auto'; <45s "just now", <45min minutes, <22h hours, <26d days, <11mo months, else years);
  `formatAbsolute(iso): string` → `YYYY-MM-DD HH:mm` local; `todayYmd(nowMs): string`.
- `src/lib/context-yaml.ts` (pure, shared by the Forge YAML view and the server context writer):
  `serializeContext(doc)` and `parseContextYaml(text, expectedName)` (§H.7).
- `src/lib/cyber-palette.ts` (pure): hex mirror of the cybercore 0.3.0 palette plus our extra neons, for Monaco
  and Shiki (§B.23, §J.0). A unit test asserts it matches `node_modules/cybercore-css/dist/cybercore.css`.
- Doc routes: `/[dataset]/[slug]/doc/<bundle-relative path without .md>` (matches `docs` collection id), e.g.
  `/kb/ctxman/doc/index`, `/kb/ctxman/doc/concepts/search`. `main.md` has no doc route; it is `/[dataset]/[slug]`.

### 0.6 Shared stores
- `src/stores/now.ts`: `export const $now = atom<number>(0)`; `onMount($now, () => { $now.set(Date.now()); const t = setInterval(() => $now.set(Date.now()), 1000); return () => clearInterval(t) })`.
- `src/stores/platform.ts`: `export const isMac: boolean = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)`; `export const modKeyLabel = isMac ? '⌘' : 'Ctrl'`.
- `src/stores/entries.ts` (entries cache, used by Forge):
  ```ts
  type EntriesState = { status: 'loading'|'ready'|'error'; entries: EntrySummary[]; error?: string };
  export const $entries = map<Partial<Record<DatasetId, EntriesState>>>({});
  export function ensureEntries(ds: DatasetId): void   // no-op if loading/ready; dedupe via module Map<DatasetId, Promise>
  export function invalidateEntries(ds: DatasetId): void // delete key then ensureEntries(ds)
  export function findEntry(ds: DatasetId, slug: string): EntrySummary | undefined // reads $entries.get()
  ```

---


## A. Design tokens and global styles

cybercore owns the raw palette (`--cyber-*`), the semantic surface variables (`--color-*`), glows (`--glow-*`) and
its own scales (`--space-*`, `--text-*`, `--radius-*`). **Our components use only our tokens** (`--bg`, `--fg`,
`--sp-*`, `--fs-*` …). Those are defined *from* cybercore variables, so a retint of `--cyber-cyan-500` flows through.
We override exactly these cybercore variables: `--font-body`, `--font-display`, `--font-mono` (amendment 12) and
`--glow-text-magenta|yellow|green` (missing upstream). We never redefine `--z-modal` (cybercore: 1000) or
`--z-sticky` (100); our z tokens are placed relative to them.

### A.1 `src/styles/tokens.css` (complete)
```css
@layer cx-tokens {
  :root {
    /* ---- fonts (override cybercore's variables so cyber-* components use them too) ---- */
    --font-body: "Inter Variable", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --font-display: var(--font-body);
    --font-mono: "Hack", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    --font-sans: var(--font-body);           /* our alias */

    /* ---- type (dense; px so cybercore's fluid --text-* never leaks in) ---- */
    --fs-xs: 11px;      /* badges, table headers, legends, kbd */
    --fs-sm: 12px;      /* metadata, descriptions, chips, secondary text */
    --fs-md: 13px;      /* base UI text, inputs, buttons-as-text */
    --fs-lg: 14px;      /* prose body, search result titles */
    --fs-xl: 16px;      /* prose h2, search input */
    --fs-2xl: 20px;     /* page h1 */
    --fs-3xl: 22px;     /* dashboard tile count */
    --fs-mono: 0.92em;  /* inline mono inside sans text (Hack runs wide) */
    --lh-tight: 1.2; --lh: 1.4; --lh-prose: 1.55;
    --fw-normal: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700;
    --tracking-label: 0.06em;  /* uppercase HUD labels */

    /* ---- spacing (tight: 2/4/6/8/12/16; 16 is the max, used only between page sections) ---- */
    --sp-0: 0; --sp-1: 2px; --sp-2: 4px; --sp-3: 6px; --sp-4: 8px; --sp-5: 12px; --sp-6: 16px;

    /* ---- radius / borders / sizes ---- */
    --r-sm: 2px; --r-md: 3px; --r-lg: 4px; --r-pill: 999px;
    --r-cyber: 0 6px 0 6px;              /* scaled-down cybercore --radius-cyber (0 12px 0 12px) */
    --cut: 6px;                          /* corner-cut size for clip-path on panels/dialogs */
    --border-w: 1px; --focus-w: 2px; --focus-offset: 1px;
    --control-h-sm: 22px; --control-h-md: 28px; --control-h-lg: 36px;
    --row-h: 28px;                       /* table rows, list rows, menu/listbox items */
    --header-h: 40px; --gutter: 12px; --content-max: 1600px; --sidebar-w: 280px; --prose-max: 84ch;

    /* ---- motion / layering ---- */
    --dur-fast: 80ms; --dur: 150ms; --ease: var(--ease-cyber, cubic-bezier(0.77, 0, 0.175, 1));
    --z-header: var(--z-sticky);         /* 100 */
    --z-popover: calc(var(--z-modal) + 100);   /* 1100: Select/Menu popovers can open from inside modals */
    --z-tooltip: calc(var(--z-modal) + 200);   /* 1200 */

    /* ---- extra neons (cybercore 0.3.0 ships only cyan/magenta/yellow/green; these match its saturation) ---- */
    --cx-neon-orange: #ff8a3d;
    --cx-neon-blue: #5c9dff;    --cx-neon-blue-text: #7db1ff;
    --cx-neon-violet: #b26bff;  --cx-neon-violet-text: #c493ff;
    --cx-neon-lime: #b8ff3d;
    --cx-neon-pink: #ff6ad5;
    --cx-magenta-text: #ff6b96;  /* magenta-500 is 4.49:1 on tinted void-400; this is 6.0:1 */

    /* ---- surfaces + text ---- */
    --bg: var(--cyber-void-500);           /* #0d0e14 page */
    --bg-subtle: var(--cyber-void-400);    /* #12141d panels, table head, header */
    --bg-muted: var(--cyber-void-300);     /* #181a25 hover, code, closed-state */
    --surface: var(--cyber-void-400);
    --surface-raised: var(--cyber-void-200);  /* #1f2230 popovers, dialogs */
    --bg-deep: var(--cyber-void-700);      /* #07080c header bar, search overlay, editor gutter */
    --border: var(--cyber-void-100);       /* #2a2d3a */
    --border-strong: var(--cyber-chrome-600);  /* #5c647a (non-text, 3.3:1) */
    --fg: var(--cyber-chrome-100);         /* #f0f1f5 — 17.1:1 on bg, 14.0:1 on surface-raised */
    --fg-muted: var(--cyber-chrome-300);   /* #b2b7c7 — 9.6:1 on bg, 7.9:1 on surface-raised */
    --fg-subtle: var(--cyber-chrome-400);  /* #939ab0 — 6.9:1 on bg, 5.6:1 on surface-raised. chrome-500 fails on void-300/400; never use it for text */

    /* ---- accent (cyan = default/primary/info) ---- */
    --accent: var(--cyber-cyan-500);       /* #00f0ff */
    --accent-hover: var(--cyber-cyan-400);
    --accent-pressed: var(--cyber-cyan-600);
    --accent-on: var(--cyber-void-500);    /* text on filled cyan: 13.7:1 */
    --accent-text: var(--cyber-cyan-500);  /* links: 13.7:1 */
    --accent-bg: color-mix(in srgb, var(--cyber-cyan-500) 14%, var(--cyber-void-400));  /* selected wash */
    --accent-line: color-mix(in srgb, var(--cyber-cyan-500) 40%, transparent);          /* hairlines */
    --focus-ring: var(--cyber-cyan-500);
    --glow-sm: 0 0 6px color-mix(in srgb, var(--cyber-cyan-500) 55%, transparent);
    --glow-md: 0 0 12px color-mix(in srgb, var(--cyber-cyan-500) 40%, transparent);

    /* ---- semantics (magenta danger, yellow warning, green success, cyan info) ---- */
    --danger: var(--cyber-magenta-500);
    --danger-hover: color-mix(in srgb, var(--cyber-magenta-500) 80%, white);
    --danger-on: var(--cyber-void-500);    /* 5.3:1 on magenta */
    --danger-fg: var(--cx-magenta-text);
    --danger-bg: color-mix(in srgb, var(--cyber-magenta-500) 14%, var(--cyber-void-400));
    --success-fg: var(--cyber-green-500);  --success-bg: color-mix(in srgb, var(--cyber-green-500) 14%, var(--cyber-void-400));
    --warn-fg: var(--cyber-yellow-500);    --warn-bg: color-mix(in srgb, var(--cyber-yellow-500) 14%, var(--cyber-void-400));
    --info-fg: var(--cyber-cyan-500);      --info-bg: var(--accent-bg);
    --glow-text-magenta: 0 0 10px var(--cyber-magenta-500), 0 0 20px color-mix(in srgb, var(--cyber-magenta-500) 60%, transparent);
    --glow-text-yellow: 0 0 10px var(--cyber-yellow-500), 0 0 20px color-mix(in srgb, var(--cyber-yellow-500) 60%, transparent);
    --glow-text-green: 0 0 10px var(--cyber-green-500), 0 0 20px color-mix(in srgb, var(--cyber-green-500) 60%, transparent);

    --overlay: color-mix(in srgb, var(--cyber-void-900) 82%, transparent);
    --mark-bg: color-mix(in srgb, var(--cyber-yellow-500) 28%, var(--cyber-void-500));  /* fg on it: 7.7:1 */
    --mark-fg: var(--cyber-chrome-100);
    --code-bg: var(--cyber-void-300);
    --code-bg-block: var(--cyber-void-700);
    --selection-bg: color-mix(in srgb, var(--cyber-cyan-500) 25%, var(--cyber-void-500));  /* fg on it: 9.2:1 */
    --scrollbar: var(--cyber-void-100);
    --shadow-md: 0 4px 16px rgb(0 0 0 / 0.55);
    --shadow-lg: 0 12px 40px rgb(0 0 0 / 0.7);

    /* ---- dataset colors: --ds-X solid neon (dots, bars, borders); -fg text on -bg tint (>= 5.4:1); -bg tint ---- */
    --ds-kb: var(--cyber-cyan-500);       --ds-kb-fg: var(--cyber-cyan-500);
    --ds-rca: var(--cx-neon-orange);      --ds-rca-fg: var(--cx-neon-orange);
    --ds-idea: var(--cyber-yellow-500);   --ds-idea-fg: var(--cyber-yellow-500);
    --ds-task: var(--cx-neon-blue);       --ds-task-fg: var(--cx-neon-blue-text);
    --ds-bug: var(--cyber-magenta-500);   --ds-bug-fg: var(--cx-magenta-text);
    --ds-feature: var(--cyber-green-500); --ds-feature-fg: var(--cyber-green-500);
    --ds-project: var(--cx-neon-violet);  --ds-project-fg: var(--cx-neon-violet-text);
    --ds-skill: var(--cx-neon-lime);      --ds-skill-fg: var(--cx-neon-lime);
    --ds-reference: var(--cyber-chrome-300); --ds-reference-fg: var(--cyber-chrome-300);
    --ds-context: var(--cx-neon-pink);    --ds-context-fg: var(--cx-neon-pink);
    /* tints: 14% of the solid over void-400 (defined per dataset in §A.2 via --ds-bg) */
  }
}
```
Verified contrast of each `-fg` on its 14% tint over void-400 (WCAG AA ≥ 4.5):
kb 9.6, rca 6.3, idea 10.7, task 6.8, bug 6.0, feature 10.1, project 6.6, skill 10.7, reference 7.1, context 5.9.
Bug uses magenta and ideas use yellow: these share hues with danger/warning. That is acceptable because dataset
badges always print the dataset id in mono, while semantic states use the pill-with-dot form (§B.16). Never use a
dataset color to signal state.

### A.2 `src/styles/global.css` (after the head from §0.2; complete)
```css
@layer cx-base {
  html {
    font-family: var(--font-body);
    font-size: var(--fs-md);              /* beats cybercore's 16px root for inherited text; rem stays 16px */
    line-height: var(--lh);
    font-feature-settings: "cv11", "ss01";  /* Inter: single-storey a, open digits */
    font-optical-sizing: auto;
    scrollbar-color: var(--scrollbar) transparent;
    scroll-behavior: auto;                /* cybercore sets smooth; anchors in a dense tool should jump */
  }
  body {
    display: flex; flex-direction: column; min-height: 100dvh;
    font-size: var(--fs-md); line-height: var(--lh);   /* override cybercore's fluid --text-base / 1.6 */
    color: var(--fg); background: var(--bg);
  }
  ::selection { background: var(--selection-bg); color: var(--fg); }

  /* cybercore h1-h6 are uppercase display-font at 2.4–4.5rem: restore dense, sentence-case headings */
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-body); text-transform: none; letter-spacing: 0;
    line-height: var(--lh-tight); font-weight: var(--fw-semibold);
  }
  h1 { font-size: var(--fs-2xl); }
  h2 { font-size: var(--fs-lg); }
  h3, h4, h5, h6 { font-size: var(--fs-md); }

  /* cybercore boxes every <code>; we use <code> for slugs/paths in dense rows: plain mono by default */
  code, kbd, samp, pre { font-family: var(--font-mono); font-size: var(--fs-mono); font-variant-ligatures: none; }
  code { padding: 0; border: 0; background: none; color: inherit; border-radius: 0; }

  a { color: var(--accent-text); text-decoration: none; }
  a:hover { text-decoration: underline; text-underline-offset: 2px; }

  :focus { outline: none; }
  :focus-visible { outline: var(--focus-w) solid var(--focus-ring); outline-offset: var(--focus-offset); box-shadow: var(--glow-sm); }
  /* Monaco's hidden textarea must not draw our ring; the editor container shows focus (§B.22) */
  .monaco-editor :focus-visible { outline: none; box-shadow: none; }

  hr { border: 0; border-top: var(--border-w) solid var(--border); margin: var(--sp-5) 0; }
  time { font-variant-numeric: tabular-nums; }
  ul, ol { list-style: none; }            /* cybercore zeroes padding; lists are unstyled unless a class adds bullets */
  table { border-collapse: collapse; border-spacing: 0; }
  [hidden] { display: none !important; }

  /* dataset color scope: any element with data-ds gets local vars */
  [data-ds] { --ds-bg: color-mix(in srgb, var(--ds-c) 14%, var(--cyber-void-400)); --ds-line: color-mix(in srgb, var(--ds-c) 45%, transparent); }
  [data-ds="kb"]        { --ds-c: var(--ds-kb);        --ds-fg: var(--ds-kb-fg); }
  [data-ds="rca"]       { --ds-c: var(--ds-rca);       --ds-fg: var(--ds-rca-fg); }
  [data-ds="idea"]      { --ds-c: var(--ds-idea);      --ds-fg: var(--ds-idea-fg); }
  [data-ds="task"]      { --ds-c: var(--ds-task);      --ds-fg: var(--ds-task-fg); }
  [data-ds="bug"]       { --ds-c: var(--ds-bug);       --ds-fg: var(--ds-bug-fg); }
  [data-ds="feature"]   { --ds-c: var(--ds-feature);   --ds-fg: var(--ds-feature-fg); }
  [data-ds="project"]   { --ds-c: var(--ds-project);   --ds-fg: var(--ds-project-fg); }
  [data-ds="skill"]     { --ds-c: var(--ds-skill);     --ds-fg: var(--ds-skill-fg); }
  [data-ds="reference"] { --ds-c: var(--ds-reference); --ds-fg: var(--ds-reference-fg); }
  [data-ds="context"]   { --ds-c: var(--ds-context);   --ds-fg: var(--ds-context-fg); }

  /* lifecycle state groups: neutral=chrome outline, active=cyan ("blue" role), done=green, closed=dim chrome */
  [data-state-group="neutral"] { --st-fg: var(--fg-muted);   --st-bg: transparent;      --st-border: var(--border-strong); }
  [data-state-group="active"]  { --st-fg: var(--info-fg);    --st-bg: var(--info-bg);   --st-border: var(--accent-line); }
  [data-state-group="done"]    { --st-fg: var(--success-fg); --st-bg: var(--success-bg); --st-border: color-mix(in srgb, var(--success-fg) 40%, transparent); }
  [data-state-group="closed"]  { --st-fg: var(--fg-subtle);  --st-bg: var(--bg-muted);  --st-border: transparent; }
}
/* contrast: neutral 9.6, active 9.6, done 10.1, closed 6.2 (on their backgrounds) */

@layer cx-utilities {
  .ck-sr-only {
    position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  .cx-mono { font-family: var(--font-mono); font-size: var(--fs-mono); }
  .cx-muted { color: var(--fg-muted); }
  .cx-subtle { color: var(--fg-subtle); }
  .cx-label { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); }
  .cx-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .cx-clamp-2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
  .cx-stack { display: flex; flex-direction: column; gap: var(--sp-3); }
  .cx-row { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; }
  .cx-island-fallback { padding: var(--sp-5); color: var(--fg-subtle); }
}
```
- HUD label convention: section/panel titles, table headers and legends use `.cx-label` style (uppercase, tracked,
  11px). Entry titles and page `h1` are content and stay sentence case.
- Density rules for implementers: control and row height 28px (`--row-h`); vertical padding inside rows 4–6px; gaps
  between sibling controls 4–8px; panel inner padding 8px/12px; gap between page sections 12px (16px max); no
  element gets margin larger than `--sp-6`.

## B. Kit (`src/ui/kit/`)

### B.0 Shared
- `src/ui/kit/utils.ts`:
  ```ts
  export function cx(...c: Array<string | false | null | undefined>): string; // join truthy with ' '
  // Merge a kit base class into a RAC className (string or render function):
  // className={composeRenderProps(props.className, (c) => cx('ck-button', `ck-button--${variant}`, c))}
  ```
  `composeRenderProps` is imported from `react-aria-components`.
- Every wrapper: `export function Name(props: NameProps)`; spreads remaining RAC props; className merged as above;
  forwards `data-testid` (RAC passes `data-*` through via GlobalDOMAttributes; verify per component, else put it on
  the outer element explicitly).
- Files: `<Name>.tsx` + `<Name>.css` per component; `kit.css` `@import`s all CSS files in the order of §B.21; every
  kit CSS file wraps its rules in `@layer cx-kit { … }`.
- **Do not** style `.react-aria-*` default classes; always set kit classes. Never add `cyber-*` classes inside the kit.
- Kit look (cyberpunk on our CSS): hairline borders on `--border`, neon accents on interaction, uppercase tracked
  labels for buttons/tabs/headers, sharp corners (`--r-sm`/`--r-cyber`), glow only on focus/hover of interactive
  accents. All sizes come from §A tokens; nothing uses cybercore's fluid `--space-*`/`--text-*`.

### B.1 Button — `Button.tsx`, `Button.css`
- RAC: `Button`, `Link`, `composeRenderProps`, types `ButtonProps as AriaButtonProps`, `LinkProps as AriaLinkProps`.
- ```ts
  export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
  export type ButtonSize = 'sm' | 'md';
  export interface ButtonProps extends AriaButtonProps { variant?: ButtonVariant /* 'secondary' */; size?: ButtonSize /* 'md' */; iconOnly?: boolean }
  export interface ButtonLinkProps extends AriaLinkProps { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean }
  export function Button(p: ButtonProps); export function ButtonLink(p: ButtonLinkProps);
  ```
- DOM: `<button class="ck-button ck-button--secondary ck-button--md [ck-button--icon]"><span class="ck-button__label">…</span>[<span class="ck-spinner" aria-hidden>]</button>`; ButtonLink renders `<a>`.
  `iconOnly` requires `aria-label`. `isPending` (RAC) shows the spinner over the hidden label.
- Twins: `<a class="ck-button ck-button--secondary ck-button--sm" href>` / `<button class="ck-button …">` (labels inside `<span class="ck-button__label">`).
- Visual: outline buttons in the accent color. On hover/press the button fills with the accent, the text turns
  void-dark, and a small glow appears (cybercore `cyber-btn` language, without its sliding pseudo-element). The
  `r-cyber` corners are sharp top-left/bottom-right and cut top-right/bottom-left.
- Keyboard: Enter/Space (RAC). Disabled is not focusable (RAC).
- **Full CSS**:
```css
@layer cx-kit {
  .ck-button {
    --_c: var(--fg-muted);          /* accent: border + text */
    --_border: var(--border-strong);
    --_bg: transparent;
    --_fill: var(--bg-muted);       /* hover background */
    --_fill-fg: var(--fg);          /* hover text */
    --_glow: none;
    position: relative;
    display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2);
    height: var(--control-h-md); min-width: var(--control-h-md); padding: 0 var(--sp-4);
    font-family: var(--font-body); font-size: var(--fs-sm); font-weight: var(--fw-semibold); line-height: 1;
    letter-spacing: var(--tracking-label); text-transform: uppercase;
    white-space: nowrap; text-decoration: none; color: var(--_c);
    background: var(--_bg); border: var(--border-w) solid var(--_border); border-radius: var(--r-cyber);
    cursor: default; user-select: none; -webkit-tap-highlight-color: transparent; outline: none;
    transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease),
                color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .ck-button:is(a):hover { text-decoration: none; }
  .ck-button[data-hovered], .ck-button:not([data-rac]):hover {
    background: var(--_fill); color: var(--_fill-fg); border-color: var(--_c); box-shadow: var(--_glow);
  }
  .ck-button[data-pressed], .ck-button:not([data-rac]):active { filter: brightness(0.85); }
  .ck-button[data-focus-visible], .ck-button:not([data-rac]):focus-visible {
    outline: var(--focus-w) solid var(--focus-ring); outline-offset: 2px; box-shadow: var(--glow-sm);
  }
  .ck-button[data-disabled], .ck-button:not([data-rac]):disabled, .ck-button[aria-disabled="true"] {
    opacity: 0.4; box-shadow: none; pointer-events: none;
  }
  .ck-button[data-pending] .ck-button__label { visibility: hidden; }
  .ck-button[data-pending] .ck-spinner { position: absolute; inset: 0; margin: auto; }

  .ck-button--primary {
    --_c: var(--accent); --_border: var(--accent);
    --_bg: color-mix(in srgb, var(--accent) 10%, transparent);
    --_fill: var(--accent); --_fill-fg: var(--accent-on); --_glow: var(--glow-md);
  }
  .ck-button--secondary {
    --_c: var(--fg); --_border: var(--border-strong);
    --_fill: var(--accent-bg); --_fill-fg: var(--accent-text);
  }
  .ck-button--secondary[data-hovered], .ck-button--secondary:not([data-rac]):hover { border-color: var(--accent); }
  .ck-button--ghost {
    --_c: var(--fg-muted); --_border: transparent;
    --_fill: var(--bg-muted); --_fill-fg: var(--fg);
  }
  .ck-button--ghost[data-hovered], .ck-button--ghost:not([data-rac]):hover { border-color: transparent; }
  .ck-button--danger {
    --_c: var(--danger-fg); --_border: var(--danger);
    --_fill: var(--danger); --_fill-fg: var(--danger-on);
    --_glow: 0 0 12px color-mix(in srgb, var(--danger) 45%, transparent);
  }

  .ck-button--sm { height: var(--control-h-sm); min-width: var(--control-h-sm); padding: 0 var(--sp-3); font-size: var(--fs-xs); gap: var(--sp-1); border-radius: var(--r-sm); }
  .ck-button--icon { padding: 0; aspect-ratio: 1; letter-spacing: 0; }
  .ck-button > svg, .ck-button__label > svg { width: 13px; height: 13px; flex: none; }
  .ck-button--sm > svg { width: 11px; height: 11px; }
  .ck-button .ck-kbd { height: 16px; min-width: 16px; font-size: 10px; margin-left: var(--sp-1); }

  .ck-spinner {
    display: inline-block; width: 12px; height: 12px; flex: none;
    border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%;
    animation: ck-spin 0.7s linear infinite;
  }
  @keyframes ck-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .ck-spinner { animation-duration: 2s; } .ck-button { transition: none; } }
}
```
Contrast: primary resting cyan on a 10% cyan wash is ≥ 11:1, and its hover (void text on cyan) is 13.7:1. Danger
resting is 6.0:1 and its hover 5.3:1.

### B.2 ToggleButton + ToggleButtonGroup (chips) — `Chip.tsx`, `Chip.css`
- RAC: `ToggleButton`, `ToggleButtonGroup`, `composeRenderProps`.
- ```ts
  export interface ChipProps extends ToggleButtonProps { count?: number; dataset?: DatasetId; size?: 'sm' | 'md' /* 'sm' */ }
  export interface ChipGroupProps extends ToggleButtonGroupProps { label?: string /* aria-label */ }
  export function Chip(p: ChipProps); export function ChipGroup(p: ChipGroupProps);
  ```
  ChipGroup always passes `aria-label={label}` and defaults `selectionMode="multiple"`.
- DOM: `<div role="toolbar|radiogroup" class="ck-chip-group">` > `<button class="ck-chip ck-chip--sm" data-ds?="kb" aria-pressed>`
  `<span class="ck-chip__dot" aria-hidden/>`(only with dataset) `<span class="ck-chip__label">` `<span class="ck-chip__count">12</span>`.
- Twin (Astro, inside GET form): `<label class="ck-chip ck-chip--sm" data-ds?><input type="checkbox|radio" class="ck-sr-only" name value checked?><span class="ck-chip__label">…</span><span class="ck-chip__count">…</span></label>`.
- States: selected (`[data-selected]` / `:has(input:checked)`) → cyan wash + cyan border + inner glow, while dataset
  chips use their ds colors; disabled; focus-visible ring (`[data-focus-visible]` / `:has(input:focus-visible)`).
- Keyboard: RAC group = arrow keys move between chips, Space/Enter toggles; Tab leaves the group. Twins: Tab per chip, Space toggles.
- CSS (representative):
```css
@layer cx-kit {
  .ck-chip-group { display: flex; flex-wrap: wrap; gap: var(--sp-1); align-items: center; }
  .ck-chip {
    display: inline-flex; align-items: center; gap: var(--sp-2);
    height: var(--control-h-sm); padding: 0 var(--sp-3);
    font-size: var(--fs-sm); line-height: 1; color: var(--fg-muted); white-space: nowrap;
    background: transparent; border: var(--border-w) solid var(--border); border-radius: var(--r-sm);
    cursor: default; user-select: none; outline: none;
  }
  .ck-chip[data-hovered], label.ck-chip:hover { border-color: var(--border-strong); color: var(--fg); }
  .ck-chip[data-selected], label.ck-chip:has(input:checked) {
    color: var(--accent-text); background: var(--accent-bg); border-color: var(--accent);
    box-shadow: inset 0 0 6px color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .ck-chip[data-ds][data-selected], label.ck-chip[data-ds]:has(input:checked) {
    color: var(--ds-fg); background: var(--ds-bg); border-color: var(--ds-c);
    box-shadow: inset 0 0 6px color-mix(in srgb, var(--ds-c) 25%, transparent);
  }
  .ck-chip[data-focus-visible], label.ck-chip:has(input:focus-visible) { outline: var(--focus-w) solid var(--focus-ring); outline-offset: 1px; }
  .ck-chip[data-disabled] { opacity: 0.4; }
  .ck-chip__dot { width: 6px; height: 6px; background: var(--ds-c); box-shadow: 0 0 4px var(--ds-c); }  /* square dot = HUD pixel */
  .ck-chip__count { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--fg-subtle); }
  .ck-chip[data-selected] .ck-chip__count, label.ck-chip:has(input:checked) .ck-chip__count { color: inherit; opacity: 0.85; }
  .ck-chip--md { height: var(--control-h-md); padding: 0 var(--sp-4); font-size: var(--fs-md); }
}
```

### B.3 TextField / SearchField / TextAreaField + Label + FieldError — `Field.tsx`, `Field.css`
- RAC: `TextField`, `SearchField`, `Input`, `TextArea`, `Label`, `Text`, `FieldError`, `Button` (clear), `composeRenderProps`, type `ValidationResult`.
- ```ts
  interface FieldBase { label?: string; description?: string; errorMessage?: string | ((v: ValidationResult) => string); size?: 'sm'|'md'|'lg'; mono?: boolean; placeholder?: string; inputTestId?: string }
  export interface TextFieldProps extends AriaTextFieldProps, FieldBase {}
  export interface SearchFieldProps extends AriaSearchFieldProps, FieldBase { /* label optional → aria-label required */ }
  export interface TextAreaFieldProps extends AriaTextFieldProps, FieldBase { rows?: number /* 3 */ }
  export function TextField(p); export function SearchField(p); export function TextAreaField(p);
  ```
  `inputTestId` is set as `data-testid` on the `<Input>`/`<TextArea>` element (tests type into it).
  **`TextAreaField` is for plain multi-line prose only.** Markdown, JSON and YAML input always uses `CodeEditor`
  (§B.22, amendment 11). v1 screens have no `TextAreaField` usage.
- DOM:
  ```
  <div class="ck-field ck-field--md [ck-field--mono]" data-invalid? data-disabled?>
    <label class="ck-field__label">Name</label>
    <input class="ck-input" />                         (TextArea: <textarea class="ck-input ck-input--multiline" rows>)
    <span slot="description" class="ck-field__description">…</span>
    <span class="ck-field__error">…</span>             (RAC FieldError)
  </div>
  SearchField: <div class="ck-field ck-searchfield"> label? <div class="ck-searchfield__box"><span class="ck-searchfield__icon" aria-hidden>(svg)</span><input class="ck-input"/><button class="ck-searchfield__clear" aria-label="Clear search">×</button></div></div>
  ```
- Twins: `<input class="ck-input" type="search">`, `<select class="ck-native-select">`.
- States: `[data-invalid]` → magenta border + magenta inner glow (cybercore has no validation styling; this is
  ours); `.ck-input[data-focused]` / `:focus-visible` → cyan border + `--glow-sm`; `[data-disabled]`; SearchField
  `[data-empty] .ck-searchfield__clear { visibility:hidden }`.
- Keyboard: SearchField Esc clears when non-empty, else propagates (verified in react-aria `useSearchField`); Enter → `onSubmit`.
- CSS (representative):
```css
@layer cx-kit {
  .ck-field { display: flex; flex-direction: column; gap: var(--sp-1); min-width: 0; }
  .ck-field__label { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); }
  .ck-field__description { font-size: var(--fs-xs); color: var(--fg-subtle); }
  .ck-field__error { font-size: var(--fs-xs); color: var(--danger-fg); }
  .ck-input, .ck-native-select {
    height: var(--control-h-md); padding: 0 var(--sp-3); width: 100%;
    font-family: var(--font-body); font-size: var(--fs-md); color: var(--fg);
    background: var(--cyber-void-700); caret-color: var(--accent);
    border: var(--border-w) solid var(--border); border-radius: var(--r-sm); outline: none;
    transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .ck-input::placeholder { color: var(--fg-subtle); }
  .ck-input[data-hovered], .ck-input:not([data-rac]):hover { border-color: var(--border-strong); }
  .ck-input[data-focused], .ck-input:not([data-rac]):focus-visible, .ck-native-select:focus-visible {
    border-color: var(--accent); box-shadow: var(--glow-sm); outline: none;
  }
  .ck-field[data-invalid] .ck-input, .ck-input[data-invalid] {
    border-color: var(--danger); box-shadow: inset 0 0 6px color-mix(in srgb, var(--danger) 30%, transparent);
  }
  .ck-input[data-disabled] { opacity: 0.5; }
  .ck-input[readonly] { background: var(--bg-subtle); color: var(--fg-muted); border-style: dashed; }
  .ck-input--multiline { height: auto; min-height: calc(var(--control-h-md) * 2); padding: var(--sp-2) var(--sp-3); line-height: var(--lh); resize: vertical; }
  .ck-field--mono .ck-input { font-family: var(--font-mono); font-size: var(--fs-sm); }
  .ck-field--sm .ck-input { height: var(--control-h-sm); font-size: var(--fs-sm); }
  .ck-field--lg .ck-input { height: var(--control-h-lg); font-size: var(--fs-xl); }
  .ck-searchfield__box { position: relative; display: flex; align-items: center; }
  .ck-searchfield .ck-input { padding-inline: 24px 24px; }
  .ck-field--lg.ck-searchfield .ck-input { padding-inline: 32px 32px; }
  .ck-searchfield__icon { position: absolute; left: var(--sp-3); width: 13px; height: 13px; color: var(--accent); pointer-events: none; }
  .ck-field--lg .ck-searchfield__icon { left: var(--sp-4); width: 16px; height: 16px; }
  .ck-searchfield__clear { position: absolute; right: var(--sp-1); /* ghost icon button 18px */ }
  .ck-searchfield[data-empty] .ck-searchfield__clear { visibility: hidden; }
  .ck-native-select { appearance: auto; padding-right: var(--sp-1); }
}
```

### B.4 Select (+ kit ListBoxItem) — `Select.tsx`, `Select.css`
- RAC: `Select`, `SelectValue`, `Label`, `Button`, `Text`, `FieldError`, `Popover`, `ListBox` (+ kit `ListBoxItem` from `./ListBox`).
- The 1.22 API is `value` / `onChange` (single).
  ```ts
  export interface SelectProps<T extends object> extends Omit<AriaSelectProps<T>, 'children'> {
    label?: string; description?: string; errorMessage?: string | ((v: ValidationResult) => string);
    items?: Iterable<T>; children: React.ReactNode | ((item: T) => React.ReactNode); size?: 'sm'|'md'; triggerTestId?: string;
  }
  ```
- DOM: `<div class="ck-select ck-select--md">` `<label class="ck-field__label">` `<button class="ck-select__trigger" data-testid={triggerTestId}><span class="ck-select__value">` (SelectValue; `[data-placeholder]` → `--fg-subtle`) `<span class="ck-select__chevron" aria-hidden>▾</span></button>` description/error; `<Popover class="ck-popover ck-select__popover">` `<ListBox class="ck-listbox">`.
- Popover width: `min-width: var(--trigger-width)`.
- Keyboard: RAC (Enter/Space/↓ opens; typeahead; ↑↓ move; Enter selects; Esc closes).
- CSS: `.ck-select__trigger` copies the `.ck-input` box metrics (28px/22px sm, void-700 bg, hairline border) plus `display:flex; align-items:center; justify-content:space-between; gap: var(--sp-3); text-align:left; font-size: var(--fs-md)`; `.ck-select__chevron { color: var(--accent); font-size: 10px }`; `.ck-select[data-open] .ck-select__trigger, .ck-select__trigger[data-focus-visible] { border-color: var(--accent); box-shadow: var(--glow-sm) }`.

### B.5 ListBox / ListBoxItem / ListBoxSection — `ListBox.tsx`, `ListBox.css`
- RAC: `ListBox`, `ListBoxItem`, `ListBoxSection`, `Header`, `Text`, `Separator`, `composeRenderProps`.
- **This is the only allowed ListBoxItem import** (oxlint rule).
  ```ts
  export interface ListBoxItemProps<T> extends AriaListBoxItemProps<T> { description?: React.ReactNode }
  export function ListBox<T>(p: ListBoxProps<T>); export function ListBoxItem<T>(p: ListBoxItemProps<T>);
  export function ListBoxSection<T>(p: ListBoxSectionProps<T> & { title: React.ReactNode }); // renders <Header class="ck-listbox__header">{title}</Header>
  ```
  When `children` is a string and `textValue` absent, the wrapper sets `textValue`. With `description`, it renders `<Text slot="label">` + `<Text slot="description" class="ck-listbox__desc">`.
- Classes: `ck-listbox`, `ck-listbox__item`, `ck-listbox__section`, `ck-listbox__header`, `ck-listbox__desc`, `ck-listbox__check` (✓ when `[data-selected]`).
- States: `[data-focused]` → `--accent-bg` + `box-shadow: inset 2px 0 0 var(--accent)`; `[data-selected]` → `color: var(--accent-text)` + check; `[data-disabled]` 0.4.
- CSS: `.ck-listbox { outline:none; padding: var(--sp-1); max-height: inherit; overflow:auto }` `.ck-listbox__item { display:flex; align-items:center; gap: var(--sp-3); min-height: var(--row-h); padding: var(--sp-1) var(--sp-3); font-size: var(--fs-md); cursor:default; outline:none }` `.ck-listbox__desc { font-size: var(--fs-xs); color: var(--fg-subtle) }` `.ck-listbox__header { position: sticky; top:0; z-index:1; padding: var(--sp-2) var(--sp-3); font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); background: var(--surface-raised) }`.

### B.6 GridList / GridListItem — `GridList.tsx`, `GridList.css`
- RAC: `GridList`, `GridListItem`, `composeRenderProps`.
- `GridListProps<T>` passthrough + `emptyText?: string` → `renderEmptyState={() => <div class="ck-gridlist__empty">{emptyText}</div>}`.
- Classes: `ck-gridlist` (`display:flex; flex-direction:column; outline:none`), `ck-gridlist__item` (dense row: `min-height: var(--row-h); padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border); outline:none`), `[data-hovered]` → `background: color-mix(in srgb, var(--accent) 5%, transparent)`, `[data-focus-visible]` → `box-shadow: inset 2px 0 0 var(--accent), inset 0 0 0 1px var(--accent-line)`, `[data-disabled]`; `ck-gridlist__empty` (center, `--fg-subtle`, `padding: var(--sp-6) var(--sp-4)`).
- Keyboard: ↑↓ rows, ←→ move into/among focusable children (buttons/links), Enter = `onAction`, Home/End.

### B.7 Tabs — `Tabs.tsx`, `Tabs.css`
- RAC: `Tabs`, `TabList`, `Tab`, `TabPanel`. Controlled: `selectedKey` / `onSelectionChange`.
- Wrappers `Tabs`, `TabList`, `Tab` (+ `count?: number`, `dataset?: DatasetId` → dot), `TabPanel`.
- Classes: `ck-tabs`; `ck-tabs__list` (`display:flex; gap: 0; border-bottom: 1px solid var(--border); overflow-x:auto; scrollbar-width: none`); `ck-tabs__tab` (`height: var(--row-h); padding: 0 var(--sp-4); font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); border-bottom: 2px solid transparent; margin-bottom:-1px; white-space:nowrap; display:inline-flex; gap: var(--sp-2); align-items:center`); `[data-selected]` → `color: var(--ds-fg, var(--accent-text)); border-bottom-color: var(--ds-c, var(--accent)); text-shadow: 0 0 8px color-mix(in srgb, var(--ds-c, var(--accent)) 50%, transparent)` (tabs with `dataset` set `data-ds`); `[data-hovered]` → `color: var(--fg)`; `[data-focus-visible]` → inset ring; `ck-tabs__count` (mono xs, subtle); `ck-tabs__dot` (6px square, `--ds-c`); `ck-tabs__panel` (`outline:none; min-height:0; flex:1; display:flex; flex-direction:column`).
- Keyboard: ←→ move + activate (automatic activation), Home/End; Tab into panel.

### B.8 TagGroup / Tag — `TagGroup.tsx`, `TagGroup.css`
- RAC: `TagGroup`, `TagList`, `Tag`, `Label`, `Button` (slot="remove"), `Text`.
- ```ts
  export interface TagGroupProps<T> extends Omit<AriaTagGroupProps, 'children'> { label?: string; items?: Iterable<T>; children: React.ReactNode | ((i: T) => React.ReactNode); emptyText?: string }
  export interface TagProps extends AriaTagProps {} // renders remove button automatically when parent has onRemove
  ```
  Tag children: `{({ allowsRemoving }) => <>{children}{allowsRemoving && <Button slot="remove" className="ck-tag__remove" aria-label={`Remove ${textValue}`}>×</Button>}</>}`.
- Classes: `ck-taggroup`, `ck-taglist` (flex wrap gap `--sp-1`), `ck-tag` (mono xs, `height: 18px; padding: 0 var(--sp-2); color: var(--fg-muted); border: 1px solid var(--border); border-radius: var(--r-sm)`), `[data-focus-visible]` ring, `ck-tag__remove` (14px, ghost, hover `--danger-fg`).
- Keyboard: ←→ between tags, Backspace/Delete removes the focused tag (when `onRemove`).

### B.9 Dialog / Modal / ModalOverlay (+ full-screen) / ConfirmDialog — `Dialog.tsx`, `Dialog.css`
- RAC: `ModalOverlay`, `Modal`, `Dialog`, `Heading`, `DialogTrigger`.
- ```ts
  export interface ModalProps extends Omit<ModalOverlayProps, 'className'> { variant?: 'dialog' | 'fullscreen' /* 'dialog' */; tone?: 'accent' | 'danger' /* 'accent' */; className?: string; testId?: string }
  // Modal = <ModalOverlay className={cx('ck-modal-overlay', variant==='fullscreen' && 'ck-modal-overlay--fullscreen')} {...rest}>
  //           <Modal className={cx('ck-modal', variant==='fullscreen' && 'ck-modal--fullscreen', tone==='danger' && 'ck-modal--danger', className)} data-testid={testId}>{children}</Modal>
  //         </ModalOverlay>
  export interface DialogProps extends AriaDialogProps { title?: React.ReactNode; footer?: React.ReactNode; bodyClassName?: string }
  // Dialog renders the header (Heading slot="title" .ck-dialog__title) only when title is given, the body div, and the footer div only when footer is given.
  export interface ConfirmDialogProps { isOpen: boolean; title: string; children: React.ReactNode; confirmLabel: string; cancelLabel?: string /* 'Cancel' */; tone?: 'danger'|'primary'; isPending?: boolean; onConfirm(): void; onCancel(): void; testId?: string }
  // ConfirmDialog = Modal(isDismissable, tone = tone==='danger' ? 'danger' : 'accent', onOpenChange(false) → onCancel) + Dialog role="alertdialog"; autofocus on Cancel; confirm Button variant=tone.
  ```
- DOM: `div.ck-modal-overlay > div.ck-modal[role=none] > section.ck-dialog[role=dialog] > header.ck-dialog__header(h2.ck-dialog__title) + div.ck-dialog__body + footer.ck-dialog__footer`.
- Keyboard: focus trapped; Esc closes (unless `isKeyboardDismissDisabled`); focus is restored to the trigger on close (RAC). Scroll lock (RAC). A `CodeEditor` inside a dialog stops Esc from reaching the dialog (§B.22).
- Not cybercore's `cyber-modal`: that one is class-toggled, and RAC owns open state, focus and dismissal here.
- **Full CSS**:
```css
@layer cx-kit {
  .ck-modal-overlay {
    position: fixed; inset: 0; z-index: var(--z-modal);
    display: grid; place-items: center; padding: var(--sp-6);
    background: var(--overlay);
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
  }
  .ck-modal-overlay[data-entering] { animation: ck-fade-in var(--dur) var(--ease); }
  .ck-modal-overlay[data-exiting] { animation: ck-fade-in var(--dur-fast) var(--ease) reverse; }

  .ck-modal {
    --_accent: var(--accent);
    width: min(480px, 100%);
    max-height: calc(100dvh - 2 * var(--sp-6));
    display: flex; flex-direction: column;
    color: var(--fg); background: var(--surface-raised);
    border: var(--border-w) solid color-mix(in srgb, var(--_accent) 45%, transparent);
    border-top: 2px solid var(--_accent);
    clip-path: polygon(0 0, calc(100% - var(--cut)) 0, 100% var(--cut), 100% 100%, var(--cut) 100%, 0 calc(100% - var(--cut)));
    box-shadow: 0 0 24px color-mix(in srgb, var(--_accent) 18%, transparent), var(--shadow-lg);
    outline: none;
  }
  .ck-modal--danger { --_accent: var(--danger); }
  .ck-modal[data-entering] { animation: ck-zoom-in var(--dur) var(--ease); }
  .ck-modal[data-exiting] { animation: ck-zoom-in var(--dur-fast) var(--ease) reverse; }

  /* full-screen variant (global search) */
  .ck-modal-overlay--fullscreen {
    padding: 0; place-items: stretch;
    background: var(--bg-deep);
    -webkit-backdrop-filter: none; backdrop-filter: none;
  }
  .ck-modal--fullscreen {
    position: relative;                 /* anchors the scanline fx layer (§G.7) */
    width: 100vw; height: 100dvh; max-height: none;
    background: var(--bg-deep);
    border: 0; border-top: 2px solid var(--accent);
    clip-path: none; box-shadow: inset 0 12px 24px -16px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .ck-modal--fullscreen[data-entering] { animation: ck-rise-in var(--dur) var(--ease); }
  .ck-modal--fullscreen[data-exiting] { animation: ck-fade-in var(--dur-fast) var(--ease) reverse; }

  .ck-dialog { display: flex; flex-direction: column; flex: 1; min-height: 0; outline: none; }
  .ck-dialog__header {
    display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5); border-bottom: var(--border-w) solid var(--border);
  }
  .ck-dialog__title {
    margin: 0; font-size: var(--fs-xs); font-weight: var(--fw-semibold); line-height: var(--lh-tight);
    text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--accent-text);
  }
  .ck-modal--danger .ck-dialog__title { color: var(--danger-fg); }
  .ck-dialog__body { flex: 1; min-height: 0; overflow: auto; padding: var(--sp-5); display: flex; flex-direction: column; gap: var(--sp-4); font-size: var(--fs-md); }
  .ck-dialog__footer {
    display: flex; justify-content: flex-end; align-items: center; gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-5);
    border-top: var(--border-w) solid var(--border); background: var(--bg-subtle);
  }

  @keyframes ck-fade-in { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ck-zoom-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: none; } }
  @keyframes ck-rise-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    .ck-modal-overlay, .ck-modal { animation: none !important; }
  }
}
```

### B.10 Popover / Menu / MenuTrigger / MenuItem — `Menu.tsx`, `Popover.css`, `Menu.css`
- RAC: `Popover`, `OverlayArrow`, `Menu`, `MenuTrigger`, `MenuItem`, `MenuSection`, `Header`, `Separator`, `Keyboard`.
- Wrappers: `Popover` (props `PopoverProps`, offset default 2), `MenuTrigger` (re-export), `Menu<T>`, `MenuItem` (+ `shortcut?: string` → `<Keyboard class="ck-kbd">`, `tone?: 'danger'`).
- Classes: `ck-popover` (`background: var(--surface-raised); border: 1px solid var(--accent-line); border-radius: var(--r-sm); box-shadow: 0 0 16px color-mix(in srgb, var(--accent) 12%, transparent), var(--shadow-md); max-height: min(360px, var(--visual-viewport-height)); overflow:auto; z-index: var(--z-popover)`; `[data-entering]` fade 80ms), `ck-menu` (padding `--sp-1`, outline none, `min-width: max(160px, var(--trigger-width))`), `ck-menu__item` (same metrics as listbox item; `[data-focused]` → `--accent-bg` + inset cyan bar; `.ck-menu__item--danger { color: var(--danger-fg) }`), `ck-menu__shortcut` (margin-left auto).
- Keyboard: RAC (Enter/Space/↓ opens, ↑↓, Enter activates, Esc closes, typeahead).
- Usage in v1: optional (no screen requires a Menu); build it for completeness.

### B.11 Tooltip — `Tooltip.tsx`, `Tooltip.css`
- RAC: `TooltipTrigger`, `Tooltip`, `OverlayArrow`.
- ```ts
  export interface TooltipProps { content: React.ReactNode; children: React.ReactElement /* focusable RAC trigger */; placement?: 'top'|'bottom'|'left'|'right' /* 'top' */; delay?: number /* 500 */; isDisabled?: boolean }
  ```
- DOM: `<div class="ck-tooltip" data-placement>` `<OverlayArrow class="ck-tooltip__arrow"><svg 8x8/></OverlayArrow>` content.
- CSS: `.ck-tooltip { z-index: var(--z-tooltip); max-width: 260px; padding: var(--sp-1) var(--sp-3); font-size: var(--fs-xs); color: var(--fg); background: var(--cyber-void-800); border: 1px solid var(--accent-line); border-radius: var(--r-sm); box-shadow: var(--shadow-md) }`; arrow `fill: var(--cyber-void-800); stroke: var(--accent-line)`, rotated per `[data-placement]`; entering fade.
- Behavior: shows on hover after the delay and instantly on keyboard focus; Esc hides. Never the only label for an icon button: icon buttons also have `aria-label`.

### B.12 Disclosure — `Disclosure.tsx`, `Disclosure.css`
- RAC: `Disclosure`, `DisclosurePanel`, `Heading`, `Button`.
- ```ts
  export interface DisclosureProps extends AriaDisclosureProps { title: React.ReactNode; meta?: React.ReactNode; headingLevel?: 2|3|4 /* 3 */; triggerTestId?: string;
    children: React.ReactNode | ((rp: { isExpanded: boolean }) => React.ReactNode) } // render-prop form lets heavy children (Monaco) mount only when expanded
  ```
  The wrapper passes the render-prop through: `<Disclosure>{({ isExpanded }) => <>…<DisclosurePanel>{typeof children === 'function' ? children({ isExpanded }) : children}</DisclosurePanel></>}</Disclosure>`.
- DOM: `<div class="ck-disclosure" data-expanded?>` `<h3 class="ck-disclosure__heading"><button slot="trigger" class="ck-disclosure__trigger"><span class="ck-disclosure__chevron" aria-hidden>▸</span>{title}<span class="ck-disclosure__meta">{meta}</span></button></h3>` `<div class="ck-disclosure__panel">`.
- CSS: trigger = full-width ghost row (`height: var(--control-h-sm); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); gap: var(--sp-2)`), `[data-hovered]` → `color: var(--accent-text)`; chevron `color: var(--accent); transition: transform var(--dur)`; `.ck-disclosure[data-expanded] .ck-disclosure__chevron { transform: rotate(90deg) }`; meta `text-transform:none; letter-spacing:0; font-family: var(--font-mono)`; panel `padding-top: var(--sp-2)`.
- Keyboard: Enter/Space toggles.

### B.13 Checkbox / Switch — `Checkbox.tsx`, `Checkbox.css`
- RAC: `Checkbox`, `Switch`. Props: `CheckboxProps`/`SwitchProps` passthrough; children = label.
- DOM: `<label class="ck-checkbox"><span class="ck-checkbox__box" aria-hidden>(✓ svg)</span>{label}</label>`; `<label class="ck-switch"><span class="ck-switch__track"><span class="ck-switch__thumb"/></span>{label}</label>`.
- CSS: box 13px, `border: 1px solid var(--border-strong); border-radius: 0`; `[data-selected] .ck-checkbox__box { background: var(--accent); border-color: var(--accent); color: var(--accent-on); box-shadow: var(--glow-sm) }`; `[data-indeterminate]` dash; `[data-focus-visible] .ck-checkbox__box` ring. Switch track 26×14 (`border: 1px solid var(--border-strong)`), thumb 10px `--fg-muted`; selected track border/thumb `--accent` + glow, thumb translateX(12px).
- Usage in v1: optional; build it for completeness.

### B.14 Breadcrumbs — `Breadcrumbs.tsx`, `Breadcrumbs.css`
- RAC: `Breadcrumbs`, `Breadcrumb`, `Link`.
- `export interface BreadcrumbsProps { items: { label: string; href?: string; mono?: boolean }[] }`. The last item is the current one (`Link` without href; RAC sets `data-current`).
- Classes: `ck-breadcrumbs` (`display:flex; flex-wrap:wrap; gap: var(--sp-2); font-size: var(--fs-xs); color: var(--fg-subtle)`), `ck-breadcrumbs__item` (+ `::after { content: "/"; margin-left: var(--sp-2); color: var(--border-strong) }` except last), `ck-breadcrumbs__link` (`color: var(--fg-muted)`; `[data-current]`/`[aria-current="page"]` → `color: var(--fg)`; `.ck-breadcrumbs__link--mono` → Hack).
- Astro twin `src/components/Breadcrumbs.astro`: `<nav aria-label="Breadcrumb"><ol class="ck-breadcrumbs"><li class="ck-breadcrumbs__item"><a class="ck-breadcrumbs__link" href>` … last `<span class="ck-breadcrumbs__link" aria-current="page">`.

### B.15 Toolbar — `Toolbar.tsx`, `Toolbar.css`
- RAC: `Toolbar`. Props passthrough; `aria-label` required.
- `.ck-toolbar { display:flex; align-items:center; gap: var(--sp-1) }` `.ck-toolbar[data-orientation="vertical"] { flex-direction: column }`.
- Keyboard: ←→ between controls, Tab leaves.

### B.16 Badge (plain span) — `Badge.tsx`, `Badge.css`
- ```ts
  export interface BadgeProps { children: React.ReactNode; tone?: 'neutral'|'info'|'success'|'warn'|'danger'|'muted' /* 'neutral' */; dataset?: DatasetId; stateGroup?: StateGroup; mono?: boolean; title?: string; className?: string }
  export function DatasetBadge({ dataset }: { dataset: DatasetId }): Badge with data-ds, text = dataset id, mono
  export function StateBadge({ dataset, state }: { dataset: DatasetId; state: string }): Badge with data-state-group, text = registry label
  ```
- DOM: `<span class="ck-badge [ck-badge--ds|ck-badge--state|ck-badge--<tone>] [ck-badge--mono]" data-ds? data-state-group? data-state?>` (+ `.ck-badge__dot` for ds/state).
- Astro twins: `DatasetBadge.astro`, `StateBadge.astro`, `StaleBadge.astro`, `OkfStatusBadge.astro` produce identical markup.
- Not cybercore's `cyber-badge`, whose sizes come from fluid `--space-*` and are too big for dense rows.
- CSS:
```css
@layer cx-kit {
  .ck-badge {
    display: inline-flex; align-items: center; gap: var(--sp-1);
    height: 16px; padding: 0 var(--sp-2);
    font-size: var(--fs-xs); font-weight: var(--fw-semibold); line-height: 1; white-space: nowrap;
    text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--fg-muted); background: var(--bg-muted);
    border: var(--border-w) solid transparent; border-radius: var(--r-sm);
    vertical-align: middle;
  }
  .ck-badge--mono { font-family: var(--font-mono); font-weight: var(--fw-normal); text-transform: none; letter-spacing: 0; }
  .ck-badge--ds {
    color: var(--ds-fg); background: var(--ds-bg); border-color: var(--ds-line);
    border-left: 2px solid var(--ds-c);
    font-family: var(--font-mono); font-weight: var(--fw-normal); text-transform: none; letter-spacing: 0;
  }
  .ck-badge--state { color: var(--st-fg); background: var(--st-bg); border-color: var(--st-border); border-radius: var(--r-pill); padding: 0 var(--sp-3) 0 var(--sp-2); }
  .ck-badge__dot { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .ck-badge--ds .ck-badge__dot { display: none; }    /* the left bar carries the color */
  /* state shape cue (not color-only): neutral=hollow ring, active=half + glow, done=filled, closed=dash */
  .ck-badge--state[data-state-group="neutral"] .ck-badge__dot { border: 1.5px solid currentColor; }
  .ck-badge--state[data-state-group="active"] .ck-badge__dot { border: 1.5px solid currentColor; background: linear-gradient(90deg, currentColor 50%, transparent 50%); box-shadow: 0 0 4px currentColor; }
  .ck-badge--state[data-state-group="done"] .ck-badge__dot { background: currentColor; }
  .ck-badge--state[data-state-group="closed"] .ck-badge__dot { height: 2px; border-radius: 1px; background: currentColor; }
  .ck-badge--state[data-state-group="closed"] { text-decoration: line-through; text-decoration-color: color-mix(in srgb, currentColor 50%, transparent); }
  .ck-badge--info { color: var(--info-fg); background: var(--info-bg); border-color: var(--accent-line); }
  .ck-badge--success { color: var(--success-fg); background: var(--success-bg); }
  .ck-badge--warn { color: var(--warn-fg); background: var(--warn-bg); border-color: color-mix(in srgb, var(--warn-fg) 40%, transparent); }
  .ck-badge--danger { color: var(--danger-fg); background: var(--danger-bg); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }
  .ck-badge--muted { color: var(--fg-subtle); background: transparent; border-color: var(--border); }
  .ck-badge--tag { font-family: var(--font-mono); font-weight: var(--fw-normal); text-transform: none; letter-spacing: 0; color: var(--fg-muted); background: transparent; border-color: var(--border); }
  .ck-badge--tag::before { content: "#"; color: var(--fg-subtle); }
}
```
- Fixed badge meanings: dataset → `--ds`; state → `--state`; stale → `--warn` text "stale" (title `stale since YYYY-MM-DD`); OKF status `draft` → `--muted` "draft", `deprecated` → `--danger` "deprecated", `stable`/absent → no badge; missing link → `--danger` "missing"; tag → `--tag`; reference type → `--muted --mono` (`local-repo` …); YAML invalid → `--danger` "invalid".

### B.17 Kbd — `Kbd.tsx`, `Kbd.css`
- RAC: `Keyboard` (renders `<kbd>`). `export function Kbd({ children }: { children: React.ReactNode })`.
- Twin: `<kbd class="ck-kbd">`.
- CSS: `.ck-kbd { display:inline-flex; align-items:center; justify-content:center; min-width: 16px; height: 16px; padding: 0 var(--sp-1); font-family: var(--font-mono); font-size: 10px; color: var(--fg-muted); background: var(--cyber-void-700); border: 1px solid var(--border); border-bottom-color: var(--border-strong); border-radius: var(--r-sm) }`.

### B.18 Link — `Link.tsx` (text link)
- RAC `Link`; class `ck-link` (`color: var(--accent-text)`; `[data-hovered]` underline + `text-shadow: 0 0 6px color-mix(in srgb, var(--accent) 50%, transparent)`; `[data-focus-visible]` ring). `external?: boolean` → `target="_blank" rel="noreferrer"` + trailing `↗` (aria-hidden) + sr-only "(opens in new tab)".

### B.19 Spinner — part of `Button.css`; `export function Spinner({ label }: { label?: string })` → `<span class="ck-spinner" role="status" aria-label={label ?? 'Loading'}>` (`color: var(--accent)` when standalone).

### B.20 EmptyState — `EmptyState.tsx`, class `ck-empty` (`padding: var(--sp-6) var(--sp-4); text-align:center; color: var(--fg-subtle); font-size: var(--fs-sm); display:flex; flex-direction:column; align-items:center; gap: var(--sp-3)`; title `.ck-empty__title` uses the `.cx-label` style). Props `{ title: string; children?: ReactNode; action?: ReactNode }`. Astro twin `EmptyState.astro`.

### B.21 `src/ui/kit/index.ts` (exact export list)
```ts
export { cx } from './utils.ts';
export { Button, ButtonLink, Spinner, type ButtonProps, type ButtonLinkProps, type ButtonVariant, type ButtonSize } from './Button.tsx';
export { Chip, ChipGroup, type ChipProps, type ChipGroupProps } from './Chip.tsx';
export { TextField, SearchField, TextAreaField, type TextFieldProps, type SearchFieldProps, type TextAreaFieldProps } from './Field.tsx';
export { Select, type SelectProps } from './Select.tsx';
export { ListBox, ListBoxItem, ListBoxSection, type ListBoxItemProps } from './ListBox.tsx';
export { GridList, GridListItem } from './GridList.tsx';
export { Tabs, TabList, Tab, TabPanel } from './Tabs.tsx';
export { TagGroup, Tag, type TagGroupProps } from './TagGroup.tsx';
export { Modal, Dialog, ConfirmDialog, DialogTrigger, type ModalProps, type DialogProps, type ConfirmDialogProps } from './Dialog.tsx';
export { Popover, Menu, MenuTrigger, MenuItem, MenuSection } from './Menu.tsx';
export { Tooltip, type TooltipProps } from './Tooltip.tsx';
export { Disclosure, type DisclosureProps } from './Disclosure.tsx';
export { Checkbox, Switch } from './Checkbox.tsx';
export { Breadcrumbs, type BreadcrumbsProps } from './Breadcrumbs.tsx';
export { Toolbar } from './Toolbar.tsx';
export { Badge, DatasetBadge, StateBadge, type BadgeProps } from './Badge.tsx';
export { Kbd } from './Kbd.tsx';
export { Link } from './Link.tsx';
export { EmptyState } from './EmptyState.tsx';
export { CodeEditor, type CodeEditorProps, type CodeEditorApi, type CodeMarker, type CodeLanguage } from './CodeEditor.tsx';
// monaco-theme.ts and monaco-setup.ts are internal to the kit (imported only by CodeEditor.tsx)
```
(Import extension style must match tsconfig `allowImportingTsExtensions`. If the project settles on extensionless imports for src/, drop `.ts(x)`.)
`kit.css` import order: Button, Chip, Field, Select, ListBox, GridList, Tabs, TagGroup, Dialog, Popover, Menu, Tooltip, Disclosure, Checkbox, Breadcrumbs, Toolbar, Badge, Kbd, Link, EmptyState, CodeEditor.
`CodeEditor` is a heavy module (Monaco). Only the Forge island imports it, and it must not be re-exported into
anything the SearchWidget imports. The search island imports kit components by file (`../kit/Button.tsx`, …), not
via `index.ts`, so Monaco never ends up in the search bundle. Alternatively `CodeEditor` can be loaded via
`React.lazy(() => import('../kit/CodeEditor.tsx'))` inside the Forge.

### B.22 CodeEditor (Monaco) — `CodeEditor.tsx`, `CodeEditor.css`, `monaco-setup.ts`, `monaco-theme.ts`
- Wraps `Editor` from `@monaco-editor/react` 4.7 (`monaco-editor` 0.57). **Used for every markdown/JSON/YAML input**
  (amendment 11). Plain single-line fields stay `TextField`.
- Loading: `monaco-setup.ts` runs once on import. It calls `loader.config({ monaco })` with the local
  `import * as monaco from 'monaco-editor'` and sets `self.MonacoEnvironment.getWorker` with Vite `?worker` imports
  (no CDN). **The exact snippet is owned by PLAN.md** (planner verifies it in a `client:only` island). It also calls
  `monaco.editor.defineTheme('ctxman-cyber', CTXMAN_CYBER_THEME)` (§B.23), once per page.
- Props:
  ```ts
  export type CodeLanguage = 'markdown' | 'json' | 'yaml';
  export interface CodeMarker { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number; message: string; severity: 'error' | 'warning' }
  export interface CodeEditorApi { focus(): void; revealPosition(line: number, column: number): void }
  export interface CodeEditorProps {
    value: string;
    onChange?: (value: string) => void;           // receives `value ?? ''` from Monaco's onChange
    language: CodeLanguage;
    height?: { mode: 'auto'; minLines?: number /* 8 */; maxLines?: number /* 20 */ }   // default
           | { mode: 'fill' }                                                          // flex child, fills parent
           | { mode: 'fixed'; px: number };
    readOnly?: boolean;
    ariaLabel: string;                            // → Monaco option ariaLabel (on its textarea)
    testId: string;                               // → data-testid on .ck-code root
    compact?: boolean;                            // notes style: no line numbers/folding/gutter
    placeholder?: string;                         // → Monaco option placeholder (0.57 supports it)
    markers?: readonly CodeMarker[];              // applied with monaco.editor.setModelMarkers(model, 'ctxman', …)
    onSave?: () => void;                          // Cmd/Ctrl+S inside the editor
    onReady?: (api: CodeEditorApi) => void;
    describedBy?: string;                         // id of external help/issue text → aria-describedby on root
  }
  ```
- DOM:
  ```
  <div class="ck-code ck-code--{language} [ck-code--compact] [ck-code--readonly]" data-testid={testId} data-language={language}
       style="height: {px}px (fixed/auto)" aria-describedby={describedBy} onKeyDown={stopEscape}>
    <Editor height="100%" width="100%" language={language} theme="ctxman-cyber" value={value}
            path={`inmemory://ctxman/${testId}-${useId()}.${ext}`}  // unique model per instance; ext: md|json|yaml
            onChange={(v) => onChange?.(v ?? '')} options={…} onMount={handleMount}
            loading={<div class="ck-code__loading">Loading editor…</div>} />
  </div>
  ```
- Options (base, all modes): `fontFamily: 'Hack, monospace'`, `fontLigatures: false`, `fontSize: 12`, `lineHeight: 18`,
  `minimap: { enabled: false }`, `scrollBeyondLastLine: false`, `automaticLayout: true`, `fixedOverflowWidgets: true`
  (suggest/hover widgets escape the pane's `overflow:auto`), `renderLineHighlight: 'line'`, `overviewRulerLanes: 0`,
  `hideCursorInOverviewRuler: true`, `stickyScroll: { enabled: false }`, `tabSize: 2`, `insertSpaces: true`,
  `quickSuggestions: false`, `wordBasedSuggestions: 'off'`, `autoClosingBrackets: 'never'`,
  `autoClosingQuotes: 'never'`, `unicodeHighlight: { ambiguousCharacters: false }`, `padding: { top: 4, bottom: 4 }`,
  `scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, alwaysConsumeMouseWheel: false }`,
  `accessibilitySupport: 'auto'`, `ariaLabel`, `placeholder`, `readOnly`,
  `wordWrap: language === 'markdown' ? 'on' : 'off'`.
  `compact: true` adds `lineNumbers: 'off'`, `glyphMargin: false`, `folding: false`, `lineDecorationsWidth: 6`,
  `lineNumbersMinChars: 0`, `renderLineHighlight: 'none'`, `tabFocusMode: true` (Tab leaves the editor; notes rarely
  need indentation). Non-compact (YAML) keeps `lineNumbers: 'on'`, `folding: true` and Tab inserting spaces.
  Monaco's built-in toggle (Ctrl+M, or Ctrl+Shift+M on macOS) switches Tab-trapping. The YAML help text says so.
- `handleMount(editor, monaco)` (Monaco callback, not render. Side effects are allowed here):
  1. `editor.addAction({ id: 'ctxman.save', label: 'Save', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => onSaveRef.current?.() })`.
     Use `addAction`, not `addCommand`: in Monaco, `addCommand` keybindings are registered globally, so with several
     editors on the page the last instance wins. `addAction` is per instance. Monaco consumes the key, so the page's
     window-level Cmd/Ctrl+S handler (§H.2) also ignores `e.defaultPrevented` events. `save()` is a no-op while
     already saving.
  2. auto height: `editor.onDidContentSizeChange(({ contentHeight }) => { root.style.height = clamp(contentHeight, minLines*18+8, maxLines*18+8) + 'px'; })` (`automaticLayout` relayouts).
     The initial height is `minLines*18+8`, set in the root `style`. Fixed mode uses `px`; fill mode uses CSS (`flex:1; min-height:0`).
  3. `onReady?.({ focus: () => editor.focus(), revealPosition: (l, c) => { editor.revealPositionInCenter({ lineNumber: l, column: c }); editor.setPosition({ lineNumber: l, column: c }); editor.focus(); } })`.
  4. Latest-callback refs (`onSaveRef`, …) are updated in a `useEffect` without deps (refs are written in effects,
     never during render: React compiler `refs` rule).
- Markers: `useEffect(() => { if (model) monaco.editor.setModelMarkers(model, 'ctxman', markers.map(toMonaco)) }, [markers])`.
  This effect syncs an external system and never sets state.
- **Esc**: `stopEscape = (e) => { if (e.key === 'Escape') e.stopPropagation(); }` on the root. Monaco still handles Esc
  (closing suggest/find widgets, clearing multi-cursor), but Esc never reaches an enclosing RAC Dialog/Modal or the
  search widget. To leave an editor inside a dialog, use Tab (compact) or Ctrl/Shift+M then Tab.
- Global shortcuts ignore events from inside `.monaco-editor` except Cmd/Ctrl+S handled by the action:
  Cmd/Ctrl+K (Monaco chords), `/`.
- CSS:
```css
@layer cx-kit {
  .ck-code {
    position: relative; min-height: 0; width: 100%;
    background: var(--cyber-void-700);
    border: var(--border-w) solid var(--border); border-radius: var(--r-sm);
    overflow: hidden;
    transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
  }
  .ck-code:hover { border-color: var(--border-strong); }
  .ck-code:focus-within { border-color: var(--accent); box-shadow: var(--glow-sm); }
  .ck-code[data-invalid] { border-color: var(--danger); box-shadow: inset 0 0 6px color-mix(in srgb, var(--danger) 30%, transparent); }
  .ck-code--fill { flex: 1; }
  .ck-code__loading { display: grid; place-items: center; height: 100%; min-height: 60px; font-size: var(--fs-xs); color: var(--fg-subtle); font-family: var(--font-mono); }
  .ck-code--readonly { border-style: dashed; }
}
```
  `CodeEditor` sets `data-invalid` on the root when `markers` contains an error, and adds `ck-code--fill` in fill mode.

### B.23 Monaco theme `ctxman-cyber` — `src/ui/kit/monaco-theme.ts`
Monaco needs literal hex colors (it can't read CSS variables). The colors come from `src/lib/cyber-palette.ts`
(pure constants mirroring cybercore 0.3.0 plus our `--cx-neon-*`). A vitest unit test parses
`node_modules/cybercore-css/dist/cybercore.css` and asserts the cybercore entries are equal, so an upgrade can't
silently drift.
```ts
// src/lib/cyber-palette.ts
export const CYBER = {
  cyan300: '#87eaf2', cyan400: '#54d1db', cyan500: '#00f0ff', cyan600: '#00c4cc', cyan700: '#0097a7', cyan900: '#005d6a',
  magenta500: '#ff2a6d', magenta700: '#b31248', yellow500: '#fcee0a', yellow700: '#aca406',
  green400: '#43ff83', green500: '#05ffa1', green700: '#03a969', green900: '#015331',
  void100: '#2a2d3a', void200: '#1f2230', void300: '#181a25', void400: '#12141d', void500: '#0d0e14', void700: '#07080c', void800: '#040508',
  chrome100: '#f0f1f5', chrome200: '#d1d4de', chrome300: '#b2b7c7', chrome400: '#939ab0', chrome500: '#747d99', chrome600: '#5c647a',
  // ours (A.1)
  orange: '#ff8a3d', blueText: '#7db1ff', violet: '#b26bff', violetText: '#c493ff', lime: '#b8ff3d', pink: '#ff6ad5', magentaText: '#ff6b96',
} as const;
```
```ts
// src/ui/kit/monaco-theme.ts
import type { editor } from 'monaco-editor';
import { CYBER as C } from '../../lib/cyber-palette.ts';
const h = (hex: string) => hex.slice(1);           // Monaco rules want 'rrggbb' without '#'
export const CTXMAN_CYBER_THEME: editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: h(C.chrome100), background: h(C.void700) },
    { token: 'comment', foreground: h(C.chrome400), fontStyle: 'italic' },
    { token: 'keyword', foreground: h(C.magentaText) },
    { token: 'string', foreground: h(C.green500) },
    { token: 'string.escape', foreground: h(C.yellow500) },
    { token: 'string.invalid', foreground: h(C.magenta500), fontStyle: 'underline' },
    { token: 'number', foreground: h(C.yellow500) },
    { token: 'type', foreground: h(C.cyan400) },
    { token: 'tag', foreground: h(C.violetText) },
    { token: 'namespace', foreground: h(C.violetText) },
    { token: 'attribute.name', foreground: h(C.orange) },
    { token: 'attribute.value', foreground: h(C.green500) },
    { token: 'variable', foreground: h(C.orange) },
    { token: 'variable.source', foreground: h(C.chrome200) },
    { token: 'operators', foreground: h(C.chrome300) },
    { token: 'delimiter', foreground: h(C.chrome300) },
    { token: 'meta.separator', foreground: h(C.chrome600) },
    { token: 'emphasis', fontStyle: 'italic' },
    { token: 'strong', fontStyle: 'bold' },
    { token: 'invalid', foreground: h(C.magenta500), fontStyle: 'underline' },
    // markdown (tokenPostfix ".md"): headings + list markers are `keyword.md`; links `string.link.md`; inline code `variable.md`; fences `variable.source.md`; quotes `comment.md`
    { token: 'keyword.md', foreground: h(C.cyan500), fontStyle: 'bold' },
    { token: 'keyword.table.header.md', foreground: h(C.cyan400), fontStyle: 'bold' },
    { token: 'string.link.md', foreground: h(C.blueText), fontStyle: 'underline' },
    { token: 'string.md', foreground: h(C.chrome300) },
    { token: 'variable.md', foreground: h(C.orange) },
    { token: 'comment.md', foreground: h(C.chrome400), fontStyle: 'italic' },
    { token: 'tag.md', foreground: h(C.violetText) },
    // yaml (tokenPostfix ".yaml"): keys are `type.yaml`; true/false/null `keyword.yaml`; anchors/aliases `namespace.yaml`; !!tags `tag.yaml`
    { token: 'type.yaml', foreground: h(C.cyan400) },
    { token: 'keyword.yaml', foreground: h(C.magentaText) },
    { token: 'string.yaml', foreground: h(C.green500) },
    { token: 'number.yaml', foreground: h(C.yellow500) },
    // json (tokens from monaco json tokenization)
    { token: 'string.key.json', foreground: h(C.cyan400) },
    { token: 'string.value.json', foreground: h(C.green500) },
    { token: 'number.json', foreground: h(C.yellow500) },
    { token: 'keyword.json', foreground: h(C.magentaText) },
    { token: 'delimiter.bracket.json', foreground: h(C.chrome300) },
    { token: 'delimiter.array.json', foreground: h(C.chrome300) },
    { token: 'delimiter.colon.json', foreground: h(C.chrome400) },
    { token: 'delimiter.comma.json', foreground: h(C.chrome400) },
    { token: 'comment.line.json', foreground: h(C.chrome400), fontStyle: 'italic' },
    { token: 'comment.block.json', foreground: h(C.chrome400), fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': C.void700,
    'editor.foreground': C.chrome100,
    'editorGutter.background': C.void700,
    'editorLineNumber.foreground': C.chrome600,
    'editorLineNumber.activeForeground': C.cyan500,
    'editorCursor.foreground': C.cyan500,
    'editor.selectionBackground': C.cyan500 + '40',
    'editor.inactiveSelectionBackground': C.cyan500 + '22',
    'editor.selectionHighlightBackground': C.cyan500 + '1a',
    'editor.wordHighlightBackground': C.cyan500 + '14',
    'editor.lineHighlightBackground': C.void300,
    'editor.lineHighlightBorder': '#00000000',
    'editor.findMatchBackground': C.yellow500 + '55',
    'editor.findMatchHighlightBackground': C.yellow500 + '26',
    'editorBracketMatch.background': C.cyan500 + '1a',
    'editorBracketMatch.border': C.cyan500 + '80',
    'editorIndentGuide.background1': C.void200,
    'editorIndentGuide.activeBackground1': C.chrome600,
    'editorWhitespace.foreground': C.void100,
    'editorError.foreground': C.magenta500,
    'editorWarning.foreground': C.yellow500,
    'editorInfo.foreground': C.cyan500,
    'editorLink.activeForeground': C.blueText,
    'editorGhostText.foreground': C.chrome400,
    'editorWidget.background': C.void200,
    'editorWidget.foreground': C.chrome100,
    'editorWidget.border': C.void100,
    'editorSuggestWidget.background': C.void200,
    'editorSuggestWidget.border': C.void100,
    'editorSuggestWidget.foreground': C.chrome100,
    'editorSuggestWidget.selectedBackground': '#0f333d',
    'editorSuggestWidget.highlightForeground': C.cyan500,
    'editorHoverWidget.background': C.void200,
    'editorHoverWidget.border': C.void100,
    'input.background': C.void400,
    'input.foreground': C.chrome100,
    'input.border': C.void100,
    'inputOption.activeBorder': C.cyan500,
    'focusBorder': C.cyan500,
    'scrollbarSlider.background': C.void100 + 'aa',
    'scrollbarSlider.hoverBackground': C.chrome600 + 'aa',
    'scrollbarSlider.activeBackground': C.cyan500 + '66',
    'editorOverviewRuler.border': '#00000000',
    'minimap.background': C.void700,
  },
};
```
Token colors were checked ≥ 4.5:1 on void-700. The lowest are comment (chrome-400, ≈7.0:1) and keyword
(magenta-text, ≈7.4:1).

## C. App shell

### C.1 `src/layouts/Base.astro`
- Props: `{ title: string; fill?: boolean /* full-height app pages: /forge */; active?: DatasetId | 'forge' | 'tools' | 'home' }`.
- Head: `<meta charset>`, viewport, `<meta name="color-scheme" content="dark">`, `<title>{title} · ctxman</title>`,
  inline SVG favicon (data URI: cyan `cx` on void). **No font `<link>`s**: Inter and Hack come from the npm
  `@import`s in global.css (§0.2), and Vite emits the woff2 files.
- Body:
  ```html
  <body class="cx-shell" class:list={{ 'cx-shell--fill': fill }}>
    <a class="cx-skip ck-sr-only" href="#main">Skip to content</a>   <!-- becomes visible on :focus -->
    <Header active={active} />
    <main id="main" class="cx-main" tabindex="-1"><slot /></main>
    <Footer />
    <SearchWidget client:only="react" />
    <script> import '../scripts/shell.ts'; </script>
  </body>
  ```
- `src/scripts/shell.ts` (vanilla, bundled by Astro): (1) replace the text of every `[data-kbd-mod]` with `⌘` on mac
  (same regex as `src/stores/platform.ts`); (2) delegated click on `[data-copy]` → `navigator.clipboard.writeText(el.dataset.copy)`,
  set `el.dataset.copied=""` and swap the label to "Copied" for 1200ms.
- CSS (app.css, `@layer cx-app`): `.cx-skip:focus { position: fixed; top: var(--sp-2); left: var(--sp-2); width:auto; height:auto; clip:auto; padding: var(--sp-2) var(--sp-4); background: var(--surface-raised); border: 1px solid var(--accent); z-index: var(--z-tooltip) }`. `.cx-main { flex: 1; width: 100%; max-width: var(--content-max); margin: 0 auto; padding: var(--sp-4) var(--gutter) var(--sp-6); min-width: 0 }`. `.cx-shell--fill { height: 100dvh; overflow: hidden }` `.cx-shell--fill .cx-main { max-width: none; min-height: 0; display: flex; flex-direction: column; padding: 0 }`.

### C.2 `src/components/Header.astro`
```html
<header class="cx-header" data-testid="app-header">
  <a class="cx-header__brand" href="/" data-testid="nav-home" aria-label="ctxman home">
    <span class="cx-header__logo" aria-hidden="true">cx</span>
    <span class="cx-header__title cyber-glitch cyber-glitch--subtle cyber-text-glow" data-text="ctxman" aria-hidden="true">ctxman</span>
  </a>
  <nav class="cx-nav" aria-label="Primary" data-testid="primary-nav">
    <ul class="cx-nav__list">
      {DATASETS.map(d => <li><a class="cx-nav__link" data-ds={d.id} href={`/${d.id}`} aria-current={active===d.id ? 'page' : undefined} data-testid={`nav-${d.id}`}><span class="cx-nav__dot" aria-hidden/>{d.navLabel}</a></li>)}
      <li class="cx-nav__sep" aria-hidden></li>
      <li><a class="cx-nav__link cx-nav__link--tool" href="/forge" data-testid="nav-forge" aria-current=…>Forge</a></li>
      <li><a class="cx-nav__link cx-nav__link--tool" href="/tools" data-testid="nav-tools" aria-current=…>Tools</a></li>
    </ul>
  </nav>
  <SearchButton />
</header>
```
- The only glitch effect in the app is the brand title. `data-text` must equal the text. The visible text is
  `aria-hidden`, and the link's `aria-label` names it, so screen readers don't read pseudo-element duplicates.
  cybercore disables the glitch animation under `prefers-reduced-motion`.
- `aria-current="page"` on the exact page. On detail/sub-doc pages the dataset link gets `aria-current="true"`
  (section); Base passes `active`.
- `SearchButton.astro`: `<a class="ck-button ck-button--secondary ck-button--sm cx-header__search" href={withParams(Astro.url.pathname + Astro.url.search, { search: '1' })} data-search-trigger data-testid="search-button" aria-keyshortcuts="Meta+K Control+K /"><span class="ck-button__label"><svg search 11px aria-hidden/>Search<kbd class="ck-kbd" data-kbd-mod>Ctrl</kbd><kbd class="ck-kbd">K</kbd></span></a>`. Without the island it degrades to a link that sets `?search=1` (the island opens it on load).
- CSS:
  ```
  .cx-header { position: sticky; top: 0; z-index: var(--z-header); display: grid; grid-template-columns: auto minmax(0,1fr) auto; grid-template-areas: "brand nav search"; align-items: center; gap: var(--sp-5); min-height: var(--header-h); padding: 0 var(--gutter); background: var(--bg-deep); border-bottom: 1px solid var(--accent-line); box-shadow: 0 1px 12px -4px color-mix(in srgb, var(--accent) 35%, transparent) }
  .cx-header__brand { grid-area: brand; display:flex; align-items:center; gap: var(--sp-3); color: var(--accent); text-decoration: none }
  .cx-header__brand:hover { text-decoration: none }
  .cx-header__logo { width:18px; height:18px; display:grid; place-items:center; background: var(--accent); color: var(--accent-on); font: 700 10px/1 var(--font-mono); clip-path: polygon(0 0, 100% 0, 100% 70%, 70% 100%, 0 100%) }
  .cx-header__title { font-size: var(--fs-lg); font-weight: var(--fw-bold); letter-spacing: 0.12em; text-transform: uppercase }
  .cx-nav { grid-area: nav; min-width: 0; overflow-x: auto; scrollbar-width: none }
  .cx-nav__list { display:flex; gap: 0; white-space:nowrap }
  .cx-nav__link { display:inline-flex; align-items:center; gap: var(--sp-2); height: var(--header-h); padding: 0 var(--sp-3); font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle); border-bottom: 2px solid transparent }
  .cx-nav__link:hover { color: var(--fg); text-decoration:none; background: color-mix(in srgb, var(--ds-c, var(--accent)) 6%, transparent) }
  .cx-nav__link[aria-current] { color: var(--ds-fg, var(--accent-text)); border-bottom-color: var(--ds-c, var(--accent)); text-shadow: 0 0 8px color-mix(in srgb, var(--ds-c, var(--accent)) 55%, transparent) }
  .cx-nav__dot { width:6px; height:6px; background: var(--ds-c); box-shadow: 0 0 4px var(--ds-c) }
  .cx-nav__link--tool { color: var(--fg-muted) }
  .cx-nav__sep { width:1px; align-self:stretch; margin: 10px var(--sp-2); background: var(--border) }
  .cx-header__search { grid-area: search }
  @media (max-width: 1279px) { .cx-header { grid-template-columns: auto 1fr; grid-template-areas: "brand search" "nav nav"; row-gap: 0 } .cx-nav__link { height: 30px } .cx-header__search { justify-self: end } }
  ```
  At ≥1280px everything fits on one row. Below that the nav drops to a full-width second row that scrolls
  horizontally; it never wraps or overflows the page. The breakpoint is 1280 rather than 1200 because uppercase
  tracked labels are wider.

### C.3 `src/components/Footer.astro`
- `<footer class="cx-footer" data-testid="app-footer"><span class="cx-label">data</span><code class="cx-mono" data-testid="footer-data-dir">{dataDir}</code><button class="ck-button ck-button--ghost ck-button--sm" data-copy={dataDir} aria-label="Copy data directory path"><span class="ck-button__label">Copy</span></button><span class="cx-footer__spacer"/><span class="cx-mono">ctxman v{pkg.version}</span></footer>`.
- `dataDir` comes from the same resolver the content config uses (`src/lib/data-dir.ts`), as an absolute path. Version from the `package.json` import.
- CSS: `display:flex; align-items:center; gap: var(--sp-3); height: 24px; padding: 0 var(--gutter); font-size: var(--fs-xs); color: var(--fg-subtle); border-top: 1px solid var(--border); background: var(--bg-deep)`; `.cx-footer__spacer { flex:1 }`.

### C.4 Shared Astro components (all in `src/components/`)
| file | output |
|---|---|
| `PageHeader.astro` (props `title`, `eyebrow?` slot, `actions` slot, `meta` slot) | `<header class="cx-pagehead"><div class="cx-pagehead__eyebrow"><slot name="eyebrow"/></div><div class="cx-pagehead__row"><h1 class="cx-pagehead__title">{title}</h1><div class="cx-pagehead__actions"><slot name="actions"/></div></div><div class="cx-pagehead__meta cx-row"><slot name="meta"/></div></header>` |
| `DatasetBadge.astro` / `StateBadge.astro` / `StaleBadge.astro` / `OkfStatusBadge.astro` | §B.16 markup |
| `Freshness.astro` (props `iso`, `prefix?` e.g. "Modified") | `<time class="cx-freshness" datetime={iso} title={formatAbsolute(iso)}>{prefix && prefix + ' '}{formatRelative(iso, Date.now())}</time>` (SSR per request, so relative time is correct at render) |
| `Breadcrumbs.astro` | §B.14 twin |
| `EmptyState.astro` | §B.20 twin |
| `Panel.astro` (props `title`, `count?`, `testid`, `id`; slot `actions`) | `<section class="cx-panel" aria-labelledby={id} data-testid={testid}><h2 class="cx-panel__title" id={id}>{title}{count != null && <span class="cx-panel__count">{count}</span>}<span class="cx-panel__actions"><slot name="actions"/></span></h2><slot/></section>` |
| `FilterForm.astro`, `ChipCheckbox.astro`, `EntryTable.astro` | §E |
| `MetaPanel.astro`, `FileTree.astro`, `BackRefs.astro`, `ContextLinks.astro`, `ReferenceFields.astro`, `SkillMeta.astro` | §F |
| `DatasetTile.astro`, `EntryMiniList.astro` | §D |
- CSS:
  `.cx-pagehead { display:flex; flex-direction:column; gap: var(--sp-1); margin-bottom: var(--sp-4); padding-bottom: var(--sp-3); border-bottom: 1px solid var(--border) }`
  `.cx-pagehead__row { display:flex; align-items:center; gap: var(--sp-4); justify-content: space-between }`
  `.cx-pagehead__title { font-size: var(--fs-2xl); font-weight: var(--fw-semibold); overflow-wrap:anywhere }`
  `.cx-pagehead__actions { display:flex; gap: var(--sp-2); flex:none }`
  `.cx-pagehead__meta { color: var(--fg-muted); font-size: var(--fs-sm); gap: var(--sp-3) }`
  `.cx-freshness { color: var(--fg-muted); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; text-decoration: underline dotted var(--border-strong); text-underline-offset: 3px }`
  `.cx-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm) }`
  `.cx-panel__title { display:flex; align-items:center; gap: var(--sp-2); height: var(--row-h); padding: 0 var(--sp-4); font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-muted); background: var(--bg-deep); border-bottom: 1px solid var(--border); box-shadow: inset 2px 0 0 var(--accent) }`
  `.cx-panel__count { font-family: var(--font-mono); color: var(--accent-text); letter-spacing: 0 }`
  `.cx-panel__actions { margin-left: auto; display:flex; gap: var(--sp-1); text-transform:none; letter-spacing:0 }`.
  Panels use no scanlines: text sits directly on them, and scanlines lower contrast.

---

## D. Dashboard `/` (`src/pages/index.astro`)

Data (server): all `EntrySummary` for every dataset (lib), plus contexts with `linkCount`. Dense layout: a single
row-strip of compact stat tiles, then lists rendered as rows in panels. No cards for lists.

```html
<Base title="Dashboard" active="home">
  <PageHeader title="Dashboard"><span slot="meta">{totalEntries} entries · 10 datasets · {staleCount} stale</span></PageHeader>
  <section aria-labelledby="h-datasets" class="cx-dash__section">
    <h2 id="h-datasets" class="ck-sr-only">Datasets</h2>
    <ul class="cx-dash__tiles" data-testid="dashboard-cards">
      <li><DatasetTile …/></li> ×10
    </ul>
  </section>
  <div class="cx-dash__grid">
    <Panel title="Recently modified" id="h-recent" testid="dashboard-recent"><EntryMiniList entries={top 20 okf entries by lastModified desc}/></Panel>
    <div class="cx-dash__side">
      <Panel title="Stale" count={n} id="h-stale" testid="dashboard-stale"><EntryMiniList entries={stale, oldest staleAfter first} showStaleAfter/> | EmptyState "Nothing stale."</Panel>
      <Panel title="Contexts" count={n} id="h-contexts" testid="dashboard-contexts">
        <a slot="actions" class="ck-button ck-button--ghost ck-button--sm" href="/forge?context=new"><span class="ck-button__label">New</span></a>
        rows: <li class="cx-minilist__row"><a class="cx-minilist__title" href="/context/x">x</a><span class="cx-subtle cx-truncate">{description}</span><span class="cx-mono cx-subtle">{linkCount} links</span><a class="ck-button ck-button--ghost ck-button--sm" href="/forge?context=x"><span class="ck-button__label">Forge</span></a></li>
        empty → EmptyState "No contexts yet." + <a class="ck-button ck-button--primary ck-button--sm" href="/forge?context=new">New context</a>
      </Panel>
    </div>
  </div>
</Base>
```
- `DatasetTile.astro` (the only `cyber-card` use):
  ```html
  <a class="cx-tile" data-ds={id} href={`/${id}`} data-testid={`dataset-card-${id}`}>
    <div class="cyber-card cyber-card--interactive cx-tile__card">
      <span class="cx-tile__label">{navLabel}</span>
      <span class="cx-tile__count">{count}</span>
      <span class="cx-tile__sub">3 pending · 2 active</span>  <!-- lifecycle: neutral+active counts; others: "upd 2d ago"; context: "N links" -->
    </div>
  </a>
  ```
  `cyber-card` draws two corner brackets in `--card-accent` and a cut-corner clip-path. Our `cx-app` rule sets
  `--card-accent: var(--ds-c)`, which beats cybercore's `components` layer, and replaces its fluid padding.
- `EntryMiniList.astro`: `<ul class="cx-minilist">` rows `<li class="cx-minilist__row" data-testid="minilist-row">` = DatasetBadge · `<a class="cx-minilist__title cx-truncate" href={url}>{title ?? name}</a>` · StateBadge? · StaleBadge? (+ `stale_after` mono when `showStaleAfter`) · Freshness (right-aligned).
- CSS:
  ```
  .cx-dash__tiles { display:grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: var(--sp-2); margin-bottom: var(--sp-4) }
  @media (max-width: 1279px) { .cx-dash__tiles { grid-template-columns: repeat(5, minmax(0, 1fr)) } }
  .cx-tile { display:block; color: var(--fg); text-decoration:none; outline:none }
  .cx-tile:hover { text-decoration:none }
  .cx-tile__card { --card-accent: var(--ds-c); display:flex; flex-direction:column; gap: 0; padding: var(--sp-2) var(--sp-4); background: var(--surface); }
  .cx-tile__card.cyber-card::before, .cx-tile__card.cyber-card::after { width: 10px; height: 10px; border-width: 1px; }   /* shrink brackets for density */
  .cx-tile:focus-visible { filter: drop-shadow(0 0 2px var(--ds-c)) drop-shadow(0 0 6px var(--ds-c)) }  /* neon border on focus that follows the clip-path (outline/box-shadow would be clipped) */
  .cx-tile__label { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--ds-fg) }
  .cx-tile__count { font-family: var(--font-mono); font-size: var(--fs-3xl); line-height: 1.15; font-variant-numeric: tabular-nums; color: var(--fg) }
  .cx-tile__sub { font-size: var(--fs-xs); color: var(--fg-subtle); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
  .cx-dash__grid { display:grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--sp-4); align-items: start }
  .cx-dash__side { display:flex; flex-direction:column; gap: var(--sp-4) }
  @media (max-width: 1099px) { .cx-dash__grid { grid-template-columns: minmax(0,1fr) } }
  .cx-minilist__row { display:grid; grid-template-columns: auto minmax(0,1fr) auto auto; gap: var(--sp-3); align-items:center; min-height: var(--row-h); padding: var(--sp-1) var(--sp-4); border-bottom: 1px solid var(--border); font-size: var(--fs-md) }
  .cx-minilist__row:last-child { border-bottom: 0 }
  .cx-minilist__row:hover { background: color-mix(in srgb, var(--accent) 5%, transparent) }
  .cx-minilist__title { color: var(--fg); font-weight: var(--fw-medium) }
  .cx-minilist__title:hover { color: var(--accent-text) }
  ```
- Reduced motion: `cyber-card--interactive` hover lifts by 2px; cybercore disables that transition under
  reduced motion.

## E. Dataset list page `/[dataset]` (`src/pages/[dataset]/index.astro`)

**Results = dense `<table>`**: aligned columns make state/date/tags scannable across many rows; cards waste vertical space.

### E.1 URL params (exact)
| param | values | repeatable | datasets | default |
|---|---|---|---|---|
| `q` | free text | no | all | `''` |
| `state` | registry state ids | yes | lifecycle (idea task bug feature project) | none = all |
| `tag` | tag strings | yes | all | none |
| `sort` | `name` \| `modified` \| `state` | no | `state` only on lifecycle datasets | `modified` |
| `type` | `local-repo` \| `remote-repo` \| `remote-skill` | no | reference only | none = all |
Unknown values are ignored (not errors). Unknown dataset → 404. Server: `filterEntries(all, params)`.

### E.2 Page structure
```html
<Base title={def.label} active={def.id}>
  <PageHeader title={def.label}>
    <DatasetBadge slot="eyebrow" dataset={def.id}/>
    <a slot="actions" class="ck-button ck-button--secondary ck-button--sm" href={def.id==='context' ? '/forge?context=new' : `/tools?add=${def.id}#add-entry`} data-testid="list-new-entry">New {def.singular}</a>
  </PageHeader>
  <FilterForm … />
  <EntryTable … /> | <EmptyState title={total ? 'No entries match these filters.' : `No ${def.plural} yet.`}><a href={`/${def.id}`}>Clear filters</a></EmptyState>
</Base>
```

### E.3 `FilterForm.astro`
```html
<form class="cx-filters" method="get" action={`/${ds}`} role="search" aria-label={`Filter ${def.plural}`} data-testid="list-filter-form" data-filter-form>
  <div class="cx-filters__row">
    <label class="ck-sr-only" for="f-q">Filter text</label>
    <input id="f-q" class="ck-input cx-filters__q" type="search" name="q" value={q} placeholder="Filter by name, title, description, tag…" data-testid="list-filter-q" autocomplete="off" />
    <label class="cx-filters__sort"><span class="ck-field__label">Sort</span>
      <select id="f-sort" class="ck-native-select" name="sort" data-testid="list-sort">
        <option value="modified">Last modified</option><option value="name">Name</option>{lifecycle && <option value="state">State</option>}
      </select></label>
    <button class="ck-button ck-button--primary ck-button--sm cx-filters__submit" type="submit" data-testid="list-filter-apply">Apply</button>
    {anyActive && <a class="ck-button ck-button--ghost ck-button--sm" href={`/${ds}`} data-testid="list-filter-clear">Clear</a>}
    <output class="cx-filters__count" data-testid="list-result-count" aria-live="polite">{shown} of {total}</output>
  </div>
  {lifecycle && <fieldset class="cx-filters__facet"><legend class="cx-filters__legend">State</legend>
     <div class="ck-chip-group">{states.map(s => <ChipCheckbox name="state" value={s.id} label={s.label} count={stateCounts[s.id]} checked id={`f-state-${s.id}`} testid={`list-chip-state-${s.id}`} />)}</div></fieldset>}
  {ds==='reference' && <fieldset class="cx-filters__facet"><legend>Type</legend><div class="ck-chip-group">
     <ChipCheckbox type="radio" name="type" value="" label="All" checked={!type} id="f-type-all" testid="list-chip-type-all"/> + one per type (testid list-chip-type-<type>)</div></fieldset>}
  {tags.length>0 && <fieldset class="cx-filters__facet"><legend>Tags</legend><div class="ck-chip-group">
     first 20 tags of tagCounts + any selected tags beyond (testid list-chip-tag-<tag>, id f-tag-<slugified tag>)
     {rest.length>0 && <details class="cx-filters__more"><summary class="ck-button ck-button--ghost ck-button--sm">+{rest.length} more</summary><div class="ck-chip-group">…rest…</div></details>}
  </div></fieldset>}
</form>
```
- `ChipCheckbox.astro` = §B.2 twin; the radio "All" with `value=""` is dropped by the enhancement and treated as absent by the server.
- Counts on chips are over the whole dataset (not the filtered set) — stable while toggling.
- CSS: `.cx-filters { display:flex; flex-direction:column; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3); background: var(--bg-subtle); border: 1px solid var(--border); border-left: 2px solid var(--accent-line) }` `.cx-filters__row { display:flex; align-items:flex-end; gap: var(--sp-2); flex-wrap: wrap }` `.cx-filters__q { flex: 1 1 320px; max-width: 520px }` `.cx-filters__sort { display:flex; flex-direction:column; gap: var(--sp-1) }` `.cx-filters__count { margin-left:auto; font-size: var(--fs-sm); color: var(--fg-muted); font-variant-numeric: tabular-nums }` `.cx-filters__facet { border:0; padding:0; margin:0; display:grid; grid-template-columns: 56px minmax(0,1fr); gap: var(--sp-2); align-items: start }` `.cx-filters__legend { float:left; padding-top: 3px }` (uses the `.cx-label` style) `.cx-filters[data-enhanced] .cx-filters__submit { display:none }` `.cx-filters__more > summary { list-style:none }`.

### E.4 Progressive enhancement (`<script>` inside FilterForm.astro, vanilla TS)
1. On load: `form.dataset.enhanced = ''`. Restore focus: `try { const id = sessionStorage.getItem('cx-filter-focus'); if (id) { sessionStorage.removeItem('cx-filter-focus'); document.getElementById(id)?.focus() } } catch {}`.
2. `change` on any checkbox/radio/select → `submitClean(form, target.id)`. Text `q` does **not** auto-submit (a full reload while typing loses caret); it submits on Enter (native).
3. `submit` → `preventDefault(); submitClean(form, document.activeElement?.id)`.
4. `submitClean`: build `URLSearchParams` from `FormData`, drop empty values and `sort=modified`, store focus id in sessionStorage (try/catch), `location.assign(action + (qs ? '?' + qs : ''))`. Each change is a real navigation → back/forward works natively.

### E.5 `EntryTable.astro`
```html
<table class="cx-table" data-testid="list-results">
  <thead><tr>{columns.map(c => <th scope="col" class={`cx-table__th cx-table__th--${c}`}>{label}</th>)}</tr></thead>
  <tbody>{entries.map(e => <tr class="cx-table__row" data-testid="list-row" data-slug={e.slug}>…cells…</tr>)}</tbody>
</table>
```
Columns per dataset kind:
| dataset | columns |
|---|---|
| kb, rca | Entry · Description · Tags · Modified |
| idea task bug feature project | Entry · Description · State · Tags · Modified |
| skill | Entry · Description · Tags · Modified |
| reference | Entry · Description · Type · Owner · Modified |
| context | Entry · Description · Links · Tags · Modified |
- Entry cell: `<a class="cx-table__title" href={e.url}>{e.title ?? e.name}</a>` then `<code class="cx-table__slug">{e.slug}</code>` (only when title differs from name) + StaleBadge + OkfStatusBadge inline.
- Description: `<td class="cx-table__desc"><span class="cx-truncate" title={description}>`. Tags: up to 4 `ck-badge--tag` + `+N` muted. Modified: `<Freshness>`, `white-space:nowrap`.
- Column header for the active sort gets `aria-sort` (`descending` for modified, `ascending` otherwise). Headers are not clickable (sort via the select).
- Not cybercore's `cyber-table`: its fluid paddings are too roomy. Same look in our CSS.
- CSS: `.cx-table { width:100%; font-size: var(--fs-md); background: var(--surface); border: 1px solid var(--border) }` `.cx-table th { position: sticky; top: var(--header-h); z-index: 1; height: 24px; text-align:left; font-size: var(--fs-xs); font-weight: var(--fw-semibold); color: var(--fg-subtle); text-transform: uppercase; letter-spacing: var(--tracking-label); padding: 0 var(--sp-4); background: var(--bg-deep); border-bottom: 1px solid var(--accent-line) }` `.cx-table th[aria-sort] { color: var(--accent-text) }` `.cx-table td { height: var(--row-h); padding: var(--sp-1) var(--sp-4); vertical-align: middle; border-bottom: 1px solid var(--border); line-height: var(--lh-tight) }` `.cx-table__row:hover td { background: color-mix(in srgb, var(--accent) 5%, transparent) }` `.cx-table__row:hover td:first-child { box-shadow: inset 2px 0 0 var(--accent) }` `.cx-table__title { font-weight: var(--fw-medium); color: var(--fg) }` `.cx-table__title:hover { color: var(--accent-text) }` `.cx-table__slug { display:block; font-size: var(--fs-xs); color: var(--fg-subtle) }` `.cx-table__desc { font-size: var(--fs-sm); color: var(--fg-muted); max-width: 0 }` (with `cx-truncate` inside). Descriptions clamp to 1 line (full text in `title`) to keep rows ~28px; the entry cell stacks title + slug (~36px row) only when the slug differs from the title. column widths: entry `min-width: 220px; width: 26%`, description auto, state 120px, tags 180px, modified 120px. Wrap the table in `<div class="cx-table-wrap" style="overflow-x:auto">` at < 1000px (drop the sticky header in that case: `.cx-table-wrap .cx-table th { position: static }`).

---

## F. Detail page `/[dataset]/[slug]` and sub-doc page

### F.1 Layout (both pages)
```html
<Base title={title} active={ds}>
  <Breadcrumbs items={[{label:'ctxman',href:'/'},{label:def.label,href:`/${ds}`},{label:slug, href: subdoc? entryUrl : undefined}, subdoc && {label: path}]} />
  <PageHeader title={title}>
    <Fragment slot="meta">
      <code class="cx-detail__slug" data-testid="detail-slug">{slug}</code>
      <button class="ck-button ck-button--ghost ck-button--sm" data-copy={slug} aria-label="Copy slug">Copy</button>
      <DatasetBadge dataset={ds}/> {state && <StateBadge/>} <OkfStatusBadge/> {stale && <StaleBadge/>}
      <Freshness iso={lastModified} prefix="Modified"/>
    </Fragment>
    <Fragment slot="actions">{ds==='context' && <a class="ck-button ck-button--primary ck-button--sm" href={`/forge?context=${slug}`} data-testid="detail-open-forge">Open in Forge</a>}</Fragment>
  </PageHeader>
  <div class="cx-detail">
    <article class="cx-detail__main cx-prose" data-testid="detail-content"> rendered markdown </article>
    <aside class="cx-detail__aside" aria-label="Entry details" data-testid="detail-aside">
      <MetaPanel/> <FileTree/> <BackRefs/>
    </aside>
  </div>
</Base>
```
- Title = `title ?? name` (sub-doc: frontmatter `title` ?? first `#` heading ?? filename).
- CSS: `.cx-detail { display:grid; grid-template-columns: minmax(0,1fr) var(--sidebar-w); gap: var(--sp-5); align-items:start }` `.cx-detail__aside { position: sticky; top: calc(var(--header-h) + var(--sp-3)); display:flex; flex-direction:column; gap: var(--sp-3); max-height: calc(100dvh - var(--header-h) - var(--sp-6)); overflow:auto }` `@media (max-width: 1099px) { .cx-detail { grid-template-columns: minmax(0,1fr) } .cx-detail__aside { position: static; max-height:none; order: -1 } }`. `.cx-detail__main { max-width: var(--prose-max); min-width:0 }`. Breadcrumbs `margin-bottom: var(--sp-3)`.

### F.2 `MetaPanel.astro` (`<section class="cx-panel cx-meta" aria-labelledby="h-meta" data-testid="detail-meta">`)
`<h2 class="cx-panel__title" id="h-meta">Details</h2>` then `<dl class="cx-meta__list">` rows `<div class="cx-meta__row"><dt>…</dt><dd>…</dd></div>`; rows omitted when value absent:
| dt | dd | datasets |
|---|---|---|
| Description | text | all |
| Tags | `ck-badge--tag` list; each links to `/${ds}?tag=<t>` | all |
| State | StateBadge | lifecycle |
| Modified | Freshness + absolute in `<span class="cx-subtle">` | all |
| Status | OKF `status` (badge or "stable") | okf |
| Stale after | `YYYY-MM-DD` + StaleBadge if passed | okf |
| Generated | `by` (mono) · Freshness(at) | okf |
| Verified | each event: `by` (mono) · date; trust line: "unverified" / "machine-confirmed" / "human-reviewed" (any `human:` by) as `ck-badge--muted/--info/--success` | okf |
| Sources | `<ul>` each: id (mono) + title/link if present; unknown shapes → `<pre class="cx-meta__yaml">` YAML dump | okf |
| Type | `ck-badge--muted --mono` | okf (frontmatter `type`), reference (`type`) |
| Path / URI | mono, `overflow-wrap:anywhere`, Copy button; `http(s)` URI → external link | reference |
| Subpath | mono or "repo root" | reference |
| Owner | "me" / "not me" | reference |
| License / Compatibility | text | skill |
| Allowed tools | `ck-badge--tag` list (mono) | skill |
| Metadata | `<dl>` of key/values | skill |
| File | `data/<ds>/<slug>/main.md` (mono, Copy) | all (yaml path for data datasets) |
CSS (dense two-column key/value grid): `.cx-meta__list { padding: var(--sp-2) var(--sp-4); display:grid; grid-template-columns: 84px minmax(0,1fr); column-gap: var(--sp-3); row-gap: var(--sp-2) }` `.cx-meta__row { display: contents }` `.cx-meta__row dt { padding-top: 2px }` (`.cx-label` style) `.cx-meta__row dd { margin:0; font-size: var(--fs-sm); overflow-wrap:anywhere }` `.cx-meta__yaml { font-size: var(--fs-xs); background: var(--code-bg-block); padding: var(--sp-2); max-height: 160px; overflow:auto }`.

### F.3 Main content per dataset
- okf datasets: rendered `main.md` (`render(entry)` → `<Content/>`) inside `.cx-prose`.
- skill: rendered `SKILL.md` body.
- reference: no markdown; main shows `<p class="cx-detail__lede">{description}</p>` and `ReferenceFields.astro` (same rows as the reference part of MetaPanel, larger: `.cx-fields` 2-col `dl`, `grid-template-columns: 140px 1fr`). MetaPanel then omits the reference rows.
- context: `ContextLinks.astro` in main:
  ```html
  <p class="cx-detail__lede">{description}</p>
  <section aria-labelledby="h-links"><h2 id="h-links">Links <span class="cx-subtle">({n})</span></h2>
    {groups (registry order, only non-empty).map(g => <section class="cx-ctxgroup" data-ds={g.ds} data-testid={`context-group-${g.ds}`}>
      <h3 class="cx-ctxgroup__title"><DatasetBadge dataset={g.ds}/> {label} <span class="cx-subtle">{g.links.length}</span></h3>
      <ol class="cx-ctxgroup__list">{g.links.map(l => <li class="cx-ctxlink" data-testid="context-link">
        <div class="cx-row"><a href={l.url}>{l.title ?? l.slug}</a> <code class="cx-subtle">{l.slug}</code> {l.state && <StateBadge/>} {l.missing && <span class="ck-badge ck-badge--danger">missing</span>}</div>
        {l.notesHtml && <div class="cx-prose cx-prose--compact cx-ctxlink__notes" set:html={l.notesHtml}/>}
      </li>)}</ol></section>)}
  </section>
  ```
  Links keep their stored order within each group; group order = registry order. Notes markdown rendered server-side by the project's markdown helper (`src/lib/markdown.ts`, e.g. `createMarkdownProcessor` from `@astrojs/markdown-remark`), output wrapped as above. `missing` = link target not found (dangling; not fatal). Empty context → EmptyState "No links yet." + "Open in Forge".
  CSS: `.cx-ctxgroup { border-left: 2px solid var(--ds-c); padding-left: var(--sp-4); margin-top: var(--sp-5) }` `.cx-ctxlink { padding: var(--sp-2) 0; border-bottom: 1px solid var(--border) }` `.cx-ctxlink__notes { margin-top: var(--sp-2); padding: var(--sp-2) var(--sp-3); background: var(--bg-subtle); border-radius: var(--r-sm) }`.

### F.4 `FileTree.astro` (okf + skill only)
```html
<nav class="cx-panel cx-files" aria-labelledby="h-files" data-testid="detail-files">
  <h2 class="cx-panel__title" id="h-files">Files</h2>
  <ul class="cx-files__list" role="list">
    <li><a class="cx-files__item" href="/kb/x/doc/index" aria-current?>index.md</a> <span class="cx-files__hint">bundle index</span></li>
    <li><a class="cx-files__item" href="/kb/x" aria-current?>main.md</a> <span class="cx-files__hint">entry</span></li>
    <li><a … href="/kb/x/doc/log">log.md</a> <span class="cx-files__hint">log</span></li>   (only if present)
    other concepts sorted by path; nested dirs shown as path prefix: <span class="cx-files__dir">concepts/</span>search.md
  </ul>
</nav>
```
- Order: index.md, main.md, log.md, then others by path. Current file `aria-current="page"` (on sub-doc pages the current doc; on detail page main.md).
- skill: lists every file in the skill dir (mono, not links — no route), dirs first; `SKILL.md` marked current.
- CSS: `.cx-files__list { list-style:none; padding: var(--sp-2) var(--sp-2) }` `.cx-files__item { display:flex; height: 22px; align-items:center; padding: 0 var(--sp-2); font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--fg) }` `:hover { background: var(--bg-muted); text-decoration:none }` `[aria-current] { background: var(--accent-bg); color: var(--accent-text); box-shadow: inset 2px 0 0 var(--accent) }` `.cx-files__dir { color: var(--fg-subtle) }` `.cx-files__hint { font-size: var(--fs-xs); color: var(--fg-subtle); margin-left: auto }` (make `li` flex).

### F.5 `BackRefs.astro` (all datasets except context)
`<section class="cx-panel" aria-labelledby="h-backrefs" data-testid="detail-backrefs"><h2 class="cx-panel__title" id="h-backrefs">Linked from contexts <span class="cx-subtle">({n})</span></h2>` → `<ul class="cx-minilist">` rows: `<a href="/context/<c>">{c.name}</a>` + first 120 chars of the link's notes as plain text (`cx-subtle cx-clamp-2`) + `<a class="ck-button ck-button--ghost ck-button--sm" href="/forge?context=<c>">Forge</a>`. Empty: `<p class="cx-subtle" style="padding: var(--sp-3) var(--sp-4)">Not linked from any context.</p>` + `<a href="/forge?dataset=<ds>&q=<slug>">Find in Forge</a>` (only for linkable datasets).

### F.6 Sub-doc page `/[dataset]/[slug]/doc/[...path]`
Same layout; PageHeader meta shows `<code>{path}.md</code>`, frontmatter `type` badge, OkfStatusBadge/StaleBadge from that doc's frontmatter, and Freshness of that file's mtime. MetaPanel shows the doc's own frontmatter rows (type, status, stale_after, generated, verified, sources) plus "Bundle: <a href=entryUrl>{entry title}</a>". FileTree and BackRefs are the bundle's. `log.md`: rendered as prose (its `## YYYY-MM-DD` headings already give structure).

---

## G. Global search widget (`src/ui/search/`)

Files: `SearchWidget.tsx` (island root), `SearchResults.tsx`, `Highlight.tsx`, `search.css`; store `src/stores/search.ts`; pure `src/lib/search-config.ts` (Fuse options), `src/lib/search-highlight.ts` (segments/snippets).

### G.1 Fuse config (`src/lib/search-config.ts`)
```ts
import type { IFuseOptions } from 'fuse.js';
export const FUSE_OPTIONS: IFuseOptions<SearchDoc> = {
  keys: [
    { name: 'title', weight: 0.4 }, { name: 'name', weight: 0.3 }, { name: 'tags', weight: 0.2 },
    { name: 'description', weight: 0.2 }, { name: 'headings', weight: 0.15 }, { name: 'body', weight: 0.1 },
  ],
  threshold: 0.35, ignoreLocation: true, includeMatches: true, includeScore: true, minMatchCharLength: 2,
};
export const MIN_QUERY = 2;      // below this: no search, show hint
export const MAX_RESULTS = 60;   // after dataset filtering
```

### G.2 Store (`src/stores/search.ts`)
```ts
export const $searchOpen = atom<boolean>(false);
export const $searchQuery = atom<string>('');
export const $searchDatasets = atom<readonly DatasetId[]>([]);          // [] = All
export const $searchIndex = atom<{ status: 'idle'|'loading'|'ready'|'error'; docs: SearchDoc[]; error?: string }>({ status: 'idle', docs: [] });
export const $fuse = computed($searchIndex, (s) => (s.status === 'ready' ? new Fuse(s.docs, FUSE_OPTIONS) : null));
export const $searchHits = computed([$fuse, $searchQuery], (fuse, q) => fuse && q.trim().length >= MIN_QUERY ? fuse.search(q.trim()) : []);
export const $searchView = computed([$searchHits, $searchDatasets], (hits, ds) => ({
  countsByDataset: Record<DatasetId, number>,  // over ALL hits (chip counts)
  total: number,                                // hits after dataset filter
  groups: { dataset: DatasetId; hits: FuseResult<SearchDoc>[] }[], // after filter, capped at MAX_RESULTS overall,
}));                                            // groups ordered by best (lowest) score in group, ties → registry order; hits within group by score
export function openSearch(): void; export function closeSearch(): void;
export function setSearchQuery(q: string): void; export function setSearchDatasets(ds: readonly DatasetId[]): void;
export function loadSearchIndex(force?: boolean): void; export function flushSearchUrl(): void;
```
- `loadSearchIndex()`: if status `idle` or `error` (or `force`): set `loading`, `fetch('/api/search-index.json')` → `ready` with `docs` | `error` with message. Called by `openSearch()` and by `applyUrl()` when opening. Fetched once per page load; `force` from the "Reload index" button.
- `onMount($searchOpen, …)` registers (and cleans up):
  1. `applyUrl()` — `search=1` → set query from `sq`, datasets from `in` (valid ids only), `$searchOpen.set(true)`, `loadSearchIndex()`; otherwise `$searchOpen.set(false)`.
  2. `popstate` → `applyUrl()` (no history writes).
  3. `keydown` (window, capture=false): `(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.altKey && !e.shiftKey` → `preventDefault(); $searchOpen.get() ? focusAndSelectInput() : openSearch()`. **Ignored** when `e.defaultPrevented` or when `e.target.closest('.monaco-editor')` (Cmd/Ctrl+K starts Monaco chords). `/` with no modifiers when `e.target` is not `input, textarea, select, [contenteditable]` (Monaco's input is a textarea) and not inside an open dialog → `preventDefault(); openSearch()`.
  4. `click` (document, delegated) on `[data-search-trigger]` with `e.button === 0` and no modifier keys → `preventDefault(); openSearch()`.
- `focusAndSelectInput()` finds `[data-testid="search-input"]` and calls `.focus(); .select()` (event-handler side effect, allowed).

### G.3 History rules (exact)
| event | stores | history |
|---|---|---|
| `openSearch()` while URL lacks `search=1` | open=true; query/datasets keep last values | `history.pushState({ ...history.state, ctxmanSearch: true }, '', withParams(location.href, { search: '1', sq: q, in: ds }))` |
| `openSearch()` while URL already has `search=1` | open=true | none |
| `setSearchQuery` / `setSearchDatasets` while open | set immediately | debounced 150ms `history.replaceState(history.state, '', withParams(location.href, { search:'1', sq, in }))` |
| `closeSearch()` (Esc, close button, overlay click) | cancel pending debounce; open=false | if `history.state?.ctxmanSearch === true` → `history.back()`; else `history.replaceState(history.state, '', withParams(location.href, { search: null, sq: null, in: null }))` |
| `popstate` | `applyUrl()` | none |
| result navigation (Enter / click) | — | `flushSearchUrl()` first (so Back restores the exact query), then normal `<a>` navigation (new entry). Back returns to the page with the widget open and the query intact. |
- Using the `history.state` marker (not a module variable) keeps behavior correct after reloads: reloading a pushed entry and then closing goes back to the identical page without params.
- `flushSearchUrl()` runs the pending replaceState immediately; called from `onClickCapture` and `onKeyDownCapture` (key Enter) on the results container.

### G.4 Component tree (`SearchWidget.tsx`)
```tsx
const open = useStore($searchOpen); const query = useStore($searchQuery); const datasets = useStore($searchDatasets);
const index = useStore($searchIndex); const view = useStore($searchView);
<Modal variant="fullscreen" isOpen={open} onOpenChange={(o) => { if (!o) closeSearch(); }} isDismissable testId="search-modal">
  <div className="cx-search__fx cyber-scanlines cyber-scanlines--fine" aria-hidden="true" />   {/* decorative CRT layer BEHIND content (§G.7) */}
  <Dialog aria-label="Search ctxman" className="ck-dialog cx-search">
    <Autocomplete inputValue={query} onInputChange={setSearchQuery} disableAutoFocusFirst={false}>   {/* no `filter`: results pre-filtered by Fuse */}
      <header className="cx-search__bar">
        <SearchField aria-label="Search all datasets" autoFocus size="lg" inputTestId="search-input" placeholder="Search titles, tags, headings, content…" />
        <Button variant="ghost" size="sm" onPress={closeSearch} aria-label="Close search" data-testid="search-close"><Kbd>Esc</Kbd></Button>
      </header>
      <div className="cx-search__filters">
        <ChipGroup label="Filter by dataset" selectionMode="multiple" selectedKeys={datasets.length ? datasets : ['all']} onSelectionChange={onChips} data-testid="search-dataset-chips">
          <Chip id="all" data-testid="search-chip-all">All</Chip>
          {DATASETS.map(d => <Chip key={d.id} id={d.id} dataset={d.id} count={view.countsByDataset[d.id]} data-testid={`search-chip-${d.id}`}>{d.id}</Chip>)}
        </ChipGroup>
        <span className="cx-search__count" role="status" data-testid="search-count">{countText}</span>
      </div>
      <div className="cx-search__results" onClickCapture={flushSearchUrl} onKeyDownCapture={(e) => { if (e.key === 'Enter') flushSearchUrl(); }}>
        <ListBox aria-label="Search results" className="ck-listbox cx-search__listbox" selectionMode="none" data-testid="search-results"
                 items={view.groups} renderEmptyState={() => <SearchEmpty …/>}>
          {(g) => <ListBoxSection id={g.dataset} data-ds={g.dataset} title={<><DatasetBadge dataset={g.dataset}/> {label} <span className="cx-subtle">{g.hits.length}</span></>} items={g.hits}>
            {(h) => <ListBoxItem id={h.item.id} href={h.item.url} textValue={h.item.title} className="cx-search__item" data-testid="search-result">
              <ResultBody hit={h}/>
            </ListBoxItem>}
          </ListBoxSection>}
        </ListBox>
      </div>
      <footer className="cx-search__footer">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span><span><Kbd>↵</Kbd> open</span><span><Kbd>Tab</Kbd> filters</span><span><Kbd>Esc</Kbd> clear / close</span>
        <span className="cx-search__spacer"/>
        <span className="cx-subtle">{index.docs.length} docs indexed</span>
        <Button variant="ghost" size="sm" onPress={() => loadSearchIndex(true)} data-testid="search-reload">Reload index</Button>
      </footer>
    </Autocomplete>
  </Dialog>
</Modal>
```
- Chip logic `onChips(keys)`: `const next = [...keys]; if (next.includes('all') && datasets.length) → setSearchDatasets([]); else setSearchDatasets(next.filter(k => k !== 'all'))` (empty → All). Order of stored ids = registry order.
- `countText`: idle/short query → `""`; loading → "Loading index…"; ready → `"{total} results"` (+ ` · showing first 60` when capped); error → "".
- `SearchEmpty`: loading → `<Spinner/> Loading search index…`; error → "Couldn't load the search index." + `Button` "Retry" (`loadSearchIndex(true)`, testid `search-retry`); query < 2 chars → hint "Type at least 2 characters. Use the chips (Tab) to limit datasets."; no hits → `No results for "<q>"` (+ "in <datasets>" when filtered, with Button "Search all datasets" → `setSearchDatasets([])`).
- Every dataset chip always visible; chips with count 0 are not disabled (user may pre-select before typing).

### G.5 Result body + highlighting (`Highlight.tsx`, `src/lib/search-highlight.ts`)
```
<div class="cx-search__row">
  <span class="cx-search__title"><Highlight text={title} ranges={matches.title}/></span>
  {state && <StateBadge/>}
  {path && <code class="cx-search__path">{dataset}/{slug}/{path}</code>}
  {!path && <code class="cx-search__path">{dataset}/{slug}</code>}
</div>
<div class="cx-search__snippet"><Highlight text={snippet.text} ranges={snippet.ranges}/></div>
{tags matched && <div class="cx-search__tags">matching tags as ck-badge--tag with <mark></div>}
```
- Pure helpers:
  - `segments(text, ranges: [number, number][]) → { text: string; hit: boolean }[]` — merges overlapping ranges, drops ranges shorter than 2 chars (`end - start + 1 < 2`).
  - `pickSnippet(hit, radius = 60) → { text, ranges }` — priority: `description` match → first `headings` match (prefix "§ ") → `body` match (window of ±radius chars around the first range, trimmed to word boundaries, `…` added at cut ends, ranges re-based and clipped to the window). No match in those keys → `description` (first 160 chars), no ranges.
- `Highlight` renders segments: hits as `<mark class="cx-search__mark">`. No `dangerouslySetInnerHTML`.
- The section header shows the dataset; rows carry no DatasetBadge (it would repeat).

### G.6 Keyboard
- In the input: ↑/↓ move virtual focus through results (Autocomplete; first result auto-focused after each query change), Enter opens the focused result (it is an `<a>`; ⌘/Ctrl+Enter or modifier-click follows browser link rules), Home/End stay in the text input.
- Esc: clears the query if non-empty (RAC SearchField), otherwise closes (RAC Modal). Tests must press Esc twice when the input has text.
- Tab: input → close button → chips (arrows within chips, Space toggles) → results list (direct focus) → footer buttons; focus is trapped in the dialog. Shift+Tab reverses.
- On close focus returns to the element that opened it (RAC), or `<main>` if opened by URL.

### G.7 CSS (`search.css`, representative)
- Scanlines: cybercore's `.cyber-scanlines::after` is an `inset:0; z-index:10` overlay. On top of text it would
  darken every other 1px row and reduce contrast. So it goes on a dedicated decorative sibling **behind** the
  content. `.cx-search__fx` creates its own stacking context (`z-index: 0`), so its `::after` can't rise above
  `.cx-search` (`z-index: 1`).
```
.cx-search__fx { position:absolute; inset:0; z-index:0; pointer-events:none;
  background: radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 60%); }
.cx-search { position:relative; z-index:1; height: 100dvh; display:flex; flex-direction:column; }
.cx-search__bar, .cx-search__filters, .cx-search__results > *, .cx-search__footer { width: min(1000px, 100% - 2 * var(--gutter)); margin-inline: auto; }
.cx-search__bar { display:flex; align-items:center; gap: var(--sp-3); padding: var(--sp-6) 0 var(--sp-3); }
.cx-search__bar .ck-searchfield { flex:1; }
.cx-search__bar .ck-input { background: var(--cyber-void-800); border-color: var(--accent-line); }
.cx-search__filters { display:flex; align-items:center; gap: var(--sp-3); padding-bottom: var(--sp-2); border-bottom: 1px solid var(--accent-line); }
.cx-search__count { margin-left:auto; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--accent-text); white-space: nowrap; }
.cx-search__results { flex:1; min-height:0; overflow:auto; padding: var(--sp-2) 0; }
.cx-search__item { display:flex; flex-direction:column; align-items:stretch; gap: 0; min-height: var(--row-h); padding: var(--sp-1) var(--sp-4); color: var(--fg); text-decoration:none; border-left: 2px solid transparent; }
.cx-search__item[data-focused] { background: var(--accent-bg); border-left-color: var(--accent); box-shadow: inset 0 0 12px color-mix(in srgb, var(--accent) 10%, transparent); }
.cx-search__row { display:flex; align-items:center; gap: var(--sp-3); min-width:0; }
.cx-search__title { font-weight: var(--fw-medium); font-size: var(--fs-lg); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cx-search__item[data-focused] .cx-search__title { color: var(--accent-text); }
.cx-search__path { margin-left:auto; font-size: var(--fs-xs); color: var(--fg-subtle); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: 45%; }
.cx-search__snippet { font-size: var(--fs-sm); color: var(--fg-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }   /* 1 line: dense */
.cx-search__mark { background: var(--mark-bg); color: var(--mark-fg); padding: 0 1px; box-shadow: 0 1px 0 var(--cyber-yellow-500); }
.cx-search__footer { display:flex; align-items:center; gap: var(--sp-5); height: 28px; border-top: 1px solid var(--border); font-size: var(--fs-xs); color: var(--fg-subtle); }
.cx-search__footer .ck-kbd + .ck-kbd { margin-left: var(--sp-1); }
.cx-search__spacer { flex:1; }
.cx-search .ck-listbox__header { background: var(--bg-deep); padding-top: var(--sp-3); color: var(--ds-fg, var(--fg-subtle)); }
```
- The result section header carries `data-ds={dataset}`, so its label takes the dataset color.

---

## H. Context Forge `/forge` (`src/ui/forge/`)

Page `src/pages/forge.astro`: `<Base title="Context Forge" active="forge" fill><Forge client:only="react"><div slot="fallback" class="cx-island-fallback">Loading Forge…</div></Forge></Base>`.
Files: `Forge.tsx`, `DiscoverPane.tsx`, `ContextPane.tsx`, `LinkRow.tsx`, `NewContextDialog.tsx`, `forge.css`; store `src/stores/forge.ts` (+ `entries.ts`, `now.ts`).

**Discovery data source: `GET /api/entries?dataset=<id>` (unfiltered), cached per dataset in `$entries`, filtered client-side with the shared `filterEntries`.** Why: one row per *entry* with state/tags/lastModified/title (the search index is one doc per *file* and lacks lifecycle fidelity), identical filter semantics to `/[dataset]` pages, instant feedback without a request per keystroke. The same cache resolves titles/states for the links list and the context Select (dataset `context`).

### H.1 URL params
| param | values | default | write mode |
|---|---|---|---|
| `context` | context slug \| `new` | none (no context selected) | pushState |
| `dataset` | linkable dataset id | `kb` | pushState (also clears `state` + `tag`) |
| `q` | text | `''` | replaceState, debounced 150ms |
| `state` | repeatable state ids (only meaningful for lifecycle datasets) | none | replaceState, immediate |
| `tag` | repeatable | none | replaceState, immediate |
| `view` | `form` \| `yaml` | `form` | replaceState (§H.7) |
Invalid `dataset` → `kb`; invalid states/tags are kept in URL but match nothing (tags) / are ignored (states not in registry).

### H.2 Store (`src/stores/forge.ts`)
```ts
export interface ForgeUrl { context: string | null; dataset: LinkableDatasetId; q: string; states: string[]; tags: string[] }
export const $forgeUrl = map<ForgeUrl>({ context: null, dataset: 'kb', q: '', states: [], tags: [] });
export const $baseline = atom<ContextDoc | null>(null);      // last loaded/saved server copy
export const $working = atom<ContextDoc | null>(null);       // editable copy (immutable updates only)
export const $contextLoad = atom<{ status: 'none'|'loading'|'ready'|'not-found'|'error'; message?: string }>({ status: 'none' });
export const $saveStatus = atom<{ kind: 'idle'|'saving'|'saved'|'error'|'deleted'; at?: number; message?: string; issues?: { path: string; message: string }[] }>({ kind: 'idle' });
export const $dirty = computed([$working, $baseline], (w, b) => w !== null && b !== null && JSON.stringify(w) !== JSON.stringify(b));
export const $linkedKeys = computed($working, (w) => new Set((w?.links ?? []).map((l) => `${l.dataset}:${l.slug}`)));
export const $discover = computed([$entries, $forgeUrl], …) // → { status, items: EntrySummary[] (cap 200), total, shownOf, stateCounts, tagCounts }
export const $newContextPrefill = atom<string>('');
// actions
selectContext(slug: string | 'new' | null): void   // dirty guard (see H.6); pushState; loadContext
setDataset(ds): void; setQuery(q): void; setStates(ids): void; setTags(tags): void;
addLink(ds, slug): void; removeLink(key): void; moveLink(key, dir: -1 | 1): void; setLinkNotes(key, notes): void;
setDescription(text): void; addTag(tag): void; removeTag(tag): void;
save(): Promise<void>; revert(): void; deleteContext(): Promise<void>;
createContext(input: { name: string; description: string }): Promise<{ ok: true } | { ok: false; field?: 'name'; message: string }>;
```
- `onMount($forgeUrl)`: `applyUrl()` (incl. `view`); `ensureEntries(dataset)`; `ensureEntries('context')`; if `context` is a slug → `loadContext(slug)`; listeners: `popstate` (H.6), `beforeunload` (`if ($dirty.get() || $yamlInvalid.get()) { e.preventDefault(); e.returnValue = ''; }`), `keydown` Cmd/Ctrl+S (`if (e.defaultPrevented) return; e.preventDefault(); if ($dirty.get() && !$yamlInvalid.get()) save()`). The `defaultPrevented` check skips keys a Monaco editor action already handled. `save()` returns early while `$saveStatus.kind === 'saving'`.
- YAML-view store additions (`$view`, `$yamlDraft`, `$yamlCheck`, `$yamlInvalid`, `setView`, `setYamlDraft`) are specified in §H.7.
- `loadContext(slug)`: no-op if `$baseline.get()?.name === slug`; else `$contextLoad=loading` → `GET /api/context/<slug>` → 200: baseline = working = context (deep-copied), `ready`, then `ensureEntries` for every distinct link dataset; 404 → `not-found`; else `error`.
- Link key = `${dataset}:${slug}`. `addLink` appends `{ dataset, slug }` (no `notes` key) if not present. Notes `''` → delete the `notes` key (so revert-equality and YAML stay clean). `moveLink` swaps with neighbor.
- `save()`: `saving` → `PUT /api/context/<name>` body `$working` → 200: baseline = working = response context, `{kind:'saved', at: Date.now()}`, `invalidateEntries('context')`; 400 → `{kind:'error', message, issues}`; network/other → `{kind:'error', message}`.
- `revert()`: working = structuredClone(baseline); status idle.
- `deleteContext()`: `DELETE` → 204: baseline = working = null, `invalidateEntries('context')`, `history.replaceState` with `context: null`, `$forgeUrl.setKey('context', null)`, status `{kind:'deleted', message: 'Deleted <name>'}`.
- `createContext()`: `POST /api/context` `{ name, description, tags: [], links: [] }` → 201: baseline = working = context, `invalidateEntries('context')`, `history.replaceState(…context=<name>)`, `$forgeUrl.setKey('context', name)`; 409 → `{ ok:false, field:'name', message:'A context with this name already exists.' }`.

### H.3 Layout
```html
<div class="cx-forge" data-testid="forge">
  <section class="cx-forge__pane cx-forge__pane--discover" aria-labelledby="forge-discover-h" data-testid="forge-discover">…H.4…</section>
  <section class="cx-forge__pane cx-forge__pane--context" aria-labelledby="forge-context-h" data-testid="forge-context">…H.5 / H.7…</section>
</div>
```
CSS (dense, full-height, panes scroll independently):
```
.cx-forge { flex:1; min-height:0; display:grid; grid-template-columns: minmax(380px, 1fr) minmax(460px, 1.2fr); }
.cx-forge__pane { display:flex; flex-direction:column; min-height:0; min-width:0; }
.cx-forge__pane--discover { border-right: 1px solid var(--accent-line); background: var(--bg-subtle); }
.cx-forge__pane-header { display:flex; align-items:center; gap: var(--sp-3); height: 36px; padding: 0 var(--sp-4); border-bottom: 1px solid var(--border); background: var(--bg-deep); }
.cx-forge__pane-title { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--accent-text); }
.cx-forge__pane-body { flex:1; min-height:0; overflow:auto; }
.cx-forge__pane-body[data-view="yaml"] { display:flex; flex-direction:column; overflow:hidden; }
.cx-forge__toolbar { display:flex; flex-direction:column; gap: var(--sp-2); padding: var(--sp-2) var(--sp-4); border-bottom: 1px solid var(--border); }
.cx-forge__count { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--fg-subtle); }
.cx-forge__footer { display:flex; align-items:center; gap: var(--sp-2); height: 40px; padding: 0 var(--sp-4); border-top: 1px solid var(--accent-line); background: var(--bg-deep); }
.cx-forge__status { font-size: var(--fs-sm); color: var(--fg-muted); margin-left: var(--sp-2); }
.cx-forge__status[data-kind="dirty"] { color: var(--warn-fg); }
.cx-forge__status[data-kind="error"] { color: var(--danger-fg); }
.cx-forge__status[data-kind="saved"] { color: var(--success-fg); }
@media (max-width: 899px) { .cx-forge { grid-template-columns: minmax(0,1fr); grid-template-rows: minmax(260px, 45%) minmax(0, 1fr); } .cx-forge__pane--discover { border-right:0; border-bottom: 1px solid var(--accent-line); } }
```

### H.4 Discover pane
```tsx
<header className="cx-forge__pane-header"><h2 id="forge-discover-h" className="cx-forge__pane-title">Discover</h2></header>
<Tabs selectedKey={url.dataset} onSelectionChange={(k) => setDataset(k as LinkableDatasetId)} className="ck-tabs cx-forge__tabs">
  <TabList aria-label="Datasets" className="ck-tabs__list cx-forge__tablist">
    {LINKABLE_DATASETS.map(id => <Tab key={id} id={id} dataset={id} count={entries[id]?.entries.length} data-testid={`forge-tab-${id}`}>{getDataset(id).navLabel}</Tab>)}
  </TabList>
  {LINKABLE_DATASETS.map(id => <TabPanel key={id} id={id} className="ck-tabs__panel">   {/* RAC mounts only the selected panel */}
    <div className="cx-forge__toolbar">
      <SearchField aria-label={`Filter ${def.plural}`} value={url.q} onChange={setQuery} size="sm" inputTestId="forge-filter-q" placeholder="Filter…" />
      {def.states && <ChipGroup label="State" selectedKeys={url.states} onSelectionChange={(k) => setStates([...k] as string[])} data-testid="forge-state-chips">{def.states.map(s => <Chip id={s.id} count={view.stateCounts[s.id]} data-testid={`forge-chip-state-${s.id}`}>{s.label}</Chip>)}</ChipGroup>}
      {view.tagCounts.length > 0 && <ChipGroup label="Tags" selectedKeys={url.tags} onSelectionChange={(k) => setTags([...k] as string[])} data-testid="forge-tag-chips">{top 16 + selected beyond 16 … data-testid={`forge-chip-tag-${tag}`}</ChipGroup>}
      {more tags && <Disclosure title={`More tags (${n})`}>second ChipGroup bound to the same selection</Disclosure>}
      <div className="cx-forge__count" role="status" data-testid="forge-result-count">{view.shown} of {view.total}</div>
    </div>
    <GridList aria-label={`${def.label} results`} items={view.items} onAction={(key) => onAdd(key)} emptyText={emptyText} data-testid="forge-results" className="ck-gridlist cx-discover">
      {(e) => <DiscoverRow entry={e} added={linked.has(key(e))} canAdd={working !== null} />}
    </GridList>
  </TabPanel>)}
</Tabs>
```
- `DiscoverRow` = `<GridListItem id={`${e.dataset}:${e.slug}`} textValue={e.title ?? e.name} className="ck-gridlist__item cx-discover__item" data-testid="forge-result" data-added={added || undefined}>`:
  ```
  <div class="cx-discover__main">
    <div class="cx-row cx-discover__line"><span class="cx-discover__title cx-truncate">{title}</span><code class="cx-discover__slug">{slug}</code>{state && <StateBadge/>}{e.stale && <Badge tone="warn">stale</Badge>}{first 3 tags (ck-badge--tag)}</div>
    <p class="cx-discover__desc cx-truncate">{description}</p>
  </div>
  <div class="cx-discover__actions">
    <ButtonLink href={e.url} target="_blank" rel="noreferrer" variant="ghost" size="sm" iconOnly aria-label={`Open ${title} in a new tab`}>↗</ButtonLink>
    <Button size="sm" variant={added ? 'ghost' : 'secondary'} isDisabled={added || !canAdd || yamlInvalid} onPress={() => addLink(e.dataset, e.slug)} aria-label={added ? `${title} already added` : `Add ${title} to context`} data-testid="forge-add">{added ? '✓ Added' : '+ Add'}</Button>
  </div>
  ```
  When `working === null`, render `<p class="cx-discover__hint" data-testid="forge-add-hint">Select or create a context to add items.</p>` once above the GridList (disabled RAC buttons can't show tooltips).
- `onAction(key)` (Enter on a row / row press): `addLink` if not added and a context is selected; otherwise no-op.
- Empty text: entries loading → "Loading…"; error → "Couldn't load entries." ; no entries → `No ${def.plural} yet.`; filtered empty → "No entries match these filters."
- Results capped at 200 rendered; when capped show "Showing 200 of N — refine the filter." in the count line.
- Rows are dense: title, slug, state badge and up to 3 tags on **one line**, with the description as a second 12px line (~40px row).
- CSS: `.cx-discover__item { display:flex; align-items:center; gap: var(--sp-3) }` `.cx-discover__main { flex:1; min-width:0; display:flex; flex-direction:column; gap: 0 }` `.cx-discover__title { font-weight: var(--fw-medium) }` `.cx-discover__slug { font-size: var(--fs-xs); color: var(--fg-subtle) }` `.cx-discover__desc { font-size: var(--fs-sm); color: var(--fg-muted) }` `.cx-discover__actions { display:flex; gap: var(--sp-2); flex:none }` `.cx-discover__item[data-added] .cx-discover__title { color: var(--fg-muted) }` `.cx-forge__tablist { padding: 0 var(--sp-3); background: var(--bg-subtle) }` `.cx-discover__hint { margin: var(--sp-2) var(--sp-4) 0; padding: var(--sp-1) var(--sp-3); font-size: var(--fs-sm); color: var(--info-fg); background: var(--info-bg); border-left: 2px solid var(--accent) }`.

### H.5 Context pane
```tsx
<header className="cx-forge__pane-header">
  <h2 id="forge-context-h" className="cx-forge__pane-title">Context</h2>
  <Select aria-label="Context" placeholder="Select a context…" value={url.context === 'new' ? null : url.context} onChange={(k) => selectContext(k === '__new__' ? 'new' : (k as string))} size="sm" triggerTestId="forge-context-select" className="ck-select cx-forge__ctxselect">
    {contexts.map(c => <ListBoxItem id={c.slug} textValue={c.name} description={c.description}>{c.name}</ListBoxItem>)}
    <ListBoxItem id="__new__" textValue="New context…" data-testid="forge-context-new">+ New context…</ListBoxItem>
  </Select>
  {working && <ViewToggle />}   {/* Form | YAML, §H.7 */}
  {working && <ButtonLink variant="ghost" size="sm" href={`/context/${working.name}`} data-testid="forge-view-context">View page ↗</ButtonLink>}
</header>
<div className="cx-forge__pane-body" data-view={view}>{body by state}</div>
{working && <footer className="cx-forge__footer">…</footer>}
```
`contexts` = `$entries.context.entries` sorted by name. `.cx-forge__ctxselect { min-width: 260px }`.

Body states:
| state | render |
|---|---|
| `context` null | `EmptyState title="No context selected"` + text "Pick a context above or create a new one. Contexts are evergreen pointers to entries — content is never copied." + `Button primary "New context"` (→ `selectContext('new')`, testid `forge-empty-new`) |
| loading | `<Spinner/> Loading context…` |
| not-found | `EmptyState title={`No context named "${slug}"`}` + `Button "Create ${slug}"` (sets `$newContextPrefill` = slug, `selectContext('new')`) |
| error | message + `Button "Retry"` |
| ready | editor below |
| `context=new` | the pane shows the previous body (or the null state) and `NewContextDialog` is open |

Editor (ready, `view === 'form'`; for `view === 'yaml'` see §H.7):
```tsx
<div className="cx-ctx">
  <div className="cx-ctx__meta">
    <TextField label="Name" value={working.name} isReadOnly mono description="Name is the file name and slug; it can't be changed." inputTestId="forge-context-name" />
    <TextField label="Description" value={working.description} onChange={setDescription} isRequired inputTestId="forge-context-description" />   {/* single-line plain text (amendment 11) */}
    <div className="cx-ctx__tags">
      <TagGroup label="Tags" onRemove={(keys) => [...keys].forEach(k => removeTag(String(k)))} emptyText="No tags">{(working.tags ?? []).map(t => <Tag id={t}>{t}</Tag>)}</TagGroup>
      <AddTagInput />   {/* local useState draft; Enter → addTag(normalized) and clear; validation ^[a-z0-9][a-z0-9-]*$; testid forge-add-tag */}
    </div>
  </div>
  <div className="cx-ctx__linkshead"><h3 id="forge-links-h">Links <span className="cx-subtle">({working.links.length})</span></h3></div>
  {working.links.length === 0
    ? <EmptyState title="No links yet">Add entries from the Discover pane.</EmptyState>
    : <ol className="cx-links" aria-labelledby="forge-links-h" data-testid="forge-links">{working.links.map((l, i) => <LinkRow key={`${l.dataset}:${l.slug}`} link={l} index={i} count={n} />)}</ol>}
</div>
```
`LinkRow`:
```tsx
<li className="cx-link" data-ds={l.dataset} data-missing={missing || undefined} data-testid="forge-link" data-key={key}>
  <div className="cx-link__head">
    <span className="cx-link__index" aria-hidden>{index + 1}</span>
    <DatasetBadge dataset={l.dataset} />
    <a className="cx-link__title cx-truncate" href={entry?.url ?? `/${l.dataset}/${l.slug}`} target="_blank" rel="noreferrer">{entry?.title ?? entry?.name ?? l.slug}</a>
    <code className="cx-link__slug">{l.slug}</code>
    {entry?.state && <StateBadge … />}
    {missing && <Badge tone="danger" title="This entry no longer exists">missing</Badge>}
    <Toolbar aria-label={`Actions for ${label}`} className="ck-toolbar cx-link__actions">
      <Tooltip content="Move up"><Button variant="ghost" size="sm" iconOnly aria-label={`Move ${label} up`} isDisabled={index === 0} onPress={() => onMove(-1)} data-testid="forge-link-up">↑</Button></Tooltip>
      <Tooltip content="Move down"><Button … aria-label={`Move ${label} down`} isDisabled={index === count - 1} onPress={() => onMove(1)} data-testid="forge-link-down">↓</Button></Tooltip>
      <Tooltip content="Remove"><Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${label}`} onPress={onRemove} data-testid="forge-link-remove">×</Button></Tooltip>
    </Toolbar>
  </div>
  <Disclosure className="ck-disclosure cx-link__notes" title="Notes for the agent" meta={l.notes ? `${lineCount} lines · ${firstLine(l.notes, 60)}` : 'none'} triggerTestId="forge-link-notes-toggle">
    {({ isExpanded }) => isExpanded && <>
      <CodeEditor language="markdown" compact value={l.notes ?? ''} onChange={(v) => setLinkNotes(key, v)}
                  height={{ mode: 'auto', minLines: 8, maxLines: 20 }} ariaLabel={`Notes for the agent about ${label}`}
                  placeholder="Markdown guidance for the agent: scope, focus, caveats…" onSave={save}
                  testId="forge-link-notes" describedBy={`notes-help-${key}`} />
      <p id={`notes-help-${key}`} className="cx-link__notes-help">Markdown. Narrow the scope, point at the relevant parts, or explain how this item is used in this context.</p>
    </>}
  </Disclosure>
</li>
```
- `missing` = `$entries[l.dataset].status === 'ready'` and `findEntry` is undefined. While loading, show the slug only.
- Notes editors mount **only while expanded**: Disclosures start collapsed, and the render-prop gates `CodeEditor`.
  So a context with many links doesn't create many Monaco instances. The collapsed `meta` shows line count + first line.
  Editor = compact markdown (`wordWrap: 'on'`, minimap off, line numbers off, auto height 8→20 lines, Tab moves
  focus; §B.22). `firstLine`/`lineCount` are pure helpers. Several notes editors may be open at once, each with its
  own model `path`.
- Focus after move: `onMove(dir)` = `flushSync(() => moveLink(key, dir))`, then focus the same-direction button of the moved row via a `Map<string, HTMLButtonElement>` ref registry (callback refs); if that button is now disabled (row reached an end), focus the opposite-direction button. After remove: focus the next row's Remove button, else the previous row's, else the "Links" heading (`tabIndex={-1}`).
- Footer:
  ```tsx
  <Button variant="primary" onPress={save} isDisabled={!dirty || yamlInvalid} isPending={status.kind === 'saving'} data-testid="forge-save">Save <Kbd>{modKeyLabel}S</Kbd></Button>
  <Button onPress={revert} isDisabled={!dirty} data-testid="forge-revert">Revert</Button>
  <Button variant="ghost" onPress={() => setConfirmOpen(true)} data-testid="forge-delete">Delete…</Button>   {/* confirm open = local useState */}
  <span className="cx-forge__status" role="status" data-kind={kind} data-testid="forge-status">{statusText}</span>
  ```
  `statusText` (uses `$now`): invalid YAML → `Invalid YAML — ${n} problem(s)` (`data-kind="error"`); dirty → "Unsaved changes" (`data-kind="dirty"`); saving → "Saving…"; error → `Save failed: ${message}` + issues joined `path: message` (`data-kind="error"`); saved → `Saved ${formatRelative(at, now)}` (`data-kind="saved"`); deleted → message; else "No changes".
  `ConfirmDialog` (testId `forge-delete-dialog`): title `Delete context "${name}"?`, body "This deletes data/context/<name>.yaml. Linked entries are not affected.", confirmLabel "Delete", tone danger, `isPending` while deleting.
- CSS: `.cx-ctx { padding: var(--sp-3) var(--sp-4); display:flex; flex-direction:column; gap: var(--sp-3) }` `.cx-ctx__meta { display:grid; grid-template-columns: minmax(0,1fr) minmax(0,2fr); gap: var(--sp-2) var(--sp-3); align-items:end }` (name + description on one row) `.cx-ctx__tags { grid-column: 1 / -1; display:flex; align-items:center; gap: var(--sp-3) }` `.cx-ctx__linkshead h3` uses `.cx-label` `.cx-links { display:flex; flex-direction:column; border: 1px solid var(--border) }` (rows, not cards) `.cx-link { padding: 0 var(--sp-3); background: var(--surface); border-bottom: 1px solid var(--border); border-left: 2px solid var(--ds-c) }` `.cx-link:last-child { border-bottom: 0 }` `.cx-link:focus-within { background: color-mix(in srgb, var(--accent) 4%, var(--surface)) }` `.cx-link[data-missing] { border-left-color: var(--danger); background: var(--danger-bg) }` `.cx-link__head { display:flex; align-items:center; gap: var(--sp-2); min-width:0; min-height: var(--row-h) }` `.cx-link__index { width: 18px; font-family: var(--font-mono); text-align:right; font-size: var(--fs-xs); color: var(--fg-subtle); font-variant-numeric: tabular-nums }` `.cx-link__title { font-weight: var(--fw-medium); color: var(--fg); min-width:0 }` `.cx-link__slug { font-size: var(--fs-xs); color: var(--fg-subtle) }` `.cx-link__actions { margin-left:auto }` `.cx-link__notes { padding: 0 0 var(--sp-2) 26px }` `.cx-link__notes-help { margin-top: var(--sp-1); font-size: var(--fs-xs); color: var(--fg-subtle) }`.

### H.6 New context dialog, dirty guards, history
- `NewContextDialog` open iff `$forgeUrl.context === 'new'`. Kit `Modal` (dialog variant, `isDismissable`) + `Dialog title="New context"` (testId `forge-new-dialog`). RAC `Form` with `validationBehavior="aria"`:
  - `TextField label="Name" mono autoFocus isRequired` (local `useState`, initial = `$newContextPrefill`), live `validate`: empty → "Required"; `!/^[a-z0-9]+(?:-[a-z0-9]+)*$/` → "Use lowercase letters, digits and single hyphens, e.g. auth-refactor"; length > 64 → "64 characters max"; exists in contexts list → "A context with this name already exists". `inputTestId="forge-new-name"`.
  - `TextField label="Description" isRequired` (`forge-new-description`): single-line plain text.
  - Footer: `Button "Cancel"` (testid `forge-new-cancel`) and `Button primary type="submit" "Create"` (`forge-new-create`, disabled while invalid, `isPending` while posting). Submit → `createContext`; server 409 → show as name field error (`validationErrors={{ name: msg }}` on Form).
  - Cancel/Esc/overlay → if `history.state?.ctxmanForgeNew` → `history.back()`, else `replaceState` with `context: <previous or null>`; `$newContextPrefill.set('')`.
  - `selectContext('new')` pushes with state `{ ctxmanForgeNew: true }`.
- **Dirty guard (in-app)**: `selectContext(x)` when `$dirty` → do not navigate; set `$pendingSwitch = x` and render `ConfirmDialog` (testId `forge-discard-dialog`, title "Discard unsaved changes?", confirm "Discard", tone danger); confirm → revert then proceed; cancel → clear.
- The switch is also guarded when the YAML draft is invalid (`$yamlInvalid`), with the same dialog and "Discard invalid YAML?" wording.
- **Dirty guard (popstate)**: if the popped URL changes `context` while dirty → `window.confirm('Discard unsaved changes to "<name>"?')` (must be synchronous); cancel → `history.pushState(null, '', urlFor($forgeUrl.get()))` to restore the URL and keep state; OK → revert, then `applyUrl()` + `loadContext`.
- Dataset tab / filter changes never touch the working copy; no guard needed.
- `beforeunload` warns when dirty (covers links, nav, reload, closing tab).

### H.7 YAML view (raw ContextDoc in Monaco)
- Purpose: power-editing the whole context as YAML, with validation feedback **before** save (amendment 11). The
  form view stays the default.
- URL: `view=yaml` (absent = form). Toggling writes `replaceState`; `applyUrl()` reads it (deep link opens YAML
  view); popstate re-reads it.
- Toggle (in the Context pane header, right of the Select, only when `working`):
  ```tsx
  <ChipGroup label="Editor view" selectionMode="single" disallowEmptySelection selectedKeys={[view]} onSelectionChange={(k) => setView([...k][0] as 'form'|'yaml')} data-testid="forge-view-toggle">
    <Chip id="form" data-testid="forge-view-form" isDisabled={view === 'yaml' && !yamlCheck.ok}>Form</Chip>
    <Chip id="yaml" data-testid="forge-view-yaml">YAML</Chip>
  </ChipGroup>
  ```
  When switching back to Form is blocked, a `cx-subtle` hint next to the toggle says "Fix YAML errors to return to
  the form (or Revert)".
- Pure helpers `src/lib/context-yaml.ts` (unit-tested, shared with the server writer so both serialize identically):
  - `serializeContext(doc: ContextDoc): string` → `YAML.stringify(ordered, { lineWidth: 0, blockQuote: 'literal' })`
    with key order `name, description, tags (omitted when empty), links[]{dataset, slug, notes?}`. Multi-line notes
    become `|` block literals.
  - `parseContextYaml(text: string, expectedName: string): { ok: true; doc: ContextDoc } | { ok: false; issues: YamlIssue[] }`
    where `YamlIssue = { line: number; column: number; endLine: number; endColumn: number; message: string; source: 'yaml' | 'schema' }`.
    Steps: `const lc = new LineCounter(); const d = YAML.parseDocument(text, { lineCounter: lc, prettyErrors: false })`.
    `d.errors` → `source:'yaml'` issues from `err.linePos`. Otherwise `ContextSchema.safeParse(d.toJS())` (zod schema from
    `src/datasets/schemas.ts`), where each issue is positioned by `d.getIn(issue.path, true)?.range` → `lc.linePos(start/end)`,
    falling back to line 1. Its message is `${issue.path.join('.')}: ${issue.message}`. Extra rule: `doc.name !== expectedName`
    → issue at the `name` value: "name must stay "<slug>" (rename isn't supported)".
- Store additions (`src/stores/forge.ts`):
  ```ts
  export const $view = atom<'form' | 'yaml'>('form');               // from ?view=
  export const $yamlDraft = atom<string | null>(null);              // non-null only in YAML view
  export const $yamlCheck = computed([$yamlDraft, $baseline], (t, b) => t === null || b === null ? { ok: true as const, issues: [] } : parseContextYaml(t, b.name));
  export function setView(v: 'form' | 'yaml'): void;  // → yaml: $yamlDraft.set(serializeContext($working)); → form: only if $yamlCheck.ok, then $yamlDraft.set(null)
  export function setYamlDraft(text: string): void;   // set draft; if $yamlCheck.get().ok → $working.set(check.doc)  (two-way sync: form state is always the last valid YAML)
  ```
  - Every action that mutates `$working` while `$view === 'yaml'` re-serializes the draft:
    `addLink` from Discover, `revert`, and a load/save response. The user's YAML comments and formatting are not kept
    (documented in the help text). While the draft is invalid, Discover "Add" buttons are disabled with the hint
    "Fix YAML errors first".
  - `$dirty` is unchanged (working vs baseline). Additionally, `$yamlInvalid = computed($yamlCheck, c => !c.ok)`.
  - Save is disabled while `$yamlInvalid`, and Cmd/Ctrl+S does nothing then (status shows the invalid state). The
    PUT body is always `$working` (JSON). The server writes YAML with `serializeContext`.
- Body (replaces the editor when `view === 'yaml'`):
  ```tsx
  <div className="cx-yaml" data-testid="forge-yaml">
    <CodeEditor language="yaml" value={draft} onChange={setYamlDraft} height={{ mode: 'fill' }} ariaLabel={`YAML for context ${working.name}`}
                testId="forge-yaml-editor" markers={toMarkers(check.issues)} onSave={save} onReady={(api) => { yamlApi = api; }} describedBy="forge-yaml-help" />
    <p id="forge-yaml-help" className="cx-yaml__help">Edits sync to the form when valid. Comments and formatting are not preserved. Tab indents; press {isMac ? 'Ctrl+Shift+M' : 'Ctrl+M'} to make Tab move focus.</p>
    <div className="cx-yaml__issues" role="status" aria-live="polite" data-testid="forge-yaml-issues">
      {check.ok ? <span className="cx-yaml__ok">✓ Valid</span>
        : <><Badge tone="danger">invalid</Badge> <span>{check.issues.length} problem(s)</span>
            <ul>{check.issues.map((i) => <li key={…}><Button variant="ghost" size="sm" onPress={() => yamlApi?.revealPosition(i.line, i.column)} data-testid="forge-yaml-issue"><code>{i.line}:{i.column}</code> {i.message}</Button></li>)}</ul></>}
    </div>
  </div>
  ```
  (`yamlApi` is held in a `useRef` and written only inside the `onReady` callback.)
- Status line additions: invalid YAML → `Invalid YAML — ${n} problem(s)` (`data-kind="error"`) takes precedence over "Unsaved changes".
- CSS: `.cx-yaml { flex:1; min-height: 0; display:flex; flex-direction:column; gap: var(--sp-2); padding: var(--sp-3) var(--sp-4) }` `.cx-yaml__help { font-size: var(--fs-xs); color: var(--fg-subtle) }` `.cx-yaml__issues { max-height: 120px; overflow:auto; font-size: var(--fs-sm); color: var(--danger-fg); border-top: 1px solid var(--border); padding-top: var(--sp-2) }` `.cx-yaml__issues code { color: var(--fg-muted); margin-right: var(--sp-2) }` `.cx-yaml__ok { color: var(--success-fg); font-size: var(--fs-sm) }`. In YAML view the context pane body is `display:flex; flex-direction:column; overflow:hidden` so the editor fills the pane.
- Keyboard: inside the editor, Cmd/Ctrl+S saves (editor action, §B.22) and Esc never bubbles out. Tab indents
  (non-compact editor); Ctrl+M or Ctrl+Shift+M toggles Tab-focus mode.

---

## I. Tools page `/tools` (`src/ui/tools/`)

Page `src/pages/tools.astro`: PageHeader "Tools" + `<ToolsRunner client:only="react" scripts={SCRIPTS}><div slot="fallback" …>Loading tools…</div></ToolsRunner>` (the only island with props: the allowlist from `src/lib/scripts-allowlist.ts`, passed so the page and island agree).
Files: `ToolsRunner.tsx`, `ScriptList.tsx`, `OutputPanel.tsx`, `AddEntryForm.tsx`, `tools.css`; store `src/stores/tools.ts`.

### I.1 URL
`add=<dataset id>` preselects the Add Entry dataset (deep-linked from list pages as `/tools?add=task#add-entry`). Changing the Select → `history.replaceState` with `add=<id>`. Run output is an action result, not URL state.

### I.2 Store (`src/stores/tools.ts`)
```ts
export const $addDataset = atom<DatasetId | null>(null);        // onMount: from ?add= (valid ids only)
export const $run = atom<{ status: 'idle'|'running'|'done'|'error'; script?: string; code?: number; stdout?: string; stderr?: string; durationMs?: number; error?: string; created?: { dataset: DatasetId; slug: string; path: string } }>({ status: 'idle' });
export function runScript(name: string, body?: object): Promise<void>; // POST /api/scripts/<name>, JSON body; sets running→done|error (error = HTTP/network failure, not non-zero exit)
export function setAddDataset(ds: DatasetId): void; // + replaceState
export function clearRun(): void;
```

### I.3 Layout
```html
<div class="cx-tools" data-testid="tools">
  <div class="cx-tools__left">
    <section class="cx-panel" aria-labelledby="h-scripts" data-testid="tools-scripts">
      <h2 class="cx-panel__title" id="h-scripts">Checks</h2>
      <ul class="cx-scripts">{checks.map(s => <li class="cx-scripts__row" data-testid={`tools-script-${s.name}`}>
        <div class="cx-scripts__info"><code class="cx-scripts__name">{s.name}</code><span class="cx-scripts__label">{s.label}</span><p class="cx-subtle">{s.description}</p></div>
        {lastRunOf(s) && <Badge tone={code === 0 ? 'success' : 'danger'}>exit {code}</Badge>}
        <Button size="sm" variant="secondary" onPress={() => runScript(s.name)} isPending={running && script===s.name} isDisabled={running && script!==s.name} data-testid={`tools-run-${s.name}`} aria-label={`Run ${s.label}`}>Run</Button>
      </li>)}</ul>
    </section>
    <section id="add-entry" class="cx-panel" aria-labelledby="h-add" data-testid="tools-add">…I.5…</section>
  </div>
  <OutputPanel />
</div>
```
- One run at a time: while running, all other Run buttons and the Create button are disabled.
- CSS: `.cx-tools { display:grid; grid-template-columns: minmax(340px, 2fr) minmax(0, 3fr); gap: var(--sp-4); align-items:start }` (`max-width: 1099px` → 1 column). `.cx-tools__left { display:flex; flex-direction:column; gap: var(--sp-4) }` `.cx-scripts__row { display:flex; align-items:center; gap: var(--sp-3); min-height: var(--row-h); padding: var(--sp-1) var(--sp-4); border-bottom: 1px solid var(--border) }` `.cx-scripts__info p { font-size: var(--fs-xs) }` `.cx-scripts__info { flex:1; min-width:0 }` `.cx-scripts__name { font-size: var(--fs-sm); margin-right: var(--sp-2) }`.

### I.4 `OutputPanel` (terminal-styled; composes cybercore terminal classes)
```html
<section class="cx-output cyber-terminal" aria-labelledby="h-output" data-testid="tools-output">
  <div class="cx-output__fx cyber-scanlines cyber-scanlines--fine" aria-hidden="true"></div>   <!-- behind content, same technique as §G.7 -->
  <header class="cyber-terminal__header cx-output__head">
    <span class="cyber-terminal__dot cyber-terminal__dot--red" aria-hidden></span><span class="cyber-terminal__dot cyber-terminal__dot--yellow" aria-hidden></span><span class="cyber-terminal__dot cyber-terminal__dot--green" aria-hidden></span>
    <h2 id="h-output" class="cyber-terminal__title cx-output__title">Output</h2>
    <span role="status" data-testid="tools-output-status">{idle: "Run a check to see output." | running: <Spinner/> `Running ${script}…` | done: <code>{script}</code> <Badge tone={code===0?'success':'danger'} data-testid="tools-exit-code">exit {code}</Badge> <span class="cx-subtle">{(durationMs/1000).toFixed(1)}s</span> | error: <Badge tone="danger">request failed</Badge> {error}}</span>
    <span class="cx-output__spacer"/>
    <Button variant="ghost" size="sm" onPress={copyAll} isDisabled={!hasOutput} data-testid="tools-output-copy">Copy</Button>
    <Button variant="ghost" size="sm" onPress={clearRun} isDisabled={!hasOutput} data-testid="tools-output-clear">Clear</Button>
  </header>
  <div class="cyber-terminal__body cx-output__body">
    {stdout && <><h3 class="cx-output__label">stdout</h3><pre class="cx-output__pre" data-testid="tools-stdout" tabindex="0">{stdout}</pre></>}
    {stderr && <><h3 class="cx-output__label cx-output__label--err">stderr</h3><pre class="cx-output__pre cx-output__pre--err" data-testid="tools-stderr" tabindex="0">{stderr}</pre></>}
    {done && !stdout && !stderr && <p class="cx-subtle">No output.</p>}
    {idle && <p class="cx-output__prompt"><span aria-hidden>&gt;</span> ready<span class="cx-output__cursor" aria-hidden></span></p>}
  </div>
</section>
```
- The `<pre>` text renders as text (React escapes). Strip ANSI escape codes before rendering (pure `stripAnsi` in `src/lib/ansi.ts`: regex `/\x1b\[[0-9;]*[A-Za-z]/g`).
- `copyAll` → clipboard `stdout + (stderr ? '\n--- stderr ---\n' + stderr : '')`.
- cybercore gives the terminal a green chrome (green-700 border, green-900 header), Hack font via the overridden
  `--font-mono`, and green-400 body text (13.9:1 on void-400). Our `cx-app` rules shrink its fluid paddings:
- CSS: `.cx-output { position: sticky; top: calc(var(--header-h) + var(--sp-3)); isolation: isolate }` `.cx-output__fx { position:absolute; inset:0; z-index:0; pointer-events:none }` `.cx-output__head, .cx-output__body { position: relative; z-index: 1 }` `.cx-output__head { gap: var(--sp-2); height: var(--row-h); padding: 0 var(--sp-3) }` `.cx-output__title { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: var(--tracking-label); margin-right: var(--sp-2) }` `.cx-output__spacer { flex:1 }` `.cx-output__body { padding: var(--sp-2) var(--sp-3); line-height: 1.45 }` `.cx-output__label { margin-top: var(--sp-2); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle) }` `.cx-output__label--err { color: var(--danger-fg) }` `.cx-output__pre { margin-top: var(--sp-1); max-height: 65vh; overflow:auto; font-size: var(--fs-sm); line-height: 1.45; white-space: pre-wrap; overflow-wrap:anywhere; color: var(--cyber-green-400) }` `.cx-output__pre--err { color: var(--danger-fg); border-left: 2px solid var(--danger); padding-left: var(--sp-2) }` `.cx-output__prompt { color: var(--accent-text); font-size: var(--fs-sm) }` `.cx-output__cursor { display:inline-block; width: 7px; height: 1em; margin-left: 2px; vertical-align: text-bottom; background: var(--accent); animation: ck-blink 1s steps(1) infinite }` `@keyframes ck-blink { 50% { opacity: 0 } }` `@media (prefers-reduced-motion: reduce) { .cx-output__cursor { animation: none } }`.
- The `cyber-terminal__dot` color classes are decorative (`aria-hidden`); exit status is always text + badge.

### I.5 `AddEntryForm`
```tsx
<h2 className="cx-panel__title" id="h-add">Add entry</h2>
<Form className="cx-addform" validationBehavior="aria" onSubmit={onSubmit} data-testid="tools-add-form">
  <Select label="Dataset" value={addDataset} onChange={(k) => setAddDataset(k as DatasetId)} isRequired triggerTestId="tools-add-dataset" placeholder="Choose a dataset…">
    {DATASETS.map(d => <ListBoxItem id={d.id} textValue={d.label}><span className="ck-chip__dot" data-ds={d.id}/> {d.label} <code className="cx-subtle">{d.id}</code></ListBoxItem>)}
  </Select>
  <TextField label="Name" name="name" mono isRequired validate={kebab} description="Kebab-case; becomes the folder/file name and slug." inputTestId="tools-add-name" />
  <TextField label="Title" name="title" description="Optional human title." inputTestId="tools-add-title" />
  <TextField label="Description" name="description" isRequired inputTestId="tools-add-description" />
  <div className="cx-row"><Button type="submit" variant="primary" isPending={running && script==='add'} isDisabled={running} data-testid="tools-add-submit">Create entry</Button></div>
</Form>
{created && <div className="cx-addform__result" role="status" data-testid="tools-add-result">
  Created <code data-testid="tools-add-path">{created.path}</code>
  <ButtonLink size="sm" variant="secondary" href={`/${created.dataset}/${created.slug}`} data-testid="tools-add-open">Open entry</ButtonLink>
  <Button size="sm" variant="ghost" onPress={resetForm}>Add another</Button>
</div>}
```
- Field values: local `useState` (transient drafts). `kebab` = same rule/messages as H.6 (minus uniqueness). Context dataset: allowed (creates an empty context); additionally show `ButtonLink "Open in Forge"` → `/forge?context=<slug>` in the result when `created.dataset === 'context'`.
- `onSubmit(e)`: `e.preventDefault()`; `runScript('add', { dataset, name, description, title: title || undefined })`. Output also appears in OutputPanel. Non-zero exit → result block not shown; OutputPanel shows stderr (e.g. "already exists").
- CSS: `.cx-addform { padding: var(--sp-3) var(--sp-4); display:grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2) var(--sp-3) }` (Dataset + Name on row 1, Title + Description on row 2, submit right-aligned on row 3) `.cx-addform__result { margin: 0 var(--sp-4) var(--sp-3); padding: var(--sp-2) var(--sp-3); display:flex; align-items:center; gap: var(--sp-3); flex-wrap: wrap; background: var(--success-bg); color: var(--success-fg); border-left: 2px solid var(--success-fg) }` `.cx-addform__result code { color: var(--fg) }`.

---


## J. Markdown rendering (`src/styles/prose.css`, complete)

### J.0 Code highlighting (Shiki) shares the Monaco palette
`astro.config.ts` owner: `markdown: { shikiConfig: { theme: ctxmanCyberShiki, wrap: false } }`, where
`ctxmanCyberShiki` is a TextMate theme object exported from `src/lib/shiki-ctxman-cyber.ts`, built from
`CYBER` (§B.23) with the same token→color mapping. GFM (footnotes, task lists, tables) is Astro's default:
```ts
export const ctxmanCyberShiki = {
  name: 'ctxman-cyber', type: 'dark',
  colors: { 'editor.background': CYBER.void700, 'editor.foreground': CYBER.chrome100 },
  tokenColors: [
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: CYBER.chrome400, fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type', 'constant.language'], settings: { foreground: CYBER.magentaText } },
    { scope: ['string', 'string.quoted'], settings: { foreground: CYBER.green500 } },
    { scope: ['constant.numeric', 'constant.character.escape'], settings: { foreground: CYBER.yellow500 } },
    { scope: ['entity.name.function', 'support.function'], settings: { foreground: CYBER.cyan500 } },
    { scope: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], settings: { foreground: CYBER.cyan400 } },
    { scope: ['support.type.property-name', 'meta.object-literal.key', 'entity.name.tag.yaml'], settings: { foreground: CYBER.cyan400 } },
    { scope: ['entity.name.tag'], settings: { foreground: CYBER.violetText } },
    { scope: ['entity.other.attribute-name'], settings: { foreground: CYBER.orange } },
    { scope: ['variable', 'variable.other'], settings: { foreground: CYBER.chrome100 } },
    { scope: ['variable.parameter'], settings: { foreground: CYBER.orange } },
    { scope: ['punctuation', 'meta.brace', 'keyword.operator'], settings: { foreground: CYBER.chrome300 } },
    { scope: ['markup.heading', 'entity.name.section'], settings: { foreground: CYBER.cyan500, fontStyle: 'bold' } },
    { scope: ['markup.bold'], settings: { fontStyle: 'bold' } },
    { scope: ['markup.italic'], settings: { fontStyle: 'italic' } },
    { scope: ['markup.inline.raw', 'markup.raw'], settings: { foreground: CYBER.orange } },
    { scope: ['markup.underline.link', 'string.other.link'], settings: { foreground: CYBER.blueText } },
    { scope: ['markup.list punctuation', 'punctuation.definition.list'], settings: { foreground: CYBER.magentaText } },
    { scope: ['markup.quote'], settings: { foreground: CYBER.chrome400, fontStyle: 'italic' } },
    { scope: ['markup.inserted'], settings: { foreground: CYBER.green500 } },
    { scope: ['markup.deleted', 'invalid'], settings: { foreground: CYBER.magenta500 } },
  ],
};
```
There's a single theme, so no dual-theme CSS variable switching is needed.

### J.1 prose.css
```css
@layer cx-prose {
  .cx-prose { font-size: var(--fs-lg); line-height: var(--lh-prose); color: var(--fg); overflow-wrap: break-word; }
  .cx-prose > :first-child { margin-top: 0; }
  .cx-prose > :last-child { margin-bottom: 0; }
  /* cybercore's reset zeroed every margin; prose re-adds block rhythm (dense) */
  .cx-prose :where(p, ul, ol, dl, blockquote, pre, table, figure, hr, details) { margin: 0 0 var(--sp-5); }

  .cx-prose :where(h1, h2, h3, h4, h5, h6) {
    margin: var(--sp-6) 0 var(--sp-3); line-height: var(--lh-tight); font-weight: var(--fw-semibold);
    text-transform: none; letter-spacing: 0; color: var(--fg);
    scroll-margin-top: calc(var(--header-h) + var(--sp-4));
  }
  .cx-prose h1 { font-size: var(--fs-2xl); }
  .cx-prose h2 {
    font-size: var(--fs-xl); padding-bottom: var(--sp-2);
    border-bottom: var(--border-w) solid transparent;
    border-image: linear-gradient(90deg, var(--accent-line), transparent 70%) 1;
  }
  .cx-prose h3 { font-size: var(--fs-lg); color: var(--accent-text); }
  .cx-prose h4 { font-size: var(--fs-md); }
  .cx-prose :where(h5, h6) { font-size: var(--fs-xs); color: var(--fg-subtle); text-transform: uppercase; letter-spacing: var(--tracking-label); }

  .cx-prose a { color: var(--accent-text); text-decoration: underline; text-decoration-color: var(--accent-line); text-underline-offset: 2px; }
  .cx-prose a:hover { text-decoration-color: currentColor; text-shadow: 0 0 6px color-mix(in srgb, var(--accent) 45%, transparent); }
  .cx-prose a[href^="http"]::after { content: "↗"; font-size: 0.75em; margin-left: 1px; vertical-align: super; color: var(--fg-subtle); }

  .cx-prose ul { list-style: square; padding-left: 1.4em; }
  .cx-prose ol { list-style: decimal; padding-left: 1.6em; }
  .cx-prose li + li { margin-top: var(--sp-1); }
  .cx-prose li > :where(ul, ol) { margin: var(--sp-1) 0 0; }
  .cx-prose li::marker { color: var(--accent); }
  .cx-prose ol > li::marker { font-family: var(--font-mono); font-size: 0.9em; }
  .cx-prose ul.contains-task-list { list-style: none; padding-left: 0.2em; }
  .cx-prose .task-list-item input[type="checkbox"] { margin: 0 var(--sp-3) 0 0; vertical-align: -1px; accent-color: var(--accent); }

  .cx-prose dt { font-weight: var(--fw-semibold); }
  .cx-prose dd { margin: 0 0 var(--sp-3) var(--sp-5); color: var(--fg-muted); }

  .cx-prose :not(pre) > code {
    padding: 0 0.3em; font-size: 0.86em; color: var(--cyber-cyan-400);
    background: var(--code-bg); border: var(--border-w) solid var(--border); border-radius: var(--r-sm);
  }
  .cx-prose pre {
    padding: var(--sp-4) var(--sp-5); overflow-x: auto;
    font-size: var(--fs-sm); line-height: 1.5; tab-size: 2;
    background: var(--code-bg-block); border: var(--border-w) solid var(--border);
    border-left: 2px solid var(--accent-line); border-radius: var(--r-sm);
  }
  .cx-prose pre code { font-size: inherit; background: none; border: 0; padding: 0; color: inherit; }
  .cx-prose pre.astro-code { background-color: var(--code-bg-block) !important; }  /* Shiki sets an inline bg; keep ours */

  .cx-prose blockquote {
    padding: var(--sp-2) var(--sp-5); color: var(--fg-muted);
    border-left: 2px solid var(--border-strong); background: var(--bg-subtle);
  }
  .cx-prose blockquote > :last-child { margin-bottom: 0; }

  .cx-prose table { display: block; max-width: 100%; width: max-content; overflow-x: auto; font-size: var(--fs-md); border: var(--border-w) solid var(--border); }
  .cx-prose :where(th, td) { padding: var(--sp-1) var(--sp-4); border-bottom: var(--border-w) solid var(--border); text-align: left; vertical-align: top; }
  .cx-prose :where(th, td) + :where(th, td) { border-left: var(--border-w) solid var(--border); }
  .cx-prose th { font-size: var(--fs-xs); font-weight: var(--fw-semibold); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-muted); background: var(--bg-deep); }
  .cx-prose tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--bg-subtle) 70%, transparent); }
  .cx-prose tbody tr:hover td { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .cx-prose tbody tr:last-child td { border-bottom: 0; }

  .cx-prose hr { margin: var(--sp-6) 0; border-top-color: var(--accent-line); }
  .cx-prose img { max-width: 100%; height: auto; border: 1px solid var(--border); }
  .cx-prose details { padding: var(--sp-2) var(--sp-4); border: var(--border-w) solid var(--border); }
  .cx-prose summary { cursor: pointer; font-weight: var(--fw-medium); color: var(--accent-text); }
  .cx-prose kbd { padding: 0 var(--sp-1); font-size: 0.8em; border: var(--border-w) solid var(--border); border-bottom-color: var(--border-strong); background: var(--cyber-void-700); }
  .cx-prose mark { background: var(--mark-bg); color: var(--mark-fg); padding: 0 2px; }

  /* GFM footnotes (OKF source attribution) */
  .cx-prose sup:has(> a[data-footnote-ref]) { line-height: 0; }
  .cx-prose a[data-footnote-ref] {
    padding: 0 0.25em; font-family: var(--font-mono); font-size: 0.72em; text-decoration: none;
    color: var(--accent-text); background: var(--accent-bg); border: 1px solid var(--accent-line);
  }
  .cx-prose a[data-footnote-ref]::before { content: "["; }
  .cx-prose a[data-footnote-ref]::after { content: "]"; vertical-align: baseline; margin: 0; font-size: inherit; color: inherit; }
  .cx-prose section[data-footnotes] {
    margin-top: var(--sp-6); padding-top: var(--sp-3);
    border-top: var(--border-w) solid var(--accent-line);
    font-size: var(--fs-sm); color: var(--fg-muted);
  }
  .cx-prose section[data-footnotes] > h2 { /* remark renders an sr-only "Footnotes" h2; show it as a HUD label */
    position: static; width: auto; height: auto; clip: auto; margin: 0 0 var(--sp-2); padding: 0; border: 0; border-image: none;
    font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: var(--tracking-label); color: var(--fg-subtle);
  }
  .cx-prose section[data-footnotes] li:target { background: var(--mark-bg); color: var(--fg); }
  .cx-prose a[data-footnote-backref] { margin-left: var(--sp-2); text-decoration: none; }
  .cx-prose :target { scroll-margin-top: calc(var(--header-h) + var(--sp-4)); }

  /* compact variant: context link notes */
  .cx-prose--compact { font-size: var(--fs-md); line-height: var(--lh); }
  .cx-prose--compact :where(p, ul, ol, pre, blockquote, table) { margin-bottom: var(--sp-2); }
  .cx-prose--compact :where(h1, h2, h3, h4) { margin: var(--sp-3) 0 var(--sp-1); font-size: var(--fs-md); border: 0; border-image: none; padding: 0; color: var(--fg); }
}
```
All prose text pairs: body chrome-100 on void-500 (17.1:1), muted chrome-300 (9.6:1), inline code cyan-400 on void-300 (9.5:1), links cyan-500 (13.7:1).

## K. Accessibility and keyboard checklist

- [ ] Every page: one `<h1>`; landmarks `header`, `nav[aria-label=Primary]`, `main#main`, `footer`; skip link first in tab order.
- [ ] `aria-current="page"` on current nav link / file-tree item / last breadcrumb; `aria-current="true"` on the dataset nav link for detail pages.
- [ ] Focus is always visible: kit uses `[data-focus-visible]`; twins use `:focus-visible`; never `outline: none` without a replacement.
- [ ] Color is never the only signal: state badges have text + dot shape; dataset badges have the id text; stale has text "stale"; errors have text.
- [ ] All text ≥ 4.5:1 on the dark theme (token pairs in §A.1/§A.2/§B.23 verified). Never use `--cyber-chrome-500/600` or raw `--cyber-magenta-500` for small text on tinted surfaces; use `--fg-subtle` / `--danger-fg`.
- [ ] Effects never sit on top of text: scanlines only on decorative layers behind content (§G.7, §I.4); glitch only on the brand title, with `data-text` and `aria-hidden` text; all cybercore animations and ours stop under `prefers-reduced-motion`.
- [ ] Icon-only buttons (`↑ ↓ × ↗`, close) have `aria-label`; tooltips are supplementary.
- [ ] Global shortcuts: Cmd/Ctrl+K (open / refocus search), `/` (open search when not typing), Esc (clear, then close), Cmd/Ctrl+S (save in Forge). Shortcuts never fire inside text inputs except Cmd/Ctrl+K and Cmd/Ctrl+S, and inside a Monaco editor only Cmd/Ctrl+S (the editor action) applies.
- [ ] Monaco editors: `ariaLabel` set; visible focus via `.ck-code:focus-within`; Esc stays inside the editor (never closes a dialog/search); compact notes editors use `tabFocusMode` so Tab leaves; the YAML editor documents Ctrl+M / Ctrl+Shift+M (Tab trapping toggle); validation issues are listed as text under the editor (`role="status"`), not only as squiggles; `accessibilitySupport: 'auto'` (screen-reader mode when detected).
- [ ] Search modal: focus moves to the input on open (`autoFocus`), focus is trapped, restored on close; results announced via `role="status"` count; arrow keys work while the input keeps focus (Autocomplete virtual focus).
- [ ] Forge: after reorder/remove, focus lands on a predictable control (H.5); Save status in `role="status"`; destructive actions confirm via `alertdialog`; `beforeunload` when dirty.
- [ ] Forms: every input has a visible `<label>` or `aria-label`; errors via RAC `FieldError` (linked by `aria-describedby`); required fields `isRequired`.
- [ ] GET filter form works without JS (Apply button visible when not enhanced); chips are real checkboxes/radios inside `<fieldset><legend>`.
- [ ] Tables use `<th scope="col">` and `aria-sort` on the sorted column.
- [ ] `prefers-reduced-motion` → durations 0 (tokens); spinners slow down rather than stop.
- [ ] Hit targets ≥ 24×24 px (`--control-h-sm`).
- [ ] Live relative times have the absolute timestamp in `title` and machine value in `datetime`.
- [ ] React islands obey the Rules of React: no `Date.now()`/`Math.random()` in render (`$now`), no setState in effects, history/DOM writes only in event handlers, store actions, or store `onMount`; `flushSync` only inside event handlers.

---

## L. `data-testid` registry (Playwright)

Fixed names; `<ds>` = dataset id, `<name>` = script name, `<state>`/`<tag>`/`<type>` = literal values.

| area | test ids |
|---|---|
| shell | `app-header`, `primary-nav`, `nav-home`, `nav-<ds>` ×10, `nav-forge`, `nav-tools`, `search-button`, `app-footer`, `footer-data-dir` |
| dashboard | `dashboard-cards`, `dataset-card-<ds>`, `dashboard-recent`, `dashboard-stale`, `dashboard-contexts`, `minilist-row` |
| list page | `list-filter-form`, `list-filter-q`, `list-sort`, `list-filter-apply`, `list-filter-clear`, `list-result-count`, `list-chip-state-<state>`, `list-chip-tag-<tag>`, `list-chip-type-all`, `list-chip-type-<type>`, `list-results`, `list-row` (+ `data-slug`), `list-new-entry` |
| detail | `detail-slug`, `detail-content`, `detail-aside`, `detail-meta`, `detail-files`, `detail-backrefs`, `detail-open-forge`, `context-group-<ds>`, `context-link` |
| search | `search-modal`, `search-input`, `search-close`, `search-dataset-chips`, `search-chip-all`, `search-chip-<ds>`, `search-count`, `search-results`, `search-result`, `search-retry`, `search-reload` |
| forge | `forge-view-toggle`, `forge-view-form`, `forge-view-yaml`, `forge-yaml`, `forge-yaml-editor`, `forge-yaml-issues`, `forge-yaml-issue`, `forge`, `forge-discover`, `forge-tab-<ds>`, `forge-filter-q`, `forge-state-chips`, `forge-chip-state-<state>`, `forge-tag-chips`, `forge-chip-tag-<tag>`, `forge-result-count`, `forge-add-hint`, `forge-results`, `forge-result` (+ `data-added`), `forge-add`, `forge-context`, `forge-context-select`, `forge-context-new`, `forge-empty-new`, `forge-view-context`, `forge-context-name`, `forge-context-description`, `forge-add-tag`, `forge-links`, `forge-link` (+ `data-key`), `forge-link-up`, `forge-link-down`, `forge-link-remove`, `forge-link-notes-toggle`, `forge-link-notes`, `forge-save`, `forge-revert`, `forge-delete`, `forge-status`, `forge-delete-dialog`, `forge-discard-dialog`, `forge-new-dialog`, `forge-new-name`, `forge-new-description`, `forge-new-cancel`, `forge-new-create` |
| tools | `tools`, `tools-scripts`, `tools-script-<name>`, `tools-run-<name>`, `tools-output`, `tools-output-status`, `tools-exit-code`, `tools-stdout`, `tools-stderr`, `tools-output-copy`, `tools-output-clear`, `tools-add`, `tools-add-form`, `tools-add-dataset`, `tools-add-name`, `tools-add-title`, `tools-add-description`, `tools-add-submit`, `tools-add-result`, `tools-add-path`, `tools-add-open` |

Monaco editors (`CodeEditor` puts `data-testid` on the `.ck-code` root; ids `forge-link-notes`, `forge-yaml-editor`):
Monaco renders real DOM (no canvas). Type through its hidden textarea and read rendered lines:
```ts
const ed = page.getByTestId('forge-yaml-editor');
await ed.locator('.monaco-editor').waitFor();                 // the editor mounted (loader is async)
const input = ed.locator('.monaco-editor textarea');
await input.focus();
await page.keyboard.press('ControlOrMeta+A');
await page.keyboard.insertText('name: x\n');                 // insertText avoids per-key auto-indent; `input.fill(text)` also works for whole-value replace
await input.press('ControlOrMeta+S');                         // editor action → save
await expect(ed.locator('.view-lines')).toContainText('name: x');  // only visible lines are in the DOM
```
Auto-closing brackets/quotes and suggestions are disabled (§B.22), so typed text lands verbatim. Assert persisted values via the API (`GET /api/context/<slug>`) or the status line rather than scraping long documents from `.view-lines`.

Rules: test ids go on the interactive element itself (input, button, trigger) or the region root; repeated rows share an id and carry a distinguishing `data-*` (`data-slug`, `data-key`). Tests locate rows with `getByTestId('list-row').filter({ has: … })` or `[data-slug="x"]`. Islands render `data-testid` only after mount — e2e must wait for `search-input`/`forge`/`tools` before interacting. Suggested waits: search open → `expect(getByTestId('search-input')).toBeFocused()`; URL assertions via `expect(page).toHaveURL(/search=1&sq=foo/)`.

