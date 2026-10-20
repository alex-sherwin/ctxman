import Fuse from 'fuse.js';
import { describe, expect, it } from 'vitest';
import type { SearchDoc } from '../../src/lib/entry-summary.ts';
import { FUSE_OPTIONS } from '../../src/lib/search-config.ts';
import {
  buildTagIndex,
  isSearchable,
  parseSearchQuery,
  searchDocs,
} from '../../src/lib/search-query.ts';

function doc(id: string, tags: string[], body = ''): SearchDoc {
  const [dataset = 'kb', slug = id] = id.split('/');
  return {
    id,
    dataset: dataset as SearchDoc['dataset'],
    slug,
    path: null,
    title: slug,
    name: slug,
    description: '',
    tags,
    headings: [],
    body,
    url: `/${id}`,
  };
}

const DOCS = [
  doc('kb/forge-notes', ['forge', 'UI'], 'drag and drop of context links'),
  doc('kb/inflate-notes', ['inflate'], 'working directory runs'),
  doc('task/drag-fix', ['forge', 'bug-hunt'], 'drag handle fix'),
  doc('task/other', [], 'drag something unrelated'),
];

function run(query: string, limit?: number) {
  return searchDocs(new Fuse(DOCS, FUSE_OPTIONS), DOCS, buildTagIndex(DOCS), query, limit);
}

describe('parseSearchQuery', () => {
  it('splits #tag tokens (lower-cased, no repeats) from the fuzzy text', () => {
    expect(parseSearchQuery('  #UI drag  #forge #ui  drop ')).toEqual({
      text: 'drag drop',
      tags: ['ui', 'forge'],
    });
    expect(parseSearchQuery('# alone')).toEqual({ text: '# alone', tags: [] });
    expect(parseSearchQuery('')).toEqual({ text: '', tags: [] });
  });

  it('isSearchable: a #tag or MIN_QUERY characters of text', () => {
    expect(isSearchable('#x')).toBe(true);
    expect(isSearchable('ab')).toBe(true);
    expect(isSearchable('a')).toBe(false);
    expect(isSearchable('#')).toBe(false);
  });
});

describe('buildTagIndex', () => {
  it('indexes every tag value on its own, case-insensitively', () => {
    const index = buildTagIndex(DOCS);
    expect(index.get('forge')).toEqual([0, 2]);
    expect(index.get('ui')).toEqual([0]);
    expect(index.get('bug-hunt')).toEqual([2]);
    expect(index.has('bug')).toBe(false);
  });
});

describe('searchDocs', () => {
  it('without #tags it is the plain fuzzy search', () => {
    const ids = run('drag').map((hit) => hit.item.id);
    expect(ids).toContain('task/other');
    expect(ids).toContain('task/drag-fix');
    expect(run('d')).toEqual([]);
  });

  it('a #tag alone lists every doc carrying it exactly, in index order, with the tag highlighted whole', () => {
    const hits = run('#Forge');
    expect(hits.map((hit) => hit.item.id)).toEqual(['kb/forge-notes', 'task/drag-fix']);
    expect(hits[0]?.score).toBe(0);
    expect(hits[0]?.matches).toEqual([
      { key: 'tags', refIndex: 0, value: 'forge', indices: [[0, 4]] },
    ]);
    // exact: a tag that only starts like it does not count
    expect(run('#bug')).toEqual([]);
    expect(run('#nope')).toEqual([]);
  });

  it('several #tags must all be there; the rest of the query ranks the survivors', () => {
    expect(run('#forge #ui').map((hit) => hit.item.id)).toEqual(['kb/forge-notes']);
    const hits = run('#forge drag');
    expect(hits.map((hit) => hit.item.id).sort()).toEqual(['kb/forge-notes', 'task/drag-fix']);
    expect(
      hits.every((hit) => hit.matches?.some((m) => m.key === 'tags' && m.value === 'forge')),
    ).toBe(true);
  });

  it('applies the limit after the tag filter', () => {
    expect(run('#forge', 1).map((hit) => hit.item.id)).toEqual(['kb/forge-notes']);
    expect(run('#forge drag', 1)).toHaveLength(1);
  });
});
