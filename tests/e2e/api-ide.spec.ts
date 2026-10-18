// Open in IDE API (ROUND2_BACKEND_SPEC §B.3). CTXMAN_IDE_COMMAND points at a fake `code` (prepare-data.ts copies
// tests/e2e/fixtures/fake-code.mjs) that records its argv as a JSON line, so no editor is ever started.
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API, dataPath, E2E_DATA_DIR } from './helpers.ts';
import { E2E_IDE_COMMAND, E2E_IDE_RECORD } from './paths.ts';

test.skip(process.platform === 'win32', 'the fake IDE command is a posix script');
test.describe.configure({ mode: 'serial' });

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

const errorOf = async (response: APIResponse): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

/** Every recorded fake-code run, oldest first. */
function recordedCalls(): string[][] {
  if (!existsSync(E2E_IDE_RECORD)) return [];
  return readFileSync(E2E_IDE_RECORD, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}

const open = (request: APIRequestContext, data: unknown): Promise<APIResponse> =>
  request.post(`${API}/ide/open`, { data });

/** POSTs `data`, expects 200 and waits for the fake command to record exactly one more run. */
async function openAndRecord(
  request: APIRequestContext,
  data: unknown,
): Promise<{ command: string[]; call: string[] }> {
  const before = recordedCalls().length;
  const response = await open(request, data);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { ok: boolean; command: string[] };
  expect(body.ok).toBe(true);
  await expect.poll(() => recordedCalls().length, { timeout: 3000 }).toBe(before + 1);
  return { command: body.command, call: recordedCalls()[before] ?? [] };
}

test('GET reports the configured command as available', async ({ request }) => {
  const response = await request.get(`${API}/ide/open`);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ available: true, command: E2E_IDE_COMMAND });
});

test('POST opens the entry folder with index.md: argv is [folder, file] and nothing else', async ({
  request,
}) => {
  const root = dataPath('kb/ctxman');
  const file = dataPath('kb/ctxman/index.md');
  const { command, call } = await openAndRecord(request, { dataset: 'kb', slug: 'ctxman' });
  expect(command).toEqual([E2E_IDE_COMMAND, root, file]);
  expect(call).toEqual([root, file]);
});

test('POST with a bundle-relative path opens that file in the entry folder', async ({
  request,
}) => {
  const root = dataPath('kb/ctxman');
  const file = dataPath('kb/ctxman/concepts/datasets.md');
  const { command, call } = await openAndRecord(request, {
    dataset: 'kb',
    slug: 'ctxman',
    path: 'concepts/datasets.md',
  });
  expect(command).toEqual([E2E_IDE_COMMAND, root, file]);
  expect(call).toEqual([root, file]);
});

test('skill entries open SKILL.md', async ({ request }) => {
  const root = dataPath('skill/ctxman-add-entry');
  const { call } = await openAndRecord(request, { dataset: 'skill', slug: 'ctxman-add-entry' });
  expect(call).toEqual([root, dataPath('skill/ctxman-add-entry/SKILL.md')]);
});

test('yaml datasets open the data dir with <dataset>/<slug>.yaml', async ({ request }) => {
  const { call } = await openAndRecord(request, { dataset: 'reference', slug: 'ctxman-repo' });
  expect(call).toEqual([E2E_DATA_DIR, dataPath('reference/ctxman-repo.yaml')]);
  const context = await openAndRecord(request, { dataset: 'context', slug: 'ctxman-dev' });
  expect(context.call).toEqual([E2E_DATA_DIR, dataPath('context/ctxman-dev.yaml')]);
});

test('request errors never start the IDE', async ({ request }) => {
  const before = recordedCalls().length;
  const cases: [unknown, number, string][] = [
    [{ dataset: 'reference', slug: 'ctxman-repo', path: 'x.md' }, 400, 'bad-path'],
    [{ dataset: 'kb', slug: 'ctxman', path: '../secret.md' }, 400, 'bad-path'],
    [{ dataset: 'kb', slug: 'ctxman', path: '/etc/passwd' }, 400, 'bad-path'],
    [{ dataset: 'kb', slug: 'no-such-entry-here' }, 404, 'not-found'],
    [{ dataset: 'kb', slug: 'ctxman', path: 'concepts/nope.md' }, 404, 'not-found'],
    [{ dataset: 'reference', slug: 'no-such-reference' }, 404, 'not-found'],
    [{ dataset: 'kb', slug: 'Bad_Slug' }, 400, 'bad-slug'],
    [{ dataset: 'nope', slug: 'ctxman' }, 400, 'invalid'],
    [{ dataset: 'kb' }, 400, 'invalid'],
    [{ dataset: 'kb', slug: 'ctxman', path: 5 }, 400, 'invalid'],
    [{ dataset: 'kb', slug: 'ctxman', command: '/bin/sh' }, 400, 'invalid'],
    [[], 400, 'invalid'],
  ];
  for (const [data, status, code] of cases) {
    const response = await open(request, data);
    expect(response.status(), JSON.stringify(data)).toBe(status);
    expect((await errorOf(response)).error, JSON.stringify(data)).toBe(code);
  }
  expect(recordedCalls().length).toBe(before);
});

test('guards: text/plain is 415, a foreign Origin is 403, other methods are 405', async ({
  request,
}) => {
  const plain = await request.post(`${API}/ide/open`, {
    headers: { 'content-type': 'text/plain' },
    data: 'kb/ctxman',
  });
  expect(plain.status()).toBe(415);
  const foreign = await request.post(`${API}/ide/open`, {
    headers: { origin: 'https://evil.example' },
    data: { dataset: 'kb', slug: 'ctxman' },
  });
  expect(foreign.status()).toBe(403);
  expect((await errorOf(foreign)).error).toBe('forbidden-origin');
  const del = await request.delete(`${API}/ide/open`);
  expect(del.status()).toBe(405);
  expect(del.headers().allow).toBe('GET, POST');
});

test('a missing IDE command is 501 ide-not-found and GET reports it unavailable', async ({
  request,
}) => {
  const moved = `${E2E_IDE_COMMAND}.moved`;
  renameSync(E2E_IDE_COMMAND, moved);
  try {
    const before = recordedCalls().length;
    const response = await open(request, { dataset: 'kb', slug: 'ctxman' });
    expect(response.status()).toBe(501);
    const body = await errorOf(response);
    expect(body.error).toBe('ide-not-found');
    expect(body.message).toContain('CTXMAN_IDE_COMMAND');
    expect(body.message).toContain(E2E_IDE_COMMAND);
    expect(recordedCalls().length).toBe(before);

    const probe = await request.get(`${API}/ide/open`);
    expect(probe.status()).toBe(200);
    expect(await probe.json()).toEqual({ available: false, command: null });
  } finally {
    renameSync(moved, E2E_IDE_COMMAND);
  }
  const restored = await request.get(`${API}/ide/open`);
  expect(((await restored.json()) as { available: boolean }).available).toBe(true);
});
