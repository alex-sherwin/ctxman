// POST /api/agent-plans/import, body AgentPlanImportBody `{key, dataset, slug, path, title?}` -> 201 AgentImported
// `{path, url, lastModified, warnings}` (+ `location`): the plan written as a new `type: plan` concept of an okf bundle
// (doc-io#createDocFile). Same errors as POST /api/agent-sessions/import.
import type { APIRoute } from 'astro';
import { importAgentPlan } from '../../../lib/agent-history/import.ts';
import { agentErrorResponse, json, methodNotAllowed, readJson } from '../../../lib/http.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const imported = await importAgentPlan(body.value);
    return json(imported, 201, { location: imported.url });
  } catch (error) {
    return agentErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
