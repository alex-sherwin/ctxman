// GET|PUT|POST|DELETE /api/doc/<dataset>/<slug>/<...path>: read / save ONE existing markdown file of an okf bundle or
// skill directory (ROUND2_BACKEND_SPEC §A.4), create a new file at any path of an okf bundle (ROUND3_SPEC §D.3) and
// delete one. `path` is the bundle-relative posix path, each segment URI-encoded by the client.
//   GET  200 { path, markdown, lastModified, bytes, warnings }
//   PUT  body { markdown, ifUnmodifiedSince? } -> 200 { path, bytes, lastModified, warnings }
//   POST body { title, type?, description? } -> 201 { path, url, lastModified, warnings }: creates the concept file
//        (okf datasets only; the root index.md (the entry) / nested index.md / log.md are reserved) and lists it in the bundle's root
//        index.md (## Links) and, when the bundle has one, log.md (today; never created here); missing folders of
//        the path are created
//   DELETE -> 200 { path, url, warnings }: removes the file (okf only; not the root index.md, which is the entry: DELETE
//        /api/entry), the folders it leaves empty and its ## Links line in index.md; an existing log.md gets a Delete
//        line. A body, unlike other DELETE routes: `warnings` lists the links that still point at the file; `url` is the
//        entry page.
//   400 bad-dataset | bad-slug | bad-path | bad-json | invalid (issues), 403 forbidden-origin, 404 not-found,
//   405, 409 conflict ({ error, message, lastModified }) | exists, 413 too-large, 415, 422 not-text, 500 internal.
// `warnings` = the file's own findings plus its link problems (links/broken, links/ctxman-target, links/relation-*).
// PUT saves even when the validators report problems: they come back as `warnings` (pnpm run check stays the gate).
import type { APIRoute } from 'astro';
import { createDoc, deleteDoc, readDoc, writeDoc } from '../../../../../lib/doc-io.ts';
import {
  checkOrigin,
  docErrorResponse,
  json,
  methodNotAllowed,
  readJson,
} from '../../../../../lib/http.ts';

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

export const POST: APIRoute = async ({ params, request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const doc = await createDoc(params.dataset ?? '', params.slug ?? '', params.path, body.value);
    return json(
      { path: doc.path, url: doc.url, lastModified: doc.lastModified, warnings: doc.warnings },
      201,
      { location: doc.url },
    );
  } catch (error) {
    return docErrorResponse(error);
  }
};

export const DELETE: APIRoute = async ({ params, request, url }) => {
  const forbidden = checkOrigin(request, url);
  if (forbidden !== null) return forbidden;
  try {
    const deleted = await deleteDoc(params.dataset ?? '', params.slug ?? '', params.path);
    return json({ path: deleted.path, url: deleted.url, warnings: deleted.warnings });
  } catch (error) {
    return docErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET', 'PUT', 'POST', 'DELETE']);
