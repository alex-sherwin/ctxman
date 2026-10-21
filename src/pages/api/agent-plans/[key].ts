// GET /api/agent-plans/<key> -> 200 AgentPlanDetail (src/lib/agent-history/types.ts): the summary, the markdown file
// an import writes, its body rendered like a doc page and the suggested bundle path. The key (`<source>:<id>`, one
// encodeURIComponent segment) is resolved by listing its source again. 400 bad-key, 404 not-found, 413 too-large
// (over 1 MB). `/api/agent-plans/import` is its own static route.
import type { APIRoute } from 'astro';
import { agentPlanDetail } from '../../../lib/agent-history/plans.ts';
import { keyParam } from '../../../lib/agent-history/query.ts';
import { agentErrorResponse, json, methodNotAllowed } from '../../../lib/http.ts';

export const GET: APIRoute = async ({ params }) => {
  try {
    return json(await agentPlanDetail(keyParam(params.key)));
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
