import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, sendJson } from '../../src/ui/edit/api.ts';
import { clearDraft, loadDraft, saveDraft } from '../../src/ui/edit/draft-backup.ts';
import { rememberSave, takeSave } from '../../src/ui/edit/last-save.ts';
import { statusText } from '../../src/ui/edit/status.ts';

/** A minimal in-memory `sessionStorage`; `broken` makes every access throw (private window). */
function stubSession(broken = false): Map<string, string> {
  const data = new Map<string, string>();
  const fail = () => {
    throw new Error('SecurityError');
  };
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => (broken ? fail() : (data.get(k) ?? null)),
    setItem: (k: string, v: string) => (broken ? fail() : void data.set(k, v)),
    removeItem: (k: string) => (broken ? fail() : void data.delete(k)),
  });
  return data;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('statusText', () => {
  it('uses the message when given, else the default of the kind', () => {
    expect(statusText({ kind: 'saved' })).toBe('Saved');
    expect(statusText({ kind: 'dirty' })).toBe('Unsaved changes');
    expect(statusText({ kind: 'idle' })).toBe('');
    expect(statusText({ kind: 'saving' })).toBe('Saving…');
    expect(statusText({ kind: 'conflict' })).toBe('Changed on disk');
    expect(statusText({ kind: 'error' })).toBe('Save failed');
    expect(statusText({ kind: 'error', message: 'Save failed: disk full' })).toBe(
      'Save failed: disk full',
    );
  });
});

describe('getJson / sendJson', () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }));

  it('GET sends accept: application/json and returns the parsed body', async () => {
    const fetchMock = respond({ a: 1 });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getJson<{ a: number }>('/api/x');
    expect(result).toEqual({ ok: true, status: 200, body: { a: 1 } });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ accept: 'application/json' });
  });

  it('PUT sends a JSON body with a content-type', async () => {
    const fetchMock = respond({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await sendJson('PUT', '/api/doc/kb/x/main.md', { markdown: '# hi' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/doc/kb/x/main.md');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"markdown":"# hi"}');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
  });

  it('DELETE without a body sends no content-type and accepts an empty 204', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendJson<null>('DELETE', '/api/reference/x');
    expect(result).toEqual({ ok: true, status: 204, body: undefined });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('content-type');
  });

  it('maps an apiError body (with issues) to a failure result', async () => {
    vi.stubGlobal(
      'fetch',
      respond(
        {
          error: 'invalid',
          message: 'bad reference',
          issues: [{ path: 'uri', message: 'must be a git URI' }, { nope: 1 }],
        },
        400,
      ),
    );
    expect(await sendJson('POST', '/api/reference', {})).toEqual({
      ok: false,
      status: 400,
      error: 'invalid',
      message: 'bad reference',
      issues: [{ path: 'uri', message: 'must be a git URI' }],
    });
  });

  it('keeps the body of a 409 conflict readable via error/message', async () => {
    vi.stubGlobal(
      'fetch',
      respond({ error: 'conflict', message: 'changed', lastModified: 'x' }, 409),
    );
    const result = await sendJson('PUT', '/api/doc/kb/x/main.md', {});
    expect(result).toMatchObject({ ok: false, status: 409, error: 'conflict', message: 'changed' });
    expect(result).not.toHaveProperty('issues');
  });

  it('falls back to http-<status> when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>nope</html>', { status: 502 })),
    );
    expect(await getJson('/api/x')).toEqual({
      ok: false,
      status: 502,
      error: 'http-502',
      message: 'HTTP 502',
    });
  });

  it('never throws: a network error is status 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await getJson('/api/x')).toEqual({
      ok: false,
      status: 0,
      error: 'network',
      message: 'Failed to fetch',
    });
    expect(await sendJson('POST', '/api/x', {})).toMatchObject({ ok: false, status: 0 });
  });
});

describe('draft-backup', () => {
  it('round-trips a draft under ctxman:draft:<key> and clears it', () => {
    const data = stubSession();
    expect(loadDraft('doc:kb/x/main.md')).toBeNull();
    saveDraft('doc:kb/x/main.md', { text: 'edited', base: '2026-01-01T00:00:00.000Z' });
    expect([...data.keys()]).toEqual(['ctxman:draft:doc:kb/x/main.md']);
    expect(loadDraft('doc:kb/x/main.md')).toEqual({
      text: 'edited',
      base: '2026-01-01T00:00:00.000Z',
    });
    clearDraft('doc:kb/x/main.md');
    expect(loadDraft('doc:kb/x/main.md')).toBeNull();
    expect(data.size).toBe(0);
  });

  it('ignores corrupt or foreign values', () => {
    const data = stubSession();
    data.set('ctxman:draft:a', 'not json');
    data.set('ctxman:draft:b', JSON.stringify({ text: 1, base: 'x' }));
    data.set('ctxman:draft:c', JSON.stringify(null));
    expect(loadDraft('a')).toBeNull();
    expect(loadDraft('b')).toBeNull();
    expect(loadDraft('c')).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    stubSession(true);
    expect(() => saveDraft('k', { text: 't', base: 'b' })).not.toThrow();
    expect(loadDraft('k')).toBeNull();
    expect(() => clearDraft('k')).not.toThrow();
  });

  it('is a no-op without sessionStorage at all', () => {
    expect(() => saveDraft('k', { text: 't', base: 'b' })).not.toThrow();
    expect(loadDraft('k')).toBeNull();
  });
});

describe('last-save', () => {
  it('is read-once', () => {
    const data = stubSession();
    expect(takeSave('doc:kb/x')).toBeNull();
    rememberSave('doc:kb/x', 'Saved');
    expect([...data.keys()]).toEqual(['ctxman:saved:doc:kb/x']);
    expect(takeSave('doc:kb/x')).toBe('Saved');
    expect(takeSave('doc:kb/x')).toBeNull();
    expect(data.size).toBe(0);
  });

  it('never throws when storage is unavailable', () => {
    stubSession(true);
    expect(() => rememberSave('k', 'Saved')).not.toThrow();
    expect(takeSave('k')).toBeNull();
  });
});
