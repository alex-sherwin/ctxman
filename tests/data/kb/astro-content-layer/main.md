---
type: Knowledge Base
name: astro-content-layer
title: Astro content layer
description: How Astro 7 content collections, loaders and schemas work, and how ctxman uses them for its datasets.
tags: [astro, content-collections, zod]
sources:
  - id: astro-collections
    resource: https://docs.astro.build/en/guides/content-collections/
    title: Astro docs, content collections
  - id: astro-loader-ref
    resource: https://docs.astro.build/en/reference/content-loader-reference/
    title: Astro docs, content loader reference
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T10:30:00Z
status: stable
stale_after: 2026-01-01
---

# Astro content layer

A content collection is a typed set of entries produced by a **loader** and validated by a **schema**. ctxman defines one collection per dataset in `src/content.config.ts`, plus a `docs` collection that holds every markdown file of every OKF bundle.

## How ctxman uses it

| Collection | Loader | Entry id |
| --- | --- | --- |
| `kb`, `rca`, `idea`, `task`, `bug`, `feature`, `project` | glob, pattern `*/main.md` | bundle folder name |
| `skill` | glob, pattern `*/SKILL.md` | skill folder name |
| `reference` | glob, pattern `*.yaml` | file stem |
| `context` | custom loader without a file watcher | file stem |
| `docs` | glob over all markdown files in OKF bundles | path without `.md`, such as `kb/ctxman/index` |

See [Glob loader](/concepts/glob-loader.md) for the options that matter.

## Facts worth remembering

* Astro and the repo share one zod 4 instance, so schemas written with plain `zod` in `src/datasets/schemas.ts` work in `defineCollection`, and Node scripts can import the same file.
* `astro sync` validates every entry and exits with status 1 on the first invalid one. That makes it a compliance check as well as a type generator.
* `getEntry(collection, id)` and `getCollection(collection)` come from `astro:content`, which does not exist in plain Node scripts or in Vitest.
* An entry's `rendered.html` holds its rendered markdown. Links are emitted as written, so ctxman rewrites `href` values in that HTML and prints it with `set:html` instead of using the `<Content />` component.
* Frontmatter is parsed with the `yaml` package using the timestamp tag, so an unquoted `2026-12-01` becomes a `Date`. Schemas therefore coerce dates.

## Freshness of this entry

This entry is deliberately marked stale (its `stale_after` is in the past) so the dashboard and list filters have a stale item to show. The facts match the verified Astro 7.4.0 notes in the plan; re-verify after any Astro upgrade, and treat the [runtime modes](ctxman:kb/ctxman) caveats as the live reference for dev versus build behaviour.

The runtime failure mode that shaped the `context` collection is analysed in [astro-dev-full-reload-on-save](ctxman:rca/astro-dev-full-reload-on-save).
