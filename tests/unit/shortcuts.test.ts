import { describe, expect, it } from 'vitest';
import {
  EDIT_LINK_SELECTOR,
  IDE_BUTTON_SELECTOR,
  LINK_BUTTON_SELECTOR,
  LOG_TIME_BUTTON_SELECTOR,
  LOG_TIME_SHORTCUT_EVENT,
  SHORTCUTS,
  isTypingTarget,
  shortcutAction,
} from '../../src/lib/shortcuts.ts';
import type { KeyInfo, ShortcutContext } from '../../src/lib/shortcuts.ts';

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  defaultPrevented: false,
  isComposing: false,
  ...extra,
});
const ctx = (extra: Partial<ShortcutContext> = {}): ShortcutContext => ({
  createHref: '/new/task',
  linkShortcut: true,
  ideShortcut: true,
  editShortcut: true,
  timeShortcut: true,
  typing: false,
  dialogOpen: false,
  ...extra,
});

describe('shortcutAction', () => {
  it('? opens help, with or without shift', () => {
    expect(shortcutAction(key('?'), ctx())).toEqual({ kind: 'help' });
    expect(shortcutAction(key('?', { shiftKey: true }), ctx())).toEqual({ kind: 'help' });
  });

  it('? works without any page context', () => {
    expect(shortcutAction(key('?'), ctx({ createHref: null, linkShortcut: false }))).toEqual({
      kind: 'help',
    });
  });

  it('c navigates to the create href', () => {
    expect(shortcutAction(key('c'), ctx())).toEqual({ kind: 'navigate', href: '/new/task' });
    expect(shortcutAction(key('c'), ctx({ createHref: '/forge?context=new' }))).toEqual({
      kind: 'navigate',
      href: '/forge?context=new',
    });
  });

  it('c does nothing without a create href', () => {
    expect(shortcutAction(key('c'), ctx({ createHref: null }))).toBeNull();
    expect(shortcutAction(key('c'), ctx({ createHref: '' }))).toBeNull();
  });

  it('. clicks the Open in IDE button only when the page has an enabled one', () => {
    expect(shortcutAction(key('.'), ctx({}))).toEqual({
      kind: 'click',
      selector: IDE_BUTTON_SELECTOR,
    });
    expect(shortcutAction(key('.'), ctx({ ideShortcut: false }))).toBeNull();
    expect(shortcutAction({ ...key('.'), shiftKey: true }, ctx({}))).toBeNull();
    // the old key is free again
    expect(shortcutAction(key('i'), ctx({}))).toBeNull();
  });

  it('l clicks the link button only on pages with the link shortcut', () => {
    expect(shortcutAction(key('l'), ctx())).toEqual({
      kind: 'click',
      selector: LINK_BUTTON_SELECTOR,
    });
    expect(shortcutAction(key('l'), ctx({ linkShortcut: false }))).toBeNull();
  });

  it('e asks for edit mode only on pages that have one', () => {
    expect(shortcutAction(key('e'), ctx())).toEqual({ kind: 'edit' });
    expect(shortcutAction(key('e'), ctx({ editShortcut: false }))).toBeNull();
    expect(shortcutAction(key('E', { shiftKey: true }), ctx())).toBeNull();
    expect(EDIT_LINK_SELECTOR).toBe('[data-shortcut-edit-link]');
  });

  it('t asks for Log time only on pages of time-tracked datasets', () => {
    expect(shortcutAction(key('t'), ctx())).toEqual({ kind: 'log-time' });
    expect(shortcutAction(key('t'), ctx({ timeShortcut: false }))).toBeNull();
    expect(shortcutAction(key('T', { shiftKey: true }), ctx())).toBeNull();
    expect(shortcutAction(key('t', { shiftKey: true }), ctx())).toBeNull();
    // the other page flags do not matter
    expect(
      shortcutAction(
        key('t'),
        ctx({ createHref: null, linkShortcut: false, ideShortcut: false, editShortcut: false }),
      ),
    ).toEqual({ kind: 'log-time' });
    expect(LOG_TIME_SHORTCUT_EVENT).toBe('ctxman:log-time-shortcut');
    // a disabled button (EntryTools locks it while the doc editor is open) is never clicked
    expect(LOG_TIME_BUTTON_SELECTOR).toBe('[data-entry-action="log-time"]:not([disabled])');
  });

  it('c and l do not fire with shift', () => {
    expect(shortcutAction(key('C', { shiftKey: true }), ctx())).toBeNull();
    expect(shortcutAction(key('c', { shiftKey: true }), ctx())).toBeNull();
    expect(shortcutAction(key('l', { shiftKey: true }), ctx())).toBeNull();
  });

  it.each(['metaKey', 'ctrlKey', 'altKey'] as const)('ignores %s for every key', (mod) => {
    for (const k of ['?', 'c', 'l', 'e', 't']) {
      expect(shortcutAction(key(k, { [mod]: true }), ctx())).toBeNull();
    }
  });

  it('ignores defaultPrevented and IME composition', () => {
    expect(shortcutAction(key('c', { defaultPrevented: true }), ctx())).toBeNull();
    expect(shortcutAction(key('?', { isComposing: true }), ctx())).toBeNull();
    expect(shortcutAction(key('t', { defaultPrevented: true }), ctx())).toBeNull();
    expect(shortcutAction(key('t', { isComposing: true }), ctx())).toBeNull();
  });

  it('ignores typing targets and open dialogs', () => {
    for (const k of ['?', 'c', 'l', 'e', 't']) {
      expect(shortcutAction(key(k), ctx({ typing: true }))).toBeNull();
      expect(shortcutAction(key(k), ctx({ dialogOpen: true }))).toBeNull();
    }
  });

  it('ignores other keys', () => {
    for (const k of ['a', 'C', 'L', '/', 'Enter', 'Escape', 'k']) {
      expect(shortcutAction(key(k), ctx())).toBeNull();
    }
  });
});

describe('isTypingTarget', () => {
  const stub = (matches: readonly string[]) => ({
    closest: (selector: string) => (matches.some((m) => selector.includes(m)) ? {} : null),
  });

  it('is false for null and for plain elements', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(stub([]))).toBe(false);
  });

  it('is true for inputs, textareas, selects, contenteditable, Monaco and menus', () => {
    for (const m of [
      'input',
      'textarea',
      'select',
      '[contenteditable]',
      '.monaco-editor',
      '[role="menu"]',
    ]) {
      expect(isTypingTarget(stub([m]))).toBe(true);
    }
  });

  it('asks closest() once with one selector list', () => {
    const selectors: string[] = [];
    isTypingTarget({
      closest: (s) => {
        selectors.push(s);
        return null;
      },
    });
    expect(selectors).toHaveLength(1);
    for (const part of [
      'input',
      'textarea',
      'select',
      '[contenteditable]',
      '.monaco-editor',
      '[role="menu"]',
    ]) {
      expect(selectors[0]).toContain(part);
    }
  });
});

describe('SHORTCUTS', () => {
  it('has unique ids and non-empty keys', () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    for (const s of SHORTCUTS) expect(s.keys.length).toBeGreaterThan(0);
  });

  it('lists ?, Mod+K, c, l, ., e, t, Mod+S, Mod+Alt+K and Esc', () => {
    const combos = SHORTCUTS.map((s) => s.keys.join('+'));
    expect(combos).toEqual(['?', 'Mod+K', 'c', 'l', '.', 'e', 't', 'Mod+S', 'Mod+Alt+K', 'Esc']);
  });

  it('says where t works: the time-tracked entry and document pages and lists only', () => {
    const t = SHORTCUTS.find((s) => s.id === 'log-time');
    expect(t?.keys).toEqual(['t']);
    expect(t?.where).toBe('Task, feature, bug and rca entry pages, their document pages and lists');
  });
});
