---
type: Workflow
title: Context forge
description: How contexts work and how to build one in the forge UI at /forge.
tags: [context, forge, workflow]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:45:00Z
---

# Context forge

A **context** is the unit ctxman hands to an agentic coding session. It is a small YAML file under `context/` in the data directory that lists links to entries in the other datasets. The forge at `/forge` is the UI for building them. The feature record is [context-forge](ctxman:feature/context-forge).

## Context file shape

```yaml
name: ctxman-dev
description: Everything needed to work on ctxman itself.
tags: [ctxman]
links:
  - dataset: kb
    slug: ctxman
    notes: |
      Start with the architecture and datasets concepts.
  - dataset: task
    slug: write-agents-md
```

Rules enforced by the schema:

* `dataset` is one of `kb`, `rca`, `idea`, `task`, `bug`, `feature`, `skill`, `reference`, `project`. A context cannot link to another context.
* `slug` is the target entry name. The same dataset and slug pair may appear only once.
* `notes` is optional markdown that narrows scope or explains how this item should be used in this particular context.
* `name` is the file stem and cannot be changed after creation.

## Evergreen pointers

A context never vendors content. It stores `dataset` and `slug` only, so editing the linked entry later changes what the context delivers. If a target is removed, the check scripts report a dangling link as a warning and the forge shows the row as missing.

## Building a context

1. Open `/forge`. Pick an existing context from the selector or choose "New context" and give it a kebab-case name and a description.
2. In the Discover pane, switch dataset tabs, filter by text, state and tag, and press Add on a row. Rows already in the context show as added. Every tab shows its entry count (a dimmed ellipsis while it loads). The **All** tab comes first and lists entries of every linkable dataset together (a dataset badge on each row, tag chips over the merge, no state chips); `dataset=all` is URL state like any other tab. A row whose entry has children (a project) also offers **+ Add with N children**: it adds the entry and then its children in file order, skipping links the context already has, and N counts only the children still missing. An entry whose file is invalid is listed, marked and dimmed instead of vanishing.
3. In the Context pane, reorder links by dragging the grip in the first column (mouse, or keyboard: focus the handle, Enter, Up or Down, Enter to drop, Esc to cancel) or with the up and down buttons, and open "Notes for the agent" to write markdown guidance in the notes editor. After a button move the focus stays on the moved row.
4. Use the raw YAML mode to edit the whole document; it validates against the same schema before saving, and the editor underlines schema problems (unknown keys, wrong types, a bad `dataset`) as you type, with hover text and completion, using the generated `schemas/context.schema.json`.
5. Save with the button or Cmd/Ctrl+S. Unsaved changes are kept as a draft in `localStorage` (14 days): after a reload or a closed tab the forge restores the working copy with a "Restored unsaved changes" banner and a Discard button, and warns when the context changed on disk meanwhile (saving then overwrites it). There is no native leave prompt; switching contexts still asks first. A new, never-saved context is not persisted.

A context also grows from other pages: **Add to context** on any okf, skill or reference page appends that entry (`POST /api/context/<slug>/links`), and **Build context** on a project page creates a context from the project and its children and opens it here. See [Relations](/concepts/relations.md).

A context can also be created or edited without the forge: `/new/context` and `/context/<slug>?edit=1` open the same fields as a form, and the pencil buttons on a context page edit one link's notes in a popup. See [Editing](/concepts/editing.md).

URL parameters keep the state deep-linkable: `context`, `dataset` (a linkable dataset or `all`), `q`, repeatable `state` and `tag`. See [Routes and API](/concepts/routes-and-api.md).

## How notes are used

Notes render as markdown on the context's page. Keep them short: one to three lines saying what to look for in the linked item. Good notes name the relevant section, say what to ignore, or explain why the item is in the context.

## Related

* [Datasets](/concepts/datasets.md) defines every linkable dataset.
* [Search](./search.md) is separate from the forge; the forge discovers entries through its own filtered lists.
* The overview is in [ctxman](/index.md).
* To hand several contexts to an agent session at once, use [Context inflate](/concepts/context-inflate.md), which expands contexts into one document. Origin: the idea [context-inflate](ctxman:idea/context-inflate).
