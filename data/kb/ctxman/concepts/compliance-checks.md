---
type: Reference
title: Compliance checks
description: The check scripts, what rule ids they report and how typechecking is chained.
tags: [checks, okf, links, typecheck]
generated:
  by: claude-code/ctxman-seed
  at: 2026-10-17T09:55:00Z
---

# Compliance checks

Three Node scripts validate everything under `data/`, and a fourth keeps the generated JSON Schemas honest. The data checks share the zod schemas Astro uses, so a file they accept is one the site accepts.

| Command | What it does |
| --- | --- |
| `pnpm run check` | Runs all three data checks, then `check:schemas`, then `astro sync` |
| `pnpm run check:data` | Runs the three data checks in one process and prints a combined report |
| `pnpm run check:okf` | OKF v0.2 conformance of every bundle |
| `pnpm run check:links` | Intra-bundle and `ctxman:` link validity |
| `pnpm run check:collections` | Every data file against its dataset schema |
| `pnpm run check:schemas` | `schemas/*.schema.json` against a fresh generation from the arktype models (repo level, independent of `CTXMAN_DATA_DIR`) |
| `pnpm run gen:schemas` | Regenerates `schemas/*.schema.json` (writes only the files that change) |
| `pnpm run fix:yaml-comments` | Adds or repairs line 1 of every reference, context and recipe file |
| `pnpm run typecheck` | `astro sync`, then `tsc --noEmit --runExternalCode -p tsconfig.json` |

Add `--json` to a check or `fix:yaml-comments` script for machine-readable output. Exit code 0 means no errors; warnings never fail a run. The same checks run from the `/tools` page.

## OKF rules (`check:okf`)

Errors include a bundle without `main.md`, a concept without parseable frontmatter or a non-empty `type`, a `main.md` that fails its dataset schema, a `name` that differs from the folder, a root `index.md` with frontmatter other than `okf_version: "0.2"`, any frontmatter on a nested `index.md` or on `log.md`, a `log.md` heading that is not `YYYY-MM-DD`, and a `stale_after` that is not a `YYYY-MM-DD` date.

Warnings include a `main.md` whose `type` differs from the registry value, a missing root `index.md`, log dates that are not newest-first, and a footnote reference whose id has neither a definition nor a matching `sources` id.

## Link rules (`check:links`)

Checked in every OKF bundle and every skill folder. A bundle-root link (`/x.md`) or relative link (`./x.md`) to a missing file is an error, as is a link that escapes the bundle. External URLs and in-page anchors are skipped. A `ctxman:` link with bad syntax is an error; one that points at a missing entry is a warning, because entries may be deleted while links lag behind.

## Collection rules (`check:collections`)

Reports every schema violation at once instead of stopping at the first, which is what `astro sync` does. It also checks that names equal folder or file stems, that skills have a `SKILL.md`, that context link targets exist (warning), and flags stray files and unknown top-level folders under `data/`. Recipes (`data/recipe/*.yaml`) are validated against the recipe schema like every other dataset.

Four warning rules cover what a schema-valid recipe points at (`file` is `recipe/<name>.yaml`). They are warnings, because contexts and entries can be deleted while a recipe lags behind:

| Rule id | Fires when |
| --- | --- |
| `collections/recipe-context-missing` | A listed context has no file in `data/context/` |
| `collections/recipe-item-missing` | An ad hoc item's entry file does not exist |
| `collections/recipe-override-stale` | An override key matches no item of the recipe (no listed context links it and it is not an ad hoc item) |
| `collections/recipe-order-stale` | An `order` key matches nothing: not a listed context (`ctx:`), a reachable item, a markdown block (`md:`) or `sec:extra` |

The last two only run when every listed context exists and is schema-valid, because the set of reachable items is unknown otherwise. The Inflate page's "Prune stale" button removes the same leftovers.

One more warning rule covers the first line of every reference, context and recipe file:

| Rule id | Fires when |
| --- | --- |
| `collections/yaml-schema-comment` | Line 1 is not exactly `# yaml-language-server: $schema=../../schemas/<dataset>.schema.json` (missing, or a different yaml-language-server comment). `pnpm run fix:yaml-comments` repairs it |

## Schema rules (`check:schemas`)

| Rule id | Severity | Fires when |
| --- | --- | --- |
| `schemas/missing` | error | A `schemas/<dataset>.schema.json` file does not exist; run `pnpm run gen:schemas` |
| `schemas/drift` | error | The file differs from a fresh generation (the message names the first differing line); run `pnpm run gen:schemas` |
| `schemas/stray` | warning | Any other `*.json` file sits in `schemas/` |

Change a yaml dataset in this order: `schemas.ts`, `arktypes.ts` (a parity test fails when they disagree), then `pnpm run gen:schemas`.

## Typechecking

`astro check` is not used. TypeScript 7.1 type-checks `.ts`, `.tsx` and `.astro` files itself through `@astrojs/ts-content-mapper`, registered in `tsconfig.json`. `astro sync` runs first because the generated `.astro/` types must exist, and it fails on the first invalid data file, so fix data before typechecking.

## Related

* [Datasets](/concepts/datasets.md) describes the shapes these checks enforce.
* [Adding entries](/concepts/adding-entries.md) produces files that already pass them.
* [Context inflate](/concepts/context-inflate.md) explains the recipes these rules check.
* [Editing](/concepts/editing.md) explains why a document saved from the browser may carry warnings.
