// POST /api/agent-sessions/import, body AgentSessionImportBody `{key, dataset, slug, path, title?, tools?, thinking?}`
// -> 201 AgentImported `{path, url, lastModified, warnings}` (+ `location`): the session written as a new
// `type: agent-session` concept of an okf bundle (doc-io#createDocFile: never overwrites, listed in index.md and an
// existing log.md). `title` (only when the user changed it) replaces the session's own. 400 invalid / bad-key /
// bad-dataset / bad-slug / bad-path / bad-json, 403 forbidden-origin, 404 not-found (session or entry), 409 exists,
// 413 too-large, 415.
import type { APIRoute } from 'astro';
import { importAgentSession } from '../../../lib/agent-history/import.ts';
import { agentErrorResponse, json, methodNotAllowed, readJson } from '../../../lib/http.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const imported = await importAgentSession(body.value);
    return json(imported, 201, { location: imported.url });
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
