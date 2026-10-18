---
okf_version: "0.2"
type: Feature
name: global-search
title: Global search
description: A full-screen fuzzy search over every dataset, indexing all bundle markdown and the fields of data records.
state: complete
tags: [search, ui, fuse]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:55:00Z
---

# Global search

## Motivation

With ten datasets and many files per bundle, browsing is slow. A single search box that reaches everything, and can be narrowed to some datasets, is the fastest way to find an entry or a passage.

## Requirements

* Index all markdown in the OKF bundles (entries and concepts), the body of each skill, and the fields of reference and context records.
* Fuzzy matching with fuse.js; results grouped by dataset with highlighted snippets.
* Filter chips to restrict the search to chosen datasets.
* A custom full-screen widget built from accessible components, openable from any page with Cmd/Ctrl+K or `/`.
* Deep-linkable: open state, query and dataset filter live in the URL.

## Design

* Index served by `GET /api/search-index.json`, one document per file or record; matching runs in the browser.
* URL parameters `search=1`, `sq` and `in`. The query parameter is deliberately not `q`; see the fixed bug [search-q-param-collision](ctxman:bug/search-q-param-collision).
* History: opening pushes one entry, typing replaces, closing goes Back, so the browser Back button returns to an open search.
* Details of ranking weights and parameters are in the knowledge base entry [ctxman](ctxman:kb/ctxman).

## Acceptance criteria

- [x] Every dataset appears in results and in the chips.
- [x] A search can be shared as a URL and reopens pre-filled.
- [x] Esc clears the query, then closes the widget; focus returns to the opener.
- [x] Keyboard-only use works end to end.

Sibling feature: [context-forge](ctxman:feature/context-forge).
