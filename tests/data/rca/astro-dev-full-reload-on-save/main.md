---
type: Root Cause Analysis
name: astro-dev-full-reload-on-save
title: Astro dev full reload on save
description: Saving a context in the forge reloaded the whole page, because glob loaders in astro dev trigger a browser full reload on any data change.
tags: [astro, dev-server, content-layer, forge]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:40:00Z
---

# Astro dev full reload on save

Saving a context in the forge wrote `data/context/<name>.yaml`, and about 0.7 seconds later the browser reloaded the entire page. The cause was Astro's content layer watching the data folder; the fix was a context loader with no file watcher.

## Summary

* **Impact**: Every forge save discarded transient UI state (scroll position, open notes panels, focus) and flashed the page. Editing felt unreliable.
* **Scope**: `astro dev` only. A built server reads a snapshot and never reloads.
* **Resolution**: `context` uses a custom collection loader without a watcher; runtime reads and writes go through `src/lib/context-io.ts`.

## Timeline

1. While planning the forge, the content collections were verified in a scratch project (2026-10-17).
2. Writing a context file under a glob-loaded folder produced a browser full reload shortly after the write.
3. The same write into a folder served by the watcher-less custom loader produced no reload.
4. `src/content.config.ts` was changed to use the custom loader for `context`, with a comment forbidding runtime `getCollection('context')`.

## Root cause

In `astro dev`, each `glob` loader registers a watcher on its base directory. On an add, change or unlink it re-runs the loader and updates the data store, and every content-layer reload makes Vite send a full-reload message to connected browsers. The forge is the one place where ctxman writes collection files while a page is open, so it hit this on every save.

Contributing factor: the contexts collection was first modelled exactly like the other datasets, which is the natural choice and the wrong one for data that the UI itself mutates.

## Resolution

* A small loader in `src/content.config.ts` reads `context/*.yaml` once at startup, validates each file with the context schema and stores it, with no watcher.
* Pages and API routes never use that collection. They call `context-io` (filesystem plus zod), so a context saved a moment ago is visible immediately, in dev and in a built server alike.
* The collection still exists so `astro sync` and `astro build` reject invalid context files.

Details of the measurement are in [Verification](./concepts/verification.md).

## Prevention

* Rule: never call `getCollection('context')` outside validation tooling. It is documented in [runtime modes](ctxman:kb/ctxman) and in the agent guide.
* Any new dataset that the UI writes at runtime must follow the same pattern: no watcher, runtime reads from the filesystem.
* Residual effect: the add script for bundles, skills and references still causes one reload. The tools page saves its last run to `sessionStorage` and restores it, so the output survives.
* Background on loaders: [astro-content-layer](ctxman:kb/astro-content-layer).
