// GET /api/agent-plans?agent=<AgentId>&q= -> 200 AgentPlanList (src/lib/agent-history/types.ts): the plan files of
// Claude Code, Codex and GitHub Copilot newest first (at most 500); `q` matches title, path, thread and the whole text
// (every token, case-insensitive). 400 bad-agent. Read-only on the agent dirs (concepts/agent-history.md).
import type { APIRoute } from 'astro';
import { listAgentPlans } from '../../../lib/agent-history/plans.ts';
import { planListParams } from '../../../lib/agent-history/query.ts';
import { agentErrorResponse, apiError, json, methodNotAllowed } from '../../../lib/http.ts';

export const GET: APIRoute = async ({ url }) => {
  const params = planListParams(url.searchParams);
  if (!params.ok) return apiError(400, params.error, params.message);
  try {
    return json(await listAgentPlans(params.value));
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
