---
type: Concept
title: Editing in the browser
description: How markdown docs, frontmatter, popups and forms are edited in the UI, the explicit Save model, drafts that survive a reload, link completion and the entry picker, the dev reload that follows a save, Open in IDE, and the JSON Schemas behind the yaml editors.
tags: [editing, monaco, save, drafts, links, schemas, ide]
---

# Editing in the browser

Files stay the source of truth, and editing them in your IDE keeps updating the running UI exactly as before (the content collections keep their glob loaders and `astro dev` keeps its full reload after a change under `data/`). Editing in the browser is a secondary convenience built on top of that: it writes the same files through JSON endpoints. The layers are in [Architecture](/concepts/architecture.md) and the endpoints in [Routes and API](/concepts/routes-and-api.md).

## The Save model

* Saving is explicit: a Save button or Cmd/Ctrl+S. There is no autosave and no debounce.
* A save that succeeds leaves edit mode and shows "Saved" (plus the validator findings, if any). `?edit=1` is removed from the URL, using `replaceState`, so edit mode never creates history entries.
* Unsaved text is a **draft** mirrored to `localStorage` (see Drafts below), so a reload caused by another file (the dev server reloads on every change under `data/`), a closed tab or a crash does not lose it.
* A markdown save sends `ifUnmodifiedSince` (the mtime it loaded). If the file changed on disk meanwhile the server answers 409 and a dialog offers "Keep editing", "Load disk version" (your edits are dropped) or "Overwrite".
* Findings never block a markdown save: the validators run on the written file and report as warnings (including `links/broken`, `links/ctxman-target` and the relation rules), and `pnpm run check` remains the gate. A file saved with broken frontmatter is allowed on purpose; the running dev server then logs a loader error and a fresh `astro dev` or `astro sync` fails until the file is fixed (the findings name it). The page of such a file shows an "invalid" banner with the issues instead of silently disappearing from lists.
* The **frontmatter dialog** is the opposite: it can never write an invalid file (see Details dialog).

## Markdown docs (DocEditor)

Every okf entry page (`/<dataset>/<slug>`), every sub-document page (`/<dataset>/<slug>/doc/<path>`) and every skill page has two columns: the details on the left, the server-rendered markdown preview on the right. A Preview | Edit toggle sits above the preview. Edit shows a Monaco source editor of the whole file, frontmatter included, in place of the preview (which is only hidden, never replaced by client-rendered HTML). `?edit=1` opens straight into the editor. The island loads Monaco lazily, so a detail page does not fetch the ~4 MB editor until Edit is pressed.

The file is read and written through `GET|PUT /api/doc/<dataset>/<slug>/<path>`. It only edits an existing `.md` file under the entry (no traversal) and refuses text over 512 KB. Creating a concept file is `POST` on the same route (see New concept).

### Linking from the editor

Every markdown editor (the DocEditor, the popups, the Forge notes, the Inflate blocks and preamble) completes entry links. The completion provider is registered once in the Monaco setup and fires on:

* `ctxman:` completes the target (`ctxman:task/write-agents-md`);
* `](` completes the destination, offering `ctxman:`;
* `[[` completes a whole link, replacing the brackets with `[Title](ctxman:<dataset>/<slug>)`;
* Ctrl+Space anywhere completes a whole link at the cursor.

A bare `[` does not trigger (it would fire on every task list and footnote). Entries are listed in dataset order by title with their state, filterable by title, slug or dataset.

**Insert link…** (a button in the editor toolbar, the context-menu item, or Mod+Alt+K; Mod+Shift+K is Monaco's delete-line) opens the **entry picker**: a dialog with a search field, dataset chips (All first) and one row per entry. Picking inserts `[selected text or title](ctxman:<dataset>/<slug>)` at the cursor and returns the focus to the editor. The same picker is used for relations, children and Add to context.

### Details dialog, state select and New concept

The okf and skill detail pages have small writers that do not need the source editor. They are enabled by the EntryTools island and disabled while the DocEditor is open (so a write cannot invalidate an open draft; the tooltip says "Leave the editor first").

* **Details panel, Edit**: a dialog for the frontmatter keys `title`, `description`, `tags`, `state`, `stale_after` and `status` (a skill: only `description`). Save sends only the changed keys with `ifUnmodifiedSince`; field errors from the server show on their fields and a changed file shows "Changed on disk" with a Reload button. The server edits those keys by range in the YAML text, so comments, unknown keys and the body stay byte for byte, and it refuses (nothing written) any result that fails the schema. The tag field splits typed text on commas and spaces and commits a pending tag when it loses focus.
* **State select**: lifecycle datasets show a native select in the detail header and in list rows. A change patches `state` at once ("Saved" beside it); the list keeps its URL filters and the row leaves a filtered view after the reload. An invalid value in the file shows as "&lt;value&gt; (invalid)".
* **Files panel, + New concept** (okf): file name, title, type (default `Concept`) and description create `concepts/<name>.md`, add a line to the bundle's `index.md` under `## Concepts` and a "Create" line to `log.md`, then open the new file in the editor. A doc URL for a concept that does not exist yet (inside an existing bundle) offers "Create this file" with the path fixed.
* **Add to context**, relations and children: see [Relations](/concepts/relations.md).

## Popup editors for small markdown areas

On a context page each link's notes, and on a recipe page the preamble and each markdown block, have a pencil button that opens a modal Monaco editor for just that text. Opening it loads the current document; Save re-reads the file right before writing and replaces only that one text, so concurrent edits elsewhere in the file are not rolled back. A changed file is reported as a conflict. After a save the page reloads, because context and recipe files are read at runtime and the dev server does not reload for them.

## Forms for reference, context and recipe (DataForm)

The three yaml datasets can be managed in the UI without the Forge or Inflate:

* `/new/reference`, `/new/context` and `/new/recipe` create an entry. The okf datasets and skills have their own create form at `/new/<dataset>` (the NewEntryForm: name, title, description, state, tags and, for work items, "Part of project"; see [Adding entries](/concepts/adding-entries.md)).
* `/<dataset>/<slug>?edit=1` edits one. The Form tab shows typed fields and the YAML tab a Monaco editor; both edit the same working document, and `view=form|yaml` in the URL selects the tab. The name is immutable after creation.
* Delete asks for confirmation. A conflict dialog covers an entry that changed on disk since the form loaded it.
* References live in the glob-watched collection, so after a reference write the form waits until the entry is listed again and then navigates; contexts and recipes are read at runtime and navigate at once.

## Drafts

Unsaved text of the DocEditor, the markdown popups, the Forge and Inflate is saved to `localStorage` on every change (keys `ctxman:draft:doc:<dataset>/<slug>/<path>`, `…:md:…`, `…:forge:<context>` and `…:inflate:<recipe>`, kept 14 days) and removed on save, revert, discard or when it equals the saved text. After any reload the editor restores it and shows "Restored unsaved changes from earlier." with a Discard button. If the file changed on disk since the draft was started, the draft is still restored and the banner says "the file changed on disk since — saving overwrites it". A preview page with a stored draft offers "Resume editing".

These editors have **no native "leave site?" prompt**: a dev reload cannot be told apart from closing the tab, and drafts make the prompt unnecessary. The in-app confirmations stay (discard dialogs, switching contexts or recipes). The forms without persistence, DataForm and the NewEntryForm, keep the native prompt.

## Reload tolerance

A saved `.md` (or `SKILL.md`, or a reference, or a frontmatter, state or create write) triggers the dev server's full reload about 0.7 s later. Lists, summaries and frontmatter are read from disk and are current at once, and a page renders the markdown on disk whenever the content layer's copy is behind (it re-reads a written file about 1 s late). The reload can still arrive before the content layer has caught up, so the doc editor keeps a safeguard in three steps: the preview is dimmed after the save, the "Saved" status is carried across the reload in `sessionStorage`, and the first reloaded page schedules exactly one more reload 1.5 s later. The carried record counts the reloads, so "Saved" stays visible and it can never loop. On a built server (`pnpm start`) there is no watcher, so a 2 s fallback reload runs instead (the EntryTools dialogs use the same 2 s fallback; the state select reloads only in a production build, because the dev server reloads by itself; neither schedules the extra settle reload). Creating a concept can log `Entry docs … was not found` in the dev server for a moment; the new file's page reads the disk until the content layer has caught up, so it is harmless. If you start editing again before the extra reload, it is skipped and the preview is marked stale until you leave edit mode.

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
* [Relations](/concepts/relations.md) covers the links, children, Add to context and picker flows built on these writers.
