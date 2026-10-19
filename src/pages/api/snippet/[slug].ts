// GET|PUT|DELETE /api/snippet/:slug. ROUND2_BACKEND_SPEC §C.3 (same table as /api/context/:slug).
//   GET    200 { snippet, lastModified } | 400 bad-slug | 404 not-found | 422 invalid-file (issues)
//   PUT    body SnippetInput (name must equal :slug) -> 200 { snippet, lastModified }
//          | 400 invalid (issues) / name-mismatch / bad-json / bad-slug | 404 | 415 | 403
//   DELETE 204 | 400 bad-slug | 404 | 403
import type { APIRoute } from 'astro';
import { isValidName } from '../../../datasets/registry.ts';
import {
  apiError,
  checkOrigin,
  json,
  methodNotAllowed,
  noContent,
  readJson,
  snippetErrorResponse,
} from '../../../lib/http.ts';
import { deleteSnippet, readSnippet, writeSnippet } from '../../../lib/snippet-io.ts';

/** The :slug param, or the 400 response for an invalid one (path traversal never reaches fs). */
function slugOf(params: Record<string, string | undefined>): string | Response {
  const slug = params.slug;
  if (slug === undefined || !isValidName(slug)) {
    return apiError(
      400,
      'bad-slug',
      `"${slug ?? ''}" is not a valid snippet name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return slug;
}

export const GET: APIRoute = async ({ params }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  try {
    const record = await readSnippet(slug);
    return json({ snippet: record.snippet, lastModified: record.lastModified });
  } catch (error) {
    return snippetErrorResponse(error, 'read');
  }
};

export const PUT: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await writeSnippet(slug, body.value);
    return json({ snippet: record.snippet, lastModified: record.lastModified });
  } catch (error) {
    return snippetErrorResponse(error, 'write');
  }
};

export const DELETE: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return forbidden;
  try {
    await deleteSnippet(slug);
    return noContent();
  } catch (error) {
    return snippetErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PUT', 'DELETE']);
