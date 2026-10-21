// The ListTable island's pure parts: its columns and the layout it keeps in localStorage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import { listSortsFor } from '../../src/lib/url-state.ts';
import { listColumns } from '../../src/ui/list/columns.ts';
import { LIST_DATA_ID, serializeListData } from '../../src/ui/list/list-data.ts';
import {
  DEFAULT_TABLE_PREFS,
  getTablePrefs,
  parseTablePrefs,
  serializeTablePrefs,
  setTablePrefs,
  toColumnWidth,
  withHidden,
  withWidths,
} from '../../src/ui/list/table-prefs.ts';

/** A minimal in-memory localStorage; `broken` makes every access throw (private window). */
function stubLocal(broken = false): Map<string, string> {
  const data = new Map<string, string>();
  const fail = () => {
    throw new Error('SecurityError');
  };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (broken ? fail() : (data.get(k) ?? null)),
    setItem: (k: string, v: string) => (broken ? fail() : void data.set(k, v)),
    removeItem: (k: string) => (broken ? fail() : void data.delete(k)),
  });
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('listColumns', () => {
  it('shows the dataset columns between Entry / Description and Modified', () => {
    const ids = (ds: (typeof DATASET_IDS)[number]) => listColumns(ds).map((c) => c.id);
    expect(ids('task')).toEqual(['entry', 'desc', 'state', 'tags', 'time', 'modified']);
    expect(ids('feature')).toEqual(['entry', 'desc', 'state', 'tags', 'time', 'modified']);
    expect(ids('bug')).toEqual(['entry', 'desc', 'state', 'tags', 'time', 'modified']);
    expect(ids('rca')).toEqual(['entry', 'desc', 'tags', 'time', 'modified']);
    expect(ids('idea')).toEqual(['entry', 'desc', 'state', 'tags', 'modified']);
    expect(ids('project')).toEqual(['entry', 'desc', 'state', 'tags', 'modified']);
    expect(ids('kb')).toEqual(['entry', 'desc', 'tags', 'modified']);
    expect(ids('skill')).toEqual(['entry', 'desc', 'tags', 'modified']);
    expect(ids('reference')).toEqual(['entry', 'desc', 'type', 'owner', 'modified']);
    expect(ids('context')).toEqual(['entry', 'desc', 'links', 'tags', 'modified']);
    expect(ids('recipe')).toEqual(['entry', 'desc', 'target', 'contexts', 'tags', 'modified']);
  });

  it('makes exactly the sorts of the Sort select pressable, and only Entry unhideable', () => {
    for (const ds of DATASET_IDS) {
      const columns = listColumns(ds);
      const sorts = columns.flatMap((c) => (c.sort === undefined ? [] : [c.sort]));
      expect([...sorts].sort(), ds).toEqual([...listSortsFor(ds)].sort());
      expect(columns.filter((c) => !c.hideable).map((c) => c.id)).toEqual(['entry']);
    }
  });
});

describe('serializeListData', () => {
  it('round-trips through JSON and can never close its <script> element', () => {
    const data = {
      dataset: 'task' as const,
      entries: [
        {
          dataset: 'task' as const,
          slug: 'x',
          name: 'x',
          title: 'Close </script><script>alert(1)</script> <!-- here',
          description: 'a < b',
          tags: [],
          lastModified: '2026-10-18T00:00:00.000Z',
          stale: false,
          url: '/task/x',
        },
      ],
      sort: 'modified' as const,
      dir: 'desc' as const,
      now: 1,
    };
    const text = serializeListData(data);
    expect(text).not.toContain('<');
    expect(JSON.parse(text)).toEqual(data);
    expect(LIST_DATA_ID).not.toMatch(/^c[kx]-/);
  });
});

describe('toColumnWidth', () => {
  it('accepts positive px (rounded), % and fr', () => {
    expect(toColumnWidth(140.6)).toBe(141);
    expect(toColumnWidth('1fr')).toBe('1fr');
    expect(toColumnWidth('2.5fr')).toBe('2.5fr');
    expect(toColumnWidth('30%')).toBe('30%');
  });

  it('rejects everything else', () => {
    for (const bad of [0, -5, 5000, Number.NaN, Infinity, '140', '140px', '0fr', 'fr', null, {}]) {
      expect(toColumnWidth(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('parseTablePrefs', () => {
  it('falls back to the defaults for nothing or garbage', () => {
    expect(parseTablePrefs(null)).toEqual(DEFAULT_TABLE_PREFS);
    expect(parseTablePrefs('{nope')).toEqual(DEFAULT_TABLE_PREFS);
    expect(parseTablePrefs('42')).toEqual(DEFAULT_TABLE_PREFS);
  });

  it('keeps the valid parts, key by key', () => {
    const raw = JSON.stringify({
      v: 1,
      widths: { entry: 260, desc: '1fr', state: 'wide', bogus: 100, tags: -1 },
      hidden: ['tags', 'entry', 'tags', 'nope', 3],
      density: 'compact',
    });
    expect(parseTablePrefs(raw)).toEqual({
      widths: { entry: 260, desc: '1fr' },
      hidden: ['tags'],
      density: 'compact',
    });
    expect(parseTablePrefs('{"density":"tiny"}').density).toBe('normal');
  });

  it('round-trips through serializeTablePrefs', () => {
    const prefs = {
      widths: { entry: 300, desc: '1fr' as const },
      hidden: ['modified' as const],
      density: 'compact' as const,
    };
    expect(parseTablePrefs(serializeTablePrefs(prefs))).toEqual(prefs);
  });
});

describe('withWidths / withHidden', () => {
  it('merges the widths of a resize over the stored ones (hidden columns keep theirs)', () => {
    const prefs = { ...DEFAULT_TABLE_PREFS, widths: { tags: 150 } };
    const next = withWidths(
      prefs,
      new Map<unknown, unknown>([
        ['entry', 250.4],
        ['desc', '1fr'],
        ['bogus', 10],
      ]),
    );
    expect(next.widths).toEqual({ tags: 150, entry: 250, desc: '1fr' });
    expect(prefs.widths).toEqual({ tags: 150 });
  });

  it('hides and shows a column, never Entry', () => {
    const hidden = withHidden(DEFAULT_TABLE_PREFS, 'tags', true);
    expect(hidden.hidden).toEqual(['tags']);
    expect(withHidden(hidden, 'tags', true).hidden).toEqual(['tags']);
    expect(withHidden(hidden, 'tags', false).hidden).toEqual([]);
    expect(withHidden(DEFAULT_TABLE_PREFS, 'entry', true).hidden).toEqual([]);
  });
});

describe('getTablePrefs / setTablePrefs', () => {
  it('stores a layout per dataset and removes the key for the defaults', () => {
    const data = stubLocal();
    data.set('ctxman:table:bug', JSON.stringify({ hidden: ['tags'] }));
    expect(getTablePrefs('bug').hidden).toEqual(['tags']);

    setTablePrefs('feature', { ...DEFAULT_TABLE_PREFS, density: 'compact' });
    expect(JSON.parse(data.get('ctxman:table:feature') ?? 'null')).toEqual({
      v: 1,
      widths: {},
      hidden: [],
      density: 'compact',
    });
    expect(getTablePrefs('feature').density).toBe('compact');

    setTablePrefs('feature', DEFAULT_TABLE_PREFS);
    expect(data.has('ctxman:table:feature')).toBe(false);
    expect(getTablePrefs('feature')).toEqual(DEFAULT_TABLE_PREFS);
  });

  it('keeps a change for the page when storage refuses it', () => {
    stubLocal(true);
    expect(getTablePrefs('rca')).toEqual(DEFAULT_TABLE_PREFS);
    setTablePrefs('rca', { ...DEFAULT_TABLE_PREFS, hidden: ['desc'] });
    expect(getTablePrefs('rca').hidden).toEqual(['desc']);
  });
});
