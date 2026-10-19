// PURE URL-state helpers (UI_SPEC §0.3, §E.1, §G, §H.1, §I.1; PLAN §E.13). The URL is the page state:
// SSR list pages, the search widget, the Forge and the Tools page all read/write through these.
import {
  DATASET_IDS,
  getDataset,
  isDatasetId,
  isLinkableDatasetId,
  isReferenceType,
  isValidName,
} from '../datasets/registry.ts';
import type { DatasetId, LinkableDatasetId, ReferenceType } from '../datasets/registry.ts';
import { defaultSortDir, isSortDir } from './entry-filter.ts';
import type { SortDir } from './entry-filter.ts';

/** The only list-valued key that is comma-separated (search dataset filter: `in=kb,task`). */
const IN_KEY = 'in';
const ORIGIN = 'http://ctxman.invalid';

/**
 * All values of `key`: repeated keys (`state=a&state=b`); for the key `in` each value is also
 * comma-split (`in=kb,task`). Values are trimmed, '' dropped, duplicates removed, first-seen order kept.
 */
export function readList(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of params.getAll(key)) {
    for (const part of key === IN_KEY ? raw.split(',') : [raw]) {
      const value = part.trim();
      if (value === '' || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export type ParamPatchValue = string | readonly string[] | null;

/** Registry position of a dataset id; unknown ids sort after all known ones. */
const datasetRank = (id: string): number => {
  const idx = (DATASET_IDS as readonly string[]).indexOf(id);
  return idx === -1 ? DATASET_IDS.length : idx;
};

/** The values a patch entry will write ([] = remove the key). */
function patchValues(key: string, value: ParamPatchValue): string[] {
  if (value === null) return [];
  const list = typeof value === 'string' ? [value] : [...value];
  if (key !== IN_KEY) return list.filter((v) => v !== '');
  const ids = [...new Set(list.flatMap((v) => v.split(',')).map((v) => v.trim()))].filter(
    (v) => v !== '',
  );
  // Array.prototype.sort is stable, so unknown ids keep their relative order.
  ids.sort((a, b) => datasetRank(a) - datasetRank(b));
  return ids.length === 0 ? [] : [ids.join(',')];
}

// encodeURIComponent keeps the URL readable (`in=kb,task`, `%20` for spaces); toWellFormed avoids
// URIError on lone surrogates typed into a search box.
const encode = (s: string): string => encodeURIComponent(s.toWellFormed()).replace(/%2C/gi, ',');

/**
 * Returns `pathname + ?search + hash` of `href` (path or absolute URL) with `patch` applied.
 * A patched key is removed when its value is `null`, `''`, `[]` or equals `defaults[key]`; otherwise it
 * replaces every existing occurrence. Unrelated params keep their original order; patched keys are
 * appended in patch order. Arrays become repeated keys, except `in`, which is comma-joined, deduped and
 * sorted in registry order. Output is re-encoded canonically (spaces as %20, commas kept).
 */
export function withParams(
  href: string,
  patch: Record<string, ParamPatchValue>,
  defaults: Record<string, string> = {},
): string {
  const url = new URL(href, ORIGIN);
  const patched = new Set(Object.keys(patch));
  const pairs: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (!patched.has(key)) pairs.push([key, value]);
  }
  for (const [key, value] of Object.entries(patch)) {
    const values = patchValues(key, value);
    if (values.length === 0) continue;
    if (values.length === 1 && Object.hasOwn(defaults, key) && values[0] === defaults[key])
      continue;
    for (const v of values) pairs.push([key, v]);
  }
  const search = pairs.map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  return `${url.pathname}${search === '' ? '' : `?${search}`}${url.hash}`;
}

// ---------------------------------------------------------------- list pages (UI_SPEC §E.1)

export const LIST_SORTS = [
  'modified',
  'name',
  'state',
  'type',
  'owner',
  'links',
  'target',
  'contexts',
] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const LIST_SORT_LABELS: Readonly<Record<ListSort, string>> = {
  modified: 'Last modified',
  name: 'Name',
  state: 'State',
  type: 'Type',
  owner: 'Owner',
  links: 'Links',
  target: 'Target',
  contexts: 'Contexts',
};

/** The sorts a dataset's list offers (Sort select order): its sortable columns. */
export function listSortsFor(dataset: DatasetId): readonly ListSort[] {
  const extra: readonly ListSort[] =
    dataset === 'reference'
      ? ['type', 'owner']
      : dataset === 'context'
        ? ['links']
        : dataset === 'recipe'
          ? ['target', 'contexts']
          : getDataset(dataset)?.states
            ? ['state']
            : [];
  return ['modified', 'name', ...extra];
}

export interface ListParams {
  q: string;
  /** Only the dataset's lifecycle state ids, in URL order. */
  states: string[];
  tags: string[];
  /** `reference` only. */
  type: ReferenceType | null;
  /** One of `listSortsFor(dataset)`; default 'modified'. */
  sort: ListSort;
  /** `dir=asc|desc`; default `defaultSortDir(sort)` (newest first for 'modified', A→Z for 'name'). */
  dir: SortDir;
  /** `project=<slug>`: only the children of `project/<slug>` (its `child` relations; any dataset). null = no filter. */
  project: string | null;
}

/** `/[dataset]?q=&state=&tag=&sort=&dir=&type=&project=`. Unknown / not-applicable values are ignored (not errors). */
export function parseListParams(params: URLSearchParams, dataset: DatasetId): ListParams {
  const stateIds = new Set<string>((getDataset(dataset)?.states ?? []).map((s) => s.id));
  const rawType = params.get('type');
  const rawSort = params.get('sort');
  const rawDir = params.get('dir');
  const rawProject = params.get('project');
  const sort: ListSort = listSortsFor(dataset).find((s) => s === rawSort) ?? 'modified';
  return {
    q: params.get('q') ?? '',
    states: readList(params, 'state').filter((s) => stateIds.has(s)),
    tags: readList(params, 'tag'),
    type: dataset === 'reference' && isReferenceType(rawType) ? rawType : null,
    sort,
    dir: isSortDir(rawDir) ? rawDir : defaultSortDir(sort),
    project: rawProject !== null && isValidName(rawProject) ? rawProject : null,
  };
}

/** `href` (a list URL, filters kept) sorted by `sort` / `dir`; the defaults ('modified', the sort's own dir) are omitted. */
export function listSortHref(href: string, sort: ListSort, dir: SortDir): string {
  return withParams(href, { sort, dir }, { sort: 'modified', dir: defaultSortDir(sort) });
}

// ---------------------------------------------------------------- search widget (UI_SPEC §G.3)

export interface SearchUrl {
  /** `search=1` */
  open: boolean;
  /** `sq` */
  sq: string;
  /** `in` = comma-separated dataset ids; valid ids only, registry order. [] = all datasets. */
  in: DatasetId[];
}

export function parseSearchUrl(params: URLSearchParams): SearchUrl {
  const wanted = new Set(readList(params, IN_KEY));
  return {
    open: params.get('search') === '1',
    sq: params.get('sq') ?? '',
    in: DATASET_IDS.filter((id) => wanted.has(id)),
  };
}

// ---------------------------------------------------------------- discovery tabs (forge + inflate)

/** A Discover tab: one linkable dataset, or `all` (every linkable dataset merged; no state chips). */
export type DiscoverDataset = LinkableDatasetId | 'all';

export function isDiscoverDataset(value: unknown): value is DiscoverDataset {
  return value === 'all' || isLinkableDatasetId(value);
}

// ---------------------------------------------------------------- new entry form

/** `/new/<dataset>?parent=<project slug>` prefills "Part of project". Invalid / absent = null. */
export function parseNewEntryUrl(params: URLSearchParams): { parent: string | null } {
  const parent = params.get('parent');
  return { parent: parent !== null && isValidName(parent) ? parent : null };
}

// ---------------------------------------------------------------- forge (UI_SPEC §H.1)

export interface ForgeUrl {
  /** Context slug, or 'new'. null = nothing selected (also for an invalid slug). */
  context: string | null;
  /** Discovery tab. Invalid → 'kb'. */
  dataset: DiscoverDataset;
  q: string;
  /** Only state ids of the selected dataset's lifecycle ([] for datasets without one and for `all`). */
  states: string[];
  tags: string[];
}

export const FORGE_DEFAULT_DATASET = 'kb' satisfies DiscoverDataset;

export function parseForgeUrl(params: URLSearchParams): ForgeUrl {
  const rawContext = params.get('context');
  const rawDataset = params.get('dataset');
  const dataset: DiscoverDataset = isDiscoverDataset(rawDataset)
    ? rawDataset
    : FORGE_DEFAULT_DATASET;
  const stateIds = new Set<string>((getDataset(dataset)?.states ?? []).map((s) => s.id));
  return {
    context: rawContext !== null && isValidName(rawContext) ? rawContext : null,
    dataset,
    q: params.get('q') ?? '',
    states: readList(params, 'state').filter((s) => stateIds.has(s)),
    tags: readList(params, 'tag'),
  };
}

/** `/forge?…` for a ForgeUrl; defaults (dataset kb, empty q/lists, no context) are omitted. */
export function forgeHref(u: ForgeUrl, pathname = '/forge'): string {
  return withParams(
    pathname,
    { context: u.context, dataset: u.dataset, q: u.q, state: u.states, tag: u.tags },
    { dataset: FORGE_DEFAULT_DATASET },
  );
}

// ---------------------------------------------------------------- tools (UI_SPEC §I.1)

/** `/tools?add=<dataset id>` preselects the Add Entry dataset. */
export function parseToolsUrl(params: URLSearchParams): { add: DatasetId | null } {
  const add = params.get('add');
  return { add: isDatasetId(add) ? add : null };
}

// ---------------------------------------------------------------- detail edit mode (ROUND2_UI_SPEC §C.3)

export const EDIT_VIEWS = ['form', 'yaml'] as const;
export type EditView = (typeof EDIT_VIEWS)[number];

export interface EditUrl {
  /** `edit=1` on `/<ds>/<slug>` (and the doc sub-page): the page shows its editor instead of the preview. */
  edit: boolean;
  /** `view=form|yaml`: the DataForm tab of a yaml dataset. Default 'form'. */
  view: EditView;
}

/** `?edit=1&view=yaml`. `edit` is true only for exactly `'1'`; an unknown `view` is 'form'. */
export function parseEditUrl(params: URLSearchParams): EditUrl {
  return {
    edit: params.get('edit') === '1',
    view: params.get('view') === 'yaml' ? 'yaml' : 'form',
  };
}

// ---------------------------------------------------------------- inflate (INFLATE_SPEC §9.1, INFLATE_V2_SPEC §11.1)

export const INFLATE_VIEWS = ['compose', 'preview', 'run'] as const;
export type InflateView = (typeof INFLATE_VIEWS)[number];

/** Preview paths: the document relative to the working directory (default) or the v1 absolute render. */
export const INFLATE_PATHS = ['relative', 'absolute'] as const;
export type InflatePaths = (typeof INFLATE_PATHS)[number];

/** Mirror of JOB_ID_PATTERN in src/lib/inflate/jobs.ts (SERVER, so not importable here): a UUID v4 job id. */
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface InflateUrl {
  /** Recipe slug, or 'new'. null = nothing selected (also for an invalid slug). */
  recipe: string | null;
  view: InflateView;
  /** Ad hoc discovery tab. Invalid → 'kb'. */
  dataset: DiscoverDataset;
  q: string;
  /** Run view: the job being watched (`job=<uuid>`). null unless `view=run` and the id is well formed. */
  job: string | null;
  /** Preview: 'relative' (default, omitted) or 'absolute'. */
  paths: InflatePaths;
}

export const INFLATE_DEFAULT_DATASET = 'kb' satisfies DiscoverDataset;

export function parseInflateUrl(params: URLSearchParams): InflateUrl {
  const rawRecipe = params.get('recipe');
  const rawView = params.get('view');
  const rawDataset = params.get('dataset');
  const rawJob = params.get('job');
  const view: InflateView = rawView === 'preview' || rawView === 'run' ? rawView : 'compose';
  return {
    recipe: rawRecipe !== null && isValidName(rawRecipe) ? rawRecipe : null,
    view,
    dataset: isDiscoverDataset(rawDataset) ? rawDataset : INFLATE_DEFAULT_DATASET,
    q: params.get('q') ?? '',
    job: view === 'run' && rawJob !== null && JOB_ID.test(rawJob) ? rawJob : null,
    paths: params.get('paths') === 'absolute' ? 'absolute' : 'relative',
  };
}

/**
 * `/inflate?…` for an InflateUrl; defaults (dataset kb, view compose, paths relative, empty q, no recipe,
 * no job) are omitted. `job` is only written with `view=run`.
 */
export function inflateHref(u: InflateUrl, pathname = '/inflate'): string {
  return withParams(
    pathname,
    {
      recipe: u.recipe,
      view: u.view,
      dataset: u.dataset,
      q: u.q,
      job: u.view === 'run' ? u.job : null,
      paths: u.paths,
    },
    { dataset: INFLATE_DEFAULT_DATASET, view: 'compose', paths: 'relative' },
  );
}
