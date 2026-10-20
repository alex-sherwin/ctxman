import { afterEach, describe, expect, it, vi } from 'vitest';
import { failureText, getJson, sendJson } from '../../src/ui/edit/api.ts';
import type { ApiFailure } from '../../src/ui/edit/api.ts';
import { formatRelative } from '../../src/lib/time.ts';
import {
  DRAFT_TTL_MS,
  clearDraft,
  hasDraft,
  loadDraft,
  saveDraft,
} from '../../src/ui/edit/draft-backup.ts';
import { rememberSave, takeSave } from '../../src/ui/edit/last-save.ts';
import { saveStatusView, statusText } from '../../src/ui/edit/status.ts';
import { splitTagInput, tagInputProblem } from '../../src/ui/edit/tag-input.ts';
import { addTimeInput, TIME_INPUT_PROBLEM } from '../../src/ui/edit/time-input.ts';

/** A minimal in-memory Storage under `name`; `broken` makes every access throw (private window). */
function stubStorage(name: 'sessionStorage' | 'localStorage', broken = false): Map<string, string> {
  const data = new Map<string, string>();
  const fail = () => {
    throw new Error('SecurityError');
  };
  vi.stubGlobal(name, {
    getItem: (k: string) => (broken ? fail() : (data.get(k) ?? null)),
    setItem: (k: string, v: string) => (broken ? fail() : void data.set(k, v)),
    removeItem: (k: string) => (broken ? fail() : void data.delete(k)),
  });
  return data;
}
const stubSession = (broken = false) => stubStorage('sessionStorage', broken);
const stubLocal = (broken = false) => stubStorage('localStorage', broken);

afterEach(() => {
  vi.useRealTimers();
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

describe('saveStatusView', () => {
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);

  it('shows "No changes" for a clean idle editor', () => {
    expect(saveStatusView({ kind: 'idle' }, false, now)).toEqual({
      kind: 'idle',
      text: 'No changes',
    });
  });

  it('shows "Saving…" while saving', () => {
    expect(saveStatusView({ kind: 'saving' }, true, now)).toEqual({
      kind: 'idle',
      text: 'Saving…',
    });
  });

  it('joins the message and the issues of a failed save', () => {
    const view = saveStatusView(
      {
        kind: 'error',
        message: 'msg',
        issues: [
          { path: 'a.b', message: 'm1' },
          { path: '', message: 'm2' },
        ],
      },
      true,
      now,
    );
    expect(view).toEqual({ kind: 'error', text: 'Save failed: msg; a.b: m1; m2' });
    expect(saveStatusView({ kind: 'error' }, false, now).text).toBe('Save failed: unknown error');
  });

  it('shows "Unsaved changes" when dirty', () => {
    expect(saveStatusView({ kind: 'idle' }, true, now)).toEqual({
      kind: 'dirty',
      text: 'Unsaved changes',
    });
  });

  it('shows the relative time of the last save', () => {
    const at = now - 5000;
    expect(saveStatusView({ kind: 'saved', at }, false, now)).toEqual({
      kind: 'saved',
      text: `Saved ${formatRelative(new Date(at).toISOString(), now)}`,
    });
  });

  it('shows the message of a deleted document', () => {
    expect(saveStatusView({ kind: 'deleted', message: 'Deleted ctx' }, false, now)).toEqual({
      kind: 'idle',
      text: 'Deleted ctx',
    });
    expect(saveStatusView({ kind: 'deleted' }, false, now).text).toBe('Deleted');
  });

  it('reports invalid YAML before anything else', () => {
    expect(saveStatusView({ kind: 'saved', at: now }, true, now, 2)).toEqual({
      kind: 'error',
      text: 'Invalid YAML — 2 problems',
    });
    expect(saveStatusView({ kind: 'idle' }, false, now, 1).text).toBe('Invalid YAML — 1 problem');
  });
});

describe('failureText', () => {
  const fail = (extra: Partial<ApiFailure> = {}): ApiFailure => ({
    ok: false,
    status: 400,
    error: 'invalid',
    message: 'Nope',
    ...extra,
  });

  it('is the message alone without issues', () => {
    expect(failureText(fail())).toBe('Nope');
  });

  it('appends the first three issues as path: message', () => {
    const issues = [1, 2, 3, 4].map((n) => ({ path: `f${n}`, message: `m${n}` }));
    expect(failureText(fail({ issues }))).toBe('Nope; f1: m1; f2: m2; f3: m3');
    expect(failureText(fail({ issues }), 1)).toBe('Nope; f1: m1');
  });

  it('omits an empty path', () => {
    expect(failureText(fail({ issues: [{ path: '', message: 'bare' }] }))).toBe('Nope; bare');
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
    await sendJson('PUT', '/api/doc/kb/x/index.md', { markdown: '# hi' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/doc/kb/x/index.md');
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
    const result = await sendJson('PUT', '/api/doc/kb/x/index.md', {});
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

describe('draft-backup (localStorage, 14-day TTL)', () => {
  it('round-trips a draft under ctxman:draft:<key>, stamped with savedAt, and clears it', () => {
    const data = stubLocal();
    expect(loadDraft('doc:kb/x/index.md')).toBeNull();
    expect(hasDraft('doc:kb/x/index.md')).toBe(false);
    saveDraft('doc:kb/x/index.md', { text: 'edited', base: '2026-01-01T00:00:00.000Z' });
    expect([...data.keys()]).toEqual(['ctxman:draft:doc:kb/x/index.md']);
    const stored = JSON.parse(data.get('ctxman:draft:doc:kb/x/index.md') ?? 'null');
    expect(stored).toMatchObject({ text: 'edited', base: '2026-01-01T00:00:00.000Z' });
    expect(typeof stored.savedAt).toBe('number');
    // loadDraft returns only { text, base }
    expect(loadDraft('doc:kb/x/index.md')).toEqual({
      text: 'edited',
      base: '2026-01-01T00:00:00.000Z',
    });
    expect(hasDraft('doc:kb/x/index.md')).toBe(true);
    clearDraft('doc:kb/x/index.md');
    expect(loadDraft('doc:kb/x/index.md')).toBeNull();
    expect(hasDraft('doc:kb/x/index.md')).toBe(false);
    expect(data.size).toBe(0);
  });

  it('does not touch sessionStorage', () => {
    const session = stubSession();
    stubLocal();
    saveDraft('k', { text: 't', base: 'b' });
    expect(session.size).toBe(0);
  });

  it('keeps a draft for 14 days, then drops it (and removes it) on the next read', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    const data = stubLocal();
    saveDraft('k', { text: 't', base: 'b' });

    vi.setSystemTime(Date.now() + DRAFT_TTL_MS);
    expect(hasDraft('k')).toBe(true); // exactly 14 days is still fresh
    vi.setSystemTime(Date.now() + 1);
    expect(loadDraft('k')).toBeNull();
    expect(data.has('ctxman:draft:k')).toBe(false);
    expect(DRAFT_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it('hasDraft also removes an expired draft', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
    const data = stubLocal();
    saveDraft('k', { text: 't', base: 'b' });
    vi.setSystemTime(Date.now() + DRAFT_TTL_MS + 1000);
    expect(hasDraft('k')).toBe(false);
    expect(data.size).toBe(0);
  });

  it('treats a value without savedAt as fresh', () => {
    const data = stubLocal();
    data.set('ctxman:draft:old', JSON.stringify({ text: 'kept', base: 'T0' }));
    expect(loadDraft('old')).toEqual({ text: 'kept', base: 'T0' });
    expect(hasDraft('old')).toBe(true);
  });

  it('ignores corrupt or foreign values', () => {
    const data = stubLocal();
    data.set('ctxman:draft:a', 'not json');
    data.set('ctxman:draft:b', JSON.stringify({ text: 1, base: 'x' }));
    data.set('ctxman:draft:c', JSON.stringify(null));
    data.set('ctxman:draft:d', JSON.stringify({ text: 'x' }));
    for (const key of ['a', 'b', 'c', 'd']) {
      expect(loadDraft(key)).toBeNull();
      expect(hasDraft(key)).toBe(false);
    }
  });

  it('never throws when storage is unavailable', () => {
    stubLocal(true);
    expect(() => saveDraft('k', { text: 't', base: 'b' })).not.toThrow();
    expect(loadDraft('k')).toBeNull();
    expect(hasDraft('k')).toBe(false);
    expect(() => clearDraft('k')).not.toThrow();
  });

  it('is a no-op without localStorage at all', () => {
    expect(() => saveDraft('k', { text: 't', base: 'b' })).not.toThrow();
    expect(loadDraft('k')).toBeNull();
    expect(hasDraft('k')).toBe(false);
  });
});

describe('splitTagInput / tagInputProblem (UX-26)', () => {
  it('splits on commas and whitespace; the last token waits for a separator', () => {
    expect(splitTagInput('a, b c', [], false)).toEqual({ add: ['a', 'b'], rest: 'c' });
    expect(splitTagInput('a, b c ', [], false)).toEqual({ add: ['a', 'b', 'c'], rest: '' });
    expect(splitTagInput('stardew,skill,', [], false)).toEqual({
      add: ['stardew', 'skill'],
      rest: '',
    });
    expect(splitTagInput('typing', [], false)).toEqual({ add: [], rest: 'typing' });
    expect(splitTagInput('', [], false)).toEqual({ add: [], rest: '' });
    expect(splitTagInput(' , ', [], false)).toEqual({ add: [], rest: '' });
  });

  it('final (Enter, blur) commits the pending token too', () => {
    expect(splitTagInput('a, b c', [], true)).toEqual({ add: ['a', 'b', 'c'], rest: '' });
    expect(splitTagInput('pending', [], true)).toEqual({ add: ['pending'], rest: '' });
  });

  it('normalizes (lowercase) and skips duplicates and existing tags', () => {
    expect(splitTagInput('Alpha alpha beta', ['beta'], true)).toEqual({ add: ['alpha'], rest: '' });
  });

  it('keeps invalid tokens in the input instead of dropping them', () => {
    expect(splitTagInput('ok, Bad_Tag, fine', [], true)).toEqual({
      add: ['ok', 'fine'],
      rest: 'Bad_Tag',
    });
    expect(splitTagInput('Bad_Tag next', [], false)).toEqual({ add: [], rest: 'Bad_Tag next' });
    expect(tagInputProblem('Bad_Tag next')).toBe('Lowercase letters, digits and hyphens');
    expect(tagInputProblem('fine next')).toBeNull();
    expect(tagInputProblem('')).toBeNull();
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

describe('addTimeInput (TimeEditor)', () => {
  it('appends one valid duration, upper-cased, keeping repeats', () => {
    expect(addTimeInput(['PT1H'], ' pt1h ')).toEqual({ ok: true, values: ['PT1H', 'PT1H'] });
    expect(addTimeInput([], 'P1DT2H')).toEqual({ ok: true, values: ['P1DT2H'] });
  });

  it('refuses anything else and says why; blank input is no problem', () => {
    expect(addTimeInput(['PT1H'], '1h 30m')).toEqual({ ok: false, problem: TIME_INPUT_PROBLEM });
    expect(addTimeInput(['PT1H'], 'PT1H PT2H')).toEqual({ ok: false, problem: TIME_INPUT_PROBLEM });
    expect(addTimeInput([], '   ')).toEqual({ ok: false, problem: null });
  });
});
