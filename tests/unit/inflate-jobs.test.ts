import { describe, expect, it } from 'vitest';
import {
  JOB_ID_PATTERN,
  createJobStore,
  jobStore,
  stepDelayFromEnv,
} from '../../src/lib/inflate/jobs.ts';
import type { JobStartInput } from '../../src/lib/inflate/jobs.ts';
import type { MaterialStep, StepResult, StepUpdate } from '../../src/lib/inflate/material-plan.ts';

const step = (
  id: string,
  kind: MaterialStep['kind'] = 'ensureDir',
  extra: Record<string, unknown> = {},
): MaterialStep =>
  ({
    kind,
    id,
    path: id,
    label: `step ${id}`,
    expect: 'create',
    after: [],
    ...extra,
  }) as MaterialStep;

const result = (
  id: string,
  status: StepResult['status'] = 'ok',
  extra: Partial<StepResult> = {},
): StepResult => ({
  id,
  status,
  action: status === 'unchanged' ? 'unchanged' : null,
  message: null,
  durationMs: 1,
  tail: [],
  ...extra,
});

/** A promise resolved from outside. */
function deferred<T = void>(): {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function input(overrides: Partial<JobStartInput> = {}): JobStartInput {
  return {
    recipe: 'demo',
    dir: '/w',
    contextFile: '/w/LLM_CONTEXT.md',
    steps: [step('a'), step('b')],
    warnings: [],
    execute: () => Promise.resolve({ results: [result('a'), result('b')] }),
    ...overrides,
  };
}

let counter = 0;
const newId = (): string => {
  counter++;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};

describe('createJobStore', () => {
  it('starts queued, runs on the next microtask and ends done', async () => {
    const store = createJobStore({ newId });
    const gate = deferred<{ results: StepResult[] }>();
    const started = store.start(input({ execute: () => gate.promise }));
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(JOB_ID_PATTERN.test(started.job.id)).toBe(true);
    expect(started.job.status).toBe('queued');
    expect(started.job.steps.map((s) => [s.id, s.status])).toEqual([
      ['a', 'pending'],
      ['b', 'pending'],
    ]);
    await tick();
    const running = store.get(started.job.id);
    expect(running?.status).toBe('running');
    expect(running?.startedAt).not.toBeNull();
    gate.resolve({ results: [result('a'), result('b', 'unchanged')] });
    await tick();
    const finished = store.get(started.job.id);
    expect(finished?.status).toBe('done');
    expect(finished?.finishedAt).not.toBeNull();
    expect(finished?.summary).toEqual({
      ok: 1,
      unchanged: 1,
      skipped: 0,
      failed: 0,
      cancelled: 0,
      removed: 0,
    });
    expect(finished?.error).toBeNull();
  });

  it('applies progress updates: status, startedAt, tail lines (kept to 20) and results', async () => {
    const store = createJobStore({ newId });
    let progress!: (u: StepUpdate) => void;
    const gate = deferred<{ results: StepResult[] }>();
    const started = store.start(
      input({
        execute: (_signal, onProgress) => {
          progress = onProgress;
          return gate.promise;
        },
      }),
    );
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    progress({ id: 'a', status: 'running' });
    for (let i = 0; i < 25; i++) progress({ id: 'a', status: 'running', line: `line ${i}` });
    progress({ id: 'nope', status: 'running', line: 'ignored' });
    let snapshot = store.get(started.job.id);
    expect(snapshot?.steps[0]?.status).toBe('running');
    expect(snapshot?.steps[0]?.startedAt).not.toBeNull();
    expect(snapshot?.steps[0]?.tail).toHaveLength(20);
    expect(snapshot?.steps[0]?.tail.at(-1)).toBe('line 24');
    expect(snapshot?.steps[1]?.status).toBe('pending');

    progress({
      id: 'a',
      status: 'ok',
      result: result('a', 'ok', { action: 'created', message: 'made', durationMs: 7 }),
    });
    snapshot = store.get(started.job.id);
    expect(snapshot?.steps[0]).toMatchObject({
      status: 'ok',
      action: 'created',
      message: 'made',
      durationMs: 7,
    });
    gate.resolve({ results: [result('a'), result('b')] });
    await tick();
  });

  it('ends failed when a step failed and counts removed steps', async () => {
    const store = createJobStore({ newId });
    const started = store.start(
      input({
        steps: [step('rm:x', 'remove'), step('b')],
        execute: () =>
          Promise.resolve({
            results: [
              result('rm:x', 'ok', { action: 'removed' }),
              result('b', 'failed', { message: 'boom' }),
            ],
          }),
      }),
    );
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    const job = store.get(started.job.id);
    expect(job?.status).toBe('failed');
    expect(job?.summary).toMatchObject({ ok: 1, failed: 1, removed: 1 });
    expect(job?.steps[1]?.message).toBe('boom');
  });

  it('ends failed with the error message when execute throws', async () => {
    const store = createJobStore({ newId });
    const gate = deferred<{ results: StepResult[] }>();
    const started = store.start(input({ execute: () => gate.promise }));
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    gate.reject(new Error('exploded\nsecond line'));
    await tick();
    const job = store.get(started.job.id);
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('exploded');
    expect(job?.steps.map((s) => s.status)).toEqual(['skipped', 'skipped']);
  });

  it('appends warnings returned by execute', async () => {
    const store = createJobStore({ newId });
    const started = store.start(
      input({
        warnings: [{ code: 'tool-missing', message: 'x' }],
        execute: () =>
          Promise.resolve({
            results: [result('a'), result('b')],
            warnings: [{ code: 'context-file-edited', message: 'edited' }],
          }),
      }),
    );
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    expect(store.get(started.job.id)?.warnings.map((w) => w.code)).toEqual([
      'tool-missing',
      'context-file-edited',
    ]);
  });

  it('refuses a second start while one is queued or running', async () => {
    const store = createJobStore({ newId });
    const gate = deferred<{ results: StepResult[] }>();
    const first = store.start(input({ execute: () => gate.promise }));
    if (!first.ok) throw new Error('expected a started job');
    // queued
    const queuedRefusal = store.start(input());
    expect(queuedRefusal.ok).toBe(false);
    await tick();
    // running
    const refusal = store.start(input());
    expect(refusal.ok).toBe(false);
    if (!refusal.ok) expect(refusal.running.id).toBe(first.job.id);
    gate.resolve({ results: [result('a'), result('b')] });
    await tick();
    expect(store.start(input()).ok).toBe(true);
  });

  it('active() is the queued or running job, and undefined once it finished', async () => {
    const store = createJobStore({ newId });
    expect(store.active()).toBeUndefined();
    const gate = deferred<{ results: StepResult[] }>();
    const started = store.start(input({ execute: () => gate.promise }));
    if (!started.ok) throw new Error('expected a started job');
    expect(store.active()?.id).toBe(started.job.id);
    await tick();
    expect(store.active()?.status).toBe('running');
    gate.resolve({ results: [result('a'), result('b')] });
    await tick();
    expect(store.active()).toBeUndefined();
  });

  it('cancel while queued finishes the job as cancelled without running it', async () => {
    const store = createJobStore({ newId });
    let ran = false;
    const started = store.start(
      input({
        execute: () => {
          ran = true;
          return Promise.resolve({ results: [] });
        },
      }),
    );
    if (!started.ok) throw new Error('expected a started job');
    expect(store.cancel(started.job.id)).toBe('cancelled');
    await tick();
    const job = store.get(started.job.id);
    expect(ran).toBe(false);
    expect(job?.status).toBe('cancelled');
    expect(job?.finishedAt).not.toBeNull();
    expect(job?.steps.every((s) => s.status === 'cancelled')).toBe(true);
    expect(store.cancel(started.job.id)).toBe('not-running');
  });

  it('cancel while running aborts the signal and the job ends cancelled', async () => {
    const store = createJobStore({ newId });
    const gate = deferred<{ results: StepResult[] }>();
    let signal!: AbortSignal;
    const started = store.start(
      input({
        execute: (s) => {
          signal = s;
          return gate.promise;
        },
      }),
    );
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    expect(store.cancel(started.job.id)).toBe('cancelling');
    expect(signal.aborted).toBe(true);
    const during = store.get(started.job.id);
    expect(during?.status).toBe('running');
    expect(during?.cancelRequested).toBe(true);
    gate.resolve({ results: [result('a'), result('b', 'cancelled')] });
    await tick();
    const job = store.get(started.job.id);
    expect(job?.status).toBe('cancelled');
    expect(job?.summary).toMatchObject({ ok: 1, cancelled: 1 });
    expect(store.cancel(started.job.id)).toBe('not-running');
  });

  it('cancel of an unknown id is not-found and finished jobs are not-running', async () => {
    const store = createJobStore({ newId });
    expect(store.cancel('00000000-0000-4000-8000-ffffffffffff')).toBe('not-found');
    const started = store.start(input());
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    expect(store.get(started.job.id)?.status).toBe('done');
    expect(store.cancel(started.job.id)).toBe('not-running');
    expect(store.get('00000000-0000-4000-8000-ffffffffffff')).toBeUndefined();
  });

  it('keeps the last `cap` finished jobs and never evicts the running one', async () => {
    const store = createJobStore({ cap: 2, newId });
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const started = store.start(input());
      if (!started.ok) throw new Error('expected a started job');
      ids.push(started.job.id);
      await tick();
    }
    expect(ids.map((id) => store.get(id)?.status)).toEqual([undefined, undefined, 'done', 'done']);

    const gate = deferred<{ results: StepResult[] }>();
    const running = store.start(input({ execute: () => gate.promise }));
    if (!running.ok) throw new Error('expected a started job');
    await tick();
    expect(store.get(running.job.id)?.status).toBe('running');
    expect(store.get(ids[2] ?? '')?.status).toBe('done');
    gate.resolve({ results: [result('a'), result('b')] });
    await tick();
    expect(store.get(running.job.id)?.status).toBe('done');
    expect(store.get(ids[2] ?? '')).toBeUndefined();
    expect(store.get(ids[3] ?? '')?.status).toBe('done');
  });

  it('get returns a snapshot clone', async () => {
    const store = createJobStore({ newId });
    const gate = deferred<{ results: StepResult[] }>();
    const started = store.start(input({ execute: () => gate.promise }));
    if (!started.ok) throw new Error('expected a started job');
    await tick();
    const snapshot = store.get(started.job.id);
    if (snapshot === undefined) throw new Error('expected a job');
    snapshot.status = 'failed';
    snapshot.steps[0]!.status = 'failed';
    snapshot.warnings.push({ code: 'tool-missing', message: 'x' });
    const again = store.get(started.job.id);
    expect(again?.status).toBe('running');
    expect(again?.steps[0]?.status).toBe('pending');
    expect(again?.warnings).toEqual([]);
    gate.resolve({ results: [result('a'), result('b')] });
    await tick();
  });

  it('jobStore() is a process-wide singleton', () => {
    expect(jobStore()).toBe(jobStore());
  });
});

describe('stepDelayFromEnv', () => {
  it('reads CTXMAN_INFLATE_STEP_DELAY_MS as an integer 0..5000, else 0', () => {
    const delay = (value: string | undefined): number =>
      stepDelayFromEnv(value === undefined ? {} : { CTXMAN_INFLATE_STEP_DELAY_MS: value });
    expect(delay(undefined)).toBe(0);
    expect(delay('300')).toBe(300);
    expect(delay('0')).toBe(0);
    expect(delay('5000')).toBe(5000);
    expect(delay('5001')).toBe(0);
    expect(delay('-5')).toBe(0);
    expect(delay('1.5')).toBe(0);
    expect(delay('abc')).toBe(0);
    expect(delay('')).toBe(0);
  });
});
