---
type: Dataset Model
title: Datasets
description: The eleven datasets, their on-disk shape, lifecycle states and the link syntax between entries.
tags: [datasets, okf, schema]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:40:00Z
---

# Datasets

All data lives under `data/`. Every entry has a required unique `name` (kebab-case, at most 64 characters) and a required `description`. The name equals the folder name or file stem and doubles as the slug and the content collection entry id.

## The eleven datasets

| Dataset | Kind | Entry file | Lifecycle states |
| --- | --- | --- | --- |
| `kb` | OKF bundle | `data/kb/<name>/main.md` | none |
| `rca` | OKF bundle | `data/rca/<name>/main.md` | none |
| `idea` | OKF bundle | `data/idea/<name>/main.md` | pending, in-progress, complete, abandoned |
| `task` | OKF bundle | `data/task/<name>/main.md` | pending, in-progress, complete, wont-do |
| `bug` | OKF bundle | `data/bug/<name>/main.md` | pending, in-progress, fixed, wont-fix |
| `feature` | OKF bundle | `data/feature/<name>/main.md` | pending, in-progress, complete, wont-do |
| `project` | OKF bundle | `data/project/<name>/main.md` | pending, in-progress, complete, wont-do |
| `skill` | agentskills.io folder | `data/skill/<name>/SKILL.md` | none |
| `reference` | YAML file | `data/reference/<name>.yaml` | none |
| `context` | YAML file | `data/context/<name>.yaml` | none |
| `recipe` | YAML file | `data/recipe/<name>.yaml` | none |

State values are stored kebab-case in the files; the UI shows labels such as "in progress" and "won't do".

## OKF bundles

Seven datasets are Open Knowledge Format v0.2 bundles vendored into the repo. A bundle folder contains:

* `index.md`: bundle navigation. Its only frontmatter is `okf_version: "0.2"`.
* `main.md`: the entry concept. Frontmatter holds `type`, `name`, `title`, `description`, `tags`, `state` (lifecycle datasets) and optional provenance keys such as `generated`, `sources`, `status` and `stale_after`.
* `log.md` (optional): update history, newest first, under `## YYYY-MM-DD` headings.
* Any number of further concept files. Each needs frontmatter with a non-empty `type`.

Freshness is the newest file modification time in the bundle, computed at request time. A bundle whose `stale_after` date has arrived is flagged stale.

## Skills

A skill folder follows agentskills.io: `SKILL.md` with `name` (equal to the folder) and `description`, optional `license`, `compatibility`, `metadata` and `allowed-tools`, plus optional `scripts/`, `references/` and `assets/`. The schema is strict, so unknown frontmatter keys are errors.

## References

A reference points outside the repo. Its `type` selects the field set:

| Type | Fields |
| --- | --- |
| `local-repo` | `path`, optional `subpath`, `owner` |
| `remote-repo` | `uri` (git URI), optional `subpath`, `owner` |
| `remote-skill` | `uri` (git URI or HTTPS archive), `subpath` (empty or absent means the repo or archive root), `owner` |

`owner` is `me` or `not-me`. All reference types also carry `name`, `description` and optional `tags`.

### URI rules

One pure helper, `src/lib/remote-uri.ts` (`isGitUri`, `isArchiveUri`, `classifyRemoteUri`), backs the schema, `add-entry`, the search text and the badges. A git URI is SCP-style SSH (`git@github.com:org/repo.git`), `ssh://git@host/org/repo.git`, or HTTPS `https://host/org/repo` with or without `.git`; credentials, query strings and fragments are rejected. A `remote-skill` `uri` may instead be an HTTPS URL whose path ends in `.tar.gz`, `.tgz` or `.zip`. The two kinds never overlap, and `remote-repo` accepts git URIs only. The `git` or `archive` badge on list rows, the detail page and the search body is derived from the URI, never stored.

## Contexts

A context aggregates links to the other nine linkable datasets (everything except `context` and `recipe`), each with optional markdown notes for the consuming agent. See [Context forge](/concepts/context-forge.md). Contexts never copy the linked content; [Context inflate](/concepts/context-inflate.md) reads them at generate time.

## Recipes

A recipe is the saved input of the [Context inflate](/concepts/context-inflate.md) tool: which contexts to expand, extra items, how each item is included, the order, injected markdown and a preamble, for one target (`claude-code`, `codex` or `generic`). Like a context it is a pointer file: it stores slugs and settings, never the linked content. Fields: `name`, `description`, `tags`, `target`, `layout`, `preamble`, `contexts`, `items`, `markdown`, `overrides`, `order`, `defaults`. The schema is strict and rejects duplicates and modes that do not fit an item kind. A recipe may list contexts and items of any linkable dataset but is not itself linkable: a context cannot link to a recipe, so recipes do not appear in the Forge or in the Inflate item search (a `ctxman:recipe/<name>` link in markdown still resolves to the recipe page). The name cannot be changed after creation. Recipes are always read and written through `src/lib/recipe-io.ts` (atomic write), never through `getCollection('recipe')`.

## Links between entries

* Inside a bundle, use bundle-root paths (`/concepts/x.md`) or relative paths (`./x.md`). The link check requires the target file to exist.
* Between entries, use the `ctxman:` scheme: `ctxman:<dataset>/<slug>`, for example the feature [context-forge](ctxman:feature/context-forge). A path such as `/feature/x` would be read as a path inside the current bundle, which is why a separate scheme exists. The site rewrites these links to the entry page; the link check warns when the target is missing.

## Related

* [Adding entries](/concepts/adding-entries.md) scaffolds each shape correctly.
* [Compliance checks](/concepts/compliance-checks.md) enforces them.
