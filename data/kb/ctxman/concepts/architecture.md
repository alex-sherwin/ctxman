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
| Data | Astro content collections, validated by zod 4 schemas (zod is the only runtime validator; arktype models only generate the JSON Schemas in `schemas/`) |
| Search | fuse.js over an index built server-side |
| Scripts | TypeScript executed directly by Node 24 (erasable syntax only, `.ts` extensions in imports) |
| Tooling | TypeScript 7.1 nightly `tsc`, oxlint, oxfmt, vitest, playwright, pnpm |

There are exactly nine React islands, all `client:only="react"`: the search widget (every page), the context forge, the [Context inflate](/concepts/context-inflate.md) tool, the tools runner, the DocEditor (okf and skill detail and sub-doc pages), MarkdownTargets (the markdown popups of context and recipe pages), DataForm (the reference, context and recipe forms), EntryTools (the dialogs behind the buttons of an entry page: Details, relations, Add to context, Build context, New concept) and NewEntryForm (the okf and skill create form). The forge and inflate bundle Monaco; the others load it lazily or not at all, so a detail page does not fetch the editor until it is needed. Everything else is server-rendered Astro with a little vanilla script, such as the Open in IDE button, the state select and the whole-row links (a CSS stretched-link pattern, no click handlers). See [Editing](/concepts/editing.md) and [Relations](/concepts/relations.md).

## Repository layout

```text
data/        all datasets (see datasets concept)
schemas/     generated JSON Schemas of reference, context and recipe (committed; not linted or formatted)
scripts/     add-entry.ts, the check scripts, gen-schemas.ts and fix-yaml-comments.ts, run by node
out/         default output folder of Context inflate (gitignored, not linted or formatted)
src/
  content.config.ts      one collection per dataset, plus a docs collection
  datasets/registry.ts   single source of truth for dataset ids, states and labels
  datasets/schemas.ts    zod schemas for every dataset
  datasets/arktypes.ts   arktype mirror of the three yaml datasets, used only to generate schemas/
  lib/                   shared TypeScript modules (lib/inflate/ holds the Context inflate pipeline, lib/forms/ the form fields and rules)
  pages/                 routes and API endpoints
  layouts/, components/  Astro layout and server-rendered components
  ui/, stores/           React islands (ui/markdown, ui/forms, ui/entry, ...), kit, entry pickers (ui/pickers), shared editing pieces (ui/edit), Monaco wrappers (ui/editor), nanostores
  styles/                global.css (the only stylesheet entry), tokens, app and prose CSS
tests/unit/  vitest
tests/e2e/   playwright
plans/       historical build specs, not maintained; the code and AGENTS.md win
```

## Layering of `src/lib`

Every module is one of four kinds, named in its header comment, and the kind decides who may import it:

* **Pure**: no filesystem, no `astro:*` imports. Safe in browser islands, scripts and tests.
* **Node**: may use `node:fs` and `node:path`, never `astro:*`. Safe in scripts, tests and server code.
* **Server**: no `astro:*` imports, but only server code uses it (`http.ts`, `run-script.ts`, `markdown.ts`). Tests may import it; scripts do not.
* **Server-Astro**: imports `astro:content` (`entries.ts`). Only pages and API routes may use it; scripts and tests never do.

`src/lib/inflate/` follows the same rules. The catalog (targets, modes, materials, options), the recipe parser and serializer, the expander and the material planner (`material-plan.ts`: the ordered steps of a working-directory run, plus every type that crosses the API) are pure, so the Inflate island imports them for instant feedback; its only other imports from that folder are erased `import type`s of the renderer's result. The markdown helpers, the renderer and the pipeline are Node-kind modules without filesystem calls of their own (they read through an injected `InflateSources` and import the OKF and link helpers). The modules that touch the disk are `fs-sources.ts`, `write.ts`, `output-dir.ts` (directory safety checks, inspection and the manifest file), `material-exec.ts` (the step executor, with process spawning injected) and `dir-plan.ts` (the dry run and run preparation), next to `src/lib/recipe-io.ts`. Two modules are Server kind because they run child processes or hold state: `src/lib/proc.ts` (`spawnCapture`) and `jobs.ts` (the in-memory job store); `dir-plan.ts` imports `proc.ts`, so scripts and islands never import it. Those Node and Server files must never be imported by an island. There is no barrel file in that folder.

The editing support follows the same rules. Pure and browser-safe: `reference-yaml.ts` (the deterministic reference serializer), `schema-comment.ts` (the yaml-language-server comment), `yaml-doc.ts` (YAML text to a validated document with source positions), `names.ts`, `reorder.ts` and `lib/forms/*`. Node with fs: `doc-io.ts` (read and save one existing markdown file), `reference-io.ts` (like `context-io.ts` and `recipe-io.ts`) and `schema-check.ts`; `skill-check.ts` is Node without fs calls so the compliance check and the doc editor report the same findings. `ide.ts` is a Server module because it spawns the IDE command. `json-schema.ts` and `datasets/arktypes.ts` are used by scripts and tests only.

The relations and write layer adds: Pure `relations.ts` (the graph), `frontmatter-patch.ts` (range-based YAML key edits) and `link-insert.ts` (completion text, shared with the picker); Node with fs `entry-index.ts` (the cached scan every okf and skill list, summary and relation reads from), `entry-io.ts` (the frontmatter GET and PATCH and the entry create), `entry-create.ts` (the write-and-rollback extracted from the add script, so the script and the API write identical files) and `atomic-write.ts` (the atomic text write and the per-file lock every writer shares). `doc-io.ts` also creates concepts. Reads never go through `getCollection` for those two kinds (see [Runtime modes](/concepts/runtime-modes.md)); `entries.ts` stays the only Server-Astro module.

Browser-only code lives in `src/ui` and `src/stores`. The Monaco wrapper in `src/ui/editor` touches `self` when loaded, so only `client:only` islands may import it. `src/ui/edit` holds the pieces every editor shares (save bar, conflict dialog, draft backup, the remembered "Saved") and imports no Monaco; the lazy-Monaco islands and the search island import kit parts by file, never through the kit barrel, which pulls Monaco in. The kit (react-aria-components wrappers) provides a searchable Select, an `OrderedList` with drag and drop, a Table, Icon and a Disclosure with a one-line preview.

`src/datasets/schemas.ts` imports plain `zod` (not `astro:content`) precisely so Node scripts can validate files with the same schemas Astro uses.

## Two validators, one source of truth each

zod (`src/datasets/schemas.ts`) validates everything at runtime, in Astro, the scripts and the browser forms. The arktype models in `src/datasets/arktypes.ts` mirror the three yaml schemas and exist only to generate `schemas/*.schema.json`, which the IDEs and the browser YAML editors (monaco-yaml) read; a parity test keeps the two in step and arktype is a dev dependency never imported by pages, API routes or islands. monaco-yaml needs three shims with the current Monaco (a worker-creation adapter, a Vite alias and optimizeDeps entries); the details are in AGENTS.md.

## One registry, everything derived

`src/datasets/registry.ts` lists the dataset ids, labels, lifecycle states and the OKF type string for each dataset. Navigation, filters, the add scripts and the checks all read it. Adding a dataset or state means changing the registry first, then the schemas, collections, templates, checks, UI and tests, in that order.

## Where to read next

* [Datasets](/concepts/datasets.md) for what lives under `data/`.
* [Routes and API](/concepts/routes-and-api.md) for the pages and endpoints.
* [Runtime modes](/concepts/runtime-modes.md) for dev versus built behaviour.
* [Editing](/concepts/editing.md) for the in-browser editors and the Save model.
* [Context inflate](/concepts/context-inflate.md) for the recipe pipeline under `src/lib/inflate/`.
