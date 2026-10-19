// Inflate state (INFLATE_SPEC §9.2). Same structure as src/stores/forge.ts: `onMount($inflateUrl)` reads
// `location.search` and registers the popstate / keydown listeners; actions are plain
// functions that `.set()` stores and call `history.pushState/replaceState` themselves; popstate re-reads the
// URL and never writes history. The composition shown in the UI is the PURE `expandRecipe` run over the
// cached `/api/entries` + `/api/context/:slug` data (instant feedback); the server re-expands for the real
// render (`POST /api/inflate/render`, debounced). Imported only by the client:only Inflate island.
// Unsaved work is not guarded by a native `beforeunload` prompt (ROUND3_SPEC §G): the working copy is written to
// localStorage on every change (`inflate:<slug>`) and restored on the next load, with a banner.
import { atom, computed, map, onMount } from 'nanostores';
import { LINKABLE_DATASETS } from '../datasets/registry.ts';
import type { DatasetId, LinkableDatasetId, Owner } from '../datasets/registry.ts';
import type {
  InflateOptionsInput,
  MaterialOptionsInput,
  RecipeData,
  RecipeOutput,
  RecipeOverride,
} from '../datasets/schemas.ts';
import {
  CONTEXT_FILE_PATTERN,
  DEFAULT_CONTEXT_FILE,
  STUB_IDS,
  baseMaterialOptionValue,
  baseOptionValue,
  defaultDirFor,
  defaultMaterialFor,
  defaultModeFor,
  isMaterialFor,
  isModeForPlacement,
  isPlaceableKind,
  isPrimaryEligible,
  mdKey,
  nextBlockId,
  stubDefaults,
} from '../lib/inflate/catalog.ts';
import type {
  InflateLayout,
  InflateTarget,
  ItemKind,
  MaterialId,
  MaterialOptionId,
  ModeId,
  OptionId,
  StubId,
} from '../lib/inflate/catalog.ts';
import { expandRecipe, itemMetaFromSummary } from '../lib/inflate/expand.ts';
import type {
  ContextLike,
  ContextLookup,
  ExpandLookup,
  ExpandedPlan,
  ItemSegment,
} from '../lib/inflate/expand.ts';
import { parseRecipe, sameRecipe } from '../lib/inflate/recipe.ts';
// Type-only: erased at build time, nothing of the NODE renderer reaches the browser bundle.
import type { InflateResult } from '../lib/inflate/render.ts';
import { filterEntries } from '../lib/entry-filter.ts';
import type { EntrySummary } from '../lib/entry-summary.ts';
import { clone, omit } from '../lib/object.ts';
import type { RemoteUriKind } from '../lib/remote-uri.ts';
import { reorderKeys } from '../lib/reorder.ts';
import type { DropPosition } from '../lib/reorder.ts';
import { parseInflateUrl, withParams } from '../lib/url-state.ts';
import type {
  DiscoverDataset,
  InflatePaths,
  InflateUrl,
  InflateView,
  ParamPatchValue,
} from '../lib/url-state.ts';
import { failureText, getJson, sendJson } from '../ui/edit/api.ts';
import { clearDraft, loadDraft, saveDraft } from '../ui/edit/draft-backup.ts';
import { discoverSource } from './discover.ts';
import { $entries, ensureAllEntries, ensureEntries, invalidateEntries } from './entries.ts';
import type { EntriesState } from './entries.ts';
import type { Issue, SaveStatus } from './forge.ts';

export type { InflatePaths, InflateUrl, InflateView };
export type { Issue, SaveStatus };

export type RecipeLoad = {
  status: 'none' | 'loading' | 'ready' | 'not-found' | 'error';
  message?: string;
};
export type RenderState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: InflateResult | null;
  message?: string;
};
export type WriteStatus = {
  kind: 'idle' | 'writing' | 'written' | 'error';
  message?: string;
  path?: string;
  bytes?: number;
};

/** Ids whose entries the island needs: every linkable dataset, plus the context and recipe lists. */
const SOURCE_DATASETS: readonly DatasetId[] = [...LINKABLE_DATASETS, 'context', 'recipe'];

/** Debounce between an edit and the server render. */
export const RENDER_DEBOUNCE_MS = 400;

// ---------------------------------------------------------------- stores

export const $inflateUrl = map<InflateUrl>({
  recipe: null,
  view: 'compose',
  dataset: 'kb',
  q: '',
  job: null,
  paths: 'relative',
});

/** Last loaded / saved server copy. */
export const $baseline = atom<RecipeData | null>(null);
/** Editable copy. Only ever replaced (immutable updates), never mutated. */
export const $working = atom<RecipeData | null>(null);
/** `lastModified` of the file behind `$baseline` (GET / PUT / POST response): the base of a saved draft. */
export const $baselineModified = atom<string | null>(null);
/**
 * Non-null while the working copy was restored from a saved draft (ROUND3_SPEC §G); `stale` = the file changed on
 * disk since the draft was started. Cleared by save, revert, delete, a recipe switch and by editing back to the
 * saved state.
 */
export const $draftRestored = atom<{ stale: boolean } | null>(null);
export const $recipeLoad = atom<RecipeLoad>({ status: 'none' });
export const $saveStatus = atom<SaveStatus>({ kind: 'idle' });
export const $dirty = computed(
  [$working, $baseline],
  (w, b) => w !== null && b !== null && !sameRecipe(w, b),
);

/** Contexts used by the working recipe, fetched once (refetched by `reloadSources`). */
export const $contextDocs = map<Record<string, ContextLookup>>({});

/** The composition: the working recipe expanded over the browser caches. */
export const $plan = computed(
  [$working, $contextDocs, $entries],
  (w, docs, entries): ExpandedPlan | null =>
    w === null ? null : expandRecipe(w, browserLookup(docs, entries)),
);

/** The working directory of the recipe being edited (trimmed), or null for a document-only recipe. */
export const $outputDir = computed($working, (w): string | null => {
  const dir = w?.output?.dir?.trim();
  return dir === undefined || dir === '' ? null : dir;
});

/** What the browser knows about a `reference/<slug>` entry beyond `ItemMeta`: its owner and, for a remote skill, the URI kind. */
export interface ReferenceInfo {
  owner?: Owner;
  uriKind?: RemoteUriKind;
}
/** `reference/<slug>` -> owner / uriKind, from the cached entry list (the owner is not part of `ItemMeta`). */
export const $referenceInfo = computed($entries, (entries): ReadonlyMap<string, ReferenceInfo> => {
  const out = new Map<string, ReferenceInfo>();
  for (const e of entries.reference?.entries ?? []) {
    const info: ReferenceInfo = {};
    if (e.owner !== undefined) info.owner = e.owner;
    if (e.uriKind !== undefined) info.uriKind = e.uriKind;
    out.set(`reference/${e.slug}`, info);
  }
  return out;
});

/** The "Placement" strip above the composition (a recipe with a working directory): what a run does with the items. */
export interface PlacementSummary {
  dir: string;
  /** Included items by placement; a remote-skill `install` counts as clone (git URI) or download (archive). */
  counts: { symlink: number; copy: number; clone: number; download: number; none: number };
  /** Title of the valid primary repository. */
  primary: string | null;
  /** Titles of the repositories the session may change (the primary unless told otherwise). */
  editable: string[];
}

export function summarizePlacement(plan: ExpandedPlan): PlacementSummary | null {
  const dir = plan.recipe.output?.dir?.trim();
  if (dir === undefined || dir === '') return null;
  const counts: PlacementSummary['counts'] = {
    symlink: 0,
    copy: 0,
    clone: 0,
    download: 0,
    none: 0,
  };
  const editable: string[] = [];
  let primary: string | null = null;
  const primaryKey = plan.primary?.status === 'ok' ? plan.primary.key : null;
  for (const seg of plan.segments) {
    if (seg.type !== 'item' || seg.status !== 'included' || seg.kind === null) continue;
    // a snippet has nothing to place (its markdown is in the context file): not counted as "not placed"
    if (!isPlaceableKind(seg.kind)) continue;
    switch (seg.material) {
      case 'symlink':
        counts.symlink++;
        break;
      case 'copy':
        counts.copy++;
        break;
      case 'clone':
        counts.clone++;
        break;
      case 'install':
        if (seg.meta?.uriKind === 'archive') counts.download++;
        else counts.clone++;
        break;
      default:
        counts.none++;
    }
    if (seg.key === primaryKey) primary = seg.title;
    if (seg.edit === true) editable.push(seg.title);
  }
  return { dir, counts, primary, editable };
}

export const $placementSummary = computed($plan, (plan): PlacementSummary | null =>
  plan === null ? null : summarizePlacement(plan),
);

export const $render = atom<RenderState>({ status: 'idle', result: null });
/** Bytes of each segment in the last server render, by segment key. */
export const $segmentBytes = computed($render, (r): ReadonlyMap<string, number> => {
  const out = new Map<string, number>();
  for (const s of r.result?.manifest.segments ?? []) out.set(s.key, s.bytes);
  return out;
});

/** User-typed output path; null = the default path (`<out dir>/<recipe>.md`). */
export const $writePath = atom<string | null>(null);
export const $writeStatus = atom<WriteStatus>({ kind: 'idle' });
/** Markdown block that was just inserted: its disclosure starts expanded. */
export const $lastAddedBlock = atom<string | null>(null);
/** Set while the "discard changes?" dialog waits for an answer (the recipe the user wanted to switch to). */
export const $pendingSwitch = atom<{ next: string | null } | null>(null);
export const $newRecipePrefill = atom<string>('');

// ---------------------------------------------------------------- "Add items" list

/** Rows rendered per Discover tab; the filter narrows the rest. */
export const ADHOC_CAP = 200;

export interface AdhocView {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** Matching entries (newest first), capped at `ADHOC_CAP`. */
  items: EntrySummary[];
  /** Entries in the tab (the dataset, or every linkable dataset for `all`). */
  total: number;
  /** Entries matching the filter (before the cap). */
  matched: number;
}

/** The "Add items" tab: one dataset's entries, or every linkable dataset merged for `all`, filtered by `q`. */
export const $adhoc = computed([$entries, $inflateUrl], (entries, url): AdhocView => {
  const source = discoverSource(entries, url.dataset);
  const matched = filterEntries(source.entries, { q: url.q, sort: 'modified' });
  const view: AdhocView = {
    status: source.status,
    items: matched.slice(0, ADHOC_CAP),
    total: source.entries.length,
    matched: matched.length,
  };
  if (source.error !== undefined) view.error = source.error;
  return view;
});

// ---------------------------------------------------------------- browser lookup (§5.5)

export function browserLookup(
  docs: Readonly<Record<string, ContextLookup>>,
  entries: Readonly<Partial<Record<DatasetId, EntriesState>>>,
): ExpandLookup {
  return {
    context: (slug) => docs[slug] ?? { status: 'loading' },
    item: (dataset, slug) => {
      const state = entries[dataset];
      // Stale-while-revalidate: a refetch keeps the previous rows, so only an empty cache is "loading".
      if (state === undefined || (state.status === 'loading' && state.entries.length === 0)) {
        return { status: 'loading' };
      }
      if (state.status === 'error') return { status: 'invalid', message: "Couldn't load entries" };
      const summary = state.entries.find((e) => e.slug === slug);
      return summary === undefined
        ? { status: 'missing' }
        : { status: 'ready', meta: itemMetaFromSummary(summary) };
    },
  };
}

function currentLookup(): ExpandLookup {
  return browserLookup($contextDocs.get(), $entries.get());
}

// ---------------------------------------------------------------- URL plumbing

const URL_DEFAULTS = { dataset: 'kb', view: 'compose', paths: 'relative' };
const NEW_RECIPE_STATE = { ctxmanInflateNew: true };

/** `pathname?search#hash` of the current location with `patch` applied (unrelated params kept). */
function hrefWith(patch: Record<string, ParamPatchValue>): string {
  return withParams(`${location.pathname}${location.search}${location.hash}`, patch, URL_DEFAULTS);
}

/** The URL that matches the stores (used to restore the URL after a cancelled popstate). */
function hrefFromStores(): string {
  const u = $inflateUrl.get();
  return withParams(
    location.pathname,
    { recipe: u.recipe, view: u.view, dataset: u.dataset, q: u.q, job: u.job, paths: u.paths },
    URL_DEFAULTS,
  );
}

function replaceUrl(patch: Record<string, ParamPatchValue>): void {
  history.replaceState(history.state, '', hrefWith(patch));
}

function readLocation(): InflateUrl {
  return parseInflateUrl(new URLSearchParams(location.search));
}

/** One debounce handle for `q` writes. */
let queryTimer: ReturnType<typeof setTimeout> | undefined;

function cancelQueryTimer(): void {
  if (queryTimer !== undefined) clearTimeout(queryTimer);
  queryTimer = undefined;
}

/** Write a pending `q` to the URL now (before a pushState, on unmount). */
export function flushQuery(): void {
  if (queryTimer === undefined) return;
  cancelQueryTimer();
  replaceUrl({ q: $inflateUrl.get().q });
}

/** Start loading what an "Add items" tab shows (every linkable dataset for `all`). */
function ensureDiscover(dataset: DiscoverDataset): void {
  if (dataset === 'all') ensureAllEntries();
  else ensureEntries(dataset);
}

/** Re-read `location` into the stores (mount and popstate). Never writes history. */
function applyUrl(): void {
  cancelQueryTimer();
  const url = readLocation();
  $inflateUrl.set(url);
  ensureDiscover(url.dataset);
}

// ---------------------------------------------------------------- contexts used by the recipe

const contextSeq = new Map<string, number>();

async function fetchContext(slug: string): Promise<void> {
  const seq = (contextSeq.get(slug) ?? 0) + 1;
  contextSeq.set(slug, seq);
  const settle = (value: ContextLookup): void => {
    if (contextSeq.get(slug) === seq) $contextDocs.setKey(slug, value);
  };
  const res = await getJson<{ context: ContextLike }>(`/api/context/${encodeURIComponent(slug)}`);
  if (res.ok) settle({ status: 'ready', context: res.body.context });
  else if (res.status === 404) settle({ status: 'missing' });
  else if (res.status === 0 || res.status === 422)
    settle({ status: 'invalid', message: res.message });
  else settle({ status: 'invalid', message: `HTTP ${res.status}` });
}

/** Fetch `slug` once. No-op when it is cached or in flight. */
export function ensureContext(slug: string): void {
  if ($contextDocs.get()[slug] !== undefined) return;
  $contextDocs.setKey(slug, { status: 'loading' });
  void fetchContext(slug);
}

// ---------------------------------------------------------------- server render

let renderTimer: ReturnType<typeof setTimeout> | undefined;
let renderSeq = 0;

function cancelRenderTimer(): void {
  if (renderTimer !== undefined) clearTimeout(renderTimer);
  renderTimer = undefined;
}

export function scheduleRender(): void {
  cancelRenderTimer();
  renderTimer = setTimeout(() => void renderNow(), RENDER_DEBOUNCE_MS);
}

/** Render the working recipe on the server. A response to an older request is dropped. */
export async function renderNow(): Promise<void> {
  cancelRenderTimer();
  const working = $working.get();
  const seq = ++renderSeq;
  if (working === null) {
    $render.set({ status: 'idle', result: null });
    return;
  }
  $render.set({ status: 'loading', result: $render.get().result });
  const res = await sendJson<InflateResult>('POST', '/api/inflate/render', working);
  if (seq !== renderSeq) return;
  if (!res.ok) {
    $render.set({ status: 'error', result: $render.get().result, message: failureText(res) });
    return;
  }
  $render.set({ status: 'ready', result: res.body });
}

function onWorkingChange(working: RecipeData | null): void {
  if (working === null) cancelRenderTimer();
  else scheduleRender();
}

// ---------------------------------------------------------------- loading / adopting a recipe

let loadSeq = 0;

/** Forget everything derived from the previous recipe (render, write path, open markdown block). */
function resetOutputs(): void {
  cancelRenderTimer();
  renderSeq++;
  $render.set({ status: 'idle', result: null });
  $writePath.set(null);
  $writeStatus.set({ kind: 'idle' });
  $lastAddedBlock.set(null);
}

// ---------------------------------------------------------------- drafts (ROUND3_SPEC §G)

/** localStorage key (prefixed `ctxman:draft:` by draft-backup) of the draft of recipe `slug`. */
export const draftKey = (slug: string): string => `inflate:${slug}`;

/** Set while `adopt` swaps the stores, so its own `$working.set` neither clears nor rewrites the stored draft. */
let draftSuspended = false;
/** `base` written with the next draft: the one a restored draft came with (so a stale warning survives another reload). */
let draftBase: string | null = null;

/** Mirror the working copy into storage: dirty -> save the draft, clean -> clear it. */
function syncDraft(): void {
  if (draftSuspended) return;
  const working = $working.get();
  const baseline = $baseline.get();
  if (working === null || baseline === null) return;
  const key = draftKey(baseline.name);
  if (sameRecipe(working, baseline)) {
    clearDraft(key);
    $draftRestored.set(null);
    return;
  }
  saveDraft(key, {
    text: JSON.stringify(working),
    base: draftBase ?? $baselineModified.get() ?? '',
  });
}

/**
 * The stored draft of `recipe` as a working copy, or null. Anything unusable (not JSON, fails the recipe schema,
 * other `name`, equal to the saved recipe) is removed.
 */
function readDraft(recipe: RecipeData): { working: RecipeData; base: string } | null {
  const key = draftKey(recipe.name);
  const draft = loadDraft(key);
  if (draft === null) return null;
  let working: RecipeData | null = null;
  try {
    const parsed = parseRecipe(JSON.parse(draft.text), recipe.name);
    if (parsed.ok) working = parsed.recipe;
  } catch {
    // not JSON: dropped below
  }
  if (working === null || sameRecipe(working, recipe)) {
    clearDraft(key);
    return null;
  }
  return { working, base: draft.base };
}

/** Forget the stored draft of recipe `name` and hide the banner (save, revert / Discard, delete). */
function dropDraft(name: string): void {
  clearDraft(draftKey(name));
  draftBase = null;
  $draftRestored.set(null);
}

/**
 * Make `recipe` the loaded one: baseline and working copy are independent deep copies. With `restore`, a saved
 * draft of this recipe replaces the working copy (banner on; `stale` when `lastModified` is not the draft's base).
 */
function adopt(recipe: RecipeData, lastModified: string | null, restore: boolean): void {
  const draft = restore ? readDraft(recipe) : null;
  if (!restore) clearDraft(draftKey(recipe.name));
  const working = draft === null ? clone(recipe) : draft.working;
  draftSuspended = true;
  try {
    $baseline.set(clone(recipe));
    $baselineModified.set(lastModified);
    $working.set(working);
  } finally {
    draftSuspended = false;
  }
  draftBase = draft === null ? null : draft.base;
  $draftRestored.set(draft === null ? null : { stale: draft.base !== lastModified });
  for (const slug of working.contexts) ensureContext(slug);
  void renderNow();
}

function clearRecipe(): void {
  loadSeq++;
  $baseline.set(null);
  $baselineModified.set(null);
  $working.set(null);
  $draftRestored.set(null);
  draftBase = null;
  $recipeLoad.set({ status: 'none' });
  resetOutputs();
}

export async function loadRecipe(slug: string): Promise<void> {
  if ($baseline.get()?.name === slug) {
    $recipeLoad.set({ status: 'ready' });
    return;
  }
  const seq = ++loadSeq;
  $baseline.set(null);
  $baselineModified.set(null);
  $working.set(null);
  $draftRestored.set(null);
  draftBase = null;
  resetOutputs();
  $recipeLoad.set({ status: 'loading' });
  const res = await getJson<{ recipe: RecipeData; lastModified?: string }>(
    `/api/recipe/${encodeURIComponent(slug)}`,
  );
  if (seq !== loadSeq) return;
  if (!res.ok) {
    $recipeLoad.set(
      res.status === 404 ? { status: 'not-found' } : { status: 'error', message: res.message },
    );
    return;
  }
  adopt(res.body.recipe, res.body.lastModified ?? null, true);
  $recipeLoad.set({ status: 'ready' });
}

/** Bring the loaded recipe in line with `$inflateUrl.recipe`. */
function syncRecipe(): void {
  const { recipe } = $inflateUrl.get();
  if (recipe === null) clearRecipe();
  else if (recipe !== 'new') void loadRecipe(recipe);
}

/** Retry button of the error state. */
export function retryLoad(): void {
  const { recipe } = $inflateUrl.get();
  if (recipe === null || recipe === 'new') return;
  void loadRecipe(recipe);
}

// ---------------------------------------------------------------- Discover actions (ad hoc items)

export function setDataset(dataset: DiscoverDataset): void {
  const cur = $inflateUrl.get();
  if (dataset === cur.dataset) return;
  flushQuery();
  $inflateUrl.set({ ...cur, dataset });
  ensureDiscover(dataset);
  history.pushState(null, '', hrefWith({ dataset }));
}

export function setQuery(q: string): void {
  $inflateUrl.setKey('q', q);
  cancelQueryTimer();
  queryTimer = setTimeout(flushQuery, 150);
}

/**
 * Change the view / job / paths part of the URL (stores and `location` together). `job` only lives with
 * `view=run`. Used by the run store; `replace` keeps the history entry, `push` adds one.
 */
export function patchInflateUrl(
  patch: Partial<Pick<InflateUrl, 'view' | 'job' | 'paths'>>,
  mode: 'push' | 'replace',
): void {
  const cur = $inflateUrl.get();
  const next: InflateUrl = { ...cur, ...patch };
  if (next.view !== 'run') next.job = null;
  if (next.view === cur.view && next.job === cur.job && next.paths === cur.paths) return;
  $inflateUrl.set(next);
  const href = hrefWith({ view: next.view, job: next.job, paths: next.paths });
  if (mode === 'push') history.pushState(null, '', href);
  else history.replaceState(history.state, '', href);
}

export function setView(view: InflateView): void {
  patchInflateUrl({ view }, 'replace');
}

/** Preview: the document with paths relative to the working directory, or the v1 absolute render. */
export function setPaths(paths: InflatePaths): void {
  patchInflateUrl({ paths }, 'replace');
}

// ---------------------------------------------------------------- recipe selection (dirty guard)

function navigateRecipe(next: string | null): void {
  flushQuery();
  // A run belongs to the recipe it was started from: the job param does not follow to another recipe.
  $inflateUrl.set({ ...$inflateUrl.get(), recipe: next, job: null });
  history.pushState(
    next === 'new' ? NEW_RECIPE_STATE : null,
    '',
    hrefWith({ recipe: next, job: null }),
  );
  if (next !== 'new') {
    $saveStatus.set({ kind: 'idle' });
    syncRecipe();
  }
}

/** Pick a recipe, `'new'` (opens the New recipe dialog) or `null`. Guarded when there is unsaved work. */
export function selectRecipe(next: string | null): void {
  if (next === $inflateUrl.get().recipe) return;
  if ($dirty.get()) {
    $pendingSwitch.set({ next });
    return;
  }
  navigateRecipe(next);
}

export function confirmSwitch(): void {
  const pending = $pendingSwitch.get();
  $pendingSwitch.set(null);
  if (pending === null) return;
  revert();
  navigateRecipe(pending.next);
}

export function cancelSwitch(): void {
  $pendingSwitch.set(null);
}

/** Cancel / Esc / overlay click of the New recipe dialog. */
export function cancelNewRecipe(): void {
  $newRecipePrefill.set('');
  if ($inflateUrl.get().recipe !== 'new') return;
  if ((history.state as { ctxmanInflateNew?: boolean } | null)?.ctxmanInflateNew) {
    history.back(); // popstate re-reads the previous URL
    return;
  }
  const previous = $baseline.get()?.name ?? null;
  history.replaceState(null, '', hrefWith({ recipe: previous }));
  $inflateUrl.setKey('recipe', previous);
}

// ---------------------------------------------------------------- editing actions

/** An edit makes an old "Saved" / "Save failed" message stale. */
function touch(): void {
  const { kind } = $saveStatus.get();
  if (kind !== 'idle' && kind !== 'saving') $saveStatus.set({ kind: 'idle' });
}

function commit(next: RecipeData): void {
  touch();
  $working.set(next);
}

/** For the run store: replace the working copy like an edit does ("Save overrides to recipe"). */
export function commitWorking(next: RecipeData): void {
  commit(tidyOutput(tidyEdit(next)));
}

// ---------------------------------------------------------------- output (working directory) helpers

/**
 * `output` without the parts that say nothing: `allowNonEmpty: false`, stubs equal to the target's
 * defaults, an empty `stubs`. The whole `output` goes when nothing is left (contextFile is the default).
 */
function tidyOutput(w: RecipeData): RecipeData {
  const o = w.output;
  if (o === undefined) return w;
  let next: RecipeOutput = { ...o };
  if (next.allowNonEmpty !== true) next = omit(next, 'allowNonEmpty') as RecipeOutput;
  if (next.dir !== undefined && next.dir.trim() === '') next = omit(next, 'dir') as RecipeOutput;
  if (next.stubs !== undefined) {
    const defaults = stubDefaults(w.target);
    const stubs: Partial<Record<StubId, boolean>> = {};
    for (const id of STUB_IDS) {
      const value = next.stubs[id];
      if (value !== undefined && value !== defaults[id]) stubs[id] = value;
    }
    next =
      Object.keys(stubs).length > 0 ? { ...next, stubs } : (omit(next, 'stubs') as RecipeOutput);
  }
  const empty =
    next.dir === undefined &&
    next.primary === undefined &&
    next.allowNonEmpty === undefined &&
    next.stubs === undefined &&
    next.contextFile === DEFAULT_CONTEXT_FILE;
  return empty ? omit(w, 'output') : { ...w, output: next };
}

/** `edit` applied to the recipe's `output` (created with the default context file when absent). */
function withOutput(w: RecipeData, edit: (o: RecipeOutput) => RecipeOutput): RecipeData {
  const output = edit(w.output ?? { contextFile: DEFAULT_CONTEXT_FILE });
  return tidyOutput({ ...w, output });
}

/** Segment keys of the current composition (the order the document will have). */
function planKeys(): string[] {
  return ($plan.get()?.segments ?? []).map((s) => s.key);
}

function itemSegment(key: string): ItemSegment | undefined {
  for (const s of $plan.get()?.segments ?? []) {
    if (s.type === 'item' && s.key === key) return s;
  }
  return undefined;
}

/**
 * Drop `order` keys and overrides that match nothing in the composition. Skipped while any lookup is
 * still loading (a context or entry list that has not arrived yet would look "stale").
 */
function prune(next: RecipeData): RecipeData {
  const p = expandRecipe(next, currentLookup());
  if (p.pending) return next;
  const keys = new Set(p.segments.map((s) => s.key));
  const items = new Set(p.segments.filter((s) => s.type === 'item').map((s) => s.key));
  const order = next.order.filter((k) => keys.has(k));
  const overrides = next.overrides.filter((o) => items.has(o.key));
  // The primary repository goes away with its item.
  const primary = next.output?.primary;
  const dropPrimary = primary !== undefined && !items.has(primary);
  if (
    order.length === next.order.length &&
    overrides.length === next.overrides.length &&
    !dropPrimary
  ) {
    return next;
  }
  const pruned: RecipeData = { ...next, order, overrides };
  return dropPrimary ? withOutput(pruned, (o) => omit(o, 'primary')) : pruned;
}

export function setDescription(description: string): void {
  const w = $working.get();
  if (w === null) return;
  commit({ ...w, description });
}

export function setTarget(target: InflateTarget): void {
  const w = $working.get();
  if (w === null || w.target === target) return;
  commit({ ...w, target });
}

export function setLayout(layout: InflateLayout): void {
  const w = $working.get();
  if (w === null || w.layout === layout) return;
  commit({ ...w, layout });
}

/** `''` removes the `preamble` key (keeps revert-equality and the YAML clean). */
export function setPreamble(preamble: string): void {
  const w = $working.get();
  if (w === null) return;
  if (preamble === '') {
    const { preamble: _removed, ...rest } = w;
    commit(rest);
    return;
  }
  commit({ ...w, preamble });
}

export function toggleContext(slug: string, on: boolean): void {
  const w = $working.get();
  if (w === null) return;
  const has = w.contexts.includes(slug);
  if (on === has) return;
  if (on) {
    ensureContext(slug);
    commit({ ...w, contexts: [...w.contexts, slug] });
  } else {
    commit(prune({ ...w, contexts: w.contexts.filter((c) => c !== slug) }));
  }
}

export function addItem(dataset: LinkableDatasetId, slug: string): void {
  const w = $working.get();
  if (w === null) return;
  if (w.items.some((i) => i.dataset === dataset && i.slug === slug)) return;
  commit({ ...w, items: [...w.items, { dataset, slug }] });
}

export function removeItem(key: string): void {
  const w = $working.get();
  if (w === null) return;
  commit(prune({ ...w, items: w.items.filter((i) => `${i.dataset}/${i.slug}` !== key) }));
}

/** An override with nothing left to say is dropped. */
function cleanOverride(o: RecipeOverride): RecipeOverride | null {
  const out: RecipeOverride = { key: o.key };
  if (o.mode !== undefined) out.mode = o.mode;
  if (o.options !== undefined) {
    const options: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(o.options)) {
      if (value !== undefined) options[id] = value;
    }
    if (Object.keys(options).length > 0) out.options = options as InflateOptionsInput;
  }
  if (o.material !== undefined) out.material = o.material;
  if (o.materialOptions !== undefined) {
    const materialOptions: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(o.materialOptions)) {
      if (value !== undefined) materialOptions[id] = value;
    }
    if (Object.keys(materialOptions).length > 0) {
      out.materialOptions = materialOptions as MaterialOptionsInput;
    }
  }
  if (o.edit !== undefined) out.edit = o.edit;
  if (o.exclude === true) out.exclude = true;
  return out.mode !== undefined ||
    out.options !== undefined ||
    out.material !== undefined ||
    out.materialOptions !== undefined ||
    out.edit !== undefined ||
    out.exclude === true
    ? out
    : null;
}

/** Apply `edit` to the override of `key` (created when absent), keeping its position in the list. */
function editOverride(
  w: RecipeData,
  key: string,
  edit: (o: RecipeOverride) => RecipeOverride,
): RecipeData {
  const existing = w.overrides.find((o) => o.key === key);
  const next = cleanOverride(edit(existing ?? { key }));
  if (existing === undefined) {
    return next === null ? w : { ...w, overrides: [...w.overrides, next] };
  }
  const overrides: RecipeOverride[] = [];
  for (const o of w.overrides) {
    if (o.key !== key) overrides.push(o);
    else if (next !== null) overrides.push(next);
  }
  return { ...w, overrides };
}

/**
 * The mode an item of `kind` gets without an override: the recipe default when it applies to the placement, else
 * the built-in default of the placement (`placed` = a working directory is set and the item's material is not
 * `none`; the expander resolves it the same way, plans/INFLATE_V3_PLAN.md §5).
 */
function baseMode(w: RecipeData, kind: ItemKind, placed: boolean): ModeId {
  const recipeDefault = w.defaults[kind]?.mode;
  return recipeDefault !== undefined && isModeForPlacement(kind, recipeDefault, placed)
    ? recipeDefault
    : defaultModeFor(kind, w.target, placed);
}

/** Would an item of `kind` that takes the recipe's default material be placed in the working directory? */
function placedByDefault(w: RecipeData, kind: ItemKind): boolean {
  const dir = w.output?.dir;
  return typeof dir === 'string' && dir.trim() !== '' && baseMaterial(w, kind) !== 'none';
}

export function setExcluded(key: string, on: boolean): void {
  const w = $working.get();
  if (w === null) return;
  commit(
    editOverride(w, key, (o) => {
      const { exclude: _removed, ...rest } = o;
      return on ? { ...rest, exclude: true } : rest;
    }),
  );
}

export function setMode(key: string, mode: ModeId): void {
  const w = $working.get();
  const seg = itemSegment(key);
  if (w === null || seg === undefined || seg.kind === null) return;
  const same = mode === baseMode(w, seg.kind, seg.placed);
  commit(
    editOverride(w, key, (o) => {
      const { mode: _removed, ...rest } = o;
      return same ? rest : { ...rest, mode };
    }),
  );
}

export function setOption(key: string, id: OptionId, value: boolean | number | string): void {
  const w = $working.get();
  const seg = itemSegment(key);
  if (w === null || seg === undefined || seg.kind === null || seg.mode === null) return;
  const base = baseOptionValue(seg.kind, seg.mode, id, seg.slug, w.defaults[seg.kind]?.options);
  commit(
    editOverride(w, key, (o) => {
      const options: Record<string, unknown> = { ...o.options };
      if (value === base) delete options[id];
      else options[id] = value;
      return { ...o, options: options as InflateOptionsInput };
    }),
  );
}

export function setDefaultMode(kind: ItemKind, mode: ModeId | null): void {
  const w = $working.get();
  if (w === null) return;
  const current = w.defaults[kind];
  const next: NonNullable<RecipeData['defaults'][ItemKind]> = {};
  // The built-in default depends on the placement of the kind's default material (document only: today's lists).
  if (mode !== null && mode !== defaultModeFor(kind, w.target, placedByDefault(w, kind))) {
    next.mode = mode;
  }
  if (current?.options !== undefined) next.options = current.options;
  // The material fields of the kind default are not this action's business: keep them.
  if (current?.material !== undefined) next.material = current.material;
  if (current?.materialOptions !== undefined) next.materialOptions = current.materialOptions;
  const { [kind]: _removed, ...others } = w.defaults;
  const defaults: RecipeData['defaults'] =
    Object.keys(next).length > 0 ? { ...others, [kind]: next } : others;
  commit({ ...w, defaults });
}

/** The material an item of `kind` gets without an override: the recipe default, else the built-in one. */
export function baseMaterial(w: RecipeData, kind: ItemKind): MaterialId {
  const recipeDefault = w.defaults[kind]?.material;
  return recipeDefault !== undefined && isMaterialFor(kind, recipeDefault)
    ? recipeDefault
    : defaultMaterialFor(kind, w.target);
}

export function setMaterial(key: string, material: MaterialId): void {
  const w = $working.get();
  const seg = itemSegment(key);
  if (w === null || seg === undefined || seg.kind === null) return;
  if (!isMaterialFor(seg.kind, material)) return;
  const same = material === baseMaterial(w, seg.kind);
  let next = editOverride(w, key, (o) => {
    const { material: _removed, ...rest } = o;
    return same ? rest : { ...rest, material };
  });
  // A primary repository must be placed in the directory: a material that cannot be primary lets it go.
  if (next.output?.primary === key && !isPrimaryEligible(seg.kind, material)) {
    next = withOutput(next, (o) => omit(o, 'primary'));
  }
  commit(tidyEdit(next));
}

export function setMaterialOption(
  key: string,
  id: MaterialOptionId,
  value: boolean | number | string,
): void {
  const w = $working.get();
  const seg = itemSegment(key);
  if (w === null || seg === undefined || seg.kind === null) return;
  const base = baseMaterialOptionValue(id, w.defaults[seg.kind]?.materialOptions);
  commit(
    editOverride(w, key, (o) => {
      const materialOptions: Record<string, unknown> = { ...o.materialOptions };
      if (value === base) delete materialOptions[id];
      else materialOptions[id] = value;
      return { ...o, materialOptions: materialOptions as MaterialOptionsInput };
    }),
  );
}

/** `null` removes the recipe-wide material of `kind` (back to the built-in default). */
export function setDefaultMaterial(kind: ItemKind, material: MaterialId | null): void {
  const w = $working.get();
  if (w === null) return;
  if (material !== null && !isMaterialFor(kind, material)) return;
  const current = w.defaults[kind];
  const next: NonNullable<RecipeData['defaults'][ItemKind]> = {};
  if (current?.mode !== undefined) next.mode = current.mode;
  if (current?.options !== undefined) next.options = current.options;
  if (material !== null && material !== defaultMaterialFor(kind, w.target)) {
    next.material = material;
  }
  if (current?.materialOptions !== undefined) next.materialOptions = current.materialOptions;
  const { [kind]: _removed, ...others } = w.defaults;
  const defaults: RecipeData['defaults'] =
    Object.keys(next).length > 0 ? { ...others, [kind]: next } : others;
  commit({ ...w, defaults });
}

/**
 * Editable flag of a repository (plans/INFLATE_V3_PLAN.md §3.2). The default is "is the valid primary", so a value
 * equal to it drops the override. Refused for an item that cannot be edited (a copy, a remote repository that is
 * not cloned, a non-repository).
 */
export function setEdit(key: string, on: boolean): void {
  const w = $working.get();
  const plan = $plan.get();
  const seg = itemSegment(key);
  if (w === null || plan === null || seg === undefined || seg.edit === null) return;
  const isPrimary = plan.primary?.status === 'ok' && plan.primary.key === key;
  commit(
    editOverride(w, key, (o) => {
      const { edit: _removed, ...rest } = o;
      return on === isPrimary ? rest : { ...rest, edit: on };
    }),
  );
}

/**
 * Drop the `edit` overrides that say what the item gets anyway (valid primary: true, other repository: false).
 * Needed after anything that moves the primary. Skipped while a lookup is still loading.
 */
function tidyEdit(w: RecipeData): RecipeData {
  if (!w.overrides.some((o) => o.edit !== undefined)) return w;
  const plan = expandRecipe(w, currentLookup());
  if (plan.pending) return w;
  const primary = plan.primary?.status === 'ok' ? plan.primary.key : null;
  const redundant = new Set<string>();
  for (const seg of plan.segments) {
    if (
      seg.type === 'item' &&
      seg.editSource === 'override' &&
      seg.edit === (seg.key === primary)
    ) {
      redundant.add(seg.key);
    }
  }
  if (redundant.size === 0) return w;
  const overrides: RecipeOverride[] = [];
  for (const o of w.overrides) {
    if (!redundant.has(o.key)) {
      overrides.push(o);
      continue;
    }
    const { edit: _removed, ...rest } = o;
    const cleaned = cleanOverride(rest);
    if (cleaned !== null) overrides.push(cleaned);
  }
  return { ...w, overrides };
}

// ---------------------------------------------------------------- output directory actions

/** `''` / null / blank removes `output.dir` (the recipe is then document-only). */
export function setOutputDir(value: string | null): void {
  const w = $working.get();
  if (w === null) return;
  const dir = value === null || value.trim() === '' ? null : value;
  if ((w.output?.dir ?? null) === dir) return;
  commit(withOutput(w, (o) => (dir === null ? omit(o, 'dir') : { ...o, dir })));
}

/** `output.dir` = the default directory of this recipe (`~/ctxman-inflate/<name>`). */
export function setDefaultDir(): void {
  const w = $working.get();
  if (w === null) return;
  setOutputDir(defaultDirFor(w.name));
}

/** Only a valid file name is committed; the default name removes the key. */
export function setContextFile(value: string): void {
  const w = $working.get();
  if (w === null || !CONTEXT_FILE_PATTERN.test(value)) return;
  if ((w.output?.contextFile ?? DEFAULT_CONTEXT_FILE) === value) return;
  commit(withOutput(w, (o) => ({ ...o, contextFile: value })));
}

/** A value equal to the target's default removes the key (revert-equality, clean YAML). */
export function setStub(id: StubId, on: boolean): void {
  const w = $working.get();
  if (w === null) return;
  const current = w.output?.stubs?.[id] ?? stubDefaults(w.target)[id];
  if (current === on) return;
  commit(withOutput(w, (o) => ({ ...o, stubs: { ...o.stubs, [id]: on } })));
}

export function setAllowNonEmpty(on: boolean): void {
  const w = $working.get();
  if (w === null || (w.output?.allowNonEmpty === true) === on) return;
  commit(withOutput(w, (o) => (on ? { ...o, allowNonEmpty: true } : omit(o, 'allowNonEmpty'))));
}

/** One value, so the checkbox of a row is single-select by construction. */
export function setPrimary(key: string | null): void {
  const w = $working.get();
  if (w === null || (w.output?.primary ?? null) === key) return;
  // The Editable default follows the primary: an `edit` override that now equals it goes.
  commit(
    tidyEdit(withOutput(w, (o) => (key === null ? omit(o, 'primary') : { ...o, primary: key }))),
  );
}

/** Swap `key` with its neighbour in the composition; the whole order becomes explicit. */
export function moveSegment(key: string, dir: -1 | 1): void {
  const w = $working.get();
  if (w === null) return;
  const keys = planKeys();
  const from = keys.indexOf(key);
  const to = from + dir;
  if (from === -1 || to < 0 || to >= keys.length) return;
  const moved = keys[from];
  const other = keys[to];
  if (moved === undefined || other === undefined) return;
  keys[from] = other;
  keys[to] = moved;
  commit({ ...w, order: keys });
}

/**
 * Drag and drop: move the `moving` segments before / after `target`; the whole order becomes explicit.
 * A drop that leaves the composition as it is does not touch the recipe.
 */
export function reorderSegments(moving: string[], target: string, position: DropPosition): void {
  const w = $working.get();
  if (w === null) return;
  const keys = planKeys();
  const next = reorderKeys(keys, moving, target, position);
  if (next.every((k, i) => k === keys[i])) return;
  commit({ ...w, order: next });
}

/** Add an empty markdown block right after segment `key` (`null` = at the end). */
export function insertMarkdownAfter(key: string | null): void {
  const w = $working.get();
  if (w === null) return;
  const id = nextBlockId(w.markdown.map((b) => b.id));
  const keys = planKeys();
  const at = key === null ? -1 : keys.indexOf(key);
  const order =
    at === -1 ? [...keys, mdKey(id)] : [...keys.slice(0, at + 1), mdKey(id), ...keys.slice(at + 1)];
  $lastAddedBlock.set(id);
  commit({ ...w, markdown: [...w.markdown, { id, body: '' }], order });
}

export function setMarkdownBody(id: string, body: string): void {
  const w = $working.get();
  if (w === null) return;
  commit({ ...w, markdown: w.markdown.map((b) => (b.id === id ? { ...b, body } : b)) });
}

export function removeMarkdown(id: string): void {
  const w = $working.get();
  if (w === null) return;
  commit(prune({ ...w, markdown: w.markdown.filter((b) => b.id !== id) }));
}

export function resetOrder(): void {
  const w = $working.get();
  if (w === null || w.order.length === 0) return;
  commit({ ...w, order: [] });
}

export function pruneStale(): void {
  const w = $working.get();
  if (w === null) return;
  const next = prune(w);
  if (next !== w) commit(next);
}

const reloadListeners = new Set<() => void>();

/** The run store refreshes its dry run after "Reload sources" (it imports this module, not the reverse). */
export function onSourcesReload(listener: () => void): () => void {
  reloadListeners.add(listener);
  return () => reloadListeners.delete(listener);
}

/** Re-fetch every entries list and context the composition reads, then render again. */
export function reloadSources(): void {
  for (const ds of SOURCE_DATASETS) invalidateEntries(ds);
  for (const slug of Object.keys($contextDocs.get())) void fetchContext(slug);
  void renderNow();
  for (const listener of reloadListeners) listener();
}

// ---------------------------------------------------------------- save / revert / delete / create

export function revert(): void {
  const baseline = $baseline.get();
  if (baseline === null) return;
  dropDraft(baseline.name);
  $saveStatus.set({ kind: 'idle' });
  $working.set(clone(baseline));
}

export async function save(): Promise<void> {
  if ($saveStatus.get().kind === 'saving') return;
  const working = $working.get();
  const baseline = $baseline.get();
  if (working === null || baseline === null) return;
  $saveStatus.set({ kind: 'saving' });
  const res = await sendJson<{ recipe: RecipeData; lastModified?: string }>(
    'PUT',
    `/api/recipe/${encodeURIComponent(baseline.name)}`,
    working,
  );
  if ($baseline.get() !== baseline) {
    // The user moved to another recipe while this was in flight: only refresh the cache.
    if (res.ok) invalidateEntries('recipe');
    return;
  }
  if (!res.ok) {
    $saveStatus.set({
      kind: 'error',
      message: res.message,
      ...(res.issues ? { issues: res.issues } : {}),
    });
    return;
  }
  const { recipe, lastModified } = res.body;
  $baseline.set(clone(recipe));
  $baselineModified.set(lastModified ?? null);
  // Keep keystrokes made while the request was in flight; the server copy only replaces a working
  // copy that still equals what was sent AND differs from the response (never in practice).
  if ($working.get() === working && !sameRecipe(working, recipe)) {
    $working.set(clone(recipe));
  }
  dropDraft(recipe.name);
  syncDraft(); // keystrokes made while saving stay in a draft, now based on the saved file
  $saveStatus.set({ kind: 'saved', at: Date.now() });
  invalidateEntries('recipe');
}

export async function deleteRecipe(): Promise<void> {
  const baseline = $baseline.get();
  if (baseline === null) return;
  const res = await sendJson<null>('DELETE', `/api/recipe/${encodeURIComponent(baseline.name)}`);
  if (!res.ok) {
    $saveStatus.set({ kind: 'error', message: res.message });
    return;
  }
  dropDraft(baseline.name);
  clearRecipe();
  invalidateEntries('recipe');
  history.replaceState(history.state, '', hrefWith({ recipe: null }));
  $inflateUrl.setKey('recipe', null);
  $saveStatus.set({ kind: 'deleted', message: `Deleted ${baseline.name}` });
}

export async function createRecipe(input: {
  name: string;
  description: string;
  target: InflateTarget;
}): Promise<{ ok: true } | { ok: false; field?: 'name'; message: string }> {
  const res = await sendJson<{ recipe: RecipeData; lastModified?: string }>('POST', '/api/recipe', {
    name: input.name,
    description: input.description,
    target: input.target,
    layout: 'grouped',
    contexts: [],
    items: [],
  });
  if (!res.ok) {
    return res.status === 409
      ? { ok: false, field: 'name', message: 'A recipe with this name already exists.' }
      : { ok: false, message: failureText(res) };
  }
  const { recipe, lastModified } = res.body;
  loadSeq++;
  resetOutputs();
  adopt(recipe, lastModified ?? null, false);
  $recipeLoad.set({ status: 'ready' });
  $saveStatus.set({ kind: 'idle' });
  $newRecipePrefill.set('');
  invalidateEntries('recipe');
  history.replaceState(null, '', hrefWith({ recipe: recipe.name }));
  $inflateUrl.setKey('recipe', recipe.name);
  return { ok: true };
}

// ---------------------------------------------------------------- write to a file

export function setWritePath(value: string): void {
  $writePath.set(value);
}

/** `POST /api/inflate/write` with the working recipe (unsaved edits included). */
export async function writeOutput(path: string): Promise<void> {
  const working = $working.get();
  if (working === null || $writeStatus.get().kind === 'writing') return;
  $writeStatus.set({ kind: 'writing' });
  const res = await sendJson<{ path: string; bytes: number }>('POST', '/api/inflate/write', {
    recipe: working,
    path,
  });
  if (!res.ok) {
    $writeStatus.set({ kind: 'error', message: failureText(res) });
    return;
  }
  $writeStatus.set({ kind: 'written', path: res.body.path, bytes: res.body.bytes });
}

// ---------------------------------------------------------------- browser listeners (registered on mount)

function onPopState(): void {
  const next = readLocation();
  const cur = $inflateUrl.get();
  if (next.recipe !== cur.recipe && $dirty.get()) {
    const name = $baseline.get()?.name ?? cur.recipe ?? 'this recipe';
    if (!window.confirm(`Discard unsaved changes to "${name}"?`)) {
      // Undo the navigation: the same-origin URL of the current state goes back on top of the stack.
      history.pushState(cur.recipe === 'new' ? NEW_RECIPE_STATE : null, '', hrefFromStores());
      return;
    }
    revert();
  }
  applyUrl();
  syncRecipe();
}

/** Save only when there is something to save (Cmd/Ctrl+S, editor save actions). */
export function saveIfDirty(): void {
  if ($dirty.get()) void save();
}

// Registered in the capture phase: react-aria's grid rows (the composition list) stop the propagation of key
// events that start inside a row, so a bubbling listener would never see Cmd/Ctrl+S typed in a row's input,
// Select or editor.
function onKeyDown(e: KeyboardEvent): void {
  // A Monaco editor action (Cmd/Ctrl+S inside an editor) has already handled and prevented the key.
  if (e.defaultPrevented) return;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveIfDirty();
  }
}

onMount($inflateUrl, () => {
  applyUrl();
  for (const ds of SOURCE_DATASETS) ensureEntries(ds);
  syncRecipe();
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeyDown, true);
  const stopWatching = $working.listen(onWorkingChange);
  // The working copy follows into localStorage (no native beforeunload prompt: a reload, a closed tab and a dev
  // reload all find the draft again).
  const stopDrafting = $working.listen(syncDraft);
  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('keydown', onKeyDown, true);
    stopWatching();
    stopDrafting();
    cancelRenderTimer();
    flushQuery();
  };
});
