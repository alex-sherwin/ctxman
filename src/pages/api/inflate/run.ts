// POST /api/inflate/run  body { recipe, overrides? } -> 202 { jobId, job } + `location: /api/inflate/jobs/<id>`
// | 400 invalid / bad-json / no-dir / bad-dir / dir-not-directory | 409 dir-not-empty / manifest-invalid / busy
// | 415 | 403 | 405 | 500 (plans/INFLATE_V2_SPEC.md §10). Plans like /api/inflate/plan, then starts the steps in
// the background; poll GET /api/inflate/jobs/:id. One run at a time.
import path from 'node:path';
import type { APIRoute } from 'astro';
import { apiError, internalError, json, methodNotAllowed, readJson } from '../../../lib/http.ts';
import { executeDirPlan, planInflateDir } from '../../../lib/inflate/dir-plan.ts';
import { jobStore, stepDelayFor } from '../../../lib/inflate/jobs.ts';
import { parseRunRequest } from '../../../lib/inflate/recipe.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  const parsed = parseRunRequest(body.value);
  if (!parsed.ok) {
    return apiError(400, 'invalid', 'request does not match the schema', parsed.issues);
  }

  const busy = (jobId: string): Response =>
    json({ error: 'busy', message: 'another inflate run is in progress', jobId }, 409);
  // One run at a time: answered before planning, so a second run into the same directory is `busy`
  // (not `dir-not-empty`, which the first run's half-written directory would otherwise cause).
  const running = jobStore().active();
  if (running !== undefined) return busy(running.id);

  try {
    const planned = await planInflateDir({
      recipe: parsed.recipe,
      overrides: parsed.overrides,
      now: new Date(),
    });
    if (planned.dirInput === null) {
      return apiError(400, 'no-dir', 'set output.dir or pass overrides.dir');
    }
    const blocked = planned.blocking[0];
    if (blocked !== undefined) {
      const status = blocked.code === 'bad-dir' || blocked.code === 'dir-not-directory' ? 400 : 409;
      return apiError(status, blocked.code, blocked.message);
    }
    const internal = planned.internal;
    if (internal === undefined || planned.dir === null) {
      return apiError(400, 'no-dir', 'set output.dir or pass overrides.dir');
    }

    const ready = { ...planned, internal };
    const started = jobStore().start({
      recipe: internal.recipe.name,
      dir: internal.dir,
      contextFile: path.join(internal.dir, planned.contextFile),
      steps: planned.steps,
      warnings: planned.warnings,
      async execute(signal, onProgress, info) {
        const outcome = await executeDirPlan(ready, {
          jobId: info.jobId,
          signal,
          onProgress,
          stepDelayMs: stepDelayFor(request.headers),
        });
        return { results: outcome.results, warnings: outcome.warnings };
      },
    });
    if (!started.ok) return busy(started.running.id);
    return json({ jobId: started.job.id, job: started.job }, 202, {
      location: `/api/inflate/jobs/${started.job.id}`,
    });
  } catch (error) {
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
