import { describe, expect, it, vi } from 'vitest';
import { ContextIoError } from '../../src/lib/context-io.ts';
import { DocIoError } from '../../src/lib/doc-io.ts';
import { EntryIoError } from '../../src/lib/entry-io.ts';
import {
  apiError,
  checkOrigin,
  contextErrorResponse,
  docErrorResponse,
  entryErrorResponse,
  json,
  methodNotAllowed,
  noContent,
  readJson,
  recipeErrorResponse,
  referenceErrorResponse,
} from '../../src/lib/http.ts';
import { RecipeIoError } from '../../src/lib/recipe-io.ts';
import { ReferenceIoError } from '../../src/lib/reference-io.ts';

const url = new URL('http://127.0.0.1:4321/api/context');

function post(body: BodyInit | null, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', body, headers });
}

async function failure(
  result: Awaited<ReturnType<typeof readJson>>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  return {
    status: result.response.status,
    body: (await result.response.json()) as Record<string, unknown>,
  };
}

describe('json / apiError / noContent', () => {
  it('json sets status, content type and cache-control: no-store', async () => {
    const res = json({ a: 1 }, 201, { location: '/x' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('location')).toBe('/x');
    expect(await res.json()).toEqual({ a: 1 });
  });

  it('json defaults to 200 and ignores a caller cache-control', () => {
    const res = json([], undefined, { 'cache-control': 'max-age=60' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('noContent is a 204 with an empty body and no-store', async () => {
    const res = noContent();
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
  });

  it('apiError builds { error, message } and adds issues only when given', async () => {
    const plain = apiError(404, 'not-found', 'nope');
    expect(plain.status).toBe(404);
    expect(plain.headers.get('cache-control')).toBe('no-store');
    expect(await plain.json()).toEqual({ error: 'not-found', message: 'nope' });

    const withIssues = apiError(400, 'invalid', 'bad', [{ path: 'name', message: 'required' }]);
    expect(await withIssues.json()).toEqual({
      error: 'invalid',
      message: 'bad',
      issues: [{ path: 'name', message: 'required' }],
    });
  });

  it('methodNotAllowed lists the allowed methods', async () => {
    const res = methodNotAllowed(['GET', 'PUT']);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, PUT');
    expect((await res.json()).error).toBe('method-not-allowed');
  });
});

describe('checkOrigin', () => {
  it('passes without an Origin header and with a matching one', () => {
    expect(checkOrigin(post('{}'), url)).toBeNull();
    expect(checkOrigin(post('{}', { origin: url.origin }), url)).toBeNull();
  });

  it('rejects any other Origin (including "null") with 403 forbidden-origin', async () => {
    for (const origin of ['http://evil.example', 'http://evil.example:4321', 'null']) {
      const res = checkOrigin(post('{}', { origin }), url);
      expect(res?.status).toBe(403);
      expect((await res?.json())?.error).toBe('forbidden-origin');
    }
  });
});

describe('readJson', () => {
  it('parses an application/json body (charset parameter allowed)', async () => {
    const ok = await readJson(
      post('{"name":"x","n":[1]}', { 'content-type': 'application/json; charset=utf-8' }),
      url,
    );
    expect(ok).toEqual({ ok: true, value: { name: 'x', n: [1] } });
  });

  it('accepts a same-origin Origin header', async () => {
    const ok = await readJson(
      post('[]', { 'content-type': 'application/json', origin: url.origin }),
      url,
    );
    expect(ok).toEqual({ ok: true, value: [] });
  });

  it('403 forbidden-origin when Origin differs (checked before the body)', async () => {
    const r = await failure(
      await readJson(
        post('{}', { 'content-type': 'application/json', origin: 'http://evil.example' }),
        url,
      ),
    );
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden-origin');
  });

  it('415 unsupported-media-type for text/plain, form and missing content types', async () => {
    const variants: Record<string, string>[] = [
      { 'content-type': 'text/plain' },
      { 'content-type': 'application/x-www-form-urlencoded' },
      { 'content-type': 'application/jsonx' },
      {},
    ];
    for (const headers of variants) {
      const r = await failure(await readJson(post('{"a":1}', headers), url));
      expect(r.status).toBe(415);
      expect(r.body.error).toBe('unsupported-media-type');
    }
  });

  it('400 bad-json for malformed or empty JSON bodies', async () => {
    for (const body of ['{nope', '', '   ']) {
      const r = await failure(
        await readJson(post(body, { 'content-type': 'application/json' }), url),
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('bad-json');
    }
  });

  it('allowEmpty accepts a body-less POST as undefined but still rejects text/plain content', async () => {
    expect(await readJson(post(null), url, { allowEmpty: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await readJson(post('', { 'content-type': 'application/json' }), url, { allowEmpty: true }),
    ).toEqual({ ok: true, value: undefined });
    const r = await failure(
      await readJson(post('hello', { 'content-type': 'text/plain' }), url, { allowEmpty: true }),
    );
    expect(r.status).toBe(415);
  });
});

describe('contextErrorResponse', () => {
  const issues = [{ path: 'name', message: 'bad' }];
  const body = async (res: Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

  it('maps ContextIoError codes to the PLAN §G statuses', async () => {
    const cases: [
      ConstructorParameters<typeof ContextIoError>[0],
      'read' | 'write',
      number,
      string,
    ][] = [
      ['bad-slug', 'read', 400, 'bad-slug'],
      ['not-found', 'read', 404, 'not-found'],
      ['exists', 'write', 409, 'exists'],
      ['name-mismatch', 'write', 400, 'name-mismatch'],
      ['invalid', 'write', 400, 'invalid'],
      ['invalid', 'read', 422, 'invalid-file'],
      ['parse', 'read', 422, 'invalid-file'],
      ['invalid-file', 'write', 422, 'invalid-file'],
      ['invalid-file', 'read', 422, 'invalid-file'],
    ];
    for (const [code, mode, status, error] of cases) {
      const res = contextErrorResponse(new ContextIoError(code, 'msg', issues), mode);
      expect(res.status).toBe(status);
      expect((await body(res)).error).toBe(error);
    }
  });

  it('includes issues for invalid and always an array for write-mode invalid', async () => {
    const withIssues = await body(
      contextErrorResponse(new ContextIoError('invalid', 'm', issues), 'write'),
    );
    expect(withIssues.issues).toEqual(issues);
    const without = await body(contextErrorResponse(new ContextIoError('invalid', 'm'), 'write'));
    expect(without.issues).toEqual([]);
  });

  it('turns anything else into a logged 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = contextErrorResponse(new Error('boom'), 'read');
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'internal', message: 'boom' });
    expect(spy).toHaveBeenCalled();
  });
});

describe('recipeErrorResponse', () => {
  const issues = [{ path: 'name', message: 'bad' }];
  const body = async (res: Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

  it('maps RecipeIoError codes to the same statuses as contexts', async () => {
    const cases: [
      ConstructorParameters<typeof RecipeIoError>[0],
      'read' | 'write',
      number,
      string,
    ][] = [
      ['bad-slug', 'read', 400, 'bad-slug'],
      ['not-found', 'read', 404, 'not-found'],
      ['exists', 'write', 409, 'exists'],
      ['name-mismatch', 'write', 400, 'name-mismatch'],
      ['invalid', 'write', 400, 'invalid'],
      ['invalid', 'read', 422, 'invalid-file'],
      ['parse', 'read', 422, 'invalid-file'],
    ];
    for (const [code, mode, status, error] of cases) {
      const res = recipeErrorResponse(new RecipeIoError(code, 'msg', issues), mode);
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await body(res)).error).toBe(error);
    }
  });

  it('includes issues and always an array for write-mode invalid', async () => {
    const withIssues = await body(
      recipeErrorResponse(new RecipeIoError('invalid', 'm', issues), 'write'),
    );
    expect(withIssues.issues).toEqual(issues);
    const without = await body(recipeErrorResponse(new RecipeIoError('invalid', 'm'), 'write'));
    expect(without.issues).toEqual([]);
  });

  it('turns anything else (including a ContextIoError) into a logged 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = recipeErrorResponse(new Error('boom'), 'read');
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'internal', message: 'boom' });
    expect(recipeErrorResponse(new ContextIoError('not-found', 'x'), 'read').status).toBe(500);
    expect(spy).toHaveBeenCalled();
  });
});

describe('referenceErrorResponse', () => {
  const issues = [{ path: 'uri', message: 'bad' }];
  const body = async (res: Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

  it('maps ReferenceIoError codes to the same statuses as contexts', async () => {
    const cases: [
      ConstructorParameters<typeof ReferenceIoError>[0],
      'read' | 'write',
      number,
      string,
    ][] = [
      ['bad-slug', 'read', 400, 'bad-slug'],
      ['not-found', 'read', 404, 'not-found'],
      ['exists', 'write', 409, 'exists'],
      ['name-mismatch', 'write', 400, 'name-mismatch'],
      ['invalid', 'write', 400, 'invalid'],
      ['invalid', 'read', 422, 'invalid-file'],
      ['parse', 'read', 422, 'invalid-file'],
    ];
    for (const [code, mode, status, error] of cases) {
      const res = referenceErrorResponse(new ReferenceIoError(code, 'msg', issues), mode);
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect((await body(res)).error).toBe(error);
    }
  });

  it('includes issues and always an array for write-mode invalid', async () => {
    const withIssues = await body(
      referenceErrorResponse(new ReferenceIoError('invalid', 'm', issues), 'write'),
    );
    expect(withIssues.issues).toEqual(issues);
    const without = await body(
      referenceErrorResponse(new ReferenceIoError('invalid', 'm'), 'write'),
    );
    expect(without.issues).toEqual([]);
  });

  it('turns anything else (including a RecipeIoError) into a logged 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = referenceErrorResponse(new Error('boom'), 'read');
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'internal', message: 'boom' });
    expect(referenceErrorResponse(new RecipeIoError('not-found', 'x'), 'read').status).toBe(500);
    expect(spy).toHaveBeenCalled();
  });
});

describe('docErrorResponse', () => {
  const body = async (res: Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

  it('maps DocIoError codes to the ROUND2 §A.4 statuses', async () => {
    const cases: [DocIoError['code'], number, string][] = [
      ['bad-dataset', 400, 'bad-dataset'],
      ['bad-slug', 400, 'bad-slug'],
      ['bad-path', 400, 'bad-path'],
      ['invalid', 400, 'invalid'],
      ['not-found', 404, 'not-found'],
      ['conflict', 409, 'conflict'],
      ['exists', 409, 'exists'],
      ['too-large', 413, 'too-large'],
      ['not-text', 422, 'not-text'],
    ];
    for (const [code, status, error] of cases) {
      const res = docErrorResponse(new DocIoError(code, 'msg'));
      expect(res.status, code).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await body(res), code).toMatchObject({ error, message: 'msg' });
    }
  });

  it('invalid carries issues; conflict carries the current lastModified', async () => {
    const issues = [{ path: 'markdown', message: 'must be a string' }];
    expect(await body(docErrorResponse(new DocIoError('invalid', 'm', issues)))).toEqual({
      error: 'invalid',
      message: 'm',
      issues,
    });
    const conflict = new DocIoError('conflict', 'changed');
    conflict.lastModified = '2026-10-17T12:00:00.000Z';
    expect(await body(docErrorResponse(conflict))).toEqual({
      error: 'conflict',
      message: 'changed',
      lastModified: '2026-10-17T12:00:00.000Z',
    });
  });

  it('turns anything else into a logged 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = docErrorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'internal', message: 'boom' });
    expect(spy).toHaveBeenCalled();
  });
});

describe('entryErrorResponse', () => {
  const body = async (res: Response): Promise<Record<string, unknown>> =>
    (await res.json()) as Record<string, unknown>;

  it('maps EntryIoError codes to the ROUND3 §D.1 / §D.2 statuses', async () => {
    const cases: [EntryIoError['code'], number, string][] = [
      ['bad-dataset', 400, 'bad-dataset'],
      ['bad-slug', 400, 'bad-slug'],
      ['invalid', 400, 'invalid'],
      ['not-found', 404, 'not-found'],
      ['conflict', 409, 'conflict'],
      ['exists', 409, 'exists'],
      ['invalid-file', 422, 'invalid-file'],
    ];
    for (const [code, status, error] of cases) {
      const res = entryErrorResponse(new EntryIoError(code, 'msg'));
      expect(res.status, code).toBe(status);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await body(res), code).toMatchObject({ error, message: 'msg' });
    }
  });

  it('invalid and invalid-file carry issues (an array); conflict carries the current lastModified', async () => {
    const issues = [{ path: 'stale_after', message: 'bad date' }];
    expect(await body(entryErrorResponse(new EntryIoError('invalid', 'm', issues)))).toEqual({
      error: 'invalid',
      message: 'm',
      issues,
    });
    expect(await body(entryErrorResponse(new EntryIoError('invalid', 'm')))).toEqual({
      error: 'invalid',
      message: 'm',
      issues: [],
    });
    expect(
      await body(entryErrorResponse(new EntryIoError('invalid-file', 'm', issues))),
    ).toMatchObject({
      issues,
    });
    const conflict = new EntryIoError('conflict', 'changed');
    conflict.lastModified = '2026-10-17T12:00:00.000Z';
    expect(await body(entryErrorResponse(conflict))).toEqual({
      error: 'conflict',
      message: 'changed',
      lastModified: '2026-10-17T12:00:00.000Z',
    });
  });

  it('turns anything else (a failed template self-check, an IO error) into a logged 500', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = entryErrorResponse(new Error('boom'));
    expect(res.status).toBe(500);
    expect(await body(res)).toEqual({ error: 'internal', message: 'boom' });
    expect(spy).toHaveBeenCalled();
  });
});
