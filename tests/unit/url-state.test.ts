import { describe, expect, it } from 'vitest';
import {
  forgeHref,
  parseForgeUrl,
  parseListParams,
  parseSearchUrl,
  parseToolsUrl,
  readList,
  withParams,
} from '../../src/lib/url-state.ts';
import type { ForgeUrl } from '../../src/lib/url-state.ts';

const sp = (query: string): URLSearchParams => new URLSearchParams(query);

describe('readList', () => {
  it('reads repeated keys in order', () => {
    expect(readList(sp('state=a&state=b&x=1&state=c'), 'state')).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when the key is absent', () => {
    expect(readList(sp('x=1'), 'state')).toEqual([]);
    expect(readList(sp(''), 'state')).toEqual([]);
  });

  it('trims, drops empty values and de-duplicates (first wins)', () => {
    expect(readList(sp('tag=a&tag=&tag=%20b%20&tag=a'), 'tag')).toEqual(['a', 'b']);
  });

  it('does NOT comma-split ordinary keys', () => {
    expect(readList(sp('tag=a,b'), 'tag')).toEqual(['a,b']);
    expect(readList(sp('state=a,b'), 'state')).toEqual(['a,b']);
  });

  it("comma-splits the 'in' key, also when repeated", () => {
    expect(readList(sp('in=kb,task'), 'in')).toEqual(['kb', 'task']);
    expect(readList(sp('in=kb,task&in=bug,kb'), 'in')).toEqual(['kb', 'task', 'bug']);
    expect(readList(sp('in=kb,,%20task%20,'), 'in')).toEqual(['kb', 'task']);
    expect(readList(sp('in='), 'in')).toEqual([]);
  });
});

describe('withParams', () => {
  it('adds, replaces and returns pathname + search + hash', () => {
    expect(withParams('/task', { state: 'pending' })).toBe('/task?state=pending');
    expect(withParams('/task?state=pending', { state: 'complete' })).toBe('/task?state=complete');
    expect(withParams('/task?q=a#frag', { sort: 'name' })).toBe('/task?q=a&sort=name#frag');
  });

  it('accepts absolute URLs and drops the origin', () => {
    expect(withParams('http://127.0.0.1:4321/kb?q=x#h', { sort: 'name' })).toBe(
      '/kb?q=x&sort=name#h',
    );
    expect(withParams('https://example.com', { a: '1' })).toBe('/?a=1');
  });

  it('removes keys for null, empty string and empty array', () => {
    const href = '/x?a=1&b=2&c=3&d=4';
    expect(withParams(href, { a: null })).toBe('/x?b=2&c=3&d=4');
    expect(withParams(href, { b: '' })).toBe('/x?a=1&c=3&d=4');
    expect(withParams(href, { c: [] })).toBe('/x?a=1&b=2&d=4');
    expect(withParams(href, { a: null, b: '', c: [], d: null })).toBe('/x');
  });

  it('removes keys equal to the default', () => {
    expect(withParams('/x?sort=name', { sort: 'modified' }, { sort: 'modified' })).toBe('/x');
    expect(withParams('/x', { dataset: 'kb' }, { dataset: 'kb' })).toBe('/x');
    expect(withParams('/x', { dataset: 'task' }, { dataset: 'kb' })).toBe('/x?dataset=task');
    // defaults for other keys are irrelevant
    expect(withParams('/x', { a: 'kb' }, { b: 'kb' })).toBe('/x?a=kb');
  });

  it('keeps unrelated params in original order, appends patched keys in patch order', () => {
    expect(withParams('/x?z=1&a=2&m=3', { b: '1', a: 'new', c: '2' })).toBe(
      '/x?z=1&m=3&b=1&a=new&c=2',
    );
    expect(withParams('/x?q=1&other=2', { sq: 'a', search: '1' })).toBe(
      '/x?q=1&other=2&sq=a&search=1',
    );
  });

  it('turns arrays into repeated keys and replaces all old occurrences', () => {
    expect(withParams('/x?state=a&state=b&k=1', { state: ['c', 'd'] })).toBe(
      '/x?k=1&state=c&state=d',
    );
    expect(withParams('/x', { tag: ['a', '', 'b'] })).toBe('/x?tag=a&tag=b');
  });

  it("comma-joins 'in' in registry order and de-duplicates", () => {
    expect(withParams('/x', { in: ['task', 'kb', 'bug'] })).toBe('/x?in=kb,task,bug');
    expect(withParams('/x', { in: ['context', 'reference', 'skill', 'rca'] })).toBe(
      '/x?in=rca,skill,reference,context',
    );
    expect(withParams('/x', { in: ['kb', 'kb'] })).toBe('/x?in=kb');
    expect(withParams('/x', { in: 'task,kb' })).toBe('/x?in=kb,task');
    expect(withParams('/x?in=kb', { in: [] })).toBe('/x');
    expect(withParams('/x?in=kb', { in: null })).toBe('/x');
    expect(withParams('/x?in=kb', { in: [''] })).toBe('/x');
  });

  it("places unknown 'in' ids after known ones, keeping their order", () => {
    expect(withParams('/x', { in: ['zzz', 'task', 'yyy', 'kb'] })).toBe('/x?in=kb,task,zzz,yyy');
  });

  it('keeps the hash, and keeps commas readable but encodes other characters', () => {
    expect(withParams('/x#top', { sq: 'a b&c=d' })).toBe('/x?sq=a%20b%26c%3Dd#top');
    expect(withParams('/x', { sq: 'forge' })).toBe('/x?sq=forge');
    expect(withParams('/x', { sq: 'héllo' })).toBe('/x?sq=h%C3%A9llo');
  });

  it('round-trips through URLSearchParams', () => {
    const href = withParams('/x', { sq: 'a b&c=d/é,f', in: ['task', 'kb'], tag: ['x y', 'z'] });
    const params = new URL(href, 'http://h').searchParams;
    expect(params.get('sq')).toBe('a b&c=d/é,f');
    expect(readList(params, 'in')).toEqual(['kb', 'task']);
    expect(readList(params, 'tag')).toEqual(['x y', 'z']);
  });

  it('survives lone surrogates in user text', () => {
    expect(() => withParams('/x', { sq: 'a\uD800b' })).not.toThrow();
  });

  it('works for the search open / close flows (UI_SPEC §G.3)', () => {
    const open = withParams('/task?state=pending', { search: '1', sq: 'agents', in: ['task'] });
    expect(open).toBe('/task?state=pending&search=1&sq=agents&in=task');
    expect(withParams(open, { search: null, sq: null, in: null })).toBe('/task?state=pending');
    // empty query drops sq but keeps search=1
    expect(withParams('/task', { search: '1', sq: '', in: [] })).toBe('/task?search=1');
  });

  it('handles an href without params and without path slash', () => {
    expect(withParams('/', {})).toBe('/');
    expect(withParams('/x?', {})).toBe('/x');
    expect(withParams('forge', { a: '1' })).toBe('/forge?a=1');
  });
});

describe('parseListParams', () => {
  it('returns defaults for an empty query', () => {
    expect(parseListParams(sp(''), 'task')).toEqual({
      q: '',
      states: [],
      tags: [],
      type: null,
      sort: 'modified',
    });
  });

  it('parses q, repeated states/tags, sort', () => {
    expect(
      parseListParams(
        sp('q=hello%20world&state=pending&state=in-progress&tag=a&tag=b&sort=name'),
        'task',
      ),
    ).toEqual({
      q: 'hello world',
      states: ['pending', 'in-progress'],
      tags: ['a', 'b'],
      type: null,
      sort: 'name',
    });
  });

  it("keeps only the dataset's own states", () => {
    expect(parseListParams(sp('state=fixed&state=complete&state=pending'), 'task').states).toEqual([
      'complete',
      'pending',
    ]);
    expect(parseListParams(sp('state=fixed&state=complete'), 'bug').states).toEqual(['fixed']);
    expect(parseListParams(sp('state=bogus'), 'task').states).toEqual([]);
  });

  it('ignores states on datasets without a lifecycle', () => {
    expect(parseListParams(sp('state=pending'), 'kb').states).toEqual([]);
    expect(parseListParams(sp('state=pending'), 'reference').states).toEqual([]);
  });

  it("allows sort=state only on lifecycle datasets; unknown sorts → 'modified'", () => {
    expect(parseListParams(sp('sort=state'), 'task').sort).toBe('state');
    expect(parseListParams(sp('sort=state'), 'kb').sort).toBe('modified');
    expect(parseListParams(sp('sort=state'), 'context').sort).toBe('modified');
    expect(parseListParams(sp('sort=modified'), 'task').sort).toBe('modified');
    expect(parseListParams(sp('sort=name'), 'kb').sort).toBe('name');
    expect(parseListParams(sp('sort=bogus'), 'task').sort).toBe('modified');
  });

  it('allows type only for reference with a valid value', () => {
    expect(parseListParams(sp('type=remote-repo'), 'reference').type).toBe('remote-repo');
    expect(parseListParams(sp('type=local-repo'), 'reference').type).toBe('local-repo');
    expect(parseListParams(sp('type=remote-skill'), 'reference').type).toBe('remote-skill');
    expect(parseListParams(sp('type=bogus'), 'reference').type).toBeNull();
    expect(parseListParams(sp('type=remote-repo'), 'task').type).toBeNull();
  });

  it('does not comma-split tags and dedupes', () => {
    expect(parseListParams(sp('tag=a&tag=a&tag=b,c'), 'kb').tags).toEqual(['a', 'b,c']);
  });
});

describe('parseSearchUrl', () => {
  it('is closed without search=1', () => {
    expect(parseSearchUrl(sp(''))).toEqual({ open: false, sq: '', in: [] });
    expect(parseSearchUrl(sp('search=0&sq=x'))).toMatchObject({ open: false, sq: 'x' });
    expect(parseSearchUrl(sp('search=true'))).toMatchObject({ open: false });
  });

  it('parses an open search with query and dataset filter', () => {
    expect(parseSearchUrl(sp('search=1&sq=agents&in=task'))).toEqual({
      open: true,
      sq: 'agents',
      in: ['task'],
    });
  });

  it('returns valid dataset ids in registry order, dropping unknown and duplicates', () => {
    expect(parseSearchUrl(sp('search=1&in=task,kb,nope,kb,context')).in).toEqual([
      'kb',
      'task',
      'context',
    ]);
    expect(parseSearchUrl(sp('search=1&in=bogus')).in).toEqual([]);
    expect(parseSearchUrl(sp('search=1&in=bug&in=idea')).in).toEqual(['idea', 'bug']);
  });

  it('does not confuse sq with the list/forge q param', () => {
    expect(parseSearchUrl(sp('search=1&q=listfilter&sq=real'))).toMatchObject({ sq: 'real' });
    expect(parseSearchUrl(sp('search=1&q=listfilter')).sq).toBe('');
  });
});

describe('parseForgeUrl', () => {
  it('returns defaults for an empty query', () => {
    expect(parseForgeUrl(sp(''))).toEqual({
      context: null,
      dataset: 'kb',
      q: '',
      states: [],
      tags: [],
    });
  });

  it('parses all params', () => {
    expect(
      parseForgeUrl(
        sp('context=ctxman-dev&dataset=task&q=agents&state=pending&state=in-progress&tag=docs'),
      ),
    ).toEqual({
      context: 'ctxman-dev',
      dataset: 'task',
      q: 'agents',
      states: ['pending', 'in-progress'],
      tags: ['docs'],
    });
  });

  it('allows context=new and rejects invalid context slugs', () => {
    expect(parseForgeUrl(sp('context=new')).context).toBe('new');
    expect(parseForgeUrl(sp('context=Bad Slug')).context).toBeNull();
    expect(parseForgeUrl(sp('context=../x')).context).toBeNull();
    expect(parseForgeUrl(sp('context=')).context).toBeNull();
  });

  it("falls back to 'kb' for an invalid or non-linkable dataset", () => {
    expect(parseForgeUrl(sp('dataset=context')).dataset).toBe('kb');
    expect(parseForgeUrl(sp('dataset=nope')).dataset).toBe('kb');
    expect(parseForgeUrl(sp('dataset=')).dataset).toBe('kb');
    expect(parseForgeUrl(sp('dataset=reference')).dataset).toBe('reference');
    expect(parseForgeUrl(sp('dataset=skill')).dataset).toBe('skill');
  });

  it("filters states to the selected dataset's lifecycle", () => {
    expect(parseForgeUrl(sp('dataset=bug&state=fixed&state=complete')).states).toEqual(['fixed']);
    expect(parseForgeUrl(sp('dataset=kb&state=pending')).states).toEqual([]);
    expect(parseForgeUrl(sp('dataset=task&state=bogus')).states).toEqual([]);
  });

  it('keeps tags verbatim (unknown tags simply match nothing)', () => {
    expect(parseForgeUrl(sp('tag=zzz&tag=a')).tags).toEqual(['zzz', 'a']);
  });
});

describe('forgeHref', () => {
  const base: ForgeUrl = { context: null, dataset: 'kb', q: '', states: [], tags: [] };

  it('omits defaults', () => {
    expect(forgeHref(base)).toBe('/forge');
  });

  it('writes all non-default params in a fixed order', () => {
    expect(
      forgeHref({
        context: 'ctxman-dev',
        dataset: 'task',
        q: 'agents md',
        states: ['pending', 'in-progress'],
        tags: ['docs', 'x'],
      }),
    ).toBe(
      '/forge?context=ctxman-dev&dataset=task&q=agents%20md&state=pending&state=in-progress&tag=docs&tag=x',
    );
  });

  it('supports context=new and a custom pathname', () => {
    expect(forgeHref({ ...base, context: 'new' })).toBe('/forge?context=new');
    expect(forgeHref({ ...base, dataset: 'rca' }, '/elsewhere')).toBe('/elsewhere?dataset=rca');
  });

  it('round-trips through parseForgeUrl', () => {
    const url: ForgeUrl = {
      context: 'my-ctx',
      dataset: 'bug',
      q: 'a & b',
      states: ['pending', 'fixed'],
      tags: ['t1', 't 2'],
    };
    const href = forgeHref(url);
    expect(parseForgeUrl(new URL(href, 'http://h').searchParams)).toEqual(url);
    expect(parseForgeUrl(new URL(forgeHref(base), 'http://h').searchParams)).toEqual(base);
  });
});

describe('parseToolsUrl', () => {
  it('reads a valid dataset id', () => {
    expect(parseToolsUrl(sp('add=task'))).toEqual({ add: 'task' });
    expect(parseToolsUrl(sp('add=context'))).toEqual({ add: 'context' });
    expect(parseToolsUrl(sp('add=skill'))).toEqual({ add: 'skill' });
  });

  it('is null for missing or invalid values', () => {
    expect(parseToolsUrl(sp(''))).toEqual({ add: null });
    expect(parseToolsUrl(sp('add=nope'))).toEqual({ add: null });
    expect(parseToolsUrl(sp('add='))).toEqual({ add: null });
    expect(parseToolsUrl(sp('add=Task'))).toEqual({ add: null });
  });
});
