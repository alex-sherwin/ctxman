// Recipe and Inflate API contracts (INFLATE_SPEC §7.3) over Playwright's request context: status codes and error
// codes of /api/recipe, /api/recipe/:slug, /api/inflate/render and /api/inflate/write. No browser. Recipes are
// copies of the seed, removed after each test; written files go to the OS temp dir and are removed too.
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from './fixtures.ts';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import {
  API,
  E2E_DATA_DIR,
  SEED_RECIPE,
  createRecipeCopy,
  dataExists,
  dataPath,
  deleteRecipeQuietly,
  fetchSeedRecipe,
  readDataText,
  readRecipeYaml,
  uniqueName,
} from './helpers.ts';
import type { RecipeBody } from './helpers.ts';

interface ErrorBody {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}

interface RenderBody {
  markdown: string;
  manifest: { segments: { key: string; status: string }[]; bytes: number; warnings: unknown[] };
}

async function errorOf(response: APIResponse): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

/** Recipes created by the test in progress; removed afterwards. */
const created = new Set<string>();

test.afterEach(async ({ request }) => {
  for (const name of created) await deleteRecipeQuietly(request, name);
  created.clear();
});

async function copyOfSeed(request: APIRequestContext, prefix = 'api-rcp'): Promise<string> {
  const name = uniqueName(prefix);
  await createRecipeCopy(request, name);
  created.add(name);
  return name;
}

test.describe('recipe CRUD', () => {
  test('POST creates (201 + Location), duplicates are 409, invalid bodies are 400', async ({
    request,
  }) => {
    const name = uniqueName('api-rcp');
    const created201 = await request.post(`${API}/recipe`, {
      data: {
        name,
        description: 'API created',
        target: 'codex',
        layout: 'flat',
        contexts: [],
        items: [],
      },
    });
    expect(created201.status()).toBe(201);
    created.add(name);
    expect(created201.headers().location).toBe(`/recipe/${name}`);
    const body = (await created201.json()) as { recipe: RecipeBody; lastModified: string };
    expect(body.recipe.name).toBe(name);
    expect(Number.isNaN(Date.parse(body.lastModified))).toBe(false);
    expect(readRecipeYaml(name)).toMatchObject({ name, target: 'codex', layout: 'flat' });

    const duplicate = await request.post(`${API}/recipe`, {
      data: {
        name,
        description: 'again',
        target: 'codex',
        layout: 'flat',
        contexts: [],
        items: [],
      },
    });
    expect(duplicate.status()).toBe(409);
    expect((await errorOf(duplicate)).error).toBe('exists');

    const invalid = await request.post(`${API}/recipe`, {
      data: { name: uniqueName('api-rcp'), target: 'claude-code', layout: 'grouped' },
    });
    expect(invalid.status()).toBe(400);
    const invalidBody = await errorOf(invalid);
    expect(invalidBody.error).toBe('invalid');
    expect(invalidBody.issues?.some((i) => i.path === 'description')).toBe(true);

    const badTarget = await request.post(`${API}/recipe`, {
      data: {
        name: uniqueName('api-rcp'),
        description: 'x',
        target: 'vim',
        layout: 'grouped',
        contexts: [],
        items: [],
      },
    });
    expect(badTarget.status()).toBe(400);
    expect((await errorOf(badTarget)).error).toBe('invalid');

    const badName = await request.post(`${API}/recipe`, {
      data: {
        name: 'Not_Valid',
        description: 'x',
        target: 'claude-code',
        layout: 'grouped',
        contexts: [],
        items: [],
      },
    });
    expect(badName.status()).toBe(400);
  });

  test('an override may carry edit (written after materialOptions); only on a reference key', async ({
    request,
  }) => {
    const name = uniqueName('api-rcp');
    const base = {
      name,
      description: 'Editable flag',
      target: 'claude-code',
      layout: 'grouped',
      contexts: [],
      items: [],
    };
    const created201 = await request.post(`${API}/recipe`, {
      data: {
        ...base,
        overrides: [
          {
            key: 'reference/astro-docs',
            material: 'clone',
            materialOptions: { cloneDepth: 10 },
            edit: true,
          },
          { key: 'reference/blasto', edit: false },
        ],
      },
    });
    expect(created201.status(), await created201.text()).toBe(201);
    created.add(name);
    expect(readRecipeYaml(name).overrides).toEqual([
      {
        key: 'reference/astro-docs',
        material: 'clone',
        materialOptions: { cloneDepth: 10 },
        edit: true,
      },
      { key: 'reference/blasto', edit: false },
    ]);
    // fixed key order: an override that only says edit is kept, edit follows materialOptions
    const text = readDataText(`recipe/${name}.yaml`);
    expect(text.indexOf('materialOptions:')).toBeGreaterThan(-1);
    expect(text.indexOf('edit: true')).toBeGreaterThan(text.indexOf('materialOptions:'));
    expect(text).toContain('- key: reference/blasto\n    edit: false');

    // the flag is meaningless on anything but a repository (reference/<slug>)
    for (const key of ['kb/ctxman', 'skill/okf-authoring']) {
      const bad = await request.put(`${API}/recipe/${name}`, {
        data: { ...base, overrides: [{ key, edit: true }] },
      });
      expect(bad.status(), key).toBe(400);
      const body = await errorOf(bad);
      expect(body.error).toBe('invalid');
      expect(
        body.issues?.some((i) => i.path === 'overrides.0.edit'),
        key,
      ).toBe(true);
      expect(
        body.issues?.some((i) => i.message.includes('repositories only')),
        key,
      ).toBe(true);
    }
    // nothing was written by the refused PUTs
    expect(readRecipeYaml(name).overrides).toHaveLength(2);

    // and a non-boolean flag is refused too
    const notBoolean = await request.put(`${API}/recipe/${name}`, {
      data: { ...base, overrides: [{ key: 'reference/blasto', edit: 'yes' }] },
    });
    expect(notBoolean.status()).toBe(400);
  });

  test('POST with a non-JSON body is 415; malformed JSON is 400 bad-json', async ({ request }) => {
    const wrongType = await request.post(`${API}/recipe`, {
      headers: { 'content-type': 'text/plain' },
      data: 'name: x',
    });
    expect(wrongType.status()).toBe(415);
    expect((await errorOf(wrongType)).error).toBe('unsupported-media-type');

    const malformed = await request.post(`${API}/recipe`, {
      headers: { 'content-type': 'application/json' },
      data: Buffer.from('{"name": '),
    });
    expect(malformed.status()).toBe(400);
    expect((await errorOf(malformed)).error).toBe('bad-json');
  });

  test('GET, PUT and DELETE by slug: 200, 400 name-mismatch, 415, 404, 204', async ({
    request,
  }) => {
    const name = await copyOfSeed(request);

    const read = await request.get(`${API}/recipe/${name}`);
    expect(read.status()).toBe(200);
    const readBody = (await read.json()) as { recipe: RecipeBody; lastModified: string };
    expect(readBody.recipe.name).toBe(name);
    expect(readBody.recipe.target).toBe('claude-code');

    const update = { ...(await fetchSeedRecipe(request)), name, description: 'updated by the api' };
    const put = await request.put(`${API}/recipe/${name}`, { data: update });
    expect(put.status()).toBe(200);
    expect(((await put.json()) as { recipe: RecipeBody }).recipe.description).toBe(
      'updated by the api',
    );
    expect(readRecipeYaml(name).description).toBe('updated by the api');

    const renamed = await request.put(`${API}/recipe/${name}`, {
      data: { ...update, name: `${name}-other` },
    });
    expect(renamed.status()).toBe(400);
    expect((await errorOf(renamed)).error).toBe('name-mismatch');

    const wrongType = await request.put(`${API}/recipe/${name}`, {
      headers: { 'content-type': 'text/plain' },
      data: 'name: x',
    });
    expect(wrongType.status()).toBe(415);

    const deleted = await request.delete(`${API}/recipe/${name}`);
    expect(deleted.status()).toBe(204);
    expect(await deleted.text()).toBe('');
    created.delete(name);
    expect(dataExists(`recipe/${name}.yaml`)).toBe(false);

    expect((await request.get(`${API}/recipe/${name}`)).status()).toBe(404);
    expect((await request.delete(`${API}/recipe/${name}`)).status()).toBe(404);
    expect((await request.put(`${API}/recipe/${name}`, { data: update })).status()).toBe(404);
  });

  test('a missing recipe is 404 not-found; an invalid slug is 400 bad-slug', async ({
    request,
  }) => {
    const missing = await request.get(`${API}/recipe/no-such-recipe-here`);
    expect(missing.status()).toBe(404);
    expect((await errorOf(missing)).error).toBe('not-found');

    const badSlug = await request.get(`${API}/recipe/Bad_Slug`);
    expect(badSlug.status()).toBe(400);
    expect((await errorOf(badSlug)).error).toBe('bad-slug');
  });

  test('an unreadable recipe file is 422 invalid-file on GET', async ({ request }) => {
    const name = uniqueName('api-broken');
    const file = dataPath(`recipe/${name}.yaml`);
    writeFileSync(file, `name: ${name}\ndescription: [unclosed\n`);
    try {
      const response = await request.get(`${API}/recipe/${name}`);
      expect(response.status()).toBe(422);
      expect((await errorOf(response)).error).toBe('invalid-file');
    } finally {
      unlinkSync(file);
    }
  });

  test('a cross-origin DELETE is refused with 403 before the route runs', async ({ request }) => {
    const name = await copyOfSeed(request);
    const response = await request.delete(`${API}/recipe/${name}`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(response.status()).toBe(403);
    expect(dataExists(`recipe/${name}.yaml`)).toBe(true);
  });

  test('a cross-origin POST is refused with 403 forbidden-origin', async ({ request }) => {
    const name = uniqueName('api-rcp');
    const response = await request.post(`${API}/recipe`, {
      headers: { origin: 'https://evil.example' },
      data: {
        name,
        description: 'x',
        target: 'claude-code',
        layout: 'grouped',
        contexts: [],
        items: [],
      },
    });
    expect(response.status()).toBe(403);
    expect((await errorOf(response)).error).toBe('forbidden-origin');
    expect(dataExists(`recipe/${name}.yaml`)).toBe(false);
  });

  test('unsupported methods are 405 with an Allow header', async ({ request }) => {
    const response = await request.patch(`${API}/recipe/${SEED_RECIPE}`, { data: {} });
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe('GET, PUT, DELETE');
  });
});

test.describe('render and write', () => {
  test('POST /api/inflate/render renders the seed as {markdown, manifest}', async ({ request }) => {
    const seed = await fetchSeedRecipe(request);
    const response = await request.post(`${API}/inflate/render`, { data: seed });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as RenderBody;
    expect(body.markdown).toContain('## Context: ctxman-dev');
    expect(body.markdown).toContain('## Additional items');
    expect(body.markdown).toContain('### ctxman');
    expect(body.manifest.segments.length).toBeGreaterThanOrEqual(13);
    expect(typeof body.manifest.bytes).toBe('number');
    expect(Array.isArray(body.manifest.warnings)).toBe(true);
  });

  test('render accepts an unsaved recipe; an invalid body is 400 invalid; a non-JSON body is 415', async ({
    request,
  }) => {
    const seed = await fetchSeedRecipe(request);
    const unsavedName = uniqueName('never-saved');
    const unsaved = await request.post(`${API}/inflate/render`, {
      data: { ...seed, name: unsavedName },
    });
    expect(unsaved.status()).toBe(200);
    expect(((await unsaved.json()) as RenderBody).markdown.startsWith(`# ${unsavedName}\n`)).toBe(
      true,
    );
    expect(dataExists(`recipe/${unsavedName}.yaml`)).toBe(false);

    const invalid = await request.post(`${API}/inflate/render`, { data: { name: 'x' } });
    expect(invalid.status()).toBe(400);
    const invalidBody = await errorOf(invalid);
    expect(invalidBody.error).toBe('invalid');
    expect(invalidBody.issues?.length ?? 0).toBeGreaterThan(0);

    const wrongType = await request.post(`${API}/inflate/render`, {
      headers: { 'content-type': 'text/plain' },
      data: 'name: x',
    });
    expect(wrongType.status()).toBe(415);
  });

  test('write refuses relative paths, non-.md names, the data dir, node_modules and .git with bad-path', async ({
    request,
  }) => {
    const seed = await fetchSeedRecipe(request);
    const cases: [string, string][] = [
      ['brief.md', 'path must be absolute'],
      [path.join(os.tmpdir(), 'brief.txt'), 'path must end in .md'],
      [path.join(E2E_DATA_DIR, 'brief.md'), 'path must not be inside the data directory'],
      [
        path.join(os.tmpdir(), 'node_modules', 'brief.md'),
        'path must not be inside node_modules or .git',
      ],
      [path.join(os.tmpdir(), '.git', 'brief.md'), 'path must not be inside node_modules or .git'],
    ];
    for (const [target, message] of cases) {
      const response = await request.post(`${API}/inflate/write`, {
        data: { recipe: seed, path: target },
      });
      expect(response.status(), target).toBe(400);
      const body = await errorOf(response);
      expect(body.error, target).toBe('bad-path');
      expect(body.message, target).toBe(message);
    }
    expect(existsSync(path.join(E2E_DATA_DIR, 'brief.md'))).toBe(false);
  });

  test('write of a valid absolute path creates the folders and returns {path, bytes, manifest}', async ({
    request,
  }) => {
    const seed = await fetchSeedRecipe(request);
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-api-'));
    const file = path.join(dir, 'nested', 'brief.md');
    try {
      const response = await request.post(`${API}/inflate/write`, {
        data: { recipe: seed, path: file },
      });
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        path: string;
        bytes: number;
        manifest: RenderBody['manifest'];
      };
      expect(body.path).toBe(file);
      expect(existsSync(file)).toBe(true);
      const written = readFileSync(file, 'utf8');
      expect(written.startsWith(`# ${SEED_RECIPE}\n`)).toBe(true);
      expect(body.bytes).toBe(Buffer.byteLength(written));
      expect(body.manifest.segments.length).toBeGreaterThanOrEqual(13);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('write rejects a non-string path and an invalid recipe with 400 invalid', async ({
    request,
  }) => {
    const seed = await fetchSeedRecipe(request);
    const notString = await request.post(`${API}/inflate/write`, {
      data: { recipe: seed, path: 42 },
    });
    expect(notString.status()).toBe(400);
    const notStringBody = await errorOf(notString);
    expect(notStringBody.error).toBe('invalid');
    expect(notStringBody.issues?.some((i) => i.path === 'path')).toBe(true);

    const badRecipe = await request.post(`${API}/inflate/write`, {
      data: { recipe: { name: 'x' }, path: path.join(os.tmpdir(), 'never.md') },
    });
    expect(badRecipe.status()).toBe(400);
    const badRecipeBody = await errorOf(badRecipe);
    expect(badRecipeBody.error).toBe('invalid');
    expect(badRecipeBody.issues?.some((i) => i.path.startsWith('recipe'))).toBe(true);
  });
});
