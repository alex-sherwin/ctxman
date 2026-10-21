// DocEditor state (ROUND2_UI_SPEC §F.1): the markdown source of ONE okf / skill file, edited in a Monaco
// editor that sits next to the server-rendered preview. URL-synced per UI_SPEC §0.3: `onMount($docEdit)` reads
// `?edit=1` and registers popstate; actions are plain functions that `.set()` stores and call
// `history.pushState` themselves (every switch between preview and edit, a save included, is a history entry, so
// Back and Forward switch modes); popstate re-reads the URL and only writes history to undo a step out of an
// editor with unsaved text.
//
// Leaving unsaved text: the Preview toggle / Cancel, Back or Forward out of the editor and a click on a link all go
// through `requestLeave`, which asks first (`$docLeave`, the island's "Discard unsaved changes?" dialog). Back and
// Forward cannot be cancelled, so the edit URL is pushed back on top while the dialog is open. Anything else that
// unloads the page (reload, closing the tab, a typed URL) meets the browser's own prompt (`useUnsavedGuard`). Imported by the client:only DocEditor island and, for `$docEditing`, the EntryTools island.
// `$docEdit` is only the URL flag: other pages use `?edit=1` too (the reference DataForm has no DocEditor), so
// whatever must know that a DocEditor is really open (EntryTools' lock, the post-write reload) reads `$docEditing`.
//
// Save model: explicit Save (PUT /api/doc with `ifUnmodifiedSince`; an okf file's frontmatter `modified` is stamped
// with the save time first, in the editor text too), a 409 opens the ConflictDialog, a 200
// switches back to the preview, dims it and reloads the page ~150 ms later (RELOAD_AFTER_SAVE_MS): the server
// renders the file from disk on every request, so the reloaded page is current and no watcher is involved.
// Unsaved text is mirrored to localStorage (draft-backup.ts, 14 days) on every change, so a reload caused by
// ANOTHER file, a closed tab or a crash does not lose it; there is NO native `beforeunload` prompt (ROUND3_SPEC
// §G). `loadDoc` restores the draft whenever it differs from the disk text; when the file ALSO changed on disk
// since the draft was started (`base` != `lastModified`) it is restored with `$docDraftStale` set (saving then
// overwrites the newer disk version, which the banner says). In preview mode `$docDraftAvailable` tells the island
// that a draft exists ("Resume editing").
import { atom, computed, onMount } from 'nanostores';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { stampModified } from '../lib/frontmatter-patch.ts';
import { plural } from '../lib/text.ts';
import { parseEditUrl, withParams } from '../lib/url-state.ts';
import { getJson, sendJson } from '../ui/edit/api.ts';
import { clearDraft, hasDraft, loadDraft, saveDraft } from '../ui/edit/draft-backup.ts';
import { rememberSave, takeSave } from '../ui/edit/last-save.ts';
import { allowUnload } from '../ui/edit/unload-guard.ts';
import type { SaveStatus } from '../ui/edit/status.ts';
import { planRestore } from '../ui/markdown/draft-restore.ts';

export type DocDataset = OkfDatasetId | 'skill';

export interface DocTarget {
  dataset: DocDataset;
  slug: string;
  /** Bundle-relative posix path, e.g. 'index.md', 'SKILL.md', 'concepts/search.md'. */
  path: string;
}

export interface DocLoad {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
}

export interface DocBaseline {
  text: string;
  /** ISO mtime from the GET / PUT; sent back as `ifUnmodifiedSince`. */
  lastModified: string;
}

/**
 * A validator finding returned by the doc API (`src/lib/findings.ts`), reduced to what the UI shows. The save
 * never blocks, so EVERY finding is a warning here, whatever its `severity` (the link checks report `error`).
 */
export interface DocWarning {
  rule: string;
  message: string;
  line?: number;
}

/** After a successful save the page reloads this long later (unless the user re-entered edit mode). */
export const RELOAD_AFTER_SAVE_MS = 150;
const MAX_WARNINGS = 50;

export const $docTarget = atom<DocTarget | null>(null);
/** `?edit=1` (also true on pages without a DocEditor, e.g. the reference form: use `$docEditing` for the lock). */
export const $docEdit = atom<boolean>(false);
/**
 * A DocEditor island is mounted (it set `$docTarget`) AND the page is in edit mode. This, not `$docEdit`, locks the
 * EntryTools buttons and holds back the post-write reload: on `/reference/<slug>?edit=1` (DataForm, no DocEditor)
 * `$docEdit` is true but there is no draft whose base a PATCH could invalidate.
 */
export const $docEditing = computed(
  [$docTarget, $docEdit],
  (target, edit) => target !== null && edit,
);
export const $docLoad = atom<DocLoad>({ status: 'idle' });
/** Last loaded / saved server copy. */
export const $docBaseline = atom<DocBaseline | null>(null);
/** The editable text. */
export const $docDraft = atom<string>('');
export const $docDirty = computed([$docBaseline, $docDraft], (b, d) => b !== null && b.text !== d);
export const $docSave = atom<SaveStatus>({ kind: 'idle' });
/** What SaveBar shows: unsaved edits read as 'dirty' unless a save/error status is more specific. */
export const $docStatus = computed([$docSave, $docDirty], (s, dirty): SaveStatus =>
  s.kind === 'idle' && dirty ? { kind: 'dirty' } : s,
);
/** The ConflictDialog is open (the last PUT answered 409). */
export const $docConflict = atom<boolean>(false);
/** A localStorage draft was restored into the editor. */
export const $docRestored = atom<boolean>(false);
/** The restored draft was started from an older version of the file: the file changed on disk since. */
export const $docDraftStale = atom<boolean>(false);
/** A draft of this file is stored (checked on page load and after every change to it): "Resume editing". */
export const $docDraftAvailable = atom<boolean>(false);
/** A save succeeded and the page has not reloaded yet: the SSR preview is stale (dimmed). */
export const $docStale = atom<boolean>(false);
/** Validator findings of the last successful save. */
export const $docWarnings = atom<readonly DocWarning[]>([]);

/** A way out of edit mode that would drop unsaved text: back to the preview, or away to another page. */
export type DocLeave = { kind: 'preview' } | { kind: 'link'; href: string };
/** The leave the "Discard unsaved changes?" dialog is asking about; null = no dialog. */
export const $docLeave = atom<DocLeave | null>(null);

// ---------------------------------------------------------------- helpers

/** Storage key of a file: draft backup (localStorage) and the remembered "Saved" (sessionStorage). */
export const docKey = (t: DocTarget): string => `doc:${t.dataset}/${t.slug}/${t.path}`;

/** `/api/doc/<dataset>/<slug>/<path>` with each path segment URI-encoded. */
export function docUrl(t: DocTarget): string {
  return `/api/doc/${t.dataset}/${encodeURIComponent(t.slug)}/${t.path.split('/').map(encodeURIComponent).join('/')}`;
}

const sameTarget = (a: DocTarget, b: DocTarget): boolean =>
  a.dataset === b.dataset && a.slug === b.slug && a.path === b.path;

/** Re-reads whether a draft of the current file is stored. */
function syncDraftAvailable(): void {
  const target = $docTarget.get();
  $docDraftAvailable.set(target !== null && hasDraft(docKey(target)));
}

function toWarnings(value: unknown): DocWarning[] {
  if (!Array.isArray(value)) return [];
  const out: DocWarning[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    if (typeof f.message !== 'string') continue;
    const warning: DocWarning = {
      rule: typeof f.rule === 'string' ? f.rule : '',
      message: f.message,
    };
    if (typeof f.line === 'number') warning.line = f.line;
    out.push(warning);
    if (out.length >= MAX_WARNINGS) break;
  }
  return out;
}

interface SavedRecord {
  message: string;
  warnings: DocWarning[];
}

/** The text `last-save.ts` carries across the post-save reload: the status message and the findings. */
function encodeSaved(record: SavedRecord): string {
  return JSON.stringify(record);
}

function decodeSaved(raw: string): SavedRecord {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as { message?: unknown; warnings?: unknown };
      if (typeof p.message === 'string') {
        return { message: p.message, warnings: toWarnings(p.warnings) };
      }
    }
  } catch {
    // a plain-text message
  }
  return { message: raw, warnings: [] };
}

// ---------------------------------------------------------------- URL plumbing

function readEdit(): boolean {
  return parseEditUrl(new URLSearchParams(location.search)).edit;
}

/** `edit=1` on / off as a NEW history entry: Back returns to the other mode. */
function pushEdit(edit: boolean): void {
  history.pushState(
    history.state,
    '',
    withParams(`${location.pathname}${location.search}${location.hash}`, {
      edit: edit ? '1' : null,
    }),
  );
}

function onPopState(): void {
  const edit = readEdit();
  // Back or Forward out of an editor with unsaved text: undo the step (the edit URL goes back on top) and ask.
  if (!edit && $docEditing.get() && $docDirty.get()) {
    pushEdit(true);
    $docLeave.set({ kind: 'preview' });
    return;
  }
  $docEdit.set(edit);
  syncDraftAvailable();
  if (!edit) $docConflict.set(false);
  // Back into the editor: re-read the file like `enterEdit`, unless unsaved text is still in it.
  if (edit && $docTarget.get() !== null && $docLoad.get().status !== 'loading' && !$docDirty.get())
    void loadDoc();
}

onMount($docEdit, () => {
  $docEdit.set(readEdit());
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
});

// ---------------------------------------------------------------- reload after a save

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/** Reload shortly after a save; skipped while the user is editing again (`discardEdit` then reloads). */
function scheduleReload(): void {
  if (reloadTimer !== undefined) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = undefined;
    if ($docEdit.get()) return;
    location.reload();
  }, RELOAD_AFTER_SAVE_MS);
}

// ---------------------------------------------------------------- loading

let loadSeq = 0;

function resetDoc(): void {
  loadSeq++;
  $docLoad.set({ status: 'idle' });
  $docBaseline.set(null);
  $docDraft.set('');
  $docSave.set({ kind: 'idle' });
  $docConflict.set(false);
  $docRestored.set(false);
  $docDraftStale.set(false);
  $docDraftAvailable.set(false);
  $docStale.set(false);
  $docWarnings.set([]);
}

/**
 * Mount-time setup for the island: remember which file this is, show the "Saved" the previous page left, and
 * load the file when the URL asks for edit mode. `initialEdit` is the server's reading of the same `?edit=1`.
 */
export function initDoc(target: DocTarget, initialEdit = false): void {
  const previous = $docTarget.get();
  if (previous !== null && !sameTarget(previous, target)) resetDoc();
  $docTarget.set(target);
  syncDraftAvailable();
  const key = docKey(target);
  const saved = takeSave(key);
  if (saved !== null) {
    const decoded = decodeSaved(saved);
    $docSave.set({ kind: 'saved', message: decoded.message });
    $docWarnings.set(decoded.warnings);
  }
  if (initialEdit && !$docEdit.get()) $docEdit.set(true);
  if ($docEdit.get() && $docLoad.get().status === 'idle') void loadDoc();
}

interface DocGetBody {
  markdown: string;
  lastModified: string;
}

/** GET the file; adopt it as baseline + draft, restoring a stored draft (stale or not: see the header). */
export async function loadDoc(): Promise<void> {
  const target = $docTarget.get();
  if (target === null) return;
  const seq = ++loadSeq;
  $docLoad.set({ status: 'loading' });
  const res = await getJson<DocGetBody>(docUrl(target));
  if (seq !== loadSeq) return;
  if (!res.ok) {
    $docLoad.set({ status: 'error', message: res.message });
    return;
  }
  const { markdown, lastModified } = res.body;
  const key = docKey(target);
  const backup = loadDraft(key);
  const plan = planRestore(backup, { text: markdown, lastModified });
  if (backup !== null && !plan.restored) clearDraft(key); // identical to the disk text: nothing to keep
  $docBaseline.set({ text: markdown, lastModified });
  $docDraft.set(plan.text);
  $docRestored.set(plan.restored);
  $docDraftStale.set(plan.stale);
  syncDraftAvailable();
  $docConflict.set(false);
  const { kind } = $docSave.get();
  if (kind === 'error' || kind === 'conflict') $docSave.set({ kind: 'idle' });
  $docLoad.set({ status: 'ready' });
}

// ---------------------------------------------------------------- actions

/** Preview -> Edit. Always re-reads the file so the editor never starts from stale text. */
export function enterEdit(): void {
  if ($docEdit.get() || $docTarget.get() === null) return;
  pushEdit(true);
  $docEdit.set(true);
  if ($docSave.get().kind === 'saved') $docSave.set({ kind: 'idle' });
  if ($docLoad.get().status !== 'loading') void loadDoc();
}

/** An edit makes an old "Saved" / "Save failed" message stale. */
function touch(): void {
  const { kind } = $docSave.get();
  if (kind !== 'idle' && kind !== 'saving') $docSave.set({ kind: 'idle' });
}

export function setDocDraft(text: string): void {
  $docDraft.set(text);
  touch();
  const target = $docTarget.get();
  const baseline = $docBaseline.get();
  if (target === null || baseline === null) return;
  if (text !== baseline.text) saveDraft(docKey(target), { text, base: baseline.lastModified });
  else clearDraft(docKey(target));
  syncDraftAvailable();
}

/** The "Discard" of the restored-draft banner: back to the saved text, backup removed. */
export function discardDraft(): void {
  const target = $docTarget.get();
  if (target !== null) clearDraft(docKey(target));
  $docDraft.set($docBaseline.get()?.text ?? '');
  $docRestored.set(false);
  $docDraftStale.set(false);
  syncDraftAvailable();
  touch();
}

/** Leave edit mode without saving: draft dropped, `edit` removed from the URL, preview shown again. */
export function discardEdit(): void {
  const target = $docTarget.get();
  if (target !== null) clearDraft(docKey(target));
  pushEdit(false);
  $docEdit.set(false);
  $docDraft.set($docBaseline.get()?.text ?? '');
  $docRestored.set(false);
  $docDraftStale.set(false);
  syncDraftAvailable();
  $docConflict.set(false);
  touch();
  if ($docStale.get()) scheduleReload();
}

/** Leave edit mode (`preview`) or the page (`link`): at once when nothing is unsaved, else after the dialog. */
export function requestLeave(leave: DocLeave): void {
  if ($docEdit.get() && $docDirty.get()) $docLeave.set(leave);
  else applyLeave(leave);
}

/** The dialog's "Discard": the unsaved text is dropped, then the leave happens. */
export function confirmLeave(): void {
  const leave = $docLeave.get();
  $docLeave.set(null);
  if (leave !== null) applyLeave(leave);
}

/** The dialog's "Cancel": stay in the editor. */
export function cancelLeave(): void {
  $docLeave.set(null);
}

function applyLeave(leave: DocLeave): void {
  if (leave.kind === 'preview') {
    discardEdit();
    return;
  }
  const target = $docTarget.get();
  if (target !== null) clearDraft(docKey(target));
  allowUnload(); // the browser's prompt must not ask a second time
  location.assign(leave.href);
}

/** The ConflictDialog's "Keep editing". */
export function keepEditing(): void {
  $docConflict.set(false);
}

/** The ConflictDialog's "Load disk version": my edits are dropped, the file is re-read. */
export function loadDiskVersion(): void {
  const target = $docTarget.get();
  if (target !== null) clearDraft(docKey(target));
  $docConflict.set(false);
  syncDraftAvailable();
  void loadDoc();
}

interface DocPutBody {
  lastModified: string;
  warnings?: unknown;
}

/**
 * PUT the draft. `force` omits `ifUnmodifiedSince` (the ConflictDialog's "Overwrite"). A clean draft is not
 * saved (Cmd/Ctrl+S on unchanged text does nothing), except when forced. An okf file is stamped first: its
 * frontmatter `modified` becomes the UTC time of this save (`stampModified`), in the editor too (the draft is the
 * stamped text, so a 409 keeps it and Overwrite stamps again). SKILL.md is never stamped (its frontmatter is strict).
 */
export async function saveDoc(opts: { force?: boolean; now?: Date } = {}): Promise<void> {
  const target = $docTarget.get();
  const baseline = $docBaseline.get();
  if (target === null || baseline === null || $docSave.get().kind === 'saving') return;
  const force = opts.force === true;
  if (!force && !$docDirty.get()) return;
  const draft = $docDraft.get();
  const text = target.dataset === 'skill' ? draft : stampModified(draft, opts.now ?? new Date());
  if (text !== draft) setDocDraft(text);
  $docConflict.set(false);
  $docSave.set({ kind: 'saving' });
  const res = await sendJson<DocPutBody>('PUT', docUrl(target), {
    markdown: text,
    ...(force ? {} : { ifUnmodifiedSince: baseline.lastModified }),
  });
  if (!res.ok) {
    if (res.status === 409) {
      $docConflict.set(true);
      $docSave.set({ kind: 'conflict', message: 'Changed on disk' });
    } else {
      $docSave.set({ kind: 'error', message: `Save failed: ${res.message}` });
    }
    return;
  }
  const warnings = toWarnings(res.body.warnings);
  const total = Array.isArray(res.body.warnings) ? res.body.warnings.length : warnings.length;
  const message = total > 0 ? `Saved · ${plural(total, 'warning')}` : 'Saved';
  const key = docKey(target);
  $docBaseline.set({ text, lastModified: res.body.lastModified });
  clearDraft(key);
  rememberSave(key, encodeSaved({ message, warnings }));
  $docRestored.set(false);
  $docDraftStale.set(false);
  syncDraftAvailable();
  $docWarnings.set(warnings);
  $docSave.set({ kind: 'saved', message });
  $docStale.set(true);
  pushEdit(false);
  $docEdit.set(false);
  scheduleReload();
}
