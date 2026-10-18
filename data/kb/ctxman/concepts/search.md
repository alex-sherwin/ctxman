---
type: Feature Guide
title: Search
description: The global fuzzy search, covering what is indexed, how results rank, and the URL parameters that make it deep-linkable.
tags: [search, fuse, url-state]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:50:00Z
---

# Search

Search is a full-screen modal available on every page. It queries every dataset at once and can be narrowed to some datasets with filter chips. The feature record is [global-search](ctxman:feature/global-search); for the overview return to the [concept map](../main.md#concept-map).

## What is indexed

`GET /api/search-index.json` returns `{ generatedAt, docs }`. Documents are built on the server:

* One document per markdown file in every OKF bundle (`main.md`, concepts, `index.md`, `log.md`).
* One document per skill, from the `SKILL.md` body.
* One document per reference, context and recipe, made from their field values flattened to text, so data records are searchable by their fields. A recipe's text is its description, target and layout, the listed contexts and ad hoc item keys, the preamble and the markdown blocks; its page is `/recipe/<slug>`.

Each document carries `dataset`, `slug`, `path` (null for the entry file itself), `title`, `name`, `description`, `tags`, `headings`, `body`, optional `state` and the page `url`.

## Ranking

fuse.js runs in the browser over the downloaded index. Field weights: title 0.4, name 0.3, tags 0.2, description 0.2, headings 0.15, body 0.1. The threshold is 0.35 and location is ignored, so a match anywhere in a field counts. Queries need at least two characters, and at most 60 results are shown, grouped by dataset.

## Using it

* Open with Cmd/Ctrl+K, or `/` when focus is not in a text field, or the header button.
* Arrow keys move through results, Enter opens one, Esc clears the query and a second Esc closes.
* Chips filter by dataset; chip counts reflect all hits before filtering.

## URL parameters

| Parameter | Meaning |
| --- | --- |
| `search=1` | The widget is open. |
| `sq` | The query text. |
| `in` | Comma-separated dataset ids to restrict to, such as `kb,task`. |

Opening a URL with these parameters opens the widget pre-filled. The parameter is `sq`, not `q`, because `q` is the text filter on list pages and the forge; the clash was a real defect, recorded as [search-q-param-collision](ctxman:bug/search-q-param-collision).

The widget pushes one history entry when it opens, updates the URL with replace while you type, and returns to the previous entry when closed, so Back restores an open search with its query.

## Related

* [Routes and API](/concepts/routes-and-api.md) lists the endpoint and the other URL parameters.
* [Runtime modes](/concepts/runtime-modes.md) explains why the index is recomputed per request rather than cached at build time.
