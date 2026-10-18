---
type: Feature Guide
title: Keyboard shortcuts
description: The global keys of the UI (help dialog, new entry, add a link), when they fire, and how pages tell the shortcuts their context.
tags: [ui, keyboard, shortcuts]
generated:
  by: claude-code/ctxman-phase8
  at: 2026-10-18T12:00:00Z
---

# Keyboard shortcuts

Press `?` on any page, or the **?** button in the footer, for the list. It is a dialog (Esc closes it).

| Key | Does | Where |
| --- | --- | --- |
| `?` | Show the shortcuts | every page |
| Cmd/Ctrl+K | Open the [search](/concepts/search.md) | every page |
| `c` | New entry for the page's context | lists, entry pages, dashboard, Tools, Forge, Inflate |
| `l` | Add a link to another entry (the + Link dialog) | entry pages of okf datasets |
| `i` | Open in IDE (the entry folder with the current file) | entry and document pages, when an IDE command is available |
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

`?`, `c` and `l` do nothing while you type (an input, textarea, select, contenteditable element or a Monaco editor has focus), while any dialog is open, with Cmd, Ctrl or Alt held, during IME composition, or when another handler already handled the key. `c` and `l` also need Shift released.

## How it works

`Base.astro` takes the optional props `createHref` and `linkShortcut` and renders them as `data-shortcut-create` and `data-shortcut-link` on `<body>`; every page passes its own context. The Shortcuts island (mounted by `Base.astro` on every page) listens on `window` in the capture phase, like the search key, and asks the pure `src/lib/shortcuts.ts` what a key press means: open the help, navigate to the create href, or click the enabled + Link button. The help table is the `SHORTCUTS` list in the same file. The URL does not carry shortcut state.
