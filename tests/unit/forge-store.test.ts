import { cleanStores } from 'nanostores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetId } from '../../src/datasets/registry.ts';
import { LINKABLE_DATASETS } from '../../src/datasets/registry.ts';
import type { ContextDoc, EntrySummary } from '../../src/lib/entry-summary.ts';
import { $entries } from '../../src/stores/entries.ts';
import type { EntriesState } from '../../src/stores/entries.ts';
import {
  $baseline,
  $discover,
  $dirty,
  $forgeUrl,
  $linkedKeys,
  $saveStatus,
  $view,
  $working,
  $yamlCheck,
  $yamlDraft,
  $yamlInvalid,
  $yamlMarkers,
  addLink,
  addLinks,
  addTag,
  addableChildren,
  moveLink,
  parseLinkKey,
  removeLink,
  removeTag,
  reorderLinks,
  revert,
  setContextTags,
  setDescription,
  setLinkNotes,
  setView,
  setYamlDraft,
} from '../../src/stores/forge.ts';
import { firstLine, lineCount, plural } from '../../src/ui/forge/notes.ts';
import { nameProblem } from '../../src/ui/forge/validate-name.ts';

const base: ContextDoc = {
  name: 'demo',
  description: 'Demo context',
  tags: ['a'],
  links: [
    { dataset: 'kb', slug: 'one', notes: 'first note\nsecond line\n' },
    { dataset: 'task', slug: 'two' },
  ],
};

function load(doc: ContextDoc = base) {
  $baseline.set(structuredClone(doc));
  $working.set(structuredClone(doc));
}

beforeEach(() => {
  load();
  $view.set('form');
  $yamlDraft.set(null);
  $saveStatus.set({ kind: 'idle' });
});

afterEach(() => {
  $baseline.set(null);
  $working.set(null);
  $yamlDraft.set(null);
  vi.unstubAllGlobals();
});

describe('editing actions', () => {
  it('starts clean and becomes dirty after an edit; revert restores the baseline', () => {
    expect($dirty.get()).toBe(false);
    setDescription('Changed');
    expect($dirty.get()).toBe(true);
    revert();
    expect($dirty.get()).toBe(false);
    expect($working.get()).toEqual(base);
    expect($working.get()).not.toBe($baseline.get());
  });

  it('addLink appends { dataset, slug } without a notes key and ignores duplicates', () => {
    addLink('bug', 'x');
    addLink('bug', 'x');
    const links = $working.get()?.links ?? [];
    expect(links).toHaveLength(3);
    expect(links[2]).toEqual({ dataset: 'bug', slug: 'x' });
    expect(Object.hasOwn(links[2] ?? {}, 'notes')).toBe(false);
    expect($linkedKeys.get().has('bug:x')).toBe(true);
  });

  it('removeLink and moveLink keep the other links and swap with the neighbour', () => {
    addLink('bug', 'x');
    moveLink('bug:x', -1);
    expect($working.get()?.links.map((l) => `${l.dataset}:${l.slug}`)).toEqual([
      'kb:one',
      'bug:x',
      'task:two',
    ]);
    moveLink('kb:one', -1); // already first: no-op
    moveLink('task:two', 1); // already last: no-op
    expect($working.get()?.links[0]?.slug).toBe('one');
    removeLink('bug:x');
    expect($working.get()?.links.map((l) => l.slug)).toEqual(['one', 'two']);
  });

  it('reorderLinks drops links before / after a target (drag and drop) and keeps their notes', () => {
    addLink('bug', 'x');
    const keys = () => $working.get()?.links.map((l) => `${l.dataset}:${l.slug}`);
    reorderLinks(['kb:one'], 'bug:x', 'after');
    expect(keys()).toEqual(['task:two', 'bug:x', 'kb:one']);
    expect($working.get()?.links[2]?.notes).toBe('first note\nsecond line\n');
    reorderLinks(['kb:one', 'bug:x'], 'task:two', 'before');
    expect(keys()).toEqual(['bug:x', 'kb:one', 'task:two']); // current relative order of the moved links
    expect($dirty.get()).toBe(true);
  });

  it('reorderLinks ignores a drop that changes nothing and unknown keys', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    reorderLinks(['kb:one'], 'task:two', 'before'); // already there
    reorderLinks(['kb:one'], 'kb:one', 'after'); // onto itself
    reorderLinks(['kb:one'], 'nope:x', 'after'); // unknown target
    expect($dirty.get()).toBe(false);
    expect($saveStatus.get().kind).toBe('saved');
  });

  it('reorderLinks re-serializes the draft in the YAML view', () => {
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    setView('yaml');
    reorderLinks(['kb:one'], 'task:two', 'after');
    const draft = $yamlDraft.get() ?? '';
    expect(draft.indexOf('slug: two')).toBeLessThan(draft.indexOf('slug: one'));
  });

  it('setContextTags replaces the list', () => {
    setContextTags(['x', 'y']);
    expect($working.get()?.tags).toEqual(['x', 'y']);
    setContextTags([]);
    expect($working.get()?.tags).toEqual([]);
  });

  it('never mutates the previous working copy', () => {
    const before = $working.get();
    expect(before).not.toBeNull();
    const snapshot = JSON.stringify(before);
    addLink('bug', 'x');
    setLinkNotes('kb:one', 'other');
    addTag('b');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("setLinkNotes('') removes the notes key so the doc equals the baseline again", () => {
    setLinkNotes('task:two', 'something');
    expect($dirty.get()).toBe(true);
    setLinkNotes('task:two', '');
    expect(Object.hasOwn($working.get()?.links[1] ?? {}, 'notes')).toBe(false);
    expect($dirty.get()).toBe(false);
  });

  it('addTag ignores blanks and duplicates; removeTag removes', () => {
    addTag('');
    addTag('a');
    addTag('b');
    expect($working.get()?.tags).toEqual(['a', 'b']);
    removeTag('a');
    expect($working.get()?.tags).toEqual(['b']);
  });

  it('an edit clears a stale "saved" status', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    setDescription('x');
    expect($saveStatus.get().kind).toBe('idle');
  });
});

describe('parseLinkKey', () => {
  it('splits on the first colon', () => {
    expect(parseLinkKey('kb:a-b')).toEqual({ dataset: 'kb', slug: 'a-b' });
  });
});

describe('YAML view', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  });

  it('setView(yaml) serializes the working copy; back to form drops the draft', () => {
    setView('yaml');
    expect($view.get()).toBe('yaml');
    expect($yamlDraft.get()).toContain('name: demo');
    expect($yamlCheck.get().ok).toBe(true);
    setView('form');
    expect($view.get()).toBe('form');
    expect($yamlDraft.get()).toBeNull();
  });

  it('a valid edit flows into the working copy (two-way sync)', () => {
    setView('yaml');
    setYamlDraft('name: demo\ndescription: From YAML\nlinks:\n  - dataset: kb\n    slug: only\n');
    expect($yamlInvalid.get()).toBe(false);
    expect($working.get()?.description).toBe('From YAML');
    expect($working.get()?.links.map((l) => l.slug)).toEqual(['only']);
    expect($dirty.get()).toBe(true);
  });

  it('an invalid edit keeps the last valid working copy, blocks the form view, and revert recovers', () => {
    setView('yaml');
    setDescription('kept'); // re-serializes the draft in yaml view
    setYamlDraft('name: demo\ndescription: [broken\n');
    expect($yamlInvalid.get()).toBe(true);
    expect($working.get()?.description).toBe('kept');
    setView('form'); // refused while invalid
    expect($view.get()).toBe('yaml');
    addLink('bug', 'x'); // refused while invalid
    expect($working.get()?.links).toHaveLength(2);
    revert();
    expect($yamlInvalid.get()).toBe(false);
    expect($yamlDraft.get()).toContain('description: Demo context');
  });

  it('refuses a rename', () => {
    setView('yaml');
    setYamlDraft('name: other\ndescription: d\n');
    const check = $yamlCheck.get();
    expect(check.ok).toBe(false);
    expect(check.issues[0]?.message).toContain('name must stay "demo"');
  });

  it('editor markers only carry what the JSON Schema cannot express (no duplicate squiggles)', () => {
    setView('yaml');
    // syntax error: monaco-yaml marks it, so the ctxman owner draws nothing; the issue list still has it
    setYamlDraft('name: demo\ndescription: [broken\n');
    expect($yamlCheck.get().ok).toBe(false);
    expect($yamlMarkers.get()).toEqual([]);
    // unknown key: covered by the schema
    setYamlDraft('name: demo\ndescription: d\nbogus: 1\nlinks: []\n');
    expect($yamlCheck.get().ok).toBe(false);
    expect($yamlMarkers.get()).toEqual([]);
    // duplicate link: zod only
    setYamlDraft(
      'name: demo\ndescription: d\nlinks:\n  - dataset: kb\n    slug: a\n  - dataset: kb\n    slug: a\n',
    );
    expect($yamlMarkers.get()).toHaveLength(1);
    expect($yamlMarkers.get()[0]?.message).toContain('duplicate link');
    expect($yamlMarkers.get()[0]?.startLineNumber).toBe(6);
    // renamed: zod only
    setYamlDraft('name: other\ndescription: d\nlinks: []\n');
    expect($yamlMarkers.get().map((m) => m.message)).toEqual([
      expect.stringContaining('name must stay "demo"'),
    ]);
    // valid
    setYamlDraft('name: demo\ndescription: d\nlinks: []\n');
    expect($yamlMarkers.get()).toEqual([]);
  });

  it('actions re-serialize the draft while the YAML view is open', () => {
    setView('yaml');
    addLink('bug', 'fresh');
    expect($yamlDraft.get()).toContain('slug: fresh');
  });
});

describe('notes helpers', () => {
  it('lineCount ignores trailing newlines', () => {
    expect(lineCount('a\nb\n\n')).toBe(2);
    expect(lineCount('\n\n')).toBe(0);
    expect(lineCount('one')).toBe(1);
  });

  it('firstLine picks the first non-blank line and truncates', () => {
    expect(firstLine('\n  hello world  \nsecond', 60)).toBe('hello world');
    expect(firstLine('abcdefghij', 5)).toBe('abcd…');
    expect(firstLine('', 10)).toBe('');
  });

  it('plural', () => {
    expect(plural(1, 'line')).toBe('1 line');
    expect(plural(2, 'line')).toBe('2 lines');
  });
});

describe('nameProblem', () => {
  it('accepts kebab-case and reports the first problem otherwise', () => {
    expect(nameProblem('auth-refactor')).toBeNull();
    expect(nameProblem('')).toBe('Required');
    expect(nameProblem('Bad Name')).toContain('lowercase letters');
    expect(nameProblem('double--hyphen')).toContain('lowercase letters');
    expect(nameProblem('a'.repeat(65))).toBe('64 characters max');
    expect(nameProblem('taken', new Set(['taken']))).toContain('already exists');
    expect(nameProblem('free', new Set(['taken']))).toBeNull();
  });
});

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

describe('addLinks', () => {
  it('appends the keys in order as one edit and skips links already present (and repeats)', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    addLinks([
      { dataset: 'project', slug: 'p' },
      { dataset: 'kb', slug: 'one' }, // already linked
      { dataset: 'task', slug: 'c1' },
      { dataset: 'project', slug: 'p' }, // repeated
      { dataset: 'task', slug: 'c2' },
    ]);
    expect($working.get()?.links.map((l) => `${l.dataset}:${l.slug}`)).toEqual([
      'kb:one',
      'task:two',
      'project:p',
      'task:c1',
      'task:c2',
    ]);
    expect(Object.hasOwn($working.get()?.links[2] ?? {}, 'notes')).toBe(false);
    expect($saveStatus.get().kind).toBe('idle');
  });

  it('adds nothing (and does not dirty the form) when every key is already linked', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    addLinks([
      { dataset: 'kb', slug: 'one' },
      { dataset: 'task', slug: 'two' },
    ]);
    addLinks([]);
    expect($dirty.get()).toBe(false);
    expect($saveStatus.get().kind).toBe('saved');
  });

  it('is refused while the YAML is invalid and without a context', () => {
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    setView('yaml');
    setYamlDraft('name: demo\ndescription: [broken\n');
    addLinks([{ dataset: 'bug', slug: 'x' }]);
    expect($working.get()?.links).toHaveLength(2);
    revert();
    setView('form');
    $working.set(null);
    addLinks([{ dataset: 'bug', slug: 'x' }]);
    expect($working.get()).toBeNull();
  });
});

describe('addableChildren', () => {
  const project = summary('project', 'p', {
    relations: [
      { dataset: 'task', slug: 'c1', rel: 'child' },
      { dataset: 'kb', slug: 'one', rel: 'related' }, // not a child
      { dataset: 'task', slug: 'ghost', rel: 'child' }, // not in the cache: would only add a "missing" link
      { dataset: 'bug', slug: 'c2', rel: 'child' },
      { dataset: 'feature', slug: 'c3', rel: 'child' }, // dataset not loaded yet
      { dataset: 'task', slug: 'c4', rel: 'child' }, // already linked
    ],
  });
  const cache = {
    task: ready(summary('task', 'c1'), summary('task', 'c4')),
    bug: ready(summary('bug', 'c2')),
  };

  it('lists the children that exist in the cache and are not linked, in file order', () => {
    expect(addableChildren(project, cache, new Set(['task:c4']))).toEqual([
      { dataset: 'task', slug: 'c1' },
      { dataset: 'bug', slug: 'c2' },
    ]);
  });

  it('is empty for an entry without relations or with every child linked', () => {
    expect(addableChildren(summary('task', 'x'), cache, new Set())).toEqual([]);
    expect(addableChildren(project, cache, new Set(['task:c1', 'task:c4', 'bug:c2']))).toEqual([]);
  });
});

describe('Discover view', () => {
  let unbind: () => void = () => {};
  beforeEach(() => {
    const map: Partial<Record<DatasetId, EntriesState>> = {};
    for (const ds of LINKABLE_DATASETS) map[ds] = ready();
    map.kb = ready(summary('kb', 'k1', { tags: ['x'], lastModified: '2026-01-02T00:00:00.000Z' }));
    map.task = ready(
      summary('task', 't1', {
        state: 'pending',
        tags: ['x', 'y'],
        lastModified: '2026-01-03T00:00:00.000Z',
      }),
      summary('task', 't2', { state: 'complete', lastModified: '2026-01-01T00:00:00.000Z' }),
    );
    map.bug = ready(
      summary('bug', 'b1', {
        state: 'pending',
        invalid: [{ path: '', message: 'bad' }],
        lastModified: '2025-12-31T00:00:00.000Z',
      }),
    );
    $entries.set(map);
    // Mounting the URL store reads `location` and starts the (never answered) loads of what is missing.
    vi.stubGlobal('location', { pathname: '/forge', search: '', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {}));
    unbind = $discover.listen(() => {});
    $forgeUrl.set({ context: null, dataset: 'kb', q: '', states: [], tags: [] });
  });

  afterEach(() => {
    unbind();
    cleanStores($forgeUrl);
    $entries.set({});
  });

  it('a dataset tab shows that dataset with its state counts', () => {
    $forgeUrl.setKey('dataset', 'task');
    const view = $discover.get();
    expect(view.items.map((e) => e.slug)).toEqual(['t1', 't2']);
    expect(view.total).toBe(2);
    expect(view.stateCounts).toEqual({ pending: 1, complete: 1 });
  });

  it('the All tab merges every linkable dataset (newest first), without state counts', () => {
    $forgeUrl.setKey('dataset', 'all');
    const view = $discover.get();
    expect(view.status).toBe('ready');
    expect(view.items.map((e) => `${e.dataset}/${e.slug}`)).toEqual([
      'task/t1',
      'kb/k1',
      'task/t2',
      'bug/b1',
    ]);
    expect(view.total).toBe(4);
    expect(view.matched).toBe(4);
    expect(view.stateCounts).toEqual({});
    expect(view.tagCounts).toEqual([
      { tag: 'x', count: 2 },
      { tag: 'y', count: 1 },
    ]);
  });

  it('the All tab filters across datasets (q and tags)', () => {
    $forgeUrl.set({ context: null, dataset: 'all', q: 'b1', states: [], tags: [] });
    expect($discover.get().items.map((e) => e.slug)).toEqual(['b1']);
    $forgeUrl.set({ context: null, dataset: 'all', q: '', states: [], tags: ['x'] });
    expect($discover.get().items.map((e) => `${e.dataset}/${e.slug}`)).toEqual([
      'task/t1',
      'kb/k1',
    ]);
    expect($discover.get().matched).toBe(2);
  });

  it('the All tab is loading until every dataset answered, and errors name the failed ones', () => {
    $forgeUrl.setKey('dataset', 'all');
    $entries.setKey('rca', { status: 'loading', entries: [] });
    expect($discover.get().status).toBe('loading');
    expect($discover.get().items).toHaveLength(4); // what arrived is already listed
    $entries.setKey('rca', { status: 'error', entries: [], error: 'HTTP 500' });
    const view = $discover.get();
    expect(view.status).toBe('error');
    expect(view.error).toContain('rca');
    expect(view.items).toHaveLength(4);
  });
});

describe('drafts (localStorage) and the missing beforeunload prompt', () => {
  type Forge = typeof import('../../src/stores/forge.ts');
  const KEY = 'ctxman:draft:forge:demo';
  const doc: ContextDoc = {
    name: 'demo',
    description: 'Demo context',
    tags: [],
    links: [{ dataset: 'kb', slug: 'one' }],
  };
  const json = (status: number, body?: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  let store: Map<string, string>;
  let listeners: string[];
  let forge: Forge;
  let putBodies: ContextDoc[];
  let disk: { context: ContextDoc; lastModified: string };

  /** A draft as draft-backup stores it. */
  const stored = (working: unknown, base: string, savedAt = Date.now()): string =>
    JSON.stringify({ text: JSON.stringify(working), base, savedAt });

  beforeEach(async () => {
    store = new Map();
    listeners = [];
    putBodies = [];
    disk = { context: structuredClone(doc), lastModified: 'T1' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    vi.stubGlobal('window', {
      addEventListener: (type: string) => void listeners.push(type),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/entries')) return json(200, { entries: [] });
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as ContextDoc;
          putBodies.push(body);
          disk = { context: body, lastModified: 'T2' };
          return json(200, disk);
        }
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return json(200, disk);
      }),
    );
    vi.resetModules();
    forge = await import('../../src/stores/forge.ts');
  });

  afterEach(() => {
    cleanStores(forge.$forgeUrl);
  });

  /** Mount the URL store (as the island does) and wait for the context to load. */
  async function mount(): Promise<void> {
    forge.$forgeUrl.listen(() => {});
    await vi.waitFor(() => expect(forge.$contextLoad.get().status).toBe('ready'));
  }

  it('registers no beforeunload listener (only popstate and keydown)', async () => {
    await mount();
    expect(listeners.sort()).toEqual(['keydown', 'popstate']);
  });

  it('saves the working copy on every change and clears it once the copy is clean again', async () => {
    await mount();
    expect(store.size).toBe(0);
    forge.addLink('bug', 'x');
    const draft = JSON.parse(store.get(KEY) ?? 'null') as {
      text: string;
      base: string;
      savedAt: number;
    };
    expect(draft.base).toBe('T1');
    expect(JSON.parse(draft.text).links).toHaveLength(2);
    expect(typeof draft.savedAt).toBe('number');
    forge.removeLink('bug:x');
    expect(store.has(KEY)).toBe(false);
  });

  it('restores a fresh draft after a reload: working copy, dirty, banner not stale', async () => {
    store.set(
      KEY,
      stored(
        {
          ...doc,
          description: 'Edited before the reload',
          links: [...doc.links, { dataset: 'task', slug: 'two' }],
        },
        'T1',
      ),
    );
    await mount();
    expect(forge.$working.get()?.description).toBe('Edited before the reload');
    expect(forge.$working.get()?.links.map((l) => l.slug)).toEqual(['one', 'two']);
    expect(forge.$baseline.get()?.description).toBe('Demo context');
    expect(forge.$dirty.get()).toBe(true);
    expect(forge.$draftRestored.get()).toEqual({ stale: false });
    expect(store.has(KEY)).toBe(true); // still there until saved or discarded
  });

  it('restores a draft whose file changed on disk with the stale warning, and keeps its base', async () => {
    store.set(KEY, stored({ ...doc, description: 'Old edit' }, 'T0'));
    await mount();
    expect(forge.$working.get()?.description).toBe('Old edit');
    expect(forge.$draftRestored.get()).toEqual({ stale: true });
    forge.setDescription('Old edit, continued');
    expect(JSON.parse(JSON.parse(store.get(KEY) ?? '{}').text).description).toBe(
      'Old edit, continued',
    );
    expect(JSON.parse(store.get(KEY) ?? '{}').base).toBe('T0'); // another reload still warns
  });

  it.each([
    ['not JSON', 'this is not json {'],
    ['a wrong shape', JSON.stringify({ name: 'demo', description: '', links: 3 })],
    ['another context name', JSON.stringify({ ...doc, name: 'other' })],
    ['a copy equal to the saved context', JSON.stringify(doc)],
  ])('drops a draft that is %s', async (_label, text) => {
    store.set(KEY, JSON.stringify({ text, base: 'T1', savedAt: Date.now() }));
    await mount();
    expect(forge.$working.get()).toEqual(doc);
    expect(forge.$draftRestored.get()).toBeNull();
    expect(forge.$dirty.get()).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it('drops a draft older than 14 days', async () => {
    store.set(KEY, stored({ ...doc, description: 'Ancient' }, 'T1', Date.now() - 15 * 86_400_000));
    await mount();
    expect(forge.$working.get()?.description).toBe('Demo context');
    expect(store.has(KEY)).toBe(false);
  });

  it('revert (the banner Discard) clears the draft and hides the banner', async () => {
    store.set(KEY, stored({ ...doc, description: 'Edited' }, 'T1'));
    await mount();
    expect(forge.$draftRestored.get()).not.toBeNull();
    forge.revert();
    expect(forge.$working.get()).toEqual(doc);
    expect(forge.$draftRestored.get()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('editing back to the saved state clears the draft and the banner', async () => {
    store.set(KEY, stored({ ...doc, description: 'Edited' }, 'T1'));
    await mount();
    forge.setDescription('Demo context');
    expect(store.has(KEY)).toBe(false);
    expect(forge.$draftRestored.get()).toBeNull();
  });

  it('save clears the draft, hides the banner and adopts the new lastModified as the base of later edits', async () => {
    store.set(KEY, stored({ ...doc, description: 'Edited' }, 'T0'));
    await mount();
    await forge.save();
    expect(putBodies).toHaveLength(1);
    expect(forge.$baselineModified.get()).toBe('T2');
    expect(forge.$draftRestored.get()).toBeNull();
    expect(forge.$dirty.get()).toBe(false);
    expect(store.has(KEY)).toBe(false);
    forge.setDescription('Next edit');
    expect(JSON.parse(store.get(KEY) ?? '{}').base).toBe('T2');
  });

  it('deleting the context clears its draft', async () => {
    store.set(KEY, stored({ ...doc, description: 'Edited' }, 'T1'));
    await mount();
    await forge.deleteContext();
    expect(store.has(KEY)).toBe(false);
    expect(forge.$working.get()).toBeNull();
    expect(forge.$draftRestored.get()).toBeNull();
  });

  it('a freshly created context never restores a draft of the same name', async () => {
    store.set(KEY, stored({ ...doc, description: 'Left over' }, 'T1'));
    await mount();
    forge.revert();
    store.set(KEY, stored({ ...doc, description: 'Left over again' }, 'T1'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(201, { context: doc, lastModified: 'T3' })),
    );
    const result = await forge.createContext({ name: 'demo', description: 'Demo context' });
    expect(result.ok).toBe(true);
    expect(forge.$working.get()).toEqual(doc);
    expect(forge.$draftRestored.get()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('"new" is never persisted', async () => {
    vi.stubGlobal('location', { pathname: '/forge', search: '?context=new', hash: '' });
    forge.$forgeUrl.listen(() => {});
    forge.addLink('bug', 'x'); // no working copy: ignored
    expect(forge.$working.get()).toBeNull();
    expect(store.size).toBe(0);
  });
});
