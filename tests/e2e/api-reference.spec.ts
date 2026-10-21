// Reference CRUD (ROUND2_BACKEND_SPEC §C.3) over Playwright's request context: POST /api/reference and
// GET|PUT|DELETE /api/reference/:slug, the same conventions as /api/context. Files are checked in the e2e data copy.
import { expect, test } from './fixtures.ts';
import type { APIResponse } from '@playwright/test';
import { API, dataExists, readDataText, readYaml, uniqueName } from './helpers.ts';
import { E2E_SERVER_ORIGIN } from './paths.ts';

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

interface ReferenceBody {
  reference: Record<string, unknown>;
  lastModified: string;
}

// The writer points the modeline at the e2e server origin (CTXMAN_SERVER_ORIGIN, set by server.ts).
const MAGIC_COMMENT = `# yaml-language-server: $schema=${E2E_SERVER_ORIGIN}/api/schemas/reference`;

const errorOf = async (response: APIResponse): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const created: string[] = [];
const newName = (): string => {
  const name = uniqueName('e2e-ref');
  created.push(name);
  return name;
};

test.afterAll(async ({ playwright, baseURL }) => {
  const request = await playwright.request.newContext({ baseURL });
  try {
    for (const name of created) await request.delete(`${API}/reference/${name}`);
  } finally {
    await request.dispose();
  }
});

const body = (name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  description: 'Created by the reference API spec',
  type: 'remote-skill',
  uri: 'https://github.com/example/skills.git',
  subpath: 'skills/demo',
  owner: 'not-me',
  tags: ['e2e'],
  ...overrides,
});

test.describe('create', () => {
  test('POST is 201 with Location; the file has the schema comment and the fixed key order', async ({
    request,
  }) => {
    const name = newName();
    const response = await request.post(`${API}/reference`, {
      // Keys deliberately sent out of order: the file order is the serializer's.
      data: {
        tags: ['e2e'],
        owner: 'not-me',
        subpath: 'skills/demo',
        uri: 'https://github.com/example/skills.git',
        type: 'remote-skill',
        description: 'Created by the reference API spec',
        name,
      },
    });
    expect(response.status()).toBe(201);
    expect(response.headers().location).toBe(`/reference/${name}`);
    expect(response.headers()['cache-control']).toBe('no-store');
    const record = (await response.json()) as ReferenceBody;
    expect(record.reference).toMatchObject({ name, type: 'remote-skill', owner: 'not-me' });
    expect(Number.isNaN(Date.parse(record.lastModified))).toBe(false);

    const text = readDataText(`reference/${name}.yaml`);
    expect(text.split('\n')[0]).toBe(MAGIC_COMMENT);
    expect(Object.keys(readYaml(`reference/${name}.yaml`) as object)).toEqual([
      'name',
      'description',
      'type',
      'uri',
      'subpath',
      'owner',
      'tags',
    ]);
  });

  test('a local-repo has path (no uri) and omits empty tags and subpath', async ({ request }) => {
    const name = newName();
    const response = await request.post(`${API}/reference`, {
      data: {
        name,
        description: 'Local checkout',
        type: 'local-repo',
        path: '~/repos/demo',
        subpath: '',
        owner: 'me',
        tags: [],
      },
    });
    expect(response.status()).toBe(201);
    expect(Object.keys(readYaml(`reference/${name}.yaml`) as object)).toEqual([
      'name',
      'description',
      'type',
      'path',
      'owner',
    ]);
  });

  test('POST of an existing name is 409 exists and leaves the file alone', async ({ request }) => {
    const name = newName();
    expect((await request.post(`${API}/reference`, { data: body(name) })).status()).toBe(201);
    const before = readDataText(`reference/${name}.yaml`);
    const again = await request.post(`${API}/reference`, {
      data: body(name, { description: 'other' }),
    });
    expect(again.status()).toBe(409);
    expect((await errorOf(again)).error).toBe('exists');
    expect(readDataText(`reference/${name}.yaml`)).toBe(before);
  });

  test('POST validates: 400 invalid with issue paths', async ({ request }) => {
    const name = newName();
    const response = await request.post(`${API}/reference`, {
      data: body(name, { uri: 'not a uri', owner: 'you' }),
    });
    expect(response.status()).toBe(400);
    const error = await errorOf(response);
    expect(error.error).toBe('invalid');
    expect(error.issues?.map((i) => i.path).sort()).toEqual(['owner', 'uri']);
    expect(dataExists(`reference/${name}.yaml`)).toBe(false);
  });

  test('guards: text/plain 415, malformed JSON 400, foreign Origin 403, other methods 405', async ({
    request,
  }) => {
    const plain = await request.post(`${API}/reference`, {
      headers: { 'content-type': 'text/plain' },
      data: 'name: x',
    });
    expect(plain.status()).toBe(415);
    const malformed = await request.post(`${API}/reference`, {
      headers: { 'content-type': 'application/json' },
      data: Buffer.from('{"name": '),
    });
    expect(malformed.status()).toBe(400);
    expect((await errorOf(malformed)).error).toBe('bad-json');
    const foreign = await request.post(`${API}/reference`, {
      headers: { origin: 'https://evil.example' },
      data: body('e2e-ref-foreign'),
    });
    expect(foreign.status()).toBe(403);
    expect((await errorOf(foreign)).error).toBe('forbidden-origin');
    expect(dataExists('reference/e2e-ref-foreign.yaml')).toBe(false);
    const get = await request.get(`${API}/reference`);
    expect(get.status()).toBe(405);
    expect(get.headers().allow).toBe('POST');
  });
});

test.describe('read, update, delete', () => {
  test('GET, PUT (description, then type change), PUT name-mismatch and invalid, DELETE', async ({
    request,
  }) => {
    const name = newName();
    expect((await request.post(`${API}/reference`, { data: body(name) })).status()).toBe(201);

    const read = await request.get(`${API}/reference/${name}`);
    expect(read.status()).toBe(200);
    const record = (await read.json()) as ReferenceBody;
    expect(record.reference.description).toBe('Created by the reference API spec');

    const put = await request.put(`${API}/reference/${name}`, {
      data: body(name, { description: 'v2' }),
    });
    expect(put.status()).toBe(200);
    expect(((await put.json()) as ReferenceBody).reference.description).toBe('v2');
    const text = readDataText(`reference/${name}.yaml`);
    expect(text.split('\n')[0]).toBe(MAGIC_COMMENT);
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({ description: 'v2' });

    const typed = await request.put(`${API}/reference/${name}`, {
      data: {
        name,
        description: 'now local',
        type: 'local-repo',
        path: '~/repos/x',
        owner: 'me',
      },
    });
    expect(typed.status()).toBe(200);
    const typedYaml = readYaml(`reference/${name}.yaml`) as Record<string, unknown>;
    expect(typedYaml).toMatchObject({ type: 'local-repo', path: '~/repos/x' });
    expect(typedYaml).not.toHaveProperty('uri');

    const renamed = await request.put(`${API}/reference/${name}`, {
      data: body(`${name}-other`),
    });
    expect(renamed.status()).toBe(400);
    expect((await errorOf(renamed)).error).toBe('name-mismatch');

    const invalid = await request.put(`${API}/reference/${name}`, {
      data: body(name, { type: 'remote-repo', uri: 'ftp://nope' }),
    });
    expect(invalid.status()).toBe(400);
    const invalidBody = await errorOf(invalid);
    expect(invalidBody.error).toBe('invalid');
    expect(invalidBody.issues?.map((i) => i.path)).toContain('uri');
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({ description: 'now local' });

    const deleted = await request.delete(`${API}/reference/${name}`);
    expect(deleted.status()).toBe(204);
    expect(await deleted.text()).toBe('');
    expect(dataExists(`reference/${name}.yaml`)).toBe(false);
    expect((await request.get(`${API}/reference/${name}`)).status()).toBe(404);
    expect((await request.delete(`${API}/reference/${name}`)).status()).toBe(404);
    expect((await request.put(`${API}/reference/${name}`, { data: body(name) })).status()).toBe(
      404,
    );
  });

  test('a bad slug is 400 bad-slug, an unknown one 404 not-found', async ({ request }) => {
    const bad = await request.get(`${API}/reference/Bad_Slug`);
    expect(bad.status()).toBe(400);
    expect((await errorOf(bad)).error).toBe('bad-slug');
    expect((await request.delete(`${API}/reference/Bad_Slug`)).status()).toBe(400);
    const missing = await request.get(`${API}/reference/no-such-reference-here`);
    expect(missing.status()).toBe(404);
    expect((await errorOf(missing)).error).toBe('not-found');
  });

  test('PUT and DELETE guards: 415, 403, 405', async ({ request }) => {
    const name = newName();
    expect((await request.post(`${API}/reference`, { data: body(name) })).status()).toBe(201);
    const plain = await request.put(`${API}/reference/${name}`, {
      headers: { 'content-type': 'text/plain' },
      data: 'x',
    });
    expect(plain.status()).toBe(415);
    const foreignPut = await request.put(`${API}/reference/${name}`, {
      headers: { origin: 'https://evil.example' },
      data: body(name, { description: 'hijacked' }),
    });
    expect(foreignPut.status()).toBe(403);
    const foreignDelete = await request.delete(`${API}/reference/${name}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreignDelete.status()).toBe(403);
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({
      description: 'Created by the reference API spec',
    });
    const post = await request.post(`${API}/reference/${name}`, { data: body(name) });
    expect(post.status()).toBe(405);
    expect(post.headers().allow).toBe('GET, PUT, DELETE');
  });
});

test.describe('folder (the folder name in an Inflate working directory)', () => {
  const repo = (
    name: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name,
    description: 'Folder name round trip',
    type: 'local-repo',
    path: '~/repos/demo',
    subpath: 'docs',
    owner: 'me',
    ...overrides,
  });

  test('POST keeps folder (after subpath, before owner); GET returns it; PUT changes and removes it', async ({
    request,
  }) => {
    const name = newName();
    const created = await request.post(`${API}/reference`, {
      data: repo(name, { folder: 'my-repo.v2' }),
    });
    expect(created.status(), await created.text()).toBe(201);
    expect(((await created.json()) as ReferenceBody).reference).toMatchObject({
      folder: 'my-repo.v2',
    });
    expect(Object.keys(readYaml(`reference/${name}.yaml`) as object)).toEqual([
      'name',
      'description',
      'type',
      'path',
      'subpath',
      'folder',
      'owner',
    ]);
    const read = await request.get(`${API}/reference/${name}`);
    expect(((await read.json()) as ReferenceBody).reference).toMatchObject({
      folder: 'my-repo.v2',
    });

    const changed = await request.put(`${API}/reference/${name}`, {
      data: repo(name, { folder: 'other-dir' }),
    });
    expect(changed.status()).toBe(200);
    expect(readYaml(`reference/${name}.yaml`)).toMatchObject({ folder: 'other-dir' });

    // no folder in the body: the key leaves the file again (the reference name is the folder)
    const removed = await request.put(`${API}/reference/${name}`, { data: repo(name) });
    expect(removed.status()).toBe(200);
    expect(readYaml(`reference/${name}.yaml`)).not.toHaveProperty('folder');
    expect(readDataText(`reference/${name}.yaml`)).not.toContain('folder:');
  });

  test('a remote repo and a local folder take a folder too', async ({ request }) => {
    const remote = newName();
    expect(
      (
        await request.post(`${API}/reference`, {
          data: body(remote, {
            type: 'remote-repo',
            uri: 'git@github.com:org/e2e-folder.git',
            subpath: undefined,
            folder: 'checkout',
          }),
        })
      ).status(),
    ).toBe(201);
    expect(readYaml(`reference/${remote}.yaml`)).toMatchObject({ folder: 'checkout' });
    const plain = newName();
    expect(
      (
        await request.post(`${API}/reference`, {
          data: {
            name: plain,
            description: 'A plain folder',
            type: 'local-folder',
            path: '~/e2e-notes',
            owner: 'me',
            folder: 'notes',
          },
        })
      ).status(),
    ).toBe(201);
    expect(readYaml(`reference/${plain}.yaml`)).toMatchObject({
      type: 'local-folder',
      folder: 'notes',
    });
  });

  test('a folder that is not one plain name is 400 invalid on the folder path; nothing is written', async ({
    request,
  }) => {
    for (const folder of ['a/b', '../up', '.hidden', '-lead', 'with space', '']) {
      const name = newName();
      const response = await request.post(`${API}/reference`, { data: repo(name, { folder }) });
      expect(response.status(), JSON.stringify(folder)).toBe(400);
      const error = await errorOf(response);
      expect(error.error).toBe('invalid');
      expect(
        error.issues?.map((i) => i.path),
        JSON.stringify(folder),
      ).toEqual(['folder']);
      expect(dataExists(`reference/${name}.yaml`), JSON.stringify(folder)).toBe(false);
    }
    const tooLong = await request.post(`${API}/reference`, {
      data: repo(newName(), { folder: 'x'.repeat(101) }),
    });
    expect(tooLong.status()).toBe(400);
  });

  test('a remote skill has no folder: the key is refused', async ({ request }) => {
    const name = newName();
    const response = await request.post(`${API}/reference`, {
      data: body(name, { folder: 'skills' }),
    });
    expect(response.status()).toBe(400);
    const error = await errorOf(response);
    expect(error.error).toBe('invalid');
    expect(error.issues?.map((i) => i.path)).toContain('folder');
    expect(dataExists(`reference/${name}.yaml`)).toBe(false);
  });
});

test('a created reference shows up in /api/entries?dataset=reference at once, and leaves it when deleted', async ({
  request,
}) => {
  const name = newName();
  const slugs = async (): Promise<string[]> => {
    const response = await request.get(`${API}/entries?dataset=reference`);
    return ((await response.json()) as { entries: { slug: string }[] }).entries.map((e) => e.slug);
  };
  expect((await request.post(`${API}/reference`, { data: body(name) })).status()).toBe(201);
  expect(await slugs()).toContain(name);

  expect((await request.delete(`${API}/reference/${name}`)).status()).toBe(204);
  expect(await slugs()).not.toContain(name);
});
