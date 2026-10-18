// GET /api/schemas/:dataset  -> 200 the committed JSON Schema of a YAML dataset (reference | context | recipe)
// as `application/schema+json` (`:dataset` may carry a `.schema.json` suffix); 404 `unknown-dataset`; 500
// `schema-missing` (run `pnpm run gen:schemas`). The `# yaml-language-server: $schema=` modeline of every YAML data
// file points here, so the response allows any origin. In-browser editors import schemas/*.json statically.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { APIRoute } from 'astro';
import { resolveSchemasDir } from '../../../lib/data-dir.ts';
import { apiError, internalError, methodNotAllowed } from '../../../lib/http.ts';
import { isSchemaDatasetId, SCHEMA_DATASETS, schemaFileName } from '../../../lib/schema-comment.ts';

export const GET: APIRoute = async ({ params }) => {
  const raw = params.dataset;
  const dataset = raw?.endsWith('.schema.json') ? raw.slice(0, -'.schema.json'.length) : raw;
  if (!isSchemaDatasetId(dataset)) {
    return apiError(
      404,
      'unknown-dataset',
      `no JSON Schema for "${String(dataset)}"; use one of: ${SCHEMA_DATASETS.join(', ')}`,
    );
  }
  try {
    const text = await readFile(path.join(resolveSchemasDir(), schemaFileName(dataset)), 'utf8');
    return new Response(text, {
      status: 200,
      headers: {
        'content-type': 'application/schema+json; charset=utf-8',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return apiError(
        500,
        'schema-missing',
        `schemas/${schemaFileName(dataset)} does not exist; run pnpm run gen:schemas`,
      );
    }
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
