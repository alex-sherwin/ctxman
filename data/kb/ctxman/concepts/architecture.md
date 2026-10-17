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
| Editing | Monaco for every multi-line markdown, JSON or YAML input; plain text fields for single-line values |
| State | nanostores with @nanostores/react; the URL carries all page state so deep links and back/forward work |
| Data | Astro content collections, validated by zod 4 schemas |
| Search | fuse.js over an index built server-side |
| Scripts | TypeScript executed directly by Node 24 (erasable syntax only, `.ts` extensions in imports) |
| Tooling | TypeScript 7.1 nightly `tsc`, oxlint, oxfmt, vitest, playwright, pnpm |

There are exactly three React islands, all `client:only="react"`: the search widget, the context forge and the tools runner. Everything else is server-rendered Astro with a little vanilla script.

## Repository layout

```text
data/        all datasets (see datasets concept)
scripts/     add-entry.ts and the check scripts, run by node
src/
  content.config.ts      one collection per dataset, plus a docs collection
  datasets/registry.ts   single source of truth for dataset ids, states and labels
  datasets/schemas.ts    zod schemas for every dataset
  lib/                   shared TypeScript modules
  pages/                 routes and API endpoints
  layouts/, components/  Astro layout and server-rendered components
  ui/, stores/           React islands, kit, Monaco editor wrapper, nanostores
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

Browser-only code lives in `src/ui` and `src/stores`. The Monaco wrapper in `src/ui/editor` touches `self` when loaded, so only `client:only` islands may import it.

`src/datasets/schemas.ts` imports plain `zod` (not `astro:content`) precisely so Node scripts can validate files with the same schemas Astro uses.

## One registry, everything derived

`src/datasets/registry.ts` lists the dataset ids, labels, lifecycle states and the OKF type string for each dataset. Navigation, filters, the add scripts and the checks all read it. Adding a dataset or state means changing the registry first, then the schemas, collections, templates, checks, UI and tests, in that order.

## Where to read next

* [Datasets](/concepts/datasets.md) for what lives under `data/`.
* [Routes and API](/concepts/routes-and-api.md) for the pages and endpoints.
* [Runtime modes](/concepts/runtime-modes.md) for dev versus built behaviour.
