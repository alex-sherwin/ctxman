# Update log

## 2026-10-18
* **Add**: Added [Editing](/concepts/editing.md): the explicit Save model, the DocEditor and popup editors, the reference, context and recipe forms, Open in IDE, the generated JSON Schemas with the yaml-language-server comment, and why a save is followed by one extra reload in dev.
* **Update**: [Routes and API](/concepts/routes-and-api.md) now lists `/new/<dataset>`, `?edit=1`, `view`, the reference, doc, IDE and schema endpoints with their status codes, and that Tools opens the created entry.
* **Update**: [Architecture](/concepts/architecture.md) (seven islands, the editing layering, zod versus arktype), [Datasets](/concepts/datasets.md) (reference CRUD, JSON Schemas, the magic comment), [Compliance checks](/concepts/compliance-checks.md) (`collections/yaml-schema-comment`, `check:schemas` rules `schemas/missing`, `schemas/drift`, `schemas/stray`), [Adding entries](/concepts/adding-entries.md) (`/new/<ds>` forms, Tools navigation), [Context forge](/concepts/context-forge.md) (drag and drop, tab counts, schema diagnostics) and [Runtime modes](/concepts/runtime-modes.md) (saves and the dev reload).

## 2026-10-17
* **Add**: Added [Context inflate](/concepts/context-inflate.md): recipes, expansion rules, modes per item kind, targets, output format, API and write-path safety.
* **Update**: Documented the new `recipe` dataset and the Inflate tool across [Datasets](/concepts/datasets.md) (eleven datasets), [Routes and API](/concepts/routes-and-api.md) (`/inflate`, `/recipe`, recipe and inflate endpoints, URL parameters), [Architecture](/concepts/architecture.md) (four islands, `src/lib/inflate` layering, `out/`), [Runtime modes](/concepts/runtime-modes.md) (watcher-less recipe loader), [Compliance checks](/concepts/compliance-checks.md) (four recipe warning rules), [Search](/concepts/search.md) (recipes indexed), [Adding entries](/concepts/adding-entries.md) (`add:recipe`) and [Context forge](/concepts/context-forge.md); the overview in [ctxman](/main.md) no longer calls the tool planned.
* **Update**: Documented the reference URI rules in [Datasets](/concepts/datasets.md): `remote-repo` takes git URIs (SCP-style SSH, `ssh://`, HTTPS with or without `.git`); `remote-skill` takes a git URI or an HTTPS `.tar.gz`/`.tgz`/`.zip` archive, shown as a `git` or `archive` badge.
* **Add**: Added [Runtime modes](/concepts/runtime-modes.md), [Routes and API](/concepts/routes-and-api.md) and [Adding entries](/concepts/adding-entries.md).
* **Update**: Extended [Datasets](/concepts/datasets.md) with the cross-entry link syntax.
* **Update**: Checked every concept against the built app; corrected [Architecture](/concepts/architecture.md) (four `src/lib` kinds, layout), [Routes and API](/concepts/routes-and-api.md) (doc route, status codes, response shapes) and [Adding entries](/concepts/adding-entries.md) (reference placeholders, no `--` separator before flags).

## 2026-10-16
* **Create**: Created [ctxman](/main.md) with the architecture, datasets, forge, search and checks concepts.
