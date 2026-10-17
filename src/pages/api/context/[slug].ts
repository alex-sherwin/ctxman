// GET|PUT|DELETE /api/context/:slug. PLAN §G.
//   GET    200 { context, lastModified } | 400 bad-slug | 404 not-found | 422 invalid-file (issues)
//   PUT    body ContextDoc (name must equal :slug) -> 200 { context, lastModified }
//          | 400 invalid (issues) / name-mismatch / bad-json / bad-slug | 404 | 415 | 403
//   DELETE 204 | 400 bad-slug | 404 | 403
import type { APIRoute } from 'astro';
import { isValidName } from '../../../datasets/registry.ts';
import { deleteContext, readContext, writeContext } from '../../../lib/context-io.ts';
import {
  apiError,
  checkOrigin,
  contextErrorResponse,
  json,
  methodNotAllowed,
  noContent,
  readJson,
} from '../../../lib/http.ts';

/** The :slug param, or the 400 response for an invalid one (path traversal never reaches fs). */
function slugOf(params: Record<string, string | undefined>): string | Response {
  const slug = params.slug;
  if (slug === undefined || !isValidName(slug)) {
    return apiError(
      400,
      'bad-slug',
      `"${slug ?? ''}" is not a valid context name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return slug;
}

export const GET: APIRoute = async ({ params }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  try {
    const record = await readContext(slug);
    return json({ context: record.context, lastModified: record.lastModified });
  } catch (error) {
    return contextErrorResponse(error, 'read');
  }
};

export const PUT: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await writeContext(slug, body.value);
    return json({ context: record.context, lastModified: record.lastModified });
  } catch (error) {
    return contextErrorResponse(error, 'write');
  }
};

export const DELETE: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return forbidden;
  try {
    await deleteContext(slug);
    return noContent();
  } catch (error) {
    return contextErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PUT', 'DELETE']);
