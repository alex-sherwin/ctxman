// NewEntryForm store (src/stores/new-entry.ts): validation filtering, the POST, error mapping and the
// navigation after a create. Browser globals are stubbed; fetch answers `GET /api/entries?dataset=`
// and `POST /api/entry/<ds>`.
import { cleanStores } from 'nanostores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';
import { $entries } from '../../src/stores/entries.ts';
import {
  $newAttempted,
  $newDirty,
  $newDone,
  $newDraft,
  $newErrors,
  $newPartial,
  $newSave,
  $newServerErrors,
  initNewEntry,
  setNewField,
  submitNewEntry,
} from '../../src/stores/new-entry.ts';

interface Env {
  assign: ReturnType<typeof vi.fn>;
  posts: { path: string; body: unknown }[];
  /** Entries `GET /api/entries?dataset=<ds>` lists. */
  listed: Record<string, string[]>;
  /** The answer to the POST. */
  answer: () => Response;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const summary = (dataset: string, slug: string): EntrySummary =>
  ({
    dataset,
    slug,
    name: slug,
    title: slug,
    url: `/${dataset}/${slug}`,
  }) as unknown as EntrySummary;

function stubBrowser(): Env {
  const env: Env = {
    assign: vi.fn(),
    posts: [],
    listed: { task: ['taken'], project: ['ctxman-v1'] },
    answer: () => json({ url: '/task/fresh' }, 201),
  };
  vi.stubGlobal('location', { pathname: '/new/task', search: '', hash: '', assign: env.assign });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), 'http://ctxman.invalid');
      if (url.pathname === '/api/entries') {
        const ds = url.searchParams.get('dataset') ?? '';
        return json({ entries: (env.listed[ds] ?? []).map((slug) => summary(ds, slug)) });
      }
      expect(init?.method).toBe('POST');
      env.posts.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      return env.answer();
    }),
  );
  return env;
}

/** Wait until both lists `initNewEntry` starts are ready. */
async function loaded(): Promise<void> {
  await vi.waitFor(() => {
    expect($entries.get().task?.status).toBe('ready');
    expect($entries.get().project?.status).toBe('ready');
  });
}

function fill(patch: { name?: string; description?: string } = {}): void {
  setNewField('name', patch.name ?? 'fresh');
  setNewField('description', patch.description ?? 'A fresh task');
}

beforeEach(() => {
  $entries.set({});
  $newDone.set(false);
  $newPartial.set(null);
});

afterEach(() => {
  cleanStores($entries);
  vi.unstubAllGlobals();
});

describe('initNewEntry', () => {
  it('starts blank in the first state with the parent prefilled, and loads the lists', async () => {
    stubBrowser();
    initNewEntry({ dataset: 'task', parent: 'ctxman-v1' });
    expect($newDraft.get()).toEqual({
      name: '',
      title: '',
      description: '',
      state: 'pending',
      tags: [],
      parent: 'ctxman-v1',
    });
    expect($newDirty.get()).toBe(false);
    await loaded();
    expect($newErrors.get()).toEqual({});
  });
});

describe('errors shown', () => {
  it('shows the live name rule only once a name is typed, and the rest after an attempt', async () => {
    stubBrowser();
    initNewEntry({ dataset: 'task', parent: null });
    await loaded();
    expect($newErrors.get()).toEqual({});
    setNewField('name', 'Bad Name');
    expect($newErrors.get().name).toContain('lowercase');
    expect($newErrors.get().description).toBeUndefined();
    setNewField('name', 'taken');
    expect($newErrors.get().name).toBe('A task with this name already exists');
    await submitNewEntry();
    expect($newAttempted.get()).toBe(true);
    expect($newErrors.get().description).toBe('Required');
  });

  it('a prefilled project that does not exist is reported at once, once the list is loaded', async () => {
    stubBrowser();
    initNewEntry({ dataset: 'task', parent: 'gone' });
    expect($newErrors.get().parent).toBeUndefined(); // list not loaded yet
    await loaded();
    expect($newErrors.get().parent).toBe('Project "gone" does not exist');
    setNewField('parent', null);
    expect($newErrors.get().parent).toBeUndefined();
  });
});

describe('submitNewEntry', () => {
  it('an invalid form sends nothing and says so', async () => {
    const env = stubBrowser();
    initNewEntry({ dataset: 'task', parent: null });
    await loaded();
    expect(await submitNewEntry()).toBe('invalid');
    expect(env.posts).toEqual([]);
    expect($newSave.get()).toEqual({ kind: 'error', message: 'Fix the highlighted fields' });
  });

  it('POSTs the body and navigates to the new entry at once', async () => {
    const env = stubBrowser();
    initNewEntry({ dataset: 'task', parent: 'ctxman-v1' });
    await loaded();
    fill();
    setNewField('tags', ['auth']);
    expect(await submitNewEntry()).toBe('sent');
    expect(env.posts).toEqual([
      {
        path: '/api/entry/task',
        body: {
          name: 'fresh',
          description: 'A fresh task',
          tags: ['auth'],
          state: 'pending',
          parent: 'ctxman-v1',
        },
      },
    ]);
    expect(env.assign).toHaveBeenCalledExactlyOnceWith('/task/fresh');
    expect($newDone.get()).toBe(true);
    expect($newDirty.get()).toBe(false);
  });

  it('a 409 puts the error on the name and keeps the form editable', async () => {
    const env = stubBrowser();
    env.answer = () => json({ error: 'exists', message: 'task "fresh" already exists' }, 409);
    initNewEntry({ dataset: 'task', parent: null });
    await loaded();
    fill();
    expect(await submitNewEntry()).toBe('sent');
    expect($newErrors.get().name).toBe('A task with this name already exists');
    expect($newSave.get()).toEqual({
      kind: 'error',
      message: 'A task with this name already exists',
    });
    expect(env.assign).not.toHaveBeenCalled();
    expect($newDone.get()).toBe(false);
    setNewField('name', 'fresh-2');
    expect($newServerErrors.get().name).toBeUndefined();
    expect($newSave.get().kind).toBe('idle');
  });

  it('400 issues land on their fields', async () => {
    const env = stubBrowser();
    env.answer = () =>
      json(
        {
          error: 'invalid',
          message: 'request body is invalid',
          issues: [{ path: 'parent', message: 'project "ctxman-v1" does not exist' }],
        },
        400,
      );
    initNewEntry({ dataset: 'task', parent: 'ctxman-v1' });
    await loaded();
    fill();
    await submitNewEntry();
    expect($newErrors.get().parent).toBe('project "ctxman-v1" does not exist');
    expect($newSave.get().message).toBe('Fix the highlighted fields');
  });

  it('a created entry whose parent link failed stays on the page and offers the entry', async () => {
    const env = stubBrowser();
    env.answer = () =>
      json({ url: '/task/fresh', parentLinked: false, parentError: 'file is invalid' }, 201);
    initNewEntry({ dataset: 'task', parent: 'ctxman-v1' });
    await loaded();
    fill();
    await submitNewEntry();
    expect(env.assign).not.toHaveBeenCalled();
    expect($newPartial.get()).toEqual({
      url: '/task/fresh',
      message: 'Created, but it could not be added to project ctxman-v1: file is invalid',
    });
    expect($newDone.get()).toBe(true);
  });

  it('a second press while sending is ignored', async () => {
    const env = stubBrowser();
    initNewEntry({ dataset: 'task', parent: null });
    await loaded();
    fill();
    const first = submitNewEntry();
    expect(await submitNewEntry()).toBe('busy');
    await first;
    expect(env.posts).toHaveLength(1);
    expect(env.assign).toHaveBeenCalledOnce();
  });
});
