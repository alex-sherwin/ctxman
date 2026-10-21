// PURE (no fs; browser-safe): the query parameters and path keys of the agent history routes
// (src/pages/api/agent-sessions/*, src/pages/api/agent-plans/*; concepts/agent-history.md).
import { AGENT_IDS, isAgentId } from './types.ts';
import type { AgentId, SessionMarkdownOptions } from './types.ts';

export type ParamResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: 'bad-agent'; message: string };

/** `agent` (absent or blank = every agent) */
export function agentParam(params: URLSearchParams): ParamResult<AgentId | undefined> {
  const raw = params.get('agent');
  if (raw === null || raw.trim() === '') return { ok: true, value: undefined };
  if (!isAgentId(raw)) {
    return {
      ok: false,
      error: 'bad-agent',
      message: `agent must be one of ${AGENT_IDS.join(', ')} (or absent for all)`,
    };
  }
  return { ok: true, value: raw };
}

/** A non-negative integer parameter, else `fallback` (a bad value never fails the request). */
function intParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return fallback;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) ? value : fallback;
}

export interface SessionListParams {
  agent?: AgentId;
  q?: string;
  offset: number;
  limit: number;
}

/** `GET /api/agent-sessions?agent=&q=&offset=&limit=` (limit 1..200, default 50; offset default 0). */
export function sessionListParams(params: URLSearchParams): ParamResult<SessionListParams> {
  const agent = agentParam(params);
  if (!agent.ok) return agent;
  const q = params.get('q')?.trim() ?? '';
  const value: SessionListParams = {
    offset: intParam(params, 'offset', 0),
    limit: Math.min(200, Math.max(1, intParam(params, 'limit', 50))),
  };
  if (agent.value !== undefined) value.agent = agent.value;
  if (q !== '') value.q = q;
  return { ok: true, value };
}

/** `GET /api/agent-plans?agent=&q=` */
export function planListParams(
  params: URLSearchParams,
): ParamResult<{ agent?: AgentId; q?: string }> {
  const agent = agentParam(params);
  if (!agent.ok) return agent;
  const q = params.get('q')?.trim() ?? '';
  const value: { agent?: AgentId; q?: string } = {};
  if (agent.value !== undefined) value.agent = agent.value;
  if (q !== '') value.q = q;
  return { ok: true, value };
}

const flag = (raw: string | null, fallback: boolean): boolean =>
  raw === null
    ? fallback
    : raw === '1' || raw === 'true'
      ? true
      : raw === '0' || raw === 'false'
        ? false
        : fallback;

/** `tools=1|0` (default 1), `thinking=1|0` (default 0). */
export function sessionOptionsParams(params: URLSearchParams): SessionMarkdownOptions {
  return { tools: flag(params.get('tools'), true), thinking: flag(params.get('thinking'), false) };
}

/**
 * The key of a `[key]` route param. Clients send it as one `encodeURIComponent` segment (`claude-code%3Aabc`); the
 * router may hand it over decoded or not, so a still-encoded value is decoded once.
 */
export function keyParam(raw: string | undefined): string {
  const value = raw ?? '';
  if (!value.includes('%')) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
