// POST /api/inflate/jobs/:id/cancel -> 200 { job } (running with cancelRequested, or cancelled) | 400 bad-id / bad-json
// | 403 | 404 not-found | 409 not-running | 415 (plans/INFLATE_V2_SPEC.md §10). The body is empty or `{}`.
import type { APIRoute } from 'astro';
import { apiError, json, methodNotAllowed, readJson } from '../../../../../lib/http.ts';
import { JOB_ID_PATTERN, jobStore } from '../../../../../lib/inflate/jobs.ts';

export const POST: APIRoute = async ({ params, request, url }) => {
  const body = await readJson(request, url, { allowEmpty: true });
  if (!body.ok) return body.response;
  const value = body.value;
  if (
    value !== undefined &&
    (value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length > 0)
  ) {
    return apiError(400, 'invalid', 'the body must be empty or {}');
  }
  const id = params.id ?? '';
  if (!JOB_ID_PATTERN.test(id)) return apiError(400, 'bad-id', 'the job id is not valid');
  const store = jobStore();
  const outcome = store.cancel(id);
  if (outcome === 'not-found') {
    return apiError(404, 'not-found', 'this run is no longer known to the server');
  }
  if (outcome === 'not-running') {
    return apiError(409, 'not-running', 'this run has already finished');
  }
  return json({ job: store.get(id) });
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
