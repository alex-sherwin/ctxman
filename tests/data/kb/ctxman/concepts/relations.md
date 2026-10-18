---
type: Concept
title: Relations between entries
description: The typed links of an okf entry (child, related, depends-on), the project-owns-children model, mentions, the entry index behind them and the panels, pickers and APIs that manage them in the UI.
tags: [relations, links, projects, entry-index, ui]
---

# Relations between entries

Entries used to know about each other only through prose links. A **relation** is structured data: an okf entry (kb, rca, idea, task, bug, feature, project) lists the entries it relates to in the `links` key of its entry `index.md` frontmatter, and the UI reads and edits that list. The feature record is [entry-relations](ctxman:feature/entry-relations); the project that owns it is [ctxman-v1](ctxman:project/ctxman-v1), which is also the best example of the model.

## The `links` field

```yaml
links:
  - dataset: task
    slug: write-agents-md
    rel: child
  - dataset: kb
    slug: ctxman
    rel: related
```

* `dataset` is any linkable dataset (everything except `context` and `recipe`), `slug` the target entry name.
* `rel` is one of three kinds. A hand-written item without `rel` counts as `related`; ctxman always writes it.
* One link per target (a duplicate is a schema error), and an entry cannot link to itself.
* Skills have no `links` key (their frontmatter is strict); they only take part through mentions. Context and recipe files keep their own `links` shape and are not part of this graph (a context shows up in the "Linked from contexts" panel instead).
* ctxman writes the canonical block style with the keys in the order `dataset`, `slug`, `rel`. Unknown frontmatter keys, comments and the body are never touched by those writes.

| `rel` | Meaning (from the entry that declares it) | The target's page calls it |
| --- | --- | --- |
| `child` | This entry contains the target | Parent |
| `related` | Symmetric association | Related |
| `depends-on` | This entry needs the target first | Required by |

Cycles are not checked. A body link is a **mention**: any `ctxman:<dataset>/<slug>` link in a markdown file of the entry's folder (code is ignored, self links are skipped) is an edge too, shown as "Mentions" on the source and "Mentioned by" on the target. A target that already has a frontmatter link from the same entry gets no extra mention row.

## The project owns its children

A project lists its tasks, features, bugs and ideas as `rel: child` links in its own `index.md`; the child does not point back. One file therefore holds the ordered child set, and the Children panel edits only that file. The data model allows `child` on any okf entry, but the UI offers the panel on project pages only.

* A child page shows a "Part of &lt;project&gt;" chip in its header and lists the project as "Parent" under Linked from.
* **Children panel** (project pages): the children in file order with their state badges, a progress count ("N of M done", counting children that have a lifecycle state in a done group), `+ Add existing` (an entry picker), a remove button per row, `Build context`, and footer links: "New:" task, feature, idea or bug (`/new/<dataset>?parent=<project>`) and "View:" one link per dataset that has children (`/<dataset>?project=<project>`).
* **`?project=<slug>`** on any dataset list keeps only the children of that project. The filter form shows it as a checked chip; unticking it drops the parameter. A removed or unknown project shows the slug with "(missing)".
* **`?parent=<project>`** on `/new/<dataset>` preselects the "Part of project" field. On create the server appends the `child` link to the project after writing the new entry; if that second write fails the entry is kept and the form says the link was not added.

## Where relations show

* **Links to** (okf pages, reference pages show only Linked from): the entry's frontmatter links in file order, then mentions. Each row has the relation label, a dataset badge, the title, the state and a `missing` badge when the target does not exist. Frontmatter rows have a remove button; on a project the `child` rows live in the Children panel instead.
* **Linked from**: incoming edges, sorted Parent, Required by, Related, Mentioned by. A mention row names the file it appears in when that is not the entry file.
* **Broken links** in rendered markdown are drawn with a dashed underline and a tooltip (`Missing: <dataset>/<slug>`), so a dangling reference is visible before any check runs.
* **Lists and the dashboard** flag entries whose file is invalid (see below).

## The entry index

Relations come from one scan of the data directory (there are no content collections). `src/lib/entry-index.ts` reads, for every okf entry and every skill, the frontmatter of the entry file, its schema issues, its structured links, every `ctxman:` mention in the folder's markdown and the folder's newest mtime. It caches each entry folder by the `(mtime, size)` of its files (an unchanged folder is not re-read, and a finished build is reused for 200 ms because one page render asks several times). Every write route clears that short memo. `src/lib/relations.ts` (pure) turns the entries into the graph and answers "links to", "linked from", "children of" and "parents of".

The same index backs the list pages, the detail pages' frontmatter, the `?project=` filter and the invalid-file reporting. That is deliberate: the disk is the truth on every request, so a state change, a PATCH or a create shows on the very next request, and an invalid file is listed with its issues (an "invalid" badge in lists and the dashboard, a banner with the issues and a link into the editor on its page). Bodies are rendered per request and the search index is built from the disk too. See [Runtime modes](/concepts/runtime-modes.md).

## Editing relations in the UI

Everything below is the EntryTools island on okf and skill detail pages (see [Editing](/concepts/editing.md)). The buttons are rendered disabled and enabled on mount, and they are disabled again while the DocEditor is open, so a write can never invalidate an open draft.

* `+ Link` in Links to opens the entry picker with a relation select (Related by default, Depends on, Child). `+ Add existing` in Children uses the same picker fixed to `child`. Entries already linked are shown as "added" and cannot be picked twice.
* Removing a row asks for confirmation. Both actions send `PATCH /api/entry/<dataset>/<slug>` with `addLinks` or `removeLinks`; the last removal deletes the `links:` key.
* After a write the page reloads itself and shows a status line such as "Linked Write AGENTS.md".
* Writing a link by hand works too: the markdown editors complete `ctxman:`, `](` and `[[`, and "Insert link…" (Mod+Alt+K) opens the picker. Those links are mentions, not structured relations; use `+ Link` when the relation should be typed.

## Add to context and Build context

* **Add to context** (every okf, skill and reference page): choose an existing context (one that already links the entry is disabled) or "New context…", optionally write notes, and the entry is appended through `POST /api/context/<slug>/links`. A present link is left as it is and reported as skipped.
* **Build context** (project pages): a checklist of the project (always on), its children (on) and its related and depends-on entries (off) becomes the links of a new context, or is appended to an existing one, and the browser opens it in the [Forge](/concepts/context-forge.md). There is no dedicated endpoint: it is `POST /api/context` or the links endpoint with the list computed in the page.
* In the Forge itself the **All** tab searches every linkable dataset, and a row that has children offers `+ Add with N children` (children not yet linked, in file order).

## Check rules

| Rule | Severity | Meaning |
| --- | --- | --- |
| `links/relation-target` | warning | A frontmatter link points at an entry that does not exist |
| `links/relation-self` | error | An entry links to itself |

A malformed item or a duplicate is an `okf/entry-schema` / `collections/schema` error instead. The doc API also returns these findings as warnings when an entry `index.md` is saved. Details are in [Compliance checks](/concepts/compliance-checks.md).

## Related

* [Datasets](/concepts/datasets.md) for the `links` field in the dataset shapes and [Routes and API](/concepts/routes-and-api.md) for `GET|PATCH /api/entry`, `POST /api/entry` and the context links endpoint.
* [Context forge](/concepts/context-forge.md) and [Context inflate](/concepts/context-inflate.md) for the All tab and add-with-children.
