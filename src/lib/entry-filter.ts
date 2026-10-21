// PURE list filtering/sorting shared by SSR list pages and the Forge (UI_SPEC §0.5, PLAN §E.14).
import { getDataset } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import type { EntrySummary } from './entry-summary.ts';

export interface EntryFilter {
  /** Whitespace-separated terms; every term must be a case-insensitive substring of name+title+description+tags. */
  q?: string;
  /** OR: the entry's state must be one of these. Empty/undefined = all. */
  states?: readonly string[];
  /** AND: the entry must carry every one of these tags. */
  tags?: readonly string[];
  /** Reference type; compared to `refType`. null/undefined/'' = all. */
  type?: string | null;
  /**
   * Restrict to these entries, keys `dataset/slug` (the children of a project: `childrenOf(graph, 'project/x')`).
   * null/undefined = no restriction; an empty set matches nothing.
   */
  keys?: ReadonlySet<string> | null;
  /** A key of `SORTS` ('modified', 'name', 'state', 'type', 'owner', 'links', 'target', 'contexts'); anything else = 'modified'. */
  sort?: string;
  /** Direction of `sort`; undefined = `defaultSortDir(sort)`. Ties always fall back to the name, A→Z. */
  dir?: SortDir;
}

export const SORT_DIRS = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIRS)[number];

export function isSortDir(value: unknown): value is SortDir {
  return value === 'asc' || value === 'desc';
}

const LOCALE = 'en';

const displayName = (e: EntrySummary): string => e.title ?? e.name;

function byName(a: EntrySummary, b: EntrySummary): number {
  return (
    displayName(a).localeCompare(displayName(b), LOCALE) ||
    a.dataset.localeCompare(b.dataset, LOCALE) ||
    a.slug.localeCompare(b.slug, LOCALE)
  );
}

function modifiedMs(e: EntrySummary): number {
  const ms = Date.parse(e.lastModified);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Position of the entry's state in its dataset's lifecycle; undefined = no known state. */
function stateIndex(e: EntrySummary): number | undefined {
  const idx = getDataset(e.dataset)?.states?.findIndex((s) => s.id === e.state) ?? -1;
  return idx === -1 ? undefined : idx;
}

type Compare = (a: EntrySummary, b: EntrySummary, sign: number) => number;

/** Compares one value of each entry; an entry without the value sorts after every entry with one, in both directions. */
function byKey(pick: (e: EntrySummary) => string | number | undefined): Compare {
  return (a, b, sign) => {
    const x = pick(a);
    const y = pick(b);
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    const cmp =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), LOCALE);
    return sign * cmp;
  };
}

/** The primary comparison of each sort key (`sign` is 1 ascending, -1 descending); ties go to the name. */
const SORTS: Record<string, Compare> = {
  modified: byKey(modifiedMs),
  name: (a, b, sign) => sign * byName(a, b),
  state: byKey(stateIndex),
  type: byKey((e) => e.refType),
  owner: byKey((e) => e.owner),
  links: byKey((e) => e.linkCount ?? 0),
  target: byKey((e) => e.recipeTarget),
  contexts: byKey((e) => e.contextCount ?? 0),
  // No time logged, or no fixed total (years, months): after every entry with a total.
  time: byKey((e) => e.timeSeconds ?? undefined),
};

/** Sorts that start A→Z (lifecycle order for `state`); the others start newest / biggest first. */
const ASCENDING_FIRST: ReadonlySet<string> = new Set(['name', 'state', 'type', 'owner', 'target']);

/** The direction a sort starts in; an unknown sort is `modified`, so it starts newest first. */
export function defaultSortDir(sort: string | undefined): SortDir {
  return sort !== undefined && ASCENDING_FIRST.has(sort) ? 'asc' : 'desc';
}

export function filterEntries(entries: readonly EntrySummary[], p: EntryFilter): EntrySummary[] {
  const terms = (p.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const states = p.states ?? [];
  const tags = p.tags ?? [];
  const type = p.type === undefined || p.type === null || p.type === '' ? null : p.type;
  const keys = p.keys ?? null;

  const out = entries.filter((e) => {
    if (keys !== null && !keys.has(`${e.dataset}/${e.slug}`)) return false;
    if (terms.length > 0) {
      const hay = `${e.name} ${e.title ?? ''} ${e.description} ${e.tags.join(' ')}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (states.length > 0 && (e.state === undefined || !states.includes(e.state))) return false;
    if (tags.length > 0 && !tags.every((t) => e.tags.includes(t))) return false;
    if (type !== null && e.refType !== type) return false;
    return true;
  });

  const key = p.sort !== undefined && Object.hasOwn(SORTS, p.sort) ? p.sort : 'modified';
  const primary = SORTS[key];
  const sign = (p.dir ?? defaultSortDir(key)) === 'desc' ? -1 : 1;
  // `filter` returned a fresh array, so sorting it never mutates the caller's input.
  return out.sort((a, b) => primary(a, b, sign) || byName(a, b));
}

/** Distinct tags with their entry counts: count desc, then tag asc. */
export function tagCounts(entries: readonly EntrySummary[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const tag of new Set(e.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, LOCALE));
}

/** Entries per lifecycle state id (entries without a state are not counted). */
export function stateCounts(entries: readonly EntrySummary[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.state !== undefined) counts.set(e.state, (counts.get(e.state) ?? 0) + 1);
  }
  return Object.fromEntries(counts);
}

/**
 * The entries of several datasets as one list (Forge / Inflate "All" tab): `datasets` order, each dataset's entries
 * in the order given. `map` is the shape of the entries store (`{ entries }` per dataset); datasets missing from
 * it contribute nothing. Filter and sort the result with `filterEntries`.
 */
export function mergeEntries(
  map: Partial<Record<DatasetId, { readonly entries: readonly EntrySummary[] }>>,
  datasets: readonly DatasetId[],
): EntrySummary[] {
  return [...new Set(datasets)].flatMap((id) => map[id]?.entries ?? []);
}
