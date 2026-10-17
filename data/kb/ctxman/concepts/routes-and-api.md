---
type: Reference
title: Routes and API
description: Every page route, its URL parameters and the JSON endpoints behind the UI.
tags: [routes, api, url-state]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:05:00Z
---

# Routes and API

All routes are server-rendered. Any UI state that selects data lives in the URL, so every view can be bookmarked and Back and Forward work.

## Pages

| Route | Shows |
| --- | --- |
| `/` | Dashboard: counts per dataset, recently modified entries, stale entries, contexts |
| `/<dataset>` | Filterable list of one dataset |
| `/<dataset>/<slug>` | Entry detail: rendered content, metadata, file tree, contexts that link here |
| `/<dataset>/<slug>/doc/<path>` | Another markdown file of the bundle, `.md` dropped from the URL |
| `/forge` | The [context forge](/concepts/context-forge.md) |
| `/tools` | Run allowlisted check scripts and the add-entry script |
| `/search` | Redirects to `/?search=1&sq=...&in=...` |

For example, `/kb/ctxman/doc/concepts/search` renders the [search concept](/concepts/search.md). The entry file itself (`main.md`) has no doc route: `/<dataset>/<slug>/doc/main` redirects to the detail page.

## List parameters

| Parameter | Meaning |
| --- | --- |
| `q` | Text filter; every term must appear in name, title, description or tags |
| `state` | Repeatable; entries in any selected state |
| `tag` | Repeatable; entries having all selected tags |
| `sort` | `modified` (default), `name` or `state` |
| `type` | References only: `local-repo`, `remote-repo` or `remote-skill` |

The global search uses a different set (`search`, `sq`, `in`); see [Search](/concepts/search.md). The forge uses `context`, `dataset`, `q`, `state` and `tag`. The tools page uses `add` to preselect a dataset.

## JSON endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search-index.json` | Documents for the search widget |
| `GET /api/entries?dataset=<id>` | Summaries of every entry in a dataset (title, state, tags, last modified, stale flag, URL) |
| `GET /api/context/<slug>` | Read one context |
| `POST /api/context` | Create a context (409 if it exists) |
| `PUT /api/context/<slug>` | Replace a context; the name in the body must equal the slug |
| `DELETE /api/context/<slug>` | Delete a context |
| `POST /api/scripts/<name>` | Run an allowlisted script and return its exit code, stdout and stderr |

Every response is JSON with `cache-control: no-store`. Context reads and writes return `{ context, lastModified }`; delete returns 204 with no body. Mutating endpoints accept JSON only (415 otherwise) and reject requests whose `Origin` differs from the server's (403). Errors use a body of `{ error, message, issues? }`: 400 for a bad body, slug or dataset parameter, 404 for a missing context, 409 when a context exists, and 422 when a context file on disk fails its schema. `POST /api/scripts/<name>` answers 200 even when the script exits non-zero (the exit code is in the body) and 404 for a name outside the allowlist. Scripts are started with `process.execPath` and no shell, so they behave the same on macOS, Linux and Windows.

See also [Architecture](/concepts/architecture.md).
