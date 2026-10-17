// GET /api/search-index.json -> 200 { generatedAt, docs: SearchDoc[] }; recomputed per request. PLAN §G.
import type { APIRoute } from 'astro';
import { buildSearchIndex } from '../../lib/entries.ts';
import { internalError, json, methodNotAllowed } from '../../lib/http.ts';

export const GET: APIRoute = async () => {
  try {
    return json(await buildSearchIndex());
  } catch (error) {
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
