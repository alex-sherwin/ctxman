# Log time hotkey, wider reading layout, okf bundle clone (build spec, 2026-10-21)

Branch `feature/ai-sessions` (after the agent history import). Five owner requests:

1. `t` opens a quick "Log time" popup on detail pages of time-tracked datasets.
2. `t` also works on time-tracked lists for the hovered row or the row that has focus.
3. The "On this page" nav (DocToc) takes its natural width, with 24px of space left and right, not a fixed 15rem.
4. The rendered markdown can grow 50% wider; the page content max width grows 25%.
5. Clone an okf bundle: a dialog for the new name (slug), title, description etc., then the whole bundle is copied into
   a new entry.

## 1 + 2. `t` = Log time

Time-tracked datasets = registry `TIME_TRACKED_DATASETS` (task, feature, bug, rca).

- **One dialog**: move `src/ui/list/LogTimeDialog.tsx` to a shared place (`src/ui/edit/LogTimeDialog.tsx`, Monaco-free)
  and give it an `onLogged(message: string)` callback instead of the hard-wired list flash + reload. The list keeps
  `setListFlash(message); location.reload()`; the detail page uses EntryTools' `afterWrite` path (status line
  "Logged PT1H on “X” (total 2h 30m)", page reload). Test ids stay (`log-time-dialog`, `log-time-input`,
  `log-time-submit`, `log-time-cancel`, `log-time-error`).
- **Detail page**: an SSR button in the Details panel (MetaPanel) of time-tracked okf entries, shown whether or not
  time was logged yet: icon-only clock (`Icon name="clock"`, `ck-button--icon`, ghost, sm), title / aria-label "Log
  time (t)", `data-entry-action="log-time"`, `data-testid="meta-log-time"`, rendered `disabled` like the other entry
  actions (EntryTools enables it, and locks it while the doc editor is open). Place it in the "Time" row (add the row
  with an empty value when there is no time yet, so the button has a home), right-aligned. `ENTRY_ACTIONS` /
  `EntryDialog` / `dialogFor` get `log-time`; EntryTools renders the shared dialog with the entry's dataset, slug,
  title.
- **Shortcut** (`src/lib/shortcuts.ts`, PURE): new row in `SHORTCUTS`: `{ id: 'log-time', keys: ['t'], label: 'Log
  time on the entry, or on the hovered or focused list row', where: 'Task, feature, bug and rca entry pages and lists' }`.
  `ShortcutContext` gets `timeShortcut: boolean` from `<body data-shortcut-time>`; `shortcutAction` returns
  `{ kind: 'log-time' }` for `t` when it is set (same guards as the other keys: not typing, no dialog, no modifiers).
  `Base.astro` takes `timeShortcut?` and renders `data-shortcut-time`; the okf detail and doc pages of time-tracked
  datasets and the `/<ds>` list pages of those datasets pass it.
- **Dispatch** (Shortcuts island): like `e`, `t` dispatches a cancelable window event `ctxman:log-time-shortcut`
  (`LOG_TIME_SHORTCUT_EVENT` in shortcuts.ts). The ListTable island answers it (`preventDefault`) when it has a target
  row: the row that contains `document.activeElement` (keyboard focus, which is what "selected" means in this grid),
  else the row under the pointer (track it with pointer enter/leave on the rows, or `:hover` at key time); it opens
  the LogTimeDialog for that row. Unanswered, the island clicks `[data-entry-action="log-time"]:not([disabled])`
  (the detail page button). A list with no hovered or focused row does nothing.
- A list row's Log time icon button title becomes "Log time (t)".
- Docs: `keyboard-shortcuts.md`, `editing.md`, AGENTS.md (Keyboard shortcuts paragraph, Base.astro props, the e2e
  test ids).
- Tests: unit (`shortcutAction` for `t`, the dialog helpers that moved); e2e: `t` on a task detail page opens the
  dialog, Enter logs, the page reloads and the Details time list shows it; `t` with a focused list row (focus via
  keyboard) and with a hovered row (`hover()`) opens the dialog for THAT row; `t` on a non-time list (kb) and while
  typing in the list search does nothing; `t` while the doc editor is open does nothing. Use own `e2e-*` tasks,
  removed after.

## 3 + 4. Widths (CSS only, `src/styles/app.css` + `tokens.css`)

Current: `--content-max: 1600px`, `--prose-max: 84ch`, the doc layout `grid-template-columns: minmax(0,
var(--prose-max)) var(--toc-w)` with `--toc-w: 15rem` and `column-gap: 2 * --sp-6`, hidden under a 52rem container.

- `--content-max`: 1600px -> **2000px** (+25%).
- `--prose-max`: 84ch -> **126ch** (+50%). Check every user of `--prose-max` (detail main column, doc preview, the
  doc layout grid) still looks right, and that the okf entry detail page (main + aside) gets the extra width too.
- DocToc column: **`max-content`**, clamped so a very long heading cannot eat the page (`minmax(auto,
  min(max-content, 22rem))` or `fit-content(22rem)`; long headings wrap), with **24px of inline padding/margin on
  both sides** of the nav (the border-left list keeps its look), and the big `column-gap` replaced by that 24px.
  Recompute the container query breakpoint (prose min + toc) so the nav hides only when it would squeeze the text.
- Verify with screenshots at 1440x900, 1920x1080 and 2560x1440 of an okf doc page with a toc (e.g.
  `/kb/ctxman/doc/concepts/context-inflate`), an entry page, a list page and the dashboard: nothing else may break
  (lists, forge, inflate, tools use `--content-max` too). The e2e suite must stay green (some specs measure widths:
  grep for `boundingBox`, `prose-max`, `toc`).

## 5. Clone an okf bundle

- **Where**: the detail header `⋯` menu (EntryMenus island, `src/ui/menus/EntryMenu.tsx`) of okf entries gets
  `Clone…` above `Delete…` (`entry-menu-clone`); not for skills or yaml datasets, not in list rows. Disabled with the
  lock title while the doc editor is open.
- **Dialog** (`CloneEntryDialog.tsx`, `clone-dialog`; a form of more than three fields: `Modal size="large"`):
  - Name (`clone-name`, the slug; prefilled `<slug>-copy`, then `-copy-2`… when taken (check against the loaded
    entries list); `nameProblem` from `src/lib/names.ts`; "already exists" from the server 409 shown on the field);
  - Title (`clone-title`, prefilled "<title> (copy)"), Description (`clone-description`, prefilled with the original);
  - State (`clone-state`, lifecycle datasets only; default = the dataset's default state, NOT the original's);
  - Tags (`TagEditor`, prefilled with the original's tags), Issue key (`clone-issue-key`, empty: an issue belongs to
    one entry);
  - Checkboxes: "Copy relations" (`clone-opt-links`, on: the `links` of the entry, without `rel: child` links unless
    "Copy child links" (`clone-opt-children`, projects only, off) is also on), "Copy logged time" (`clone-opt-time`,
    off; time-tracked datasets only: `time` and `resolved`).
  - Submit `clone-submit` ("Clone"), Cancel `clone-cancel`, error `clone-error`. 201 -> `location.assign(url)` (the new
    entry page).
- **API**: `POST /api/entry/:ds/:slug/clone` (okf datasets only) body `{name, title?, description, state?, tags?,
  issueKey?, links?: boolean, children?: boolean, time?: boolean}` (arktype, strict) -> 201 `{dataset, slug, url,
  warnings}` + `location`; 400 `bad-dataset` (not okf) / `bad-slug` / `invalid` (issues per field), 403, 404 (source
  missing), 409 `exists` (target name taken), 415, 422 `invalid-file` (the source index.md frontmatter is unusable).
- **Copy** (NODE, `src/lib/entry-clone.ts`): copy the source bundle dir into `<ds>/<name>/` through a temp dir in the
  dataset dir (dot-prefixed), then `rename` (atomic: a failed copy leaves nothing behind). Regular files and folders
  only; symlinks are NOT followed and not copied (each one becomes a warning), nothing outside the bundle is read
  (`safeJoin` / realpath checks like `bundles.ts`). Then the clone's `index.md` frontmatter is rewritten with the
  existing frontmatter patcher (`frontmatter-patch.ts`, byte-preserving): `name`, `title`, `description`, `state`,
  `tags`, `issueKey` (removed when empty), `links` (filtered per the options), `time`/`resolved` (removed unless
  `time`), `modified` removed, provenance keys (`generated`, `created`…) kept as they are. The result must pass the
  dataset schema (validate before the rename; 400 `invalid` otherwise). When the clone has a `log.md`, a dated line
  `* **Create**: Cloned from [<title>](ctxman:<ds>/<slug>).` is added at the top (existing `appendLogEntry`).
  `invalidateEntryIndex()` after. Concept files keep their content (their `ctxman:` mentions and bundle-relative
  links stay valid: the folder structure is identical).
- **MCP**: a `clone-entry` write tool with the same input (reuse the lib; keep it JSON-Schema-expressible). Update
  `concepts/mcp.md`.
- **Docs**: `editing.md` (the menu item + dialog), `routes-and-api.md`, `relations.md` (what happens to links),
  AGENTS.md (API list, the EntryMenus description "whose only action is Delete…" changes, test ids).
- **Tests**: unit (`entry-clone`: copies files and nested folders, rewrites only the listed keys byte-preserving,
  link filtering incl. child links, time removal, symlink skipped with a warning, 409 when the target exists, nothing
  left behind on failure, log line; the PURE dialog helpers: name suggestion, body building); API via the lib; e2e:
  clone an `e2e-*` task with a concept file from its menu, the new page shows the new title and the concept file in
  the Files panel, the original is unchanged; 409 on an existing name keeps the dialog open. Never clone seed entries
  in e2e unless the clone is an `e2e-*` name removed afterwards (and never write the seed).
