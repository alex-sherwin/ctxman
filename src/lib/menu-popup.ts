// PURE (no fs, no DOM): the keyboard and placement math of the SSR popup menus that src/scripts/shell.ts drives (the
// menu of src/components/MarkdownCopyButton.astro), matching the react-aria menus of the islands.

/** The keys that move focus inside an open menu. */
export type MenuNavKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

export function isMenuNavKey(key: string): key is MenuNavKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

/**
 * The index of the item to focus after `key`, with `current` the focused one (-1: none) among `count` items; null when
 * there is no item. Arrows wrap around; with nothing focused, ArrowDown goes to the first item and ArrowUp to the last.
 */
export function menuFocusIndex(key: MenuNavKey, current: number, count: number): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (current < 0 || current > last) return key === 'ArrowDown' ? 0 : last;
  if (key === 'ArrowDown') return current === last ? 0 : current + 1;
  return current === 0 ? last : current - 1;
}

export interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Gap between the trigger and the menu (the kit `Popover` default). */
export const MENU_OFFSET = 2;
/** The menu keeps this far from the viewport edges. */
export const MENU_MARGIN = 8;

/**
 * Where a menu of `size` goes for a trigger at `anchor` (viewport coordinates, like `position: fixed`): react-aria's
 * `placement="bottom end"`, i.e. under the trigger with their right edges aligned, `offset` apart. It flips above when
 * it does not fit below and there is more room above, and it is shifted sideways to stay `margin` inside the viewport.
 */
export function placeMenu(
  anchor: Rect,
  size: Size,
  viewport: Size,
  offset = MENU_OFFSET,
  margin = MENU_MARGIN,
): { top: number; left: number } {
  const maxLeft = viewport.width - margin - size.width;
  const left = Math.max(margin, Math.min(anchor.right - size.width, maxLeft));
  const below = anchor.bottom + offset;
  const roomBelow = viewport.height - margin - below;
  const roomAbove = anchor.top - offset - margin;
  if (size.height <= roomBelow || roomAbove <= roomBelow) return { top: below, left };
  return { top: Math.max(margin, anchor.top - offset - size.height), left };
}
