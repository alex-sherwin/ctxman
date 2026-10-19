---
type: Concept
title: Editing in the browser
description: How markdown docs, frontmatter, popups and forms are edited in the UI, the explicit Save model, drafts that survive a reload, link completion and the entry picker, the reload that follows a save, Open in IDE, and the JSON Schemas behind the yaml editors.
tags: [editing, monaco, save, drafts, links, schemas, ide]
---

# Editing in the browser

Files stay the source of truth. Nothing watches the data directory, so a file you change in your IDE (or an agent changes through [MCP](/concepts/mcp.md)) shows up the next time you load or reload the page; every read goes to the disk. Editing in the browser is a secondary convenience built on top of that: it writes the same files through JSON endpoints, and the page reloads itself right after (see Reload after a save). The layers are in [Architecture](/concepts/architecture.md) and the endpoints in [Routes and API](/concepts/routes-and-api.md).

## The Save model

* Saving is explicit: a Save button or Cmd/Ctrl+S. There is no autosave and no debounce. Press `?` anywhere for the list of [keyboard shortcuts](/concepts/keyboard-shortcuts.md).
* A save that succeeds leaves edit mode and shows "Saved" (plus the validator findings, if any). `?edit=1` is removed from the URL. Every switch between preview and edit (the toggle, the `e` key, Cancel, a save) is a browser history entry, so Back and Forward switch modes; leaving unsaved text always asks first (see Leaving unsaved text).
* Unsaved text is a **draft** mirrored to `localStorage` (see Drafts below), so a reload, a closed tab or a crash does not lose it.
* A markdown save sends `ifUnmodifiedSince` (the mtime it loaded). If the file changed on disk meanwhile the server answers 409 and a dialog offers "Keep editing", "Load disk version" (your edits are dropped) or "Overwrite".
* Findings never block a markdown save: the validators run on the written file and report as warnings (including `links/broken`, `links/ctxman-target` and the relation rules), and `pnpm run check` remains the gate. A file saved with broken frontmatter is allowed on purpose; nothing breaks at runtime and `pnpm run check:okf` names the file. The page of such a file shows an "invalid" banner with the issues instead of silently disappearing from lists.
* The **frontmatter dialog** is the opposite: it can never write an invalid file (see Details dialog).

## Markdown docs (DocEditor)

Every okf entry page (`/<dataset>/<slug>`), every sub-document page (`/<dataset>/<slug>/doc/<path>`) and every skill page has two columns: the details on the left, the server-rendered markdown preview on the right. A Preview | Edit toggle sits above the preview. Edit shows a Monaco source editor of the whole file, frontmatter included, in place of the preview (which is only hidden, never replaced by client-rendered HTML). `?edit=1` opens straight into the editor, and the `e` key does the same from the preview and puts the cursor in the editor once it has loaded ([Keyboard shortcuts](/concepts/keyboard-shortcuts.md)). The island loads Monaco lazily, so a detail page does not fetch the ~4 MB editor until Edit is pressed.

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
* **Files panel**: markdown files open their page; every other file (an image, a script) opens its raw bytes in a new tab (`/<dataset>/<slug>/file/<path>`), the same route the preview uses for images such as `![diagram](diagram.png)` next to the markdown.
* **Files panel, + New concept** (okf): file name, title, type (default `Concept`) and description create `concepts/<name>.md`, add a line to the bundle's `index.md` under `## Concepts` and a "Create" line to `log.md`, then open the new file in the editor. A doc URL for a concept that does not exist yet (inside an existing bundle) offers "Create this file" with the path fixed.
* **Add to context**, relations and children: see [Relations](/concepts/relations.md).

## Deleting entries

Every list row ends in a `⋯` button and every detail page header has one next to its action buttons. The ListTable island renders the row menus in its own last column; the EntryMenus island renders the header one into an empty `[data-entry-menu]` slot that the server-rendered page provides (`data-dataset`, `data-slug`, `data-title`, `data-context="detail"`). Both use the same menu and dialog (`src/ui/menus/EntryMenu.tsx`). The menu has one item, **Delete…**, which opens a confirm dialog: "This removes the whole folder `<ds>/<slug>` and every file in it." for okf bundles and skills, "This removes `<ds>/<slug>.yaml`." for reference, snippet, context and recipe. A confirmed delete calls `DELETE /api/entry/<ds>/<slug>` (okf, skill) or `DELETE /api/<ds>/<slug>` (yaml datasets); a failure shows its message inside the dialog and keeps it open. After success a list row reloads the list; the detail page goes back to `/<ds>`. While a DocEditor is open the item is disabled ("Leave the editor first"). Links to the deleted entry are not rewritten: links to it become dangling (`links/relation-target` warnings) until they are removed. Deleting is permanent (no trash); the data directory is usually under version control.

## Popup editors for small markdown areas

On a context page each link's notes, on a recipe page the preamble and each markdown block, on a reference page its Info and on a snippet page its Markdown have a pencil button that opens a modal Monaco editor for just that text. Opening it loads the current document; Save re-reads the file right before writing and replaces only that one text, so concurrent edits elsewhere in the file are not rolled back. A changed file is reported as a conflict. After a save the page reloads, so the server-rendered page shows the new text.

## Forms for reference, snippet, context and recipe (DataForm)

The four yaml datasets can be managed in the UI without the Forge or Inflate:

* `/new/reference`, `/new/snippet`, `/new/context` and `/new/recipe` create an entry. The okf datasets and skills have their own create form at `/new/<dataset>` (the NewEntryForm: name, title, description, state, tags and, for work items, "Part of project"; see [Adding entries](/concepts/adding-entries.md)).
* `/<dataset>/<slug>?edit=1` edits one (the Edit button of the page, or the `e` key). The Form tab shows typed fields (single-line text fields, and a Monaco markdown editor for a recipe's preamble, a reference's Info and a snippet's markdown, which is required) and the YAML tab a Monaco editor; both edit the same working document, and `view=form|yaml` in the URL selects the tab. The name is immutable after creation.
* Delete asks for confirmation. A conflict dialog covers an entry that changed on disk since the form loaded it.
* After a write (and after a delete) the form navigates at once; every dataset is read from the disk, so the target page is current.

## Drafts

Unsaved text of the DocEditor, the markdown popups, the Forge and Inflate is saved to `localStorage` on every change (keys `ctxman:draft:doc:<dataset>/<slug>/<path>`, `…:md:…`, `…:forge:<context>` and `…:inflate:<recipe>`, kept 14 days) and removed on save, revert, discard or when it equals the saved text. After any reload the editor restores it and shows "Restored unsaved changes from earlier." with a Discard button (the `DraftNotice` banner, the same component in every editor). If the file changed on disk since the draft was started, the draft is still restored and the banner says "the file changed on disk since — saving overwrites it". A preview page with a stored draft offers "Resume editing".

The markdown popups, the Forge and Inflate have **no native "leave site?" prompt**: drafts make it unnecessary, and their in-app confirmations stay (discard dialogs, switching contexts or recipes). The forms without persistence, DataForm and the NewEntryForm, keep the native prompt.

## Leaving unsaved text

The markdown editor (DocEditor) asks before any way out drops unsaved text. The Preview toggle, Cancel, Back or Forward out of the editor, and a click on any link (the header nav, breadcrumbs, panels) open the in-app "Discard unsaved changes?" dialog: Cancel keeps editing, Discard drops the draft and then goes where you were going. Back and Forward cannot be stopped by a page, so the editor puts its own URL back on top while it asks. Everything else that leaves the page (a reload, closing the tab, a typed URL, a shortcut that navigates) shows the browser's own "Leave site?" prompt; leaving there keeps the draft, which the next visit restores. The reload after a successful save never asks.

## Reload after a save

There is no content layer and no file watcher, so nothing reloads the page by itself and nothing lags behind a write: lists, summaries, frontmatter and bodies are read from the disk on every request. The UI therefore reloads itself, the same way in the dev server and in a built server:

* A saved `.md` (or `SKILL.md`) switches the editor back to the preview, dims it (`data-stale`), remembers "Saved" in `sessionStorage` and reloads the page about 150 ms later (`RELOAD_AFTER_SAVE_MS`). The reloaded page shows the saved text and the remembered "Saved" status. If you re-enter edit mode before the reload fires, the reload is skipped and the preview stays marked stale until you leave edit mode.
* The state select reloads about 150 ms after the write (`STATE_RELOAD_MS`); the EntryTools dialogs (Details, relations, Add to context, New concept, create) remember their status message and reload at once (`after-write.ts`), unless the DocEditor is open, in which case the editor's own flow handles it.
* The DataForm and the create forms navigate directly to the saved entry (or to the list after a delete).
* There is no second "settle" reload and no 2 s fallback any more. E2E specs wait for the reload as an event (`afterReload`); sleeps in `tests/e2e` are lint errors.

## Open in IDE

The details column of every okf, skill and snippet page has an Open in IDE button (sub-document pages open that file). It calls `POST /api/ide/open`, which starts the VS Code CLI as `<command> <entry folder> <file>`: the folder becomes the workspace root and the file opens in it. A file is never passed alone (it would open in the last active window with the wrong root), and `-r` is never used. The command is `CTXMAN_IDE_COMMAND` (a name looked up in PATH, or a path), else `code` in PATH, else the usual install locations; when none exists the button is disabled and the page shows the install hint. A snippet opens the `snippet/` folder with its `<name>.yaml`; for the other yaml datasets (through the API) the folder is the data directory.

## JSON Schemas and the yaml-language-server comment

Reference, context and recipe files have a generated JSON Schema in `schemas/<dataset>.schema.json`. arktype is the only validator: the same Types in `src/datasets/schemas.ts` validate the files at runtime and generate the schemas, and `pnpm run gen:schemas` regenerates the files. `pnpm run check:schemas` fails when they are stale. The server serves them at `GET /api/schemas/<dataset>` (also `<dataset>.schema.json`, CORS `*`).

Line 1 of every yaml data file is `# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/<dataset>`, which gives IDEs with the Red Hat YAML extension live diagnostics, hover and completion while ctxman runs (the origin is `CTXMAN_SERVER_ORIGIN`, default `http://127.0.0.1:4321`). Every writer adds it (the API writers, the add scripts and the forms); the serializers do not. `collections/yaml-schema-comment` warns when it is missing or wrong (any loopback origin and port is accepted), and `pnpm run fix:yaml-comments` repairs it.

The browser YAML editors use the same schemas through monaco-yaml, so the Forge YAML view and the DataForm YAML tab report problems as you type. A few rules JSON Schema cannot express (duplicate links, a changed `name`) come from the arktype narrows instead (issue `kind: 'custom'`), which also gate Save; each issue carries a `coveredBySchema` flag so a problem is never shown twice.

## Related

* [Context forge](/concepts/context-forge.md) and [Context inflate](/concepts/context-inflate.md) are the other two editors; they save the same explicit way.
* [Datasets](/concepts/datasets.md) describes the files being edited and [Compliance checks](/concepts/compliance-checks.md) the rules that validate them.
* [Runtime modes](/concepts/runtime-modes.md) explains the per-request read path that makes a reload enough.
* [Relations](/concepts/relations.md) covers the links, children, Add to context and picker flows built on these writers.
