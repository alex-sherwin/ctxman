// SERVER (in-memory state shared by API routes; no astro:*): the Inflate job store (plans/INFLATE_V2_SPEC.md
// §8.2). One run at a time, the last `cap` finished jobs are kept, a singleton on `globalThis` survives Vite
// module re-instantiation (and is lost on a server restart). The UI polls `GET /api/inflate/jobs/:id`.
import { randomUUID } from 'node:crypto';
import type { InflateWarning } from './expand.ts';
import type { InflateJob, JobStep, MaterialStep, StepResult, StepUpdate } from './material-plan.ts';

export type { InflateJob, JobStatus, JobStep } from './material-plan.ts';

export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const JOB_CAP = 20;
const TAIL_LINES = 20;
export const STEP_DELAY_ENV = 'CTXMAN_INFLATE_STEP_DELAY_MS';
export const STEP_DELAY_MAX_MS = 5000;

export interface JobExecuteInfo {
  jobId: string;
}
export interface JobStartInput {
  recipe: string;
  /** Absolute `<W>`. */
  dir: string;
  /** Absolute path of the context file. */
  contextFile: string;
  steps: readonly MaterialStep[];
  warnings: InflateWarning[];
  /** Runs the steps; progress events update the job. `warnings` are appended to the job's. */
  execute(
    signal: AbortSignal,
    onProgress: (update: StepUpdate) => void,
    info: JobExecuteInfo,
  ): Promise<{ results: StepResult[]; warnings?: InflateWarning[] }>;
}

export interface JobStore {
  start(input: JobStartInput): { ok: true; job: InflateJob } | { ok: false; running: InflateJob };
  /** A `structuredClone` snapshot. */
  get(id: string): InflateJob | undefined;
  /** The queued or running job (snapshot), if any. */
  active(): InflateJob | undefined;
  cancel(id: string): 'cancelling' | 'cancelled' | 'not-running' | 'not-found';
}

interface Entry {
  job: InflateJob;
  controller: AbortController;
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const isFinished = (job: InflateJob): boolean => TERMINAL.has(job.status);

const messageOf = (error: unknown): string =>
  error instanceof Error ? (error.message.split('\n')[0] ?? error.message) : String(error);

/** `CTXMAN_INFLATE_STEP_DELAY_MS` (test hook): an integer 0..5000, anything else is 0. */
export function stepDelayFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[STEP_DELAY_ENV];
  if (raw === undefined || !/^\d{1,4}$/.test(raw.trim())) return 0;
  const value = Number(raw.trim());
  return value >= 0 && value <= STEP_DELAY_MAX_MS ? value : 0;
}

export function createJobStore(
  opts: { cap?: number; now?: () => Date; newId?: () => string } = {},
): JobStore {
  const cap = opts.cap ?? JOB_CAP;
  const now = opts.now ?? ((): Date => new Date());
  const newId = opts.newId ?? randomUUID;
  /** Insertion order = creation order. */
  const entries = new Map<string, Entry>();

  const current = (): Entry | undefined => {
    for (const entry of entries.values()) if (!isFinished(entry.job)) return entry;
    return undefined;
  };

  const evict = (): void => {
    const finished = [...entries.values()].filter((e) => isFinished(e.job));
    for (const entry of finished.slice(0, Math.max(0, finished.length - cap))) {
      entries.delete(entry.job.id);
    }
  };

  const finish = (entry: Entry, status: 'done' | 'failed' | 'cancelled', error?: string): void => {
    const job = entry.job;
    job.status = status;
    job.finishedAt = now().toISOString();
    if (error !== undefined) job.error = error;
    const summary = { ok: 0, unchanged: 0, skipped: 0, failed: 0, cancelled: 0, removed: 0 };
    for (const step of job.steps) {
      if (step.status === 'ok') summary.ok++;
      else if (step.status === 'unchanged') summary.unchanged++;
      else if (step.status === 'skipped') summary.skipped++;
      else if (step.status === 'failed') summary.failed++;
      else if (step.status === 'cancelled') summary.cancelled++;
      if (step.kind === 'remove' && step.action === 'removed') summary.removed++;
    }
    job.summary = summary;
    evict();
  };

  const applyResult = (step: JobStep, result: StepResult): void => {
    step.status = result.status;
    step.action = result.action;
    step.message = result.message;
    step.durationMs = result.durationMs;
    if (result.tail.length > 0) step.tail = result.tail.slice(-TAIL_LINES);
  };

  const run = async (entry: Entry, input: JobStartInput): Promise<void> => {
    const job = entry.job;
    // A cancel while queued already finished the job.
    if (job.status !== 'queued') return;
    job.status = 'running';
    job.startedAt = now().toISOString();
    const stepById = new Map(job.steps.map((s) => [s.id, s]));

    const onProgress = (update: StepUpdate): void => {
      const step = stepById.get(update.id);
      if (step === undefined) return;
      if (update.status === 'running' && step.startedAt === null)
        step.startedAt = now().toISOString();
      step.status = update.status;
      if (update.line !== undefined) {
        step.tail.push(update.line);
        if (step.tail.length > TAIL_LINES) step.tail.shift();
      }
      if (update.result !== undefined) applyResult(step, update.result);
    };

    try {
      const outcome = await input.execute(entry.controller.signal, onProgress, { jobId: job.id });
      // The authoritative results win over any progress event that was missed.
      for (const result of outcome.results) {
        const step = stepById.get(result.id);
        if (step !== undefined) applyResult(step, result);
      }
      for (const warning of outcome.warnings ?? []) job.warnings.push(warning);
      if (entry.controller.signal.aborted) finish(entry, 'cancelled');
      else if (outcome.results.some((r) => r.status === 'failed')) finish(entry, 'failed');
      else finish(entry, 'done');
    } catch (error) {
      for (const step of job.steps) {
        if (step.status === 'running') step.status = 'failed';
        else if (step.status === 'pending') step.status = 'skipped';
      }
      finish(entry, entry.controller.signal.aborted ? 'cancelled' : 'failed', messageOf(error));
    }
  };

  return {
    start(input) {
      const running = current();
      if (running !== undefined) return { ok: false, running: structuredClone(running.job) };
      const job: InflateJob = {
        id: newId(),
        recipe: input.recipe,
        dir: input.dir,
        contextFile: input.contextFile,
        status: 'queued',
        cancelRequested: false,
        createdAt: now().toISOString(),
        startedAt: null,
        finishedAt: null,
        steps: input.steps.map((s): JobStep => ({
          id: s.id,
          kind: s.kind,
          label: s.label,
          path: s.path,
          key: s.key ?? null,
          expect: s.expect,
          status: 'pending',
          action: null,
          message: null,
          startedAt: null,
          durationMs: null,
          tail: [],
        })),
        warnings: [...input.warnings],
        error: null,
        summary: null,
      };
      const entry: Entry = { job, controller: new AbortController() };
      entries.set(job.id, entry);
      const snapshot = structuredClone(job);
      queueMicrotask(() => {
        void run(entry, input);
      });
      return { ok: true, job: snapshot };
    },

    get(id) {
      const entry = entries.get(id);
      return entry === undefined ? undefined : structuredClone(entry.job);
    },

    active() {
      const entry = current();
      return entry === undefined ? undefined : structuredClone(entry.job);
    },

    cancel(id) {
      const entry = entries.get(id);
      if (entry === undefined) return 'not-found';
      const job = entry.job;
      if (job.status === 'queued') {
        job.cancelRequested = true;
        entry.controller.abort();
        for (const step of job.steps) step.status = 'cancelled';
        finish(entry, 'cancelled');
        return 'cancelled';
      }
      if (job.status === 'running') {
        job.cancelRequested = true;
        entry.controller.abort();
        return 'cancelling';
      }
      return 'not-running';
    },
  };
}

type GlobalWithJobs = typeof globalThis & { __ctxmanInflateJobs?: JobStore };

/** The process-wide store (`globalThis.__ctxmanInflateJobs`). */
export function jobStore(): JobStore {
  const holder = globalThis as GlobalWithJobs;
  return (holder.__ctxmanInflateJobs ??= createJobStore());
}
