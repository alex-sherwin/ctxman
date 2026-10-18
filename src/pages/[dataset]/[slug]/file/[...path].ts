// GET /<dataset>/<slug>/file/<...path>: the raw bytes of one file of an okf bundle or skill directory (images and
// other files a body links by a bundle-relative path). The logic lives in src/lib/bundle-file.ts.
import type { APIRoute } from 'astro';
import { bundleFileResponse } from '../../../../lib/bundle-file.ts';

export const GET: APIRoute = ({ params, request }) =>
  bundleFileResponse(params.dataset ?? '', params.slug ?? '', params.path, request);
