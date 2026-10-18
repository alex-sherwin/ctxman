// Tools page state (UI_SPEC §I.2, PLAN §A.12.5). `?add=<dataset>` preselects the "New entry" panel's dataset
// (replaceState on change). A script run is an action result, not URL state, but the last finished run is kept in
// sessionStorage so the output survives a page reload. Creating entries moved to the /new/<ds> forms (ROUND3_SPEC
// §E.7), so a run never navigates anywhere. Imported only by the client:only ToolsRunner island.
import { atom, map, onMount } from 'nanostores';
import type { DatasetId } from '../datasets/registry.ts';
import { parseToolsUrl, withParams } from '../lib/url-state.ts';
import { failureText, sendJson } from '../ui/edit/api.ts';

export interface RunState {
  status: 'idle' | 'running' | 'done' | 'error';
  script?: string;
  code?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  error?: string;
}

const STORAGE_KEY = 'ctxman:tools:last-run';

/** The dataset chosen in the New entry panel (`?add=`), or null. */
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
    $run.set(parsed);
    if (parsed.script !== undefined && parsed.code !== undefined) {
      $exitCodes.setKey(parsed.script, parsed.code);
    }
  } catch {
    // corrupt entry: ignore
  }
}

// ---------------------------------------------------------------- URL

function applyUrl(): void {
  $addDataset.set(parseToolsUrl(new URLSearchParams(location.search)).add);
}

onMount($addDataset, () => {
  applyUrl();
  restoreRun();
  window.addEventListener('popstate', applyUrl);
  return () => window.removeEventListener('popstate', applyUrl);
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

/**
 * POST /api/scripts/<name> with an empty JSON body (the check scripts take no input). `status: 'error'` means the
 * request itself failed (HTTP / network); a script that exits non-zero is still `done`.
 */
export async function runScript(name: string): Promise<void> {
  if ($run.get().status === 'running') return;
  $run.set({ status: 'running', script: name });
  const res = await sendJson<{
    code: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>('POST', `/api/scripts/${encodeURIComponent(name)}`, {});
  if (!res.ok) {
    $run.set({ status: 'error', script: name, error: failureText(res) });
    return;
  }
  const result = res.body;
  const done: RunState = {
    status: 'done',
    script: name,
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };
  $run.set(done);
  $exitCodes.setKey(name, result.code);
  saveRun(done);
}

export function clearRun(): void {
  if ($run.get().status === 'running') return;
  $run.set({ status: 'idle' });
  forgetRun();
}
