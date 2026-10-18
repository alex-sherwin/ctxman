import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  $formAttempted,
  $formConflict,
  $formDirty,
  $formErrors,
  $formLoad,
  $formMeta,
  $formSave,
  $formView,
  $formWorking,
  $formYamlCheck,
  $formYamlDraft,
  $formYamlInvalid,
  $formYamlMarkers,
  cancelHref,
  deleteDoc,
  initForm,
  overwrite,
  setField,
  setFormView,
  setFormYaml,
  submitForm,
} from '../../src/stores/data-form.ts';
import { $entries } from '../../src/stores/entries.ts';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (call: Call) => Response | undefined;

let calls: Call[];
let assign: ReturnType<typeof vi.fn>;
let replaceState: ReturnType<typeof vi.fn>;
let handlers: Handler[];

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** `/api/entries?dataset=<ds>` answers with these slugs unless a handler says otherwise. */
function listing(slugs: string[]): Handler {
  return (call) =>
    call.method === 'GET' && call.url.startsWith('/api/entries?dataset=')
      ? jsonResponse(200, {
          entries: slugs.map((slug) => ({
            slug,
            description: 'x',
            tags: [],
          })),
        })
      : undefined;
}

beforeEach(() => {
  calls = [];
  handlers = [];
  assign = vi.fn();
  replaceState = vi.fn();
  vi.stubGlobal('location', { search: '', pathname: '/new/context', hash: '', assign });
  vi.stubGlobal('history', { state: null, replaceState });
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    };
    calls.push(call);
    for (const handler of handlers) {
      const res = handler(call);
      if (res !== undefined) return res;
    }
    return jsonResponse(404, { error: 'not-found', message: 'nope' });
  });
  $entries.set({});
  $formView.set('form');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const names = ['ctxman-dev'];

async function createMode(ds: 'reference' | 'context' | 'recipe') {
  handlers.push(listing(names));
  await initForm({ dataset: ds, mode: 'create' });
  // let the entries request settle
  await vi.waitFor(() => expect($entries.get()[ds]?.status).toBe('ready'));
}

describe('create mode', () => {
  it('starts with the blank document, clean and without errors', async () => {
    await createMode('reference');
    expect($formLoad.get()).toEqual({ status: 'ready' });
    expect($formMeta.get()).toEqual({ dataset: 'reference', mode: 'create' });
    expect($formWorking.get()).toMatchObject({ name: '', type: 'local-repo', owner: 'me' });
    expect($formDirty.get()).toBe(false);
    expect($formErrors.get()).toEqual({});
  });

  it('typing makes it dirty; only the live name rule shows before the first Save', async () => {
    await createMode('context');
    setField('description', 'something');
    expect($formDirty.get()).toBe(true);
    expect($formErrors.get()).toEqual({});
    setField('name', 'Bad Name');
    expect($formErrors.get().name).toMatch(/lowercase/);
    setField('name', 'ctxman-dev');
    expect($formErrors.get().name).toBe('A context with this name already exists');
    setField('name', 'fresh');
    expect($formErrors.get()).toEqual({});
  });

  it('an invalid submit sends nothing, shows every error and reports invalid', async () => {
    await createMode('reference');
    const before = calls.length;
    expect(await submitForm()).toBe('invalid');
    expect(calls.length).toBe(before);
    expect($formAttempted.get()).toBe(true);
    expect($formErrors.get()).toMatchObject({
      name: 'Required',
      description: 'Required',
      path: 'Required',
    });
    expect($formSave.get()).toEqual({ kind: 'error', message: 'Fix the highlighted fields' });
    // fixing a field removes its error
    setField('name', 'my-ref');
    expect($formErrors.get().name).toBeUndefined();
    expect($formSave.get().kind).toBe('idle');
  });

  it('the reference type switch validates the active variant only', async () => {
    await createMode('reference');
    setField('name', 'r');
    setField('description', 'd');
    setField('type', 'remote-repo');
    setField('uri', 'nope');
    await submitForm();
    expect(Object.keys($formErrors.get())).toEqual(['uri']);
    setField('uri', 'git@github.com:org/r.git');
    expect($formErrors.get()).toEqual({});
  });

  it('POST of the normalized document, then navigates to the new context', async () => {
    await createMode('context');
    handlers.push((c) =>
      c.method === 'POST' && c.url === '/api/context'
        ? jsonResponse(201, { context: {} })
        : undefined,
    );
    setField('name', ' my-ctx ');
    setField('description', ' A context ');
    setField('tags', ['a']);
    expect(await submitForm()).toBe('sent');
    const post = calls.find((c) => c.method === 'POST');
    expect(post?.body).toEqual({
      name: 'my-ctx',
      description: 'A context',
      tags: ['a'],
      links: [],
    });
    expect(assign).toHaveBeenCalledWith('/context/my-ctx');
    expect($formDirty.get()).toBe(false); // the guard stands down while navigating
  });

  it('a reference navigates at once after the POST (the server reads from disk, no polling)', async () => {
    await createMode('reference');
    handlers.unshift((c) => {
      if (c.method === 'POST' && c.url === '/api/reference')
        return jsonResponse(201, { reference: {} });
      // the entry list never contains the new entry: the form must not wait for it
      if (c.url === '/api/entries?dataset=reference' && c.method === 'GET') {
        return jsonResponse(200, { entries: [] });
      }
      return undefined;
    });
    setField('name', 'new-ref');
    setField('description', 'd');
    setField('path', '~/x');
    await submitForm();
    expect(assign).toHaveBeenCalledWith('/reference/new-ref');
  });

  it('maps a 409 to the name field and 400 issues to their fields', async () => {
    await createMode('context');
    setField('name', 'fresh');
    setField('description', 'd');
    handlers.unshift((c) =>
      c.method === 'POST' ? jsonResponse(409, { error: 'exists', message: 'exists' }) : undefined,
    );
    await submitForm();
    expect($formErrors.get().name).toBe('An entry with this name already exists');
    expect($formSave.get()).toEqual({
      kind: 'error',
      message: 'An entry with this name already exists',
    });
    expect(assign).not.toHaveBeenCalled();
    // editing the name clears the server error
    setField('name', 'fresher');
    expect($formErrors.get().name).toBeUndefined();

    handlers.unshift((c) =>
      c.method === 'POST'
        ? jsonResponse(400, {
            error: 'invalid',
            message: 'does not match',
            issues: [{ path: 'description', message: 'server says no' }],
          })
        : undefined,
    );
    await submitForm();
    expect($formErrors.get().description).toBe('server says no');
    expect($formSave.get()).toEqual({ kind: 'error', message: 'does not match' });
  });
});

describe('edit mode', () => {
  const stored = {
    name: 'my-ref',
    description: 'A repo',
    tags: ['t'],
    type: 'local-repo',
    path: '~/repos/x',
    owner: 'me',
  };
  let disk: { lastModified: string };

  /** The listing already carries the saved values, so the wait after a reference save ends at once. */
  const savedListing =
    (description: string): Handler =>
    (c) =>
      c.url === '/api/entries?dataset=reference'
        ? jsonResponse(200, {
            entries: [
              { slug: 'my-ref', description, tags: ['t'], refType: 'local-repo', owner: 'me' },
            ],
          })
        : undefined;

  async function editMode() {
    disk = { lastModified: '2026-01-01T00:00:00.000Z' };
    handlers.push(
      (c) =>
        c.method === 'GET' && c.url === '/api/reference/my-ref'
          ? jsonResponse(200, { reference: stored, lastModified: disk.lastModified })
          : undefined,
      listing(['my-ref']),
    );
    await initForm({ dataset: 'reference', mode: 'edit', slug: 'my-ref' });
  }

  it('loads the entry; Save needs a change; a different name is an error', async () => {
    await editMode();
    expect($formLoad.get()).toEqual({ status: 'ready' });
    expect($formWorking.get()).toEqual(stored);
    expect($formWorking.get()).not.toBe(stored);
    expect($formDirty.get()).toBe(false);
    setField('description', 'Changed');
    expect($formDirty.get()).toBe(true);
    setField('description', 'A repo');
    expect($formDirty.get()).toBe(false);
    setField('name', 'other');
    await submitForm();
    expect($formErrors.get().name).toContain('my-ref');
  });

  it('reports not-found and server errors', async () => {
    await initForm({ dataset: 'reference', mode: 'edit', slug: 'gone' });
    expect($formLoad.get()).toMatchObject({ status: 'not-found' });
    handlers.unshift(() => jsonResponse(500, { error: 'boom', message: 'Disk on fire' }));
    await initForm({ dataset: 'reference', mode: 'edit', slug: 'gone' });
    expect($formLoad.get()).toEqual({ status: 'error', message: 'Disk on fire' });
  });

  it('PUTs the normalized doc after confirming nothing changed on disk, then navigates to the entry', async () => {
    await editMode();
    handlers.unshift((c) =>
      c.method === 'PUT' && c.url === '/api/reference/my-ref'
        ? jsonResponse(200, { reference: stored, lastModified: 'x' })
        : undefined,
    );
    handlers.unshift(savedListing('Changed'));
    setField('description', ' Changed ');
    expect(await submitForm()).toBe('sent');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ ...stored, description: 'Changed' });
    expect(calls.findIndex((c) => c.method === 'PUT')).toBeGreaterThan(
      calls.findLastIndex((c) => c.url === '/api/reference/my-ref' && c.method === 'GET'),
    );
    expect(assign).toHaveBeenCalledWith('/reference/my-ref');
  });

  it('a changed lastModified opens the conflict dialog; overwrite saves without the check', async () => {
    await editMode();
    handlers.unshift(savedListing('Mine'));
    handlers.unshift((c) =>
      c.method === 'PUT' ? jsonResponse(200, { reference: stored, lastModified: 'y' }) : undefined,
    );
    disk.lastModified = '2026-02-02T00:00:00.000Z';
    setField('description', 'Mine');
    await submitForm();
    expect($formConflict.get()).toBe(true);
    expect($formSave.get().kind).toBe('conflict');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await overwrite();
    expect($formConflict.get()).toBe(false);
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
  });

  it('Delete sends DELETE and then goes to the list; a failure stays on the form', async () => {
    await editMode();
    handlers.unshift((c) =>
      c.method === 'DELETE' ? new Response(null, { status: 500 }) : undefined,
    );
    await deleteDoc();
    expect($formSave.get().kind).toBe('error');
    expect(assign).not.toHaveBeenCalled();
    handlers.unshift((c) =>
      c.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : c.url === '/api/entries?dataset=reference'
          ? jsonResponse(200, { entries: [] })
          : undefined,
    );
    await deleteDoc();
    expect(assign).toHaveBeenCalledWith('/reference');
  });

  it('cancelHref is the entry page (edit) or the list (create)', async () => {
    await editMode();
    expect(cancelHref()).toBe('/reference/my-ref');
    await initForm({ dataset: 'context', mode: 'create' });
    expect(cancelHref()).toBe('/context');
  });
});

describe('YAML view', () => {
  async function ctx() {
    handlers.push(
      (c) =>
        c.method === 'GET' && c.url === '/api/context/my-ctx'
          ? jsonResponse(200, {
              context: {
                name: 'my-ctx',
                description: 'd',
                links: [{ dataset: 'kb', slug: 'ctxman' }],
              },
              lastModified: 'z',
            })
          : undefined,
      listing([]),
    );
    await initForm({ dataset: 'context', mode: 'edit', slug: 'my-ctx' });
  }

  it('builds the draft from the working doc, syncs valid edits back and writes ?view=', async () => {
    await ctx();
    expect($formYamlDraft.get()).toBeNull();
    setFormView('yaml');
    expect($formView.get()).toBe('yaml');
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/new/context?view=yaml');
    expect($formYamlDraft.get()).toBe(
      'name: my-ctx\ndescription: d\nlinks:\n  - dataset: kb\n    slug: ctxman\n',
    );
    expect($formYamlInvalid.get()).toBe(false);

    setFormYaml('name: my-ctx\ndescription: from yaml\ntags:\n  - x\nlinks: []\n');
    expect($formWorking.get()).toMatchObject({ description: 'from yaml', tags: ['x'], links: [] });
    expect($formDirty.get()).toBe(true);

    setFormView('form');
    expect($formYamlDraft.get()).toBeNull();
    expect(replaceState).toHaveBeenLastCalledWith(null, '', '/new/context');
  });

  it('invalid YAML keeps the working doc, blocks the form tab and refuses to save', async () => {
    await ctx();
    setFormView('yaml');
    const before = $formWorking.get();
    setFormYaml(
      'name: my-ctx\ndescription: d\nlinks:\n  - {dataset: kb, slug: ctxman}\n  - {dataset: kb, slug: ctxman}\n',
    );
    expect($formYamlInvalid.get()).toBe(true);
    expect($formWorking.get()).toBe(before);
    expect($formDirty.get()).toBe(true);
    // the duplicate is a zod-only issue: it becomes a marker; JSON-Schema-covered ones do not
    expect($formYamlMarkers.get().map((m) => m.message)).toEqual([
      expect.stringContaining('duplicate link'),
    ]);
    setFormView('form');
    expect($formView.get()).toBe('yaml');
    expect(await submitForm()).toBe('invalid');
    expect($formSave.get()).toEqual({ kind: 'error', message: 'Fix the YAML problems first' });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('edit mode refuses a renamed document', async () => {
    await ctx();
    setFormView('yaml');
    setFormYaml('name: other\ndescription: d\n');
    const check = $formYamlCheck.get();
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.issues[0]?.message).toContain('name must stay "my-ctx"');
  });

  it('?view=yaml in the URL opens the YAML tab once the document is loaded', async () => {
    vi.stubGlobal('location', { search: '?view=yaml', pathname: '/new/context', hash: '', assign });
    handlers.push(listing([]));
    await initForm({ dataset: 'context', mode: 'create' });
    expect($formView.get()).toBe('yaml');
    expect($formYamlDraft.get()).toContain('name: ""');
  });
});
