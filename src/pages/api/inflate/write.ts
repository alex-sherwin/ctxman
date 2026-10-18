// POST /api/inflate/write  body { recipe: RecipeInput, path: string } -> 200 { path, bytes, manifest }
// | 400 invalid (issues; recipe issues are prefixed `recipe.`) / bad-path / write-failed / bad-json
// | 415 | 403 | 500. INFLATE_SPEC §7.3. Renders like /api/inflate/render, then writes the markdown to an
// absolute `.md` path (rules in src/lib/inflate/write.ts: not inside node_modules, .git or the data dir).
import type { APIRoute } from 'astro';
import { apiError, internalError, json, methodNotAllowed, readJson } from '../../../lib/http.ts';
import { createFsSources } from '../../../lib/inflate/fs-sources.ts';
import { inflateRecipe } from '../../../lib/inflate/pipeline.ts';
import { parseRecipe } from '../../../lib/inflate/recipe.ts';
import type { InflateResult } from '../../../lib/inflate/render.ts';
import { checkOutputPath, writeOutput } from '../../../lib/inflate/write.ts';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  const recipeInput = isRecord(body.value) ? body.value.recipe : undefined;
  const rawPath = isRecord(body.value) ? body.value.path : undefined;
  if (typeof rawPath !== 'string') {
    return apiError(400, 'invalid', 'request body must be { recipe, path }', [
      { path: 'path', message: 'path must be a string' },
    ]);
  }

  const parsed = parseRecipe(recipeInput);
  if (!parsed.ok) {
    return apiError(
      400,
      'invalid',
      'recipe does not match the schema',
      parsed.issues.map((i) => ({
        path: i.path === '' ? 'recipe' : `recipe.${i.path}`,
        message: i.message,
      })),
    );
  }
  const checked = checkOutputPath(rawPath);
  if (!checked.ok) return apiError(400, 'bad-path', checked.message);

  let result: InflateResult;
  try {
    result = await inflateRecipe(parsed.recipe, createFsSources(), new Date());
  } catch (error) {
    return internalError(error);
  }
  try {
    const written = await writeOutput(checked.path, result.markdown);
    return json({ path: written.path, bytes: written.bytes, manifest: result.manifest });
  } catch (error) {
    return apiError(400, 'write-failed', error instanceof Error ? error.message : String(error));
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
