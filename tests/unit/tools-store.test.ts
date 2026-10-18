// Tools store: a successful `add` opens the new entry (ROUND2_UI_SPEC §I). Browser globals are stubbed; fetch answers
// both `POST /api/scripts/add` and `GET /api/entries?dataset=` (the real `waitForEntry` runs against it).
import { cleanStores } from 'nanostores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetId } from '../../src/datasets/registry.ts';
import { $entries } from '../../src/stores/entries.ts';
import { $addDataset, $run, clearRun, runScript } from '../../src/stores/tools.ts';
import type { RunState } from '../../src/stores/tools.ts';

const STORAGE_KEY = 'ctxman:tools:last-run';
const plainResult = { code: 0, stdout: 'ok', stderr: '', durationMs: 5 };

interface Env {
  assign: ReturnType<typeof vi.fn>;
  storage: Map<string, string>;
  /** Slugs `GET /api/entries?dataset=<ds>` lists, per dataset; mutate to make an entry appear. */
  listed: Partial<Record<DatasetId, string[]>>;
  entryCalls: DatasetId[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs location / history / sessionStorage / fetch. `scriptResult` is the body of `POST /api/scripts/add`. */
function stubBrowser(scriptResult: object): Env {
  const env: Env = { assign: vi.fn(), storage: new Map(), listed: {}, entryCalls: [] };
  vi.stubGlobal('location', {
    pathname: '/tools',
    search: '?add=idea',
    hash: '',
    assign: env.assign,
  });
  vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => env.storage.get(k) ?? null,
    setItem: (k: string, v: string) => void env.storage.set(k, v),
    removeItem: (k: string) => void env.storage.delete(k),
  });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'http://ctxman.invalid');
      if (url.pathname === '/api/entries') {
        const ds = url.searchParams.get('dataset') as DatasetId;
        env.entryCalls.push(ds);
        return json({ entries: (env.listed[ds] ?? []).map((slug) => ({ dataset: ds, slug })) });
      }
      expect(init?.method).toBe('POST');
      // Only the `add` script creates something.
      return json(url.pathname.endsWith('/add') ? scriptResult : plainResult);
    }),
  );
  return env;
}

function addResult(dataset: DatasetId, slug: string, code = 0): object {
  const base = { code, stdout: 'out', stderr: code === 0 ? '' : 'already exists', durationMs: 5 };
  if (code !== 0) return base;
  return {
    ...base,
    created: { dataset, slug, path: `${dataset}/${slug}/main.md`, url: `/${dataset}/${slug}` },
  };
}

function saved(env: Env): RunState {
  return JSON.parse(env.storage.get(STORAGE_KEY) ?? 'null') as RunState;
}

beforeEach(() => {
  $entries.set({});
  $run.set({ status: 'idle' });
  $addDataset.set(null);
});

afterEach(() => {
  cleanStores($addDataset); // unmounts at once (onMount otherwise lingers for a second)
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('runScript(add) follow', () => {
  it('opens a context at once, without polling /api/entries, and saves follow:false first', async () => {
    const env = stubBrowser(addResult('context', 'fresh'));
    await runScript('add', { dataset: 'context', name: 'fresh', description: 'd' });
    await vi.waitFor(() => expect(env.assign).toHaveBeenCalledWith('/context/fresh'));
    expect(env.entryCalls).toEqual([]);
    expect(saved(env).follow).toBe(false);
    expect(saved(env).created?.url).toBe('/context/fresh');
  });

  it('opens a recipe at once', async () => {
    const env = stubBrowser(addResult('recipe', 'r1'));
    await runScript('add', { dataset: 'recipe', name: 'r1', description: 'd' });
    await vi.waitFor(() => expect(env.assign).toHaveBeenCalledWith('/recipe/r1'));
    expect(env.entryCalls).toEqual([]);
  });

  it('saves follow:true with the run, then waits until the okf entry is listed', async () => {
    vi.useFakeTimers();
    const env = stubBrowser(addResult('idea', 'fresh'));
    await runScript('add', { dataset: 'idea', name: 'fresh', description: 'd' });
    expect($run.get().follow).toBe(true);
    expect(saved(env).follow).toBe(true);
    expect(typeof saved(env).followUntil).toBe('number');

    await vi.advanceTimersByTimeAsync(450); // polls at 0, 150, 300, 450: not listed yet
    expect(env.entryCalls.length).toBeGreaterThanOrEqual(3);
    expect(env.assign).not.toHaveBeenCalled();
    expect($run.get().follow).toBe(true);

    env.listed.idea = ['fresh'];
    await vi.advanceTimersByTimeAsync(200);
    expect(env.assign).toHaveBeenCalledExactlyOnceWith('/idea/fresh');
    expect(saved(env).follow).toBe(false);
  });

  it('times out after 5 s: no navigation, followTimedOut is set and saved', async () => {
    vi.useFakeTimers();
    const env = stubBrowser(addResult('skill', 'never'));
    await runScript('add', { dataset: 'skill', name: 'never', description: 'd' });
    await vi.advanceTimersByTimeAsync(5200);
    expect(env.assign).not.toHaveBeenCalled();
    expect($run.get()).toMatchObject({ follow: false, followTimedOut: true, status: 'done' });
    expect(saved(env)).toMatchObject({ follow: false, followTimedOut: true });
  });

  it('does not follow a failed add', async () => {
    const env = stubBrowser(addResult('idea', 'dup', 1));
    await runScript('add', { dataset: 'idea', name: 'dup', description: 'd' });
    expect($run.get()).toMatchObject({ status: 'done', code: 1, stderr: 'already exists' });
    expect($run.get().follow).toBeUndefined();
    expect(env.entryCalls).toEqual([]);
    expect(env.assign).not.toHaveBeenCalled();
  });

  it('clearRun cancels a wait in progress', async () => {
    vi.useFakeTimers();
    const env = stubBrowser(addResult('task', 'cancelled'));
    await runScript('add', { dataset: 'task', name: 'cancelled', description: 'd' });
    await vi.advanceTimersByTimeAsync(200);
    clearRun();
    env.listed.task = ['cancelled'];
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.assign).not.toHaveBeenCalled();
    expect($run.get().status).toBe('idle');
    expect(env.storage.has(STORAGE_KEY)).toBe(false);
  });

  it('a new run cancels the wait', async () => {
    vi.useFakeTimers();
    const env = stubBrowser(addResult('task', 'first'));
    await runScript('add', { dataset: 'task', name: 'first', description: 'd' });
    await vi.advanceTimersByTimeAsync(200);
    await runScript('check', {});
    expect(saved(env)).toMatchObject({ script: 'check' });
    env.listed.task = ['first'];
    await vi.advanceTimersByTimeAsync(1000);
    expect(env.assign).not.toHaveBeenCalled();
  });
});

describe('restore after the dev reload', () => {
  function savedRun(overrides: Partial<RunState>): RunState {
    return {
      status: 'done',
      script: 'add',
      code: 0,
      stdout: '',
      stderr: '',
      durationMs: 5,
      created: { dataset: 'idea', slug: 'later', path: 'idea/later/main.md', url: '/idea/later' },
      follow: true,
      followUntil: Date.now() + 10_000,
      ...overrides,
    };
  }

  it('resumes a saved follow: waits for the entry, then navigates', async () => {
    const env = stubBrowser({});
    env.listed.idea = ['later'];
    env.storage.set(STORAGE_KEY, JSON.stringify(savedRun({})));
    const unbind = $addDataset.listen(() => {}); // mounts the store: reads the URL and restores the run
    try {
      expect($addDataset.get()).toBe('idea');
      expect($run.get().follow).toBe(true);
      await vi.waitFor(() => expect(env.assign).toHaveBeenCalledExactlyOnceWith('/idea/later'));
      expect(saved(env).follow).toBe(false);
    } finally {
      unbind();
    }
  });

  it('drops an expired follow instead of navigating', async () => {
    const env = stubBrowser({});
    env.listed.idea = ['later'];
    env.storage.set(STORAGE_KEY, JSON.stringify(savedRun({ followUntil: Date.now() - 1 })));
    const unbind = $addDataset.listen(() => {});
    try {
      expect($run.get().follow).toBe(false);
      expect(saved(env).follow).toBe(false);
      await Promise.resolve();
      expect(env.entryCalls).toEqual([]);
      expect(env.assign).not.toHaveBeenCalled();
    } finally {
      unbind();
    }
  });

  it('fills created.url for a run saved before it existed', () => {
    const env = stubBrowser({});
    const old = savedRun({ follow: false });
    delete (old.created as { url?: string }).url;
    env.storage.set(STORAGE_KEY, JSON.stringify(old));
    const unbind = $addDataset.listen(() => {});
    try {
      expect($run.get().created?.url).toBe('/idea/later');
    } finally {
      unbind();
    }
  });
});
