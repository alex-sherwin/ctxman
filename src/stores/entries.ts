// Entries cache for the Forge (UI_SPEC §0.6, §H): one `GET /api/entries?dataset=<id>` per dataset, kept in
// a map store and filtered client-side with the shared `filterEntries`. The same cache resolves titles /
// states for the links list and the context Select (dataset `context`).
import { map } from 'nanostores';
import type { DatasetId } from '../datasets/registry.ts';
import type { EntrySummary } from '../lib/entry-summary.ts';

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
  try {
    const res = await fetch(`/api/entries?dataset=${encodeURIComponent(ds)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { status: 'error', entries: [], error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { entries?: EntrySummary[] };
    return { status: 'ready', entries: Array.isArray(body.entries) ? body.entries : [] };
  } catch (error) {
    return {
      status: 'error',
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

/** Refetch `ds` (after a save / create / delete). A response to an older request is discarded. */
export function invalidateEntries(ds: DatasetId): void {
  load(ds);
}

export function findEntry(ds: DatasetId, slug: string): EntrySummary | undefined {
  return $entries.get()[ds]?.entries.find((e) => e.slug === slug);
}
