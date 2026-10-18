---
type: Concept
title: Editing in the browser
description: How markdown docs, popups and yaml forms are edited in the UI, the explicit Save model, the dev reload that follows a save, Open in IDE, and the JSON Schemas behind the yaml editors.
tags: [editing, monaco, save, schemas, ide]
---

# Editing in the browser

Files stay the source of truth, and editing them in your IDE keeps updating the running UI exactly as before (the content collections keep their glob loaders and `astro dev` keeps its full reload after a change under `data/`). Editing in the browser is a secondary convenience built on top of that: it writes the same files through JSON endpoints. The layers are in [Architecture](/concepts/architecture.md) and the endpoints in [Routes and API](/concepts/routes-and-api.md).

## The Save model

* Saving is explicit: a Save button or Cmd/Ctrl+S. There is no autosave and no debounce.
* A save that succeeds leaves edit mode and shows "Saved" (plus the validator findings, if any). `?edit=1` is removed from the URL, using `replaceState`, so edit mode never creates history entries.
* Unsaved text is mirrored to `sessionStorage` per file, so a reload caused by another file (the dev server reloads on every change under `data/`) does not lose it. After the reload the editor restores it with a "Restored unsaved changes" banner and a Discard button, but only when the file on disk is still the version the draft started from. Leaving the page with unsaved changes asks first.
* A markdown save sends `ifUnmodifiedSince` (the mtime it loaded). If the file changed on disk meanwhile the server answers 409 and a dialog offers "Keep editing", "Load disk version" (your edits are dropped) or "Overwrite".
* Findings never block a save: the validators run on the written file and report as warnings, and `pnpm run check` remains the gate. A file saved with broken frontmatter is allowed on purpose; the running dev server then logs a loader error and a fresh `astro dev` or `astro sync` fails until the file is fixed (the findings name it).

## Markdown docs (DocEditor)

Every okf entry page (`/<dataset>/<slug>`), every sub-document page (`/<dataset>/<slug>/doc/<path>`) and every skill page has two columns: the details on the left, the server-rendered markdown preview on the right. A Preview | Edit toggle sits above the preview. Edit shows a Monaco source editor of the whole file, frontmatter included, in place of the preview (which is only hidden, never replaced by client-rendered HTML). `?edit=1` opens straight into the editor. The island loads Monaco lazily, so a detail page does not fetch the ~4 MB editor until Edit is pressed.

The file is read and written through `GET|PUT /api/doc/<dataset>/<slug>/<path>`. It only edits an existing `.md` file under the entry (no creation, no traversal) and refuses text over 512 KB.

## Popup editors for small markdown areas

On a context page each link's notes, and on a recipe page the preamble and each markdown block, have a pencil button that opens a modal Monaco editor for just that text. Opening it loads the current document; Save re-reads the file right before writing and replaces only that one text, so concurrent edits elsewhere in the file are not rolled back. A changed file is reported as a conflict. After a save the page reloads, because context and recipe files are read at runtime and the dev server does not reload for them.

## Forms for reference, context and recipe (DataForm)

The three yaml datasets can be managed in the UI without the Forge or Inflate:

* `/new/reference`, `/new/context` and `/new/recipe` create an entry. The other datasets are created from the [Tools page](/concepts/adding-entries.md).
* `/<dataset>/<slug>?edit=1` edits one. The Form tab shows typed fields and the YAML tab a Monaco editor; both edit the same working document, and `view=form|yaml` in the URL selects the tab. The name is immutable after creation.
* Delete asks for confirmation. A conflict dialog covers an entry that changed on disk since the form loaded it.
* References live in the glob-watched collection, so after a reference write the form waits until the entry is listed again and then navigates; contexts and recipes are read at runtime and navigate at once.

## Reload tolerance

A saved `.md` (or `SKILL.md`, or a reference) triggers the dev server's full reload about 0.7 s later. That reload can arrive before Astro's content layer has re-read the file (about 1 s), so the page it brings may still render the old markdown. The doc editor handles this in three steps: the preview is dimmed after the save, the "Saved" status is carried across the reload in `sessionStorage`, and the first reloaded page schedules exactly one more reload 1.5 s later. The carried record counts the reloads, so "Saved" stays visible and it can never loop. On a built server (`pnpm start`) there is no watcher, so a 2 s fallback reload runs instead. If you start editing again before the extra reload, it is skipped and the preview is marked stale until you leave edit mode.

## Open in IDE

The details column of every okf and skill page has an Open in IDE button (sub-document pages open that file). It calls `POST /api/ide/open`, which starts the VS Code CLI as `<command> <entry folder> <file>`: the folder becomes the workspace root and the file opens in it. A file is never passed alone (it would open in the last active window with the wrong root), and `-r` is never used. The command is `CTXMAN_IDE_COMMAND` (a name looked up in PATH, or a path), else `code` in PATH, else the usual install locations; when none exists the button is disabled and the page shows the install hint. For the yaml datasets the folder is the data directory.

## JSON Schemas and the yaml-language-server comment

Reference, context and recipe files have a generated JSON Schema in `schemas/<dataset>.schema.json`. The runtime validator is zod; the schemas come from arktype models in `src/datasets/arktypes.ts` that mirror the zod schemas (a parity test keeps them equal), and `pnpm run gen:schemas` regenerates the files. `pnpm run check:schemas` fails when they are stale. The server serves them at `GET /api/schemas/<dataset>` for external tools.

Line 1 of every yaml data file is `# yaml-language-server: $schema=../../schemas/<dataset>.schema.json`, which gives IDEs with the Red Hat YAML extension live diagnostics, hover and completion. Every writer adds it (the API writers, the add scripts and the forms); the serializers do not. `collections/yaml-schema-comment` warns when it is missing or wrong, and `pnpm run fix:yaml-comments` repairs it. The relative path only resolves for the default `./data` directory.

The browser YAML editors use the same schemas through monaco-yaml, so the Forge YAML view and the DataForm YAML tab report problems as you type. A few rules JSON Schema cannot express (duplicate links, a changed `name`) come from the zod check instead, which also gates Save; each issue carries a `coveredBySchema` flag so a problem is never shown twice.

## Related

* [Context forge](/concepts/context-forge.md) and [Context inflate](/concepts/context-inflate.md) are the other two editors; they save the same explicit way.
* [Datasets](/concepts/datasets.md) describes the files being edited and [Compliance checks](/concepts/compliance-checks.md) the rules that validate them.
* [Runtime modes](/concepts/runtime-modes.md) explains why saves reload the page in dev and not in a built server.
