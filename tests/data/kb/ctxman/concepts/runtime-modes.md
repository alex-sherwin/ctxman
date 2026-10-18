---
type: Runtime Behavior
title: Runtime modes
description: The data directory and environment, how data is read from disk on every request, and what still differs between the dev server and a built server.
tags: [runtime, astro, data-dir, environment]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-18T09:00:00Z
stale_after: 2027-04-01
---

# Runtime modes

ctxman has no content layer. Every dataset is read straight from the filesystem on every request, so the dev server and a built server behave the same for data. These facts were verified against Astro 7.4.0 on Node 24.

## The data directory

`CTXMAN_DATA_DIR` is required: the directory that holds `kb/`, `task/`, `reference/`, `context/` and the other dataset folders. There is no default and the repository does not contain your data. Set it in the shell or in a `.env` file at the repo root (see `.env.example`); the `dev`, `start`, `preview`, `add:*`, `check*` and `fix:yaml-comments` scripts run `node --env-file-if-exists=.env`, so the file is honoured without any tooling. `pnpm run build`, `typecheck`, lint, format and the tests need no data directory. To try ctxman on the committed sample corpus, point the variable at `tests/data` (note that edits then change committed files); use a copy to experiment.

`CTXMAN_SERVER_ORIGIN` (optional, default `http://127.0.0.1:4321`) is the origin written into the `# yaml-language-server` line of YAML data files, see [Datasets](/concepts/datasets.md).

When the variable is unset, or names a missing path or a file, the scripts print the problem and exit with code 2, and the server answers 503 from its middleware: JSON `{ "error": "data-dir", "message": ... }` for `/api/*` and `/mcp*`, a small instructions page for everything else. The status is re-checked every two seconds. The environment is read when the process starts, so a changed variable needs a restart, while creating the missing directory is picked up without one.

## Dev server (`pnpm run dev`)

This is the primary way to run ctxman. Vite hot-reloads CODE changes. Nothing watches the data directory: there is no file watcher on data and therefore no reload when a file under it changes. What you do see:

* Edits made in your IDE, by a script or by an agent (through [MCP](/concepts/mcp.md)) appear on the next page load. The UI does not push them; press reload.
* After a write made in the browser (a markdown save, the state select, the Details dialog, relations, Add to context, creating an entry) the page reloads itself about 150 ms later, so you see the new state at once. See [Editing](/concepts/editing.md).
* The e2e suite runs the built server (one per Playwright worker), so dev-only behaviour (Vite's first-connection reload, HMR) never reaches a test.
* Generated documents written to `out/` and Inflate working directories are outside any watched folder anyway; a working directory must be outside the repository and the data directory.
* The Inflate job store lives in server memory (on `globalThis`). A restart of the server forgets every job; the Run view then says the run is no longer known, while the files the run wrote stay on disk.

Astro 7 starts `astro dev` in the background when it detects an AI agent, and tracks one server per project. To run a foreground, untracked server, pass `--ignore-lock` (for example `CTXMAN_DATA_DIR=... pnpm exec astro dev --port 4330 --ignore-lock`) and stop it when done.

## Built server (`pnpm run build`, then `pnpm run start`)

`astro build` needs no data directory and bakes none in. `pnpm run start` runs `dist/server/entry.mjs` against the directory named by `CTXMAN_DATA_DIR` and reads it per request exactly like dev, so a built server is always current: a new entry, a saved document or a created reference is visible on the next request, and the search index includes it. Rebuild only after changing code.

`security.allowedDomains` in `astro.config.ts` (127.0.0.1 and localhost) makes the node server trust the `Host` header; without it Astro rebuilds `Request.url` as `http://localhost:<port>` and the Origin check of mutating routes refused a browser at `http://127.0.0.1:4321` (saving failed with `cross-origin request ... is not allowed`). The check itself also treats the loopback hostnames as one class. `pnpm run test:prod` starts the built server against a temp copy of the sample corpus and guards this.

## The read path

Every request is computed from the disk:

* **okf and skill entries** (lists, summaries, frontmatter, bodies, the relation graph, invalid-file reporting) come from the entry index, `src/lib/entry-index.ts` ([Relations](/concepts/relations.md) describes it): one scan, cached per entry folder by file `(mtimeMs, size)`, with a 200 ms memo that every write clears. A PATCH, a state change or a create is visible on the very next request, and a file with invalid frontmatter is listed with its issues instead of disappearing.
* **Bodies** are rendered per request by `src/lib/markdown.ts` with Sätteri (the processor Astro uses for markdown), then the `ctxman:` links are rewritten. Results are memoized by the SHA-1 of the source (256 entries), so unchanged text is rendered once.
* **References, contexts and recipes** are read through `reference-io.ts`, `context-io.ts` and `recipe-io.ts` (filesystem plus arktype). `listReferences` reports invalid files, which lists and the dashboard flag; the detail page of an invalid reference is a 404 until it is fixed.
* **Freshness** (last modified) is the newest file mtime in the entry folder; a `stale_after` date that has passed marks the entry stale.
* **The search index** is rebuilt per request by walking the bundle folders on disk, see [Search](/concepts/search.md).
* **Context inflate** reads the linked entries from the filesystem when it generates a document, so its output is always current.

## Rules that follow

1. Read data only through the library modules (`entries.ts`, `entry-index.ts`, the three io modules); they take the directory from `resolveDataDir()`. Never call it at module top level.
2. Do not add a content layer, loader or file watcher for data; both modes must stay identical.
3. Writes are atomic (a temp file in the same folder, then rename) and clear the entry index memo.

The history of the problems this design removed (a watching content layer that reloaded the page after every write, a build snapshot that went stale, a one-second lag before a written file was visible) is in the analysis [astro-dev-full-reload-on-save](ctxman:rca/astro-dev-full-reload-on-save) and the background note [astro-content-layer](ctxman:kb/astro-content-layer). Back to the [overview](/index.md) or on to [Context forge](/concepts/context-forge.md).
