---
type: Feature
name: context-forge
title: Context forge
description: A UI at /forge to discover entries across datasets and link them into reusable contexts with per-link markdown notes.
state: in-progress
tags: [context, forge, ui]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T11:50:00Z
---

# Context forge

## Motivation

The context is the main vessel for giving an agent session what it needs. Contexts must be easy to build from everything in the repository, and must stay evergreen: they point at entries, they never copy them. How contexts work is documented in [ctxman](ctxman:kb/ctxman).

## Requirements

* Discover entries from the nine linkable datasets with tabs per dataset, a text filter, state chips and tag chips, using the same filter semantics as the list pages.
* Create, select, edit and delete contexts; the name is the file stem and cannot be changed after creation.
* Add a link from a discovery row, remove it, and reorder links by dragging the grip handle (mouse or keyboard) or with the up and down buttons.
* Show the entry count on every Discover tab as soon as the page loads.
* Attach optional markdown notes to each link, edited in the Monaco editor, with the purpose of narrowing scope or explaining intended use.
* Edit the description and tags.
* Offer a raw YAML mode for the whole document, validated with the same schema as the server before saving, with live schema diagnostics from the generated JSON Schema.
* Save with a button or Cmd/Ctrl+S; guard unsaved changes when switching contexts, navigating Back or closing the tab.
* Show links to entries that no longer exist as missing instead of failing.

## Design

* One React island on `/forge`, state in nanostores, page state in URL parameters: `context`, `dataset`, `q`, repeatable `state` and `tag`.
* Left pane lists discovery results from `GET /api/entries?dataset=<id>`; right pane edits the working copy of the selected context.
* Saves go to `PUT /api/context/<slug>`; creation to `POST /api/context`. Writes are atomic (temporary file, then rename).
* Contexts are read through the filesystem, not the content collection, to avoid a dev full reload on every save; see [astro-dev-full-reload-on-save](ctxman:rca/astro-dev-full-reload-on-save).

## Acceptance criteria

- [x] Contexts can be created and listed.
- [x] Discovery filters match the list-page filters.
- [x] Notes are stored as literal blocks and rendered as markdown on the context page.
- [x] Raw YAML mode blocks saving while the document is invalid.
- [x] Keyboard-only reordering keeps focus (fixed bug: [forge-reorder-focus](ctxman:bug/forge-reorder-focus)).
- [x] Links reorder by drag and drop with mouse and keyboard, and every Discover tab shows its count on load.
- [ ] End-to-end coverage of the whole workflow (task: [forge-e2e-coverage](ctxman:task/forge-e2e-coverage)).

Consumers: the Context Inflate tool (`/inflate`, see [context-inflate](ctxman:idea/context-inflate)) reads what this feature produces. Search is a separate feature: [global-search](ctxman:feature/global-search).
