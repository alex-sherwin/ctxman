// Forge state (UI_SPEC §H.2, §H.6, §H.7). URL-synced stores follow UI_SPEC §0.3: `onMount($forgeUrl)` reads
// `location.search` and registers the popstate / keydown listeners; actions are plain
// functions that `.set()` stores and call `history.pushState/replaceState` themselves; popstate re-reads the
// URL and never writes history. Imported only by the client:only Forge island.
// Unsaved work is not guarded by a native `beforeunload` prompt (ROUND3_SPEC §G): the working copy is written to
// localStorage on every change (`forge:<slug>`) and restored on the next load, with a banner.
import { atom, computed, map, onMount } from 'nanostores';
import type { LinkableDatasetId } from '../datasets/registry.ts';
import { contextSchema } from '../datasets/schemas.ts';
import { filterEntries, stateCounts, tagCounts } from '../lib/entry-filter.ts';
import type { ContextDoc, EntrySummary } from '../lib/entry-summary.ts';
import { parseContextYaml, sameContext, serializeContext } from '../lib/context-yaml.ts';
import type { YamlIssue } from '../lib/context-yaml.ts';
import { reorderKeys } from '../lib/reorder.ts';
import type { DropPosition } from '../lib/reorder.ts';
import { parseForgeUrl, withParams } from '../lib/url-state.ts';
import type { DiscoverDataset, ForgeUrl, ParamPatchValue } from '../lib/url-state.ts';
import { clearDraft, loadDraft, saveDraft } from '../ui/edit/draft-backup.ts';
import { discoverSource } from './discover.ts';
import type { EntriesMap } from './discover.ts';
import { $entries, ensureAllEntries, ensureEntries, invalidateEntries } from './entries.ts';

export type { ForgeUrl };
export type ForgeView = 'form' | 'yaml';
export type Issue = { path: string; message: string };

export type ContextLoad = {
  status: 'none' | 'loading' | 'ready' | 'not-found' | 'error';
  message?: string;
};
export type SaveStatus = {
  kind: 'idle' | 'saving' | 'saved' | 'error' | 'deleted';
  at?: number;
  message?: string;
  issues?: Issue[];
};

/** `<dataset>:<slug>`: identity of a link inside a context and of a Discover row. */
export const linkKey = (l: { dataset: string; slug: string }): string => `${l.dataset}:${l.slug}`;

/** Inverse of `linkKey` (dataset ids never contain ':'). */
export function parseLinkKey(key: string): { dataset: LinkableDatasetId; slug: string } {
  const i = key.indexOf(':');
  return { dataset: key.slice(0, i) as LinkableDatasetId, slug: key.slice(i + 1) };
}

// ---------------------------------------------------------------- URL-backed state

export const $forgeUrl = map<ForgeUrl>({
  context: null,
  dataset: 'kb',
  q: '',
  states: [],
  tags: [],
});
export const $view = atom<ForgeView>('form');

// ---------------------------------------------------------------- context document state

/** Last loaded / saved server copy. */
export const $baseline = atom<ContextDoc | null>(null);
/** Editable copy. Only ever replaced (immutable updates), never mutated. */
export const $working = atom<ContextDoc | null>(null);
/** `lastModified` of the file behind `$baseline` (GET / PUT / POST response): the base of a saved draft. */
export const $baselineModified = atom<string | null>(null);
/**
 * Non-null while the working copy was restored from a saved draft (ROUND3_SPEC §G); `stale` = the file changed on
 * disk since the draft was started. Cleared by save, revert, delete, a context switch and by editing back to the
 * saved state.
 */
export const $draftRestored = atom<{ stale: boolean } | null>(null);
export const $contextLoad = atom<ContextLoad>({ status: 'none' });
export const $saveStatus = atom<SaveStatus>({ kind: 'idle' });
export const $dirty = computed(
  [$working, $baseline],
  (w, b) => w !== null && b !== null && !sameContext(w, b),
);
export const $linkedKeys = computed($working, (w) => new Set((w?.links ?? []).map(linkKey)));
export const $newContextPrefill = atom<string>('');
/** Set while the "discard changes?" dialog waits for an answer (the context the user wanted to switch to). */
export const $pendingSwitch = atom<{ next: string | null } | null>(null);

// ---------------------------------------------------------------- YAML view

/** Non-null only while the YAML view is showing a context. */
export const $yamlDraft = atom<string | null>(null);

export type YamlCheck =
  | { ok: true; issues: readonly never[]; doc: ContextDoc | null }
  | { ok: false; issues: YamlIssue[] };
const YAML_OK: YamlCheck = { ok: true, issues: [], doc: null };

export const $yamlCheck = computed([$yamlDraft, $baseline], (text, base): YamlCheck => {
  if (text === null || base === null) return YAML_OK;
  const r = parseContextYaml(text, base.name);
  return r.ok ? { ok: true, issues: [], doc: r.doc } : { ok: false, issues: r.issues };
});
export const $yamlInvalid = computed($yamlCheck, (c) => !c.ok);

export interface YamlMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: 'error';
}
const NO_MARKERS: readonly YamlMarker[] = [];
/**
 * Editor markers (owner `ctxman`). The editor runs monaco-yaml with the generated context JSON Schema, which
 * already marks syntax errors and most schema problems, so only what JSON Schema cannot express (duplicate
 * links, a changed `name`) is drawn here: no duplicate squiggles. The issue list below the editor still shows
 * every problem. Stable reference per check result, so the editor only re-applies markers when they change.
 */
export const $yamlMarkers = computed($yamlCheck, (c): readonly YamlMarker[] => {
  if (c.ok) return NO_MARKERS;
  const own = c.issues.filter((i) => !i.coveredBySchema);
  return own.length === 0
    ? NO_MARKERS
    : own.map((i) => ({
        startLineNumber: i.line,
        startColumn: i.column,
        endLineNumber: i.endLine,
        endColumn: i.endColumn,
        message: i.message,
        severity: 'error' as const,
      }));
});

// ---------------------------------------------------------------- Discover

export const DISCOVER_CAP = 200;

export interface DiscoverView {
  status: 'loading' | 'ready' | 'error';
  error?: string;
  /** Matching entries (newest first), capped at `DISCOVER_CAP`. */
  items: EntrySummary[];
  /** Entries in the tab (the dataset, or every linkable dataset for `all`). */
  total: number;
  /** Entries matching the current filters (before the cap). */
  matched: number;
  stateCounts: Record<string, number>;
  /** Tags of the whole tab: count desc, then tag asc. */
  tagCounts: { tag: string; count: number }[];
}

export const $discover = computed([$entries, $forgeUrl], (entries, url): DiscoverView => {
  const source = discoverSource(entries, url.dataset);
  const matched = filterEntries(source.entries, {
    q: url.q,
    states: url.states,
    tags: url.tags,
    sort: 'modified',
  });
  const view: DiscoverView = {
    status: source.status,
    items: matched.slice(0, DISCOVER_CAP),
    total: source.entries.length,
    matched: matched.length,
    // the "All" tab spans lifecycles that share no state ids: no state chips there
    stateCounts: url.dataset === 'all' ? {} : stateCounts(source.entries),
    tagCounts: tagCounts(source.entries),
  };
  if (source.error !== undefined) view.error = source.error;
  return view;
});

/** Start loading what a Discover tab shows (every linkable dataset for `all`). */
function ensureDiscover(dataset: DiscoverDataset): void {
  if (dataset === 'all') ensureAllEntries();
  else ensureEntries(dataset);
}

/**
 * The children of `entry` (its `child` relations, file order) that can be added to a context right now: the
 * target exists in the entries cache (a dangling relation would only add a "missing" link) and is not linked yet.
 */
export function addableChildren(
  entry: EntrySummary,
  entries: EntriesMap,
  linked: ReadonlySet<string>,
): { dataset: LinkableDatasetId; slug: string }[] {
  const out: { dataset: LinkableDatasetId; slug: string }[] = [];
  for (const rel of entry.relations ?? []) {
    if (rel.rel !== 'child' || linked.has(linkKey(rel))) continue;
    if (!entries[rel.dataset]?.entries.some((e) => e.slug === rel.slug)) continue;
    out.push({ dataset: rel.dataset, slug: rel.slug });
  }
  return out;
}

// ---------------------------------------------------------------- URL plumbing

const URL_DEFAULTS = { dataset: 'kb', view: 'form' };
const NEW_CONTEXT_STATE = { ctxmanForgeNew: true };

/** `pathname?search#hash` of the current location with `patch` applied (unrelated params kept). */
function hrefWith(patch: Record<string, ParamPatchValue>): string {
  return withParams(`${location.pathname}${location.search}${location.hash}`, patch, URL_DEFAULTS);
}

/** The URL that matches the stores (used to restore the URL after a cancelled popstate). */
function hrefFromStores(): string {
  const u = $forgeUrl.get();
  return withParams(
    location.pathname,
    {
      context: u.context,
      dataset: u.dataset,
      q: u.q,
      state: u.states,
      tag: u.tags,
      view: $view.get(),
    },
    URL_DEFAULTS,
  );
}

function replaceUrl(patch: Record<string, ParamPatchValue>): void {
  history.replaceState(history.state, '', hrefWith(patch));
}

function readLocation(): { url: ForgeUrl; view: ForgeView } {
  const params = new URLSearchParams(location.search);
  return { url: parseForgeUrl(params), view: params.get('view') === 'yaml' ? 'yaml' : 'form' };
}

/** One debounce handle for `q` writes (UI_SPEC §0.3). */
let queryTimer: ReturnType<typeof setTimeout> | undefined;

function cancelQueryTimer(): void {
  if (queryTimer !== undefined) clearTimeout(queryTimer);
  queryTimer = undefined;
}

/** Write a pending `q` to the URL now (before a pushState, on unmount). */
export function flushQuery(): void {
  if (queryTimer === undefined) return;
  cancelQueryTimer();
  replaceUrl({ q: $forgeUrl.get().q });
}

function applyView(view: ForgeView): void {
  $view.set(view);
  const working = $working.get();
  if (view === 'form') $yamlDraft.set(null);
  else if (working !== null && $yamlDraft.get() === null) $yamlDraft.set(serializeContext(working));
}

/** Re-read `location` into the stores (mount and popstate). Never writes history. */
function applyUrl(): void {
  cancelQueryTimer();
  const { url, view } = readLocation();
  $forgeUrl.set(url);
  applyView(view);
  ensureDiscover(url.dataset);
}

// ---------------------------------------------------------------- drafts (ROUND3_SPEC §G)

/** localStorage key (prefixed `ctxman:draft:` by draft-backup) of the draft of context `slug`. */
export const draftKey = (slug: string): string => `forge:${slug}`;

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
  if (sameContext(working, baseline)) {
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
 * The stored draft of `doc` as a working copy, or null. Anything unusable (not JSON, fails `contextSchema`, other
 * `name`, equal to the saved context) is removed.
 */
function readDraft(doc: ContextDoc): { working: ContextDoc; base: string } | null {
  const key = draftKey(doc.name);
  const draft = loadDraft(key);
  if (draft === null) return null;
  let working: ContextDoc | null = null;
  try {
    const parsed = contextSchema.safeParse(JSON.parse(draft.text));
    if (parsed.success && parsed.data.name === doc.name) working = parsed.data;
  } catch {
    // not JSON: dropped below
  }
  if (working === null || sameContext(working, doc)) {
    clearDraft(key);
    return null;
  }
  return { working, base: draft.base };
}

/** Forget the stored draft of context `name` and hide the banner (save, revert / Discard, delete). */
function dropDraft(name: string): void {
  clearDraft(draftKey(name));
  draftBase = null;
  $draftRestored.set(null);
}

// ---------------------------------------------------------------- loading / adopting a context

let loadSeq = 0;

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Make `doc` the loaded context: baseline and working copy are independent deep copies. With `restore`, a saved
 * draft of this context replaces the working copy (banner on; `stale` when `lastModified` is not the draft's base).
 */
function adopt(doc: ContextDoc, lastModified: string | null, restore: boolean): void {
  const draft = restore ? readDraft(doc) : null;
  if (!restore) clearDraft(draftKey(doc.name));
  const working = draft === null ? clone(doc) : draft.working;
  draftSuspended = true;
  try {
    $baseline.set(clone(doc));
    $baselineModified.set(lastModified);
    $working.set(working);
  } finally {
    draftSuspended = false;
  }
  draftBase = draft === null ? null : draft.base;
  $draftRestored.set(draft === null ? null : { stale: draft.base !== lastModified });
  $yamlDraft.set($view.get() === 'yaml' ? serializeContext(working) : null);
  for (const dataset of new Set([...doc.links, ...working.links].map((l) => l.dataset))) {
    ensureEntries(dataset);
  }
}

function clearContext(): void {
  loadSeq++;
  $baseline.set(null);
  $baselineModified.set(null);
  $working.set(null);
  $draftRestored.set(null);
  draftBase = null;
  $yamlDraft.set(null);
  $contextLoad.set({ status: 'none' });
}

async function messageOf(res: Response): Promise<{ message: string; issues?: Issue[] }> {
  try {
    const body = (await res.json()) as { message?: unknown; issues?: unknown };
    const out: { message: string; issues?: Issue[] } = {
      message: typeof body.message === 'string' ? body.message : `HTTP ${res.status}`,
    };
    if (Array.isArray(body.issues)) out.issues = body.issues as Issue[];
    return out;
  } catch {
    return { message: `HTTP ${res.status}` };
  }
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function loadContext(slug: string): Promise<void> {
  if ($baseline.get()?.name === slug) {
    $contextLoad.set({ status: 'ready' });
    return;
  }
  const seq = ++loadSeq;
  $baseline.set(null);
  $baselineModified.set(null);
  $working.set(null);
  $draftRestored.set(null);
  draftBase = null;
  $yamlDraft.set(null);
  $contextLoad.set({ status: 'loading' });
  try {
    const res = await fetch(`/api/context/${encodeURIComponent(slug)}`, {
      headers: { accept: 'application/json' },
    });
    if (seq !== loadSeq) return;
    if (res.status === 404) {
      await res.body?.cancel(); // an unread body keeps the request "open" (network never idles)
      $contextLoad.set({ status: 'not-found' });
      return;
    }
    if (!res.ok) {
      $contextLoad.set({ status: 'error', message: (await messageOf(res)).message });
      return;
    }
    const body = (await res.json()) as { context: ContextDoc; lastModified?: string };
    if (seq !== loadSeq) return;
    adopt(body.context, body.lastModified ?? null, true);
    $contextLoad.set({ status: 'ready' });
  } catch (error) {
    if (seq === loadSeq) $contextLoad.set({ status: 'error', message: errorText(error) });
  }
}

/** Bring the loaded context in line with `$forgeUrl.context`. */
function syncContext(): void {
  const { context } = $forgeUrl.get();
  if (context === null) clearContext();
  else if (context !== 'new') void loadContext(context);
}

/** Retry button of the error state. */
export function retryLoad(): void {
  const { context } = $forgeUrl.get();
  if (context === null || context === 'new') return;
  void loadContext(context);
}

// ---------------------------------------------------------------- Discover actions

export function setDataset(dataset: DiscoverDataset): void {
  const cur = $forgeUrl.get();
  if (dataset === cur.dataset) return;
  flushQuery();
  $forgeUrl.set({ ...cur, dataset, states: [], tags: [] });
  ensureDiscover(dataset);
  history.pushState(null, '', hrefWith({ dataset, state: null, tag: null }));
}

export function setQuery(q: string): void {
  $forgeUrl.setKey('q', q);
  cancelQueryTimer();
  queryTimer = setTimeout(flushQuery, 150);
}

export function setStates(states: string[]): void {
  $forgeUrl.setKey('states', states);
  replaceUrl({ state: states });
}

export function setTags(tags: string[]): void {
  $forgeUrl.setKey('tags', tags);
  replaceUrl({ tag: tags });
}

// ---------------------------------------------------------------- context selection (dirty guard, §H.6)

function navigateContext(next: string | null): void {
  flushQuery();
  $forgeUrl.setKey('context', next);
  history.pushState(next === 'new' ? NEW_CONTEXT_STATE : null, '', hrefWith({ context: next }));
  if (next !== 'new') {
    $saveStatus.set({ kind: 'idle' });
    syncContext();
  }
}

/** Pick a context, `'new'` (opens the New context dialog) or `null`. Guarded when there is unsaved work. */
export function selectContext(next: string | null): void {
  if (next === $forgeUrl.get().context) return;
  if ($dirty.get() || $yamlInvalid.get()) {
    $pendingSwitch.set({ next });
    return;
  }
  navigateContext(next);
}

export function confirmSwitch(): void {
  const pending = $pendingSwitch.get();
  $pendingSwitch.set(null);
  if (pending === null) return;
  revert();
  navigateContext(pending.next);
}

export function cancelSwitch(): void {
  $pendingSwitch.set(null);
}

/** Cancel / Esc / overlay click of the New context dialog. */
export function cancelNewContext(): void {
  $newContextPrefill.set('');
  if ($forgeUrl.get().context !== 'new') return;
  if ((history.state as { ctxmanForgeNew?: boolean } | null)?.ctxmanForgeNew) {
    history.back(); // popstate re-reads the previous URL
    return;
  }
  const previous = $baseline.get()?.name ?? null;
  history.replaceState(null, '', hrefWith({ context: previous }));
  $forgeUrl.setKey('context', previous);
}

// ---------------------------------------------------------------- editing actions

/** An edit makes an old "Saved" / "Save failed" message stale. */
function touch(): void {
  const { kind } = $saveStatus.get();
  if (kind !== 'idle' && kind !== 'saving') $saveStatus.set({ kind: 'idle' });
}

/** Replace the working copy; in the YAML view the draft is re-serialized (comments are not kept). */
function commitWorking(next: ContextDoc): void {
  touch();
  $working.set(next);
  if ($view.get() === 'yaml') $yamlDraft.set(serializeContext(next));
}

export function addLink(dataset: LinkableDatasetId, slug: string): void {
  addLinks([{ dataset, slug }]);
}

/**
 * Append `keys` in the given order as ONE edit, skipping links that are already present (and repeats within
 * `keys`). "Add with children" passes the entry first, then its children in file order.
 */
export function addLinks(keys: readonly { dataset: LinkableDatasetId; slug: string }[]): void {
  const w = $working.get();
  if (w === null || $yamlInvalid.get()) return;
  const seen = new Set(w.links.map(linkKey));
  const added: ContextDoc['links'] = [];
  for (const { dataset, slug } of keys) {
    const key = linkKey({ dataset, slug });
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({ dataset, slug });
  }
  if (added.length === 0) return;
  commitWorking({ ...w, links: [...w.links, ...added] });
}

export function removeLink(key: string): void {
  const w = $working.get();
  if (w === null) return;
  commitWorking({ ...w, links: w.links.filter((l) => linkKey(l) !== key) });
}

export function moveLink(key: string, dir: -1 | 1): void {
  const w = $working.get();
  if (w === null) return;
  const from = w.links.findIndex((l) => linkKey(l) === key);
  const to = from + dir;
  if (from === -1 || to < 0 || to >= w.links.length) return;
  const links = [...w.links];
  const moved = links[from];
  const other = links[to];
  if (moved === undefined || other === undefined) return;
  links[from] = other;
  links[to] = moved;
  commitWorking({ ...w, links });
}

/**
 * Drop the `moving` links before/after `target` (drag and drop, `OrderedList.onReorder`). A drop that changes
 * nothing is ignored, so it neither dirties the form nor clears a "Saved" message.
 */
export function reorderLinks(moving: string[], target: string, position: DropPosition): void {
  const w = $working.get();
  if (w === null) return;
  const byKey = new Map(w.links.map((l) => [linkKey(l), l]));
  const before = w.links.map(linkKey);
  const after = reorderKeys(before, moving, target, position);
  if (byKey.size !== w.links.length || after.every((k, i) => k === before[i])) return;
  const links = after.flatMap((k) => {
    const link = byKey.get(k);
    return link === undefined ? [] : [link];
  });
  commitWorking({ ...w, links });
}

/** `''` removes the `notes` key (keeps revert-equality and the YAML clean). */
export function setLinkNotes(key: string, notes: string): void {
  const w = $working.get();
  if (w === null) return;
  commitWorking({
    ...w,
    links: w.links.map((l) => {
      if (linkKey(l) !== key) return l;
      if (notes === '') {
        const { notes: _removed, ...rest } = l;
        return rest;
      }
      return { ...l, notes };
    }),
  });
}

export function setDescription(description: string): void {
  const w = $working.get();
  if (w === null) return;
  commitWorking({ ...w, description });
}

/** Replace the whole tag list (the shared TagEditor reports the new list on every add / remove). */
export function setContextTags(tags: string[]): void {
  const w = $working.get();
  if (w === null) return;
  commitWorking({ ...w, tags });
}

export function addTag(tag: string): void {
  const w = $working.get();
  if (w === null || tag === '') return;
  const tags = w.tags ?? [];
  if (tags.includes(tag)) return;
  commitWorking({ ...w, tags: [...tags, tag] });
}

export function removeTag(tag: string): void {
  const w = $working.get();
  if (w === null) return;
  commitWorking({ ...w, tags: (w.tags ?? []).filter((t) => t !== tag) });
}

// ---------------------------------------------------------------- view toggle (§H.7)

export function setView(view: ForgeView): void {
  if (view === $view.get()) return;
  if (view === 'yaml') {
    const w = $working.get();
    if (w === null) return;
    $view.set('yaml');
    $yamlDraft.set(serializeContext(w));
  } else {
    if ($yamlInvalid.get()) return; // Revert (or fix the YAML) first
    $view.set('form');
    $yamlDraft.set(null);
  }
  replaceUrl({ view });
}

/** YAML editor onChange: when the text is valid the form state follows it (two-way sync). */
export function setYamlDraft(text: string): void {
  touch();
  $yamlDraft.set(text);
  const check = $yamlCheck.get();
  if (check.ok && check.doc !== null) $working.set(check.doc);
}

// ---------------------------------------------------------------- save / revert / delete / create

export function revert(): void {
  const baseline = $baseline.get();
  if (baseline === null) return;
  dropDraft(baseline.name);
  $saveStatus.set({ kind: 'idle' });
  $working.set(clone(baseline));
  if ($view.get() === 'yaml') $yamlDraft.set(serializeContext(baseline));
}

export async function save(): Promise<void> {
  if ($saveStatus.get().kind === 'saving') return;
  const working = $working.get();
  const baseline = $baseline.get();
  if (working === null || baseline === null || $yamlInvalid.get()) return;
  $saveStatus.set({ kind: 'saving' });
  try {
    const res = await fetch(`/api/context/${encodeURIComponent(baseline.name)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(working),
    });
    if ($baseline.get() !== baseline) {
      // The user moved to another context while this was in flight: only refresh the cache.
      if (res.ok) invalidateEntries('context');
      return;
    }
    if (!res.ok) {
      const { message, issues } = await messageOf(res);
      const status: SaveStatus = { kind: 'error', message };
      if (issues !== undefined) status.issues = issues;
      $saveStatus.set(status);
      return;
    }
    const body = (await res.json()) as { context: ContextDoc; lastModified?: string };
    $baseline.set(clone(body.context));
    $baselineModified.set(body.lastModified ?? null);
    // Keep keystrokes made while the request was in flight: only adopt the response if nothing changed.
    if ($working.get() === working) {
      $working.set(clone(body.context));
      if ($view.get() === 'yaml') $yamlDraft.set(serializeContext(body.context));
    }
    dropDraft(body.context.name);
    syncDraft(); // keystrokes made while saving stay in a draft, now based on the saved file
    $saveStatus.set({ kind: 'saved', at: Date.now() });
    invalidateEntries('context');
  } catch (error) {
    $saveStatus.set({ kind: 'error', message: errorText(error) });
  }
}

export async function deleteContext(): Promise<void> {
  const baseline = $baseline.get();
  if (baseline === null) return;
  try {
    const res = await fetch(`/api/context/${encodeURIComponent(baseline.name)}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
    });
    if (res.status !== 204 && !res.ok) {
      $saveStatus.set({ kind: 'error', message: (await messageOf(res)).message });
      return;
    }
    dropDraft(baseline.name);
    clearContext();
    invalidateEntries('context');
    history.replaceState(history.state, '', hrefWith({ context: null }));
    $forgeUrl.setKey('context', null);
    $saveStatus.set({ kind: 'deleted', message: `Deleted ${baseline.name}` });
  } catch (error) {
    $saveStatus.set({ kind: 'error', message: errorText(error) });
  }
}

export async function createContext(input: {
  name: string;
  description: string;
}): Promise<{ ok: true } | { ok: false; field?: 'name'; message: string }> {
  try {
    const res = await fetch('/api/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        name: input.name,
        description: input.description,
        tags: [],
        links: [],
      }),
    });
    if (res.status === 409) {
      await res.body?.cancel();
      return { ok: false, field: 'name', message: 'A context with this name already exists.' };
    }
    if (!res.ok) return { ok: false, message: (await messageOf(res)).message };
    const body = (await res.json()) as { context: ContextDoc; lastModified?: string };
    loadSeq++;
    adopt(body.context, body.lastModified ?? null, false);
    $contextLoad.set({ status: 'ready' });
    $saveStatus.set({ kind: 'idle' });
    $newContextPrefill.set('');
    invalidateEntries('context');
    history.replaceState(null, '', hrefWith({ context: body.context.name }));
    $forgeUrl.setKey('context', body.context.name);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
}

// ---------------------------------------------------------------- browser listeners (registered on mount)

function onPopState(): void {
  const { url: next, view } = readLocation();
  const cur = $forgeUrl.get();
  const dirty = $dirty.get();
  const invalid = $yamlInvalid.get();
  const leavingContext = next.context !== cur.context && (dirty || invalid);
  const droppingInvalidYaml = view === 'form' && invalid;
  if (leavingContext || droppingInvalidYaml) {
    const name = $baseline.get()?.name ?? cur.context ?? 'this context';
    const message = dirty
      ? `Discard unsaved changes to "${name}"?`
      : `Discard invalid YAML edits to "${name}"?`;
    if (!window.confirm(message)) {
      // Undo the navigation: the same-origin URL of the current state goes back on top of the stack.
      history.pushState(cur.context === 'new' ? NEW_CONTEXT_STATE : null, '', hrefFromStores());
      return;
    }
    revert();
  }
  applyUrl();
  syncContext();
}

/** Save only when there is something valid to save (Cmd/Ctrl+S, editor save actions). */
export function saveIfDirty(): void {
  if ($dirty.get() && !$yamlInvalid.get()) void save();
}

function onKeyDown(e: KeyboardEvent): void {
  // A Monaco editor action (Cmd/Ctrl+S inside an editor) has already handled and prevented the key.
  if (e.defaultPrevented) return;
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveIfDirty();
  }
}

onMount($forgeUrl, () => {
  applyUrl();
  // Every Discover tab shows its entry count and every link row its title: prefetch all linkable datasets
  // (applyUrl only loads the active tab's), plus the contexts for the Select.
  ensureAllEntries();
  ensureEntries('context');
  syncContext();
  window.addEventListener('popstate', onPopState);
  // Capture phase: the kit OrderedList (RAC GridList) stops key events that start inside a row, so a bubbling
  // `window` listener never sees Cmd/Ctrl+S from a row input or notes editor. A Monaco save action that also
  // fires is harmless: `save()` ignores a second call while one is in flight.
  window.addEventListener('keydown', onKeyDown, true);
  // The working copy follows into localStorage (no native beforeunload prompt: a reload, a closed tab and a dev
  // reload all find the draft again).
  const stopDrafting = $working.listen(syncDraft);
  return () => {
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('keydown', onKeyDown, true);
    stopDrafting();
    flushQuery();
  };
});
