// POST /api/inflate/plan  body { recipe, overrides? } -> 200 DirPlanResponse { dir, dirInput, contextFile, dirState,
// blocking, steps, warnings, document, applied } | 400 invalid (issues) / bad-json | 415 | 403 | 405 | 500.
// The dry run of a working-directory run (plans/INFLATE_V2_SPEC.md §10): nothing is written.
import type { APIRoute } from 'astro';
import { apiError, internalError, json, methodNotAllowed, readJson } from '../../../lib/http.ts';
import { planInflateDir, toDirPlanResponse } from '../../../lib/inflate/dir-plan.ts';
import { parseRunRequest } from '../../../lib/inflate/recipe.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  const parsed = parseRunRequest(body.value);
  if (!parsed.ok) {
    return apiError(400, 'invalid', 'request does not match the schema', parsed.issues);
  }
  try {
    const result = await planInflateDir({
      recipe: parsed.recipe,
      overrides: parsed.overrides,
      now: new Date(),
    });
    return json(toDirPlanResponse(result));
  } catch (error) {
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
