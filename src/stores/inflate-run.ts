// Inflate into a working directory: run-time overrides, the dry run and the job being watched
// (plans/INFLATE_V2_SPEC.md §11.2). Imports src/stores/inflate.ts (the recipe being edited), never the reverse.
// Same patterns as inflate.ts: URL-synced pieces read `location` in `onMount`, actions are plain functions
// that set stores, time comes from `$now`. Imported only by the client:only Inflate island.
//
//   $runOverrides  what this run changes WITHOUT editing the recipe (dir, context file, primary, material per item)
//   $effective     the working recipe with those overrides applied (`applyRunOverrides`): what a run really uses
//   $dirPlan       `POST /api/inflate/plan` for $effective, refreshed 400 ms after any change
//   $job           the run being watched, polled with `GET /api/inflate/jobs/:id` every 500 ms
import { atom, computed, onMount } from 'nanostores';
import type { InflateRunOverrides, RecipeData } from '../datasets/schemas.ts';
import { CONTEXT_FILE_PATTERN, DEFAULT_CONTEXT_FILE } from '../lib/inflate/catalog.ts';
import type { MaterialId } from '../lib/inflate/catalog.ts';
import { expandRecipe } from '../lib/inflate/expand.ts';
import type { ExpandedPlan } from '../lib/inflate/expand.ts';
import type { DirPlanResponse, InflateJob } from '../lib/inflate/material-plan.ts';
import { applyRunOverrides, runOverrideCount } from '../lib/inflate/recipe.ts';
import { omit } from '../lib/object.ts';
import { parseInflateUrl } from '../lib/url-state.ts';
import { failureText, getJson, sendJson } from '../ui/edit/api.ts';
import { $entries } from './entries.ts';
import {
  $baseline,
  $contextDocs,
  $inflateUrl,
  $plan,
  $working,
  browserLookup,
  commitWorking,
  onSourcesReload,
  patchInflateUrl,
} from './inflate.ts';
import type { InflateView } from './inflate.ts';

/** Debounce between an edit and the dry run. */
export const DIR_PLAN_DEBOUNCE_MS = 400;
/** Delay between two polls of a running job. */
export const JOB_POLL_MS = 500;
/** Longest delay between polls while the server is unreachable. */
const JOB_POLL_MAX_BACKOFF_MS = 2000;

export type DirPlanState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Kept while a newer plan loads (stale-while-revalidate). */
  result: DirPlanResponse | null;
  message?: string;
};
export type JobState = {
  status: 'idle' | 'loading' | 'ready' | 'lost' | 'error';
  job: InflateJob | null;
  message?: string;
  /** `busy` answer of /run: the job that is already running. */
  busyJobId?: string;
};
export type IdeState = {
  /** null = not asked yet. */
  available: boolean | null;
  status: 'idle' | 'opening' | 'ok' | 'error';
  message?: string;
};

const NO_OVERRIDES: InflateRunOverrides = { items: {} };

// ---------------------------------------------------------------- stores

export const $runOverrides = atom<InflateRunOverrides>(NO_OVERRIDES);

/** The recipe a run would use: the working copy with the run overrides applied. */
export const $effective = computed([$working, $runOverrides], (w, r): RecipeData | null =>
  w === null ? null : applyRunOverrides(w, r),
);
export const $effectiveDir = computed($effective, (e): string | null => {
  const dir = e?.output?.dir;
  return dir === undefined || dir.trim() === '' ? null : dir;
});
/** The composition of $effective (material per item as a run would place it). */
export const $effectivePlan = computed(
  [$effective, $contextDocs, $entries],
  (e, docs, entries): ExpandedPlan | null =>
    e === null ? null : expandRecipe(e, browserLookup(docs, entries)),
);
export const $runOverrideCount = computed($runOverrides, (r) => runOverrideCount(r));

export const $dirPlan = atom<DirPlanState>({ status: 'idle', result: null });
/** Where each placed item lands in the directory (from the dry run's manifest), by item key. */
export const $destByKey = computed($dirPlan, (p): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const s of p.result?.document.manifest.segments ?? []) {
    if (s.dest !== undefined) out.set(s.key, s.dest);
  }
  return out;
});

export const $job = atom<JobState>({ status: 'idle', job: null });
/** True once a run finished in this session: the Run button then says "Run again". */
export const $ranOnce = atom<boolean>(false);
/** A run is queued or running (the Run button is disabled, the dry run is not what is shown). */
export const $jobActive = computed($job, (j) => {
  const status = j.job?.status;
  return j.status === 'loading' || status === 'queued' || status === 'running';
});
export const $ide = atom<IdeState>({ available: null, status: 'idle' });

// ---------------------------------------------------------------- run-time overrides

function setRun(next: InflateRunOverrides): void {
  $runOverrides.set(next);
}

/** An override that equals what the recipe says anyway is not an override. */
export function setRunDir(value: string): void {
  const w = $working.get();
  if (w === null) return;
  const dir = value.trim();
  const r = $runOverrides.get();
  if (dir === '' || dir === (w.output?.dir ?? '').trim()) setRun(omit(r, 'dir'));
  else if (r.dir !== dir) setRun({ ...r, dir });
}

export function setRunContextFile(value: string): void {
  const w = $working.get();
  if (w === null || !CONTEXT_FILE_PATTERN.test(value)) return;
  const r = $runOverrides.get();
  if (value === (w.output?.contextFile ?? DEFAULT_CONTEXT_FILE)) {
    setRun(omit(r, 'contextFile'));
  } else if (r.contextFile !== value) {
    setRun({ ...r, contextFile: value });
  }
}

/** `null` = no primary repository for this run. */
export function setRunPrimary(key: string | null): void {
  const w = $working.get();
  if (w === null) return;
  const r = $runOverrides.get();
  if (key === (w.output?.primary ?? null)) setRun(omit(r, 'primary'));
  else if (r.primary !== key) setRun({ ...r, primary: key });
}

export function setRunAllowNonEmpty(on: boolean): void {
  const w = $working.get();
  if (w === null) return;
  const r = $runOverrides.get();
  if (on === (w.output?.allowNonEmpty === true)) setRun(omit(r, 'allowNonEmpty'));
  else if (r.allowNonEmpty !== on) setRun({ ...r, allowNonEmpty: on });
}

/** The material of `key` as the recipe itself resolves it (without run overrides). */
function recipeMaterial(key: string): string | null {
  for (const s of $plan.get()?.segments ?? []) {
    if (s.type === 'item' && s.key === key) return s.material;
  }
  return null;
}

export function setRunMaterial(key: string, material: MaterialId): void {
  const r = $runOverrides.get();
  const { [key]: current, ...others } = r.items;
  const nextItem = { ...current };
  if (material === recipeMaterial(key)) delete nextItem.material;
  else nextItem.material = material;
  const empty = nextItem.material === undefined && nextItem.materialOptions === undefined;
  setRun({ ...r, items: empty ? others : { ...others, [key]: nextItem } });
}

export function resetRunItem(key: string): void {
  const r = $runOverrides.get();
  if (r.items[key] === undefined) return;
  const { [key]: _removed, ...items } = r.items;
  setRun({ ...r, items });
}

export function clearRunOverrides(): void {
  if (runOverrideCount($runOverrides.get()) === 0) return;
  setRun(NO_OVERRIDES);
}

/** "Save overrides to recipe": the recipe takes the overrides (it becomes dirty; Save persists it). */
export function saveRunOverrides(): void {
  const w = $working.get();
  const r = $runOverrides.get();
  if (w === null || runOverrideCount(r) === 0) return;
  commitWorking(applyRunOverrides(w, r));
  setRun(NO_OVERRIDES);
}

/** The Run view or any other, keeping the watched job in the URL while the Run view is shown. */
export function selectView(view: InflateView): void {
  const jobId = $job.get().job?.id ?? null;
  patchInflateUrl({ view, job: view === 'run' ? jobId : null }, 'replace');
}

// ---------------------------------------------------------------- dry run

let planTimer: ReturnType<typeof setTimeout> | undefined;
let planSeq = 0;

function cancelPlanTimer(): void {
  if (planTimer !== undefined) clearTimeout(planTimer);
  planTimer = undefined;
}

export function scheduleDirPlan(delay = DIR_PLAN_DEBOUNCE_MS): void {
  cancelPlanTimer();
  planTimer = setTimeout(() => void planNow(), delay);
}

/** Plan the effective recipe on the server. A response to an older request is dropped. */
export async function planNow(): Promise<void> {
  cancelPlanTimer();
  const working = $working.get();
  const seq = ++planSeq;
  if (working === null || $effectiveDir.get() === null) {
    $dirPlan.set({ status: 'idle', result: null });
    return;
  }
  $dirPlan.set({ status: 'loading', result: $dirPlan.get().result });
  const res = await sendJson<DirPlanResponse>('POST', '/api/inflate/plan', {
    recipe: working,
    overrides: $runOverrides.get(),
  });
  if (seq !== planSeq) return;
  if (!res.ok) {
    $dirPlan.set({ status: 'error', result: $dirPlan.get().result, message: failureText(res) });
    return;
  }
  $dirPlan.set({ status: 'ready', result: res.body });
}

/** Plan again now (after a run, after "Reload sources"). */
export function refreshDirPlan(): void {
  if ($effectiveDir.get() === null) return;
  void planNow();
}

function onEffectiveChange(): void {
  if ($effectiveDir.get() === null) {
    cancelPlanTimer();
    planSeq++;
    if ($dirPlan.get().status !== 'idle') $dirPlan.set({ status: 'idle', result: null });
    return;
  }
  // The plan on screen is out of date from now on (the Run button waits for the new one). The first plan of
  // a recipe goes out at once; later edits are debounced.
  const cur = $dirPlan.get();
  planSeq++; // an answer to an older request is out of date too
  scheduleDirPlan(cur.status === 'idle' ? 0 : DIR_PLAN_DEBOUNCE_MS);
  if (cur.status !== 'loading') $dirPlan.set({ status: 'loading', result: cur.result });
}

// ---------------------------------------------------------------- job: start, poll, cancel, close

let pollTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped to abandon the poll loop in flight. */
let pollToken = 0;
let pollFailures = 0;

function stopPolling(): void {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  pollTimer = undefined;
  pollToken++;
}

const isActive = (job: InflateJob): boolean => job.status === 'queued' || job.status === 'running';

async function pollOnce(id: string, token: number): Promise<void> {
  const again = (delay: number): void => {
    if (token === pollToken) pollTimer = setTimeout(() => void pollOnce(id, token), delay);
  };
  const res = await getJson<InflateJob>(`/api/inflate/jobs/${id}`);
  if (token !== pollToken) return;
  if (res.ok) {
    pollFailures = 0;
    $job.set({ status: 'ready', job: res.body });
    if (isActive(res.body)) again(JOB_POLL_MS);
    else onJobFinished();
    return;
  }
  if (res.status === 404) {
    $job.set({ status: 'lost', job: $job.get().job });
    return;
  }
  if (res.status === 400) {
    $job.set({ status: 'error', job: null, message: failureText(res) });
    return;
  }
  // Server unreachable (restart, dev reload) or another failure: keep trying, slowly.
  pollFailures++;
  again(Math.min(JOB_POLL_MAX_BACKOFF_MS, JOB_POLL_MS * 2 ** pollFailures));
}

function startPolling(id: string): void {
  stopPolling();
  pollFailures = 0;
  const token = pollToken;
  void pollOnce(id, token);
}

function onJobFinished(): void {
  $ranOnce.set(true);
  // The directory changed: what a next run would do changed with it.
  refreshDirPlan();
}

/** Show job `id` (deep link, back navigation): fetch it once, keep polling while it runs. */
export function resumeJob(id: string): void {
  const cur = $job.get();
  if (cur.job?.id === id && cur.status !== 'error') return;
  $job.set({ status: 'loading', job: null });
  startPolling(id);
}

export async function startRun(): Promise<void> {
  const working = $working.get();
  if (working === null || $jobActive.get()) return;
  stopPolling();
  $job.set({ status: 'loading', job: null });
  try {
    const res = await fetch('/api/inflate/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ recipe: working, overrides: $runOverrides.get() }),
    });
    if (res.status === 202) {
      const body = (await res.json()) as { jobId: string; job: InflateJob };
      $job.set({ status: 'ready', job: body.job });
      patchInflateUrl({ view: 'run', job: body.jobId }, 'replace');
      if (isActive(body.job)) startPolling(body.jobId);
      else onJobFinished();
      return;
    }
    const body = (await res.json().catch(() => null)) as {
      message?: unknown;
      jobId?: unknown;
    } | null;
    const state: JobState = {
      status: 'error',
      job: null,
      message: typeof body?.message === 'string' ? body.message : `HTTP ${res.status}`,
    };
    if (res.status === 409 && typeof body?.jobId === 'string') state.busyJobId = body.jobId;
    $job.set(state);
  } catch (error) {
    $job.set({
      status: 'error',
      job: null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function cancelRun(): Promise<void> {
  const job = $job.get().job;
  if (job === null) return;
  const res = await sendJson<{ job: InflateJob }>('POST', `/api/inflate/jobs/${job.id}/cancel`, {});
  if (!res.ok) return; // 409 not-running: the poll shows the final state; anything else: the poll keeps going
  const cur = $job.get();
  if (cur.job?.id === res.body.job.id) $job.set({ ...cur, status: 'ready', job: res.body.job });
}

/** Watch a job that is already running (the `busy` answer of /run names it). */
export function attachJob(id: string): void {
  resumeJob(id);
  patchInflateUrl({ view: 'run', job: id }, 'replace');
}

/** Leave the job view: forget the job (it keeps running on the server) and show the plan again. */
export function closeJob(): void {
  stopPolling();
  $job.set({ status: 'idle', job: null });
  patchInflateUrl({ job: null }, 'replace');
  refreshDirPlan();
}

// ---------------------------------------------------------------- open in the IDE

async function fetchIdeAvailability(): Promise<void> {
  const res = await getJson<{ available?: unknown }>('/api/ide/open');
  $ide.set({ ...$ide.get(), available: res.ok && res.body?.available === true });
}

/** `POST /api/ide/open { dir }`: opens the inflated directory as a workspace. */
export async function openInIde(dir: string): Promise<void> {
  if ($ide.get().status === 'opening') return;
  $ide.set({ ...$ide.get(), status: 'opening' });
  const res = await sendJson<unknown>('POST', '/api/ide/open', { dir });
  $ide.set(
    res.ok
      ? { ...$ide.get(), status: 'ok', message: 'Opened in the IDE' }
      : { ...$ide.get(), status: 'error', message: failureText(res) },
  );
}

// ---------------------------------------------------------------- recipe changes and mount

/** Forget everything that belongs to the recipe that was loaded (run overrides, dry run, job). Leaves the URL alone. */
function resetRun(): void {
  stopPolling();
  cancelPlanTimer();
  planSeq++;
  $runOverrides.set(NO_OVERRIDES);
  $dirPlan.set({ status: 'idle', result: null });
  $job.set({ status: 'idle', job: null });
  $ranOnce.set(false);
  $ide.set({ ...$ide.get(), status: 'idle' });
}

/** Name of the recipe the run state belongs to. */
let runRecipe: string | null = null;

function onBaselineChange(baseline: RecipeData | null): void {
  if (baseline === null) {
    runRecipe = null;
    resetRun();
    // Back / forward onto a URL that names a job: show it again.
    const job = $inflateUrl.get().job;
    if (job !== null) resumeJob(job);
    return;
  }
  if (runRecipe !== null && baseline.name !== runRecipe) resetRun();
  runRecipe = baseline.name;
}

onMount($inflateUrl, () => {
  void fetchIdeAvailability();
  const stops = [
    $effective.listen(onEffectiveChange),
    $baseline.listen(onBaselineChange),
    onSourcesReload(refreshDirPlan),
  ];
  // Reload with `view=run&job=<id>`: pick the job up where it is.
  const job = parseInflateUrl(new URLSearchParams(location.search)).job;
  if (job !== null) resumeJob(job);
  return () => {
    for (const stop of stops) stop();
    stopPolling();
    cancelPlanTimer();
  };
});
