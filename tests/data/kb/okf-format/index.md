---
okf_version: "0.2"
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

## Concept files

Every Markdown file except `index.md` and `log.md` is a **concept** (in the OKF reference format; ctxman's deviation for the bundle-root `index.md` is described below). A concept:

* starts with YAML frontmatter delimited by `---`;
* has a non-empty, descriptive `type` (the only universally required field; unknown types are valid);
* usually adds `title`, a one-sentence `description`, `resource` (a canonical URL or path) and short `tags`;
* uses structural Markdown: headings, lists, tables and fenced code.

Unknown frontmatter keys must be preserved. ctxman relies on this: the entry carries extra keys such as `name`, `state` and `generated`.

## What ctxman adds

OKF only requires `type`. ctxman additionally requires, in the entry file (the bundle-root `index.md`): `name` equal to the folder, a non-empty `description`, and `state` for lifecycle datasets. The `type` string for each dataset is fixed by the registry (for example "Knowledge Base" or "Bug"). These extras are enforced by the [compliance checks](ctxman:kb/ctxman) rather than by OKF itself.

Two optional keys, valid on the entry and on any concept, are ctxman's own as well: `index: false` keeps the file out of ctxman's search (on the entry: the whole bundle), and `modified` is the time of the last save in ctxman's markdown editor, written as a quoted UTC date-time to the second (`modified: "2026-10-20T14:03:12Z"`). Other OKF readers keep them as unknown keys.

## Reserved files

In the OKF reference format `index.md` and `log.md` are never concepts, at any depth, and only a bundle-root `index.md` may have frontmatter, then only `okf_version: "0.2"`. See [Bundle navigation](/concepts/navigation.md).

## Where ctxman deviates

ctxman has no separate entry file. The bundle-root `index.md` IS the entry of an okf dataset: its frontmatter starts with `okf_version: "0.2"` and then carries the entry keys (`type`, `name`, `title`, `description`, `state`, `tags`, `links`, provenance), and its body is the entry content, which may end with a `## Links` navigation section listing the bundle's files (ctxman adds a line there whenever a file is created in the UI; older bundles call it `## Concepts`, renamed on the next add). Nested `index.md` files and `log.md` stay frontmatter-free. The OKF reference skill keeps the root index free of concept semantics, so a bundle written for ctxman is a valid OKF bundle for readers that ignore the extra index frontmatter, but not the other way around.

## Trust and freshness

Optional fields describe where content came from, who produced it and when it expires. See [Provenance and lifecycle](/concepts/provenance.md).

## Pitfalls

* Do not invent provenance, verification or freshness dates; omit what you cannot substantiate.
* Do not use the legacy `timestamp` key or a `# Citations` list in new content; use `generated.at` and `sources`.
* A broken link is still valid OKF, but ctxman's link check treats it as an error inside a bundle.

The authoring workflow is packaged as the skill [okf-authoring](ctxman:skill/okf-authoring).

[^okf-skill]: OKF v0.2 authoring skill, vendored at .agents/skills/okf/SKILL.md.

## Links

* [Provenance and lifecycle](/concepts/provenance.md) - sources, footnotes, generated and verified events, status and stale_after.
* [Bundle navigation](/concepts/navigation.md) - links, index.md and log.md rules.
