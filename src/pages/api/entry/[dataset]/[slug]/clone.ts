// POST /api/entry/<dataset>/<slug>/clone: copy the okf bundle <dataset>/<slug> into a NEW entry (src/lib/entry-clone.ts).
//   body { name, description, title?, state?, tags?, issueKey?, links?, children?, time? }  (strict; `title` blank =
//   the name in sentence case, `state` = the dataset default, `tags` / `issueKey` omitted = none; `links` (default
//   true) keeps the related / depends-on links, `children` (default false) the child links, `time` (default false;
//   task, feature, bug, rca only) `time` and `resolved`)
//   -> 201 { dataset, slug, path, url, files, warnings } + Location: /<dataset>/<name>
//   400 bad-dataset (not okf) | bad-slug | bad-json | invalid (issues by field; also when the rewritten frontmatter
//   fails the schema: nothing is written), 403 forbidden-origin, 404 not-found (no such entry), 405, 409 exists (the
//   name is taken), 415, 422 invalid-file (the source index.md is unusable), 500 internal.
// Every regular file and folder is copied (no symlinks), the clone appears atomically or not at all.
import type { APIRoute } from 'astro';
import { cloneEntry } from '../../../../../lib/entry-clone.ts';
import { entryErrorResponse, json, methodNotAllowed, readJson } from '../../../../../lib/http.ts';

export const POST: APIRoute = async ({ params, request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const cloned = await cloneEntry(params.dataset ?? '', params.slug ?? '', body.value);
    return json(cloned, 201, { location: cloned.url });
  } catch (error) {
    return entryErrorResponse(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
