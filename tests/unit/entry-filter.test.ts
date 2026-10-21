import { describe, expect, it } from 'vitest';
import {
  defaultSortDir,
  filterEntries,
  mergeEntries,
  stateCounts,
  tagCounts,
} from '../../src/lib/entry-filter.ts';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';

function entry(over: Partial<EntrySummary> & Pick<EntrySummary, 'slug'>): EntrySummary {
  return {
    dataset: 'task',
    name: over.slug,
    description: '',
    tags: [],
    lastModified: '2026-10-01T00:00:00.000Z',
    stale: false,
    url: `/task/${over.slug}`,
    ...over,
  };
}

const ENTRIES: EntrySummary[] = [
  entry({
    slug: 'write-agents-md',
    title: 'Write AGENTS.md',
    description: 'Document the repo for coding agents',
    tags: ['docs', 'agents'],
    state: 'in-progress',
    lastModified: '2026-10-10T00:00:00.000Z',
  }),
  entry({
    slug: 'seed-sample-data',
    description: 'Create sample datasets',
    tags: ['docs', 'testing'],
    state: 'complete',
    lastModified: '2026-10-15T00:00:00.000Z',
  }),
  entry({
    slug: 'forge-e2e-coverage',
    description: 'Cover the forge with Playwright',
    tags: ['testing'],
    state: 'pending',
    lastModified: '2026-10-12T00:00:00.000Z',
  }),
  entry({
    slug: 'windows-smoke-test',
    title: 'Windows smoke test',
    description: 'Run on Windows',
    tags: ['testing', 'windows'],
    state: 'wont-do',
    lastModified: '2026-09-01T00:00:00.000Z',
  }),
  entry({
    slug: 'no-state-task',
    description: 'Entry without any state',
    lastModified: '2026-10-20T00:00:00.000Z',
  }),
];

const slugs = (list: readonly EntrySummary[]): string[] => list.map((e) => e.slug);

describe('filterEntries', () => {
  it('returns everything, sorted by modified desc, with no filters', () => {
    expect(slugs(filterEntries(ENTRIES, {}))).toEqual([
      'no-state-task',
      'seed-sample-data',
      'forge-e2e-coverage',
      'write-agents-md',
      'windows-smoke-test',
    ]);
  });

  it('never mutates its input', () => {
    const copy = [...ENTRIES];
    filterEntries(ENTRIES, { sort: 'name' });
    expect(ENTRIES).toEqual(copy);
  });

  describe('keys', () => {
    const keys = new Set(['task/forge-e2e-coverage', 'task/write-agents-md', 'kb/not-here']);

    it('restricts to the listed dataset/slug keys', () => {
      expect(slugs(filterEntries(ENTRIES, { keys }))).toEqual([
        'forge-e2e-coverage',
        'write-agents-md',
      ]);
    });

    it('null, undefined and absent mean no restriction; an empty set matches nothing', () => {
      expect(filterEntries(ENTRIES, { keys: null })).toHaveLength(ENTRIES.length);
      expect(filterEntries(ENTRIES, { keys: undefined })).toHaveLength(ENTRIES.length);
      expect(filterEntries(ENTRIES, { keys: new Set() })).toEqual([]);
    });

    it('matches the dataset too (a task slug does not match a kb key)', () => {
      expect(filterEntries(ENTRIES, { keys: new Set(['kb/write-agents-md']) })).toEqual([]);
    });

    it('combines with the other filters (AND)', () => {
      expect(slugs(filterEntries(ENTRIES, { keys, states: ['pending'] }))).toEqual([
        'forge-e2e-coverage',
      ]);
      expect(slugs(filterEntries(ENTRIES, { keys, q: 'agents', sort: 'name' }))).toEqual([
        'write-agents-md',
      ]);
    });
  });

  describe('q', () => {
    it('matches case-insensitively against name, title, description and tags', () => {
      expect(slugs(filterEntries(ENTRIES, { q: 'AGENTS' }))).toEqual(['write-agents-md']);
      expect(slugs(filterEntries(ENTRIES, { q: 'playwright' }))).toEqual(['forge-e2e-coverage']);
      expect(slugs(filterEntries(ENTRIES, { q: 'Windows' }))).toEqual(['windows-smoke-test']);
      expect(slugs(filterEntries(ENTRIES, { q: 'seed-sample' }))).toEqual(['seed-sample-data']);
    });

    it('ANDs whitespace-separated terms (each a substring, in any field)', () => {
      expect(slugs(filterEntries(ENTRIES, { q: 'docs agents' }))).toEqual(['write-agents-md']);
      expect(slugs(filterEntries(ENTRIES, { q: '  testing   windows ' }))).toEqual([
        'windows-smoke-test',
      ]);
      expect(filterEntries(ENTRIES, { q: 'docs windows' })).toEqual([]);
    });

    it('treats blank q as no filter', () => {
      expect(filterEntries(ENTRIES, { q: '   ' })).toHaveLength(ENTRIES.length);
      expect(filterEntries(ENTRIES, { q: '' })).toHaveLength(ENTRIES.length);
    });

    it('matches terms as substrings, not words', () => {
      expect(slugs(filterEntries(ENTRIES, { q: 'cover' }))).toEqual(['forge-e2e-coverage']);
    });
  });

  describe('states (OR)', () => {
    it('keeps entries in any of the given states', () => {
      expect(
        slugs(filterEntries(ENTRIES, { states: ['pending', 'complete'], sort: 'name' })),
      ).toEqual(['forge-e2e-coverage', 'seed-sample-data']);
    });

    it('excludes entries without a state when filtering by state', () => {
      expect(slugs(filterEntries(ENTRIES, { states: ['in-progress'] }))).toEqual([
        'write-agents-md',
      ]);
    });

    it('empty states = all', () => {
      expect(filterEntries(ENTRIES, { states: [] })).toHaveLength(ENTRIES.length);
    });
  });

  describe('tags (AND)', () => {
    it('requires every selected tag', () => {
      expect(slugs(filterEntries(ENTRIES, { tags: ['testing'], sort: 'name' }))).toEqual([
        'forge-e2e-coverage',
        'seed-sample-data',
        'windows-smoke-test',
      ]);
      expect(slugs(filterEntries(ENTRIES, { tags: ['testing', 'docs'] }))).toEqual([
        'seed-sample-data',
      ]);
      expect(filterEntries(ENTRIES, { tags: ['docs', 'windows'] })).toEqual([]);
    });

    it('matches tags exactly, not by substring', () => {
      expect(filterEntries(ENTRIES, { tags: ['test'] })).toEqual([]);
    });
  });

  describe('type', () => {
    const refs: EntrySummary[] = [
      entry({ dataset: 'reference', slug: 'a', refType: 'remote-repo' }),
      entry({ dataset: 'reference', slug: 'b', refType: 'local-repo' }),
      entry({ dataset: 'reference', slug: 'c', refType: 'remote-skill' }),
    ];

    it('equals refType', () => {
      expect(slugs(filterEntries(refs, { type: 'local-repo' }))).toEqual(['b']);
      expect(slugs(filterEntries(refs, { type: 'remote-skill' }))).toEqual(['c']);
    });

    it('null / undefined / empty = all', () => {
      expect(filterEntries(refs, { type: null })).toHaveLength(3);
      expect(filterEntries(refs, {})).toHaveLength(3);
      expect(filterEntries(refs, { type: '' })).toHaveLength(3);
    });

    it('entries without refType never match a type', () => {
      expect(filterEntries(ENTRIES, { type: 'remote-repo' })).toEqual([]);
    });
  });

  describe('combined', () => {
    it('applies every filter together', () => {
      const result = filterEntries(ENTRIES, {
        q: 'docs',
        states: ['in-progress', 'complete'],
        tags: ['docs'],
      });
      expect(slugs(result)).toEqual(['seed-sample-data', 'write-agents-md']);
    });
  });

  describe('sort', () => {
    it('modified: newest first (default and for unknown values)', () => {
      const expected = [
        'no-state-task',
        'seed-sample-data',
        'forge-e2e-coverage',
        'write-agents-md',
        'windows-smoke-test',
      ];
      expect(slugs(filterEntries(ENTRIES, { sort: 'modified' }))).toEqual(expected);
      expect(slugs(filterEntries(ENTRIES, { sort: 'bogus' }))).toEqual(expected);
      expect(slugs(filterEntries(ENTRIES, { sort: undefined }))).toEqual(expected);
    });

    it('name: title ?? name, ascending, locale-aware', () => {
      // titles/names: "Write AGENTS.md", seed-sample-data, forge-e2e-coverage, "Windows smoke test", no-state-task
      expect(slugs(filterEntries(ENTRIES, { sort: 'name' }))).toEqual([
        'forge-e2e-coverage',
        'no-state-task',
        'seed-sample-data',
        'windows-smoke-test',
        'write-agents-md',
      ]);
    });

    it('name: is case-insensitive in effect (localeCompare), not codepoint order', () => {
      const list = [
        entry({ slug: 'b', title: 'banana' }),
        entry({ slug: 'a', title: 'Cherry' }),
        entry({ slug: 'c', title: 'apple' }),
      ];
      expect(slugs(filterEntries(list, { sort: 'name' }))).toEqual(['c', 'b', 'a']);
    });

    it('state: lifecycle order, then name; entries without state last', () => {
      expect(slugs(filterEntries(ENTRIES, { sort: 'state' }))).toEqual([
        'forge-e2e-coverage', // pending
        'write-agents-md', // in-progress
        'seed-sample-data', // complete
        'windows-smoke-test', // wont-do
        'no-state-task', // none
      ]);
    });

    it('state: ties inside one state are ordered by name', () => {
      const list = [
        entry({ slug: 'zeta', state: 'pending' }),
        entry({ slug: 'alpha', state: 'pending' }),
        entry({ slug: 'mid', state: 'in-progress' }),
      ];
      expect(slugs(filterEntries(list, { sort: 'state' }))).toEqual(['alpha', 'zeta', 'mid']);
    });

    it('state: uses each entry dataset lifecycle (bug: fixed before wont-fix)', () => {
      const list = [
        entry({ dataset: 'bug', slug: 'a', state: 'wont-fix' }),
        entry({ dataset: 'bug', slug: 'b', state: 'fixed' }),
        entry({ dataset: 'bug', slug: 'c', state: 'pending' }),
      ];
      expect(slugs(filterEntries(list, { sort: 'state' }))).toEqual(['c', 'b', 'a']);
    });

    it('state: datasets without lifecycle fall back to name order', () => {
      const list = [
        entry({ dataset: 'kb', slug: 'b' }),
        entry({ dataset: 'kb', slug: 'a' }),
        entry({ dataset: 'kb', slug: 'c' }),
      ];
      expect(slugs(filterEntries(list, { sort: 'state' }))).toEqual(['a', 'b', 'c']);
    });

    it('modified: equal timestamps tie-break by name', () => {
      const list = [entry({ slug: 'b' }), entry({ slug: 'a' })];
      expect(slugs(filterEntries(list, {}))).toEqual(['a', 'b']);
    });

    it('dir reverses the sort key; ties stay in name order', () => {
      expect(slugs(filterEntries(ENTRIES, { sort: 'modified', dir: 'asc' }))).toEqual([
        'windows-smoke-test',
        'write-agents-md',
        'forge-e2e-coverage',
        'seed-sample-data',
        'no-state-task',
      ]);
      expect(slugs(filterEntries(ENTRIES, { sort: 'name', dir: 'desc' }))).toEqual([
        'write-agents-md',
        'windows-smoke-test',
        'seed-sample-data',
        'no-state-task',
        'forge-e2e-coverage',
      ]);
      const same = [entry({ slug: 'b' }), entry({ slug: 'a' })];
      expect(slugs(filterEntries(same, { sort: 'modified', dir: 'asc' }))).toEqual(['a', 'b']);
    });

    it('state desc: reverse lifecycle order, entries without a state still last', () => {
      expect(slugs(filterEntries(ENTRIES, { sort: 'state', dir: 'desc' }))).toEqual([
        'windows-smoke-test',
        'seed-sample-data',
        'write-agents-md',
        'forge-e2e-coverage',
        'no-state-task',
      ]);
    });

    it('type / owner (reference): A→Z by value, entries without one last in both directions', () => {
      const ref = (slug: string, over: Partial<EntrySummary>) =>
        entry({ dataset: 'reference', slug, ...over });
      const list = [
        ref('a', { refType: 'remote-skill', owner: 'me' }),
        ref('b', { refType: 'local-repo', owner: 'not-me' }),
        ref('c', {}),
        ref('d', { refType: 'remote-repo', owner: 'me' }),
      ];
      expect(slugs(filterEntries(list, { sort: 'type' }))).toEqual(['b', 'd', 'a', 'c']);
      expect(slugs(filterEntries(list, { sort: 'type', dir: 'desc' }))).toEqual([
        'a',
        'd',
        'b',
        'c',
      ]);
      expect(slugs(filterEntries(list, { sort: 'owner' }))).toEqual(['a', 'd', 'b', 'c']);
    });

    it('links / contexts: biggest count first by default', () => {
      const list = [
        entry({ dataset: 'context', slug: 'a', linkCount: 2 }),
        entry({ dataset: 'context', slug: 'b', linkCount: 7 }),
        entry({ dataset: 'context', slug: 'c' }),
      ];
      expect(slugs(filterEntries(list, { sort: 'links' }))).toEqual(['b', 'a', 'c']);
      expect(slugs(filterEntries(list, { sort: 'links', dir: 'asc' }))).toEqual(['c', 'a', 'b']);
      const recipes = [
        entry({ dataset: 'recipe', slug: 'x', contextCount: 1, recipeTarget: 'codex' }),
        entry({ dataset: 'recipe', slug: 'y', contextCount: 3, recipeTarget: 'claude-code' }),
      ];
      expect(slugs(filterEntries(recipes, { sort: 'contexts' }))).toEqual(['y', 'x']);
      expect(slugs(filterEntries(recipes, { sort: 'target' }))).toEqual(['y', 'x']);
    });

    it('time: most time logged first; no time or no total after every total, both ways', () => {
      const list = [
        entry({ slug: 'a', timeSeconds: 1800 }),
        entry({ slug: 'b' }),
        entry({ slug: 'c', timeSeconds: 7200 }),
        entry({ slug: 'd', timeSeconds: null }),
        entry({ slug: 'e', timeSeconds: 0 }),
      ];
      expect(slugs(filterEntries(list, { sort: 'time' }))).toEqual(['c', 'a', 'e', 'b', 'd']);
      expect(slugs(filterEntries(list, { sort: 'time', dir: 'asc' }))).toEqual([
        'e',
        'a',
        'c',
        'b',
        'd',
      ]);
    });
  });
});

describe('defaultSortDir', () => {
  it('starts names, states and labels A→Z, times and counts biggest first', () => {
    for (const sort of ['name', 'state', 'type', 'owner', 'target']) {
      expect(defaultSortDir(sort)).toBe('asc');
    }
    for (const sort of ['modified', 'links', 'contexts', 'time', 'bogus', undefined]) {
      expect(defaultSortDir(sort)).toBe('desc');
    }
  });
});

describe('tagCounts', () => {
  it('counts tags, count desc then tag asc', () => {
    expect(tagCounts(ENTRIES)).toEqual([
      { tag: 'testing', count: 3 },
      { tag: 'docs', count: 2 },
      { tag: 'agents', count: 1 },
      { tag: 'windows', count: 1 },
    ]);
  });

  it('counts a tag once per entry even if duplicated, and handles empty input', () => {
    expect(tagCounts([entry({ slug: 'a', tags: ['x', 'x'] })])).toEqual([{ tag: 'x', count: 1 }]);
    expect(tagCounts([])).toEqual([]);
  });
});

describe('stateCounts', () => {
  it('counts entries per state and skips entries without one', () => {
    expect(stateCounts(ENTRIES)).toEqual({
      'in-progress': 1,
      complete: 1,
      pending: 1,
      'wont-do': 1,
    });
    expect(stateCounts([])).toEqual({});
  });
});

describe('mergeEntries', () => {
  const kb1 = entry({ dataset: 'kb', slug: 'k1', url: '/kb/k1' });
  const kb2 = entry({ dataset: 'kb', slug: 'k2', url: '/kb/k2' });
  const task1 = entry({ slug: 't1' });
  const ref1 = entry({ dataset: 'reference', slug: 'r1', url: '/reference/r1' });
  const map = {
    kb: { status: 'ready', entries: [kb1, kb2] },
    task: { status: 'ready', entries: [task1] },
    reference: { status: 'loading', entries: [ref1] },
  };

  it('concatenates the datasets in the given order, each dataset in its own order', () => {
    expect(mergeEntries(map, ['task', 'kb']).map((e) => e.slug)).toEqual(['t1', 'k1', 'k2']);
    expect(mergeEntries(map, ['kb', 'reference', 'task']).map((e) => e.slug)).toEqual([
      'k1',
      'k2',
      'r1',
      't1',
    ]);
  });

  it('skips datasets missing from the map and repeated datasets', () => {
    expect(mergeEntries(map, ['bug', 'kb', 'kb', 'skill']).map((e) => e.slug)).toEqual([
      'k1',
      'k2',
    ]);
    expect(mergeEntries({}, ['kb'])).toEqual([]);
    expect(mergeEntries(map, [])).toEqual([]);
  });

  it('keeps the entries themselves (no copies) and does not touch the input', () => {
    const merged = mergeEntries(map, ['kb']);
    expect(merged[0]).toBe(kb1);
    expect(map.kb.entries).toEqual([kb1, kb2]);
  });

  it('feeds filterEntries and tagCounts like any entry list', () => {
    const tagged = {
      kb: { entries: [entry({ dataset: 'kb', slug: 'a', tags: ['x'] })] },
      task: { entries: [entry({ slug: 'b', tags: ['x', 'y'] })] },
    };
    const merged = mergeEntries(tagged, ['kb', 'task']);
    expect(tagCounts(merged)).toEqual([
      { tag: 'x', count: 2 },
      { tag: 'y', count: 1 },
    ]);
    expect(slugs(filterEntries(merged, { tags: ['y'] }))).toEqual(['b']);
  });
});
