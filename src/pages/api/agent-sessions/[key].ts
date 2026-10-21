// GET /api/agent-sessions/<key>?tools=1|0&thinking=1|0 -> 200 AgentSessionDetail (src/lib/agent-history/types.ts): the
// summary, the markdown file an import writes (tool calls on, thinking off by default), its body rendered like a doc
// page, `truncated` and the suggested bundle path. The key (`<source>:<id>`, sent as one encodeURIComponent segment)
// is resolved by listing its source again, never as a path. 400 bad-key, 404 not-found, 413 too-large (over 256 MB).
// `/api/agent-sessions/import` is its own static route (Astro prefers it over this one).
import type { APIRoute } from 'astro';
import { keyParam, sessionOptionsParams } from '../../../lib/agent-history/query.ts';
import { agentSessionDetail } from '../../../lib/agent-history/sessions.ts';
import { agentErrorResponse, json, methodNotAllowed } from '../../../lib/http.ts';

export const GET: APIRoute = async ({ params, url }) => {
  try {
    return json(
      await agentSessionDetail(keyParam(params.key), sessionOptionsParams(url.searchParams)),
    );
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
