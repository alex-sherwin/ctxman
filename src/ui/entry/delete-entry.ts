// Browser-only, Monaco-free: delete one entry of ANY dataset. `deleteEndpoint` and `deleteSummary` are PURE
// (testable without a DOM); `deleteEntry` is the DELETE call (never throws, like `sendJson`).
import { datasetDef, isDatasetId } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { failureText, sendJson } from '../edit/api.ts';

/**
 * The DELETE endpoint of an entry: `/api/entry/<ds>/<slug>` for okf bundles and skills (the whole folder),
 * `/api/<ds>/<slug>` for the yaml datasets (reference, context, recipe).
 */
export function deleteEndpoint(dataset: DatasetId, slug: string): string {
  const slugPart = encodeURIComponent(slug);
  return datasetDef(dataset).kind === 'data'
    ? `/api/${dataset}/${slugPart}`
    : `/api/entry/${dataset}/${slugPart}`;
}

/** What a delete removes, for the confirmation dialog. */
export function deleteSummary(dataset: DatasetId, slug: string): string {
  return datasetDef(dataset).kind === 'data'
    ? `This removes ${dataset}/${slug}.yaml.`
    : `This removes the whole folder ${dataset}/${slug} and every file in it.`;
}

export type DeleteResult = { ok: true } | { ok: false; failure: string };

export async function deleteEntry(dataset: string, slug: string): Promise<DeleteResult> {
  if (!isDatasetId(dataset)) return { ok: false, failure: `"${dataset}" is not a dataset` };
  const res = await sendJson<null>('DELETE', deleteEndpoint(dataset, slug));
  return res.ok ? { ok: true } : { ok: false, failure: failureText(res) };
}
