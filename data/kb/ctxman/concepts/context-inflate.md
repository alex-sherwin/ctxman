---
type: Concept
title: Context inflate
description: How recipes turn contexts and extra items into one markdown document for Claude Code, Codex or a generic agent, including modes, targets, output format, API and write-path safety.
tags: [inflate, recipe, context, agents]
generated:
  by: claude-code/ctxman-inflate-docs
  at: 2026-10-17T14:00:00Z
---

# Context inflate

A [context](/concepts/context-forge.md) is only a list of pointers. **Context inflate** is the step that reads what those pointers lead to, right now, and prepares it for a coding agent session: one markdown document plus a JSON manifest. The tool lives at `/inflate`; the saved compositions are **recipes** (dataset `recipe`, listed at `/recipe`). The original idea record is [context-inflate](ctxman:idea/context-inflate).

Contexts stay evergreen. A recipe stores slugs, never content, and expansion happens every time you generate, so editing a linked entry or adding a link to a context changes the next output without touching the recipe.

## What a recipe holds

A recipe is `data/recipe/<name>.yaml`. It selects contexts, adds ad hoc items, says how each item is included, fixes the order, and injects your own markdown. The seed `ctxman-dev-brief` shows every part:

```yaml
name: ctxman-dev-brief
description: Session brief for working on ctxman itself, built from the ctxman-dev context plus the add-entry skill.
tags:
  - ctxman
target: claude-code
layout: grouped
preamble: |
  You are working on ctxman, a local-only Astro app. Use pnpm only, never npm.
contexts:
  - ctxman-dev
items:
  - dataset: skill
    slug: ctxman-add-entry
markdown:
  - id: b1
    body: |
      ## Ground rules
      - Keep `AGENTS.md` current in the same change as the code.
overrides:
  - key: kb/ctxman
    mode: inline-bundle
  - key: bug/stale-badge-timezone
    exclude: true
  - key: reference/astro-docs
    mode: clone
    options:
      sparse: true
order:
  - md:b1
  - ctx:ctxman-dev
```

| Field | Meaning |
| --- | --- |
| `name`, `description` | Required. `name` equals the file stem and cannot be changed after creation. |
| `tags` | Optional; written only when non-empty. |
| `target` | `claude-code` (default), `codex` or `generic`. |
| `layout` | `grouped` (default; one `##` section per context) or `flat` (items only). |
| `preamble` | Markdown placed verbatim at the top of the document, below the header. |
| `contexts` | Context slugs, in order. Always written, also as `[]`. |
| `items` | Ad hoc `{dataset, slug}` entries that are not (necessarily) linked by a context. Any dataset a context may link to; recipes cannot be linked. |
| `markdown` | Injected blocks `{id, body}`; `id` is kebab-case, new blocks are named `b1`, `b2` and so on. |
| `overrides` | Per-item `{key, mode?, options?, exclude?}`, where `key` is `<dataset>/<slug>`. Entries that set nothing are dropped when saving. |
| `order` | Segment keys that pin the order (see below). Written only when non-empty. |
| `defaults` | Per item kind `{mode?, options?}`, keyed by `kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project`, `skill`, `local-repo`, `remote-repo` or `remote-skill`. |

Segment keys are `<dataset>/<slug>` for an item, `md:<id>` for a markdown block, `ctx:<slug>` for a context heading and the fixed `sec:extra` for the "Additional items" heading.

The schema is strict: unknown keys are errors, duplicates (contexts, items, block ids, override keys, order keys) are errors, and a mode that does not apply to the item kind is an error. The serializer writes a fixed key order, so saving through the UI or API gives stable diffs.

## Expansion rules (evergreen)

Expansion is a pure function (`src/lib/inflate/expand.ts`) shared by the server and the Inflate island:

1. Contexts are read in recipe order. A missing or invalid context becomes a warning and is skipped.
2. Every link of every ready context registers an item the first time it is seen. An item linked by two contexts appears once, under the first one; the notes of every context that links it are kept, in context order, and the `via` list names them all.
3. Ad hoc `items` are added after the links. An item that is both linked and ad hoc is still a single segment.
4. Default order, grouped layout: for each context its `## Context:` heading followed by the items it owns, then `## Additional items` with the ad hoc items no context links, then the markdown blocks. Flat layout: items in first-seen order, then the blocks. A context heading also names the items it links that appear in another section ("Also relevant here").
5. `order` is applied on top: keys listed keep your order, keys that no longer exist are ignored, and a key the recipe has never seen (a link added to a context later) is inserted right after its default predecessor. New links therefore show up without editing the recipe.
6. A missing or unreadable item is skipped with a warning; the document still renders.
7. `overrides` with `exclude: true` drop an item. An override whose key matches nothing in the recipe is stale: it is ignored with a warning.
8. Mode and options resolve in layers: built-in default for the item kind and target, then `defaults[kind]`, then the item's override. A mode that does not apply to the kind falls back with a `mode-invalid` warning.

## Include modes

Which modes exist depends on the item kind. The first mode of a family is not necessarily the default; see the default column.

| Item kind | Modes (option ids) | Default (claude-code, codex / generic) |
| --- | --- | --- |
| `kb`, `rca` | `inline-main`, `inline-bundle`, `summary`, `pointer` | `inline-main` |
| `idea`, `task`, `bug`, `feature`, `project` | the same four | `summary` |
| `skill` | `install`, `inline`, `pointer` | `install` / `pointer` |
| reference `local-repo` | `describe`, `tree` | `describe` |
| reference `remote-repo` | `describe`, `clone` | `describe` |
| reference `remote-skill` | `install`, `describe` | `install` / `describe` |

What each mode writes:

| Mode | Output |
| --- | --- |
| `inline-main` | The entry's `main.md` body, plus a line listing the bundle's other concept files by relative path. |
| `inline-bundle` | `main.md`, then every concept file under its own heading, in `index.md` order, then non-markdown files as a path list. |
| `summary` | Meta line plus the description. |
| `pointer` | One line with the description and the absolute path to read. |
| `install` (skill) | A shell block that copies (or symlinks) the skill folder into the target's skills directory. |
| `inline` (skill) | `SKILL.md` body plus a list of the skill's other files. |
| `describe` | Description and where the thing is (path or URI). |
| `tree` | `describe`, then the top-level entries of the local path (`treeLimit`). |
| `clone` | `git clone` commands into the project. |
| `install` (remote-skill) | Commands that clone or download the skill into the skills directory. |

Options a mode accepts (others are ignored and not stored):

| Option | Control | Default | Used by |
| --- | --- | --- | --- |
| `includeFrontmatter` | checkbox | off | `inline-main`, `inline-bundle`, skill `inline` |
| `includeLog` | checkbox | off | `inline-bundle` |
| `shiftHeadings` | checkbox | on | the inline modes: nests the item's headings under its section |
| `rewriteLinks` | checkbox | on | the inline modes: bundle and `ctxman:` links become absolute file paths |
| `eager` | checkbox | off | `pointer`: load the file up front (see targets) |
| `symlink` | checkbox | off | skill `install` |
| `treeLimit` | select 10, 25, 50, 100, 200, 500 | 50 | `tree` |
| `cloneDir` | text | `.ctxman/refs/{name}` | `clone`; project-relative, letters, digits, `. _ -` and `/`, no `..`; `{name}` is the reference name |
| `shallow` | checkbox | on | `clone`: `--depth 1` |
| `sparse` | checkbox | off | `clone`: sparse checkout of the reference's `subpath` |

## Targets

| | `claude-code` | `codex` | `generic` |
| --- | --- | --- | --- |
| Label | Claude Code | Codex | Generic agent |
| Skills directory | `.claude/skills` | `.agents/skills` | `.agents/skills` |
| Instructions file named in the header | `CLAUDE.md` | `AGENTS.md` | none (no skills line) |
| `eager` pointer | `Read it before starting: @/abs/path` | ``Read `/abs/path` before starting.`` | same as codex |
| Default skill mode | `install` | `install` | `pointer` |
| Default remote-skill mode | `install` | `install` | `describe` |

Everything else is identical across targets. Only an `eager` pointer uses the bare `@path` form, because Claude Code loads a file the moment it sees `@path`; every other path is in backticks, which suppresses that expansion.

## Output format

The document is the header, the preamble (if any) and then the segments, separated by blank lines:

~~~~markdown
# ctxman-dev-brief

> Prepared by ctxman for a Claude Code session.
> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.
> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.

You are working on ctxman, a local-only Astro app.

## Context: ctxman-dev

Everything an agent needs to work on ctxman itself.

### ctxman

`kb/ctxman` · Knowledge Base · tags: ctxman · `/abs/data/kb/ctxman/main.md`

> **From context `ctxman-dev`:** Start here.

...the entry body, headings shifted below the item heading...

## Additional items

### ctxman-add-entry

`skill/ctxman-add-entry` · Skill · `/abs/data/skill/ctxman-add-entry`

Install this skill into the project (run from the project root):

```sh
mkdir -p .claude/skills
cp -R /abs/data/skill/ctxman-add-entry .claude/skills/ctxman-add-entry
```
~~~~

Details:

* Heading levels: context and "Additional items" headings are `##`; an item is `###` in the grouped layout (`##` when it sits outside a context group or the layout is flat); the item's own headings are shifted below it. A leading H1 that repeats the entry title is dropped.
* The meta line is the item key, the kind label, then state, stale marker, owner, tags and location when they apply.
* Context notes become `> **From context ...:**` blockquotes ahead of the item body.
* Absolute links: with `rewriteLinks`, `/concepts/x.md`, relative `./x.md` and `ctxman:` links become absolute file paths (the link text stays), so the agent can open them directly. Links inside code are untouched and unresolvable targets are left as written.
* Shell commands quote every value, fenced blocks grow their fence when the content contains backticks, and `.ctxman/` is the scratch directory for clones and downloads inside the project (keep it out of version control).
* The manifest returned with the document lists every segment with key, kind, mode, options, `via`, source path, bytes and status (`included`, `excluded`, `missing`, `invalid`), plus counts, contexts, total bytes and de-duplicated warnings. Warning codes: `context-missing`, `context-invalid`, `item-missing`, `item-invalid`, `mode-invalid`, `override-stale`, `path-missing`, `file-unreadable` and `large-output` (over 512 KB).

## API

All routes use the shared JSON conventions (see [Routes and API](/concepts/routes-and-api.md)): `no-store`, `{error, message, issues?}` errors, 415 for non-JSON, 403 for a foreign `Origin`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/recipe/<slug>` | Read a recipe: `{ recipe, lastModified }`. |
| `POST /api/recipe` | Create a recipe (201 with `Location: /recipe/<name>`, 409 if it exists). |
| `PUT /api/recipe/<slug>` | Replace a recipe; `name` must equal the slug (400 `name-mismatch` otherwise). |
| `DELETE /api/recipe/<slug>` | Delete a recipe (204). |
| `POST /api/inflate/render` | Body is a recipe, saved or not. Returns `{ markdown, manifest }`; 400 `invalid` with `issues` when the recipe fails its schema. Nothing is written. |
| `POST /api/inflate/write` | Body `{ recipe, path }`. Renders, writes the markdown to `path`, returns `{ path, bytes, manifest }`. Errors: 400 `invalid` (recipe issues are prefixed `recipe.`), 400 `bad-path`, 400 `write-failed`. |

There is no options endpoint: the modes, targets and options tables live in the pure module `src/lib/inflate/catalog.ts`, which the island imports directly.

## Write-path safety

`/api/inflate/write` is the only place the tool writes outside `data/recipe`. The server is local-only and checks `Origin`, and the path must pass these rules (first failure wins):

1. A non-empty string of at most 1024 characters without NUL.
2. Absolute (relative paths are refused, so the output never lands somewhere implied by the server's working directory).
3. Ends in `.md`.
4. No `node_modules` or `.git` segment.
5. Not inside the data directory, so output can never overwrite a dataset.

The file is written to a temporary sibling and renamed, parent directories are created, and an existing directory at the path is refused. Paths outside the home directory are allowed (the end-to-end tests write under the OS temp directory). The default target in the UI is `out/<recipe>.md` in the repo, which is gitignored and ignored by the linter and formatter.

## The /inflate page

One React island with two views, selected by the URL parameter `view` (`compose` or `preview`):

* **Compose** has a sources pane (description, preamble editor, contexts to tick, default mode per item kind, ad hoc search and "+ Markdown block") and a composition pane (each segment with up and down buttons, exclude or remove, a mode select and the mode's options, markdown editors, warnings). The list is the same pure expansion the server runs, so reordering and mode changes show immediately.
* **Preview** renders the real document through `POST /api/inflate/render` about 400 ms after the last edit, with Copy, Download .md, "Write to path" and the manifest table.

URL parameters: `recipe` (a recipe name, or `new` for the create dialog), `view`, `dataset` (the ad hoc discovery tab) and `q` (its text filter). Save with the button or Cmd/Ctrl+S; unsaved edits are guarded when you switch recipes or leave. A recipe's own page at `/recipe/<name>` shows its composition read-only with an "Open in Inflate" button.

## Code map

All under `src/lib/inflate/`:

| File | Kind | Role |
| --- | --- | --- |
| `catalog.ts` | pure | Targets, layouts, item kinds, modes, options, segment keys |
| `recipe.ts` | pure | Parse, normalize and serialize a recipe; `sameRecipe` for the dirty check |
| `expand.ts` | pure | `expandRecipe` and `applyOrder` |
| `markdown.ts` | node (no fs) | Heading shifting, link rewriting, fences, quoting |
| `render.ts` | node (no fs) | Plan plus gathered content to document and manifest |
| `pipeline.ts` | node (no fs) | Loads inputs, gathers file content, runs expand and render |
| `fs-sources.ts` | node | The filesystem implementation of the pipeline's sources |
| `write.ts` | node | Output path checks and the atomic write |

Recipes are read and written through `src/lib/recipe-io.ts` (the mirror of `context-io.ts`), never through `getCollection('recipe')`; see [Runtime modes](/concepts/runtime-modes.md). The island may import only the pure files. Related: [Architecture](/concepts/architecture.md), [Datasets](/concepts/datasets.md) and [Compliance checks](/concepts/compliance-checks.md) for the recipe warnings.
