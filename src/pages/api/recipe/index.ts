// POST /api/recipe  body RecipeInput -> 201 { recipe, lastModified } + Location: /recipe/<name>
// 400 invalid (issues) | bad-json, 409 exists, 415, 403. INFLATE_SPEC §7.3. Recipes are read/written with
// recipe-io.ts (fs + schema validation) at request time.
import type { APIRoute } from 'astro';
import { json, methodNotAllowed, readJson, recipeErrorResponse } from '../../../lib/http.ts';
import { createRecipe } from '../../../lib/recipe-io.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await createRecipe(body.value);
    return json({ recipe: record.recipe, lastModified: record.lastModified }, 201, {
      location: `/recipe/${record.slug}`,
    });
  } catch (error) {
    return recipeErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
