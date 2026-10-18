---
type: Knowledge Base
name: okf-format
title: OKF format
description: Summary of Open Knowledge Format v0.2 as ctxman applies it, covering concepts, frontmatter, provenance and bundle navigation.
tags: [okf, format, markdown]
sources:
  - id: okf-skill
    resource: .agents/skills/okf/SKILL.md
    title: OKF v0.2 authoring skill
  - id: okf-refs
    resource: .agents/skills/okf/references/concepts-and-conformance.md
    title: OKF concepts and conformance reference
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:15:00Z
status: stable
---

# OKF format

Open Knowledge Format (OKF) v0.2 is a convention for portable, human-readable knowledge: a **bundle** is a directory tree of ordinary Markdown files. Seven ctxman datasets (kb, rca, idea, task, bug, feature, project) store each entry as one bundle.[^okf-skill]

## Concepts

Every Markdown file except `index.md` and `log.md` is a **concept**. A concept:

* starts with YAML frontmatter delimited by `---`;
* has a non-empty, descriptive `type` (the only universally required field; unknown types are valid);
* usually adds `title`, a one-sentence `description`, `resource` (a canonical URL or path) and short `tags`;
* uses structural Markdown: headings, lists, tables and fenced code.

Unknown frontmatter keys must be preserved. ctxman relies on this: `main.md` carries extra keys such as `name`, `state` and `generated`.

## What ctxman adds

OKF only requires `type`. ctxman additionally requires, in the entry file `main.md`: `name` equal to the folder, a non-empty `description`, and `state` for lifecycle datasets. The `type` string for each dataset is fixed by the registry (for example "Knowledge Base" or "Bug"). These extras are enforced by the [compliance checks](ctxman:kb/ctxman) rather than by OKF itself.

## Reserved files

`index.md` and `log.md` are never concepts, at any depth. Only a bundle-root `index.md` may have frontmatter, and then only `okf_version: "0.2"`. See [Bundle navigation](/concepts/navigation.md).

## Trust and freshness

Optional fields describe where content came from, who produced it and when it expires. See [Provenance and lifecycle](/concepts/provenance.md).

## Pitfalls

* Do not invent provenance, verification or freshness dates; omit what you cannot substantiate.
* Do not use the legacy `timestamp` key or a `# Citations` list in new content; use `generated.at` and `sources`.
* A broken link is still valid OKF, but ctxman's link check treats it as an error inside a bundle.

The authoring workflow is packaged as the skill [okf-authoring](ctxman:skill/okf-authoring).

[^okf-skill]: OKF v0.2 authoring skill, vendored at .agents/skills/okf/SKILL.md.
