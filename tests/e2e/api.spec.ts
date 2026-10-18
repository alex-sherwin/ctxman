// API contracts (PLAN §G, UI_SPEC §0.5) over Playwright's request context: status codes and error codes of the
// JSON routes. No browser: these tests exercise the same server as the UI, on the same e2e data copy.
import { unlinkSync, writeFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import type { APIResponse } from '@playwright/test';
import { API, dataExists, dataPath, readYaml } from './helpers.ts';

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

async function errorOf(response: APIResponse): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe('entries and search index', () => {
  test('GET /api/entries lists a dataset; a bad dataset is 400', async ({ request }) => {
    const response = await request.get(`${API}/entries?dataset=task`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = (await response.json()) as {
      entries: { slug: string; dataset: string; url: string }[];
    };
    expect(body.entries.map((e) => e.slug)).toEqual(
      expect.arrayContaining(['write-agents-md', 'forge-e2e-coverage']),
    );
    for (const entry of body.entries) {
      expect(entry.dataset).toBe('task');
      expect(entry.url).toBe(`/task/${entry.slug}`);
    }

    const missing = await request.get(`${API}/entries`);
    expect(missing.status()).toBe(400);
    expect((await errorOf(missing)).error).toBe('bad-dataset');

    const unknown = await request.get(`${API}/entries?dataset=nope`);
    expect(unknown.status()).toBe(400);
    expect((await errorOf(unknown)).error).toBe('bad-dataset');
  });

  test('GET /api/entries?dataset=project carries the structured relations of a project', async ({
    request,
  }) => {
    const response = await request.get(`${API}/entries?dataset=project`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      entries: {
        slug: string;
        invalid?: unknown;
        relations?: { dataset: string; slug: string; rel: string }[];
      }[];
    };
    const v1 = body.entries.find((e) => e.slug === 'ctxman-v1');
    expect(v1?.invalid).toBeUndefined();
    const children = v1?.relations?.filter((r) => r.rel === 'child') ?? [];
    expect(children).toHaveLength(11);
    expect(children.map((r) => `${r.dataset}/${r.slug}`)).toEqual(
      expect.arrayContaining([
        'task/write-agents-md',
        'feature/context-forge',
        'bug/forge-reorder-focus',
      ]),
    );
    expect(
      v1?.relations?.filter((r) => r.rel === 'related').map((r) => `${r.dataset}/${r.slug}`),
    ).toEqual(expect.arrayContaining(['kb/ctxman', 'idea/context-inflate']));
    // Entries without links carry no `relations` key at all.
    const tasks = (await (await request.get(`${API}/entries?dataset=task`)).json()) as {
      entries: Record<string, unknown>[];
    };
    for (const task of tasks.entries) {
      expect(task).not.toHaveProperty('invalid');
    }
    const coverage = tasks.entries.find((e) => e.slug === 'forge-e2e-coverage');
    expect(coverage?.relations).toEqual([
      { dataset: 'feature', slug: 'context-forge', rel: 'depends-on' },
    ]);
    const plain = tasks.entries.find((e) => e.slug === 'write-agents-md');
    expect(plain).not.toHaveProperty('relations');
  });

  test('GET /api/entries?dataset=context reports link counts', async ({ request }) => {
    const response = await request.get(`${API}/entries?dataset=context`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { entries: { slug: string; linkCount?: number }[] };
    const dev = body.entries.find((e) => e.slug === 'ctxman-dev');
    expect(dev?.linkCount).toBe(10);
  });

  test('GET /api/search-index.json returns docs with the documented shape', async ({ request }) => {
    const response = await request.get(`${API}/search-index.json`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      generatedAt: string;
      docs: Record<string, unknown>[];
    };
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    // index.md and log.md of every bundle are not searchable (UX-22): about 52 docs remain.
    expect(body.docs.length).toBeGreaterThan(40);
    expect(body.docs.filter((d) => /\/(?:index|log)$/.test(d.id as string))).toEqual([]);
    for (const doc of body.docs.slice(0, 25)) {
      expect(typeof doc.id).toBe('string');
      expect(typeof doc.dataset).toBe('string');
      expect(typeof doc.slug).toBe('string');
      expect(Array.isArray(doc.tags)).toBe(true);
      expect(Array.isArray(doc.headings)).toBe(true);
      expect(typeof doc.body).toBe('string');
      expect(typeof doc.url).toBe('string');
    }
    const byId = new Map(body.docs.map((d) => [d.id, d]));
    // An entry's main document has path null and the entry url; a sub-doc has its file path and doc url.
    expect(byId.get('feature/context-forge')).toMatchObject({
      dataset: 'feature',
      slug: 'context-forge',
      path: null,
      url: '/feature/context-forge',
    });
    expect(byId.get('kb/ctxman/concepts/datasets')).toMatchObject({
      dataset: 'kb',
      slug: 'ctxman',
      path: 'concepts/datasets.md',
      url: '/kb/ctxman/doc/concepts/datasets',
    });
    expect(byId.get('context/ctxman-dev')?.url).toBe('/context/ctxman-dev');
    expect(byId.get('reference/astro-docs')?.url).toBe('/reference/astro-docs');
  });
});

test.describe('context CRUD', () => {
  test('POST creates (201 + Location), duplicates are 409, invalid bodies are 400', async ({
    request,
  }) => {
    const name = uniqueName('api-ctx');
    const created = await request.post(`${API}/context`, {
      data: {
        name,
        description: 'API created',
        tags: ['api'],
        links: [{ dataset: 'kb', slug: 'ctxman' }],
      },
    });
    expect(created.status()).toBe(201);
    expect(created.headers().location).toBe(`/context/${name}`);
    const body = (await created.json()) as {
      context: { name: string; links: unknown[] };
      lastModified: string;
    };
    expect(body.context.name).toBe(name);
    expect(body.context.links).toHaveLength(1);
    expect(Number.isNaN(Date.parse(body.lastModified))).toBe(false);
    expect(readYaml(`context/${name}.yaml`)).toMatchObject({ name, description: 'API created' });

    const duplicate = await request.post(`${API}/context`, {
      data: { name, description: 'again', tags: [], links: [] },
    });
    expect(duplicate.status()).toBe(409);
    expect((await errorOf(duplicate)).error).toBe('exists');

    const invalid = await request.post(`${API}/context`, {
      data: { name: uniqueName('api-ctx'), tags: [], links: [] },
    });
    expect(invalid.status()).toBe(400);
    const invalidBody = await errorOf(invalid);
    expect(invalidBody.error).toBe('invalid');
    expect(invalidBody.issues?.some((i) => i.path === 'description')).toBe(true);

    const badName = await request.post(`${API}/context`, {
      data: { name: 'Not_Valid', description: 'x', tags: [], links: [] },
    });
    expect(badName.status()).toBe(400);

    const dupLinks = await request.post(`${API}/context`, {
      data: {
        name: uniqueName('api-ctx'),
        description: 'x',
        tags: [],
        links: [
          { dataset: 'kb', slug: 'ctxman' },
          { dataset: 'kb', slug: 'ctxman' },
        ],
      },
    });
    expect(dupLinks.status()).toBe(400);
  });

  test('POST with a non-JSON body is 415; malformed JSON is 400 bad-json', async ({ request }) => {
    const wrongType = await request.post(`${API}/context`, {
      headers: { 'content-type': 'text/plain' },
      data: 'name: x',
    });
    expect(wrongType.status()).toBe(415);
    expect((await errorOf(wrongType)).error).toBe('unsupported-media-type');

    const malformed = await request.post(`${API}/context`, {
      headers: { 'content-type': 'application/json' },
      // A Buffer is sent verbatim; a string would be JSON-encoded by the client when the type is JSON.
      data: Buffer.from('{"name": '),
    });
    expect(malformed.status()).toBe(400);
    expect((await errorOf(malformed)).error).toBe('bad-json');
  });

  test('GET, PUT and DELETE by slug: 200, 400 name-mismatch, 404, 204', async ({ request }) => {
    const name = uniqueName('api-ctx');
    expect(
      (
        await request.post(`${API}/context`, {
          data: { name, description: 'v1', tags: [], links: [] },
        })
      ).status(),
    ).toBe(201);

    const read = await request.get(`${API}/context/${name}`);
    expect(read.status()).toBe(200);
    expect(((await read.json()) as { context: { description: string } }).context.description).toBe(
      'v1',
    );

    const update = { name, description: 'v2', tags: ['updated'], links: [] };
    const put = await request.put(`${API}/context/${name}`, { data: update });
    expect(put.status()).toBe(200);
    expect(((await put.json()) as { context: { description: string } }).context.description).toBe(
      'v2',
    );
    expect(readYaml(`context/${name}.yaml`)).toMatchObject({
      description: 'v2',
      tags: ['updated'],
    });

    const renamed = await request.put(`${API}/context/${name}`, {
      data: { ...update, name: `${name}-other` },
    });
    expect(renamed.status()).toBe(400);
    expect((await errorOf(renamed)).error).toBe('name-mismatch');

    const deleted = await request.delete(`${API}/context/${name}`);
    expect(deleted.status()).toBe(204);
    expect(await deleted.text()).toBe('');

    expect((await request.get(`${API}/context/${name}`)).status()).toBe(404);
    expect((await request.delete(`${API}/context/${name}`)).status()).toBe(404);
    const putMissing = await request.put(`${API}/context/${name}`, { data: update });
    expect(putMissing.status()).toBe(404);
  });

  test('a missing context is 404 not-found and an invalid slug is 400 bad-slug', async ({
    request,
  }) => {
    const missing = await request.get(`${API}/context/no-such-context-here`);
    expect(missing.status()).toBe(404);
    expect((await errorOf(missing)).error).toBe('not-found');

    const badSlug = await request.get(`${API}/context/Bad_Slug`);
    expect(badSlug.status()).toBe(400);
    expect((await errorOf(badSlug)).error).toBe('bad-slug');
  });

  test('an unreadable context file is 422 invalid-file on GET', async ({ request }) => {
    const name = uniqueName('api-broken');
    const file = dataPath(`context/${name}.yaml`);
    writeFileSync(file, `name: ${name}\ndescription: [unclosed\n`);
    try {
      const response = await request.get(`${API}/context/${name}`);
      expect(response.status()).toBe(422);
      expect((await errorOf(response)).error).toBe('invalid-file');
    } finally {
      unlinkSync(file);
    }
  });

  test('a cross-origin mutation is 403 forbidden-origin', async ({ request }) => {
    const name = uniqueName('api-ctx');
    const response = await request.post(`${API}/context`, {
      headers: { origin: 'https://evil.example' },
      data: { name, description: 'x', tags: [], links: [] },
    });
    expect(response.status()).toBe(403);
    expect((await errorOf(response)).error).toBe('forbidden-origin');
    expect(dataExists(`context/${name}.yaml`)).toBe(false);
  });

  test('unsupported methods are 405 with an Allow header', async ({ request }) => {
    const response = await request.patch(`${API}/context/ctxman-dev`, { data: {} });
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe('GET, PUT, DELETE');
  });
});

test.describe('scripts', () => {
  test('POST /api/scripts/check runs the check and returns its exit code and output', async ({
    request,
  }) => {
    const response = await request.post(`${API}/scripts/check`, { data: {} });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      code: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    };
    expect(body.code).toBe(0);
    expect(body.stdout).toContain('All checks: OK');
    expect(typeof body.durationMs).toBe('number');
  });

  test('an empty body is accepted by check scripts', async ({ request }) => {
    const response = await request.post(`${API}/scripts/check-okf`, {
      headers: { 'content-type': 'text/plain' },
      data: '',
    });
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { code: number }).code).toBe(0);
  });

  test('an unknown script is 404 unknown-script', async ({ request }) => {
    const response = await request.post(`${API}/scripts/rm-rf`, { data: {} });
    expect(response.status()).toBe(404);
    expect((await errorOf(response)).error).toBe('unknown-script');
  });

  test('a non-JSON body is 415', async ({ request }) => {
    const response = await request.post(`${API}/scripts/check`, {
      headers: { 'content-type': 'text/plain' },
      data: 'hello',
    });
    expect(response.status()).toBe(415);
  });

  test('the add script validates its body: 400 with issues', async ({ request }) => {
    const response = await request.post(`${API}/scripts/add`, {
      data: { dataset: 'idea', name: 'Not Valid', description: '' },
    });
    expect(response.status()).toBe(400);
    const body = await errorOf(response);
    expect(body.error).toBe('invalid');
    expect(body.issues?.length ?? 0).toBeGreaterThan(0);
  });
});
