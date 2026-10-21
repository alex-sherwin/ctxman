// GET|PATCH|DELETE /api/entry/<dataset>/<slug>: the frontmatter of an okf / skill entry (ROUND3_SPEC §D.1).
//   GET    200 { frontmatter, lastModified, issues }   (JSON-safe frontmatter; issues = schema problems, may be non-empty)
//   PATCH  body { state?, title?, description?, issueKey?, tags?, time? | addTime?, resolved?, stale_after?, status?,
//          links? | addLinks?/removeLinks?, ifUnmodifiedSince? } -> 200 { frontmatter, lastModified, changed, warnings }
//          (`issueKey`: okf only, one word; `time`: ISO 8601 durations, `addTime`: durations appended to it,
//          `resolved`: an ISO 8601 date / date-time; time keys task, feature, bug, rca only; null deletes)
//   DELETE 204 (removes the whole entry folder) | 400 bad-dataset / bad-slug | 403 | 404 not-found
//   400 bad-dataset | bad-slug | bad-json | invalid (issues; also when the PATCHED frontmatter fails the schema:
//   nothing is written), 403 forbidden-origin, 404 not-found, 405, 409 conflict ({ error, message, lastModified }),
//   415, 422 invalid-file (issues), 500 internal.
// Only the given keys are edited, by source range (src/lib/frontmatter-patch.ts); every other byte of the file stays.
import type { APIRoute } from 'astro';
import {
  checkOrigin,
  entryErrorResponse,
  json,
  methodNotAllowed,
  noContent,
  readJson,
} from '../../../../lib/http.ts';
import { deleteEntry, patchEntry, readEntry } from '../../../../lib/entry-io.ts';

export const GET: APIRoute = async ({ params }) => {
  try {
    const entry = await readEntry(params.dataset ?? '', params.slug ?? '');
    return json({
      frontmatter: entry.frontmatter,
      lastModified: entry.lastModified,
      issues: entry.issues,
    });
  } catch (error) {
    return entryErrorResponse(error);
  }
};

export const PATCH: APIRoute = async ({ params, request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const entry = await patchEntry(params.dataset ?? '', params.slug ?? '', body.value);
    return json({
      frontmatter: entry.frontmatter,
      lastModified: entry.lastModified,
      changed: entry.changed,
      warnings: entry.warnings,
    });
  } catch (error) {
    return entryErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ params, request, url }) => {
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return forbidden;
  try {
    await deleteEntry(params.dataset ?? '', params.slug ?? '');
    return noContent();
  } catch (error) {
    return entryErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PATCH', 'DELETE']);
