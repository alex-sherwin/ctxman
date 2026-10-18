// POST /api/entry/<dataset>: create a NEW okf / skill entry from the shared templates (ROUND3_SPEC §D.2).
//   body { name, description, title?, state?, tags?, parent? }  (`title`, `state`, `tags`: okf only; `state`: lifecycle
//   datasets only; `parent`: an existing project, which gets a `child` link to the new entry)
//   -> 201 { dataset, slug, path, url, files, parentLinked?, parentError? } + Location: /<dataset>/<slug>
//   400 bad-dataset | bad-json | invalid (issues), 403 forbidden-origin, 405, 409 exists, 415, 500 internal.
// Creates exactly the files `pnpm run add:<dataset> <name>` creates (same validation, same rollback).
import type { APIRoute } from 'astro';
import { createEntry } from '../../../../lib/entry-io.ts';
import { entryErrorResponse, json, methodNotAllowed, readJson } from '../../../../lib/http.ts';

export const POST: APIRoute = async ({ params, request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const created = await createEntry(params.dataset ?? '', body.value);
    return json(created, 201, { location: created.url });
  } catch (error) {
    return entryErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
