// Tools store: script runs, their sessionStorage persistence and the `?add=` dataset. Creating entries moved to
// the /new/<ds> forms (ROUND3_SPEC §E.7), so a run never navigates. Browser globals are stubbed.
import { cleanStores } from 'nanostores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  $addDataset,
  $exitCodes,
  $run,
  clearRun,
  runScript,
  setAddDataset,
} from '../../src/stores/tools.ts';
import type { RunState } from '../../src/stores/tools.ts';

const STORAGE_KEY = 'ctxman:tools:last-run';

interface Env {
  assign: ReturnType<typeof vi.fn>;
  replaceState: ReturnType<typeof vi.fn>;
  storage: Map<string, string>;
  /** Paths of the requests fetch received. */
  requests: { path: string; method: string | undefined; body: string | undefined }[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stubs location / history / sessionStorage / fetch; `respond` answers `POST /api/scripts/<name>`. */
function stubBrowser(respond: (name: string) => Response | Error, search = '?add=idea'): Env {
  const env: Env = {
    assign: vi.fn(),
    replaceState: vi.fn(),
    storage: new Map(),
    requests: [],
  };
  vi.stubGlobal('location', { pathname: '/tools', search, hash: '', assign: env.assign });
  vi.stubGlobal('history', { state: null, replaceState: env.replaceState, pushState: vi.fn() });
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
      env.requests.push({
        path: url.pathname,
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      const out = respond(url.pathname.split('/').pop() ?? '');
      if (out instanceof Error) throw out;
      return out;
    }),
  );
  return env;
}

const ok = (code = 0): Response =>
  json({ code, stdout: `out ${code}`, stderr: code === 0 ? '' : 'boom', durationMs: 5 });

function saved(env: Env): RunState | null {
  const raw = env.storage.get(STORAGE_KEY);
  return raw === undefined ? null : (JSON.parse(raw) as RunState);
}

beforeEach(() => {
  $run.set({ status: 'idle' });
  $exitCodes.set({});
  $addDataset.set(null);
});

afterEach(() => {
  cleanStores($addDataset); // unmounts at once (onMount otherwise lingers for a second)
  vi.unstubAllGlobals();
});

describe('runScript', () => {
  it('posts an empty JSON body, stores the finished run and its exit code, and never navigates', async () => {
    const env = stubBrowser(() => ok());
    await runScript('check');
    expect(env.requests).toEqual([{ path: '/api/scripts/check', method: 'POST', body: '{}' }]);
    expect($run.get()).toMatchObject({
      status: 'done',
      script: 'check',
      code: 0,
      stdout: 'out 0',
      durationMs: 5,
    });
    expect($exitCodes.get().check).toBe(0);
    expect(saved(env)).toMatchObject({ status: 'done', script: 'check', code: 0 });
    expect(env.assign).not.toHaveBeenCalled();
  });

  it('a script that exits non-zero is still a finished run', async () => {
    const env = stubBrowser(() => ok(1));
    await runScript('check-okf');
    expect($run.get()).toMatchObject({ status: 'done', code: 1, stderr: 'boom' });
    expect($exitCodes.get()['check-okf']).toBe(1);
    expect(saved(env)?.code).toBe(1);
  });

  it('a failed request is an error with the server message, and is not saved', async () => {
    const env = stubBrowser(() =>
      json(
        { error: 'not-found', message: 'unknown script', issues: [{ path: 'x', message: 'bad' }] },
        404,
      ),
    );
    await runScript('nope');
    expect($run.get()).toMatchObject({
      status: 'error',
      script: 'nope',
      error: 'unknown script; x: bad',
    });
    expect(saved(env)).toBeNull();
  });

  it('a network failure is an error too', async () => {
    stubBrowser(() => new Error('offline'));
    await runScript('check');
    expect($run.get()).toMatchObject({ status: 'error', error: 'offline' });
  });

  it('ignores a run request while another is running', async () => {
    const env = stubBrowser(() => ok());
    $run.set({ status: 'running', script: 'check' });
    await runScript('check-links');
    expect(env.requests).toEqual([]);
    expect($run.get().script).toBe('check');
  });
});

describe('clearRun', () => {
  it('resets to idle and forgets the saved run', async () => {
    const env = stubBrowser(() => ok());
    await runScript('check');
    expect(saved(env)).not.toBeNull();
    clearRun();
    expect($run.get()).toEqual({ status: 'idle' });
    expect(env.storage.has(STORAGE_KEY)).toBe(false);
  });

  it('does nothing while a run is in progress', () => {
    const env = stubBrowser(() => ok());
    env.storage.set(STORAGE_KEY, '{}');
    $run.set({ status: 'running', script: 'check' });
    clearRun();
    expect($run.get().status).toBe('running');
    expect(env.storage.has(STORAGE_KEY)).toBe(true);
  });
});

describe('mount: URL and saved run', () => {
  it('reads ?add= into $addDataset', () => {
    stubBrowser(() => ok(), '?add=bug');
    const unbind = $addDataset.listen(() => {});
    try {
      expect($addDataset.get()).toBe('bug');
    } finally {
      unbind();
    }
  });

  it('an unknown ?add= is null', () => {
    stubBrowser(() => ok(), '?add=nope');
    const unbind = $addDataset.listen(() => {});
    try {
      expect($addDataset.get()).toBeNull();
    } finally {
      unbind();
    }
  });

  it('restores the saved finished run and its exit code (it survives a page reload)', () => {
    const env = stubBrowser(() => ok());
    const run: RunState = {
      status: 'done',
      script: 'check-links',
      code: 2,
      stdout: 'x',
      stderr: '',
      durationMs: 9,
    };
    env.storage.set(STORAGE_KEY, JSON.stringify(run));
    const unbind = $addDataset.listen(() => {});
    try {
      expect($run.get()).toEqual(run);
      expect($exitCodes.get()['check-links']).toBe(2);
      expect(env.assign).not.toHaveBeenCalled();
    } finally {
      unbind();
    }
  });

  it('a run saved by an older version (with add/follow fields) is shown and never navigates', () => {
    const env = stubBrowser(() => ok());
    env.storage.set(
      STORAGE_KEY,
      JSON.stringify({
        status: 'done',
        script: 'add',
        code: 0,
        stdout: 'Created',
        stderr: '',
        durationMs: 5,
        created: {
          dataset: 'idea',
          slug: 'later',
          path: 'idea/later/index.md',
          url: '/idea/later',
        },
        follow: true,
        followUntil: Date.now() + 10_000,
      }),
    );
    const unbind = $addDataset.listen(() => {});
    try {
      expect($run.get()).toMatchObject({ status: 'done', script: 'add' });
      expect(env.assign).not.toHaveBeenCalled();
      expect(env.requests).toEqual([]);
    } finally {
      unbind();
    }
  });

  it('ignores a corrupt or unfinished saved run', () => {
    const env = stubBrowser(() => ok());
    env.storage.set(STORAGE_KEY, '{not json');
    let unbind = $addDataset.listen(() => {});
    unbind();
    cleanStores($addDataset);
    expect($run.get().status).toBe('idle');

    env.storage.set(STORAGE_KEY, JSON.stringify({ status: 'running', script: 'check' }));
    unbind = $addDataset.listen(() => {});
    try {
      expect($run.get().status).toBe('idle');
    } finally {
      unbind();
    }
  });
});

describe('setAddDataset', () => {
  it('sets the store and writes ?add= with replaceState (no history entry)', () => {
    const env = stubBrowser(() => ok(), '?other=1');
    const unbind = $addDataset.listen(() => {}); // mounted, as the island keeps it
    try {
      setAddDataset('kb');
      expect($addDataset.get()).toBe('kb');
      expect(env.replaceState).toHaveBeenCalledOnce();
      const url = String(env.replaceState.mock.calls[0]?.[2]);
      expect(url).toContain('add=kb');
      expect(url).toContain('other=1');
    } finally {
      unbind();
    }
  });
});
