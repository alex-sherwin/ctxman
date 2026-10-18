// GET|PUT|DELETE /api/reference/:slug. ROUND2_BACKEND_SPEC §C.3 (same table as /api/context/:slug).
//   GET    200 { reference, lastModified } | 400 bad-slug | 404 not-found | 422 invalid-file (issues)
//   PUT    body ReferenceInput (name must equal :slug) -> 200 { reference, lastModified }
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
  referenceErrorResponse,
} from '../../../lib/http.ts';
import { deleteReference, readReference, writeReference } from '../../../lib/reference-io.ts';

/** The :slug param, or the 400 response for an invalid one (path traversal never reaches fs). */
function slugOf(params: Record<string, string | undefined>): string | Response {
  const slug = params.slug;
  if (slug === undefined || !isValidName(slug)) {
    return apiError(
      400,
      'bad-slug',
      `"${slug ?? ''}" is not a valid reference name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  return slug;
}

export const GET: APIRoute = async ({ params }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  try {
    const record = await readReference(slug);
    return json({ reference: record.reference, lastModified: record.lastModified });
  } catch (error) {
    return referenceErrorResponse(error, 'read');
  }
};

export const PUT: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await writeReference(slug, body.value);
    return json({ reference: record.reference, lastModified: record.lastModified });
  } catch (error) {
    return referenceErrorResponse(error, 'write');
  }
};

export const DELETE: APIRoute = async ({ params, request, url }) => {
  const slug = slugOf(params);
  if (typeof slug !== 'string') return slug;
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return forbidden;
  try {
    await deleteReference(slug);
    return noContent();
  } catch (error) {
    return referenceErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PUT', 'DELETE']);
