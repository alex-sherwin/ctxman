import { describe, expect, it } from 'vitest';
import { filterEntries, stateCounts, tagCounts } from '../../src/lib/entry-filter.ts';
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
