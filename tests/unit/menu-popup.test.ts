import { describe, expect, it } from 'vitest';
import {
  MENU_MARGIN,
  MENU_OFFSET,
  isMenuNavKey,
  menuFocusIndex,
  placeMenu,
} from '../../src/lib/menu-popup.ts';

describe('menuFocusIndex', () => {
  it('moves down and up, wrapping at both ends', () => {
    expect(menuFocusIndex('ArrowDown', 0, 3)).toBe(1);
    expect(menuFocusIndex('ArrowDown', 2, 3)).toBe(0);
    expect(menuFocusIndex('ArrowUp', 2, 3)).toBe(1);
    expect(menuFocusIndex('ArrowUp', 0, 3)).toBe(2);
  });

  it('Home and End go to the first and the last item', () => {
    expect(menuFocusIndex('Home', 2, 3)).toBe(0);
    expect(menuFocusIndex('End', 0, 3)).toBe(2);
    expect(menuFocusIndex('Home', -1, 3)).toBe(0);
  });

  it('with nothing focused, ArrowDown takes the first item and ArrowUp the last', () => {
    expect(menuFocusIndex('ArrowDown', -1, 3)).toBe(0);
    expect(menuFocusIndex('ArrowUp', -1, 3)).toBe(2);
    expect(menuFocusIndex('ArrowDown', 7, 3)).toBe(0);
  });

  it('a single item stays focused, an empty menu has nothing to focus', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End'] as const) {
      expect(menuFocusIndex(key, 0, 1)).toBe(0);
      expect(menuFocusIndex(key, -1, 0)).toBeNull();
    }
  });

  it('isMenuNavKey knows the four keys only', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) expect(isMenuNavKey(key)).toBe(true);
    for (const key of ['Enter', ' ', 'Escape', 'Tab', 'ArrowLeft', 'a']) {
      expect(isMenuNavKey(key)).toBe(false);
    }
  });
});

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 };
  const menu = { width: 180, height: 40 };
  const anchor = (left: number, top: number, width = 18, height = 22) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });

  it('puts the menu under the trigger, right edges aligned, offset apart', () => {
    const a = anchor(500, 100);
    expect(placeMenu(a, menu, viewport)).toEqual({
      top: a.bottom + MENU_OFFSET,
      left: a.right - menu.width,
    });
  });

  it('shifts it right of the left margin when the trigger is near the left edge', () => {
    expect(placeMenu(anchor(20, 100), menu, viewport).left).toBe(MENU_MARGIN);
  });

  it('shifts it left of the right margin when the trigger sticks out on the right', () => {
    expect(placeMenu(anchor(995, 100), menu, viewport).left).toBe(
      viewport.width - MENU_MARGIN - menu.width,
    );
  });

  it('flips above the trigger when it does not fit below and there is more room above', () => {
    const a = anchor(500, 770);
    expect(placeMenu(a, menu, viewport).top).toBe(a.top - MENU_OFFSET - menu.height);
  });

  it('stays below when below has more room, even if it does not fit there', () => {
    const tall = { width: 180, height: 600 };
    const a = anchor(500, 300);
    expect(placeMenu(a, tall, viewport).top).toBe(a.bottom + MENU_OFFSET);
  });

  it('keeps a flipped menu inside the top margin', () => {
    const tall = { width: 180, height: 600 };
    const a = anchor(500, 500);
    expect(placeMenu(a, tall, viewport).top).toBe(MENU_MARGIN);
  });
});
