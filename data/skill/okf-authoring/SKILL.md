---
name: okf-authoring
description: Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature and project entries) under ctxman's data/ directory. Use when creating or editing markdown in data/<dataset>/<name>/, when pnpm run check reports okf or link findings, or when asked to write something up as a bundle.
compatibility: Intended for the ctxman repository. Needs Node 24 and pnpm to run the checks.
metadata:
  author: ctxman
  version: "1.0"
allowed-tools: Read Edit Write Bash(pnpm run check:*)
---

# OKF authoring in ctxman

ctxman stores seven datasets as Open Knowledge Format (OKF) v0.2 bundles: a folder per entry under `data/<dataset>/<name>/`. This skill covers writing them so they pass the checks. For the format itself see the knowledge base entry [okf-format](ctxman:kb/okf-format).

## When to use

* Adding or editing any markdown file below `data/kb`, `data/rca`, `data/idea`, `data/task`, `data/bug`, `data/feature` or `data/project`.
* Fixing findings from `pnpm run check:okf` or `pnpm run check:links`.
* Turning notes or an investigation into a durable entry.

Do not use it for `skill`, `reference` or `context` entries; those are not OKF bundles.

## Instructions

1. **Scaffold, never copy.** Create new entries with `pnpm run add:<dataset> <name> --description "..."`, then edit the generated files. See the skill `ctxman-add-entry`.
2. **Set the frontmatter of `main.md`.** Required: `type` (fixed per dataset), `name` (equal to the folder), `description`, and `state` for lifecycle datasets. Recommended: `title`, lowercase kebab-case `tags`.
3. **Write concept files** for anything that deserves its own page. Each begins with frontmatter containing a non-empty `type` such as `Concept` or `Reference`.
4. **Link correctly.** Inside the bundle use `/path/to/concept.md` or `./relative.md`. To reference another entry use `ctxman:<dataset>/<slug>`. Never use `/dataset/slug` for entries.
5. **Record provenance only when true.** Add `sources` (with an `id` when a footnote cites it), `generated` with `by` and an ISO 8601 `at`, and `stale_after` as `YYYY-MM-DD` when content expires. Do not invent verification.
6. **Maintain navigation.** List every concept in the bundle-root `index.md`, whose only frontmatter is `okf_version: "0.2"`. Add a dated line to `log.md`, newest first. Neither file is a concept and neither may have other frontmatter.
7. **Verify.** Run `pnpm run check`. Fix every error and warning; the goal is zero of both.

## Quick reference

* Name rule: lowercase letters, digits and single hyphens, at most 64 characters.
* Lifecycle states are stored kebab-case: `pending`, `in-progress`, `complete`, `abandoned`, `fixed`, `wont-do`, `wont-fix` depending on the dataset.
* `status` is `draft`, `stable` or `deprecated`.

The full preflight list is in [the checklist](references/checklist.md). The ctxman concepts and rules are summarised in [ctxman](ctxman:kb/ctxman).
