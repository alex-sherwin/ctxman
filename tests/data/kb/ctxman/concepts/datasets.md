---
type: Dataset Model
title: Datasets
description: The twelve datasets, their on-disk shape, lifecycle states and the link syntax between entries.
tags: [datasets, okf, schema]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:40:00Z
---

# Datasets

All data lives in the data directory, the folder `CTXMAN_DATA_DIR` points at (see [Runtime modes](/concepts/runtime-modes.md)); the paths below are relative to it. The repository's own sample corpus, which includes these docs, is `tests/data/`. Every entry has a required unique `name` (kebab-case, at most 64 characters) and a required `description`. The name equals the folder name or file stem and doubles as the slug.

## The twelve datasets

| Dataset | Kind | Entry file | Lifecycle states |
| --- | --- | --- | --- |
| `kb` | OKF bundle | `kb/<name>/index.md` | none |
| `rca` | OKF bundle | `rca/<name>/index.md` | none |
| `idea` | OKF bundle | `idea/<name>/index.md` | pending, in-progress, complete, abandoned |
| `task` | OKF bundle | `task/<name>/index.md` | pending, in-progress, complete, wont-do |
| `bug` | OKF bundle | `bug/<name>/index.md` | pending, in-progress, fixed, wont-fix |
| `feature` | OKF bundle | `feature/<name>/index.md` | pending, in-progress, complete, wont-do |
| `project` | OKF bundle | `project/<name>/index.md` | pending, wip, stable, abandoned, wont-do |
| `skill` | agentskills.io folder | `skill/<name>/SKILL.md` | none |
| `reference` | YAML file | `reference/<name>.yaml` | none |
| `snippet` | YAML file | `snippet/<name>.yaml` | none |
| `context` | YAML file | `context/<name>.yaml` | none |
| `recipe` | YAML file | `recipe/<name>.yaml` | none |

State values are stored kebab-case in the files; the UI shows labels such as "in progress" and "won't do". Projects have their own set: `wip` (shown as "WIP", in progress) and `stable` (done) instead of `in-progress` and `complete`, plus `abandoned`.

## OKF bundles

Seven datasets are Open Knowledge Format v0.2 bundles. A bundle folder contains:

* `index.md`: the entry. Frontmatter starts with `okf_version: "0.2"` and holds `type`, `name`, `title`, `description`, `tags`, `state` (lifecycle datasets), the optional `issueKey` (below), the optional `links` relations (below) and optional provenance keys such as `generated`, `sources`, `status` and `stale_after`; the body is the entry content and may end with a `## Links` navigation section that lists the bundle's files (a file added in the UI or through the API is listed there for you; an older `## Concepts` section is renamed to `## Links` the first time a file is added to it). Nested `index.md` files are frontmatter-free navigation.
* `log.md` (optional): update history, newest first, under `## YYYY-MM-DD` headings. New bundles do not get one (the scripts, the `/new` forms and the API write `index.md` only); the MCP `append-log` tool creates it on request.

Every okf entry `index.md` may name the matching issue in an issue tracker in the optional `issueKey` (`issueKey: PROJ-123`, `org/repo#42`): one word without spaces, at most 100 characters (concept files do not take it). It is set in the `/new/<dataset>` form (Issue key), the Details dialog, `--issue-key` of the add scripts, `PATCH /api/entry` and the MCP `create-entry` / `patch-entry` tools; the Details panel shows it with a Copy button, the list shows it as a badge next to the title, search finds the entry by it and [Context inflate](/concepts/context-inflate.md) names it on the item's first line. `pnpm run check:okf` reports a value with spaces (`okf/entry-schema`).

Task, feature, bug and rca entries can track work in two optional `index.md` keys (registry `TIME_TRACKED_DATASETS`):

* `time`: a list of ISO 8601 durations, one per stretch of work (`time: [PT1H30M, PT45M, P1D]`; a fraction on the smallest part is fine, `PT0.5H`). The Details panel shows them with their total in hours (a value with years or months has no fixed length, so no total).
* `resolved`: when the work was resolved, an ISO 8601 date or date-time in any common form: `2026-10-19`, `2026-10`, `2026-W42-1`, `2026-292`, `20261019`, `2026-10-19T14:30`, `2026-10-19T14:30:05.5Z`, `2026-10-19T14:30+02:00`. It is kept as written (ctxman quotes a date-time with seconds, which YAML would otherwise read back as a UTC timestamp).

Both are edited in the Details dialog, `PATCH /api/entry` and the MCP `patch-entry` tool (whose `addTime` appends durations); the clock button of a list row logs one more duration (Log time, see [Editing](/concepts/editing.md)) and the list's Time column shows the total (`1h 30m`; `?` when a value has years or months, sortable); `pnpm run check:okf` reports a value in another form (`okf/entry-schema`).
* Any number of further concept files. Each needs frontmatter with a non-empty `type`.

Two more optional keys work on the entry `index.md` and on every concept file alike:

* `index: false` leaves the file out of [search](/concepts/search.md) (on the entry `index.md`: the whole bundle), for agent session histories and other bulky files; only the boolean counts. Skills have no such key (their frontmatter is strict).
* `modified`: the time of the last in-browser save, written by the [markdown editor](/concepts/editing.md) on every Save as a quoted UTC date-time to the second (`modified: "2026-10-20T14:03:12Z"`). It is informational; freshness stays the file modification time.

Freshness is the newest file modification time in the bundle, computed at request time. A bundle whose `stale_after` date has arrived is flagged stale.

## Skills

A skill folder follows agentskills.io: `SKILL.md` with `name` (equal to the folder) and `description`, optional `license`, `compatibility`, `metadata` and `allowed-tools`, plus optional `scripts/`, `references/` and `assets/`. The schema is strict, so unknown frontmatter keys are errors.

## References

A reference points outside the data directory. Its `type` selects the field set:

| Type | Fields |
| --- | --- |
| `local-repo` | `path` (a git repository on this machine), optional `subpath`, optional `folder`, `owner` |
| `local-folder` | `path` (a plain folder on this machine, not a git repository), optional `subpath`, optional `folder`, `owner` |
| `remote-repo` | `uri` (git URI), optional `subpath`, optional `folder`, `owner` |
| `remote-skill` | `uri` (git URI or HTTPS archive), `subpath` (empty or absent means the repo or archive root), `owner` |

`owner` is `me` or `not-me`. All reference types also carry `name`, `description`, optional `tags` and an optional `info`: markdown about the referenced thing (how it is laid out, how to build or use it, what to watch out for), shown in the Info panel of the reference page and inlined under the reference by [Context inflate](/concepts/context-inflate.md); it is written last, as a literal block (`info: |`), and a blank one is dropped. `local-repo` and `local-folder` have the same fields; the type tells agents (and Context Inflate) whether to expect git: a local folder is placed under `folders/` instead of `repos/`, is described as files in a folder, and can never be the primary repository of a recipe (see [Context inflate](/concepts/context-inflate.md)). The optional `folder` of a repository or folder (one folder name: a letter or digit first, then letters, digits, `. _ -`, at most 100 characters) is the name Context Inflate places it under in a working directory, `repos/<folder>` or `folders/<folder>`, instead of the reference name; a remote skill has none (it is installed under its skill name) and its schema rejects the key. The form calls it "Folder name".

Every dataset can be created in the UI (`/new/<dataset>`). References can be created, edited and deleted in the UI (`/new/reference`, `/reference/<slug>?edit=1`) and through `GET|PUT|DELETE /api/reference/<slug>` and `POST /api/reference`. `src/lib/reference-io.ts` does the atomic file write with a fixed key order (`name`, `description`, `type`, `path` or `uri`, `subpath`, `folder`, `owner`, `tags`, `info`), the same one the add script and every seed file use. Like contexts and recipes, a reference is read from the disk on every request, so a write shows on the next one; list summaries carry the `owner` of a reference. A reference file that fails its schema is listed flagged "invalid" (lists and the dashboard), but its detail page is a 404 until it is fixed.

### URI rules

One pure helper, `src/lib/remote-uri.ts` (`isGitUri`, `isArchiveUri`, `classifyRemoteUri`), backs the schema, `add-entry`, the search text and the badges. A git URI is SCP-style SSH (`git@github.com:org/repo.git`), `ssh://git@host/org/repo.git`, or HTTPS `https://host/org/repo` with or without `.git`; credentials, query strings and fragments are rejected. A `remote-skill` `uri` may instead be an HTTPS URL whose path ends in `.tar.gz`, `.tgz` or `.zip`. The two kinds never overlap, and `remote-repo` accepts git URIs only. The `git` or `archive` badge on list rows, the detail page and the search body is derived from the URI, never stored.

## Snippets

A snippet is a reusable piece of markdown: the instructions you give every session, house rules, a checklist. It has `name`, `description`, optional `tags` and a required, non-blank `markdown` field. There are no files and no bundle; the text is the data:

```yaml
# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/snippet
name: finish-checklist
description: The checks to run before saying a piece of work is done.
tags:
  - workflow
markdown: |
  ## Before you finish

  1. Run the full suite.
```

`markdown` is written last, as a literal block, exactly as typed. A snippet is linkable, so a context links it and a recipe includes it like any other entry; [Context inflate](/concepts/context-inflate.md) writes its markdown into the document under the item heading. The snippet page renders the markdown in a panel with Copy (the raw text; its arrow menu also offers Copy as JIRA Markup) and a pencil popup editor; `/new/snippet` and `?edit=1` use the form, with the markdown in a Monaco field. The API is `GET|PUT|DELETE /api/snippet/<slug>` and `POST /api/snippet`, and `src/lib/snippet-io.ts` writes the file atomically (key order `name`, `description`, `tags`, `markdown`). Like a reference, an invalid snippet file is listed flagged and its page is a 404 until it is fixed. `ctxman:` links in a snippet are not checked by `check:links` (Inflate warns about unresolved ones).

## Contexts

A context aggregates links to the ten linkable datasets (everything except `context` and `recipe`), each with optional markdown notes for the consuming agent. See [Context forge](/concepts/context-forge.md). Contexts never copy the linked content; [Context inflate](/concepts/context-inflate.md) reads them at generate time.

## Recipes

A recipe is the saved input of the [Context inflate](/concepts/context-inflate.md) tool: which contexts to expand, extra items, how each item is included and (for a working directory) placed, the order, injected markdown and a preamble, for one target (`claude-code`, `codex` or `generic`). Like a context it is a pointer file: it stores slugs and settings, never the linked content. Fields: `name`, `description`, `tags`, `target`, `layout`, `output`, `preamble`, `contexts`, `items`, `markdown`, `overrides`, `order`, `defaults`. `output` (`dir`, `contextFile`, `primary`, `allowNonEmpty`, `stubs`) names the working directory a run inflates into; overrides and defaults also carry a `material` (what is placed there: symlink, copy, clone, install or nothing) and `materialOptions`, and an override of a `reference/<slug>` key may carry `edit` (the Editable flag of a repository). The schema is strict and rejects duplicates and modes or materials that do not fit an item kind; the working-directory settings are explained in [Context inflate](/concepts/context-inflate.md). A recipe may list contexts and items of any linkable dataset but is not itself linkable: a context cannot link to a recipe, so recipes do not appear in the Forge or in the Inflate item search (a `ctxman:recipe/<name>` link in markdown still resolves to the recipe page). The name cannot be changed after creation. Recipes are always read and written through `src/lib/recipe-io.ts` (atomic write).

## JSON Schemas and the magic comment

`reference`, `snippet`, `context` and `recipe` also exist as generated JSON Schemas in `schemas/<dataset>.schema.json`. They come from the arktype Types in `src/datasets/schemas.ts`, the same Types that validate the files at runtime (arktype is the only validator), via `pnpm run gen:schemas`; `pnpm run check:schemas` fails when a file is stale, and `GET /api/schemas/<dataset>` serves them. Rules JSON Schema cannot express (duplicate links, name equals file stem, URI shapes) are custom narrows of the same Types and are listed in each schema's `$comment`.

Every file of these four datasets starts with the yaml-language-server comment on line 1, which points editors at the schema so the Red Hat YAML extension validates as you type:

```yaml
# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/context
name: ctxman-dev
```

The URL is the running app's schema endpoint, so the schema resolves while ctxman runs (the endpoint answers with CORS `*` and also accepts `/api/schemas/context.schema.json`). The origin comes from `CTXMAN_SERVER_ORIGIN`, default `http://127.0.0.1:4321`. The file writers add the line (context-io, recipe-io, reference-io, snippet-io and the add scripts); the serializers stay pure data. Do not strip it. `collections/yaml-schema-comment` warns when it is missing or wrong: it accepts any loopback origin and port (127.0.0.1, localhost, [::1]) and an optional `.schema.json` suffix for that dataset, so a file written for another port still passes. `pnpm run fix:yaml-comments` repairs a hand-made file. The browser YAML editors never show the line; they match the schemas on a model path. See [Editing](/concepts/editing.md).

## Relations: the `links` field

An okf entry `index.md` can declare typed relations to other entries (see [Relations](/concepts/relations.md)):

```yaml
links:
  - dataset: task
    slug: write-agents-md
    rel: child
```

`dataset` is a linkable dataset (not `context` or `recipe`), `slug` an entry name, and `rel` is `child` (this entry contains the target; a project owns its children), `related` (the default when `rel` is absent) or `depends-on`. One link per target, no link to the entry itself. Skills have no `links` key. `links/relation-target` (warning) and `links/relation-self` (error) check them; ctxman writes them in block style with the keys in the order `dataset`, `slug`, `rel`, from the Links and Children panels and `PATCH /api/entry`. The okf `links` field has no JSON Schema: the arktype Type `entryLinksSchema` is its only definition.

## Links between entries

* Inside a bundle, use bundle-root paths (`/concepts/x.md`) or relative paths (`./x.md`). The link check requires the target file to exist.
* Between entries, use the `ctxman:` scheme: `ctxman:<dataset>/<slug>`, for example the feature [context-forge](ctxman:feature/context-forge). A path such as `/feature/x` would be read as a path inside the current bundle, which is why a separate scheme exists. The site rewrites these links to the entry page (a missing target is drawn with a dashed underline); the link check warns when the target is missing. Such a body link is a *mention*, shown on the target's page as "Mentioned by"; a typed relation belongs in `links`.

## Related

* [Adding entries](/concepts/adding-entries.md) scaffolds each shape correctly.
* [Compliance checks](/concepts/compliance-checks.md) enforces them.
* [Relations](/concepts/relations.md) explains how `links` is read and edited.
* [Editing](/concepts/editing.md) covers changing them in the browser.
