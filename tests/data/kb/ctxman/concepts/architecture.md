---
type: Architecture
title: Architecture
description: Stack, repository layout and the layering rules that let scripts, tests and the site share one codebase.
tags: [architecture, astro, typescript]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:35:00Z
---

# Architecture

ctxman is an Astro 7.4.0 site in `output: 'server'` mode with the Node adapter (standalone). Pages and JSON API routes run on the same server, and API routes can spawn local scripts.

## Stack

| Concern | Choice |
| --- | --- |
| UI | React islands built from react-aria-components, styled with vanilla CSS in a small kit |
| Theme | cybercore-css as the base layer, Inter for text and Hack for monospace (both self-hosted) |
| Editing | Monaco for every multi-line markdown, JSON or YAML input; plain text fields for single-line values; monaco-yaml gives YAML editors schema diagnostics (see [Editing](/concepts/editing.md)) |
| State | nanostores with @nanostores/react; the URL carries all page state so deep links and back/forward work |
| Data | Files on disk (the data directory, `CTXMAN_DATA_DIR`) read per request with `node:fs`, validated by arktype (the only validator, also the source of the JSON Schemas in `schemas/`); no content collections, no watcher |
| Search | fuse.js over an index built server-side from the files on disk |
| Agents | An embedded MCP server at `POST /mcp` (Streamable HTTP, stateless) on the same server; see [MCP](/concepts/mcp.md) |
| Scripts | TypeScript executed directly by Node 24 (erasable syntax only, `.ts` extensions in imports) |
| Tooling | TypeScript 7.1 nightly `tsc`, oxlint, oxfmt, vitest, playwright, pnpm |

There are exactly twelve React islands, all `client:only="react"`: the search widget and the shortcuts help (every page), the context forge, the [Context inflate](/concepts/context-inflate.md) tool, the tools runner, the DocEditor (okf and skill detail and sub-doc pages), MarkdownTargets (the markdown popups of context, recipe and reference pages), DataForm (the reference, context and recipe forms), EntryTools (the dialogs behind the buttons of an entry page: Details, relations, Add to context, Build context, New concept) NewEntryForm (the okf and skill create form) EntryMenus (the `⋯` actions menu of detail headers: Clone… for okf entries, and Delete) and ListTable (the table of every `/<dataset>` list page: sortable headers, resizable and hideable columns, row links and the rows' own `⋯` menu). The list page renders no table markup: it writes its filtered, sorted rows as JSON into `<script type="application/json" id="ctxman-list-data">` and ListTable reads them when it mounts, in its final layout (the stored column widths apply on the first render). The forge and inflate bundle Monaco; the others load it lazily or not at all, so a detail page does not fetch the editor until it is needed. Everything else is server-rendered Astro with a little vanilla script, such as the Open in IDE button, the state select (also inside the ListTable rows) and the whole-row links of the dashboard and back-reference lists (a CSS stretched-link pattern, no click handlers). See [Editing](/concepts/editing.md) and [Relations](/concepts/relations.md).

## Repository layout

```text
tests/data/  the committed sample corpus: e2e seed, unit-test fixture and the home of these docs
             (your real data lives elsewhere, in the directory CTXMAN_DATA_DIR points at; /data/ is gitignored)
.env.example documents CTXMAN_DATA_DIR (required) and CTXMAN_SERVER_ORIGIN (optional)
schemas/     generated JSON Schemas of reference, snippet, context and recipe (committed; not linted or formatted)
scripts/     add-entry.ts, the check scripts, gen-schemas.ts and fix-yaml-comments.ts, run by node
out/         default output folder of Context inflate (gitignored, not linted or formatted)
src/
  middleware.ts          503 while the data directory is not usable (JSON for /api and /mcp, an instructions page elsewhere)
  datasets/registry.ts   single source of truth for dataset ids, states and labels
  datasets/schemas.ts    arktype Types for every dataset (runtime validation, TypeScript types and the JSON Schema source)
  datasets/validate.ts   the validation facade: validate(), assertValid(), ValidationIssue
  lib/                   shared TypeScript modules (lib/inflate/ holds the Context inflate pipeline, lib/forms/ the form fields and rules, lib/mcp/ the MCP server)
  pages/                 routes and API endpoints (pages/mcp.ts is the MCP route)
  layouts/, components/  Astro layout and server-rendered components
  ui/, stores/           React islands (ui/markdown, ui/forms, ui/entry, ...), kit, entry pickers (ui/pickers), shared editing pieces (ui/edit), Monaco wrappers (ui/editor), nanostores
  styles/                global.css (the only stylesheet entry), tokens, app and prose CSS
tests/unit/  vitest (setup.ts pins CTXMAN_DATA_DIR to an empty temp dir; fixtures/corpus.ts copies tests/data)
tests/e2e/   playwright (one built server per worker, each on its own copy of tests/data)
tests/prod-smoke.ts  smoke test of the built server (pnpm run test:prod)
plans/       historical build specs, not maintained; the code and AGENTS.md win
```

## Layering of `src/lib`

Every module is one of three kinds, named in its header comment, and the kind decides who may import it. No module under `src/lib` imports `astro:*`; pages, API routes and `src/middleware.ts` are the only Astro-aware code.

* **Pure**: no filesystem, no `astro:*` imports. Safe in browser islands, scripts and tests.
* **Node**: may use `node:fs` and `node:path`, never `astro:*`. Safe in scripts, tests and server code.
* **Server**: only server code uses it (`http.ts`, `run-script.ts`, `ide.ts`, `entries.ts`, `bundle-file.ts`, `lib/mcp/*`). Tests may import it; scripts and islands do not. `entries.ts` is the read layer pages, API routes and the MCP tools share (lists, details, the search index, the relation graph).

`data-dir.ts` (Node) is the only reader of `CTXMAN_DATA_DIR`; `markdown.ts` (Node, no fs) renders markdown with Sätteri at request time and memoizes by source hash. It calls `satteri` directly with the highlight and heading-id plugins that `@astrojs/markdown-satteri` exports, and leaves out Astro's image plugins: they replace a relative `<img>` with an `__ASTRO_IMAGE_` placeholder that only Astro's build-time asset pipeline fills in. Two hast plugins of its own follow: one wraps every `<pre>` in `div.cx-codeblock` with a Copy button (`data-copy-code`, handled by `src/scripts/shell.ts`), one collects the headings (`renderMarkdownDoc` returns them with the HTML) for the headings nav of okf and skill pages (`doc-toc.ts` picks the entries, `DocToc.astro` renders them, `shell.ts` marks the section being read). `links.ts#rewriteRenderedHtml` then points links and image sources at site routes; `bundle-file.ts` (Server) serves the raw file route `/<dataset>/<slug>/file/<path>`. The only other markdown reader is `jira-markup.ts` (Pure): it parses GFM with the micromark stack (`mdast-util-from-markdown`, `micromark-extension-gfm`, `mdast-util-gfm`) into an mdast tree, walks it itself and writes Jira wiki markup for "Copy as JIRA Markup"; the islands and `shell.ts` import it lazily at copy time (see [Jira markup](/concepts/jira-markup.md)).

`src/lib/inflate/` follows the same rules. The catalog (targets, modes, materials, options), the recipe parser and serializer, the expander and the material planner (`material-plan.ts`: the ordered steps of a working-directory run, plus every type that crosses the API) are pure, so the Inflate island imports them for instant feedback; its only other imports from that folder are erased `import type`s of the renderer's result. The markdown helpers, the renderer and the pipeline are Node-kind modules without filesystem calls of their own (they read through an injected `InflateSources` and import the OKF and link helpers). The modules that touch the disk are `fs-sources.ts`, `write.ts`, `output-dir.ts` (directory safety checks, inspection and the manifest file), `material-exec.ts` (the step executor, with process spawning injected) and `dir-plan.ts` (the dry run and run preparation), next to `src/lib/recipe-io.ts`. Two modules are Server kind because they run child processes or hold state: `src/lib/proc.ts` (`spawnCapture`) and `jobs.ts` (the in-memory job store); `dir-plan.ts` imports `proc.ts`, so scripts and islands never import it. Those Node and Server files must never be imported by an island. There is no barrel file in that folder.

The editing support follows the same rules. Pure and browser-safe: `reference-yaml.ts` and `snippet-yaml.ts` (the deterministic reference and snippet serializers), `schema-comment.ts` (the yaml-language-server comment), `yaml-doc.ts` (YAML text to a validated document with source positions), `names.ts`, `reorder.ts` and `lib/forms/*`. Node with fs: `doc-io.ts` (read and save one existing markdown file), `reference-io.ts` and `snippet-io.ts` (like `context-io.ts` and `recipe-io.ts`) and `schema-check.ts`; `skill-check.ts` is Node without fs calls so the compliance check and the doc editor report the same findings. `ide.ts` is a Server module because it spawns the IDE command. `json-schema.ts` is used by scripts and tests only.

The relations and write layer adds: Pure `relations.ts` (the graph), `frontmatter-patch.ts` (range-based YAML key edits) and `link-insert.ts` (completion text, shared with the picker); Node with fs `entry-index.ts` (the cached scan every okf and skill list, summary and relation reads from), `entry-io.ts` (the frontmatter GET and PATCH and the entry create), `entry-create.ts` (the write-and-rollback extracted from the add script, so the script and the API write identical files), `entry-clone.ts` (an okf bundle copied into a new entry through a hidden temp folder in the dataset folder, renamed into place when complete) and `atomic-write.ts` (the atomic text write and the per-file lock every writer shares). `doc-io.ts` also creates concepts. Reads of those two kinds go to the disk through the entry index on every request (see [Runtime modes](/concepts/runtime-modes.md)).

Browser-only code lives in `src/ui` and `src/stores`. The Monaco wrapper in `src/ui/editor` touches `self` when loaded, so only `client:only` islands may import it. `src/ui/edit` holds the pieces every editor shares (save bar, conflict dialog, draft backup, the remembered "Saved") and imports no Monaco; the lazy-Monaco islands and the search island import kit parts by file, never through the kit barrel, which pulls Monaco in. The kit (react-aria-components wrappers) provides a searchable Select, an `OrderedList` with drag and drop, a Table (with `ResizableTable` for resizable columns, a sort arrow and header actions), Icon, a Menu and a Disclosure with a one-line preview, plus the shared recipes every island and SSR component reuses: `Status` and `ErrorText` (status lines and inline errors), `Notice` (banners), `Loading`, `ChipToggle`, `FormDialogFooter`, and `EntryRow` with the `ck-entryline` title · slug · description line. The ownership rule: kit CSS owns colour-by-kind and the label typography, app and island CSS only place and size; `tests/unit/css-classes.test.ts` guards unused and undefined `ck-`/`cx-` classes.

The MCP server (`src/lib/mcp/`, Server kind) reuses these same modules; it never calls the HTTP API. Its route is a one-line glue file, `src/pages/mcp.ts`. See [MCP](/concepts/mcp.md).

## One validator

arktype (`src/datasets/schemas.ts`) is the only validator. The same Types validate data files and API bodies at runtime, in the server, the scripts and the browser forms, give the TypeScript types, and generate `schemas/*.schema.json` (the three YAML datasets), which the IDEs and the browser YAML editors (monaco-yaml) read. Code never calls a Type directly: `validate(schema, input)` in `src/datasets/validate.ts` returns plain issues (`path`, `message`, `code` and a `kind` of `unknown-key`, `custom` or `other`) so the Types can change without rippling. zod is not used (an oxlint rule bans importing it; it exists only as a transitive dependency of the MCP SDK). monaco-yaml needs three shims with the current Monaco (a worker-creation adapter, a Vite alias and optimizeDeps entries); the details are in AGENTS.md.

## One registry, everything derived

`src/datasets/registry.ts` lists the dataset ids, labels, lifecycle states and the OKF type string for each dataset. Navigation, filters, the add scripts and the checks all read it. Adding a dataset or state means changing the registry first, then the schemas, templates, checks, UI, the MCP tools and tests, in that order.

## Where to read next

* [Datasets](/concepts/datasets.md) for what lives in the data directory.
* [Routes and API](/concepts/routes-and-api.md) for the pages and endpoints.
* [Runtime modes](/concepts/runtime-modes.md) for the data directory, dev versus built behaviour and the per-request read path.
* [MCP](/concepts/mcp.md) for the embedded MCP server.
* [Editing](/concepts/editing.md) for the in-browser editors and the Save model.
* [Context inflate](/concepts/context-inflate.md) for the recipe pipeline under `src/lib/inflate/`.
