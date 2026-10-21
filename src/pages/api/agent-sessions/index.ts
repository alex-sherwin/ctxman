// GET /api/agent-sessions?agent=<AgentId>&q=&offset=&limit= -> 200 AgentSessionList (src/lib/agent-history/types.ts):
// the sessions of Claude Code, Codex and GitHub Copilot (CLI + VS Code) newest first, sessions without a prompt left
// out, `next` = the offset of the next page (null at the end), `sources` = where ctxman looked. limit 1..200 (default
// 50). 400 bad-agent. Read-only on the agent dirs (concepts/agent-history.md).
import type { APIRoute } from 'astro';
import { sessionListParams } from '../../../lib/agent-history/query.ts';
import { listAgentSessions } from '../../../lib/agent-history/sessions.ts';
import { agentErrorResponse, apiError, json, methodNotAllowed } from '../../../lib/http.ts';

export const GET: APIRoute = async ({ url }) => {
  const params = sessionListParams(url.searchParams);
  if (!params.ok) return apiError(400, params.error, params.message);
  try {
    return json(await listAgentSessions(params.value));
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
