// NODE: runtime read/write of data/recipe/<slug>.yaml, a mirror of context-io.ts. Recipes are ALWAYS read
// through this module (fs + zod) at request time, never through getCollection('recipe'): that collection
// has no watcher and exists only for schema validation (plans/INFLATE_SPEC.md §7.1).
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isValidName } from '../datasets/registry.ts';
import type { RecipeData } from '../datasets/schemas.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { parseRecipe, serializeRecipe } from './inflate/recipe.ts';
import type { RecipeIssue } from './inflate/recipe.ts';
import { parseYaml } from './yaml.ts';

export interface RecipeRecord {
  slug: string;
  recipe: RecipeData;
  /** ISO mtime of the file. */
  lastModified: string;
  /** Data-dir-relative path: 'recipe/<slug>.yaml'. */
  file: string;
}

export class RecipeIoError extends Error {
  code: 'not-found' | 'exists' | 'invalid' | 'bad-slug' | 'name-mismatch' | 'parse';
  issues: RecipeIssue[];
  constructor(code: RecipeIoError['code'], message: string, issues: RecipeIssue[] = []) {
    super(message);
    this.name = 'RecipeIoError';
    this.code = code;
    this.issues = issues;
  }
}

/** Absolute path of data/recipe/<slug>.yaml; throws `bad-slug` unless the slug is a valid entry name. */
export function recipeFile(slug: string, dataDir: string = resolveDataDir()): string {
  if (!isValidName(slug)) {
    throw new RecipeIoError(
      'bad-slug',
      `"${slug}" is not a valid recipe name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return path.join(datasetDir('recipe', dataDir), `${slug}.yaml`);
}

const fileRel = (slug: string): string => `recipe/${slug}.yaml`;

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

/** Validates an untrusted recipe document against `recipeSchema` and requires `name === slug`. */
export function validateRecipe(input: unknown, slug: string): ReturnType<typeof parseRecipe> {
  return parseRecipe(input, slug);
}

async function recordFor(slug: string, abs: string, recipe: RecipeData): Promise<RecipeRecord> {
  const st = await stat(abs);
  return { slug, recipe, lastModified: st.mtime.toISOString(), file: fileRel(slug) };
}

function parseRecipeSource(source: string, slug: string): RecipeData {
  let value: unknown;
  try {
    value = parseYaml(source);
  } catch (error) {
    throw new RecipeIoError(
      'parse',
      `${fileRel(slug)}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`,
    );
  }
  const result = validateRecipe(value ?? {}, slug);
  if (!result.ok) {
    throw new RecipeIoError(
      'invalid',
      `${fileRel(slug)} does not match the recipe schema`,
      result.issues,
    );
  }
  return result.recipe;
}

/** Reads one recipe. Throws `not-found`, `parse` (bad YAML) or `invalid` (schema / name != stem). */
export async function readRecipe(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<RecipeRecord> {
  const abs = recipeFile(slug, dataDir);
  let source: string;
  try {
    source = await readFile(abs, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') {
      throw new RecipeIoError('not-found', `recipe "${slug}" does not exist`);
    }
    throw error;
  }
  return recordFor(slug, abs, parseRecipeSource(source, slug));
}

/** Every recipe, sorted by slug. Files that fail to parse/validate are reported in `errors`, not thrown. */
export async function listRecipes(
  dataDir: string = resolveDataDir(),
): Promise<{ items: RecipeRecord[]; errors: { file: string; message: string }[] }> {
  const items: RecipeRecord[] = [];
  const errors: { file: string; message: string }[] = [];
  let names: string[];
  try {
    names = (await readdir(datasetDir('recipe', dataDir)))
      .filter((f) => f.endsWith('.yaml'))
      .sort();
  } catch {
    return { items, errors };
  }
  for (const name of names) {
    const slug = name.slice(0, -'.yaml'.length);
    try {
      items.push(await readRecipe(slug, dataDir));
    } catch (error) {
      const message =
        error instanceof RecipeIoError && error.issues.length > 0
          ? `${error.message}: ${error.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ')}`
          : error instanceof Error
            ? error.message
            : String(error);
      errors.push({ file: fileRel(slug), message });
    }
  }
  items.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { items, errors };
}

/** Creates recipe/<input.name>.yaml. Throws `invalid` (schema), `exists` (never overwrites). */
export async function createRecipe(
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<RecipeRecord> {
  const parsed = parseRecipe(input);
  if (!parsed.ok) {
    throw new RecipeIoError('invalid', 'recipe does not match the schema', parsed.issues);
  }
  const recipe = parsed.recipe;
  const slug = recipe.name;
  const abs = recipeFile(slug, dataDir);
  await mkdir(path.dirname(abs), { recursive: true });
  try {
    await writeFile(abs, serializeRecipe(recipe), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (errorCode(error) === 'EEXIST') {
      throw new RecipeIoError('exists', `recipe "${slug}" already exists`);
    }
    throw error;
  }
  return recordFor(slug, abs, recipe);
}

/**
 * Replaces an existing recipe (PUT). The recipe must exist (`not-found`) and `input.name` must equal
 * `slug` (`name-mismatch`; names are immutable). Written atomically: temp file in the same dir, then rename.
 */
export async function writeRecipe(
  slug: string,
  input: unknown,
  dataDir: string = resolveDataDir(),
): Promise<RecipeRecord> {
  const abs = recipeFile(slug, dataDir);
  try {
    await stat(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new RecipeIoError('not-found', `recipe "${slug}" does not exist`);
    }
    throw error;
  }
  const result = validateRecipe(input, slug);
  if (!result.ok) {
    throw new RecipeIoError(
      result.code,
      result.code === 'invalid'
        ? 'recipe does not match the schema'
        : `recipe name cannot be changed (expected "${slug}")`,
      result.issues,
    );
  }
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, serializeRecipe(result.recipe), 'utf8');
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return recordFor(slug, abs, result.recipe);
}

/** Deletes a recipe file; `not-found` if it does not exist. */
export async function deleteRecipe(
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<void> {
  const abs = recipeFile(slug, dataDir);
  try {
    await unlink(abs);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      throw new RecipeIoError('not-found', `recipe "${slug}" does not exist`);
    }
    throw error;
  }
}
