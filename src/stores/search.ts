// Global search store + URL sync (UI_SPEC §G.2-G.3, §0.3). BROWSER-only: loaded by the `SearchWidget`
// island (client:only), so nothing here runs on the server.
//
// URL contract: `?search=1&sq=<query>&in=<dataset ids, comma separated>` (UI_SPEC §0.4). History rules:
//   open   -> pushState (marker `history.state.ctxmanSearch = true`), unless the URL already has search=1
//   typing -> debounced (150ms) replaceState; `flushSearchUrl()` writes it immediately
//   close  -> history.back() when this page pushed the entry (marker), else replaceState dropping the params
//   popstate -> `applyUrl()` only; popstate never writes history
//
// Opening from outside React (the Astro header button, UI_SPEC §C.2):
//   * any element with `data-search-trigger` -> a plain left click opens the widget (modifier clicks and
//     middle clicks follow the link, which is `?search=1` and opens the widget on load), or
//   * `window.dispatchEvent(new CustomEvent('ctxman:search-open'))`.
// Both listeners are registered when the island subscribes to `$searchOpen`; before that (island still
// loading) the header link simply navigates to `?search=1`, which the store applies on mount.
import Fuse from 'fuse.js';
import type { FuseResult } from 'fuse.js';
import { atom, computed, onMount } from 'nanostores';
import { DATASET_IDS } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import type { SearchDoc } from '../lib/entry-summary.ts';
import { FUSE_OPTIONS, MAX_RESULTS, MIN_QUERY } from '../lib/search-config.ts';
import { parseSearchUrl, withParams } from '../lib/url-state.ts';

/** `window` CustomEvent that opens the widget (see file header). */
export const SEARCH_OPEN_EVENT = 'ctxman:search-open';
const INDEX_URL = '/api/search-index.json';
const URL_DEBOUNCE_MS = 150;

export type SearchIndexStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface SearchIndexState {
  status: SearchIndexStatus;
  docs: SearchDoc[];
  error?: string;
}
export interface SearchGroup {
  dataset: DatasetId;
  hits: FuseResult<SearchDoc>[];
}
export interface SearchView {
  /** Hit count per dataset over ALL hits (the dataset filter does not apply): chip counts. */
  countsByDataset: Record<DatasetId, number>;
  /** Hits after the dataset filter (before the {@link MAX_RESULTS} cap). */
  total: number;
  /** `total` exceeded the cap, so fewer rows than `total` are in `groups`. */
  capped: boolean;
  /** After filter and cap. Ordered by each group's best (lowest) score, ties in registry order. */
  groups: SearchGroup[];
}

export const $searchOpen = atom<boolean>(false);
export const $searchQuery = atom<string>('');
/** Dataset filter in registry order; `[]` = all datasets. */
export const $searchDatasets = atom<readonly DatasetId[]>([]);
export const $searchIndex = atom<SearchIndexState>({ status: 'idle', docs: [] });

/** Built once per loaded index (cached by the computed store while the island is subscribed). */
export const $fuse = computed($searchIndex, (s) =>
  s.status === 'ready' ? new Fuse<SearchDoc>(s.docs, FUSE_OPTIONS) : null,
);

export const $searchHits = computed([$fuse, $searchQuery], (fuse, q) => {
  const query = q.trim();
  return fuse !== null && query.length >= MIN_QUERY ? fuse.search(query) : [];
});

const datasetRank = (id: DatasetId): number => DATASET_IDS.indexOf(id);
const bestScore = (g: SearchGroup): number => g.hits[0]?.score ?? 1;

export const $searchView = computed([$searchHits, $searchDatasets], (hits, ds): SearchView => {
  const countsByDataset = {} as Record<DatasetId, number>;
  for (const id of DATASET_IDS) countsByDataset[id] = 0;
  for (const h of hits) countsByDataset[h.item.dataset] += 1;

  const filtered = ds.length === 0 ? hits : hits.filter((h) => ds.includes(h.item.dataset));
  const byDataset = new Map<DatasetId, FuseResult<SearchDoc>[]>();
  for (const h of filtered.slice(0, MAX_RESULTS)) {
    const list = byDataset.get(h.item.dataset);
    if (list === undefined) byDataset.set(h.item.dataset, [h]);
    else list.push(h);
  }
  const groups: SearchGroup[] = [...byDataset].map(([dataset, list]) => ({ dataset, hits: list }));
  groups.sort(
    (a, b) => bestScore(a) - bestScore(b) || datasetRank(a.dataset) - datasetRank(b.dataset),
  );
  return {
    countsByDataset,
    total: filtered.length,
    capped: filtered.length > MAX_RESULTS,
    groups,
  };
});

// ------------------------------------------------------------------------------------ index loading

function isIndexPayload(value: unknown): value is { docs: SearchDoc[] } {
  return (
    typeof value === 'object' && value !== null && 'docs' in value && Array.isArray(value.docs)
  );
}

async function fetchIndex(): Promise<SearchDoc[]> {
  const res = await fetch(INDEX_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body: unknown = await res.json();
  if (!isIndexPayload(body)) throw new Error('Malformed search index response');
  return body.docs;
}

/**
 * Fetch `/api/search-index.json` when the index is `idle` or `error` (or `force`). Never called on page
 * load; only `openSearch()` and `applyUrl()` (URL has search=1) call it. A reload keeps the old docs
 * until the new ones arrive (the Fuse instance is rebuilt once, when the status returns to `ready`).
 */
export function loadSearchIndex(force = false): void {
  const current = $searchIndex.get();
  if (current.status === 'loading') return;
  if (current.status === 'ready' && !force) return;
  $searchIndex.set({ status: 'loading', docs: current.docs });
  fetchIndex().then(
    (docs) => $searchIndex.set({ status: 'ready', docs }),
    (error: unknown) =>
      $searchIndex.set({
        status: 'error',
        docs: [],
        error: error instanceof Error ? error.message : String(error),
      }),
  );
}

// ---------------------------------------------------------------------------------------- URL sync

let urlTimer: ReturnType<typeof setTimeout> | undefined;

function cancelPendingUrlWrite(): void {
  if (urlTimer !== undefined) clearTimeout(urlTimer);
  urlTimer = undefined;
}

function searchPatch(): Record<string, string | readonly string[] | null> {
  return { search: '1', sq: $searchQuery.get(), in: $searchDatasets.get() };
}

function hasSearchParam(): boolean {
  return new URLSearchParams(location.search).get('search') === '1';
}

/** Current `history.state` as a plain object we can spread (it may be null or foreign). */
function currentState(): Record<string, unknown> {
  const state: unknown = history.state;
  return typeof state === 'object' && state !== null ? { ...state } : {};
}

function writeUrl(): void {
  if (!$searchOpen.get()) return;
  const next = withParams(location.href, searchPatch());
  if (next !== `${location.pathname}${location.search}${location.hash}`) {
    history.replaceState(history.state, '', next);
  }
}

function scheduleUrlWrite(): void {
  if (!$searchOpen.get()) return;
  cancelPendingUrlWrite();
  urlTimer = setTimeout(() => {
    urlTimer = undefined;
    writeUrl();
  }, URL_DEBOUNCE_MS);
}

/** Run the pending (debounced) `replaceState` now. Called before a result navigation. */
export function flushSearchUrl(): void {
  if (urlTimer === undefined) return;
  cancelPendingUrlWrite();
  writeUrl();
}

const sameIds = (a: readonly DatasetId[], b: readonly DatasetId[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/** Make the stores match `location.search`. Never writes history (also used for popstate). */
function applyUrl(): void {
  cancelPendingUrlWrite();
  const url = parseSearchUrl(new URLSearchParams(location.search));
  if (url.open) {
    $searchQuery.set(url.sq);
    if (!sameIds($searchDatasets.get(), url.in)) $searchDatasets.set(url.in);
    $searchOpen.set(true);
    loadSearchIndex();
  } else {
    $searchOpen.set(false);
  }
}

// ------------------------------------------------------------------------------------------ actions

export function openSearch(): void {
  $searchOpen.set(true);
  loadSearchIndex();
  if (hasSearchParam()) return;
  cancelPendingUrlWrite();
  history.pushState(
    { ...currentState(), ctxmanSearch: true },
    '',
    withParams(location.href, searchPatch()),
  );
}

export function closeSearch(): void {
  cancelPendingUrlWrite();
  if (!$searchOpen.get()) return;
  $searchOpen.set(false);
  if (history.state?.ctxmanSearch === true) {
    history.back();
  } else {
    history.replaceState(
      history.state,
      '',
      withParams(location.href, { search: null, sq: null, in: null }),
    );
  }
}

export function setSearchQuery(q: string): void {
  if (q === $searchQuery.get()) return;
  $searchQuery.set(q);
  scheduleUrlWrite();
}

/** Ids are de-duplicated, restricted to known datasets and stored in registry order. `[]` = all. */
export function setSearchDatasets(ds: readonly DatasetId[]): void {
  const next = DATASET_IDS.filter((id) => ds.includes(id));
  if (sameIds($searchDatasets.get(), next)) return;
  $searchDatasets.set(next);
  scheduleUrlWrite();
}

function focusAndSelectInput(): void {
  const input = document.querySelector<HTMLInputElement>('[data-testid="search-input"]');
  input?.focus();
  input?.select();
}

// ------------------------------------------------------------------------- global listeners (mount)

function onPopState(): void {
  applyUrl();
}

/**
 * Registered on `window` in the CAPTURE phase: RAC's Autocomplete stops propagation of most keys typed
 * in the search input, so a bubbling listener would never see Cmd/Ctrl+K or Enter there.
 */
function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented) return;
  const target = e.target instanceof Element ? e.target : null;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
    // Cmd/Ctrl+K starts Monaco chords.
    if (target?.closest('.monaco-editor')) return;
    e.preventDefault();
    if ($searchOpen.get()) focusAndSelectInput();
    else openSearch();
    return;
  }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (target?.closest('input, textarea, select, [contenteditable], .monaco-editor')) return;
    if (target?.closest('[role="dialog"], [role="alertdialog"]')) return;
    e.preventDefault();
    if ($searchOpen.get()) focusAndSelectInput();
    else openSearch();
    return;
  }
  // The result list is not an ancestor of the input (virtual focus), so flush here before the
  // Autocomplete turns Enter into a link click: Back must restore the exact query.
  if (e.key === 'Enter' && $searchOpen.get()) flushSearchUrl();
}

function onDocumentClick(e: MouseEvent): void {
  // src/scripts/shell.ts may have handled the click already (it dispatches SEARCH_OPEN_EVENT).
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
    return;
  const trigger = e.target instanceof Element ? e.target.closest('[data-search-trigger]') : null;
  if (trigger === null) return;
  e.preventDefault();
  openSearch();
}

function onOpenEvent(event: Event): void {
  // Tells src/scripts/shell.ts the island handled it (no full-page fallback).
  event.preventDefault();
  openSearch();
}

onMount($searchOpen, () => {
  applyUrl();
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('click', onDocumentClick);
  window.addEventListener(SEARCH_OPEN_EVENT, onOpenEvent);
  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onDocumentClick);
    window.removeEventListener(SEARCH_OPEN_EVENT, onOpenEvent);
    cancelPendingUrlWrite();
  };
});
