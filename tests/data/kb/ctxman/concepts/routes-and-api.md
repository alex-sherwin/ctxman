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

All routes are server-rendered from the files in the data directory (read on every request). Any UI state that selects data lives in the URL, so every view can be bookmarked and Back and Forward work. While `CTXMAN_DATA_DIR` is unset, missing or not a directory, every route answers 503: JSON `{ "error": "data-dir", "message" }` for `/api/*` and `/mcp*`, an HTML page with the fix for everything else (see [Runtime modes](/concepts/runtime-modes.md)).

## Pages

| Route | Shows |
| --- | --- |
| `/` | Dashboard: counts per dataset, recently modified entries, stale entries, contexts, recipes |
| `/<dataset>` | Filterable list of one dataset in a table (the ListTable island); files that fail their schema are listed flagged "invalid" (references too). A press on a column header sorts by it (again: the other way), columns resize by their right edge and can be hidden, and the Columns menu also sets the row density; that layout is kept per dataset in the browser (`localStorage`, `ctxman:table:<dataset>`), not in the URL. The last sort chosen on a list is remembered too (a cookie, `ctxman-sort-<dataset>`): opening the list without `sort` and `dir` redirects to it, filters kept. Clear removes the filters and keeps the sort |
| `/<dataset>/<slug>` | Entry detail: rendered content, metadata, file tree, contexts that link here. Okf and skill pages put the details on the left and the markdown preview on the right, with a Preview \| Edit toggle, the file name and a Copy button (the markdown without its frontmatter) and an Open in IDE button, a state select (lifecycle datasets), Add to context, a Details panel with an Edit dialog, the Links to and Linked from panels (see [Relations](/concepts/relations.md)), a Files panel with `+ Add file`, `+ Session` and `+ Plan` (okf: import an agent session or plan, see [Agent history import](/concepts/agent-history.md)) and, on a project, the Children panel; an invalid file shows a banner with its issues. Reference pages have Add to context and Linked from (the page of an invalid reference file is a 404 until the file is fixed). Context pages list their links in context order. Every page has a `⋯` actions menu in its header with Delete… (see [Editing](/concepts/editing.md)). List, dashboard and back-reference rows are whole-row links; list rows end in the same menu. |
| `/<dataset>/<slug>?edit=1` | Edit mode of the same route: okf and skill pages open the Monaco source editor in place of the preview; reference, snippet, context and recipe pages show the form (`view=form` or `view=yaml`). See [Editing](/concepts/editing.md). |
| `/<dataset>/<slug>/doc/<path>` | Another markdown file of the bundle, `.md` dropped from the URL (a `….md` URL redirects with 301, query kept); it has the same two columns and `?edit=1`. A concept path that does not exist in an existing bundle shows "Create this file" (404 status). |
| `/<dataset>/<slug>/file/<path>` | The raw bytes of one file of an okf bundle or skill directory (okf and skill only), with its content type (images, media, PDF; other text as `text/plain`, other binary as a download), `cache-control: no-cache` plus an ETag (304), `nosniff`, and a script-free CSP for SVG. Rendered bodies point bundle-relative `<img src>` and non-markdown links here, and the Files panel links every non-markdown file here. 400 for a refused path (`..`, absolute, dot segments), 404 for a missing file, an unknown entry, a dataset without bundles or a symlink that leaves the bundle. |
| `/new/<dataset>` | Create form for every dataset: the DataForm for `reference`, `snippet`, `context` and `recipe`, the NewEntryForm for the okf datasets and `skill`. `?parent=<project>` prefills "Part of project". |
| `/recipe`, `/recipe/<slug>` | The list and detail page of recipes (the generic dataset routes). The detail page shows the composition read-only with an "Open in Inflate" button. |
| `/forge` | The [context forge](/concepts/context-forge.md) |
| `/inflate` | [Context inflate](/concepts/context-inflate.md): compose a recipe, generate the markdown document, or run it into a working directory (`view=run`) |
| `/tools` | Run allowlisted check scripts; its Add Entry panel picks a dataset and opens the matching `/new/<dataset>` form (the CLI hint is shown too) |
| `/search` | Redirects to `/?search=1&sq=...&in=...` |
| `/mcp` | The [MCP](/concepts/mcp.md) endpoint (`POST` only; not a page) |

For example, `/kb/ctxman/doc/concepts/search` renders the [search concept](/concepts/search.md). The entry file itself (the root `index.md`) has no doc route: `/<dataset>/<slug>/doc/index` (and `…/doc/index.md`) redirects to the detail page; a nested `index.md` has one.

## List parameters

| Parameter | Meaning |
| --- | --- |
| `q` | Text filter; every term must appear in name, title, description or tags |
| `state` | Repeatable; entries in any selected state |
| `tag` | Repeatable; entries having all selected tags |
| `sort` | `modified` (default, or the sort last chosen on this list), `name`, or a column of the dataset: `state` (lifecycle datasets), `type` and `owner` (references), `links` (contexts), `target` and `contexts` (recipes), `time` (the logged total: task, feature, bug, rca) |
| `dir` | `asc` or `desc`; omitted when it is the sort's own direction (newest first for `modified`, biggest first for `links`, `contexts` and `time`, A to Z or lifecycle order otherwise). A header press sets it; the filters keep it, and a new sort from the Sort select starts in its own direction |
| `type` | References only: `local-repo`, `local-folder`, `remote-repo` or `remote-skill` |
| `project` | Only the children of that project (any dataset; the project's `rel: child` links). Shown as a checked chip; the New button then adds `?parent=` |

The global search uses a different set (`search`, `sq`, `in`); see [Search](/concepts/search.md). The forge uses `context`, `dataset` (a linkable dataset or `all`), `q`, `state` and `tag`. Inflate uses `recipe` (a name, or `new`), `view` (`compose`, `preview` or `run`), `dataset` (the ad hoc item tab, a linkable dataset or `all`), `q`, `job` (the run being watched; only with `view=run`) and `paths` (`absolute` shows the single-document preview; relative is the default and omitted). The tools page uses `add` to preselect a dataset, and `/new/<dataset>` uses `parent`.

## Edit parameters

| Parameter | Meaning |
| --- | --- |
| `edit=1` | Edit mode on a detail or doc page (exactly `1`; anything else is preview). The editor adds and removes it with `pushState`, so every switch between preview and edit is a history entry (Back and Forward switch modes), and a save removes it. The `e` key enters it (see [Keyboard shortcuts](/concepts/keyboard-shortcuts.md)) |
| `view` | Reference, context and recipe edit form only: `form` (default) or `yaml` |

## JSON endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search-index.json` | Documents for the search widget |
| `GET /api/entries?dataset=<id>` | Summaries of every entry in a dataset (title, state, tags, last modified, stale flag, URL) |
| `GET /api/entry/<dataset>/<slug>` | Frontmatter of an okf entry or skill as JSON: `{ frontmatter, lastModified, issues }` (dates as `YYYY-MM-DD` or ISO) |
| `PATCH /api/entry/<dataset>/<slug>` | Change top-level frontmatter keys only: `state`, `title`, `description`, `issueKey` (one word; `null` or blank deletes it), `tags`, `time` (ISO 8601 durations, replaces the list; `[]` or `null` deletes it) or `addTime` (durations appended to the current list, under the file lock), `resolved` (an ISO 8601 date or date-time; `null` or blank deletes it), `stale_after`, `status`, `links` (replace the list) or `addLinks` / `removeLinks` (not together with `links`), plus `ifUnmodifiedSince`. Answer `{ frontmatter, lastModified, changed, warnings }` |
| `DELETE /api/entry/<dataset>/<slug>` | Delete an okf entry or skill: removes the whole folder. 204 without a body; 400 `bad-dataset` / `bad-slug`, 403 `forbidden-origin`, 404 `not-found` (also for a symlinked bundle folder or one that resolves outside the dataset folder, which is never followed). The yaml datasets keep their own `DELETE /api/<reference|context|recipe>/<slug>` |
| `POST /api/entry/<dataset>` | Create an okf entry or skill from the templates: `{ name, description, title?, state?, tags?, parent? }`; `parent` (a project) gets a `child` link. 201 `{ dataset, slug, path, url, files, parentLinked? }` |
| `GET /api/context/<slug>` | Read one context |
| `POST /api/context/<slug>/links` | Append `{ links: [{ dataset, slug, notes? }] }` (1..200) to a context; links already present are skipped: `{ context, lastModified, added, skipped }` |
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
| `GET /api/snippet/<slug>` | Read one snippet |
| `POST /api/snippet` | Create a snippet (409 if it exists) |
| `PUT /api/snippet/<slug>` | Replace a snippet; the name in the body must equal the slug |
| `DELETE /api/snippet/<slug>` | Delete a snippet |
| `GET /api/doc/<dataset>/<slug>/<path>` | Read one existing `.md` file of an okf bundle or skill: `{ path, markdown, lastModified, bytes, warnings }` |
| `PUT /api/doc/<dataset>/<slug>/<path>` | Save it: body `{ markdown, ifUnmodifiedSince? }`, answer `{ path, bytes, lastModified, warnings }` |
| `POST /api/doc/<dataset>/<slug>/<path>` | Create a markdown file at any path of an okf bundle (`references/abc.md`; missing folders are created): body `{ title, type?, description? }` (`type` defaults to `article`); it also adds a line under `## Links` in the bundle's `index.md` (renaming a legacy `## Concepts` heading, or appending the section) and, when the bundle has a `log.md`, a "Create" line there (never creating one). 201 `{ path, url, lastModified, warnings }` |
| `DELETE /api/doc/<dataset>/<slug>/<path>` | Delete one markdown file of an okf bundle that is not the entry `index.md` (400 `bad-path`: that is `DELETE /api/entry`): the file (a symlink is unlinked, never followed), the folders it leaves empty and its `## Links` (or legacy `## Concepts`) line in `index.md`; an existing `log.md` gets a "Delete" line. 200 `{ path, url, warnings }` (unlike the other DELETE routes): `url` is the entry page, `warnings` the `links/broken` links that still point at the file. 400 `bad-dataset` (not okf) / `bad-slug` / `bad-path`, 403, 404 `not-found` |
| `GET /api/agent-sessions?agent=&q=&offset=&limit=` | The agent sessions of Claude Code, Codex and GitHub Copilot (CLI + VS Code), newest first, without prompt-less and subagent sessions: `{ items, next, sources }` (`next` = the offset of the next page, null at the end; `limit` 1..200, default 50). 400 `bad-agent` |
| `GET /api/agent-sessions/<key>?tools=1\|0&thinking=1\|0` | One session (`<key>` = `<source>:<id>`, one `encodeURIComponent` segment): `{ summary, prompts, markdown, html, truncated, defaultPath }`, `markdown` being exactly the file an import writes. 400 `bad-key`, 404, 413 `too-large` (over 256 MB) |
| `POST /api/agent-sessions/import` | `{ key, dataset, slug, path, title?, tools?, thinking? }`: write the session as a new `type: agent-session` file (with `index: false`) of an okf bundle, listed under `## Links` and in an existing `log.md`. 201 `{ path, url, lastModified, warnings }` + `location`; 400 `invalid` / `bad-key` / `bad-dataset` / `bad-slug` / `bad-path`, 403, 404 (session or entry), 409 `exists`, 413, 415 |
| `GET /api/agent-plans?agent=&q=` | The agents' plan files, newest first (at most 500; `q` matches title, path, thread and the whole text): `{ items, sources }` |
| `GET /api/agent-plans/<key>` | One plan: `{ summary, markdown, html, defaultPath }`. 400 `bad-key`, 404, 413 (over 1 MB) |
| `POST /api/agent-plans/import` | `{ key, dataset, slug, path, title? }`: write the plan as a new `type: plan` file (with `index: false`); the answers of the session import |
| `GET /api/ide/open` | Is an IDE command available: `{ available, command }`; never starts anything |
| `POST /api/ide/open` | Open `{ dataset, slug, path? }` in the IDE (an okf or skill entry folder with the file at `path`, default the entry file; a snippet in the `snippet/` folder; the other yaml datasets in the data directory), or `{ dir }` (a directory ctxman inflated, opened as a workspace on its own): `{ ok, command }` |
| `GET /api/schemas/<dataset>` | The committed JSON Schema of `reference`, `snippet`, `context` or `recipe` (`application/schema+json`, `access-control-allow-origin: *`); `<dataset>.schema.json` works too. The YAML modeline of every data file points here |
| `POST /api/inflate/render` | Render a recipe (saved or not) to `{ markdown, manifest }`; writes nothing |
| `POST /api/inflate/write` | Render `{ recipe, path }` and write the markdown to an absolute `.md` path |
| `POST /api/inflate/plan` | Dry run of a working-directory run: `{ recipe, overrides? }` to the blocking problems, warnings, steps and the relative document; writes nothing. `overrides` are the run overrides (`dir`, `contextFile`, `primary`, `allowNonEmpty` and `items[key]` with `material`, `materialOptions` and `edit`, the Editable flag of a `reference/<slug>`; `edit` on any other key is a 400 `invalid`) |
| `POST /api/inflate/run` | Same body as `plan`; start the run in the background: 202 `{ jobId, job }`; one run at a time |
| `GET /api/inflate/jobs/<id>` | The job: status, steps with their output tails, summary |
| `POST /api/inflate/jobs/<id>/cancel` | Cancel a queued or running job |
| `POST /api/scripts/<name>` | Run an allowlisted script and return its exit code, stdout and stderr |
| `POST /mcp` | The [MCP](/concepts/mcp.md) server: Streamable HTTP JSON-RPC, stateless; `GET` and `DELETE` answer the SDK's 405 JSON-RPC error |

Every response is JSON with `cache-control: no-store`. Context reads and writes return `{ context, lastModified }`, recipe ones `{ recipe, lastModified }`, reference ones `{ reference, lastModified }` and snippet ones `{ snippet, lastModified }`; delete returns 204 with no body, and creating a recipe, reference or snippet also sets `Location: /<dataset>/<name>`. Mutating endpoints accept JSON only (415 otherwise) and reject cross-origin requests (403): a request without `Origin` passes, and so does an `Origin` that equals the request origin, equals the `Host` header, or has the same protocol and port with a loopback hostname on both sides (127.0.0.1, localhost, ::1 count as one). Errors use a body of `{ error, message, issues? }`: 400 for a bad body, slug or dataset parameter, 404 for a missing context or recipe, 409 when one exists, and 422 when a context or recipe file on disk fails its schema. The inflate endpoints add 400 `invalid` (the recipe fails its schema; for `write` the issue paths are prefixed `recipe.`, for `plan` and `run` `recipe.` or `overrides.`), 400 `bad-path` and 400 `write-failed` for `write`; `run` answers 400 `no-dir`, `bad-dir` or `dir-not-directory` and 409 `dir-not-empty`, `manifest-invalid` or `busy`; the jobs routes answer 400 `bad-id`, 404 `not-found` (unknown, or lost in a server restart) and, for cancel, 409 `not-running`. `plan` reports a bad directory as a `blocking` entry of a 200 answer. The path and directory rules are in [Context inflate](/concepts/context-inflate.md). `POST /api/scripts/<name>` answers 200 even when the script exits non-zero (the exit code is in the body) and 404 for a name outside the allowlist; a successful add run also reports `created: { dataset, slug, path, url }`, which the Tools page navigates to. Scripts are started with `process.execPath` and no shell, so they behave the same on macOS, Linux and Windows.

### Entry, doc, IDE and schema endpoints

* `PATCH /api/entry/...` edits the YAML frontmatter by source range: only the keys in the body change and every other byte of the file stays (comments, folded text, unknown keys, the body). It is serialized per file and **never writes an invalid file**: a result that fails the dataset schema is a 400 `invalid` (issue paths are the body keys, e.g. `stale_after` or `links.2.slug`) and nothing is written; the unchanged result is a 200 with `changed: false`. Other answers: 400 `bad-dataset` (not okf/skill) or `bad-slug`, 404 `not-found`, 409 `conflict` (`ifUnmodifiedSince` differs from the file mtime; the body carries the current `lastModified`), 422 `invalid-file` (the file's frontmatter is missing or unparseable). Allowed keys per dataset: `state` lifecycle datasets only; `time`/`addTime`/`resolved` task, feature, bug and rca only (`time` and `addTime` never together) (durations are trimmed and upper-cased, `pt1h` becomes `PT1H`; a date-time with seconds is written quoted so it reads back as written); `links`/`addLinks`/`removeLinks`/`title`/`issueKey`/`tags`/`stale_after`/`status` okf only; a skill takes `description`.
* `POST /api/entry/<dataset>` answers 400 `invalid` (issues; also an unknown `parent`, with nothing written) or `bad-dataset`, 409 `exists` and `Location: /<dataset>/<name>`. If the entry was written but the `parent` link could not be added, it answers 201 with `parentLinked: false` and a `parentError`.
* `PUT /api/doc/...` always saves (a bad frontmatter is returned as `warnings`, not refused; the warnings include the link findings of the file), writes atomically and never creates a file. `ifUnmodifiedSince` must equal the file's current mtime exactly; a difference is a 409 `conflict` whose body carries the current `lastModified`; omitting it overwrites. Other answers: 400 `bad-dataset`, `bad-slug`, `bad-path` (traversal, a non-`.md` file) or `invalid`, 404 `not-found`, 413 `too-large` (over 512 KB), 422 `not-text`. Only okf datasets and `skill` are served. `POST` creates: okf datasets only, a path that is not the entry `index.md` or another reserved file (a nested `index.md`, `log.md`; 400 `bad-path`), an existing bundle (404) and a new file (409 `exists`).
* `POST /api/ide/open` answers 400 `invalid`, `bad-slug` or `bad-path`, 404 `not-found`, 501 `ide-not-found` (no command) and 500 `ide-spawn-failed`. The request never names the executable. The `{ dir }` variant (`dir` is the only key) runs the output-directory checks, requires a readable `.ctxman-inflate.json` there (404 `not-found` otherwise) and opens the folder alone: `<command> <dir>`.
* The agent history routes only read the agents' folders and never take a path: a `<key>` is resolved by listing its source again (both the encoded and the decoded form of the key work). The imports check the body, the key and the target before they read the history and write through `createDocFile` (never overwriting). See [Agent history import](/concepts/agent-history.md).
* `GET /api/schemas/<dataset>` (or `<dataset>.schema.json`) answers 404 `unknown-dataset` for anything but the four yaml datasets and 500 `schema-missing` before `pnpm run gen:schemas` ran.
* `POST /mcp` is JSON-RPC and has its own status codes: 403 when the `Host` header is not loopback or an `Origin` header is present and not loopback, 415 for a wrong content type, 406 for a 2025-era request without `Accept: application/json, text/event-stream`, 405 for `GET`/`DELETE`. Tool errors are results with `isError: true`, not HTTP errors. See [MCP](/concepts/mcp.md).
* The reference and snippet endpoints follow the context ones (400 `bad-slug`, `invalid` or `name-mismatch`, 404, 409, 415, 403, 422 `invalid-file`); a write is visible on the next request everywhere.

See also [Architecture](/concepts/architecture.md), [Editing](/concepts/editing.md), [Relations](/concepts/relations.md), [MCP](/concepts/mcp.md), [Context inflate](/concepts/context-inflate.md) and [Agent history import](/concepts/agent-history.md).
