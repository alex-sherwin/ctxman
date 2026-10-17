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

`<dataset>` is any of the ten dataset ids, for example `pnpm run add:idea my-idea --title "My idea" --description "One sentence."`. pnpm forwards the extra arguments as they are, so do not add a `--` separator; pnpm 11 passes it through literally and the script rejects it.

Reference entries also take `--type local-repo|remote-repo|remote-skill`, `--path`, `--uri`, `--subpath` and `--owner me|not-me`. Add `--json` for machine output.

The script validates the name (kebab-case, at most 64 characters) and the state, refuses to overwrite anything that exists, writes the files, then re-validates them against the schemas. The same operation is available on the `/tools` page.

## What gets created

| Dataset kind | Files |
| --- | --- |
| OKF bundle | `index.md`, `main.md` with starter sections, `log.md` |
| `skill` | `SKILL.md` with "When to use" and "Instructions" headings |
| `reference` | `<name>.yaml` |
| `context` | `<name>.yaml` with an empty `links` list |

The first state in the dataset's list is the default, so new tasks start as `pending`. Descriptions default to a `TODO:` placeholder; replace it. A new reference also gets placeholder locations (`~/repos/<name>` for `local-repo`, `https://github.com/TODO/<name>.git` for the others) that pass the checks, so replace those too.

Starter sections by dataset: kb has Overview and Details; rca has Summary, Timeline, Root cause, Resolution and Prevention; idea has Problem, Proposal and Open questions; task has Goal, Steps and Done when; bug has Symptoms, Reproduction, Expected vs actual, Diagnosis and Fix; feature has Motivation, Requirements, Design and Acceptance criteria; project has Goals, Scope, Milestones and Related.

## After scaffolding

1. Fill in the description, tags and sections. Keep tags lowercase kebab-case.
2. Add concept files under the bundle if the entry needs more than one page. Each needs frontmatter with a `type`; list it in the bundle's `index.md`.
3. Link related entries with `ctxman:<dataset>/<slug>` and bundle files with `/path.md`. See [Datasets](/concepts/datasets.md).
4. Append a dated line to `log.md`, newest first.
5. Run `pnpm run check`; fix every finding. [Compliance checks](/concepts/compliance-checks.md) lists the rules.

Back to the [overview](/main.md).
