// POST /api/snippet  body SnippetInput -> 201 { snippet, lastModified } + Location: /snippet/<name>
// 400 invalid (issues) | bad-json, 409 exists, 415, 403. ROUND2_BACKEND_SPEC §C.3. Snippets are read/written with
// snippet-io.ts (fs + schema validation) at request time.
import type { APIRoute } from 'astro';
import { json, methodNotAllowed, readJson, snippetErrorResponse } from '../../../lib/http.ts';
import { createSnippet } from '../../../lib/snippet-io.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await createSnippet(body.value);
    return json({ snippet: record.snippet, lastModified: record.lastModified }, 201, {
      location: `/snippet/${record.slug}`,
    });
  } catch (error) {
    return snippetErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
