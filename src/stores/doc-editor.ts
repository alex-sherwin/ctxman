// DocEditor state (ROUND2_UI_SPEC §F.1): the markdown source of ONE okf / skill file, edited in a Monaco
// editor that sits next to the server-rendered preview. URL-synced per UI_SPEC §0.3: `onMount($docEdit)` reads
// `?edit=1` and registers popstate; actions are plain functions that `.set()` stores and call
// `history.replaceState` themselves (edit mode never adds history entries); popstate re-reads the URL and never
// writes history. Imported only by the client:only DocEditor island.
//
// Save model: explicit Save (PUT /api/doc with `ifUnmodifiedSince`), a 409 opens the ConflictDialog, a 200
// switches back to the preview and dims it until the page reloads (the dev server reloads by itself ~0.7 s
// after the file changes; `pnpm start` has no watcher, so a 2 s fallback reload runs). Unsaved text is mirrored
// to sessionStorage so a reload caused by ANOTHER file does not lose it.
// Stale preview after the dev reload: Astro's content layer re-reads the file ~1 s after the write, so the page
// the dev reload brings can still render the OLD markdown. The remembered "Saved" record therefore carries a
// `reloads` counter: the page that consumes a record with `reloads < MAX_SETTLE_RELOADS` schedules exactly ONE more
// `location.reload()` (SETTLE_RELOAD_MS later) and writes the record again with `reloads + 1`, so "Saved" stays
// visible across it and a further reload is never scheduled (no loop, whatever reloads the page).
import { atom, computed, onMount } from 'nanostores';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { parseEditUrl, withParams } from '../lib/url-state.ts';
import { getJson, sendJson } from '../ui/edit/api.ts';
import { clearDraft, loadDraft, saveDraft } from '../ui/edit/draft-backup.ts';
import { rememberSave, takeSave } from '../ui/edit/last-save.ts';
import type { SaveStatus } from '../ui/edit/status.ts';

export type DocDataset = OkfDatasetId | 'skill';

export interface DocTarget {
  dataset: DocDataset;
  slug: string;
  /** Bundle-relative posix path, e.g. 'main.md', 'SKILL.md', 'concepts/search.md'. */
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

/** A validator finding returned by the doc API (`src/lib/findings.ts`), reduced to what the UI shows. */
export interface DocWarning {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  line?: number;
}

/** After a save the dev server normally reloads within ~0.7 s; this is the fallback (`pnpm start`). */
export const RELOAD_FALLBACK_MS = 2000;
/** The one extra reload that follows the first post-save reload: the content layer needs ~1 s to re-read the file. */
export const SETTLE_RELOAD_MS = 1500;
/** How many settle reloads a save may cause (the `reloads` counter of the remembered record). */
export const MAX_SETTLE_RELOADS = 1;
const MAX_WARNINGS = 50;

export const $docTarget = atom<DocTarget | null>(null);
/** `?edit=1`. */
export const $docEdit = atom<boolean>(false);
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
/** A sessionStorage draft was restored into the editor. */
export const $docRestored = atom<boolean>(false);
/** A save succeeded and the page has not reloaded yet: the SSR preview is stale (dimmed). */
export const $docStale = atom<boolean>(false);
/** Validator findings of the last successful save. */
export const $docWarnings = atom<readonly DocWarning[]>([]);

// ---------------------------------------------------------------- helpers

/** sessionStorage key of a file: draft backup and the remembered "Saved". */
export const docKey = (t: DocTarget): string => `doc:${t.dataset}/${t.slug}/${t.path}`;

/** `/api/doc/<dataset>/<slug>/<path>` with each path segment URI-encoded. */
export function docUrl(t: DocTarget): string {
  return `/api/doc/${t.dataset}/${encodeURIComponent(t.slug)}/${t.path.split('/').map(encodeURIComponent).join('/')}`;
}

const sameTarget = (a: DocTarget, b: DocTarget): boolean =>
  a.dataset === b.dataset && a.slug === b.slug && a.path === b.path;

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function toWarnings(value: unknown): DocWarning[] {
  if (!Array.isArray(value)) return [];
  const out: DocWarning[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const f = item as Record<string, unknown>;
    if (typeof f.message !== 'string') continue;
    const warning: DocWarning = {
      severity: f.severity === 'error' ? 'error' : 'warning',
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
  /** Settle reloads already done for this save (0 right after the save itself). */
  reloads: number;
}

/** The text `last-save.ts` carries across the post-save reload: the status message, the findings, `reloads`. */
function encodeSaved(record: SavedRecord): string {
  return JSON.stringify(record);
}

function decodeSaved(raw: string): SavedRecord {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const p = parsed as { message?: unknown; warnings?: unknown; reloads?: unknown };
      if (typeof p.message === 'string') {
        const reloads =
          typeof p.reloads === 'number' && Number.isInteger(p.reloads) && p.reloads > 0
            ? p.reloads
            : 0;
        return { message: p.message, warnings: toWarnings(p.warnings), reloads };
      }
    }
  } catch {
    // a plain-text message
  }
  return { message: raw, warnings: [], reloads: 0 };
}

// ---------------------------------------------------------------- URL plumbing

function readEdit(): boolean {
  return parseEditUrl(new URLSearchParams(location.search)).edit;
}

/** `edit=1` on / off in the current URL (replaceState: edit mode never creates history entries). */
function replaceEdit(edit: boolean): void {
  history.replaceState(
    history.state,
    '',
    withParams(`${location.pathname}${location.search}${location.hash}`, {
      edit: edit ? '1' : null,
    }),
  );
}

function onPopState(): void {
  const edit = readEdit();
  $docEdit.set(edit);
  if (edit && $docTarget.get() !== null && $docLoad.get().status === 'idle') void loadDoc();
}

onMount($docEdit, () => {
  $docEdit.set(readEdit());
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
});

// ---------------------------------------------------------------- reload fallback

let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/** Reload once the dev reload had its chance; skipped while the user is editing again. */
function scheduleReload(): void {
  if (reloadTimer !== undefined) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = undefined;
    if ($docEdit.get()) return;
    location.reload();
  }, RELOAD_FALLBACK_MS);
}

let settleTimer: ReturnType<typeof setTimeout> | undefined;

function cancelSettleReload(): void {
  if (settleTimer !== undefined) clearTimeout(settleTimer);
  settleTimer = undefined;
}

/**
 * The ONE extra reload after a save (see the header): the content layer may not have re-read the file when the
 * dev reload fired. The record is written again with `reloads + 1` just before reloading so the next page still
 * shows "Saved" and schedules nothing. Skipped while the user is editing again (an `$docStale` preview then makes
 * `discardEdit` reload through the fallback).
 */
function scheduleSettleReload(key: string, record: SavedRecord): void {
  cancelSettleReload();
  settleTimer = setTimeout(() => {
    settleTimer = undefined;
    if ($docEdit.get()) {
      $docStale.set(true);
      return;
    }
    rememberSave(key, encodeSaved({ ...record, reloads: record.reloads + 1 }));
    location.reload();
  }, SETTLE_RELOAD_MS);
}

// ---------------------------------------------------------------- loading

let loadSeq = 0;

function resetDoc(): void {
  loadSeq++;
  cancelSettleReload();
  $docLoad.set({ status: 'idle' });
  $docBaseline.set(null);
  $docDraft.set('');
  $docSave.set({ kind: 'idle' });
  $docConflict.set(false);
  $docRestored.set(false);
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
  const key = docKey(target);
  const saved = takeSave(key);
  if (saved !== null) {
    const decoded = decodeSaved(saved);
    $docSave.set({ kind: 'saved', message: decoded.message });
    $docWarnings.set(decoded.warnings);
    if (decoded.reloads < MAX_SETTLE_RELOADS) scheduleSettleReload(key, decoded);
  }
  if (initialEdit && !$docEdit.get()) $docEdit.set(true);
  if ($docEdit.get() && $docLoad.get().status === 'idle') void loadDoc();
}

interface DocGetBody {
  markdown: string;
  lastModified: string;
}

/** GET the file; adopt it as baseline + draft, restoring a sessionStorage draft that was started from it. */
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
  let draft = markdown;
  let restored = false;
  const backup = loadDraft(key);
  if (backup !== null) {
    if (backup.base === lastModified && backup.text !== markdown) {
      draft = backup.text;
      restored = true;
    } else {
      clearDraft(key);
    }
  }
  $docBaseline.set({ text: markdown, lastModified });
  $docDraft.set(draft);
  $docRestored.set(restored);
  $docConflict.set(false);
  const { kind } = $docSave.get();
  if (kind === 'error' || kind === 'conflict') $docSave.set({ kind: 'idle' });
  $docLoad.set({ status: 'ready' });
}

// ---------------------------------------------------------------- actions

/** Preview -> Edit. Always re-reads the file so the editor never starts from stale text. */
export function enterEdit(): void {
  if ($docEdit.get() || $docTarget.get() === null) return;
  replaceEdit(true);
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
}

/** The "Discard" of the restored-draft banner: back to the saved text, backup removed. */
export function discardDraft(): void {
  const target = $docTarget.get();
  if (target !== null) clearDraft(docKey(target));
  $docDraft.set($docBaseline.get()?.text ?? '');
  $docRestored.set(false);
  touch();
}

/** Leave edit mode without saving: draft dropped, `edit` removed from the URL, preview shown again. */
export function discardEdit(): void {
  const target = $docTarget.get();
  if (target !== null) clearDraft(docKey(target));
  replaceEdit(false);
  $docEdit.set(false);
  $docDraft.set($docBaseline.get()?.text ?? '');
  $docRestored.set(false);
  $docConflict.set(false);
  touch();
  if ($docStale.get()) scheduleReload();
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
  void loadDoc();
}

interface DocPutBody {
  lastModified: string;
  warnings?: unknown;
}

/**
 * PUT the draft. `force` omits `ifUnmodifiedSince` (the ConflictDialog's "Overwrite"). A clean draft is not
 * saved (Cmd/Ctrl+S on unchanged text does nothing), except when forced.
 */
export async function saveDoc(opts: { force?: boolean } = {}): Promise<void> {
  const target = $docTarget.get();
  const baseline = $docBaseline.get();
  if (target === null || baseline === null || $docSave.get().kind === 'saving') return;
  const force = opts.force === true;
  if (!force && !$docDirty.get()) return;
  const text = $docDraft.get();
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
  cancelSettleReload(); // a newer save supersedes the record the old timer would write back
  rememberSave(key, encodeSaved({ message, warnings, reloads: 0 }));
  $docRestored.set(false);
  $docWarnings.set(warnings);
  $docSave.set({ kind: 'saved', message });
  $docStale.set(true);
  replaceEdit(false);
  $docEdit.set(false);
  scheduleReload();
}
