// The Log time dialog's texts (src/ui/edit/log-time.ts, shared by list rows and entry pages) and which list row the
// `t` shortcut means (src/ui/list/shortcut-row.ts, with fake DOM nodes).
import { describe, expect, it } from 'vitest';
import { loggedMessage, logTimeError } from '../../src/ui/edit/log-time.ts';
import { LIST_ROW_SELECTOR, shortcutRow } from '../../src/ui/list/shortcut-row.ts';

describe('loggedMessage', () => {
  it('names the duration, the entry and the new total', () => {
    expect(loggedMessage('PT1H', 'Fix login', ['PT1H30M', 'PT1H'])).toBe(
      'Logged PT1H on “Fix login” (total 2h 30m)',
    );
    expect(loggedMessage('PT45M', 'A', ['PT45M'])).toBe('Logged PT45M on “A” (total 45m)');
  });

  it('leaves the total out when there is none', () => {
    // a value with months has no fixed length
    expect(loggedMessage('PT1H', 'A', ['P1M', 'PT1H'])).toBe('Logged PT1H on “A”');
    expect(loggedMessage('PT1H', 'A', undefined)).toBe('Logged PT1H on “A”');
    expect(loggedMessage('PT1H', 'A', 'PT1H')).toBe('Logged PT1H on “A”');
  });

  it('skips values that are not strings', () => {
    expect(loggedMessage('PT1H', 'A', ['PT1H', 3, null])).toBe('Logged PT1H on “A” (total 1h)');
  });
});

describe('logTimeError', () => {
  it('lists the issues with their paths', () => {
    expect(
      logTimeError({
        message: 'Invalid',
        issues: [
          { path: 'addTime.0', message: 'Not a duration' },
          { path: '', message: 'Broken' },
        ],
      }),
    ).toBe('addTime.0: Not a duration; Broken');
  });

  it('falls back to the message', () => {
    expect(logTimeError({ message: 'Network error' })).toBe('Network error');
    expect(logTimeError({ message: 'Gone', issues: [] })).toBe('Gone');
  });
});

describe('shortcutRow', () => {
  interface Fake {
    id: string;
  }
  const rowA: Fake = { id: 'a' };
  const rowB: Fake = { id: 'b' };
  /** A root that contains `inside` and whose `:hover` row is `hovered`; records the selectors it is asked. */
  function root(inside: readonly object[], hovered: Fake | null) {
    const asked: string[] = [];
    return {
      asked,
      contains: (node: unknown) => inside.includes(node as object),
      querySelector: (selector: string) => {
        asked.push(selector);
        return selector === `${LIST_ROW_SELECTOR}:hover` ? hovered : null;
      },
    };
  }
  const focusedIn = (row: Fake | null) => ({ closest: () => row });

  it('takes the row with the keyboard focus first, even with another row hovered', () => {
    const active = focusedIn(rowA);
    const r = root([active], rowB);
    expect(shortcutRow(r, active)).toBe(rowA);
    expect(r.asked).toEqual([]);
  });

  it('asks closest() for a data row (the header row has no data-slug)', () => {
    const selectors: string[] = [];
    const active = {
      closest: (s: string) => {
        selectors.push(s);
        return rowA;
      },
    };
    shortcutRow(root([active], null), active);
    expect(selectors).toEqual(['tr[data-slug]']);
  });

  it('takes the hovered row when the focus is outside the table or not in a row', () => {
    const outside = focusedIn(rowA); // e.g. the filter form: not inside the island
    expect(shortcutRow(root([], rowB), outside)).toBe(rowB);
    const header = focusedIn(null); // a column header inside the table
    expect(shortcutRow(root([header], rowB), header)).toBe(rowB);
    expect(shortcutRow(root([], rowB), null)).toBe(rowB);
  });

  it('is null with neither a focused nor a hovered row', () => {
    expect(shortcutRow(root([], null), null)).toBeNull();
    const header = focusedIn(null);
    expect(shortcutRow(root([header], null), header)).toBeNull();
  });
});
