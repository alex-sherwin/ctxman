import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecipeData, ReferenceData } from '../../src/datasets/schemas.ts';
import type { ContextDoc } from '../../src/lib/entry-summary.ts';
import {
  INFO_TARGET_ID,
  PREAMBLE_TARGET_ID,
  blockTargetId,
  contextNoteTargets,
  endpoint,
  hasTarget,
  loadTarget,
  noteTargetId,
  readTarget,
  recipeTargets,
  referenceTargets,
  saveTarget,
  targetById,
  writeTarget,
} from '../../src/ui/markdown/targets.ts';
import type { MdTarget } from '../../src/ui/markdown/targets.ts';

const context: ContextDoc = {
  name: 'demo',
  description: 'Demo context',
  tags: ['a'],
  links: [
    { dataset: 'kb', slug: 'one', notes: 'first note\n' },
    { dataset: 'task', slug: 'two' },
  ],
};

const recipe: RecipeData = {
  name: 'brief',
  description: 'Demo recipe',
  tags: [],
  target: 'claude-code',
  layout: 'grouped',
  preamble: 'Read this first.',
  contexts: ['demo'],
  items: [],
  markdown: [
    { id: 'b1', body: 'block one\n' },
    { id: 'b2', body: '' },
  ],
  overrides: [],
  order: [],
  defaults: {},
};

const reference: ReferenceData = {
  name: 'repo',
  description: 'Demo reference',
  tags: [],
  type: 'local-folder',
  path: '~/notes',
  owner: 'me',
  info: '## Layout\n\nOne file per week.\n',
};

const notesOne = contextNoteTargets('demo', [
  { dataset: 'kb', slug: 'one', title: 'One' },
])[0] as MdTarget;
const notesTwo = contextNoteTargets('demo', [{ dataset: 'task', slug: 'two' }])[0] as MdTarget;
const preamble = recipeTargets('brief', [])[0] as MdTarget;
const block1 = recipeTargets('brief', [{ id: 'b1' }])[1] as MdTarget;
const info = referenceTargets('repo')[0] as MdTarget;

describe('ids and target builders', () => {
  it('builds the ids the SSR buttons carry in data-md-edit', () => {
    expect(noteTargetId('kb', 'one')).toBe('notes:kb:one');
    expect(PREAMBLE_TARGET_ID).toBe('preamble');
    expect(blockTargetId('b1')).toBe('block:b1');
  });

  it('contextNoteTargets: one target per link in order, labelled with the title or the slug', () => {
    const targets = contextNoteTargets('demo', [
      { dataset: 'kb', slug: 'one', title: 'One' },
      { dataset: 'task', slug: 'two' },
    ]);
    expect(targets).toEqual([
      {
        kind: 'context-notes',
        id: 'notes:kb:one',
        slug: 'demo',
        dataset: 'kb',
        target: 'one',
        label: 'notes for One',
      },
      {
        kind: 'context-notes',
        id: 'notes:task:two',
        slug: 'demo',
        dataset: 'task',
        target: 'two',
        label: 'notes for two',
      },
    ]);
  });

  it('recipeTargets: the preamble first, then one target per block', () => {
    expect(recipeTargets('brief', [{ id: 'b1' }, { id: 'b2' }])).toEqual([
      { kind: 'recipe-preamble', id: 'preamble', slug: 'brief', label: 'preamble' },
      {
        kind: 'recipe-block',
        id: 'block:b1',
        slug: 'brief',
        blockId: 'b1',
        label: 'markdown block b1',
      },
      {
        kind: 'recipe-block',
        id: 'block:b2',
        slug: 'brief',
        blockId: 'b2',
        label: 'markdown block b2',
      },
    ]);
  });

  it('targetById finds a target or answers undefined', () => {
    const all = [notesOne, notesTwo, preamble];
    expect(targetById(all, 'notes:task:two')).toBe(notesTwo);
    expect(targetById(all, 'nope')).toBeUndefined();
    expect(targetById(all, undefined)).toBeUndefined();
  });

  it('endpoint points at the context or recipe API', () => {
    expect(endpoint(notesOne)).toBe('/api/context/demo');
    expect(endpoint(preamble)).toBe('/api/recipe/brief');
    expect(endpoint(block1)).toBe('/api/recipe/brief');
  });

  it('referenceTargets: the info of a reference, at the reference API', () => {
    expect(INFO_TARGET_ID).toBe('info');
    expect(info).toEqual({ kind: 'reference-info', id: 'info', slug: 'repo', label: 'info' });
    expect(endpoint(info)).toBe('/api/reference/repo');
  });
});

describe('reference info target', () => {
  it('reads, sets and (blank) deletes info; never matches a recipe or context document', () => {
    expect(hasTarget(info, reference)).toBe(true);
    expect(readTarget(info, reference)).toBe('## Layout\n\nOne file per week.\n');
    expect(readTarget(info, { ...reference, info: undefined })).toBe('');
    expect(writeTarget(info, reference, 'New text')).toEqual({ ...reference, info: 'New text' });
    expect(writeTarget(info, reference, ' \n')).not.toHaveProperty('info');
    expect(reference.info).toBe('## Layout\n\nOne file per week.\n');
    expect(hasTarget(info, recipe)).toBe(false);
    expect(hasTarget(info, context)).toBe(false);
    // and a recipe target never matches a reference
    expect(hasTarget(preamble, reference)).toBe(false);
    expect(writeTarget(preamble, reference, 'x')).toBe(reference);
  });
});

describe('readTarget / hasTarget', () => {
  it('reads link notes, the preamble and a block body; absent text is empty', () => {
    expect(readTarget(notesOne, context)).toBe('first note\n');
    expect(readTarget(notesTwo, context)).toBe('');
    expect(readTarget(preamble, recipe)).toBe('Read this first.');
    expect(readTarget(block1, recipe)).toBe('block one\n');
    expect(readTarget(preamble, { ...recipe, preamble: undefined })).toBe('');
  });

  it('hasTarget is false once the link or block is gone', () => {
    expect(hasTarget(notesTwo, context)).toBe(true);
    expect(
      hasTarget(notesTwo, { ...context, links: [context.links[0] as ContextDoc['links'][number]] }),
    ).toBe(false);
    expect(hasTarget(block1, recipe)).toBe(true);
    expect(hasTarget(block1, { ...recipe, markdown: [] })).toBe(false);
    expect(hasTarget(preamble, recipe)).toBe(true);
    // a recipe target never matches a context document and vice versa
    expect(hasTarget(preamble, context)).toBe(false);
    expect(hasTarget(notesOne, recipe)).toBe(false);
  });
});

describe('writeTarget', () => {
  it('sets link notes without touching the other links or the input', () => {
    const before = structuredClone(context);
    const next = writeTarget(notesTwo, context, 'use **this**') as ContextDoc;
    expect(next.links).toEqual([
      { dataset: 'kb', slug: 'one', notes: 'first note\n' },
      { dataset: 'task', slug: 'two', notes: 'use **this**' },
    ]);
    expect(context).toEqual(before);
    expect(next).not.toBe(context);
  });

  it('blank notes delete the notes key', () => {
    const next = writeTarget(notesOne, context, '  \n') as ContextDoc;
    expect(next.links[0]).toEqual({ dataset: 'kb', slug: 'one' });
    expect(Object.hasOwn(next.links[0] ?? {}, 'notes')).toBe(false);
    expect(next.links[1]).toEqual({ dataset: 'task', slug: 'two' });
  });

  it('sets the preamble; a blank preamble deletes the key', () => {
    expect((writeTarget(preamble, recipe, 'New') as RecipeData).preamble).toBe('New');
    const cleared = writeTarget(preamble, recipe, '') as RecipeData;
    expect(Object.hasOwn(cleared, 'preamble')).toBe(false);
    expect(cleared.markdown).toEqual(recipe.markdown);
  });

  it('writes a block body as is (an empty body stays an empty body)', () => {
    const next = writeTarget(block1, recipe, 'changed\n\n') as RecipeData;
    expect(next.markdown).toEqual([
      { id: 'b1', body: 'changed\n\n' },
      { id: 'b2', body: '' },
    ]);
    const emptied = writeTarget(block1, recipe, '') as RecipeData;
    expect(emptied.markdown[0]).toEqual({ id: 'b1', body: '' });
    expect(recipe.markdown[0]?.body).toBe('block one\n');
  });

  it('returns a document that lacks the area unchanged', () => {
    expect(writeTarget(notesOne, recipe, 'x')).toBe(recipe);
    expect(writeTarget(preamble, context, 'x')).toBe(context);
    const nolink = writeTarget(
      contextNoteTargets('demo', [{ dataset: 'kb', slug: 'ghost' }])[0] as MdTarget,
      context,
      'x',
    ) as ContextDoc;
    expect(nolink.links).toEqual(context.links);
  });
});

describe('loadTarget / saveTarget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  interface Call {
    url: string;
    method: string;
    body?: unknown;
  }

  /** `responses` answer successive requests in order. */
  function stub(responses: { status?: number; body: unknown }[]): Call[] {
    const calls: Call[] = [];
    let i = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({
          url,
          method: init?.method ?? 'GET',
          ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
        });
        const r = responses[Math.min(i++, responses.length - 1)] ?? { body: {} };
        return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
      }),
    );
    return calls;
  }

  it('loadTarget reads the context out of the GET body', async () => {
    const calls = stub([{ body: { context, lastModified: 'T1' } }]);
    const result = await loadTarget(notesOne);
    expect(calls).toEqual([{ url: '/api/context/demo', method: 'GET' }]);
    expect(result).toEqual({
      ok: true,
      loaded: { doc: context, lastModified: 'T1', text: 'first note\n' },
    });
  });

  it('loadTarget reads recipe areas and reports a missing area or API errors', async () => {
    stub([{ body: { recipe, lastModified: 'T1' } }]);
    expect(await loadTarget(block1)).toMatchObject({ ok: true, loaded: { text: 'block one\n' } });

    stub([{ body: { recipe: { ...recipe, markdown: [] }, lastModified: 'T1' } }]);
    expect(await loadTarget(block1)).toEqual({
      ok: false,
      message: 'markdown block b1 no longer exists',
    });

    stub([{ status: 404, body: { error: 'not-found', message: 'recipe "brief" does not exist' } }]);
    expect(await loadTarget(preamble)).toEqual({
      ok: false,
      message: 'recipe "brief" does not exist',
    });

    stub([{ body: { lastModified: 'T1' } }]);
    expect(await loadTarget(preamble)).toMatchObject({ ok: false });
  });

  it('saveTarget re-GETs, then PUTs the FRESH document with only the area replaced', async () => {
    // someone else added a tag in between; lastModified is unchanged, so no conflict and nothing is lost
    const fresh = { ...context, tags: ['a', 'b'] };
    const calls = stub([
      { body: { context: fresh, lastModified: 'T1' } },
      { body: { context: fresh, lastModified: 'T2' } },
    ]);
    const result = await saveTarget(notesTwo, { lastModified: 'T1' }, 'new notes');
    expect(result).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/context/demo',
      'PUT /api/context/demo',
    ]);
    expect(calls[1]?.body).toEqual({
      ...fresh,
      links: [
        { dataset: 'kb', slug: 'one', notes: 'first note\n' },
        { dataset: 'task', slug: 'two', notes: 'new notes' },
      ],
    });
  });

  it('loadTarget / saveTarget round-trip a reference info through /api/reference', async () => {
    const calls = stub([
      { body: { reference, lastModified: 'T1' } },
      { body: { reference, lastModified: 'T1' } },
      { body: { reference, lastModified: 'T2' } },
    ]);
    expect(await loadTarget(info)).toMatchObject({ ok: true, loaded: { lastModified: 'T1' } });
    expect(await saveTarget(info, { lastModified: 'T1' }, 'Updated')).toEqual({ ok: true });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/reference/repo',
      'GET /api/reference/repo',
      'PUT /api/reference/repo',
    ]);
    expect(calls[2]?.body).toEqual({ ...reference, info: 'Updated' });
  });

  it('saveTarget refuses with a conflict when the file changed since the popup opened', async () => {
    const calls = stub([{ body: { context, lastModified: 'T9' } }]);
    const result = await saveTarget(notesTwo, { lastModified: 'T1' }, 'mine');
    expect(result).toEqual({
      ok: false,
      kind: 'conflict',
      fresh: { doc: context, lastModified: 'T9', text: '' },
    });
    expect(calls).toHaveLength(1); // no PUT
  });

  it('force overwrites despite a newer file', async () => {
    const calls = stub([
      { body: { recipe, lastModified: 'T9' } },
      { body: { recipe, lastModified: 'T10' } },
    ]);
    const result = await saveTarget(preamble, { lastModified: 'T1' }, 'Mine', { force: true });
    expect(result).toEqual({ ok: true });
    expect(calls[1]?.method).toBe('PUT');
    const putBody = calls[1]?.body as RecipeData | undefined;
    expect(putBody?.preamble).toBe('Mine');
  });

  it('saveTarget reports the first validation issue of a 400', async () => {
    stub([
      { body: { recipe, lastModified: 'T1' } },
      {
        status: 400,
        body: {
          error: 'invalid',
          message: 'recipe does not match the schema',
          issues: [
            { path: 'markdown.0.body', message: 'Invalid input' },
            { path: 'x', message: 'other' },
          ],
        },
      },
    ]);
    expect(await saveTarget(block1, { lastModified: 'T1' }, 'x')).toEqual({
      ok: false,
      kind: 'error',
      message: 'Invalid input',
    });
  });

  it('saveTarget fails cleanly when the area vanished or the network is down', async () => {
    stub([{ body: { recipe: { ...recipe, markdown: [] }, lastModified: 'T1' } }]);
    expect(await saveTarget(block1, { lastModified: 'T1' }, 'x')).toEqual({
      ok: false,
      kind: 'error',
      message: 'markdown block b1 no longer exists',
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await saveTarget(preamble, { lastModified: 'T1' }, 'x')).toEqual({
      ok: false,
      kind: 'error',
      message: 'offline',
    });
  });
});
