// GET|PUT|DELETE /api/recipe/:slug. INFLATE_SPEC §7.3 (same table as /api/context/:slug).
//   GET    200 { recipe, lastModified } | 400 bad-slug | 404 not-found | 422 invalid-file (issues)
//   PUT    body RecipeInput (name must equal :slug) -> 200 { recipe, lastModified }
//          | 400 invalid (issues) / name-mismatch / bad-json / bad-slug | 404 | 415 | 403
//   DELETE 204 | 400 bad-slug | 404 | 403
import type { APIRoute } from 'astro';
import { isValidName } from '../../../datasets/registry.ts';
import {
  apiError,
  checkOrigin,
  json,
  methodNotAllowed,
  noContent,
  readJson,
  recipeErrorResponse,
} from '../../../lib/http.ts';
import { deleteRecipe, readRecipe, writeRecipe } from '../../../lib/recipe-io.ts';

/** The :slug param, or the 400 response for an invalid one (path traversal never reaches fs). */
function slugOf(params: Record<string, string | undefined>): string | Response {
  const slug = params.slug;
  if (slug === undefined || !isValidName(slug)) {
    return apiError(
      400,
      'bad-slug',
      `"${slug ?? ''}" is not a valid recipe name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return slug;
}

export const GET: APIRoute = async ({ params }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  try {
    const record = await readRecipe(slug);
    return json({ recipe: record.recipe, lastModified: record.lastModified });
  } catch (error) {
    return recipeErrorResponse(error, 'read');
  }
};

export const PUT: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await writeRecipe(slug, body.value);
    return json({ recipe: record.recipe, lastModified: record.lastModified });
  } catch (error) {
    return recipeErrorResponse(error, 'write');
  }
};

export const DELETE: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return forbidden;
  try {
    await deleteRecipe(slug);
    return noContent();
  } catch (error) {
    return recipeErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PUT', 'DELETE']);
