// What a Discover tab shows, for the Forge and the Inflate "Add items" pane (ROUND3_SPEC §E.8): one linkable
// dataset, or "All" (every linkable dataset merged). PURE functions over the entries cache (`$entries`), so both
// islands and their stores share one definition of the merged list, its load status and the tab count.
import { LINKABLE_DATASETS } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import { mergeEntries } from '../lib/entry-filter.ts';
import type { DiscoverDataset } from '../lib/url-state.ts';
import type { EntriesState } from './entries.ts';

export type EntriesMap = Partial<Record<DatasetId, EntriesState>>;

const LOADING: EntriesState = { status: 'loading', entries: [] };

/** The datasets behind a tab: itself, or every linkable one for `all`. */
export function datasetsOf(dataset: DiscoverDataset): readonly DatasetId[] {
  return dataset === 'all' ? LINKABLE_DATASETS : [dataset];
}

/** The datasets of the tab whose last load failed. */
export function failedDatasets(map: EntriesMap, dataset: DiscoverDataset): DatasetId[] {
  return datasetsOf(dataset).filter((ds) => map[ds]?.status === 'error');
}

/**
 * Entries + load status of a tab. A single dataset is its cache entry (`loading` while there is none). `all` is
 * the merge of every linkable dataset in registry order: `loading` while any is still loading (the rows that
 * arrived are already in), `error` (with the failed dataset ids in `error`) once nothing is loading and any
 * failed, else `ready`.
 */
export function discoverSource(map: EntriesMap, dataset: DiscoverDataset): EntriesState {
  if (dataset !== 'all') return map[dataset] ?? LOADING;
  const entries = mergeEntries(map, LINKABLE_DATASETS);
  const pending = LINKABLE_DATASETS.some((ds) => {
    const state = map[ds];
    return state === undefined || state.status === 'loading';
  });
  if (pending) return { status: 'loading', entries };
  const failed = failedDatasets(map, dataset);
  if (failed.length > 0) {
    return { status: 'error', entries, error: `Couldn't load ${failed.join(', ')}` };
  }
  return { status: 'ready', entries };
}

/**
 * The count on a tab: `null` ("…") until the first response of every dataset behind it, the number once they are
 * there (a refresh keeps showing the old number), `undefined` (no count) when one of them failed to load.
 */
export function discoverTabCount(
  map: EntriesMap,
  dataset: DiscoverDataset,
): number | null | undefined {
  let total = 0;
  for (const ds of datasetsOf(dataset)) {
    const state = map[ds];
    if (state === undefined || (state.status === 'loading' && state.entries.length === 0)) {
      return null;
    }
    if (state.status === 'error') return undefined;
    total += state.entries.length;
  }
  return total;
}
