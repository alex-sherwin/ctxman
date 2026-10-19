// Browser-safe (localStorage): the layout of a dataset's list table (ListTable island), one record per dataset:
// column widths, hidden columns and row density. These are view preferences, not URL state (they select no data),
// so they live in localStorage under `ctxman:table:<dataset>` as `{v: 1, widths, hidden, density}`; the defaults
// remove the key. Every storage access is wrapped: a private window or blocked storage keeps the layout for the
// page only. `useTablePrefs` reads through useSyncExternalStore, so the island's first render already has the
// stored layout and other tabs follow through the `storage` event.
import { useSyncExternalStore } from 'react';
import type { DatasetId } from '../../datasets/registry.ts';
import { isListColumnId } from './columns.ts';
import type { ColumnWidth, ListColumnId } from './columns.ts';

export type TableDensity = 'normal' | 'compact';

export interface TablePrefs {
  /** Missing = the column's default width. */
  widths: Readonly<Partial<Record<ListColumnId, ColumnWidth>>>;
  /** Never 'entry' (the row header is always shown). */
  hidden: readonly ListColumnId[];
  density: TableDensity;
}

export const DEFAULT_TABLE_PREFS: TablePrefs = { widths: {}, hidden: [], density: 'normal' };

const PREFIX = 'ctxman:table:';
const MAX_PX = 4000;
const RELATIVE = /^\d+(?:\.\d+)?(?:fr|%)$/;

/** A stored or RAC-reported column size (px rounded), or undefined when it is not a usable one. */
export function toColumnWidth(value: unknown): ColumnWidth | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 && value <= MAX_PX ? Math.round(value) : undefined;
  }
  if (typeof value === 'string' && RELATIVE.test(value) && Number.parseFloat(value) > 0) {
    return value as ColumnWidth;
  }
  return undefined;
}

/** The stored text as prefs; whatever is unreadable falls back to its default (unknown columns are dropped). */
export function parseTablePrefs(raw: string | null): TablePrefs {
  if (raw === null) return DEFAULT_TABLE_PREFS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_TABLE_PREFS;
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_TABLE_PREFS;
  const value = parsed as Partial<Record<keyof TablePrefs, unknown>>;
  const widths: Partial<Record<ListColumnId, ColumnWidth>> = {};
  if (typeof value.widths === 'object' && value.widths !== null) {
    for (const [id, raw] of Object.entries(value.widths)) {
      const width = toColumnWidth(raw);
      if (isListColumnId(id) && width !== undefined) widths[id] = width;
    }
  }
  const hidden = Array.isArray(value.hidden)
    ? [...new Set(value.hidden)].filter(
        (id): id is ListColumnId => isListColumnId(id) && id !== 'entry',
      )
    : [];
  return { widths, hidden, density: value.density === 'compact' ? 'compact' : 'normal' };
}

export function serializeTablePrefs(prefs: TablePrefs): string {
  return JSON.stringify({
    v: 1,
    widths: prefs.widths,
    hidden: prefs.hidden,
    density: prefs.density,
  });
}

function isDefault(prefs: TablePrefs): boolean {
  return (
    Object.keys(prefs.widths).length === 0 &&
    prefs.hidden.length === 0 &&
    prefs.density === 'normal'
  );
}

/** `prefs` with the widths a resize reported (RAC's map holds every visible column); hidden columns keep theirs. */
export function withWidths(prefs: TablePrefs, reported: ReadonlyMap<unknown, unknown>): TablePrefs {
  const widths: Partial<Record<ListColumnId, ColumnWidth>> = { ...prefs.widths };
  for (const [id, raw] of reported) {
    const width = toColumnWidth(raw);
    if (isListColumnId(id) && width !== undefined) widths[id] = width;
  }
  return { ...prefs, widths };
}

/** `prefs` with column `id` shown or hidden ('entry' can never be hidden). */
export function withHidden(prefs: TablePrefs, id: ListColumnId, hidden: boolean): TablePrefs {
  const rest = prefs.hidden.filter((h) => h !== id);
  return { ...prefs, hidden: hidden && id !== 'entry' ? [...rest, id] : rest };
}

// ---------------------------------------------------------------- store

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The current prefs per dataset (also what keeps a change when storage refuses the write). */
const cache = new Map<string, TablePrefs>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getTablePrefs(dataset: DatasetId): TablePrefs {
  let prefs = cache.get(dataset);
  if (prefs === undefined) {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(PREFIX + dataset) ?? null;
    } catch {
      // blocked storage: defaults
    }
    prefs = parseTablePrefs(raw);
    cache.set(dataset, prefs);
  }
  return prefs;
}

export function setTablePrefs(dataset: DatasetId, prefs: TablePrefs): void {
  cache.set(dataset, prefs);
  try {
    const store = storage();
    if (isDefault(prefs)) store?.removeItem(PREFIX + dataset);
    else store?.setItem(PREFIX + dataset, serializeTablePrefs(prefs));
  } catch {
    // quota / blocked: the layout lasts for this page only
  }
  notify();
}

/** Another tab changed a layout: drop the cached copy so the next read sees it. */
function onStorage(event: StorageEvent): void {
  if (event.key === null) cache.clear();
  else if (event.key.startsWith(PREFIX)) cache.delete(event.key.slice(PREFIX.length));
  else return;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** The table layout of `dataset` (the stored one, else the defaults). */
export function useTablePrefs(dataset: DatasetId): TablePrefs {
  return useSyncExternalStore(subscribe, () => getTablePrefs(dataset));
}
