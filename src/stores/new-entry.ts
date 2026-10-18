// NewEntryForm state (ROUND3_SPEC §E.7): the create form of an okf or skill entry (`/new/<ds>`). Same pattern as
// the DataForm store (data-form.ts): actions are plain functions that set stores, nothing here is URL state
// (the `?parent=` prefill is read by the Astro page and passed in), unsaved edits are not persisted. Submit is
// `POST /api/entry/<ds>`; after a 201 the target is parked in sessionStorage and the page navigates once the
// entry is listed, so a dev-server reload that lands first still ends on the new entry. Imported only by the
// client:only NewEntryForm island.
import { atom, computed } from 'nanostores';
import { datasetDef } from '../datasets/registry.ts';
import {
  FORM_ERROR_KEY,
  blankDraft,
  buildBody,
  failureErrors,
  failureMessage,
  validateDraft,
} from '../lib/forms/entry-form.ts';
import type { NewEntryDataset, NewEntryDraft, NewEntryField } from '../lib/forms/entry-form.ts';
import { sendJson } from '../ui/edit/api.ts';
import { rememberSave, takeSave } from '../ui/edit/last-save.ts';
import type { SaveStatus } from '../ui/edit/status.ts';
import { $entries, ensureEntries, invalidateEntries, waitForEntry } from './entries.ts';

export interface NewEntryMeta {
  dataset: NewEntryDataset;
  /** Project slug to prefill "Part of project" with (`?parent=`), or null. */
  parent: string | null;
}

// ---------------------------------------------------------------- stores

export const $newMeta = atom<NewEntryMeta | null>(null);
/** Editable copy. Only ever replaced (immutable updates), never mutated. */
export const $newDraft = atom<NewEntryDraft | null>(null);
/** The blank (or prefilled) draft the form started from, for the unsaved check. */
export const $newBaseline = atom<NewEntryDraft | null>(null);
/** True once Create was pressed: all field errors are shown, not only the live name rule. */
export const $newAttempted = atom(false);
/** Errors the server reported (400 issues, 409 exists), by field id; cleared when that field changes. */
export const $newServerErrors = atom<Record<string, string>>({});
export const $newSave = atom<SaveStatus>({ kind: 'idle' });
/** Set once the entry exists and the page is about to navigate: the unsaved guard stands down. */
export const $newDone = atom(false);
/**
 * The entry was created but linking it to the parent project failed (`parentLinked: false`): the page stays and
 * offers the entry instead of navigating.
 */
export const $newPartial = atom<{ url: string; message: string } | null>(null);

// ---------------------------------------------------------------- validation

/** Validation errors by field id, unfiltered (see `$newErrors` for what the form shows). */
function allErrors(meta: NewEntryMeta, draft: NewEntryDraft): Record<string, string> {
  const all = $entries.get();
  const projects = all.project;
  return validateDraft(meta.dataset, draft, {
    existing: new Set(all[meta.dataset]?.entries.map((e) => e.slug)),
    // Only a loaded list can say the prefilled project does not exist.
    projects: projects?.status === 'ready' ? new Set(projects.entries.map((e) => e.slug)) : null,
  });
}

/**
 * What the form shows: server errors plus the validation errors, but before the first Create attempt only the
 * name rule once a name has been typed (it is live, like the DataForm) and a prefilled project that is missing.
 */
export const $newErrors = computed(
  [$newDraft, $newMeta, $newAttempted, $newServerErrors, $entries],
  (draft, meta, attempted, server): Record<string, string> => {
    if (draft === null || meta === null) return {};
    const errors = allErrors(meta, draft);
    const shown: Record<string, string> = {};
    if (attempted) Object.assign(shown, errors);
    else {
      if (draft.name !== '' && errors.name !== undefined) shown.name = errors.name;
      if (errors.parent !== undefined) shown.parent = errors.parent;
    }
    return { ...shown, ...server };
  },
);

export const $newDirty = computed(
  [$newDraft, $newBaseline, $newDone],
  (draft, baseline, done): boolean => {
    if (done || draft === null || baseline === null) return false;
    return JSON.stringify(draft) !== JSON.stringify(baseline);
  },
);

// ---------------------------------------------------------------- navigation after a create

/** sessionStorage key: a navigation that started after a create and was interrupted by the dev reload. */
const NAV_KEY = 'new-entry-nav';
const NAV_MAX_AGE_MS = 15_000;
/** How long to wait for the new entry to be listed before navigating anyway (it exists: the API said 201). */
const LISTED_TIMEOUT_MS = 3000;

/** A navigation interrupted by the dev reload resumes here (fresh, same-origin path only). */
function resumeNavigation(): boolean {
  const raw = takeSave(NAV_KEY);
  if (raw === null) return false;
  const bar = raw.indexOf('|');
  const at = Number(raw.slice(0, bar));
  const url = raw.slice(bar + 1);
  if (
    bar === -1 ||
    !Number.isFinite(at) ||
    Date.now() - at > NAV_MAX_AGE_MS ||
    !url.startsWith('/') ||
    url.startsWith('//')
  ) {
    return false;
  }
  $newDone.set(true);
  location.assign(url);
  return true;
}

/** Park the target, wait (bounded) until the entry is listed, then go; a reload that lands first resumes it. */
async function navigateToCreated(dataset: NewEntryDataset, slug: string, url: string) {
  $newDone.set(true);
  rememberSave(NAV_KEY, `${Date.now()}|${url}`);
  await waitForEntry(dataset, slug, { timeoutMs: LISTED_TIMEOUT_MS, intervalMs: 150 });
  takeSave(NAV_KEY);
  location.assign(url);
}

// ---------------------------------------------------------------- init / editing

/** Reset the form for `meta` and start loading what it lists (existing names, projects). */
export function initNewEntry(meta: NewEntryMeta): void {
  $newMeta.set(meta);
  const draft = blankDraft(meta.dataset, meta.parent);
  $newDraft.set(draft);
  $newBaseline.set(draft);
  $newAttempted.set(false);
  $newServerErrors.set({});
  $newSave.set({ kind: 'idle' });
  $newDone.set(false);
  $newPartial.set(null);
  if (resumeNavigation()) return;
  ensureEntries(meta.dataset);
  ensureEntries('project');
}

/** An edit makes an old "failed" message stale. */
function touch(): void {
  if ($newSave.get().kind === 'error') $newSave.set({ kind: 'idle' });
}

function clearServerErrors(...ids: string[]): void {
  const errors = $newServerErrors.get();
  if (ids.every((id) => errors[id] === undefined)) return;
  const next = { ...errors };
  for (const id of ids) delete next[id];
  $newServerErrors.set(next);
}

/** Replace one field of the draft (stored as typed; trimmed on submit). */
export function setNewField<K extends NewEntryField>(id: K, value: NewEntryDraft[K]): void {
  const draft = $newDraft.get();
  if (draft === null) return;
  touch();
  clearServerErrors(id, FORM_ERROR_KEY);
  $newDraft.set({ ...draft, [id]: value });
}

// ---------------------------------------------------------------- submit

export type NewEntrySubmit = 'invalid' | 'sent' | 'busy';

interface CreatedBody {
  url?: string;
  parentLinked?: boolean;
  parentError?: string;
}

/**
 * Create. Client-side validation first ('invalid': the component focuses the first invalid field), then POST.
 * A 201 navigates to the new entry (see `navigateToCreated`); a failure leaves the form editable.
 */
export async function submitNewEntry(): Promise<NewEntrySubmit> {
  const meta = $newMeta.get();
  const draft = $newDraft.get();
  if (meta === null || draft === null) return 'invalid';
  if ($newSave.get().kind === 'saving' || $newDone.get()) return 'busy';
  $newAttempted.set(true);
  if (Object.keys(allErrors(meta, draft)).length > 0) {
    $newSave.set({ kind: 'error', message: 'Fix the highlighted fields' });
    return 'invalid';
  }
  const { dataset } = meta;
  const def = datasetDef(dataset);
  $newSave.set({ kind: 'saving', message: 'Creating…' });
  $newServerErrors.set({});

  const res = await sendJson<CreatedBody>(
    'POST',
    `/api/entry/${dataset}`,
    buildBody(dataset, draft),
  );
  if (!res.ok) {
    const errors = failureErrors(res, def.singular);
    $newServerErrors.set(errors);
    $newSave.set({ kind: 'error', message: failureMessage(res, errors) });
    return 'sent';
  }
  const url = typeof res.body?.url === 'string' ? res.body.url : `/${dataset}/${draft.name}`;
  invalidateEntries(dataset);
  if (res.body?.parentLinked === false) {
    $newDone.set(true);
    $newPartial.set({
      url,
      message: `Created, but it could not be added to project ${draft.parent ?? ''}: ${res.body.parentError ?? 'unknown error'}`,
    });
    $newSave.set({ kind: 'error', message: 'Created, but not linked to the project' });
    return 'sent';
  }
  $newSave.set({ kind: 'saved', message: `Created ${def.singular}, opening…` });
  await navigateToCreated(dataset, draft.name, url);
  return 'sent';
}
