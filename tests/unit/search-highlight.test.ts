import Fuse from 'fuse.js';
import type { FuseResult, FuseResultMatch } from 'fuse.js';
import { describe, expect, it } from 'vitest';
import type { SearchDoc } from '../../src/lib/entry-summary.ts';
import { FUSE_OPTIONS, MAX_RESULTS, MIN_QUERY } from '../../src/lib/search-config.ts';
import {
  DESCRIPTION_MAX,
  keyRanges,
  matchingTags,
  normalizeRanges,
  pickSnippet,
  segments,
} from '../../src/lib/search-highlight.ts';

function doc(over: Partial<SearchDoc> = {}): SearchDoc {
  return {
    id: 'kb/demo',
    dataset: 'kb',
    slug: 'demo',
    path: null,
    title: 'Demo',
    name: 'demo',
    description: '',
    tags: [],
    headings: [],
    body: '',
    url: '/kb/demo',
    ...over,
  };
}

function hit(item: SearchDoc, matches: FuseResultMatch[] = []): FuseResult<SearchDoc> {
  return { item, refIndex: 0, score: 0.1, matches };
}

/** Text covered by the given ranges, in order. */
function covered(text: string, ranges: readonly (readonly [number, number])[]): string[] {
  return ranges.map(([s, e]) => text.slice(s, e + 1));
}

describe('search config', () => {
  it('matches the UI spec values', () => {
    expect(MIN_QUERY).toBe(2);
    expect(MAX_RESULTS).toBe(60);
    expect(FUSE_OPTIONS.threshold).toBe(0.35);
    expect(FUSE_OPTIONS.ignoreLocation).toBe(true);
    expect(FUSE_OPTIONS.includeMatches).toBe(true);
    expect(FUSE_OPTIONS.includeScore).toBe(true);
    expect(FUSE_OPTIONS.minMatchCharLength).toBe(2);
    expect(FUSE_OPTIONS.keys).toEqual([
      { name: 'title', weight: 0.4 },
      { name: 'name', weight: 0.3 },
      { name: 'tags', weight: 0.2 },
      { name: 'description', weight: 0.2 },
      { name: 'headings', weight: 0.15 },
      { name: 'body', weight: 0.1 },
    ]);
  });
});

describe('segments', () => {
  it('returns one plain segment without ranges and nothing for empty text', () => {
    expect(segments('hello world', [])).toEqual([{ text: 'hello world', hit: false }]);
    expect(segments('', [[0, 3]])).toEqual([]);
  });

  it('splits into plain and hit segments in order', () => {
    expect(segments('the datasets page', [[4, 11]])).toEqual([
      { text: 'the ', hit: false },
      { text: 'datasets', hit: true },
      { text: ' page', hit: false },
    ]);
  });

  it('merges overlapping and touching ranges, whatever the input order', () => {
    const out = segments('abcdefghij', [
      [6, 8],
      [0, 3],
      [2, 5],
    ]);
    expect(out).toEqual([
      { text: 'abcdefghi', hit: true },
      { text: 'j', hit: false },
    ]);
  });

  it('drops ranges shorter than 2 characters', () => {
    expect(segments('abcdef', [[2, 2]])).toEqual([{ text: 'abcdef', hit: false }]);
    expect(
      segments('abcdef', [
        [2, 2],
        [4, 5],
      ]),
    ).toEqual([
      { text: 'abcd', hit: false },
      { text: 'ef', hit: true },
    ]);
  });

  it('clamps ranges to the text and ignores inverted ones', () => {
    expect(segments('abcd', [[2, 99]])).toEqual([
      { text: 'ab', hit: false },
      { text: 'cd', hit: true },
    ]);
    expect(segments('abcd', [[3, 1]])).toEqual([{ text: 'abcd', hit: false }]);
    expect(segments('abcd', [[-5, 1]])).toEqual([
      { text: 'ab', hit: true },
      { text: 'cd', hit: false },
    ]);
  });

  it('always concatenates back to the input and never mutates the ranges', () => {
    const ranges: [number, number][] = [
      [8, 12],
      [1, 3],
      [2, 4],
    ];
    const copy = ranges.map((r) => [...r]);
    const text = 'lorem ipsum dolor sit';
    expect(
      segments(text, ranges)
        .map((s) => s.text)
        .join(''),
    ).toBe(text);
    expect(ranges).toEqual(copy);
  });

  it('normalizeRanges returns sorted merged ranges', () => {
    expect(
      normalizeRanges(
        [
          [10, 12],
          [0, 1],
          [1, 4],
          [20, 20],
        ],
        30,
      ),
    ).toEqual([
      [0, 4],
      [10, 12],
    ]);
  });
});

describe('pickSnippet', () => {
  it('prefers a description match over headings and body', () => {
    const item = doc({
      description: 'Dataset registry and schemas',
      headings: ['Datasets'],
      body: 'datasets everywhere',
    });
    const snippet = pickSnippet(
      hit(item, [
        { key: 'body', value: item.body, indices: [[0, 7]] },
        { key: 'headings', value: 'Datasets', indices: [[0, 7]], refIndex: 0 },
        { key: 'description', value: item.description, indices: [[0, 6]] },
      ]),
    );
    expect(snippet.text).toBe('Dataset registry and schemas');
    expect(covered(snippet.text, snippet.ranges)).toEqual(['Dataset']);
  });

  it('uses the first headings match with a section-sign prefix and shifted ranges', () => {
    const item = doc({
      description: 'unrelated',
      headings: ['Overview', 'Fuse options', 'Keyboard'],
      body: 'x',
    });
    const snippet = pickSnippet(
      hit(item, [
        { key: 'headings', value: 'Keyboard', indices: [[0, 4]], refIndex: 2 },
        { key: 'headings', value: 'Fuse options', indices: [[0, 3]], refIndex: 1 },
      ]),
    );
    expect(snippet.text).toBe('§ Fuse options');
    expect(snippet.ranges).toEqual([[2, 5]]);
    expect(covered(snippet.text, snippet.ranges)).toEqual(['Fuse']);
  });

  it('windows a body match with ellipses at both cut ends and re-based ranges', () => {
    const left = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda ';
    const right = ' mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega alpha';
    const body = `${left}needle${right}`;
    const start = left.length;
    const snippet = pickSnippet(
      hit(doc({ body }), [{ key: 'body', value: body, indices: [[start, start + 5]] }]),
    );
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(covered(snippet.text, snippet.ranges)).toEqual(['needle']);
    // window is about +-60 chars around the match: much shorter than the body
    expect(snippet.text.length).toBeLessThan(6 + 2 * 60 + 4);
    expect(snippet.text.length).toBeGreaterThan(40);
    // cut at word boundaries: neither end of the window sits inside a word
    const inner = snippet.text.slice(1, -1);
    expect(body).toContain(inner);
    const at = body.indexOf(inner);
    expect(/\s/.test(body[at - 1] ?? ' ')).toBe(true);
    expect(/\s/.test(body[at + inner.length] ?? ' ')).toBe(true);
  });

  it('adds no ellipsis where the window reaches the text boundary', () => {
    const body = 'needle in a short body';
    const snippet = pickSnippet(
      hit(doc({ body }), [{ key: 'body', value: body, indices: [[0, 5]] }]),
    );
    expect(snippet.text).toBe(body);
    expect(snippet.ranges).toEqual([[0, 5]]);

    const longTail = `${'filler words here '.repeat(10)}needle`;
    const at = longTail.indexOf('needle');
    const tail = pickSnippet(
      hit(doc({ body: longTail }), [{ key: 'body', value: longTail, indices: [[at, at + 5]] }]),
    );
    expect(tail.text.startsWith('…')).toBe(true);
    expect(tail.text.endsWith('…')).toBe(false);
    expect(tail.text.endsWith('needle')).toBe(true);
    expect(covered(tail.text, tail.ranges)).toEqual(['needle']);
  });

  it('honours a custom radius and clips ranges that cross the window', () => {
    const body = `${'a '.repeat(40)}${'b'.repeat(30)}${' c'.repeat(40)}`;
    const s = body.indexOf('b');
    const snippet = pickSnippet(
      hit(doc({ body }), [{ key: 'body', value: body, indices: [[s, s + 29]] }]),
      10,
    );
    expect(snippet.text.length).toBeLessThan(30 + 2 * 10 + 4);
    expect(covered(snippet.text, snippet.ranges)).toEqual(['b'.repeat(30)]);
  });

  it('skips matches whose ranges are all too short', () => {
    const item = doc({ description: 'Alpha', body: 'a body with beta in it' });
    const snippet = pickSnippet(
      hit(item, [
        { key: 'description', value: 'Alpha', indices: [[0, 0]] },
        { key: 'body', value: item.body, indices: [[12, 15]] },
      ]),
    );
    expect(snippet.text).toBe(item.body);
    expect(covered(snippet.text, snippet.ranges)).toEqual(['beta']);
  });

  it('falls back to the first 160 characters of the description without ranges', () => {
    const description = 'd'.repeat(300);
    const snippet = pickSnippet(
      hit(doc({ description, title: 'Demo thing' }), [
        { key: 'title', value: 'Demo thing', indices: [[0, 3]] },
      ]),
    );
    expect(snippet.text).toBe(description.slice(0, DESCRIPTION_MAX));
    expect(snippet.text).toHaveLength(160);
    expect(snippet.ranges).toEqual([]);
  });

  it('falls back to the body when the doc has no description and nothing matched', () => {
    expect(pickSnippet(hit(doc({ body: 'just a body' }))).text).toBe('just a body');
    expect(pickSnippet(hit(doc())).text).toBe('');
  });

  it('windows a long matching description', () => {
    const description = `${'intro words '.repeat(20)}target phrase${' outro words'.repeat(20)}`;
    const at = description.indexOf('target');
    const snippet = pickSnippet(
      hit(doc({ description }), [
        { key: 'description', value: description, indices: [[at, at + 5]] },
      ]),
    );
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.length).toBeLessThan(DESCRIPTION_MAX);
    expect(covered(snippet.text, snippet.ranges)).toEqual(['target']);
  });
});

describe('keyRanges / matchingTags', () => {
  it('returns normalized ranges for a single-valued key', () => {
    const item = doc({ title: 'Datasets overview' });
    const h = hit(item, [
      {
        key: 'title',
        value: item.title,
        indices: [
          [0, 0],
          [0, 3],
          [2, 7],
        ],
      },
    ]);
    expect(keyRanges(h, 'title')).toEqual([[0, 7]]);
    expect(keyRanges(h, 'description')).toEqual([]);
  });

  it('lists only matched tags with their ranges', () => {
    const item = doc({ tags: ['okf', 'search', 'ui'] });
    const h = hit(item, [
      { key: 'tags', value: 'search', refIndex: 1, indices: [[0, 3]] },
      { key: 'tags', value: 'ui', refIndex: 2, indices: [[0, 0]] },
    ]);
    expect(matchingTags(h)).toEqual([{ tag: 'search', ranges: [[0, 3]] }]);
  });
});

describe('with a real Fuse index', () => {
  const docs: SearchDoc[] = [
    doc({
      id: 'kb/ctxman/concepts/datasets',
      path: 'concepts/datasets.md',
      title: 'Datasets',
      name: 'ctxman',
      slug: 'ctxman',
      description: 'The ten dataset kinds ctxman manages',
      tags: ['datasets', 'okf'],
      headings: ['Lifecycle states', 'Reference variants'],
      body: `${'Some long introductory prose about storage. '.repeat(6)}Every reference dataset entry points at something external.`,
    }),
    doc({
      id: 'task/write-agents-md',
      dataset: 'task',
      slug: 'write-agents-md',
      title: 'Write AGENTS.md',
      name: 'write-agents-md',
      description: 'Document the repository for agents',
      tags: ['docs'],
      body: 'Keep it concise.',
    }),
  ];
  const fuse = new Fuse(docs, FUSE_OPTIONS);

  it('produces snippets and segments that are consistent with the text', () => {
    for (const query of ['datasets', 'lifecycle', 'external', 'agents', 'concise']) {
      const results = fuse.search(query);
      expect(results.length).toBeGreaterThan(0);
      for (const h of results) {
        const snippet = pickSnippet(h);
        expect(
          segments(snippet.text, snippet.ranges)
            .map((s) => s.text)
            .join(''),
        ).toBe(snippet.text);
        for (const [s, e] of snippet.ranges) {
          expect(s).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThan(snippet.text.length);
        }
        const title = segments(h.item.title, keyRanges(h, 'title'));
        expect(title.map((x) => x.text).join('')).toBe(h.item.title);
      }
    }
  });

  it('highlights the matching title and tag', () => {
    const [first] = fuse.search('datasets');
    expect(first?.item.id).toBe('kb/ctxman/concepts/datasets');
    if (first === undefined) return;
    expect(segments(first.item.title, keyRanges(first, 'title'))).toEqual([
      { text: 'Datasets', hit: true },
    ]);
    expect(matchingTags(first).map((t) => t.tag)).toContain('datasets');
  });

  it('shows a heading snippet for a heading-only match', () => {
    const [first] = fuse.search('lifecycle');
    expect(first?.item.id).toBe('kb/ctxman/concepts/datasets');
    if (first === undefined) return;
    const snippet = pickSnippet(first);
    expect(snippet.text).toBe('§ Lifecycle states');
    expect(covered(snippet.text, snippet.ranges).join('').toLowerCase()).toContain('lifecycle');
  });
});
