// Snippet CRUD over Playwright's request context: POST /api/snippet and GET|PUT|DELETE /api/snippet/:slug, the same
// conventions as /api/reference. Files are checked in the e2e data copy.
import { expect, test } from './fixtures.ts';
import type { APIResponse } from '@playwright/test';
import { API, dataExists, readDataText, readYaml, uniqueName } from './helpers.ts';
import { E2E_SERVER_ORIGIN } from './paths.ts';

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

interface SnippetBody {
  snippet: Record<string, unknown>;
  lastModified: string;
}

// The writer points the modeline at the e2e server origin (CTXMAN_SERVER_ORIGIN, set by server.ts).
const MAGIC_COMMENT = `# yaml-language-server: $schema=${E2E_SERVER_ORIGIN}/api/schemas/snippet`;

const errorOf = async (response: APIResponse): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const created: string[] = [];
const newName = (): string => {
  const name = uniqueName('e2e-snip');
  created.push(name);
  return name;
};

test.afterAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    for (const name of created) await request.delete(`${API}/snippet/${name}`);
  } finally {
    await request.dispose();
  }
});

const MARKDOWN = '## Checks\n\nRun `pnpm run check` before you finish.\n';

const body = (name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  description: 'Created by the snippet API spec',
  tags: ['e2e'],
  markdown: MARKDOWN,
  ...overrides,
});

test('POST is 201 with Location; the file has the schema comment, the fixed key order and a literal block', async ({
  request,
}) => {
  const name = newName();
  const response = await request.post(`${API}/snippet`, {
    // Keys deliberately sent out of order: the file order is the serializer's.
    data: {
      markdown: MARKDOWN,
      tags: ['e2e'],
      description: 'Created by the snippet API spec',
      name,
    },
  });
  expect(response.status()).toBe(201);
  expect(response.headers().location).toBe(`/snippet/${name}`);
  const record = (await response.json()) as SnippetBody;
  expect(record.snippet).toEqual({
    name,
    description: 'Created by the snippet API spec',
    tags: ['e2e'],
    markdown: MARKDOWN,
  });
  const text = readDataText(`snippet/${name}.yaml`);
  expect(text.split('\n')[0]).toBe(MAGIC_COMMENT);
  expect(text).toContain('markdown: |\n  ## Checks\n\n  Run `pnpm run check` before you finish.\n');
  expect(Object.keys(readYaml(`snippet/${name}.yaml`) as object)).toEqual([
    'name',
    'description',
    'tags',
    'markdown',
  ]);
});

test('POST validates (a blank markdown is invalid) and refuses an existing name', async ({
  request,
}) => {
  const name = newName();
  const blank = await request.post(`${API}/snippet`, { data: body(name, { markdown: '  ' }) });
  expect(blank.status()).toBe(400);
  const error = await errorOf(blank);
  expect(error.error).toBe('invalid');
  expect(error.issues?.map((i) => i.path)).toEqual(['markdown']);
  expect(dataExists(`snippet/${name}.yaml`)).toBe(false);

  expect((await request.post(`${API}/snippet`, { data: body(name) })).status()).toBe(201);
  const again = await request.post(`${API}/snippet`, { data: body(name) });
  expect(again.status()).toBe(409);
  expect((await errorOf(again)).error).toBe('exists');
});

test('GET, PUT, PUT name-mismatch, DELETE; guards and bad slugs', async ({ request }) => {
  const name = newName();
  expect((await request.post(`${API}/snippet`, { data: body(name) })).status()).toBe(201);

  const read = await request.get(`${API}/snippet/${name}`);
  expect(read.status()).toBe(200);
  expect(((await read.json()) as SnippetBody).snippet.markdown).toBe(MARKDOWN);

  const put = await request.put(`${API}/snippet/${name}`, {
    data: body(name, { markdown: 'Short now.' }),
  });
  expect(put.status()).toBe(200);
  expect(readYaml(`snippet/${name}.yaml`)).toMatchObject({ markdown: 'Short now.' });

  const renamed = await request.put(`${API}/snippet/${name}`, { data: body(`${name}-other`) });
  expect(renamed.status()).toBe(400);
  expect((await errorOf(renamed)).error).toBe('name-mismatch');

  const foreign = await request.put(`${API}/snippet/${name}`, {
    headers: { origin: 'https://evil.example' },
    data: body(name, { markdown: 'hijacked' }),
  });
  expect(foreign.status()).toBe(403);
  expect((await request.post(`${API}/snippet/${name}`, { data: body(name) })).status()).toBe(405);
  expect((await request.get(`${API}/snippet`)).status()).toBe(405);
  expect((await request.get(`${API}/snippet/Bad_Slug`)).status()).toBe(400);
  expect((await request.get(`${API}/snippet/no-such-snippet-here`)).status()).toBe(404);

  const deleted = await request.delete(`${API}/snippet/${name}`);
  expect(deleted.status()).toBe(204);
  expect(dataExists(`snippet/${name}.yaml`)).toBe(false);
  expect((await request.get(`${API}/snippet/${name}`)).status()).toBe(404);
});

test('a created snippet is listed by /api/entries?dataset=snippet at once', async ({ request }) => {
  const name = newName();
  expect((await request.post(`${API}/snippet`, { data: body(name) })).status()).toBe(201);
  const list = await request.get(`${API}/entries?dataset=snippet`);
  const { entries } = (await list.json()) as { entries: { slug: string; tags?: string[] }[] };
  expect(entries.find((e) => e.slug === name)).toMatchObject({ tags: ['e2e'] });
  expect(entries.map((e) => e.slug)).toEqual(
    expect.arrayContaining(['conventional-commits', 'finish-checklist']),
  );
});
