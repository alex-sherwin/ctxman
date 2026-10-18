// GET /api/schemas/:dataset (ROUND2 spec D13): the committed JSON Schemas of the YAML datasets, served as
// application/schema+json. No browser: Playwright's request context against the e2e server.
import { expect, test } from './fixtures.ts';
import { API } from './helpers.ts';

for (const dataset of ['reference', 'context', 'recipe'] as const) {
  test(`GET /api/schemas/${dataset} serves the draft-07 schema`, async ({ request }) => {
    const response = await request.get(`${API}/schemas/${dataset}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^application\/schema\+json/);
    expect(response.headers()['cache-control']).toBe('no-store');
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(body.$id).toBe(`https://ctxman.local/schemas/${dataset}.schema.json`);
    expect(Object.keys(body).slice(0, 5)).toEqual([
      '$schema',
      '$id',
      'title',
      'description',
      '$comment',
    ]);
  });
}

test('GET /api/schemas/<non-yaml dataset> is 404 unknown-dataset', async ({ request }) => {
  for (const dataset of ['kb', 'skill', 'nope']) {
    const response = await request.get(`${API}/schemas/${dataset}`);
    expect(response.status(), dataset).toBe(404);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(((await response.json()) as { error: string }).error).toBe('unknown-dataset');
  }
});

test('other methods on /api/schemas/:dataset are 405', async ({ request }) => {
  const response = await request.post(`${API}/schemas/context`, { data: {} });
  expect(response.status()).toBe(405);
  expect(response.headers().allow).toBe('GET');
});
