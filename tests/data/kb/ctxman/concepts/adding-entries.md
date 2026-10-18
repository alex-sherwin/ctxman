---
type: Workflow
title: Adding entries
description: Scaffold new entries with the add scripts, fill them in, and verify them.
tags: [workflow, scripts, authoring]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:10:00Z
---

# Adding entries

Always scaffold with the script instead of copying a folder, so the shape and frontmatter are right. The agent-facing version of this guide is the skill [ctxman-add-entry](ctxman:skill/ctxman-add-entry).

## Command

```bash
pnpm run add:<dataset> <name> [--title "..."] [--description "..."] [--state <state>]
```

`<dataset>` is any of the eleven dataset ids (`kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project`, `skill`, `reference`, `context`, `recipe`), for example `pnpm run add:idea my-idea --title "My idea" --description "One sentence."`. pnpm forwards the extra arguments as they are, so do not add a `--` separator; pnpm 11 passes it through literally and the script rejects it.

Reference entries also take `--type local-repo|remote-repo|remote-skill`, `--path`, `--uri`, `--subpath` and `--owner me|not-me`. Add `--json` for machine output.

The script validates the name (kebab-case, at most 64 characters) and the state, refuses to overwrite anything that exists, writes the files, then re-validates them against the schemas. The same operation is available on the `/tools` page.

## Forms and the Tools page

Every dataset can also be created in the browser at `/new/<dataset>`:

* `reference`, `context` and `recipe` open a form with typed fields and a YAML tab (the DataForm).
* The okf datasets (`kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project`) and `skill` open the NewEntryForm: name (checked live against the existing entries), title, description (required), state (lifecycle datasets, the first state is the default), tags (okf) and, for okf entries, **Part of project**. `POST /api/entry/<dataset>` writes the same files as the script, with the same validation and rollback, then opens the new entry.
* `/new/<dataset>?parent=<project>` preselects the project; on create the project gets a `rel: child` link to the new entry. The Children panel of a project and the "New" button of a list filtered by `?project=` link there.

The `/tools` page still lists the check scripts; its Add Entry panel is now a thin link: pick a dataset, press "Open the New … form" (the equivalent `pnpm run add:<dataset>` command is shown). The CLI stays the way for scripts and agents. Everything is read from the disk, so a created entry is listed, opens and is searchable at once, in the dev server and in a built server. The scripts and forms write into the data directory (`CTXMAN_DATA_DIR`, required; a `.env` file at the repo root works, and the scripts exit with code 2 when it is unset). See [Editing](/concepts/editing.md) and [Relations](/concepts/relations.md).

## What gets created

| Dataset kind | Files |
| --- | --- |
| OKF bundle | `index.md` (the entry: `okf_version`, the frontmatter and starter sections) and `log.md` |
| `skill` | `SKILL.md` with "When to use" and "Instructions" headings |
| `reference` | `<name>.yaml` |
| `context` | `<name>.yaml` with an empty `links` list |
| `recipe` | `<name>.yaml` with target `claude-code`, layout `grouped` and empty `contexts` and `items` lists |

Every yaml file starts with the line `# yaml-language-server: $schema=../../schemas/<dataset>.schema.json`. The script and the forms write it; never strip it, and run `pnpm run fix:yaml-comments` for a file made by hand.
The first state in the dataset's list is the default, so new tasks start as `pending`. Descriptions default to a `TODO:` placeholder; replace it. A new reference also gets placeholder locations (`~/repos/<name>` for `local-repo`, `https://github.com/TODO/<name>.git` for the others) that pass the checks, so replace those too.

Recipes are normally authored in the [Inflate](/concepts/context-inflate.md) UI (`/inflate?recipe=new`), which also offers "Open in Inflate" after creating one on the tools page; `pnpm run add:recipe my-brief --description "..."` creates the same starter file, which you then edit in the UI. Like contexts, recipes have no lifecycle state, so `--state` is refused; `--title` only shapes the default description. The template does not take a target flag: change `target` in the UI or the file. It has no `output` either; set a directory in the Compose view (Output directory) when the recipe should inflate into a working directory.

Starter sections by dataset: kb has Overview and Details; rca has Summary, Timeline, Root cause, Resolution and Prevention; idea has Problem, Proposal and Open questions; task has Goal, Steps and Done when; bug has Symptoms, Reproduction, Expected vs actual, Diagnosis and Fix; feature has Motivation, Requirements, Design and Acceptance criteria; project has Goals, Scope, Milestones and Related.

## After scaffolding

1. Fill in the description, tags and sections. Keep tags lowercase kebab-case.
2. Add concept files under the bundle if the entry needs more than one page. Each needs frontmatter with a `type`; list it in the entry `index.md` (under `## Concepts`; the forms and the API do this for you).
3. Link related entries with `ctxman:<dataset>/<slug>` and bundle files with `/path.md`, and record typed relations (a project's children, `depends-on`) in the `links` frontmatter, or from the entry's Links and Children panels. See [Datasets](/concepts/datasets.md) and [Relations](/concepts/relations.md).
4. Append a dated line to `log.md`, newest first.
5. Run `pnpm run check`; fix every finding. [Compliance checks](/concepts/compliance-checks.md) lists the rules.

Back to the [overview](/index.md).
