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

Three Node scripts validate everything under `data/`. They share the zod schemas Astro uses, so a file they accept is one the site accepts.

| Command | What it does |
| --- | --- |
| `pnpm run check` | Runs all three data checks, then `astro sync` |
| `pnpm run check:data` | Runs the three data checks in one process and prints a combined report |
| `pnpm run check:okf` | OKF v0.2 conformance of every bundle |
| `pnpm run check:links` | Intra-bundle and `ctxman:` link validity |
| `pnpm run check:collections` | Every data file against its dataset schema |
| `pnpm run typecheck` | `astro sync`, then `tsc --noEmit --runExternalCode -p tsconfig.json` |

Add `--json` to a check script for machine-readable output. Exit code 0 means no errors; warnings never fail a run. The same checks run from the `/tools` page.

## OKF rules (`check:okf`)

Errors include a bundle without `main.md`, a concept without parseable frontmatter or a non-empty `type`, a `main.md` that fails its dataset schema, a `name` that differs from the folder, a root `index.md` with frontmatter other than `okf_version: "0.2"`, any frontmatter on a nested `index.md` or on `log.md`, a `log.md` heading that is not `YYYY-MM-DD`, and a `stale_after` that is not a `YYYY-MM-DD` date.

Warnings include a `main.md` whose `type` differs from the registry value, a missing root `index.md`, log dates that are not newest-first, and a footnote reference whose id has neither a definition nor a matching `sources` id.

## Link rules (`check:links`)

Checked in every OKF bundle and every skill folder. A bundle-root link (`/x.md`) or relative link (`./x.md`) to a missing file is an error, as is a link that escapes the bundle. External URLs and in-page anchors are skipped. A `ctxman:` link with bad syntax is an error; one that points at a missing entry is a warning, because entries may be deleted while links lag behind.

## Collection rules (`check:collections`)

Reports every schema violation at once instead of stopping at the first, which is what `astro sync` does. It also checks that names equal folder or file stems, that skills have a `SKILL.md`, that context link targets exist (warning), and flags stray files and unknown top-level folders under `data/`.

## Typechecking

`astro check` is not used. TypeScript 7.1 type-checks `.ts`, `.tsx` and `.astro` files itself through `@astrojs/ts-content-mapper`, registered in `tsconfig.json`. `astro sync` runs first because the generated `.astro/` types must exist, and it fails on the first invalid data file, so fix data before typechecking.

## Related

* [Datasets](/concepts/datasets.md) describes the shapes these checks enforce.
* [Adding entries](/concepts/adding-entries.md) produces files that already pass them.
