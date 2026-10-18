// POST /api/context  body ContextDoc -> 201 { context } + Location: /context/<name>
// 400 invalid (issues) | bad-json, 409 exists, 415, 403. PLAN §G. Contexts are read/written with
// context-io.ts (fs + schema validation) at request time.
import type { APIRoute } from 'astro';
import { createContext } from '../../../lib/context-io.ts';
import { contextErrorResponse, json, methodNotAllowed, readJson } from '../../../lib/http.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await createContext(body.value);
    return json({ context: record.context, lastModified: record.lastModified }, 201, {
      location: `/context/${record.slug}`,
    });
  } catch (error) {
    return contextErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
