// POST /api/context/:slug/links  body { links: { dataset, slug, notes? }[] } (1..200) -> append links to an existing
// context (ROUND3_SPEC §D.5). Targets already linked are skipped and left as they are (notes untouched).
//   200 { context, lastModified, added: string[], skipped: string[] }   (keys 'dataset/slug')
//   400 bad-slug | bad-json | invalid (issues, paths links.N.*), 403 forbidden-origin, 404 not-found, 405, 415,
//   422 invalid-file (the existing file fails to parse / validate), 500 internal.
import type { APIRoute } from 'astro';
import { isValidName } from '../../../../datasets/registry.ts';
import { appendContextLinks } from '../../../../lib/context-io.ts';
import {
  apiError,
  contextErrorResponse,
  json,
  methodNotAllowed,
  readJson,
} from '../../../../lib/http.ts';

export const POST: APIRoute = async ({ params, request, url }) => {
  const slug = params.slug;
  if (slug === undefined || !isValidName(slug)) {
    return apiError(
      400,
      'bad-slug',
      `"${slug ?? ''}" is not a valid context name (lowercase letters, digits and single hyphens, max 64 characters)`,
    );
  }
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const result = await appendContextLinks(slug, body.value);
    return json({
      context: result.record.context,
      lastModified: result.record.lastModified,
      added: result.added,
      skipped: result.skipped,
    });
  } catch (error) {
    return contextErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
