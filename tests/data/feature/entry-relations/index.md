---
okf_version: "0.2"
type: Feature
name: entry-relations
title: Entry relations
description: Structured links between entries (child, related, depends-on) with the panels, pickers, APIs and forms that manage them in the UI.
state: complete
tags: [ctxman, relations, ui]
generated:
  by: process:ctxman-add-entry
  at: 2026-10-18T07:39:43.225Z
---

# Entry relations

Structured links between entries (child, related, depends-on) with the panels, pickers, APIs and forms that manage them in the UI. The model, panels and rules are documented in the concept `concepts/relations.md` of the knowledge base [ctxman](ctxman:kb/ctxman); this record tracks what shipped. It came out of the UX review of link data (round 3).

## Motivation

Before this feature a project could only mention its tasks in prose, a task could not say what it depends on, and every link had to be typed by hand as `ctxman:<dataset>/<slug>`. The relationship between entries was data that the UI could neither show nor edit, and a broken link was only noticed by `pnpm run check`.

## Requirements

* An okf entry declares typed relations in its entry `index.md` frontmatter: `links: [{dataset, slug, rel}]` with `rel` child, related or depends-on. The project owns its children. Body `ctxman:` links stay valid prose and count as mentions.
* Every detail page shows what an entry links to and what links to it (inverse labels Parent, Required by, Mentioned by); a project page has a Children panel with progress, add and remove, and links to create a new child.
* Relations are edited in the UI without touching the rest of the file: a frontmatter PATCH API splices only the given keys, and a state select changes the lifecycle state from lists and detail headers.
* Editors help to write links: completion after `ctxman:`, `](` and `[[`, an Insert link picker (Mod+Alt+K), an Add to context button on every entry, and Build context from a project.
* Create forms exist for every dataset (`/new/<ds>`, with `?parent=`), concepts can be created from the Files panel, and invalid files are listed instead of silently ignored.
* Unsaved editor text survives a reload (localStorage drafts) without a native prompt.
* The Forge and Inflate offer an All tab and add a project together with its children; Inflate briefs include the main body by default and print descriptions.

## Design

* Data model: `links` in the okf entry `index.md` frontmatter, validated by `entryLinksSchema` (one link per target, no self link); skills have mentions only. Check rules `links/relation-target` (warning) and `links/relation-self` (error).
* Read path: the entry index (`src/lib/entry-index.ts`, cached per file by mtime and size) feeds lists, details and the pure relation graph (`src/lib/relations.ts`). Collections keep rendering HTML and the search index; loaders and watchers are unchanged.
* Write path: `GET|PATCH /api/entry/<ds>/<slug>` (range-based frontmatter splicing, schema-checked, `ifUnmodifiedSince`), `POST /api/entry/<ds>` (create, optional `parent`), `POST /api/doc/...` (create a concept and update the entry's `## Concepts` section and `log.md`), `POST /api/context/<slug>/links`.
* UI: the EntryTools and NewEntryForm islands, SSR panels and the state select, the EntryPicker, Monaco link completion, drafts.

## Acceptance criteria

- [x] A task, feature, bug or idea can be made a child of a project from the project page, from the task's create form (`?parent=`) or through the API, and the project lists it with a progress count.
- [x] A relation (related, depends-on, child) can be added and removed from either page, and both pages show it with the right label.
- [x] The state of an entry changes from a list row or the detail header without opening an editor, and the file keeps its comments, unknown keys and body.
- [x] A PATCH that would make the frontmatter invalid is refused and writes nothing; a conflict is reported as 409.
- [x] Typing `ctxman:`, `](` or `[[` in a markdown editor offers entries; Insert link inserts `[title](ctxman:<ds>/<slug>)`.
- [x] Add to context works from every entry page (existing or new context); Build context from a project opens the Forge with the project and its children.
- [x] `/new/<ds>` creates an entry of every dataset; a created concept is listed in `index.md` and `log.md`.
- [x] Invalid files show a badge in lists, on the dashboard and a banner on their page.
- [x] A reload with unsaved editor text restores it with a banner; no native unload prompt appears except in the reference, context and recipe forms and the create forms.
- [x] Broken links are reported as warnings on save and drawn dashed in the preview.
- [x] Every case above is covered by unit tests and Playwright specs (`entry-tools`, `relations`, `api-entry`, `list-filters`, `forms`, `forge`, `doc-edit`).

Related work: the project [ctxman-v1](ctxman:project/ctxman-v1) owns this feature as a child; the earlier [context-forge](ctxman:feature/context-forge) feature gained the All tab and add-with-children.
