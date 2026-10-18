import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetId } from '../../src/datasets/registry.ts';
import { LINKABLE_DATASETS } from '../../src/datasets/registry.ts';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';
import { $entries } from '../../src/stores/entries.ts';
import type { EntriesState } from '../../src/stores/entries.ts';
import {
  $baseline,
  $contextDocs,
  $dirty,
  $lastAddedBlock,
  $plan,
  $recipeLoad,
  $render,
  $saveStatus,
  $segmentBytes,
  $working,
  $writeStatus,
  addItem,
  browserLookup,
  createRecipe,
  insertMarkdownAfter,
  loadRecipe,
  moveSegment,
  pruneStale,
  removeItem,
  removeMarkdown,
  renderNow,
  resetOrder,
  revert,
  save,
  setDefaultMode,
  setDescription,
  setExcluded,
  setLayout,
  setMarkdownBody,
  setMode,
  setOption,
  setPreamble,
  setTarget,
  toggleContext,
  writeOutput,
} from '../../src/stores/inflate.ts';
import { formatBytes, recipeNameProblem } from '../../src/ui/inflate/format.ts';

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
  contexts: ['ctx-a'],
  items: [{ dataset: 'skill', slug: 'my-skill' }],
  markdown: [{ id: 'b1', body: 'hello' }],
  overrides: [],
  order: [],
  defaults: {},
};

/** Cached server data: context `ctx-a` links kb/one, task/two and the reference `refs-a`. */
function seedCaches(): void {
  const entries: Partial<Record<DatasetId, EntriesState>> = {};
  for (const ds of LINKABLE_DATASETS) entries[ds] = ready();
  entries.kb = ready(summary('kb', 'one', { title: 'One' }), summary('kb', 'extra'));
  entries.task = ready(summary('task', 'two', { state: 'pending' }));
  entries.skill = ready(summary('skill', 'my-skill'));
  entries.reference = ready(summary('reference', 'refs-a', { refType: 'remote-repo' }));
  $entries.set(entries);
  $contextDocs.set({
    'ctx-a': {
      status: 'ready',
      context: {
        name: 'ctx-a',
        description: 'Context A',
        links: [
          { dataset: 'kb', slug: 'one' },
          { dataset: 'task', slug: 'two', notes: 'Look here' },
          { dataset: 'reference', slug: 'refs-a' },
        ],
      },
    },
    'ctx-b': {
      status: 'ready',
      context: {
        name: 'ctx-b',
        description: 'Context B',
        links: [{ dataset: 'kb', slug: 'extra' }],
      },
    },
  });
}

function load(recipe: RecipeData = base): void {
  $baseline.set(structuredClone(recipe));
  $working.set(structuredClone(recipe));
}

const keys = (): string[] => ($plan.get()?.segments ?? []).map((s) => s.key);
const working = (): RecipeData => {
  const w = $working.get();
  if (w === null) throw new Error('no working recipe');
  return w;
};

beforeEach(() => {
  seedCaches();
  load();
  $saveStatus.set({ kind: 'idle' });
  $lastAddedBlock.set(null);
});

afterEach(() => {
  $baseline.set(null);
  $working.set(null);
  $contextDocs.set({});
  $entries.set({});
  $render.set({ status: 'idle', result: null });
  $writeStatus.set({ kind: 'idle' });
  $recipeLoad.set({ status: 'none' });
  vi.unstubAllGlobals();
});

describe('composition (browser expandRecipe over the caches)', () => {
  it('lists the grouped default order', () => {
    expect(keys()).toEqual([
      'ctx:ctx-a',
      'kb/one',
      'task/two',
      'reference/refs-a',
      'sec:extra',
      'skill/my-skill',
      'md:b1',
    ]);
    const task = $plan.get()?.segments.find((s) => s.key === 'task/two');
    expect(task?.type === 'item' && task.via).toEqual(['ctx-a']);
  });

  it('browserLookup: loading until the dataset cache exists, missing when absent, invalid on error', () => {
    const lookup = browserLookup({}, { kb: ready(summary('kb', 'one')) });
    expect(lookup.context('x')).toEqual({ status: 'loading' });
    expect(lookup.item('kb', 'one').status).toBe('ready');
    expect(lookup.item('kb', 'nope')).toEqual({ status: 'missing' });
    expect(lookup.item('task', 'x')).toEqual({ status: 'loading' });
    const failing = browserLookup({}, { kb: { status: 'error', entries: [], error: 'HTTP 500' } });
    expect(failing.item('kb', 'one').status).toBe('invalid');
    // a refetch keeps the previous rows: no flicker back to "loading"
    const refetch = browserLookup(
      {},
      { kb: { status: 'loading', entries: [summary('kb', 'one')] } },
    );
    expect(refetch.item('kb', 'one').status).toBe('ready');
  });

  it('a context that is still loading makes the plan pending', () => {
    $contextDocs.setKey('ctx-a', { status: 'loading' });
    expect($plan.get()?.pending).toBe(true);
  });
});

describe('editing actions', () => {
  it('starts clean, becomes dirty after an edit, and revert restores the baseline', () => {
    expect($dirty.get()).toBe(false);
    setDescription('Changed');
    expect($dirty.get()).toBe(true);
    revert();
    expect($dirty.get()).toBe(false);
    expect($working.get()).toEqual(base);
    expect($working.get()).not.toBe($baseline.get());
  });

  it('never mutates the previous working copy', () => {
    const before = working();
    const snapshot = JSON.stringify(before);
    setMode('kb/one', 'summary');
    setOption('kb/one', 'includeFrontmatter', true);
    moveSegment('kb/one', 1);
    insertMarkdownAfter(null);
    toggleContext('ctx-b', true);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('an edit clears a stale "saved" status', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    setTarget('codex');
    expect($saveStatus.get().kind).toBe('idle');
    expect(working().target).toBe('codex');
    setLayout('flat');
    expect(working().layout).toBe('flat');
  });

  it("setPreamble('') removes the key so the recipe equals the baseline again", () => {
    setPreamble('Be careful.\n');
    expect($dirty.get()).toBe(true);
    expect(working().preamble).toBe('Be careful.\n');
    setPreamble('');
    expect(Object.hasOwn(working(), 'preamble')).toBe(false);
    expect($dirty.get()).toBe(false);
  });

  it('addItem appends once; removeItem drops it from items', () => {
    addItem('kb', 'extra');
    addItem('kb', 'extra');
    expect(working().items.map((i) => `${i.dataset}/${i.slug}`)).toEqual([
      'skill/my-skill',
      'kb/extra',
    ]);
    expect(keys()).toContain('kb/extra');
    removeItem('kb/extra');
    expect(working().items).toHaveLength(1);
    expect(keys()).not.toContain('kb/extra');
  });

  it('removeItem keeps a segment that a context still links, and its override', () => {
    addItem('kb', 'one'); // ad hoc AND linked by ctx-a
    setMode('kb/one', 'summary');
    removeItem('kb/one');
    expect(keys()).toContain('kb/one');
    expect(working().overrides.map((o) => o.key)).toEqual(['kb/one']);
  });

  it('toggleContext adds / removes a context and prunes order + overrides of its items', () => {
    toggleContext('ctx-b', true);
    toggleContext('ctx-b', true); // already on: no-op
    expect(working().contexts).toEqual(['ctx-a', 'ctx-b']);
    expect(keys()).toContain('kb/extra');
    setMode('kb/extra', 'summary');
    moveSegment('kb/extra', -1);
    expect(working().order).toContain('kb/extra');
    toggleContext('ctx-b', false);
    expect(working().contexts).toEqual(['ctx-a']);
    expect(working().overrides).toEqual([]);
    expect(working().order).not.toContain('kb/extra');
    expect(working().order).not.toContain('ctx:ctx-b');
  });

  it('prune is skipped while a lookup is still loading', () => {
    setMode('kb/one', 'summary');
    $contextDocs.setKey('ctx-a', { status: 'loading' });
    toggleContext('ctx-b', true);
    toggleContext('ctx-b', false);
    expect(working().overrides.map((o) => o.key)).toEqual(['kb/one']);
  });
});

describe('modes, options, defaults, exclude', () => {
  it('setMode stores an override and drops it when it equals what the plan would pick', () => {
    setMode('kb/one', 'inline-bundle');
    expect(working().overrides).toEqual([{ key: 'kb/one', mode: 'inline-bundle' }]);
    setMode('kb/one', 'inline-main'); // the built-in default of a kb entry
    expect(working().overrides).toEqual([]);
    expect($dirty.get()).toBe(false);
  });

  it('setMode compares against the recipe default, not the built-in one', () => {
    setDefaultMode('kb', 'summary');
    setMode('kb/one', 'inline-main');
    expect(working().overrides).toEqual([{ key: 'kb/one', mode: 'inline-main' }]);
    setMode('kb/one', 'summary');
    expect(working().overrides).toEqual([]);
  });

  it('setOption stores a value and drops it when it equals the base value', () => {
    setOption('kb/one', 'includeFrontmatter', true);
    expect(working().overrides).toEqual([{ key: 'kb/one', options: { includeFrontmatter: true } }]);
    setOption('kb/one', 'shiftHeadings', false);
    expect(working().overrides[0]?.options).toEqual({
      includeFrontmatter: true,
      shiftHeadings: false,
    });
    setOption('kb/one', 'includeFrontmatter', false); // equals the default
    setOption('kb/one', 'shiftHeadings', true);
    expect(working().overrides).toEqual([]);
  });

  it('setOption uses the recipe default as the base value', () => {
    setDefaultMode('kb', 'inline-main');
    const w = working();
    $working.set({ ...w, defaults: { kb: { options: { shiftHeadings: false } } } });
    setOption('kb/one', 'shiftHeadings', false);
    expect(working().overrides).toEqual([]);
    setOption('kb/one', 'shiftHeadings', true);
    expect(working().overrides).toEqual([{ key: 'kb/one', options: { shiftHeadings: true } }]);
  });

  it('a cloneDir equal to the resolved default is not kept', () => {
    // `refs-a` is a remote-repo: its `clone` mode is the one with the cloneDir option
    setMode('reference/refs-a', 'clone');
    setOption('reference/refs-a', 'cloneDir', '.ctxman/refs/other');
    expect(working().overrides[0]?.options?.cloneDir).toBe('.ctxman/refs/other');
    setOption('reference/refs-a', 'cloneDir', '.ctxman/refs/refs-a');
    expect(working().overrides[0]?.options).toBeUndefined();
  });

  it('setDefaultMode sets and clears a per-kind default; the built-in mode is not stored', () => {
    setDefaultMode('kb', 'summary');
    expect(working().defaults).toEqual({ kb: { mode: 'summary' } });
    const seg = $plan.get()?.segments.find((s) => s.key === 'kb/one');
    expect(seg?.type === 'item' && seg.mode).toBe('summary');
    setDefaultMode('kb', null);
    expect(working().defaults).toEqual({});
    setDefaultMode('kb', 'inline-main'); // equals the built-in default
    expect(working().defaults).toEqual({});
    expect($dirty.get()).toBe(false);
  });

  it('setExcluded sets and removes the flag, and an empty override disappears', () => {
    setExcluded('task/two', true);
    expect(working().overrides).toEqual([{ key: 'task/two', exclude: true }]);
    const seg = $plan.get()?.segments.find((s) => s.key === 'task/two');
    expect(seg?.status).toBe('excluded');
    setExcluded('task/two', false);
    expect(working().overrides).toEqual([]);
    expect($dirty.get()).toBe(false);
  });

  it('an override keeps its position in the list when edited', () => {
    setMode('kb/one', 'summary');
    setMode('task/two', 'pointer');
    setOption('kb/one', 'eager', true); // kb/one is in summary: option not applicable, still stored
    expect(working().overrides.map((o) => o.key)).toEqual(['kb/one', 'task/two']);
  });
});

describe('order and markdown', () => {
  it('moveSegment swaps with the neighbour and makes the whole order explicit', () => {
    moveSegment('task/two', -1);
    expect(working().order).toEqual(keys());
    expect(keys().slice(0, 4)).toEqual(['ctx:ctx-a', 'task/two', 'kb/one', 'reference/refs-a']);
    moveSegment('ctx:ctx-a', -1); // already first: no-op
    moveSegment('md:b1', 1); // already last: no-op
    expect(keys()[0]).toBe('ctx:ctx-a');
    expect(keys().at(-1)).toBe('md:b1');
  });

  it('resetOrder clears the explicit order', () => {
    moveSegment('task/two', -1);
    resetOrder();
    expect(working().order).toEqual([]);
    expect(keys()[1]).toBe('kb/one');
  });

  it('insertMarkdownAfter adds the next block id right after a segment, or at the end', () => {
    insertMarkdownAfter('kb/one');
    expect(working().markdown.map((b) => b.id)).toEqual(['b1', 'b2']);
    const k = keys();
    expect(k[k.indexOf('kb/one') + 1]).toBe('md:b2');
    expect(working().order).toEqual(k);
    expect($lastAddedBlock.get()).toBe('b2');
    insertMarkdownAfter(null);
    expect(keys().at(-1)).toBe('md:b3');
  });

  it('setMarkdownBody edits one block; removeMarkdown drops it and its order key', () => {
    insertMarkdownAfter(null);
    setMarkdownBody('b2', 'typed');
    expect(working().markdown.find((b) => b.id === 'b2')?.body).toBe('typed');
    expect(working().markdown.find((b) => b.id === 'b1')?.body).toBe('hello');
    removeMarkdown('b2');
    expect(working().markdown.map((b) => b.id)).toEqual(['b1']);
    expect(working().order).not.toContain('md:b2');
  });

  it('pruneStale drops order keys and overrides that match nothing', () => {
    const w = working();
    $working.set({
      ...w,
      order: ['ctx:ctx-a', 'kb/ghost', 'kb/one'],
      overrides: [{ key: 'kb/ghost', mode: 'summary' }],
    });
    expect($plan.get()?.staleOverrides).toEqual(['kb/ghost']);
    pruneStale();
    expect(working().order).toEqual(['ctx:ctx-a', 'kb/one']);
    expect(working().overrides).toEqual([]);
    expect($plan.get()?.staleOverrides).toEqual([]);
  });
});

describe('server actions (fetch stubbed)', () => {
  const respond = (status: number, body?: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/inflate', search: '?recipe=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  });

  it('save PUTs the working copy and adopts the response as the new baseline', async () => {
    setDescription('Saved text');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.startsWith('/api/entries')
        ? respond(200, { entries: [] }) // invalidateEntries('recipe') after the save
        : respond(200, { recipe: JSON.parse(String(init?.body)), lastModified: 'now' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await save();
    const puts = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[0]).toBe('/api/recipe/demo');
    expect($saveStatus.get().kind).toBe('saved');
    expect($dirty.get()).toBe(false);
    expect($baseline.get()?.description).toBe('Saved text');
  });

  it('save reports the server message and issues', async () => {
    setDescription('x');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(400, {
          error: 'invalid',
          message: 'bad',
          issues: [{ path: 'order.0', message: 'no' }],
        }),
      ),
    );
    await save();
    expect($saveStatus.get()).toEqual({
      kind: 'error',
      message: 'bad',
      issues: [{ path: 'order.0', message: 'no' }],
    });
    expect($dirty.get()).toBe(true);
  });

  it('createRecipe maps 409 to a name error and posts the empty grouped recipe', async () => {
    const fetchMock = vi.fn(async () => respond(409, { error: 'exists', message: 'exists' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createRecipe({ name: 'demo', description: 'd', target: 'codex' });
    expect(result).toEqual({
      ok: false,
      field: 'name',
      message: 'A recipe with this name already exists.',
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'demo',
      description: 'd',
      target: 'codex',
      layout: 'grouped',
      contexts: [],
      items: [],
    });
  });

  it('loadRecipe: 404 is not-found, 200 adopts and starts a render', async () => {
    $baseline.set(null);
    $working.set(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(404, { error: 'not-found', message: 'no' })),
    );
    await loadRecipe('nope');
    expect($recipeLoad.get().status).toBe('not-found');

    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('/api/recipe/')
        ? respond(200, { recipe: base, lastModified: 'now' })
        : respond(200, { markdown: '# demo\n', manifest: { bytes: 7, segments: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await loadRecipe('demo');
    expect($recipeLoad.get().status).toBe('ready');
    expect($working.get()?.name).toBe('demo');
    await vi.waitFor(() => expect($render.get().status).toBe('ready'));
    expect($render.get().result?.markdown).toBe('# demo\n');
    // same recipe again: no second GET
    const calls = fetchMock.mock.calls.length;
    await loadRecipe('demo');
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('renderNow keeps the previous result on error and drops responses of older requests', async () => {
    const result = {
      markdown: '# one\n',
      manifest: { bytes: 6, segments: [{ key: 'kb/one', bytes: 4 }] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, result)),
    );
    await renderNow();
    expect($render.get().status).toBe('ready');
    expect($segmentBytes.get().get('kb/one')).toBe(4);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(400, {
          error: 'invalid',
          message: 'recipe is invalid',
          issues: [{ path: 'name', message: 'x' }],
        }),
      ),
    );
    await renderNow();
    const failed = $render.get();
    expect(failed.status).toBe('error');
    expect(failed.message).toBe('recipe is invalid; name: x');
    expect(failed.result?.markdown).toBe('# one\n');

    let release: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(
        respond(200, { markdown: '# newer\n', manifest: { bytes: 8, segments: [] } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const first = renderNow();
    await renderNow();
    release(respond(200, { markdown: '# older\n', manifest: { bytes: 8, segments: [] } }));
    await first;
    expect($render.get().result?.markdown).toBe('# newer\n');
  });

  it('writeOutput posts the working recipe and the path, and reports success and failure', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(200, { path: '/tmp/x/brief.md', bytes: 42, manifest: {} }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await writeOutput('/tmp/x/brief.md');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).path).toBe('/tmp/x/brief.md');
    expect(JSON.parse(String(init.body)).recipe.name).toBe('demo');
    expect($writeStatus.get()).toEqual({ kind: 'written', path: '/tmp/x/brief.md', bytes: 42 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(400, { error: 'bad-path', message: 'path must be absolute' })),
    );
    await writeOutput('x.md');
    expect($writeStatus.get()).toEqual({ kind: 'error', message: 'path must be absolute' });
  });
});

describe('format helpers', () => {
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('recipeNameProblem: entry-name rule, reserved "new", uniqueness', () => {
    expect(recipeNameProblem('')).toBe('Required');
    expect(recipeNameProblem('Bad Name')).toContain('lowercase');
    expect(recipeNameProblem('new')).toBe('"new" is reserved');
    expect(recipeNameProblem('taken', new Set(['taken']))).toBe(
      'A recipe with this name already exists',
    );
    expect(recipeNameProblem('fresh', new Set(['taken']))).toBeNull();
  });
});
