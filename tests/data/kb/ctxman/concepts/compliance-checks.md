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

Three Node scripts validate everything in the data directory (`CTXMAN_DATA_DIR`, required; from the shell or a `.env` file, exit code 2 when it is unset), and a fourth keeps the generated JSON Schemas honest. The data checks share the arktype Types the site uses (through `validate()`), so a file they accept is one the site accepts. The rule ids keep the `collections/` prefix for history; there are no content collections any more. To check the sample corpus run `CTXMAN_DATA_DIR=tests/data pnpm run check`.

| Command | What it does |
| --- | --- |
| `pnpm run check` | Runs all three data checks, then `check:schemas`; no `astro sync` |
| `pnpm run check:data` | Runs the three data checks in one process and prints a combined report |
| `pnpm run check:okf` | OKF v0.2 conformance of every bundle |
| `pnpm run check:links` | Intra-bundle and `ctxman:` link validity |
| `pnpm run check:collections` | Every data file against its dataset schema |
| `pnpm run check:schemas` | `schemas/*.schema.json` against a fresh generation from the arktype Types (repo level, independent of `CTXMAN_DATA_DIR`) |
| `pnpm run gen:schemas` | Regenerates `schemas/*.schema.json` (writes only the files that change) |
| `pnpm run fix:yaml-comments` | Adds or repairs line 1 of every reference, context and recipe file |
| `pnpm run typecheck` | `astro sync` (page types only, needs no data), then `tsc --noEmit --runExternalCode -p tsconfig.json` |
| `pnpm run test:prod` | Smoke test of the built server against a temp copy of `tests/data` (run `pnpm run build` first) |

Add `--json` to a check or `fix:yaml-comments` script for machine-readable output. Exit code 0 means no errors; warnings never fail a run. The same checks run from the `/tools` page.

## OKF rules (`check:okf`)

Errors include a bundle without `index.md` (`okf/missing-index`, the entry), a concept without parseable frontmatter or a non-empty `type`, a root `index.md` that fails its dataset schema, a `name` that differs from the folder, a root `okf_version` other than `"0.2"` (`okf/index-frontmatter`), any frontmatter on a nested `index.md` or on `log.md`, a `log.md` heading that is not `YYYY-MM-DD`, and a `stale_after` that is not a `YYYY-MM-DD` date.

Warnings include a root `index.md` without `okf_version` (`okf/index-version`), an entry whose `type` differs from the registry value, log dates that are not newest-first, and a footnote reference whose id has neither a definition nor a matching `sources` id.

## Link rules (`check:links`)

Checked in every OKF bundle and every skill folder. A bundle-root link (`/x.md`) or relative link (`./x.md`) to a missing file is an error, as is a link that escapes the bundle. External URLs and in-page anchors are skipped. A `ctxman:` link with bad syntax is an error; one that points at a missing entry is a warning, because entries may be deleted while links lag behind.

The structured `links` of an okf entry `index.md` (see [Relations](/concepts/relations.md)) get two more rules, reported on the line of the `links:` key:

| Rule id | Severity | Fires when |
| --- | --- | --- |
| `links/relation-target` | warning | A frontmatter link points at an entry that does not exist (`relation target <dataset>/<slug> does not exist`) |
| `links/relation-self` | error | An entry links to itself (`an entry cannot link to itself`) |

A malformed link item or a duplicate target is not reported here: it fails the dataset schema (`okf/entry-schema` in `check:okf`, `collections/schema` in `check:collections`). The same file-level link findings (`links/broken`, `links/escapes-bundle`, `links/ctxman-invalid`, `links/ctxman-target`, and the two relation rules for an entry `index.md`) come back as `warnings` from `PUT /api/doc/...`, so a save from the browser shows what the CLI would say.

## Collection rules (`check:collections`)

Reports every schema violation at once instead of stopping at the first. It also checks that names equal folder or file stems, that skills have a `SKILL.md`, that context link targets exist (warning), and flags stray files and unknown top-level folders in the data directory. Recipes (`recipe/*.yaml`) are validated against the recipe schema like every other dataset. Messages use arktype's wording (for example `name must be a string (was missing)`); the UI maps the common ones to friendlier text ("Required", invalid date, `Unrecognized key "x"`).

Four warning rules cover what a schema-valid recipe points at (`file` is `recipe/<name>.yaml`). They are warnings, because contexts and entries can be deleted while a recipe lags behind:

| Rule id | Fires when |
| --- | --- |
| `collections/recipe-context-missing` | A listed context has no file in `context/` |
| `collections/recipe-item-missing` | An ad hoc item's entry file does not exist |
| `collections/recipe-override-stale` | An override key matches no item of the recipe (no listed context links it and it is not an ad hoc item) |
| `collections/recipe-order-stale` | An `order` key matches nothing: not a listed context (`ctx:`), a reachable item, a markdown block (`md:`) or `sec:extra` |

The last two only run when every listed context exists and is schema-valid, because the set of reachable items is unknown otherwise. The Inflate page's "Prune stale" button removes the same leftovers.

Three more warning rules cover the working-directory settings of a recipe (`output` and the material fields; see [Context inflate](/concepts/context-inflate.md)). The schema already rejects a material that does not fit a kind it can name (`defaults`, and an override of a knowledge or skill item); these rules cover what only the data directory can tell:

| Rule id | Fires when |
| --- | --- |
| `collections/recipe-output-dir-relative` | `output.dir` is not absolute and does not start with `~/` (a run refuses it) |
| `collections/recipe-material-invalid` | An override of `reference/<slug>` names a material that does not apply to that reference's type (`clone` needs a remote-repo, `symlink` or `copy` a local-repo or local-folder, `install` a remote-skill); only when the reference exists and is valid |
| `collections/recipe-primary-invalid` | `output.primary` is not a remote-repo or local-repo reference (or is missing; a local-folder is never a primary); or its effective material is not `clone` (remote-repo) / `symlink` (local-repo); or, when every listed context exists and is valid, it is not an item of the recipe |

One more warning rule covers the first line of every reference, context and recipe file:

| Rule id | Fires when |
| --- | --- |
| `collections/yaml-schema-comment` | Line 1 is missing, or is a yaml-language-server comment that does not point at this server's schema endpoint for that dataset: `# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/<dataset>` (the origin is `CTXMAN_SERVER_ORIGIN`; the check accepts any loopback origin and port, and an optional `.schema.json` suffix). `pnpm run fix:yaml-comments` repairs it |

## Schema rules (`check:schemas`)

| Rule id | Severity | Fires when |
| --- | --- | --- |
| `schemas/missing` | error | A `schemas/<dataset>.schema.json` file does not exist; run `pnpm run gen:schemas` |
| `schemas/drift` | error | The file differs from a fresh generation (the message names the first differing line); run `pnpm run gen:schemas` |
| `schemas/stray` | warning | Any other `*.json` file sits in `schemas/` |

Change a yaml dataset in this order: `schemas.ts` (the arktype Type is also the schema source), then `pnpm run gen:schemas`.

## Typechecking

`astro check` is not used. TypeScript 7.1 type-checks `.ts`, `.tsx` and `.astro` files itself through `@astrojs/ts-content-mapper`, registered in `tsconfig.json`. `astro sync` runs first because the generated `.astro/` page types must exist; it reads no data, so typechecking works without `CTXMAN_DATA_DIR`.

## Related

* [Datasets](/concepts/datasets.md) describes the shapes these checks enforce.
* [Adding entries](/concepts/adding-entries.md) produces files that already pass them.
* [Context inflate](/concepts/context-inflate.md) explains the recipes these rules check.
* [Editing](/concepts/editing.md) explains why a document saved from the browser may carry warnings.
* [Relations](/concepts/relations.md) explains the `links` field the two relation rules check.
