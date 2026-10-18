// GET|PUT /api/doc/<dataset>/<slug>/<...path>: read / save ONE existing markdown file of an okf bundle or
// skill directory (ROUND2_BACKEND_SPEC §A.4). `path` is the bundle-relative posix path, each segment
// URI-encoded by the client.
//   GET  200 { path, markdown, lastModified, bytes, warnings }
//   PUT  body { markdown, ifUnmodifiedSince? } -> 200 { path, bytes, lastModified, warnings }
//   400 bad-dataset | bad-slug | bad-path | bad-json | invalid (issues), 403 forbidden-origin, 404 not-found,
//   405, 409 conflict ({ error, message, lastModified }), 413 too-large, 415, 422 not-text, 500 internal.
// PUT saves even when the validators report problems: they come back as `warnings` (pnpm run check stays the gate).
import type { APIRoute } from 'astro';
import { readDoc, writeDoc } from '../../../../../lib/doc-io.ts';
import { docErrorResponse, json, methodNotAllowed, readJson } from '../../../../../lib/http.ts';

export const GET: APIRoute = async ({ params }) => {
  try {
    const doc = await readDoc(params.dataset ?? '', params.slug ?? '', params.path);
    return json({
      path: doc.path,
      markdown: doc.markdown,
      lastModified: doc.lastModified,
      bytes: doc.bytes,
      warnings: doc.warnings,
    });
  } catch (error) {
    return docErrorResponse(error);
  }
};

export const PUT: APIRoute = async ({ params, request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const doc = await writeDoc(params.dataset ?? '', params.slug ?? '', params.path, body.value);
    return json({
      path: doc.path,
      bytes: doc.bytes,
      lastModified: doc.lastModified,
      warnings: doc.warnings,
    });
  } catch (error) {
    return docErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PUT']);
