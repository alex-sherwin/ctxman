// Browser-safe (fetch only): typed wrappers over `src/ui/edit/api.ts` for the agent history routes the Import session
// / Import plan dialogs call (plans/AGENT_HISTORY_SPEC.md §6). Like `getJson` / `sendJson` they never throw: a failure
// is `{ ok: false, status, error, message, issues? }` (status 0 = network or aborted). The URL builders are PURE and
// unit-tested (tests/unit/agent-dialog-helpers.test.ts).
import type {
  AgentId,
  AgentImported,
  AgentPlanDetail,
  AgentPlanImportBody,
  AgentPlanList,
  AgentSessionDetail,
  AgentSessionImportBody,
  AgentSessionList,
  SessionMarkdownOptions,
} from '../../lib/agent-history/types.ts';
import { getJson, sendJson } from '../edit/api.ts';
import type { ApiResult } from '../edit/api.ts';

/** The agent chip of a dialog: one agent, or every agent. */
export type AgentFilter = AgentId | 'all';

/** One page of `GET /api/agent-sessions` (the server's default page size is 50, its maximum 200). */
export const SESSION_PAGE_SIZE = 50;

export interface SessionListQuery {
  agent: AgentFilter;
  /** Server search: every whitespace token must match (blank = no filter). */
  q: string;
  offset: number;
  limit: number;
}

export interface PlanListQuery {
  agent: AgentFilter;
  q: string;
}

/** `?agent=&q=` of both list routes: `all` and a blank `q` are left out. */
function filterParams(agent: AgentFilter, q: string): URLSearchParams {
  const params = new URLSearchParams();
  if (agent !== 'all') params.set('agent', agent);
  const query = q.trim();
  if (query !== '') params.set('q', query);
  return params;
}

const withQuery = (path: string, params: URLSearchParams): string => {
  const qs = params.toString();
  return qs === '' ? path : `${path}?${qs}`;
};

/** `GET /api/agent-sessions?agent=&q=&offset=&limit=` (offset 0 is left out). */
export function sessionListUrl({ agent, q, offset, limit }: SessionListQuery): string {
  const params = filterParams(agent, q);
  if (offset > 0) params.set('offset', String(offset));
  params.set('limit', String(limit));
  return withQuery('/api/agent-sessions', params);
}

/** `GET /api/agent-sessions/<key>?tools=1|0&thinking=1|0`: the key is ONE path segment (`:` and `.` encoded). */
export function sessionUrl(key: string, options: SessionMarkdownOptions): string {
  const params = new URLSearchParams({
    tools: options.tools ? '1' : '0',
    thinking: options.thinking ? '1' : '0',
  });
  return withQuery(`/api/agent-sessions/${encodeURIComponent(key)}`, params);
}

/** `GET /api/agent-plans?agent=&q=`. */
export function planListUrl({ agent, q }: PlanListQuery): string {
  return withQuery('/api/agent-plans', filterParams(agent, q));
}

/** `GET /api/agent-plans/<key>`. */
export function planUrl(key: string): string {
  return `/api/agent-plans/${encodeURIComponent(key)}`;
}

export const SESSION_IMPORT_URL = '/api/agent-sessions/import';
export const PLAN_IMPORT_URL = '/api/agent-plans/import';

export function listSessions(
  query: SessionListQuery,
  signal?: AbortSignal,
): Promise<ApiResult<AgentSessionList>> {
  return getJson<AgentSessionList>(sessionListUrl(query), signal);
}

export function getSession(
  key: string,
  options: SessionMarkdownOptions,
  signal?: AbortSignal,
): Promise<ApiResult<AgentSessionDetail>> {
  return getJson<AgentSessionDetail>(sessionUrl(key, options), signal);
}

/** 201 `AgentImported`; 409 `exists` when the path is taken. */
export function importSession(body: AgentSessionImportBody): Promise<ApiResult<AgentImported>> {
  return sendJson<AgentImported>('POST', SESSION_IMPORT_URL, body);
}

export function listPlans(
  query: PlanListQuery,
  signal?: AbortSignal,
): Promise<ApiResult<AgentPlanList>> {
  return getJson<AgentPlanList>(planListUrl(query), signal);
}

export function getPlan(key: string, signal?: AbortSignal): Promise<ApiResult<AgentPlanDetail>> {
  return getJson<AgentPlanDetail>(planUrl(key), signal);
}

/** 201 `AgentImported`; 409 `exists` when the path is taken. */
export function importPlan(body: AgentPlanImportBody): Promise<ApiResult<AgentImported>> {
  return sendJson<AgentImported>('POST', PLAN_IMPORT_URL, body);
}
