// DataForm state (ROUND2_UI_SPEC §H.2): the create / edit form of a reference, context or recipe. Same pattern as
// the Forge store: `$formView` is URL-synced (`?view=form|yaml`, read in `onMount`, written with replaceState,
// popstate re-reads and never writes history); actions are plain functions that set stores; unsaved edits are
// not URL state. Imported only by the client:only DataForm island.
import { atom, computed, onMount } from 'nanostores';
import { YAML_CODECS } from '../lib/forms/codecs.ts';
import { FORM_ERROR_KEY, emptyDoc, normalizeDoc, validateDoc } from '../lib/forms/fields.ts';
import type { FormDoc, YamlDatasetId } from '../lib/forms/fields.ts';
import { nameProblem } from '../lib/names.ts';
import type { EntrySummary } from '../lib/entry-summary.ts';
import { parseEditUrl, withParams } from '../lib/url-state.ts';
import type { EditView } from '../lib/url-state.ts';
import { parseYamlDoc } from '../lib/yaml-doc.ts';
import type { YamlIssue } from '../lib/yaml-doc.ts';
import { getJson, sendJson } from '../ui/edit/api.ts';
import type { ApiResult } from '../ui/edit/api.ts';
import type { SaveStatus } from '../ui/edit/status.ts';
import { $entries, ensureEntries, invalidateEntries } from './entries.ts';

export type FormView = EditView;
export type { FormDoc, YamlDatasetId };

export interface FormMeta {
  dataset: YamlDatasetId;
  mode: 'create' | 'edit';
  /** Edit mode: the entry being edited (immutable name). */
  slug?: string;
}

export interface FormLoad {
  status: 'loading' | 'ready' | 'error' | 'not-found';
  message?: string;
}

// ---------------------------------------------------------------- stores

export const $formView = atom<FormView>('form');
export const $formMeta = atom<FormMeta | null>(null);
export const $formLoad = atom<FormLoad>({ status: 'loading' });
/** Last loaded / saved server copy (edit) or the blank document (create). */
export const $formBaseline = atom<FormDoc | null>(null);
/** Editable copy. Only ever replaced (immutable updates), never mutated. */
export const $formWorking = atom<FormDoc | null>(null);
/** `lastModified` of the loaded copy (edit mode); the conflict check compares it before a PUT. */
export const $formLastModified = atom<string | null>(null);
/** True once Save was pressed: all field errors are shown, not only the live name rule. */
export const $formAttempted = atom(false);
/** Errors the server reported (400 issues, 409 exists), by field id; cleared when that field changes. */
export const $formServerErrors = atom<Record<string, string>>({});
export const $formSave = atom<SaveStatus>({ kind: 'idle' });
/** The "Changed on disk" dialog is open. */
export const $formConflict = atom(false);
/** Set when a save / delete succeeded and the page is about to navigate: the unsaved guard stands down. */
export const $formDone = atom(false);
/** Non-null only while the YAML view is showing. */
export const $formYamlDraft = atom<string | null>(null);

// ---------------------------------------------------------------- derived

export type FormYamlCheck =
  | { ok: true; issues: readonly never[]; doc: FormDoc | null }
  | { ok: false; issues: YamlIssue[] };
const YAML_OK: FormYamlCheck = { ok: true, issues: [], doc: null };

export const $formYamlCheck = computed([$formYamlDraft, $formMeta], (text, meta): FormYamlCheck => {
  if (text === null || meta === null) return YAML_OK;
  const expectedName = meta.mode === 'edit' ? meta.slug : undefined;
  const result = parseYamlDoc(
    text,
    YAML_CODECS[meta.dataset].schema,
    expectedName === undefined ? {} : { expectedName },
  );
  return result.ok
    ? { ok: true, issues: [], doc: result.doc as FormDoc }
    : { ok: false, issues: result.issues };
});
export const $formYamlInvalid = computed($formYamlCheck, (c) => !c.ok);

export interface FormMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: 'error';
}
const NO_MARKERS: readonly FormMarker[] = [];
/**
 * Markers for the `ctxman` owner: only what monaco-yaml's JSON Schema cannot express (`!coveredBySchema`: the
 * strict uri rules, duplicates, a changed name). Stable reference per check so the editor re-applies only on change.
 */
export const $formYamlMarkers = computed($formYamlCheck, (c): readonly FormMarker[] =>
  c.ok
    ? NO_MARKERS
    : c.issues
        .filter((i) => !i.coveredBySchema)
        .map((i) => ({
          startLineNumber: i.line,
          startColumn: i.column,
          endLineNumber: i.endLine,
          endColumn: i.endColumn,
          message: i.message,
          severity: 'error' as const,
        })),
);

function existingNames(entries: readonly EntrySummary[] | undefined): Set<string> {
  return new Set((entries ?? []).map((e) => e.slug));
}

/** Validation errors by field id, unfiltered (see `$formErrors` for what the form shows). */
function allErrors(
  meta: FormMeta,
  working: FormDoc,
  entries: readonly EntrySummary[] | undefined,
): Record<string, string> {
  const result = validateDoc(meta.dataset, working, meta.mode === 'edit' ? meta.slug : undefined);
  const errors = result.ok ? {} : { ...result.errors };
  if (meta.mode === 'create') {
    const name = typeof working.name === 'string' ? working.name.trim() : '';
    const problem = nameProblem(name, existingNames(entries), meta.dataset);
    if (problem === null) delete errors.name;
    else errors.name = problem;
  }
  return errors;
}

/**
 * What the form shows: server errors plus the validation errors, but before the first Save attempt only the
 * name rule once a name has been typed (it is live, like the Forge's New context dialog).
 */
export const $formErrors = computed(
  [$formWorking, $formMeta, $formAttempted, $formServerErrors, $entries],
  (working, meta, attempted, server, entries): Record<string, string> => {
    if (working === null || meta === null) return {};
    const errors = allErrors(meta, working, entries[meta.dataset]?.entries);
    const typedName = typeof working.name === 'string' && working.name !== '';
    const shown: Record<string, string> = {};
    if (attempted) Object.assign(shown, errors);
    else if (typedName && errors.name !== undefined) shown.name = errors.name;
    return { ...shown, ...server };
  },
);

function createTouched(meta: FormMeta, working: FormDoc): boolean {
  const codec = YAML_CODECS[meta.dataset];
  return !codec.same(working, emptyDoc(meta.dataset));
}

export const $formDirty = computed(
  [$formWorking, $formBaseline, $formMeta, $formYamlInvalid, $formDone],
  (working, baseline, meta, yamlInvalid, done): boolean => {
    if (done || working === null || meta === null) return false;
    if (yamlInvalid) return true;
    if (meta.mode === 'create') return createTouched(meta, working);
    return !YAML_CODECS[meta.dataset].same(working, baseline);
  },
);

// ---------------------------------------------------------------- URL plumbing

const URL_DEFAULTS = { view: 'form' };

function replaceViewInUrl(view: FormView): void {
  history.replaceState(
    history.state,
    '',
    withParams(`${location.pathname}${location.search}${location.hash}`, { view }, URL_DEFAULTS),
  );
}

/** The draft follows the view: built from the working doc when YAML shows, dropped otherwise. */
function applyView(view: FormView): void {
  $formView.set(view);
  const working = $formWorking.get();
  const meta = $formMeta.get();
  if (view === 'form') $formYamlDraft.set(null);
  else if (working !== null && meta !== null && $formYamlDraft.get() === null) {
    $formYamlDraft.set(YAML_CODECS[meta.dataset].serialize(working));
  }
}

/** Re-read `location` into the view store (mount and popstate). Never writes history. */
function applyUrl(): void {
  applyView(parseEditUrl(new URLSearchParams(location.search)).view);
}

onMount($formView, () => {
  applyUrl();
  window.addEventListener('popstate', applyUrl);
  return () => window.removeEventListener('popstate', applyUrl);
});

// ---------------------------------------------------------------- loading

let loadSeq = 0;

const clone = <T>(value: T): T => structuredClone(value);

const apiBase = (ds: YamlDatasetId): string => `/api/${ds}`;
const entryApi = (ds: YamlDatasetId, slug: string): string =>
  `${apiBase(ds)}/${encodeURIComponent(slug)}`;

/** Make `doc` the loaded document: baseline and working copy are independent deep copies. */
function adopt(meta: FormMeta, doc: FormDoc, lastModified: string | null): void {
  $formBaseline.set(clone(doc));
  $formWorking.set(clone(doc));
  $formLastModified.set(lastModified);
  $formYamlDraft.set($formView.get() === 'yaml' ? YAML_CODECS[meta.dataset].serialize(doc) : null);
}

function reset(meta: FormMeta): void {
  $formMeta.set(meta);
  $formBaseline.set(null);
  $formWorking.set(null);
  $formLastModified.set(null);
  $formYamlDraft.set(null);
  $formAttempted.set(false);
  $formServerErrors.set({});
  $formSave.set({ kind: 'idle' });
  $formConflict.set(false);
  $formDone.set(false);
}

/**
 * Create mode: the blank document. Edit mode: GET `/api/<ds>/<slug>`. Safe to call again (reload from disk).
 * `meta.dataset` is one of reference | context | recipe.
 */
export async function initForm(meta: FormMeta): Promise<void> {
  const seq = ++loadSeq;
  reset(meta);
  applyUrl();
  ensureEntries(meta.dataset);
  if (meta.mode === 'create') {
    adopt(meta, emptyDoc(meta.dataset), null);
    $formLoad.set({ status: 'ready' });
    return;
  }
  const slug = meta.slug ?? '';
  $formLoad.set({ status: 'loading' });
  const res = await getJson<Record<string, unknown> & { lastModified?: string }>(
    entryApi(meta.dataset, slug),
  );
  if (seq !== loadSeq) return;
  if (!res.ok) {
    $formLoad.set(
      res.status === 404
        ? { status: 'not-found', message: `${meta.dataset} "${slug}" does not exist` }
        : { status: 'error', message: res.message },
    );
    return;
  }
  const doc = YAML_CODECS[meta.dataset].toDoc(res.body);
  if (doc === null) {
    $formLoad.set({ status: 'error', message: 'Unexpected response from the server' });
    return;
  }
  adopt(meta, doc, typeof res.body.lastModified === 'string' ? res.body.lastModified : null);
  $formLoad.set({ status: 'ready' });
}

/** Retry button of the error state. */
export function retryLoad(): void {
  const meta = $formMeta.get();
  if (meta !== null) void initForm(meta);
}

// ---------------------------------------------------------------- editing

/** An edit makes an old "Saved" / "Save failed" message stale. */
function touch(): void {
  const { kind } = $formSave.get();
  if (kind === 'saved' || kind === 'error' || kind === 'conflict') $formSave.set({ kind: 'idle' });
}

function clearServerErrors(...ids: string[]): void {
  const errors = $formServerErrors.get();
  if (ids.every((id) => errors[id] === undefined)) return;
  const next = { ...errors };
  for (const id of ids) delete next[id];
  $formServerErrors.set(next);
}

/** Replace one top-level field of the working document (`value` is stored as given; normalized on save). */
export function setField(id: string, value: unknown): void {
  const working = $formWorking.get();
  const meta = $formMeta.get();
  if (working === null || meta === null) return;
  touch();
  clearServerErrors(id, ...(id === 'type' ? ['path', 'uri'] : []));
  const next = { ...working, [id]: value };
  $formWorking.set(next);
  if ($formView.get() === 'yaml') $formYamlDraft.set(YAML_CODECS[meta.dataset].serialize(next));
}

/** Form / YAML tab. Going to the form is refused while the YAML is invalid (fix it or Cancel first). */
export function setFormView(view: FormView): void {
  if (view === $formView.get()) return;
  if (view === 'form' && $formYamlInvalid.get()) return;
  if (view === 'yaml' && $formWorking.get() === null) return;
  applyView(view);
  replaceViewInUrl(view);
}

/** YAML editor onChange: when the text is valid the form state follows it (two-way sync). */
export function setFormYaml(text: string): void {
  touch();
  $formYamlDraft.set(text);
  $formServerErrors.set({});
  const check = $formYamlCheck.get();
  if (check.ok && check.doc !== null) $formWorking.set(check.doc);
}

// ---------------------------------------------------------------- save / create / delete

function failure(res: Extract<ApiResult<unknown>, { ok: false }>, mode: FormMeta['mode']): void {
  const errors: Record<string, string> = {};
  if (res.status === 409 && mode === 'create') {
    errors.name = 'An entry with this name already exists';
  }
  for (const issue of res.issues ?? []) {
    const key = issue.path.split('.')[0] ?? '';
    const field = key === '' ? FORM_ERROR_KEY : key;
    if (errors[field] === undefined) errors[field] = issue.message;
  }
  $formServerErrors.set(errors);
  $formSave.set({
    kind: 'error',
    message: res.status === 409 && mode === 'create' ? errors.name : res.message,
  });
}

/** Go to `url` (the data is read from disk on every request, so the target page is already current). */
function navigateTo(url: string): void {
  $formDone.set(true);
  location.assign(url);
}

export type SubmitResult = 'invalid' | 'sent' | 'busy';

/**
 * Save (edit) or Create. Client-side validation first ('invalid': the component focuses the first invalid
 * field); then POST / PUT. Edit re-reads the entry first and stops with the conflict dialog when it changed on
 * disk since it was loaded, unless `overwrite`.
 */
export async function submitForm(opts: { overwrite?: boolean } = {}): Promise<SubmitResult> {
  const meta = $formMeta.get();
  const working = $formWorking.get();
  if (meta === null || working === null) return 'invalid';
  if ($formSave.get().kind === 'saving') return 'busy';
  $formAttempted.set(true);
  if ($formYamlInvalid.get()) {
    $formSave.set({ kind: 'error', message: 'Fix the YAML problems first' });
    return 'invalid';
  }
  const errors = allErrors(meta, working, $entries.get()[meta.dataset]?.entries);
  const first = Object.entries(errors)[0];
  if (first !== undefined) {
    // In the YAML view no field is highlighted: say what is wrong instead.
    const [id, message] = first;
    $formSave.set({
      kind: 'error',
      message:
        $formView.get() === 'yaml'
          ? id === FORM_ERROR_KEY
            ? message
            : `${id}: ${message}`
          : 'Fix the highlighted fields',
    });
    return 'invalid';
  }
  const { dataset } = meta;
  const body = normalizeDoc(dataset, working);
  $formSave.set({ kind: 'saving' });
  $formServerErrors.set({});

  if (meta.mode === 'create') {
    const res = await sendJson<unknown>('POST', apiBase(dataset), body);
    if (!res.ok) {
      failure(res, 'create');
      return 'sent';
    }
    const name = String(body.name);
    $formSave.set({ kind: 'saved' });
    invalidateEntries(dataset);
    navigateTo(`/${dataset}/${name}`);
    return 'sent';
  }

  const slug = meta.slug ?? '';
  if (opts.overwrite !== true) {
    const current = await getJson<{ lastModified?: string }>(entryApi(dataset, slug));
    if (!current.ok) {
      $formSave.set({
        kind: 'error',
        message: current.status === 404 ? `${dataset} "${slug}" no longer exists` : current.message,
      });
      return 'sent';
    }
    const known = $formLastModified.get();
    if (known !== null && current.body.lastModified !== known) {
      $formSave.set({ kind: 'conflict' });
      $formConflict.set(true);
      return 'sent';
    }
  }
  const res = await sendJson<{ lastModified?: string }>('PUT', entryApi(dataset, slug), body);
  if (!res.ok) {
    failure(res, 'edit');
    return 'sent';
  }
  $formSave.set({ kind: 'saved' });
  invalidateEntries(dataset);
  navigateTo(`/${dataset}/${slug}`);
  return 'sent';
}

/** Delete the entry being edited (the component confirms first), then go to its list. */
export async function deleteDoc(): Promise<void> {
  const meta = $formMeta.get();
  if (meta === null || meta.mode !== 'edit' || meta.slug === undefined) return;
  if ($formSave.get().kind === 'saving') return;
  const { dataset, slug } = meta;
  $formSave.set({ kind: 'saving', message: 'Deleting…' });
  const res = await sendJson<null>('DELETE', entryApi(dataset, slug));
  if (!res.ok) {
    $formSave.set({ kind: 'error', message: res.message });
    return;
  }
  invalidateEntries(dataset);
  navigateTo(`/${dataset}`);
}

// ---------------------------------------------------------------- conflict dialog

export function keepEditing(): void {
  $formConflict.set(false);
  $formSave.set({ kind: 'idle' });
}

/** Discard my edits and load the disk version. */
export function loadTheirs(): void {
  const meta = $formMeta.get();
  if (meta !== null) void initForm(meta);
}

/** Save my version over the disk version. */
export function overwrite(): Promise<SubmitResult> {
  $formConflict.set(false);
  return submitForm({ overwrite: true });
}

/** Where Cancel goes. */
export function cancelHref(): string {
  const meta = $formMeta.get();
  if (meta === null) return '/';
  return meta.mode === 'create' || meta.slug === undefined
    ? `/${meta.dataset}`
    : `/${meta.dataset}/${meta.slug}`;
}
