---
type: Runtime Behavior
title: Runtime modes
description: How the dev server and a built server treat data differently, and why contexts are read from disk at runtime.
tags: [runtime, astro, content-layer]
sources:
  - id: plan-a2
    resource: plans/PLAN.md
    title: PLAN.md section A.2, Astro 7.4.0 runtime-mode facts
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:00:00Z
stale_after: 2027-04-01
---

# Runtime modes

Content collections behave differently depending on how ctxman is started. These facts were verified against Astro 7.4.0 on Node 24.

## Dev server (`pnpm run dev`)

This is the primary way to run ctxman. The glob loaders watch the data folders and reload entries when files are added, changed or removed. Every content-layer reload makes the browser do a full page reload shortly afterwards.[^plan-a2]

Consequences:

* Writing a `kb/*/main.md` triggers one reload; the add scripts for bundles, skills and references do the same, so the tools page stores its last run in `sessionStorage` and restores it.
* Contexts are written by the forge at runtime. Using a watching loader for them would reload the page after every save, so `context` uses a custom loader with no file watcher.

## Built server (`pnpm run build`, then `pnpm run start`)

Collections are a snapshot taken at build time. An entry added later is invisible to `getCollection` until the next build. Rebuild after adding entries when running this way.

## Rules that follow

1. Contexts are always read at runtime through `src/lib/context-io.ts` (filesystem plus zod). Never call `getCollection('context')` in a page or API route; that collection exists only so `astro sync` and `astro build` validate the files.
2. Freshness (last modified) is computed from the filesystem at request time, never from the collection snapshot.
3. The search index is recomputed per request, which is cheap at local scale.

## Agents and the dev server

Astro 7 starts `astro dev` in the background when it detects an AI agent, and tracks one server per project. To run a foreground, untracked server, pass `--ignore-lock` (for example `pnpm exec astro dev --port 4330 --ignore-lock`) and stop it when done.

The full story of the reload problem is in the analysis [astro-dev-full-reload-on-save](ctxman:rca/astro-dev-full-reload-on-save). Background on collections is in [astro-content-layer](ctxman:kb/astro-content-layer). Back to the [overview](/main.md) or on to [Context forge](/concepts/context-forge.md).

[^plan-a2]: PLAN.md section A.2, runtime-mode facts, verified on Astro 7.4.0 with Node 24.18.
