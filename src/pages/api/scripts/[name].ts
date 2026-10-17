// POST /api/scripts/:name  body {} (check scripts) | { dataset, name, description, title? } (add)
// -> 200 { code, stdout, stderr, durationMs, created? } (200 even when code !== 0)
// | 404 unknown-script | 400 invalid (issues) / bad-json | 415 | 403. PLAN §G, UI_SPEC §0.5.
// Only names in src/lib/scripts-allowlist.ts run; they spawn `node scripts/<file>.ts` with no shell.
import type { APIRoute } from 'astro';
import { apiError, internalError, json, methodNotAllowed, readJson } from '../../../lib/http.ts';
import { executeScript } from '../../../lib/run-script.ts';
import { getScript } from '../../../lib/scripts-allowlist.ts';

export const POST: APIRoute = async ({ params, request, url }) => {
  const def = params.name === undefined ? undefined : getScript(params.name);
  if (def === undefined) {
    return apiError(404, 'unknown-script', `"${params.name ?? ''}" is not an allowlisted script`);
  }
  const body = await readJson(request, url, { allowEmpty: def.kind === 'check' });
  if (!body.ok) return body.response;
  try {
    const run = await executeScript(def.name, body.value);
    if (!run.ok) {
      return apiError(400, 'invalid', 'request body does not match the script', run.issues);
    }
    return json(run.result);
  } catch (error) {
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
