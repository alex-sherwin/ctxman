// GET /api/entries?dataset=<DatasetId> -> 200 { entries: EntrySummary[] } (unfiltered; clients use
// filterEntries). 400 bad-dataset when the param is missing or not a dataset id. PLAN §G.
import type { APIRoute } from 'astro';
import { DATASET_IDS, isDatasetId } from '../../datasets/registry.ts';
import { listEntries } from '../../lib/entries.ts';
import { apiError, internalError, json, methodNotAllowed } from '../../lib/http.ts';

export const GET: APIRoute = async ({ url }) => {
  const dataset = url.searchParams.get('dataset');
  if (!isDatasetId(dataset)) {
    return apiError(
      400,
      'bad-dataset',
      `query parameter dataset must be one of: ${DATASET_IDS.join(', ')}`,
    );
  }
  try {
    return json({ entries: await listEntries(dataset) });
  } catch (error) {
    return internalError(error);
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['GET']);
