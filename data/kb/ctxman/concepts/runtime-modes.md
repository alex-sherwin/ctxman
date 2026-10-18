---
type: Runtime Behavior
title: Runtime modes
description: How the dev server and a built server treat data differently, and why contexts and recipes are read from disk at runtime.
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

* Saving a markdown file from the browser (`PUT /api/doc/...`) is a write under a watched folder, so it triggers the reload too; the editor returns to the preview, keeps "Saved" across the reload and reloads once more if the content layer had not caught up (see [Editing](/concepts/editing.md)). Writing a reference through the API behaves the same, and server-rendered pages see it about 0.6 s later.
* Writing a `kb/*/main.md` triggers one reload; the add scripts for bundles, skills and references do the same, so the tools page stores its last run in `sessionStorage` and restores it.
* Contexts are written by the forge at runtime, and recipes by the [Inflate](/concepts/context-inflate.md) tool. Using a watching loader for them would reload the page after every save, so `context` and `recipe` share one custom YAML loader (`yamlDirLoader`) with no file watcher.
* Generated documents written to `out/` do not reload the browser; that folder is outside the watched data folders and is gitignored.

## Built server (`pnpm run build`, then `pnpm run start`)

Collections are a snapshot taken at build time. An entry added later is invisible to `getCollection` until the next build. Rebuild after adding entries when running this way. A document or reference saved through the API is on disk at once, but a built server keeps showing the snapshot until the next build. Contexts, recipes and generated inflate documents are unaffected, because they are read from the filesystem at request time.

## Rules that follow

1. Contexts are always read at runtime through `src/lib/context-io.ts` and recipes through `src/lib/recipe-io.ts` (filesystem plus zod). Never call `getCollection('context')` or `getCollection('recipe')` in a page or API route; those collections exist only so `astro sync` and `astro build` validate the files. Context inflate also reads the linked entries from the filesystem when it generates a document, so its output is always current, even on a built server.
2. Freshness (last modified) is computed from the filesystem at request time, never from the collection snapshot.
3. The search index is recomputed per request, which is cheap at local scale.

## Agents and the dev server

Astro 7 starts `astro dev` in the background when it detects an AI agent, and tracks one server per project. To run a foreground, untracked server, pass `--ignore-lock` (for example `pnpm exec astro dev --port 4330 --ignore-lock`) and stop it when done.

The full story of the reload problem is in the analysis [astro-dev-full-reload-on-save](ctxman:rca/astro-dev-full-reload-on-save). Background on collections is in [astro-content-layer](ctxman:kb/astro-content-layer). Back to the [overview](/main.md) or on to [Context forge](/concepts/context-forge.md).

[^plan-a2]: PLAN.md section A.2, runtime-mode facts, verified on Astro 7.4.0 with Node 24.18.
