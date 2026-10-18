// Tools page state (UI_SPEC §I.2, PLAN §A.12.5). `?add=<dataset>` preselects the "New entry" panel's dataset
// (replaceState on change). A script run is an action result, not URL state, but the last finished run is kept in
// sessionStorage so the output survives a page reload. Creating entries moved to the /new/<ds> forms (ROUND3_SPEC
// §E.7), so a run never navigates anywhere. Imported only by the client:only ToolsRunner island.
import { atom, map, onMount } from 'nanostores';
import type { DatasetId } from '../datasets/registry.ts';
import { parseToolsUrl, withParams } from '../lib/url-state.ts';

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
 * POST /api/scripts/<name> with an empty JSON body (the check scripts take no input). `status: 'error'` means the
 * request itself failed (HTTP / network); a script that exits non-zero is still `done`.
 */
export async function runScript(name: string): Promise<void> {
  if ($run.get().status === 'running') return;
  $run.set({ status: 'running', script: name });
  try {
    const res = await fetch(`/api/scripts/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
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
    };
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
  $run.set({ status: 'idle' });
  forgetRun();
}
