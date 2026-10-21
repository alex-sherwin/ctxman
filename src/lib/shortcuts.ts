// Keyboard shortcuts: the table shown in the help dialog and the pure key matcher. PURE (no fs, no DOM):
// the `Shortcuts` island (src/ui/shortcuts) reads the DOM and calls `shortcutAction`.

/** One row of the help dialog. `keys` is a single key combo, `Mod` is rendered as Cmd or Ctrl. */
export interface ShortcutDef {
  id: string;
  keys: readonly string[];
  label: string;
  where: string;
}

export const SHORTCUTS: readonly ShortcutDef[] = [
  { id: 'help', keys: ['?'], label: 'Show keyboard shortcuts', where: 'Every page' },
  { id: 'search', keys: ['Mod', 'K'], label: 'Search', where: 'Every page' },
  {
    id: 'create',
    keys: ['c'],
    label:
      'New entry: of the dataset of the page, a child of the project in scope; a new context on Forge, a new recipe on Inflate',
    where: 'Lists, entry pages, dashboard, Tools, Forge, Inflate',
  },
  {
    id: 'link',
    keys: ['l'],
    label: 'Add a link to another entry',
    where: 'Entry pages of okf datasets',
  },
  {
    id: 'ide',
    keys: ['.'],
    label: 'Open in IDE',
    where: 'Entry and document pages, when an IDE command is available',
  },
  {
    id: 'edit',
    keys: ['e'],
    label:
      'Edit: the markdown editor of an entry or document, the form of a reference, context or recipe',
    where: 'Entry and document pages',
  },
  {
    id: 'log-time',
    keys: ['t'],
    label: 'Log time on the entry, or on the hovered or focused list row',
    where: 'Task, feature, bug and rca entry pages and lists',
  },
  { id: 'save', keys: ['Mod', 'S'], label: 'Save', where: 'Editors' },
  {
    id: 'insert-link',
    keys: ['Mod', 'Alt', 'K'],
    label: 'Insert link to entry',
    where: 'Markdown editors',
  },
  { id: 'close', keys: ['Esc'], label: 'Close the dialog', where: 'Dialogs' },
];

/** Selector of the + Link button that `l` clicks (an enabled one only: EntryTools enables it on mount). */
export const LINK_BUTTON_SELECTOR = '[data-entry-action="add-relation"]:not([disabled])';

/** Selector of the Open in IDE button that `.` clicks (enabled only: shell.ts disables it when no IDE command exists). */
export const IDE_BUTTON_SELECTOR = '[data-ide-open]:not([disabled])';

/** The Edit button of a reference, context or recipe page, which `e` clicks when no island takes the key. */
export const EDIT_LINK_SELECTOR = '[data-shortcut-edit-link]';

/**
 * The window event `e` dispatches first (cancelable). The DocEditor of okf / skill pages answers it with
 * `preventDefault()` and switches to its editor; unanswered, the Shortcuts island clicks `EDIT_LINK_SELECTOR`.
 */
export const EDIT_SHORTCUT_EVENT = 'ctxman:edit-shortcut';

/** The Details panel's Log time button of a time-tracked entry, which `t` clicks when no list row takes the key. */
export const LOG_TIME_BUTTON_SELECTOR = '[data-entry-action="log-time"]:not([disabled])';

/**
 * The window event `t` dispatches first (cancelable). The ListTable island of a time-tracked list answers it with
 * `preventDefault()` when a row has the keyboard focus or the pointer and opens Log time for that row; unanswered,
 * the Shortcuts island clicks `LOG_TIME_BUTTON_SELECTOR` (an entry or document page; disabled while the doc editor
 * is open, so `t` does nothing there).
 */
export const LOG_TIME_SHORTCUT_EVENT = 'ctxman:log-time-shortcut';

/** Elements that take typed text (a menu: its typeahead letters): shortcuts never fire there. */
export const TYPING_SELECTOR =
  'input, textarea, select, [contenteditable], .monaco-editor, [role="menu"]';

/** The subset of `KeyboardEvent` the matcher needs. */
export interface KeyInfo {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
}

export interface ShortcutContext {
  /** `data-shortcut-create` of the body: where `c` goes, absent = no create shortcut on this page. */
  createHref: string | null;
  /** `data-shortcut-link` is present: the page has a + Link button. */
  linkShortcut: boolean;
  /** The page has an ENABLED Open in IDE button (`IDE_BUTTON_SELECTOR` matches). */
  ideShortcut: boolean;
  /** `data-shortcut-edit` is present: the page has an edit mode it is not in yet. */
  editShortcut: boolean;
  /** `data-shortcut-time` is present: an entry, document or list page of a time-tracked dataset. */
  timeShortcut: boolean;
  /** The event target is a typing target (see {@link isTypingTarget}). */
  typing: boolean;
  /** Some `[role="dialog"]` / `[role="alertdialog"]` is open. */
  dialogOpen: boolean;
}

export type ShortcutAction =
  | { kind: 'help' }
  | { kind: 'navigate'; href: string }
  | { kind: 'click'; selector: string }
  | { kind: 'edit' }
  | { kind: 'log-time' };

/** True for an element (or a descendant of one) that takes typed text. `null` is not a typing target. */
export function isTypingTarget(el: { closest(selector: string): unknown } | null): boolean {
  return el !== null && el.closest(TYPING_SELECTOR) != null;
}

/** What a key press does, or `null` to let it through. Never touches the DOM. */
export function shortcutAction(e: KeyInfo, ctx: ShortcutContext): ShortcutAction | null {
  if (e.defaultPrevented || e.isComposing) return null;
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (ctx.typing || ctx.dialogOpen) return null;
  if (e.key === '?') return { kind: 'help' };
  if (e.shiftKey) return null;
  if (e.key === 'c') {
    return ctx.createHref !== null && ctx.createHref !== ''
      ? { kind: 'navigate', href: ctx.createHref }
      : null;
  }
  if (e.key === 'l')
    return ctx.linkShortcut ? { kind: 'click', selector: LINK_BUTTON_SELECTOR } : null;
  if (e.key === '.')
    return ctx.ideShortcut ? { kind: 'click', selector: IDE_BUTTON_SELECTOR } : null;
  if (e.key === 'e') return ctx.editShortcut ? { kind: 'edit' } : null;
  if (e.key === 't') return ctx.timeShortcut ? { kind: 'log-time' } : null;
  return null;
}
