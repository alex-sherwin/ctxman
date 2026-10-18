import { describe, expect, it } from 'vitest';
import {
  buildRelationGraph,
  childrenOf,
  linkedFrom,
  linksTo,
  parentsOf,
} from '../../src/lib/relations.ts';
import type { IndexedEntry } from '../../src/lib/entry-index.ts';
import type { EntryRel } from '../../src/datasets/registry.ts';

type Source = Pick<IndexedEntry, 'dataset' | 'slug' | 'relations' | 'mentions'>;

const entry = (
  key: string,
  relations: [string, EntryRel][] = [],
  mentions: [string, string][] = [],
): Source => {
  const [dataset, slug] = key.split('/') as [Source['dataset'], string];
  return {
    dataset,
    slug,
    relations: relations.map(([target, rel]) => {
      const [d, s] = target.split('/') as [never, string];
      return { dataset: d, slug: s, rel };
    }),
    mentions: mentions.map(([target, file]) => {
      const [d, s] = target.split('/') as [never, string];
      return { dataset: d, slug: s, file, line: 1 };
    }),
  };
};

const summary = (
  edges: readonly { from?: string; to: string; rel: string }[],
  side: 'to' | 'from',
) => edges.map((e) => `${e[side]}:${e.rel}`);

describe('buildRelationGraph', () => {
  it('builds outgoing frontmatter edges in file order, then mentions in first-occurrence order', () => {
    const g = buildRelationGraph([
      entry(
        'project/p',
        [
          ['task/b', 'child'],
          ['task/a', 'child'],
          ['kb/k', 'related'],
        ],
        [
          ['idea/i', 'main.md'],
          ['task/a', 'main.md'], // already a frontmatter target: no mention edge
          ['feature/f', 'concepts/x.md'],
          ['idea/i', 'concepts/x.md'],
        ],
      ),
    ]);
    const out = linksTo(g, 'project/p');
    expect(summary(out, 'to')).toEqual([
      'task/b:child',
      'task/a:child',
      'kb/k:related',
      'idea/i:mentions',
      'feature/f:mentions',
    ]);
    expect(out.map((e) => e.source)).toEqual([
      'frontmatter',
      'frontmatter',
      'frontmatter',
      'body',
      'body',
    ]);
    expect(out.every((e) => e.from === 'project/p')).toBe(true);
  });

  it('collects the files of a mention, first occurrence first, without repeats', () => {
    const g = buildRelationGraph([
      entry(
        'kb/x',
        [],
        [
          ['task/t', 'main.md'],
          ['task/t', 'concepts/a.md'],
          ['task/t', 'main.md'],
          ['task/t', 'concepts/a.md'],
          ['task/t', 'log.md'],
        ],
      ),
    ]);
    const [edge, ...rest] = linksTo(g, 'kb/x');
    expect(rest).toEqual([]);
    expect(edge).toMatchObject({ rel: 'mentions', source: 'body' });
    expect(edge?.files).toEqual(['main.md', 'concepts/a.md', 'log.md']);
  });

  it('gives frontmatter edges an empty file list', () => {
    const g = buildRelationGraph([entry('task/a', [['kb/k', 'depends-on']])]);
    expect(linksTo(g, 'task/a')[0]).toEqual({
      from: 'task/a',
      to: 'kb/k',
      rel: 'depends-on',
      source: 'frontmatter',
      files: [],
    });
  });

  it('frontmatter beats a mention of the same target from the same entry, in both directions', () => {
    const g = buildRelationGraph([
      entry('task/a', [['feature/f', 'depends-on']], [['feature/f', 'main.md']]),
    ]);
    expect(summary(linksTo(g, 'task/a'), 'to')).toEqual(['feature/f:depends-on']);
    expect(summary(linkedFrom(g, 'feature/f'), 'from')).toEqual(['task/a:depends-on']);
  });

  it('ignores self links, and a repeated frontmatter target keeps the first rel', () => {
    const g = buildRelationGraph([
      entry(
        'task/a',
        [
          ['task/a', 'related'],
          ['kb/k', 'child'],
          ['kb/k', 'related'],
        ],
        [['task/a', 'main.md']],
      ),
    ]);
    expect(summary(linksTo(g, 'task/a'), 'to')).toEqual(['kb/k:child']);
    expect(linkedFrom(g, 'task/a')).toEqual([]);
  });

  it('returns shared empty lists for keys without edges', () => {
    const g = buildRelationGraph([entry('task/a')]);
    expect(linksTo(g, 'task/a')).toEqual([]);
    expect(linksTo(g, 'nope/none')).toEqual([]);
    expect(linkedFrom(g, 'task/a')).toEqual([]);
    expect(childrenOf(g, 'task/a')).toEqual([]);
    expect(parentsOf(g, 'task/a')).toEqual([]);
  });

  it('keeps edges to targets that are not entries (callers mark them missing)', () => {
    const g = buildRelationGraph([entry('task/a', [['kb/ghost', 'related']])]);
    expect(summary(linkedFrom(g, 'kb/ghost'), 'from')).toEqual(['task/a:related']);
  });
});

describe('linkedFrom ordering', () => {
  it('orders incoming edges child, depends-on, related, mentions, then by source key', () => {
    const g = buildRelationGraph([
      entry('task/z-mention', [], [['feature/target', 'main.md']]),
      entry('kb/a-mention', [], [['feature/target', 'main.md']]),
      entry('task/rel-b', [['feature/target', 'related']]),
      entry('bug/rel-a', [['feature/target', 'related']]),
      entry('task/needs', [['feature/target', 'depends-on']]),
      entry('project/p2', [['feature/target', 'child']]),
      entry('project/p1', [['feature/target', 'child']]),
    ]);
    expect(summary(linkedFrom(g, 'feature/target'), 'from')).toEqual([
      'project/p1:child',
      'project/p2:child',
      'task/needs:depends-on',
      'bug/rel-a:related',
      'task/rel-b:related',
      'kb/a-mention:mentions',
      'task/z-mention:mentions',
    ]);
  });
});

describe('childrenOf / parentsOf', () => {
  const g = buildRelationGraph([
    entry(
      'project/p',
      [
        ['task/second', 'child'],
        ['kb/rel', 'related'],
        ['bug/first', 'child'],
        ['feature/dep', 'depends-on'],
      ],
      [['task/mentioned', 'main.md']],
    ),
    entry('project/other', [['bug/first', 'child']]),
    entry('task/second', [], [['project/p', 'main.md']]),
  ]);

  it('lists the declared children in file order, only child edges', () => {
    expect(childrenOf(g, 'project/p')).toEqual(['task/second', 'bug/first']);
    expect(childrenOf(g, 'task/second')).toEqual([]);
  });

  it('lists the entries that declare a child edge to the key, ignoring mentions', () => {
    expect(parentsOf(g, 'bug/first')).toEqual(['project/other', 'project/p']);
    expect(parentsOf(g, 'task/second')).toEqual(['project/p']);
    expect(parentsOf(g, 'project/p')).toEqual([]);
    expect(parentsOf(g, 'task/mentioned')).toEqual([]);
  });
});
