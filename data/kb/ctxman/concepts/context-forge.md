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

A **context** is the unit ctxman hands to an agentic coding session. It is a small YAML file under `data/context/` that lists links to entries in the other datasets. The forge at `/forge` is the UI for building them. The feature record is [context-forge](ctxman:feature/context-forge).

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
2. In the Discover pane, switch dataset tabs, filter by text, state and tag, and press Add on a row. Rows already in the context show as added.
3. In the Context pane, reorder links with the up and down buttons and open "Notes for the agent" to write markdown guidance in the notes editor.
4. Use the raw YAML mode to edit the whole document; it validates against the same schema before saving.
5. Save with the button or Cmd/Ctrl+S. Unsaved changes are guarded when you switch contexts or leave the page.

URL parameters keep the state deep-linkable: `context`, `dataset`, `q`, repeatable `state` and `tag`. See [Routes and API](/concepts/routes-and-api.md).

## How notes are used

Notes render as markdown on the context's page. Keep them short: one to three lines saying what to look for in the linked item. Good notes name the relevant section, say what to ignore, or explain why the item is in the context.

## Related

* [Datasets](/concepts/datasets.md) defines every linkable dataset.
* [Search](./search.md) is separate from the forge; the forge discovers entries through its own filtered lists.
* The overview is in [ctxman](/main.md).
* Consuming several contexts at once (the planned context inflate tool) is not built; see [context-inflate](ctxman:idea/context-inflate).
