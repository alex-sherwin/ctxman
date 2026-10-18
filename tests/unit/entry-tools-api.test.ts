import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendContextLinks,
  createConcept,
  createContextWithLinks,
  docApiUrl,
  entryApiUrl,
  getEntry,
  patchEntry,
} from '../../src/ui/entry/entry-api.ts';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Stubs `fetch`: records the calls, answers with `status` / `body`. */
function stubFetch(status: number, body: unknown): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('entry api wrappers', () => {
  it('URLs are encoded per segment', () => {
    expect(entryApiUrl('task', 'a-b')).toBe('/api/entry/task/a-b');
    expect(docApiUrl('kb', 'x', 'concepts/a b/c.md')).toBe(
      '/api/kb/x/concepts/a%20b/c.md'.replace('/api/kb', '/api/doc/kb'),
    );
  });

  it('getEntry GETs the entry', async () => {
    const calls = stubFetch(200, { frontmatter: { name: 'a' }, lastModified: 'T', issues: [] });
    const res = await getEntry('task', 'a');
    expect(calls[0]).toMatchObject({ url: '/api/entry/task/a', method: 'GET' });
    expect(res.ok && res.body.lastModified).toBe('T');
  });

  it('patchEntry PATCHes the given body', async () => {
    const calls = stubFetch(200, {
      frontmatter: {},
      lastModified: 'T2',
      changed: true,
      warnings: [],
    });
    const res = await patchEntry('task', 'a', {
      title: null,
      addLinks: [{ dataset: 'kb', slug: 'b', rel: 'related' }],
      ifUnmodifiedSince: 'T',
    });
    expect(calls[0]).toMatchObject({
      url: '/api/entry/task/a',
      method: 'PATCH',
      body: {
        title: null,
        addLinks: [{ dataset: 'kb', slug: 'b', rel: 'related' }],
        ifUnmodifiedSince: 'T',
      },
    });
    expect(res.ok).toBe(true);
  });

  it('a 409 / 400 comes back as a failure with its message and issues', async () => {
    stubFetch(409, { error: 'conflict', message: 'changed on disk', lastModified: 'T3' });
    const conflict = await patchEntry('task', 'a', { title: 'x', ifUnmodifiedSince: 'T' });
    expect(conflict).toMatchObject({ ok: false, status: 409, error: 'conflict' });
    vi.unstubAllGlobals();
    stubFetch(400, {
      error: 'invalid',
      message: 'bad',
      issues: [{ path: 'stale_after', message: 'no' }],
    });
    const invalid = await patchEntry('task', 'a', { stale_after: 'x' });
    expect(invalid).toMatchObject({
      ok: false,
      status: 400,
      error: 'invalid',
      issues: [{ path: 'stale_after', message: 'no' }],
    });
  });

  it('appendContextLinks POSTs { links } to the context', async () => {
    const calls = stubFetch(200, { added: ['task/a'], skipped: [], lastModified: 'T' });
    await appendContextLinks('my-ctx', [{ dataset: 'task', slug: 'a', notes: 'n' }]);
    expect(calls[0]).toMatchObject({
      url: '/api/context/my-ctx/links',
      method: 'POST',
      body: { links: [{ dataset: 'task', slug: 'a', notes: 'n' }] },
    });
  });

  it('createContextWithLinks POSTs the document with empty tags', async () => {
    const calls = stubFetch(201, { lastModified: 'T' });
    await createContextWithLinks({
      name: 'new-ctx',
      description: 'Context for X.',
      links: [{ dataset: 'project', slug: 'p' }],
    });
    expect(calls[0]).toMatchObject({
      url: '/api/context',
      method: 'POST',
      body: {
        name: 'new-ctx',
        description: 'Context for X.',
        tags: [],
        links: [{ dataset: 'project', slug: 'p' }],
      },
    });
  });

  it('createConcept POSTs to the doc route', async () => {
    const calls = stubFetch(201, {
      path: 'concepts/x.md',
      url: '/kb/a/doc/concepts/x',
      lastModified: 'T',
      warnings: [],
    });
    const res = await createConcept('kb', 'a', 'concepts/x.md', { title: 'X' });
    expect(calls[0]).toMatchObject({
      url: '/api/doc/kb/a/concepts/x.md',
      method: 'POST',
      body: { title: 'X' },
    });
    expect(res.ok && res.body.url).toBe('/kb/a/doc/concepts/x');
  });

  it('a network failure resolves to status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await getEntry('task', 'a')).toMatchObject({ ok: false, status: 0, message: 'offline' });
  });
});
