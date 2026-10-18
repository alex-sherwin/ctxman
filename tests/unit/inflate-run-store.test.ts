// Run store of Inflate (plans/INFLATE_V2_SPEC.md §11.2): run-time overrides, the dry run and the job being
// watched. No server: `fetch` is stubbed per test, polling runs on fake timers, and the stores are driven
// through their actions without mounting (the island's `onMount` wiring is covered by the e2e specs).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetId } from '../../src/datasets/registry.ts';
import { LINKABLE_DATASETS } from '../../src/datasets/registry.ts';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';
import type { DirPlanResponse, InflateJob } from '../../src/lib/inflate/material-plan.ts';
import { $entries } from '../../src/stores/entries.ts';
import type { EntriesState } from '../../src/stores/entries.ts';
import {
  $baseline,
  $contextDocs,
  $dirty,
  $inflateUrl,
  $working,
  setOutputDir,
  setPrimary,
} from '../../src/stores/inflate.ts';
import {
  $destByKey,
  $dirPlan,
  $effective,
  $effectiveDir,
  $effectivePlan,
  $ide,
  $job,
  $jobActive,
  $ranOnce,
  $runOverrideCount,
  $runOverrides,
  JOB_POLL_MS,
  attachJob,
  cancelRun,
  clearRunOverrides,
  closeJob,
  openInIde,
  planNow,
  refreshDirPlan,
  resetRunItem,
  resumeJob,
  saveRunOverrides,
  selectView,
  setRunAllowNonEmpty,
  setRunContextFile,
  setRunDir,
  setRunEdit,
  setRunMaterial,
  setRunPrimary,
  startRun,
} from '../../src/stores/inflate-run.ts';

const JOB_ID = '0b9f3c1e-5a7d-4e21-9c0a-3f6d8b2a1e47';

function summary(
  dataset: DatasetId,
  slug: string,
  extra: Partial<EntrySummary> = {},
): EntrySummary {
  return {
    dataset,
    slug,
    name: slug,
    description: `${slug} description`,
    tags: [],
    lastModified: '2026-01-01T00:00:00.000Z',
    stale: false,
    url: `/${dataset}/${slug}`,
    ...extra,
  };
}

const ready = (...entries: EntrySummary[]): EntriesState => ({ status: 'ready', entries });

const base: RecipeData = {
  name: 'demo',
  description: 'Demo recipe',
  tags: [],
  target: 'claude-code',
  layout: 'grouped',
  contexts: [],
  items: [
    { dataset: 'kb', slug: 'one' },
    { dataset: 'reference', slug: 'repo-a' },
    { dataset: 'reference', slug: 'repo-b' },
  ],
  markdown: [],
  overrides: [{ key: 'reference/repo-a', material: 'clone' }],
  order: [],
  // v3 clones a remote repository by default: the recipe default keeps repo-b "not placed" (repo-a is cloned)
  defaults: { 'remote-repo': { material: 'none' } },
  output: {
    dir: '~/ctxman-inflate/demo',
    contextFile: 'LLM_CONTEXT.md',
    primary: 'reference/repo-a',
  },
};

function seedCaches(): void {
  const entries: Partial<Record<DatasetId, EntriesState>> = {};
  for (const ds of LINKABLE_DATASETS) entries[ds] = ready();
  entries.kb = ready(summary('kb', 'one'));
  entries.reference = ready(
    summary('reference', 'repo-a', { refType: 'remote-repo' }),
    summary('reference', 'repo-b', { refType: 'remote-repo' }),
  );
  $entries.set(entries);
}

function load(recipe: RecipeData = base): void {
  $baseline.set(structuredClone(recipe));
  $working.set(structuredClone(recipe));
}

const respond = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function planResponse(overrides: Partial<DirPlanResponse> = {}): DirPlanResponse {
  return {
    dir: '/home/me/ctxman-inflate/demo',
    dirInput: '~/ctxman-inflate/demo',
    contextFile: 'LLM_CONTEXT.md',
    dirState: { exists: false, empty: true, hasManifest: false, manifestRecipe: null },
    blocking: [],
    steps: [],
    warnings: [],
    document: {
      markdown: '# demo\n',
      manifest: {
        recipe: 'demo',
        target: 'claude-code',
        layout: 'grouped',
        generatedAt: '2026-01-01T00:00:00.000Z',
        bytes: 7,
        counts: { included: 3, excluded: 0, missing: 0 },
        contexts: [],
        segments: [
          {
            key: 'reference/repo-a',
            type: 'item',
            title: 'repo-a',
            status: 'included',
            via: [],
            adhoc: true,
            dest: 'repos/repo-a',
            bytes: 10,
            warnings: [],
          },
        ],
        warnings: [],
      },
    },
    applied: [],
    ...overrides,
  };
}

function job(overrides: Partial<InflateJob> = {}): InflateJob {
  return {
    id: JOB_ID,
    recipe: 'demo',
    dir: '/work/demo',
    contextFile: '/work/demo/LLM_CONTEXT.md',
    status: 'running',
    cancelRequested: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: null,
    steps: [],
    warnings: [],
    error: null,
    summary: null,
    ...overrides,
  };
}

/** A poll answer that is built afresh on every use (a Response body can be read once). */
const reply =
  (status: number, body?: unknown): (() => Response) =>
  () =>
    respond(status, body);

const bodyOf = (call: unknown[]): Record<string, unknown> =>
  JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;

beforeEach(() => {
  seedCaches();
  load();
  $runOverrides.set({ items: {} });
  $dirPlan.set({ status: 'idle', result: null });
  $job.set({ status: 'idle', job: null });
  $ranOnce.set(false);
  $ide.set({ available: null, status: 'idle' });
  vi.stubGlobal('location', { pathname: '/inflate', search: '?recipe=demo&view=run', hash: '' });
  vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

let unbind: () => void = () => {};

beforeEach(() => {
  // Mounting the URL store registers the window listeners and reads `location`; do it first.
  unbind = $inflateUrl.listen(() => {});
  $inflateUrl.set({
    recipe: 'demo',
    view: 'run',
    dataset: 'kb',
    q: '',
    job: null,
    paths: 'relative',
  });
});

afterEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respond(200, planResponse())),
  );
  closeJob();
  unbind();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  $baseline.set(null);
  $working.set(null);
  $contextDocs.set({});
  $entries.set({});
});

describe('run overrides', () => {
  it('the effective recipe is the working copy plus the overrides; the working copy is untouched', () => {
    expect($effectiveDir.get()).toBe('~/ctxman-inflate/demo');
    setRunDir('/tmp/run-here');
    expect($effectiveDir.get()).toBe('/tmp/run-here');
    expect($effective.get()?.output?.dir).toBe('/tmp/run-here');
    expect($working.get()?.output?.dir).toBe('~/ctxman-inflate/demo');
    expect($dirty.get()).toBe(false);
  });

  it('a value equal to the recipe drops the override; a blank directory too', () => {
    setRunDir('/tmp/run-here');
    expect($runOverrides.get().dir).toBe('/tmp/run-here');
    expect($runOverrideCount.get()).toBe(1);
    setRunDir('  ~/ctxman-inflate/demo  ');
    expect($runOverrides.get().dir).toBeUndefined();
    setRunDir('/tmp/x');
    setRunDir('');
    expect($runOverrides.get().dir).toBeUndefined();
    expect($runOverrideCount.get()).toBe(0);
  });

  it('context file: only valid names count, the recipe value is not an override', () => {
    setRunContextFile('CONTEXT.md');
    expect($runOverrides.get().contextFile).toBe('CONTEXT.md');
    setRunContextFile('a/b.md');
    expect($runOverrides.get().contextFile).toBe('CONTEXT.md');
    setRunContextFile('LLM_CONTEXT.md');
    expect($runOverrides.get().contextFile).toBeUndefined();
  });

  it('primary: null means none for this run, the recipe value is dropped', () => {
    setRunPrimary(null);
    expect($runOverrides.get().primary).toBeNull();
    expect($runOverrideCount.get()).toBe(1);
    expect($effective.get()?.output?.primary).toBeUndefined();
    setRunPrimary('reference/repo-b');
    expect($runOverrides.get().primary).toBe('reference/repo-b');
    expect($effectivePlan.get()?.primary).toEqual({
      key: 'reference/repo-b',
      status: 'invalid',
      message: expect.any(String),
    });
    setRunPrimary('reference/repo-a'); // the recipe's own primary
    expect($runOverrides.get().primary).toBeUndefined();
  });

  it('primary: no recipe primary and none chosen is not an override', () => {
    setPrimary(null);
    setRunPrimary(null);
    expect($runOverrides.get().primary).toBeUndefined();
  });

  it('allowNonEmpty: only a difference from the recipe is kept', () => {
    setRunAllowNonEmpty(false);
    expect($runOverrides.get().allowNonEmpty).toBeUndefined();
    setRunAllowNonEmpty(true);
    expect($runOverrides.get().allowNonEmpty).toBe(true);
    expect($effective.get()?.output?.allowNonEmpty).toBe(true);
    setRunAllowNonEmpty(false);
    expect($runOverrides.get().allowNonEmpty).toBeUndefined();
  });

  it('material per item: a value equal to the recipe drops it, reset and clear remove it', () => {
    // repo-b: the recipe default says "none"; repo-a: the recipe says "clone"
    setRunMaterial('reference/repo-b', 'clone');
    expect($runOverrides.get().items).toEqual({ 'reference/repo-b': { material: 'clone' } });
    const plan = $effectivePlan.get();
    const seg = plan?.segments.find((s) => s.key === 'reference/repo-b');
    expect(seg?.type === 'item' && seg.material).toBe('clone');
    setRunMaterial('reference/repo-b', 'none');
    expect($runOverrides.get().items).toEqual({});
    setRunMaterial('reference/repo-a', 'none'); // differs from the recipe's clone
    expect($runOverrides.get().items['reference/repo-a']).toEqual({ material: 'none' });
    setRunMaterial('reference/repo-a', 'clone'); // the recipe's own
    expect($runOverrides.get().items).toEqual({});

    setRunMaterial('kb/one', 'copy');
    setRunDir('/tmp/x');
    expect($runOverrideCount.get()).toBe(2);
    resetRunItem('kb/one');
    expect($runOverrideCount.get()).toBe(1);
    clearRunOverrides();
    expect($runOverrides.get()).toEqual({ items: {} });
  });

  it('saveRunOverrides moves the overrides into the working copy and clears them', () => {
    setRunDir('/tmp/saved-here');
    setRunMaterial('kb/one', 'copy');
    setRunPrimary(null);
    setRunAllowNonEmpty(true);
    saveRunOverrides();
    expect($runOverrides.get()).toEqual({ items: {} });
    expect($working.get()?.output).toEqual({
      dir: '/tmp/saved-here',
      contextFile: 'LLM_CONTEXT.md',
      allowNonEmpty: true,
    });
    expect($working.get()?.overrides).toContainEqual({ key: 'kb/one', material: 'copy' });
    expect($dirty.get()).toBe(true);
    // the baseline (what is saved on disk) is untouched until Save
    expect($baseline.get()?.output?.dir).toBe('~/ctxman-inflate/demo');
  });

  it('saveRunOverrides with nothing to save does not make the recipe dirty', () => {
    saveRunOverrides();
    expect($dirty.get()).toBe(false);
  });

  it('no directory in the recipe or the run: nothing to plan', () => {
    setOutputDir(null);
    expect($effectiveDir.get()).toBeNull();
    setRunDir('/tmp/only-this-run');
    expect($effectiveDir.get()).toBe('/tmp/only-this-run');
  });

  it('selectView keeps the watched job in the URL only for the run view', () => {
    $job.set({ status: 'ready', job: job() });
    selectView('preview');
    expect($inflateUrl.get()).toMatchObject({ view: 'preview', job: null });
    selectView('run');
    expect($inflateUrl.get()).toMatchObject({ view: 'run', job: JOB_ID });
  });
});

describe('run override: Editable (v3)', () => {
  const effectiveEdit = (key: string): boolean | null | undefined => {
    const seg = $effectivePlan.get()?.segments.find((s) => s.key === key);
    return seg?.type === 'item' ? seg.edit : undefined;
  };

  it('a value equal to what the recipe gives drops the override; the primary is editable by default', () => {
    // repo-a: cloned and the recipe primary -> editable
    expect(effectiveEdit('reference/repo-a')).toBe(true);
    setRunEdit('reference/repo-a', true);
    expect($runOverrides.get().items).toEqual({});
    setRunEdit('reference/repo-a', false);
    expect($runOverrides.get().items).toEqual({ 'reference/repo-a': { edit: false } });
    expect($runOverrideCount.get()).toBe(1);
    expect(effectiveEdit('reference/repo-a')).toBe(false);
    setRunEdit('reference/repo-a', true);
    expect($runOverrides.get().items).toEqual({});
    expect($runOverrideCount.get()).toBe(0);
  });

  it('is refused for an item that cannot be edited, until its material allows it', () => {
    setRunEdit('kb/one', true); // not a repository
    setRunEdit('reference/repo-b', true); // not placed: a remote repository is not cloned
    expect($runOverrides.get().items).toEqual({});
    setRunMaterial('reference/repo-b', 'clone');
    expect(effectiveEdit('reference/repo-b')).toBe(false);
    setRunEdit('reference/repo-b', true);
    expect($runOverrides.get().items).toEqual({
      'reference/repo-b': { material: 'clone', edit: true },
    });
    setRunEdit('reference/repo-b', false); // the default of a repository that is not the primary
    expect($runOverrides.get().items).toEqual({ 'reference/repo-b': { material: 'clone' } });
  });

  it('the per-item reset and Clear remove the edit flag with the material', () => {
    setRunMaterial('reference/repo-b', 'clone');
    setRunEdit('reference/repo-b', true);
    setRunEdit('reference/repo-a', false);
    expect($runOverrideCount.get()).toBe(2);
    resetRunItem('reference/repo-b');
    expect($runOverrides.get().items).toEqual({ 'reference/repo-a': { edit: false } });
    clearRunOverrides();
    expect($runOverrides.get()).toEqual({ items: {} });
  });

  it('a run material that turns an item into a snapshot makes Editable unavailable', () => {
    setRunMaterial('reference/repo-a', 'none');
    expect(effectiveEdit('reference/repo-a')).toBeNull();
    setRunEdit('reference/repo-a', false);
    expect($runOverrides.get().items).toEqual({ 'reference/repo-a': { material: 'none' } });
  });

  it('a changed run primary drops the edit flags that now equal the default', () => {
    setRunMaterial('reference/repo-b', 'clone');
    setRunEdit('reference/repo-b', true); // explicit: editable although not the primary
    setRunPrimary('reference/repo-b'); // the default says editable now
    expect($runOverrides.get().items).toEqual({ 'reference/repo-b': { material: 'clone' } });
    expect(effectiveEdit('reference/repo-b')).toBe(true);
    expect(effectiveEdit('reference/repo-a')).toBe(false); // lost the primary
    setRunEdit('reference/repo-a', true);
    expect($runOverrides.get().items['reference/repo-a']).toEqual({ edit: true });
    setRunPrimary('reference/repo-a'); // the recipe's own again: repo-a is editable by default
    expect($runOverrides.get().items).toEqual({ 'reference/repo-b': { material: 'clone' } });
  });

  it('saveRunOverrides carries edit into the recipe override', () => {
    setRunEdit('reference/repo-a', false);
    setRunMaterial('reference/repo-b', 'clone');
    setRunEdit('reference/repo-b', true);
    saveRunOverrides();
    expect($runOverrides.get()).toEqual({ items: {} });
    expect($working.get()?.overrides).toEqual([
      { key: 'reference/repo-a', material: 'clone', edit: false },
      { key: 'reference/repo-b', material: 'clone', edit: true },
    ]);
    expect($dirty.get()).toBe(true);
  });

  it('saving drops a recipe edit flag that the saved run primary makes redundant', () => {
    const w = $working.get();
    if (w === null) throw new Error('no working recipe');
    $working.set({
      ...w,
      overrides: [
        { key: 'reference/repo-a', material: 'clone' },
        { key: 'reference/repo-b', material: 'clone', edit: true },
      ],
    });
    setRunPrimary('reference/repo-b');
    saveRunOverrides();
    expect($working.get()?.output?.primary).toBe('reference/repo-b');
    expect($working.get()?.overrides).toEqual([
      { key: 'reference/repo-a', material: 'clone' },
      { key: 'reference/repo-b', material: 'clone' },
    ]);
  });

  it('the dry run request carries the edit flag', async () => {
    const fetchMock = vi.fn(async () => respond(200, planResponse()));
    vi.stubGlobal('fetch', fetchMock);
    setRunEdit('reference/repo-a', false);
    await planNow();
    const sent = bodyOf(fetchMock.mock.calls[0] as unknown[]);
    expect(sent.overrides).toEqual({ items: { 'reference/repo-a': { edit: false } } });
  });
});

describe('dry run', () => {
  it('posts the working recipe and the run overrides, and keeps the answer', async () => {
    const fetchMock = vi.fn(async () => respond(200, planResponse()));
    vi.stubGlobal('fetch', fetchMock);
    setRunDir('/tmp/x');
    await planNow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/inflate/plan');
    expect(init.method).toBe('POST');
    const sent = bodyOf(fetchMock.mock.calls[0] as unknown[]);
    expect((sent.recipe as RecipeData).name).toBe('demo');
    expect(sent.overrides).toEqual({ dir: '/tmp/x', items: {} });
    expect($dirPlan.get().status).toBe('ready');
    expect($destByKey.get().get('reference/repo-a')).toBe('repos/repo-a');
  });

  it('is idle without a directory, without calling the server', async () => {
    setOutputDir(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await planNow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect($dirPlan.get()).toEqual({ status: 'idle', result: null });
  });

  it('keeps the previous result on error and reports the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, planResponse({ steps: [] }))),
    );
    await planNow();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(400, {
          error: 'invalid',
          message: 'request does not match the schema',
          issues: [{ path: 'recipe.description', message: 'Required' }],
        }),
      ),
    );
    await planNow();
    const state = $dirPlan.get();
    expect(state.status).toBe('error');
    expect(state.message).toBe('request does not match the schema; recipe.description: Required');
    expect(state.result?.dir).toBe('/home/me/ctxman-inflate/demo');
  });

  it('drops the answer to an older request', async () => {
    let release: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(respond(200, planResponse({ dir: '/newer' })));
    vi.stubGlobal('fetch', fetchMock);
    const first = planNow();
    await planNow();
    release(respond(200, planResponse({ dir: '/older' })));
    await first;
    expect($dirPlan.get().result?.dir).toBe('/newer');
  });

  it('refreshDirPlan plans again only when there is a directory', async () => {
    const fetchMock = vi.fn(async () => respond(200, planResponse()));
    vi.stubGlobal('fetch', fetchMock);
    refreshDirPlan();
    await vi.waitFor(() => expect($dirPlan.get().status).toBe('ready'));
    setOutputDir(null);
    refreshDirPlan();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('job', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** Advance the fake clock, then let the responses in flight (stream reads) finish. */
  async function tick(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  }

  /** A fetch that answers /run once and then walks `polls` for GET /jobs/:id (the last answer repeats). */
  function serverWith(
    polls: (() => Response)[],
    run: Response = respond(202, { jobId: JOB_ID, job: job() }),
  ) {
    const queue = [...polls];
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/inflate/run') return run;
      if (url.startsWith('/api/inflate/jobs/') && url.endsWith('/cancel')) {
        return respond(200, { job: job({ cancelRequested: true }) });
      }
      if (url.startsWith('/api/inflate/jobs/')) {
        const next = queue.length > 1 ? queue.shift() : queue[0];
        return next === undefined ? respond(404) : next();
      }
      if (url === '/api/ide/open' && init?.method === 'POST') return respond(200, { ok: true });
      return respond(200, planResponse());
    });
  }

  it('startRun posts the recipe and overrides, puts the job in the URL and polls until it is over', async () => {
    const done = job({
      status: 'done',
      finishedAt: '2026-01-01T00:00:03.000Z',
      summary: { ok: 3, unchanged: 0, skipped: 0, failed: 0, cancelled: 0, removed: 0 },
    });
    const fetchMock = serverWith([reply(200, job()), reply(200, job()), reply(200, done)]);
    vi.stubGlobal('fetch', fetchMock);
    setRunDir('/tmp/run-here');

    await startRun();
    expect($job.get().status).toBe('ready');
    expect($job.get().job?.id).toBe(JOB_ID);
    expect($jobActive.get()).toBe(true);
    const run = fetchMock.mock.calls.find((c) => c[0] === '/api/inflate/run') as unknown[];
    expect(bodyOf(run).overrides).toEqual({ dir: '/tmp/run-here', items: {} });
    expect($inflateUrl.get()).toMatchObject({ view: 'run', job: JOB_ID });
    expect(
      (history.replaceState as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[2],
    ).toBe(`/inflate?recipe=demo&view=run&job=${JOB_ID}`);

    const polls = (): number =>
      fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(JOB_ID)).length;
    await tick(0);
    expect(polls()).toBe(1);
    await tick(JOB_POLL_MS);
    expect(polls()).toBe(2);
    await tick(JOB_POLL_MS);
    expect(polls()).toBe(3);
    expect($job.get().job?.status).toBe('done');
    expect($jobActive.get()).toBe(false);
    expect($ranOnce.get()).toBe(true);
    // polling stopped: no more requests however long we wait
    await tick(JOB_POLL_MS * 10);
    expect(polls()).toBe(3);
  });

  it('a finished job refreshes the dry run (the directory changed)', async () => {
    const done = job({ status: 'done', finishedAt: '2026-01-01T00:00:03.000Z' });
    const fetchMock = serverWith([reply(200, done)], respond(202, { jobId: JOB_ID, job: job() }));
    vi.stubGlobal('fetch', fetchMock);
    await startRun();
    await tick(0);
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/inflate/plan')).toBe(true);
  });

  it('a 409 busy answer becomes an error that names the running job', async () => {
    vi.stubGlobal(
      'fetch',
      serverWith(
        [],
        respond(409, {
          error: 'busy',
          message: 'another inflate run is in progress',
          jobId: JOB_ID,
        }),
      ),
    );
    await startRun();
    expect($job.get()).toEqual({
      status: 'error',
      job: null,
      message: 'another inflate run is in progress',
      busyJobId: JOB_ID,
    });
    expect($jobActive.get()).toBe(false);
  });

  it('a 409 dir-not-empty answer shows the server message', async () => {
    vi.stubGlobal(
      'fetch',
      serverWith([], respond(409, { error: 'dir-not-empty', message: '/work is not empty' })),
    );
    await startRun();
    expect($job.get()).toMatchObject({ status: 'error', message: '/work is not empty' });
    expect($job.get().busyJobId).toBeUndefined();
  });

  it('startRun is a no-op while a run is being watched', async () => {
    const fetchMock = serverWith([reply(200, job())]);
    vi.stubGlobal('fetch', fetchMock);
    await startRun();
    await startRun();
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/inflate/run')).toHaveLength(1);
  });

  it('a 404 while polling means the server forgot the run (it restarted)', async () => {
    const fetchMock = serverWith([
      reply(200, job()),
      reply(404, { error: 'not-found', message: 'gone' }),
    ]);
    vi.stubGlobal('fetch', fetchMock);
    await startRun();
    await tick(0);
    await tick(JOB_POLL_MS);
    expect($job.get().status).toBe('lost');
    expect($job.get().job?.id).toBe(JOB_ID); // the last known state is kept
    const polls = (): number =>
      fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(JOB_ID)).length;
    const before = polls();
    await tick(JOB_POLL_MS * 6);
    expect(polls()).toBe(before);
  });

  it('network errors back off to 2 s and recover', async () => {
    let calls = 0;
    const times: number[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/inflate/run') return respond(202, { jobId: JOB_ID, job: job() });
        if (url === '/api/inflate/plan') return respond(200, planResponse());
        calls++;
        times.push(Date.now());
        if (calls <= 4) throw new TypeError('network down');
        return respond(200, job({ status: 'done', finishedAt: '2026-01-01T00:00:03.000Z' }));
      }),
    );
    const t0 = Date.now();
    await startRun();
    await tick(0);
    await tick(30_000);
    expect($job.get().job?.status).toBe('done');
    const gaps = times.slice(1).map((t, i) => t - (times[i] ?? t0));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2000);
    expect(gaps.at(-1)).toBeGreaterThanOrEqual(1000);
  });

  it('resumeJob (reload with ?job=) fetches the job once and keeps polling while it runs', async () => {
    const fetchMock = serverWith([reply(200, job()), reply(200, job({ status: 'done' }))]);
    vi.stubGlobal('fetch', fetchMock);
    resumeJob(JOB_ID);
    expect($job.get().status).toBe('loading');
    expect($jobActive.get()).toBe(true);
    await tick(0);
    expect($job.get().job?.status).toBe('running');
    await tick(JOB_POLL_MS);
    expect($job.get().job?.status).toBe('done');
    resumeJob(JOB_ID); // already showing it
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(JOB_ID))).toHaveLength(2);
  });

  it('attachJob shows a running job and puts it in the URL', async () => {
    vi.stubGlobal('fetch', serverWith([reply(200, job())]));
    attachJob(JOB_ID);
    await tick(0);
    expect($job.get().job?.id).toBe(JOB_ID);
    expect($inflateUrl.get().job).toBe(JOB_ID);
  });

  it('cancelRun posts to the cancel endpoint and shows the answer', async () => {
    const fetchMock = serverWith([reply(200, job())]);
    vi.stubGlobal('fetch', fetchMock);
    await startRun();
    await cancelRun();
    const cancel = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith('/cancel'),
    ) as unknown as [string, RequestInit];
    expect(cancel[0]).toBe(`/api/inflate/jobs/${JOB_ID}/cancel`);
    expect(cancel[1].method).toBe('POST');
    expect($job.get().job?.cancelRequested).toBe(true);
  });

  it('closeJob forgets the job, drops it from the URL and stops polling', async () => {
    const fetchMock = serverWith([reply(200, job())]);
    vi.stubGlobal('fetch', fetchMock);
    await startRun();
    await tick(0);
    closeJob();
    expect($job.get()).toEqual({ status: 'idle', job: null });
    expect($inflateUrl.get()).toMatchObject({ view: 'run', job: null });
    const before = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(JOB_ID)).length;
    await tick(JOB_POLL_MS * 10);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith(JOB_ID)).length).toBe(before);
  });

  it('openInIde posts the directory and reports success and failure', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(200, { ok: true, command: ['code', '/work'] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await openInIde('/work');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({ dir: '/work' });
    expect($ide.get()).toMatchObject({ status: 'ok', message: 'Opened in the IDE' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(501, { error: 'ide-not-found', message: 'no IDE command found' })),
    );
    await openInIde('/work');
    expect($ide.get()).toMatchObject({ status: 'error', message: 'no IDE command found' });
  });
});
