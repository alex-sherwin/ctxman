// GET /api/inflate/jobs/:id -> 200 InflateJob | 400 bad-id | 404 not-found (plans/INFLATE_V2_SPEC.md §10).
// Jobs live in server memory: after a server restart the id is unknown.
import type { APIRoute } from 'astro';
import { apiError, json, methodNotAllowed } from '../../../../lib/http.ts';
import { JOB_ID_PATTERN, jobStore } from '../../../../lib/inflate/jobs.ts';

export const GET: APIRoute = ({ params }) => {
  const id = params.id ?? '';
  if (!JOB_ID_PATTERN.test(id)) return apiError(400, 'bad-id', 'the job id is not valid');
  const job = jobStore().get(id);
  if (job === undefined) {
    return apiError(404, 'not-found', 'this run is no longer known to the server');
  }
  return json(job);
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
