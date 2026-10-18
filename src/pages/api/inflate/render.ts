// POST /api/inflate/render  body RecipeInput (an unsaved recipe is fine) -> 200 { markdown, manifest }
// | 400 invalid (issues) / bad-json | 415 | 403 | 500. INFLATE_SPEC §7.3. Nothing is written to disk.
import type { APIRoute } from 'astro';
import { apiError, internalError, json, methodNotAllowed, readJson } from '../../../lib/http.ts';
import { createFsSources } from '../../../lib/inflate/fs-sources.ts';
import { inflateRecipe } from '../../../lib/inflate/pipeline.ts';
import { parseRecipe } from '../../../lib/inflate/recipe.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  const parsed = parseRecipe(body.value);
  if (!parsed.ok) {
    return apiError(400, 'invalid', 'recipe does not match the schema', parsed.issues);
  }
  try {
    return json(await inflateRecipe(parsed.recipe, createFsSources(), new Date()));
  } catch (error) {
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
