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
| `/` | Dashboard: counts per dataset, recently modified entries, stale entries, contexts, recipes |
| `/<dataset>` | Filterable list of one dataset |
| `/<dataset>/<slug>` | Entry detail: rendered content, metadata, file tree, contexts that link here. Okf and skill pages put the details on the left and the markdown preview on the right, with a Preview \| Edit toggle and an Open in IDE button; context pages list their links in context order. List, dashboard and back-reference rows are whole-row links. |
| `/<dataset>/<slug>?edit=1` | Edit mode of the same route: okf and skill pages open the Monaco source editor in place of the preview; reference, context and recipe pages show the form (`view=form` or `view=yaml`). See [Editing](/concepts/editing.md). |
| `/<dataset>/<slug>/doc/<path>` | Another markdown file of the bundle, `.md` dropped from the URL; it has the same two columns and `?edit=1` |
| `/new/<dataset>` | Create form for `reference`, `context` or `recipe`; any other dataset is a 404 (use the Tools page) |
| `/recipe`, `/recipe/<slug>` | The list and detail page of recipes (the generic dataset routes). The detail page shows the composition read-only with an "Open in Inflate" button. |
| `/forge` | The [context forge](/concepts/context-forge.md) |
| `/inflate` | [Context inflate](/concepts/context-inflate.md): compose a recipe and generate the markdown document |
| `/tools` | Run allowlisted check scripts and the add-entry script; a successfully created entry is opened automatically |
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

The global search uses a different set (`search`, `sq`, `in`); see [Search](/concepts/search.md). The forge uses `context`, `dataset`, `q`, `state` and `tag`. Inflate uses `recipe` (a name, or `new`), `view` (`compose` or `preview`), `dataset` (the ad hoc item tab) and `q`. The tools page uses `add` to preselect a dataset.

## Edit parameters

| Parameter | Meaning |
| --- | --- |
| `edit=1` | Edit mode on a detail or doc page (exactly `1`; anything else is preview). The editor adds and removes it with `replaceState`, so it never creates history entries, and a save removes it |
| `view` | Reference, context and recipe edit form only: `form` (default) or `yaml` |

## JSON endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search-index.json` | Documents for the search widget |
| `GET /api/entries?dataset=<id>` | Summaries of every entry in a dataset (title, state, tags, last modified, stale flag, URL) |
| `GET /api/context/<slug>` | Read one context |
| `POST /api/context` | Create a context (409 if it exists) |
| `PUT /api/context/<slug>` | Replace a context; the name in the body must equal the slug |
| `DELETE /api/context/<slug>` | Delete a context |
| `GET /api/recipe/<slug>` | Read one recipe |
| `POST /api/recipe` | Create a recipe (409 if it exists) |
| `PUT /api/recipe/<slug>` | Replace a recipe; the name in the body must equal the slug |
| `DELETE /api/recipe/<slug>` | Delete a recipe |
| `GET /api/reference/<slug>` | Read one reference |
| `POST /api/reference` | Create a reference (409 if it exists) |
| `PUT /api/reference/<slug>` | Replace a reference; the name in the body must equal the slug |
| `DELETE /api/reference/<slug>` | Delete a reference |
| `GET /api/doc/<dataset>/<slug>/<path>` | Read one existing `.md` file of an okf bundle or skill: `{ path, markdown, lastModified, bytes, warnings }` |
| `PUT /api/doc/<dataset>/<slug>/<path>` | Save it: body `{ markdown, ifUnmodifiedSince? }`, answer `{ path, bytes, lastModified, warnings }` |
| `GET /api/ide/open` | Is an IDE command available: `{ available, command }`; never starts anything |
| `POST /api/ide/open` | Open `{ dataset, slug, path? }` in the IDE: `{ ok, command }` |
| `GET /api/schemas/<dataset>` | The committed JSON Schema of `reference`, `context` or `recipe` (`application/schema+json`) |
| `POST /api/inflate/render` | Render a recipe (saved or not) to `{ markdown, manifest }`; writes nothing |
| `POST /api/inflate/write` | Render `{ recipe, path }` and write the markdown to an absolute `.md` path |
| `POST /api/scripts/<name>` | Run an allowlisted script and return its exit code, stdout and stderr |

Every response is JSON with `cache-control: no-store`. Context reads and writes return `{ context, lastModified }`, recipe ones `{ recipe, lastModified }` and reference ones `{ reference, lastModified }`; delete returns 204 with no body, and creating a recipe or reference also sets `Location: /<dataset>/<name>`. Mutating endpoints accept JSON only (415 otherwise) and reject requests whose `Origin` differs from the server's (403). Errors use a body of `{ error, message, issues? }`: 400 for a bad body, slug or dataset parameter, 404 for a missing context or recipe, 409 when one exists, and 422 when a context or recipe file on disk fails its schema. The inflate endpoints add 400 `invalid` (the recipe fails its schema; for `write` the issue paths are prefixed `recipe.`), 400 `bad-path` and 400 `write-failed`; the path rules are in [Context inflate](/concepts/context-inflate.md). `POST /api/scripts/<name>` answers 200 even when the script exits non-zero (the exit code is in the body) and 404 for a name outside the allowlist; a successful add run also reports `created: { dataset, slug, path, url }`, which the Tools page navigates to. Scripts are started with `process.execPath` and no shell, so they behave the same on macOS, Linux and Windows.

### Doc, IDE and schema endpoints

* `PUT /api/doc/...` always saves (a bad frontmatter is returned as `warnings`, not refused), writes atomically and never creates a file. `ifUnmodifiedSince` must equal the file's current mtime exactly; a difference is a 409 `conflict` whose body carries the current `lastModified`; omitting it overwrites. Other answers: 400 `bad-dataset`, `bad-slug`, `bad-path` (traversal, a non-`.md` file) or `invalid`, 404 `not-found`, 413 `too-large` (over 512 KB), 422 `not-text`. Only okf datasets and `skill` are served.
* `POST /api/ide/open` answers 400 `invalid`, `bad-slug` or `bad-path`, 404 `not-found`, 501 `ide-not-found` (no command) and 500 `ide-spawn-failed`. The request never names the executable.
* `GET /api/schemas/<dataset>` answers 404 `unknown-dataset` for anything but the three yaml datasets and 500 `schema-missing` before `pnpm run gen:schemas` ran.
* The reference endpoints follow the context ones (400 `bad-slug`, `invalid` or `name-mismatch`, 404, 409, 415, 403, 422 `invalid-file`), but references keep their watched collection, so server-rendered pages and `GET /api/entries?dataset=reference` see a write about 0.6 s later.

See also [Architecture](/concepts/architecture.md), [Editing](/concepts/editing.md) and [Context inflate](/concepts/context-inflate.md).
