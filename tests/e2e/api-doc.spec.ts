// Doc API (ROUND2_BACKEND_SPEC §A.4) over Playwright's request context: GET|PUT /api/doc/<dataset>/<slug>/<path>.
// The entry is created through the add script; the API reads and writes the files directly, so no spec waits for
// the content layer. The entry is removed afterwards (the e2e data copy is shared by the whole run).
import { readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { API, dataPath, settleDevReload, uniqueName } from './helpers.ts';

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
  lastModified?: string;
}

interface DocBody {
  path: string;
  markdown: string;
  lastModified: string;
  bytes: number;
  warnings: { severity: string; rule: string; file: string; message: string }[];
}

const errorOf = async (response: APIResponse): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const name = uniqueName('e2e-doc');
const docUrl = (rel: string, dataset = 'task', slug = name): string =>
  `${API}/doc/${dataset}/${slug}/${rel}`;
const entryDir = dataPath(`task/${name}`);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    const response = await request.post(`${API}/scripts/add`, {
      data: { dataset: 'task', name, title: 'E2E doc', description: 'Created by the doc API spec' },
    });
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { code: number }).code).toBe(0);
  } finally {
    await request.dispose();
  }
  // A concept file with a space in its name (percent-encoded in the URL) and frontmatter without `type`.
  mkdirSync(path.join(entryDir, 'concepts'), { recursive: true });
  writeFileSync(
    path.join(entryDir, 'concepts', 'a b.md'),
    '---\ndescription: A concept without a type.\n---\n# Untyped\n',
  );
});

test.afterAll(async () => {
  rmSync(entryDir, { recursive: true, force: true });
  await settleDevReload();
});

test('GET main.md returns path, markdown, lastModified, bytes and no warnings', async ({
  request,
}) => {
  const response = await request.get(docUrl('main.md'));
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const body = (await response.json()) as DocBody;
  expect(body.path).toBe('main.md');
  expect(body.markdown).toBe(readFileSync(path.join(entryDir, 'main.md'), 'utf8'));
  expect(body.bytes).toBe(Buffer.byteLength(body.markdown));
  expect(Number.isNaN(Date.parse(body.lastModified))).toBe(false);
  expect(body.warnings).toEqual([]);
});

test('PUT saves the exact text, advances lastModified and answers without the markdown', async ({
  request,
}) => {
  const before = (await (await request.get(docUrl('main.md'))).json()) as DocBody;
  const text = `${before.markdown}\nSaved by the e2e doc spec.\r\n`;
  const response = await request.put(docUrl('main.md'), {
    data: { markdown: text, ifUnmodifiedSince: before.lastModified },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(['bytes', 'lastModified', 'path', 'warnings']);
  expect(body.path).toBe('main.md');
  expect(body.bytes).toBe(Buffer.byteLength(text));
  expect(Date.parse(body.lastModified as string)).toBeGreaterThan(Date.parse(before.lastModified));
  expect(readFileSync(path.join(entryDir, 'main.md'), 'utf8')).toBe(text);
  expect(body.warnings).toEqual([]);
});

test('PUT with a stale lastModified is 409 conflict with the current lastModified', async ({
  request,
}) => {
  const first = (await (await request.get(docUrl('main.md'))).json()) as DocBody;
  const saved = await request.put(docUrl('main.md'), {
    data: { markdown: `${first.markdown}one more\n`, ifUnmodifiedSince: first.lastModified },
  });
  expect(saved.status()).toBe(200);
  const current = ((await saved.json()) as DocBody).lastModified;

  const stale = await request.put(docUrl('main.md'), {
    data: { markdown: 'lost update\n', ifUnmodifiedSince: first.lastModified },
  });
  expect(stale.status()).toBe(409);
  const body = await errorOf(stale);
  expect(body.error).toBe('conflict');
  expect(body.lastModified).toBe(current);
  expect(readFileSync(path.join(entryDir, 'main.md'), 'utf8')).toBe(`${first.markdown}one more\n`);

  // Without ifUnmodifiedSince the write is unconditional.
  const forced = await request.put(docUrl('main.md'), { data: { markdown: first.markdown } });
  expect(forced.status()).toBe(200);
});

test('PUT with invalid frontmatter still saves and returns validator warnings', async ({
  request,
}) => {
  const current = (await (await request.get(docUrl('main.md'))).json()) as DocBody;
  const bad = current.markdown.replace(/^state: .*$/m, 'state: nope');
  expect(bad).not.toBe(current.markdown);
  const response = await request.put(docUrl('main.md'), { data: { markdown: bad } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as DocBody;
  expect(body.warnings.map((w) => w.rule)).toContain('okf/entry-schema');
  expect(body.warnings.every((w) => w.file === `task/${name}/main.md`)).toBe(true);
  expect(readFileSync(path.join(entryDir, 'main.md'), 'utf8')).toBe(bad);

  // Restore a valid entry file.
  const fixed = await request.put(docUrl('main.md'), { data: { markdown: current.markdown } });
  expect(((await fixed.json()) as DocBody).warnings).toEqual([]);
});

test('a percent-encoded path segment is decoded; a concept without type warns okf/type', async ({
  request,
}) => {
  const response = await request.get(docUrl('concepts/a%20b.md'));
  expect(response.status()).toBe(200);
  const body = (await response.json()) as DocBody;
  expect(body.path).toBe('concepts/a b.md');
  expect(body.warnings.map((w) => w.rule)).toContain('okf/type');

  const put = await request.put(docUrl('concepts/a%20b.md'), {
    data: { markdown: '---\ntype: Concept\n---\n# Typed\n' },
  });
  expect(put.status()).toBe(200);
  expect(((await put.json()) as DocBody).warnings).toEqual([]);
});

test('unsafe or non-markdown paths are 400 bad-path', async ({ request }) => {
  for (const rel of ['..%5Cx.md', 'concepts/..%5C..%5Cx.md', 'x.txt', 'concepts', '.hidden/x.md']) {
    const response = await request.get(docUrl(rel));
    expect(response.status(), rel).toBe(400);
    expect((await errorOf(response)).error, rel).toBe('bad-path');
  }
  // the entry directory itself (no path segment) is not a markdown file either
  const noPath = await request.get(`${API}/doc/task/${name}`);
  expect(noPath.status()).toBe(400);
  expect((await errorOf(noPath)).error).toBe('bad-path');
});

test('missing file or entry is 404 not-found; no file is created by PUT', async ({ request }) => {
  const missing = await request.get(docUrl('concepts/nope.md'));
  expect(missing.status()).toBe(404);
  expect((await errorOf(missing)).error).toBe('not-found');
  const noEntry = await request.get(docUrl('main.md', 'task', 'no-such-entry-here'));
  expect(noEntry.status()).toBe(404);
  const put = await request.put(docUrl('concepts/nope.md'), { data: { markdown: 'x' } });
  expect(put.status()).toBe(404);
  expect(() => readFileSync(path.join(entryDir, 'concepts', 'nope.md'))).toThrow();
});

test('bad dataset and bad slug are 400', async ({ request }) => {
  const dataset = await request.get(docUrl('x.md', 'context', 'ctxman-dev'));
  expect(dataset.status()).toBe(400);
  expect((await errorOf(dataset)).error).toBe('bad-dataset');
  const slug = await request.get(docUrl('main.md', 'task', 'Bad_Slug'));
  expect(slug.status()).toBe(400);
  expect((await errorOf(slug)).error).toBe('bad-slug');
});

test('a skill SKILL.md can be read', async ({ request }) => {
  const response = await request.get(docUrl('SKILL.md', 'skill', 'ctxman-add-entry'));
  expect(response.status()).toBe(200);
  const body = (await response.json()) as DocBody;
  expect(body.path).toBe('SKILL.md');
  expect(body.markdown).toContain('name: ctxman-add-entry');
  expect(Array.isArray(body.warnings)).toBe(true);
});

test('PUT body is validated: 400 invalid with issues', async ({ request }) => {
  const missing = await request.put(docUrl('main.md'), { data: { text: 'x' } });
  expect(missing.status()).toBe(400);
  const body = await errorOf(missing);
  expect(body.error).toBe('invalid');
  expect(body.issues?.map((i) => i.path).sort()).toEqual(['markdown', 'text']);

  const badDate = await request.put(docUrl('main.md'), {
    data: { markdown: 'x', ifUnmodifiedSince: 'yesterday' },
  });
  expect(badDate.status()).toBe(400);
  expect((await errorOf(badDate)).issues?.[0]?.path).toBe('ifUnmodifiedSince');

  const malformed = await request.put(docUrl('main.md'), {
    headers: { 'content-type': 'application/json' },
    data: Buffer.from('{"markdown": '),
  });
  expect(malformed.status()).toBe(400);
  expect((await errorOf(malformed)).error).toBe('bad-json');
});

test('PUT of more than 512 KB is 413 too-large', async ({ request }) => {
  const response = await request.put(docUrl('main.md'), {
    data: { markdown: 'a'.repeat(512 * 1024 + 1) },
  });
  expect(response.status()).toBe(413);
  expect((await errorOf(response)).error).toBe('too-large');
});

test('guards: text/plain is 415, a foreign Origin is 403, other methods are 405', async ({
  request,
}) => {
  const plain = await request.put(docUrl('main.md'), {
    headers: { 'content-type': 'text/plain' },
    data: 'x',
  });
  expect(plain.status()).toBe(415);
  expect((await errorOf(plain)).error).toBe('unsupported-media-type');

  const foreign = await request.put(docUrl('main.md'), {
    headers: { origin: 'https://evil.example' },
    data: { markdown: 'x' },
  });
  expect(foreign.status()).toBe(403);
  expect((await errorOf(foreign)).error).toBe('forbidden-origin');

  const post = await request.post(docUrl('main.md'), { data: { markdown: 'x' } });
  expect(post.status()).toBe(405);
  expect(post.headers().allow).toBe('GET, PUT');
  expect((await errorOf(post)).error).toBe('method-not-allowed');
  expect((await request.delete(docUrl('main.md'))).status()).toBe(405);
});
