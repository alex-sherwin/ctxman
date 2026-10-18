// Tools page state (UI_SPEC §I.2, PLAN §A.12.5). `?add=<dataset>` preselects the Add Entry dataset
// (replaceState on change). A script run is an action result, not URL state, but the last finished run is
// kept in sessionStorage: `add` for okf / skill / reference datasets triggers an `astro dev` full reload
// (PLAN §A.2), and the output must survive it. A successful `add` then opens the new entry (ROUND2_UI_SPEC §I):
// the saved run carries a `follow` flag so the reload resumes the navigation. Imported only by the client:only
// ToolsRunner island.
import { atom, map, onMount } from 'nanostores';
import { entryUrl } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import { parseToolsUrl, withParams } from '../lib/url-state.ts';
import { waitForEntry } from './entries.ts';

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'error';
  script?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
  created?: { dataset: DatasetId; slug: string; path: string; url: string };
  /** An `add` run whose new entry page is about to be opened. Saved with the run, so a dev reload resumes it. */
  follow?: boolean;
  /** Epoch ms after which a saved `follow` is dropped instead of resumed (a restored stale tab). */
  followUntil?: number;
  /** The new entry was not listed within the wait: the result panel stays and says so. */
  followTimedOut?: boolean;
}

const STORAGE_KEY = 'ctxman:tools:last-run';
/** How long one wait for the new entry to be listed may last (the glob watcher needs ~0.7 s). */
const FOLLOW_TIMEOUT_MS = 5000;
const FOLLOW_INTERVAL_MS = 150;
/** A saved `follow` older than this is not resumed (covers the wait plus the dev reload). */
const FOLLOW_WINDOW_MS = 15_000;
/** Contexts and recipes are read from disk per request: listed at once, no waiting. */
const IMMEDIATE: readonly DatasetId[] = ['context', 'recipe'];
/** Bumped to cancel a wait in progress (clear, another run); a wait only navigates while its token is current. */
let followToken = 0;

export const $addDataset = atom<DatasetId | null>(null);
export const $run = atom<RunState>({ status: 'idle' });
/** Exit code of the most recent finished run of each script (for the badge in the script list). */
export const $exitCodes = map<Record<string, number>>({});

// ---------------------------------------------------------------- sessionStorage (every access guarded)

function saveRun(run: RunState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(run));
  } catch {
    // private mode / quota: the output simply does not survive a reload
  }
}

function forgetRun(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isRestorable(value: unknown): value is RunState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.status === 'done' && typeof v.script === 'string' && typeof v.code === 'number';
}

function restoreRun(): void {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (!isRestorable(parsed)) return;
    // Runs saved before `created.url` existed.
    if (parsed.created !== undefined && typeof parsed.created.url !== 'string') {
      parsed.created.url = entryUrl(parsed.created.dataset, parsed.created.slug);
    }
    const resume =
      parsed.follow === true &&
      typeof parsed.followUntil === 'number' &&
      Date.now() <= parsed.followUntil &&
      parsed.created !== undefined;
    if (parsed.follow === true && !resume) {
      parsed.follow = false;
      saveRun(parsed);
    }
    $run.set(parsed);
    if (parsed.script !== undefined && parsed.code !== undefined) {
      $exitCodes.setKey(parsed.script, parsed.code);
    }
    if (resume) void followCreated();
  } catch {
    // corrupt entry: ignore
  }
}

/** Back / forward cache restore: the page is shown as it was left, but its navigation is long over. */
function onPageShow(event: PageTransitionEvent): void {
  const run = $run.get();
  if (event.persisted && run.follow === true) $run.set({ ...run, follow: false });
}

// ---------------------------------------------------------------- URL

function applyUrl(): void {
  $addDataset.set(parseToolsUrl(new URLSearchParams(location.search)).add);
}

onMount($addDataset, () => {
  applyUrl();
  restoreRun();
  window.addEventListener('popstate', applyUrl);
  window.addEventListener('pageshow', onPageShow);
  return () => {
    window.removeEventListener('popstate', applyUrl);
    window.removeEventListener('pageshow', onPageShow);
  };
});

export function setAddDataset(dataset: DatasetId): void {
  $addDataset.set(dataset);
  history.replaceState(
    history.state,
    '',
    withParams(`${location.pathname}${location.search}${location.hash}`, { add: dataset }),
  );
}

// ---------------------------------------------------------------- runs

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown; issues?: unknown };
    const issues = Array.isArray(body.issues)
      ? (body.issues as { path?: string; message?: string }[])
          .map((i) => (i.path ? `${i.path}: ${i.message ?? ''}` : (i.message ?? '')))
          .filter(Boolean)
      : [];
    const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
    return issues.length > 0 ? `${message} (${issues.join('; ')})` : message;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/**
 * POST /api/scripts/<name> with a JSON body (`{}` for the check scripts). `status: 'error'` means the
 * request itself failed (HTTP / network); a script that exits non-zero is still `done`.
 */
export async function runScript(name: string, body?: object): Promise<void> {
  if ($run.get().status === 'running') return;
  cancelFollow();
  $run.set({ status: 'running', script: name });
  try {
    const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) {
      $run.set({ status: 'error', script: name, error: await errorMessage(res) });
      return;
    }
    const result = (await res.json()) as {
      code: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      created?: RunState['created'];
    };
    const done: RunState = {
      status: 'done',
      script: name,
      code: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    };
    if (result.created !== undefined) {
      done.created = result.created;
      // Open the new entry. Saved with the run BEFORE the wait: the dev reload that a new okf / skill / reference
      // file triggers interrupts the wait, and the restored run resumes it.
      done.follow = true;
      done.followUntil = Date.now() + FOLLOW_WINDOW_MS;
    }
    $run.set(done);
    $exitCodes.setKey(name, result.code);
    saveRun(done);
    if (done.follow === true) void followCreated();
  } catch (error) {
    $run.set({
      status: 'error',
      script: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function clearRun(): void {
  if ($run.get().status === 'running') return;
  followToken += 1;
  $run.set({ status: 'idle' });
  forgetRun();
}

// ---------------------------------------------------------------- open the created entry

/** Stop opening the created entry and make sure a reload does not resume it. */
function cancelFollow(): void {
  followToken += 1;
  const run = $run.get();
  if (run.follow === true) saveRun({ ...run, follow: false });
}

/**
 * Open the entry the finished `add` run created (ROUND2_UI_SPEC §I). Contexts and recipes are listed at once, so
 * the page is opened right away; okf / skill / reference entries first wait until `/api/entries` lists them (a
 * 404 must never be shown). A timeout keeps the result panel and sets `followTimedOut`. `follow` is saved as
 * false BEFORE the navigation, so coming back to /tools never navigates again.
 */
async function followCreated(): Promise<void> {
  const run = $run.get();
  const created = run.created;
  if (run.status !== 'done' || run.follow !== true || created === undefined) return;
  followToken += 1;
  const token = followToken;
  if (!IMMEDIATE.includes(created.dataset)) {
    const found = await waitForEntry(created.dataset, created.slug, {
      timeoutMs: FOLLOW_TIMEOUT_MS,
      intervalMs: FOLLOW_INTERVAL_MS,
    });
    if (token !== followToken) return;
    if (!found) {
      const next: RunState = { ...$run.get(), follow: false, followTimedOut: true };
      $run.set(next);
      saveRun(next);
      return;
    }
  }
  // The panel keeps showing "Opening…" until the page unloads; only the saved copy is settled.
  saveRun({ ...$run.get(), follow: false });
  location.assign(created.url);
}
