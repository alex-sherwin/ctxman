// Browser-safe + PURE (structural DOM types, unit-tested with fakes in tests/unit/list-table.test.ts): which list
// row the `t` shortcut (Log time, src/lib/shortcuts.ts) means. The row with the keyboard focus wins (focus on the row
// itself or on a control in it: "selected" in this grid is focus); else the row under the pointer (`:hover` at key
// time, so nothing is tracked between presses); else none, and the key does nothing on the list.

/** A data row of the ListTable (the header row has no `data-slug`). */
export const LIST_ROW_SELECTOR = 'tr[data-slug]';

/** The parts of an Element this needs (DOM nodes satisfy them; tests pass fakes). */
export interface RowScope<R> {
  contains(other: unknown): boolean;
  querySelector(selector: string): R | null;
}
export interface FocusedNode<R> {
  closest(selector: string): R | null;
}

/** The row `t` logs time on: the focused one inside `root`, else the hovered one; null = none. */
export function shortcutRow<R>(root: RowScope<R>, active: FocusedNode<R> | null): R | null {
  if (active !== null && root.contains(active)) {
    const focused = active.closest(LIST_ROW_SELECTOR);
    if (focused !== null) return focused;
  }
  return root.querySelector(`${LIST_ROW_SELECTOR}:hover`);
}
