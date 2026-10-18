// Entries cache for the Forge (UI_SPEC §0.6, §H): one `GET /api/entries?dataset=<id>` per dataset, kept in
// a map store and filtered client-side with the shared `filterEntries`. The same cache resolves titles /
// states for the links list and the context Select (dataset `context`). `ensureAllEntries` prefetches every
// linkable dataset (tab counts, link titles); `waitForEntry` polls until a just-created entry is listed;
// `loadAllEntries` is the awaitable form for Monaco's link completion (ROUND3_SPEC §F.2) and the EntryPicker.
import { map } from 'nanostores';
import { DATASET_IDS, LINKABLE_DATASETS } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import type { EntrySummary } from '../lib/entry-summary.ts';
import { getJson } from '../ui/edit/api.ts';

export type EntriesState = {
  status: 'loading' | 'ready' | 'error';
  entries: EntrySummary[];
  error?: string;
};

export const $entries = map<Partial<Record<DatasetId, EntriesState>>>({});

/** In-flight request per dataset (dedupe) and a generation counter so a superseded response is ignored. */
const inflight = new Map<DatasetId, Promise<void>>();
const generation = new Map<DatasetId, number>();

async function fetchEntries(ds: DatasetId): Promise<EntriesState> {
  const res = await getJson<{ entries?: EntrySummary[] }>(
    `/api/entries?dataset=${encodeURIComponent(ds)}`,
  );
  if (!res.ok) return { status: 'error', entries: [], error: res.message };
  const entries = res.body?.entries;
  return { status: 'ready', entries: Array.isArray(entries) ? entries : [] };
}

function load(ds: DatasetId): void {
  const gen = (generation.get(ds) ?? 0) + 1;
  generation.set(ds, gen);
  // Stale-while-revalidate: keep showing the previous rows while a refresh is in flight.
  $entries.setKey(ds, { status: 'loading', entries: $entries.get()[ds]?.entries ?? [] });
  const request: Promise<void> = fetchEntries(ds)
    .then((state) => {
      if (generation.get(ds) === gen) $entries.setKey(ds, state);
    })
    .finally(() => {
      if (inflight.get(ds) === request) inflight.delete(ds);
    });
  inflight.set(ds, request);
}

/** Load `ds` once. No-op while loading or ready; retries after an error. */
export function ensureEntries(ds: DatasetId): void {
  const state = $entries.get()[ds];
  if (state?.status === 'loading' || state?.status === 'ready') return;
  if (inflight.has(ds)) return;
  load(ds);
}

/** Load every dataset in `datasets` (default: all linkable ones) once; see `ensureEntries`. */
export function ensureAllEntries(datasets: readonly DatasetId[] = LINKABLE_DATASETS): void {
  for (const ds of datasets) ensureEntries(ds);
}

/** Refetch `ds` (after a save / create / delete). A response to an older request is discarded. */
export function invalidateEntries(ds: DatasetId): void {
  load(ds);
}

/** Default wait of `loadAllEntries`. */
export const LOAD_ALL_TIMEOUT_MS = 3000;

const DATASET_ORDER: ReadonlyMap<string, number> = new Map(DATASET_IDS.map((id, i) => [id, i]));

/** Registry dataset order, then display title (`title ?? name`), then slug. For pickers and completion lists. */
export function compareEntries(a: EntrySummary, b: EntrySummary): number {
  return (
    (DATASET_ORDER.get(a.dataset) ?? DATASET_IDS.length) -
      (DATASET_ORDER.get(b.dataset) ?? DATASET_IDS.length) ||
    (a.title ?? a.name).localeCompare(b.title ?? b.name, 'en') ||
    a.slug.localeCompare(b.slug, 'en')
  );
}

/**
 * Every entry of `datasets` (default: all linkable ones) as one list, sorted by `compareEntries`. Starts the
 * loads (`ensureAllEntries`) and resolves when every dataset is `ready` or `error`, or after `timeoutMs`
 * (default 3000), with the entries of the datasets that are `ready` by then. Never rejects.
 */
export function loadAllEntries(
  datasets: readonly DatasetId[] = LINKABLE_DATASETS,
  timeoutMs: number = LOAD_ALL_TIMEOUT_MS,
): Promise<EntrySummary[]> {
  ensureAllEntries(datasets);
  const collect = (): EntrySummary[] => {
    const all = $entries.get();
    const out: EntrySummary[] = [];
    for (const ds of datasets) {
      const state = all[ds];
      if (state?.status === 'ready') out.push(...state.entries);
    }
    return out.sort(compareEntries);
  };
  const settled = (): boolean => {
    const all = $entries.get();
    return datasets.every((ds) => {
      const status = all[ds]?.status;
      return status === 'ready' || status === 'error';
    });
  };
  if (settled()) return Promise.resolve(collect());
  return new Promise<EntrySummary[]>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      unlisten();
      resolve(collect());
    };
    const timer = setTimeout(finish, timeoutMs);
    const unlisten = $entries.listen(() => {
      if (settled()) finish();
    });
  });
}

export function findEntry(ds: DatasetId, slug: string): EntrySummary | undefined {
  return $entries.get()[ds]?.entries.find((e) => e.slug === slug);
}

export interface WaitForEntryOptions {
  /** Give up after this long. Default 5000. */
  timeoutMs?: number;
  /** Pause between two requests. Default 250. */
  intervalMs?: number;
}

/**
 * Poll `GET /api/entries?dataset=<ds>` until `slug` is listed or `timeoutMs` passes. A new okf / skill /
 * reference entry shows up ~0.6 s after it was written (the glob loader's watcher, BACKEND_SPEC §E); contexts and
 * recipes are runtime reads and appear at once. Resolves true as soon as the entry is listed, and then stores that
 * (fresh) response as the cache of `ds`; resolves false on timeout. Request errors are retried until the deadline.
 * Never rejects.
 */
export async function waitForEntry(
  ds: DatasetId,
  slug: string,
  opts: WaitForEntryOptions = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = Math.max(1, opts.intervalMs ?? 250);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await fetchEntries(ds);
    if (state.status === 'ready' && state.entries.some((e) => e.slug === slug)) {
      // Supersede any older in-flight load of this dataset, then publish the response that has the entry.
      generation.set(ds, (generation.get(ds) ?? 0) + 1);
      $entries.setKey(ds, state);
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
}
