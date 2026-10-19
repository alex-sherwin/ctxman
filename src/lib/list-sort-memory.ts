// PURE (browser-safe): the sort a dataset list was last given, so that a list URL without one opens in it.
// A cookie per dataset, `ctxman-sort-<ds>=<sort>.<dir>`, rather than localStorage: the server sorts, so it reads the
// cookie and redirects a list URL with neither `sort` nor `dir` to the remembered sort before rendering anything.
// The browser writes it when a sort is chosen (ListTable header press or column menu, the FilterForm Sort select),
// before it navigates: choosing the default sort also gives a URL without `sort`, so that choice removes the cookie.
// The default (`modified`, newest first) is never remembered, so a redirect always lands on a URL with `sort` or `dir`.
import type { DatasetId } from '../datasets/registry.ts';
import { defaultSortDir, isSortDir } from './entry-filter.ts';
import type { SortDir } from './entry-filter.ts';
import { listSortHref, listSortsFor } from './url-state.ts';
import type { ListSort } from './url-state.ts';

export interface RememberedSort {
  sort: ListSort;
  dir: SortDir;
}

/** A year; every choice renews it. */
const MAX_AGE_S = 365 * 24 * 60 * 60;

export function sortCookieName(dataset: DatasetId): string {
  return `ctxman-sort-${dataset}`;
}

function isDefaultSort(sort: ListSort, dir: SortDir): boolean {
  return sort === 'modified' && dir === defaultSortDir(sort);
}

export function serializeRememberedSort({ sort, dir }: RememberedSort): string {
  return `${sort}.${dir}`;
}

/** The remembered sort of `dataset`; null when absent, unreadable, not one of the dataset's sorts, or the default. */
export function parseRememberedSort(
  raw: string | undefined,
  dataset: DatasetId,
): RememberedSort | null {
  const [rawSort, rawDir, ...rest] = (raw ?? '').split('.');
  const sort = listSortsFor(dataset).find((s) => s === rawSort);
  if (sort === undefined || !isSortDir(rawDir) || rest.length > 0) return null;
  return isDefaultSort(sort, rawDir) ? null : { sort, dir: rawDir };
}

/**
 * Where a request for list `url` goes instead: the same URL in the remembered sort (`cookie` = the value of
 * `sortCookieName(dataset)`). null = render it as it is: the URL names a sort itself, or none is remembered.
 */
export function rememberedSortHref(
  url: URL,
  dataset: DatasetId,
  cookie: string | undefined,
): string | null {
  if (url.searchParams.has('sort') || url.searchParams.has('dir')) return null;
  const remembered = parseRememberedSort(cookie, dataset);
  return remembered === null
    ? null
    : listSortHref(`${url.pathname}${url.search}`, remembered.sort, remembered.dir);
}

/** The `document.cookie` assignment that remembers `sort` / `dir` for `dataset` (the default forgets). */
export function sortCookie(dataset: DatasetId, sort: ListSort, dir: SortDir): string {
  const name = sortCookieName(dataset);
  return isDefaultSort(sort, dir)
    ? `${name}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${name}=${serializeRememberedSort({ sort, dir })}; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax`;
}

/** Browser: remember the sort just chosen on the list of `dataset`. Call it before navigating to the sorted list. */
export function rememberListSort(dataset: DatasetId, sort: ListSort, dir: SortDir): void {
  if (typeof document === 'undefined') return;
  document.cookie = sortCookie(dataset, sort, dir);
}
