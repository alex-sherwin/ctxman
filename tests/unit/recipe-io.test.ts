import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseRecipe, serializeRecipe } from '../../src/lib/inflate/recipe.ts';
import {
  RecipeIoError,
  createRecipe,
  deleteRecipe,
  listRecipes,
  readRecipe,
  recipeFile,
  validateRecipe,
  writeRecipe,
} from '../../src/lib/recipe-io.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RecipeIoError) return error.code;
    throw error;
  }
  return 'resolved';
}

const doc = (overrides: Record<string, unknown> = {}) => ({
  name: 'my-recipe',
  description: 'A recipe',
  tags: ['a'],
  target: 'codex',
  contexts: ['ctx-a'],
  items: [{ dataset: 'kb', slug: 'ctxman' }],
  preamble: 'Line one.\nLine two.',
  ...overrides,
});

describe('recipeFile', () => {
  it('returns data/recipe/<slug>.yaml and rejects non-kebab slugs', () => {
    const root = path.resolve('/data-root');
    expect(recipeFile('my-recipe', root)).toBe(path.join(root, 'recipe', 'my-recipe.yaml'));
    for (const bad of ['', 'A', '../x', 'a/b', 'a.b', '-a', 'a'.repeat(65)]) {
      expect(() => recipeFile(bad, root), bad).toThrow(RecipeIoError);
    }
    try {
      recipeFile('../x', root);
    } catch (error) {
      expect((error as RecipeIoError).code).toBe('bad-slug');
    }
  });
});

describe('validateRecipe', () => {
  it('accepts a valid document, filling defaults', () => {
    const r = validateRecipe({ name: 'c', description: 'd' }, 'c');
    expect(r).toMatchObject({
      ok: true,
      recipe: {
        name: 'c',
        tags: [],
        target: 'claude-code',
        layout: 'grouped',
        contexts: [],
        items: [],
        markdown: [],
        overrides: [],
        order: [],
        defaults: {},
      },
    });
  });

  it('returns issues with dotted paths and says "Required" for missing fields', () => {
    const r = validateRecipe(
      { description: '', items: [{ dataset: 'context', slug: 'Bad_Slug' }] },
      'c',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid');
      expect(r.issues).toContainEqual({ path: 'name', message: 'Required' });
      const paths = r.issues.map((i) => i.path);
      expect(paths).toContain('description');
      expect(paths).toContain('items.0.dataset');
      expect(paths).toContain('items.0.slug');
    }
  });

  it('reports name-mismatch when name differs from the slug', () => {
    expect(validateRecipe({ name: 'other', description: 'd' }, 'c')).toMatchObject({
      ok: false,
      code: 'name-mismatch',
    });
  });

  it('rejects non-object input', () => {
    expect(validateRecipe('nope', 'c')).toMatchObject({ ok: false, code: 'invalid' });
    expect(validateRecipe(null, 'c')).toMatchObject({ ok: false, code: 'invalid' });
  });
});

describe('create / read / write / delete cycle', () => {
  it('creates, reads, rewrites and deletes a recipe', async () => {
    const dir = tmp.make();

    const created = await createRecipe(doc(), dir);
    expect(created.slug).toBe('my-recipe');
    expect(created.file).toBe('recipe/my-recipe.yaml');
    const file = path.join(dir, 'recipe', 'my-recipe.yaml');
    const text = readFileSync(file, 'utf8');
    expect(text).toBe(serializeRecipe(created.recipe));
    expect(text).toContain('preamble: |\n  Line one.\n  Line two.\n');

    const read = await readRecipe('my-recipe', dir);
    expect(read.recipe).toEqual({ ...created.recipe, preamble: 'Line one.\nLine two.\n' });
    expect(Number.isNaN(Date.parse(read.lastModified))).toBe(false);

    const written = await writeRecipe(
      'my-recipe',
      doc({ description: 'Changed', contexts: [], items: [] }),
      dir,
    );
    expect(written.recipe.description).toBe('Changed');
    expect((await readRecipe('my-recipe', dir)).recipe.contexts).toEqual([]);

    await deleteRecipe('my-recipe', dir);
    expect(existsSync(file)).toBe(false);
  });

  it('error codes: exists, not-found, name-mismatch, invalid, bad-slug', async () => {
    const dir = tmp.make();
    await createRecipe(doc(), dir);

    expect(await codeOf(createRecipe(doc(), dir))).toBe('exists');
    expect(await codeOf(createRecipe({ name: 'x' }, dir))).toBe('invalid');
    expect(await codeOf(createRecipe(doc({ name: 'Bad Name' }), dir))).toBe('invalid');

    expect(await codeOf(readRecipe('nope', dir))).toBe('not-found');
    expect(await codeOf(writeRecipe('nope', doc({ name: 'nope' }), dir))).toBe('not-found');
    expect(await codeOf(deleteRecipe('nope', dir))).toBe('not-found');

    expect(await codeOf(writeRecipe('my-recipe', doc({ name: 'renamed' }), dir))).toBe(
      'name-mismatch',
    );
    expect(await codeOf(writeRecipe('my-recipe', { name: 'my-recipe' }, dir))).toBe('invalid');
    expect(await codeOf(readRecipe('../etc', dir))).toBe('bad-slug');
    expect(await codeOf(deleteRecipe('A', dir))).toBe('bad-slug');

    expect((await readRecipe('my-recipe', dir)).recipe.description).toBe('A recipe');
  });

  it('carries issues on invalid errors and rejects mode/kind mismatches', async () => {
    const dir = tmp.make();
    try {
      await createRecipe(
        { name: 'c', description: 'd', overrides: [{ key: 'kb/x', mode: 'install' }] },
        dir,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(RecipeIoError);
      expect((error as RecipeIoError).issues).toEqual([
        { path: 'overrides.0.mode', message: 'mode "install" does not apply to kb/x' },
      ]);
    }
  });

  it('writes atomically: no .tmp files remain, even after a failed write', async () => {
    const dir = tmp.make();
    await createRecipe(doc(), dir);
    await writeRecipe('my-recipe', doc({ description: 'v2' }), dir);
    await codeOf(writeRecipe('my-recipe', doc({ name: 'other' }), dir));
    expect(readdirSync(path.join(dir, 'recipe'))).toEqual(['my-recipe.yaml']);
  });

  it('create makes the recipe directory when it is missing', async () => {
    const dir = tmp.make();
    expect(existsSync(path.join(dir, 'recipe'))).toBe(false);
    await createRecipe(doc(), dir);
    expect(existsSync(path.join(dir, 'recipe', 'my-recipe.yaml'))).toBe(true);
  });

  it('files round-trip through parseYaml + parseRecipe', async () => {
    const dir = tmp.make();
    const created = await createRecipe(
      doc({
        markdown: [{ id: 'b1', body: '## Notes\n\n- a: b # c\n' }],
        overrides: [{ key: 'kb/ctxman', mode: 'inline-bundle', options: { includeLog: true } }],
        order: ['md:b1', 'ctx:ctx-a'],
        defaults: { kb: { mode: 'summary' } },
      }),
      dir,
    );
    const source = readFileSync(path.join(dir, 'recipe', 'my-recipe.yaml'), 'utf8');
    const again = parseRecipe(parseYaml(source), 'my-recipe');
    expect(again.ok && again.recipe).toEqual({
      ...created.recipe,
      preamble: 'Line one.\nLine two.\n',
      markdown: [{ id: 'b1', body: '## Notes\n\n- a: b # c\n' }],
    });
  });
});

describe('readRecipe on damaged files', () => {
  it('distinguishes parse errors, schema errors and a stem/name mismatch', async () => {
    const dir = tmp.make({
      'recipe/broken.yaml': 'name: [unclosed\n',
      'recipe/bad-schema.yaml': 'name: bad-schema\ndescription: ""\ncontexts: nope\n',
      'recipe/stem.yaml': 'name: other\ndescription: d\n',
    });
    expect(await codeOf(readRecipe('broken', dir))).toBe('parse');
    expect(await codeOf(readRecipe('bad-schema', dir))).toBe('invalid');
    expect(await codeOf(readRecipe('stem', dir))).toBe('invalid');
  });
});

describe('listRecipes', () => {
  it('returns [] for a missing recipe directory', async () => {
    expect(await listRecipes(tmp.make())).toEqual({ items: [], errors: [] });
  });

  it('sorts by slug and reports invalid files in errors instead of throwing', async () => {
    const dir = tmp.make({
      'recipe/zeta.yaml': 'name: zeta\ndescription: z\n',
      'recipe/alpha.yaml': 'name: alpha\ndescription: a\ncontexts:\n  - x\n',
      'recipe/broken.yaml': 'name: [oops\n',
      'recipe/mismatch.yaml': 'name: other\ndescription: d\n',
      'recipe/notes.txt': 'ignored',
      'recipe/old.yml': 'name: old\ndescription: ignored\n',
    });
    const { items, errors } = await listRecipes(dir);
    expect(items.map((i) => i.slug)).toEqual(['alpha', 'zeta']);
    expect(items[0]?.recipe.contexts).toEqual(['x']);
    expect(errors.map((e) => e.file)).toEqual(['recipe/broken.yaml', 'recipe/mismatch.yaml']);
    expect(errors.every((e) => e.message.length > 0)).toBe(true);
  });
});

describe('unused-path guard', () => {
  it('does not touch directories outside the data dir', async () => {
    const dir = tmp.make();
    mkdirSync(path.join(dir, 'recipe'));
    writeFileSync(path.join(dir, 'recipe', 'keep.yaml'), 'name: keep\ndescription: d\n');
    await expect(readRecipe('../keep', dir)).rejects.toBeInstanceOf(RecipeIoError);
  });
});
