---
type: Feature Guide
title: Keyboard shortcuts
description: The global keys of the UI (help dialog, new entry, add a link, open in the IDE, edit), when they fire, and how pages tell the shortcuts their context.
tags: [ui, keyboard, shortcuts]
generated:
  by: claude-code/ctxman-phase8
  at: 2026-10-18T12:00:00Z
---

# Keyboard shortcuts

Press `?` on any page, or the **?** button in the footer, for the list. It is a dialog (Esc closes it). The Open in IDE button's tooltip names its key too.

| Key | Does | Where |
| --- | --- | --- |
| `?` | Show the shortcuts | every page |
| Cmd/Ctrl+K | Open the [search](/concepts/search.md) | every page |
| `c` | New entry for the page's context | lists, entry pages, dashboard, Tools, Forge, Inflate |
| `l` | Add a link to another entry (the + Link dialog) | entry pages of okf datasets |
| `.` | Open in IDE (the entry folder with the current file; a snippet: the `snippet/` folder with its file) | entry and document pages, when an IDE command is available |
| `e` | Edit: the markdown editor of an okf entry, skill or document (the cursor lands in it), the form of a reference, snippet, context or recipe | entry and document pages |
| Cmd/Ctrl+S | Save | editors, see [Editing](/concepts/editing.md) |
| Cmd/Ctrl+Alt+K | Insert link to entry | markdown editors |
| `Esc` | Close the dialog | dialogs |

## What `c` creates

* A list, an entry page or a sub-document page of dataset `<ds>`: the create form `/new/<ds>`.
* A list filtered by a project (`/task?project=<slug>`) or a project page: a new task that is a child of the project (`/new/task?parent=<slug>`).
* The dashboard and Tools: `/new/task`.
* [Forge](/concepts/context-forge.md): the New context dialog (`/forge?context=new`); [Inflate](/concepts/context-inflate.md): the New recipe dialog (`/inflate?recipe=new`).
* The create forms, the 404 page and the search redirect have no `c` shortcut.

## When keys are ignored

`?`, `c`, `l`, `.` and `e` do nothing while you type (an input, textarea, select, contenteditable element, a Monaco editor or an open menu has focus: a menu jumps to an item by its first letter), while any dialog is open, with Cmd, Ctrl or Alt held, during IME composition, or when another handler already handled the key. `c`, `l`, `.` and `e` also need Shift released. `e` does nothing on a page that is already in edit mode or has none (lists, dashboard, tools).

## How it works

`Base.astro` takes the optional props `createHref`, `linkShortcut` and `editShortcut` and renders them as `data-shortcut-create`, `data-shortcut-link` and `data-shortcut-edit` on `<body>`; every page passes its own context (`editShortcut`: okf and skill entry pages, document pages, and reference, snippet, context and recipe pages outside edit mode). The Shortcuts island (mounted by `Base.astro` on every page) listens on `window` in the capture phase, like the search key, and asks the pure `src/lib/shortcuts.ts` what a key press means: open the help, navigate to the create href, click the enabled + Link or Open in IDE button, or edit. For `e` it first dispatches the cancelable `ctxman:edit-shortcut` window event, which the DocEditor answers (it switches to its editor and focuses it once loaded); unanswered, it clicks the page's Edit link (`[data-shortcut-edit-link]`, which goes to `?edit=1`). The help table is the `SHORTCUTS` list in the same file. The URL does not carry shortcut state.
