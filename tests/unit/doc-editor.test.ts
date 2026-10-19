import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The DocEditor store (src/stores/doc-editor.ts) is a module singleton with an `onMount` that reads the URL, so
// every test imports a fresh copy (resetModules) with stubbed fetch / location / history / sessionStorage.
type Store = typeof import('../../src/stores/doc-editor.ts');
let s: Store;

const TARGET = { dataset: 'kb', slug: 'demo', path: 'concepts/a b.md' } as const;
const URL_PATH = '/api/doc/kb/demo/concepts/a%20b.md';
const KEY = 'doc:kb/demo/concepts/a b.md';

interface Call {
  url: string;
  method: string;
  body?: Record<string, unknown>;
}
type Handler = (call: Call) => { status?: number; body?: unknown };

function stubFetch(handler: Handler): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = { url, method: init?.method ?? 'GET' };
      if (typeof init?.body === 'string')
        call.body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push(call);
      const r = handler(call);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }),
  );
  return calls;
}

/** A GET answers `{ markdown, lastModified }`; a PUT answers with `put`. */
function disk(
  initial: { markdown: string; lastModified: string },
  put: Handler = () => ({}),
): Call[] {
  let current = initial;
  return stubFetch((call) => {
    if (call.method === 'GET') return { body: { path: TARGET.path, ...current, warnings: [] } };
    const r = put(call);
    if ((r.status ?? 200) === 200) {
      const lastModified = (r.body as { lastModified?: string } | undefined)?.lastModified;
      current = { markdown: String(call.body?.markdown), lastModified: lastModified ?? 'T-put' };
    }
    return r;
  });
}

const sessionData = new Map<string, string>();
const loc = {
  pathname: '/kb/demo/doc/concepts/a%20b',
  search: '',
  hash: '',
  reload: vi.fn(),
  assign: vi.fn(),
};
const popstateHandlers: (() => void)[] = [];
/** Every event type the store ever registered on `window` (no `beforeunload`: ROUND3_SPEC §G). */
const windowListeners: string[] = [];
const replaceState = vi.fn();
const pushState = vi.fn();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  sessionData.clear();
  popstateHandlers.length = 0;
  windowListeners.length = 0;
  loc.search = '';
  loc.reload = vi.fn();
  loc.assign = vi.fn();
  const go = (_state: unknown, _title: string, url: string) => {
    const parsed = new URL(url, 'http://localhost');
    loc.pathname = parsed.pathname;
    loc.search = parsed.search;
  };
  replaceState.mockReset();
  replaceState.mockImplementation(go);
  pushState.mockReset();
  pushState.mockImplementation(go);
  // drafts live in localStorage since round 3, the "Saved" record in sessionStorage: one backing map for both
  const storage = {
    getItem: (k: string) => sessionData.get(k) ?? null,
    setItem: (k: string, v: string) => void sessionData.set(k, v),
    removeItem: (k: string) => void sessionData.delete(k),
  };
  vi.stubGlobal('sessionStorage', storage);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', { state: null, replaceState, pushState });
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => {
      windowListeners.push(type);
      if (type === 'popstate') popstateHandlers.push(fn);
    },
    removeEventListener: () => {},
  });
  vi.resetModules();
  s = await import('../../src/stores/doc-editor.ts');
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Let pending promise callbacks (fetch, json) run. Real `setImmediate` (only setTimeout is faked). */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function openEditor(markdown = '# Title\n', lastModified = 'T1'): Promise<Call[]> {
  const calls = disk({ markdown, lastModified });
  s.initDoc({ ...TARGET });
  s.enterEdit();
  await settle();
  return calls;
}

describe('docUrl / docKey', () => {
  it('encodes every path segment and keys storage by dataset/slug/path', () => {
    expect(s.docUrl({ ...TARGET })).toBe(URL_PATH);
    expect(s.docUrl({ dataset: 'skill', slug: 'x', path: 'SKILL.md' })).toBe(
      '/api/doc/skill/x/SKILL.md',
    );
    expect(s.docKey({ ...TARGET })).toBe(KEY);
  });
});

describe('edit mode and loading', () => {
  it('reads ?edit=1 when the store mounts and loads the file on initDoc', async () => {
    loc.search = '?edit=1';
    const calls = disk({ markdown: '# Hi', lastModified: 'T1' });
    s.initDoc({ ...TARGET });
    expect(s.$docEdit.get()).toBe(true);
    await settle();
    expect(calls).toEqual([{ url: URL_PATH, method: 'GET' }]);
    expect(s.$docLoad.get()).toEqual({ status: 'ready' });
    expect(s.$docBaseline.get()).toEqual({ text: '# Hi', lastModified: 'T1' });
    expect(s.$docDraft.get()).toBe('# Hi');
    expect(s.$docDirty.get()).toBe(false);
  });

  it('$docEditing is true only with a DocEditor mounted (initDoc) AND edit mode', async () => {
    loc.search = '?edit=1'; // a page that has ?edit=1 but no DocEditor (the reference form)
    expect(s.$docEdit.get()).toBe(true);
    expect(s.$docEditing.get()).toBe(false);
    disk({ markdown: '# Hi', lastModified: 'T1' });
    s.initDoc({ ...TARGET });
    expect(s.$docEditing.get()).toBe(true);
    await settle();
    s.discardEdit();
    expect(s.$docEdit.get()).toBe(false);
    expect(s.$docEditing.get()).toBe(false);
  });

  it('does not load while the page is in preview mode', async () => {
    const calls = disk({ markdown: '# Hi', lastModified: 'T1' });
    s.initDoc({ ...TARGET });
    await settle();
    expect(s.$docEdit.get()).toBe(false);
    expect(calls).toEqual([]);
    expect(s.$docLoad.get().status).toBe('idle');
  });

  it('enterEdit pushes a history entry with edit=1 and loads', async () => {
    const calls = await openEditor();
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]?.[2]).toBe('/kb/demo/doc/concepts/a%20b?edit=1');
    expect(replaceState).not.toHaveBeenCalled();
    expect(s.$docEdit.get()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(s.$docLoad.get().status).toBe('ready');
  });

  it('a failed GET is reported and can be retried', async () => {
    stubFetch(() => ({
      status: 404,
      body: { error: 'not-found', message: 'index.md does not exist' },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    expect(s.$docLoad.get()).toEqual({ status: 'error', message: 'index.md does not exist' });
    disk({ markdown: 'ok', lastModified: 'T2' });
    await s.loadDoc();
    expect(s.$docLoad.get().status).toBe('ready');
    expect(s.$docDraft.get()).toBe('ok');
  });

  it('popstate re-reads edit from the URL and never writes history', async () => {
    disk({ markdown: 'x', lastModified: 'T1' });
    s.initDoc({ ...TARGET });
    expect(s.$docEdit.get()).toBe(false);
    loc.search = '?edit=1';
    popstateHandlers.forEach((fn) => fn());
    expect(s.$docEdit.get()).toBe(true);
    await settle();
    expect(s.$docLoad.get().status).toBe('ready');
    loc.search = '';
    popstateHandlers.forEach((fn) => fn());
    expect(s.$docEdit.get()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('leaving edit mode and a save each push a history entry without edit', async () => {
    await openEditor('base', 'T1');
    s.discardEdit();
    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState.mock.calls[1]?.[2]).toBe('/kb/demo/doc/concepts/a%20b');
    s.enterEdit();
    await settle();
    s.setDocDraft('changed');
    await s.saveDoc();
    expect(pushState).toHaveBeenCalledTimes(4);
    expect(pushState.mock.calls[3]?.[2]).toBe('/kb/demo/doc/concepts/a%20b');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('Back into the editor re-reads the file; with unsaved text it keeps the text', async () => {
    const calls = await openEditor('one', 'T1');
    s.discardEdit();
    disk({ markdown: 'two', lastModified: 'T2' });
    loc.search = '?edit=1';
    popstateHandlers.forEach((fn) => fn());
    await settle();
    expect(s.$docDraft.get()).toBe('two');
    expect(calls).toHaveLength(1);
  });

  it('Back out of unsaved text is undone and asks; Cancel stays, Discard goes to the preview', async () => {
    await openEditor('one', 'T1');
    s.setDocDraft('one, edited');
    const pushes = pushState.mock.calls.length;
    loc.search = '';
    popstateHandlers.forEach((fn) => fn());
    // the edit URL is back on top, the editor still open, the dialog asks
    expect(pushState.mock.calls.length).toBe(pushes + 1);
    expect(loc.search).toBe('?edit=1');
    expect(s.$docEdit.get()).toBe(true);
    expect(s.$docLeave.get()).toEqual({ kind: 'preview' });

    s.cancelLeave();
    expect(s.$docLeave.get()).toBeNull();
    expect(s.$docDraft.get()).toBe('one, edited');

    loc.search = '';
    popstateHandlers.forEach((fn) => fn());
    s.confirmLeave();
    expect(s.$docEdit.get()).toBe(false);
    expect(loc.search).toBe('');
    expect(s.$docDraftAvailable.get()).toBe(false);
  });
});

describe('requestLeave', () => {
  it('without unsaved text leaves at once', async () => {
    await openEditor('clean', 'T1');
    s.requestLeave({ kind: 'link', href: 'http://localhost/task' });
    expect(s.$docLeave.get()).toBeNull();
    expect(loc.assign).toHaveBeenCalledWith('http://localhost/task');

    s.requestLeave({ kind: 'preview' });
    expect(s.$docEdit.get()).toBe(false);
  });

  it('with unsaved text asks; Discard drops the draft and follows the link', async () => {
    await openEditor('base', 'T1');
    s.setDocDraft('base, edited');
    s.requestLeave({ kind: 'link', href: 'http://localhost/task' });
    expect(s.$docLeave.get()).toEqual({ kind: 'link', href: 'http://localhost/task' });
    expect(loc.assign).not.toHaveBeenCalled();
    expect(s.$docDraftAvailable.get()).toBe(true);

    s.confirmLeave();
    expect(loc.assign).toHaveBeenCalledWith('http://localhost/task');
    expect(s.$docLeave.get()).toBeNull();
    expect(sessionData.size).toBe(0);
  });

  it('the Preview toggle with unsaved text asks before it drops anything', async () => {
    await openEditor('base', 'T1');
    s.setDocDraft('base, edited');
    s.requestLeave({ kind: 'preview' });
    expect(s.$docEdit.get()).toBe(true);
    s.confirmLeave();
    expect(s.$docEdit.get()).toBe(false);
    expect(s.$docDraft.get()).toBe('base');
  });
});

describe('draft and the localStorage backup', () => {
  it('typing marks the document dirty and mirrors the draft; going back to the saved text clears it', async () => {
    await openEditor('base', 'T1');
    s.setDocDraft('base plus');
    expect(s.$docDirty.get()).toBe(true);
    expect(s.$docStatus.get()).toEqual({ kind: 'dirty' });
    expect(JSON.parse(sessionData.get(`ctxman:draft:${KEY}`) ?? 'null')).toMatchObject({
      text: 'base plus',
      base: 'T1',
    });
    s.setDocDraft('base');
    expect(s.$docDirty.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
  });

  it('restores a backup that was started from the same file version', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'unsaved', base: 'T1' }));
    await openEditor('base', 'T1');
    expect(s.$docDraft.get()).toBe('unsaved');
    expect(s.$docRestored.get()).toBe(true);
    expect(s.$docDirty.get()).toBe(true);
  });

  it('restores a backup whose base is not the file on disk, flagged stale (the file changed meanwhile)', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'old work', base: 'T0' }));
    await openEditor('base', 'T1');
    expect(s.$docDraft.get()).toBe('old work');
    expect(s.$docRestored.get()).toBe(true);
    expect(s.$docDraftStale.get()).toBe(true);
    expect(s.$docDirty.get()).toBe(true);
    // the draft stays stored; the baseline is the DISK version, so a save overwrites it (the banner says so)
    expect(s.$docBaseline.get()).toEqual({ text: 'base', lastModified: 'T1' });
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(true);
  });

  it('a backup from the same file version is not stale', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'unsaved', base: 'T1' }));
    await openEditor('base', 'T1');
    expect(s.$docRestored.get()).toBe(true);
    expect(s.$docDraftStale.get()).toBe(false);
  });

  it('drops a backup that equals the disk text (nothing to restore), whatever its base', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'base', base: 'T0' }));
    await openEditor('base', 'T1');
    expect(s.$docDraft.get()).toBe('base');
    expect(s.$docRestored.get()).toBe(false);
    expect(s.$docDraftStale.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
  });

  it('a draft older than 14 days is dropped, one without savedAt counts as fresh', async () => {
    const day = 24 * 60 * 60 * 1000;
    sessionData.set(
      `ctxman:draft:${KEY}`,
      JSON.stringify({ text: 'ancient', base: 'T1', savedAt: Date.now() - 15 * day }),
    );
    await openEditor('base', 'T1');
    expect(s.$docRestored.get()).toBe(false);
    expect(s.$docDraft.get()).toBe('base');
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);

    sessionData.set(
      `ctxman:draft:${KEY}`,
      JSON.stringify({ text: 'recent', base: 'T1', savedAt: Date.now() - 13 * day }),
    );
    await s.loadDoc();
    expect(s.$docDraft.get()).toBe('recent');
    expect(s.$docRestored.get()).toBe(true);
  });

  it('discardDraft returns to the saved text and removes the backup', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'unsaved', base: 'T0' }));
    await openEditor('base', 'T1');
    expect(s.$docDraftStale.get()).toBe(true);
    s.discardDraft();
    expect(s.$docDraft.get()).toBe('base');
    expect(s.$docRestored.get()).toBe(false);
    expect(s.$docDraftStale.get()).toBe(false);
    expect(s.$docDraftAvailable.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
  });

  it('registers no beforeunload listener: only popstate (the draft backup replaces the native prompt)', async () => {
    await openEditor('base', 'T1');
    s.setDocDraft('dirty');
    expect(s.$docDirty.get()).toBe(true);
    expect(windowListeners).toEqual(['popstate']);
  });

  it('discardEdit leaves edit mode: URL without edit, draft reset, backup cleared', async () => {
    await openEditor('base', 'T1');
    s.setDocDraft('changed');
    s.discardEdit();
    expect(s.$docEdit.get()).toBe(false);
    expect(loc.search).toBe('');
    expect(s.$docDraft.get()).toBe('base');
    expect(s.$docDirty.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
  });
});

describe('draft available (preview mode)', () => {
  it('is false without a stored draft', () => {
    s.initDoc({ ...TARGET });
    expect(s.$docEdit.get()).toBe(false);
    expect(s.$docDraftAvailable.get()).toBe(false);
  });

  it('is true for a stored draft; Resume editing (enterEdit) restores it', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'unsaved', base: 'T1' }));
    disk({ markdown: 'base', lastModified: 'T1' });
    s.initDoc({ ...TARGET });
    expect(s.$docDraftAvailable.get()).toBe(true);
    expect(s.$docEdit.get()).toBe(false);
    s.enterEdit();
    await settle();
    expect(s.$docDraft.get()).toBe('unsaved');
    expect(s.$docRestored.get()).toBe(true);
    expect(s.$docDraftAvailable.get()).toBe(true);
  });

  it('an expired draft is not available (and is removed)', () => {
    const day = 24 * 60 * 60 * 1000;
    sessionData.set(
      `ctxman:draft:${KEY}`,
      JSON.stringify({ text: 'ancient', base: 'T1', savedAt: Date.now() - 15 * day }),
    );
    s.initDoc({ ...TARGET });
    expect(s.$docDraftAvailable.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
  });

  it('follows the stored draft: typing sets it, going back to the saved text, discardEdit and Save clear it', async () => {
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      body: { lastModified: 'T2', warnings: [] },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    expect(s.$docDraftAvailable.get()).toBe(false);
    s.setDocDraft('typed');
    expect(s.$docDraftAvailable.get()).toBe(true);
    s.setDocDraft('base');
    expect(s.$docDraftAvailable.get()).toBe(false);
    s.setDocDraft('typed again');
    s.discardEdit();
    expect(s.$docDraftAvailable.get()).toBe(false);

    s.enterEdit();
    await settle();
    s.setDocDraft('to be saved');
    expect(s.$docDraftAvailable.get()).toBe(true);
    await s.saveDoc();
    expect(s.$docDraftAvailable.get()).toBe(false);
  });

  it('the browser back button out of unsaved text stays in the editor and asks; the draft stays stored', async () => {
    await openEditor('base', 'T1');
    s.setDocDraft('typed');
    loc.search = '';
    popstateHandlers.forEach((fn) => fn());
    expect(s.$docEdit.get()).toBe(true);
    expect(s.$docLeave.get()).toEqual({ kind: 'preview' });
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(true);
  });

  it('Load disk version drops the draft too', async () => {
    stubFetch((call) =>
      call.method === 'GET'
        ? { body: { path: TARGET.path, markdown: 'theirs', lastModified: 'T9', warnings: [] } }
        : { status: 409, body: { error: 'conflict', message: 'x', lastModified: 'T9' } },
    );
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('mine');
    await s.saveDoc();
    s.loadDiskVersion();
    await settle();
    expect(s.$docDraftAvailable.get()).toBe(false);
    expect(s.$docRestored.get()).toBe(false);
    expect(s.$docDraft.get()).toBe('theirs');
  });
});

describe('saveDoc', () => {
  it('PUTs the draft with ifUnmodifiedSince, then returns to the preview and schedules the fallback reload', async () => {
    const calls = disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      body: { lastModified: 'T2', warnings: [] },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('new text');
    await s.saveDoc();

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toEqual({
      url: URL_PATH,
      method: 'PUT',
      body: { markdown: 'new text', ifUnmodifiedSince: 'T1' },
    });
    expect(s.$docBaseline.get()).toEqual({ text: 'new text', lastModified: 'T2' });
    expect(s.$docDirty.get()).toBe(false);
    expect(s.$docEdit.get()).toBe(false);
    expect(loc.search).toBe('');
    expect(s.$docStale.get()).toBe(true);
    expect(s.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved' });
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
    // the reloaded page shows "Saved" once
    expect(JSON.parse(sessionData.get(`ctxman:saved:${KEY}`) ?? 'null')).toEqual({
      message: 'Saved',
      warnings: [],
    });

    expect(loc.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(s.RELOAD_AFTER_SAVE_MS - 1);
    expect(loc.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(loc.reload).toHaveBeenCalledTimes(1);
  });

  it('skips the reload when the user is editing again', async () => {
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      body: { lastModified: 'T2', warnings: [] },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('x');
    await s.saveDoc();
    s.enterEdit();
    vi.advanceTimersByTime(s.RELOAD_AFTER_SAVE_MS * 2);
    expect(loc.reload).not.toHaveBeenCalled();
    // leaving edit mode again re-arms it
    s.discardEdit();
    vi.advanceTimersByTime(s.RELOAD_AFTER_SAVE_MS);
    expect(loc.reload).toHaveBeenCalledTimes(1);
  });

  it('reports the validator warnings of the PUT and carries them over the reload', async () => {
    const warnings = [
      {
        severity: 'warning',
        rule: 'okf/stale',
        file: 'kb/demo/concepts/a b.md',
        line: 3,
        message: 'old',
      },
      {
        severity: 'error',
        rule: 'okf/type',
        file: 'kb/demo/concepts/a b.md',
        message: 'type missing',
      },
    ];
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      body: { lastModified: 'T2', warnings },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('no frontmatter');
    await s.saveDoc();
    expect(s.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved · 2 warnings' });
    // every finding is a warning, whatever its severity: the save went through
    expect(s.$docWarnings.get()).toEqual([
      { rule: 'okf/stale', message: 'old', line: 3 },
      { rule: 'okf/type', message: 'type missing' },
    ]);

    // a fresh page (new module instance) picks the message and findings up exactly once
    vi.resetModules();
    const next = await import('../../src/stores/doc-editor.ts');
    next.initDoc({ ...TARGET });
    expect(next.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved · 2 warnings' });
    expect(next.$docWarnings.get()).toHaveLength(2);
    expect(sessionData.has(`ctxman:saved:${KEY}`)).toBe(false);
  });

  it('lists link findings (severity error) as warnings and counts them in the status', async () => {
    const warnings = [
      {
        severity: 'error',
        rule: 'links/broken',
        file: 'kb/demo/concepts/a b.md',
        line: 7,
        message: 'Broken link ./missing.md',
      },
      {
        severity: 'error',
        rule: 'links/ctxman-target',
        file: 'kb/demo/concepts/a b.md',
        line: 8,
        message: 'ctxman:idea/e2e-nope does not exist',
      },
    ];
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      body: { lastModified: 'T2', warnings },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('[a](./missing.md) [b](ctxman:idea/e2e-nope)');
    await s.saveDoc();
    expect(s.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved · 2 warnings' });
    expect(s.$docWarnings.get().map((w) => w.rule)).toEqual([
      'links/broken',
      'links/ctxman-target',
    ]);
    expect(s.$docEdit.get()).toBe(false);
  });

  it('uses the singular for one warning', async () => {
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      body: {
        lastModified: 'T2',
        warnings: [{ severity: 'warning', rule: 'r', file: 'f', message: 'm' }],
      },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('x');
    await s.saveDoc();
    expect(s.$docSave.get().message).toBe('Saved · 1 warning');
  });

  it('does nothing for an unchanged draft (Cmd/Ctrl+S on clean text)', async () => {
    const calls = await openEditor('base', 'T1');
    await s.saveDoc();
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
    expect(s.$docEdit.get()).toBe(true);
  });

  it('a 409 opens the conflict state and keeps the draft in edit mode', async () => {
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      status: 409,
      body: { error: 'conflict', message: 'changed on disk', lastModified: 'T9' },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('mine');
    await s.saveDoc();
    expect(s.$docConflict.get()).toBe(true);
    expect(s.$docSave.get()).toEqual({ kind: 'conflict', message: 'Changed on disk' });
    expect(s.$docEdit.get()).toBe(true);
    expect(s.$docDraft.get()).toBe('mine');
    expect(s.$docStale.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(true);

    s.keepEditing();
    expect(s.$docConflict.get()).toBe(false);
    expect(s.$docDraft.get()).toBe('mine');
  });

  it('Overwrite saves again without ifUnmodifiedSince', async () => {
    let conflicts = 1;
    const calls = disk({ markdown: 'base', lastModified: 'T1' }, (call) =>
      conflicts-- > 0 && call.body?.ifUnmodifiedSince !== undefined
        ? { status: 409, body: { error: 'conflict', message: 'x', lastModified: 'T9' } }
        : { body: { lastModified: 'T10', warnings: [] } },
    );
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('mine');
    await s.saveDoc();
    expect(s.$docConflict.get()).toBe(true);
    await s.saveDoc({ force: true });
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts[1]?.body).toEqual({ markdown: 'mine' });
    expect(s.$docConflict.get()).toBe(false);
    expect(s.$docSave.get().kind).toBe('saved');
    expect(s.$docEdit.get()).toBe(false);
  });

  it('Load disk version drops my edits and re-reads the file', async () => {
    let onDisk = { markdown: 'base', lastModified: 'T1' };
    stubFetch((call) =>
      call.method === 'GET'
        ? { body: { path: TARGET.path, ...onDisk, warnings: [] } }
        : { status: 409, body: { error: 'conflict', message: 'x', lastModified: 'T9' } },
    );
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('mine');
    await s.saveDoc();
    expect(s.$docConflict.get()).toBe(true);

    onDisk = { markdown: 'theirs', lastModified: 'T9' };
    s.loadDiskVersion();
    expect(s.$docConflict.get()).toBe(false);
    expect(sessionData.has(`ctxman:draft:${KEY}`)).toBe(false);
    await settle();
    expect(s.$docBaseline.get()).toEqual({ text: 'theirs', lastModified: 'T9' });
    expect(s.$docDraft.get()).toBe('theirs');
    expect(s.$docDirty.get()).toBe(false);
    expect(s.$docSave.get().kind).toBe('idle');
  });

  it('another failure stays in edit mode with the server message', async () => {
    disk({ markdown: 'base', lastModified: 'T1' }, () => ({
      status: 500,
      body: { error: 'internal', message: 'disk full' },
    }));
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('mine');
    await s.saveDoc();
    expect(s.$docSave.get()).toEqual({ kind: 'error', message: 'Save failed: disk full' });
    expect(s.$docConflict.get()).toBe(false);
    expect(s.$docEdit.get()).toBe(true);
    expect(s.$docDirty.get()).toBe(true);
    // typing clears the stale error
    s.setDocDraft('mine!');
    expect(s.$docSave.get().kind).toBe('idle');
  });

  it('ignores a second save while one is in flight', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let puts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? 'GET') === 'GET') {
          return new Response(
            JSON.stringify({ markdown: 'base', lastModified: 'T1', warnings: [] }),
          );
        }
        puts++;
        await gate;
        return new Response(JSON.stringify({ lastModified: 'T2', warnings: [] }));
      }),
    );
    s.initDoc({ ...TARGET });
    s.enterEdit();
    await settle();
    s.setDocDraft('mine');
    const first = s.saveDoc();
    await s.saveDoc();
    expect(puts).toBe(1);
    expect(s.$docSave.get().kind).toBe('saving');
    release?.();
    await first;
    expect(s.$docSave.get().kind).toBe('saved');
  });
});

/** Saves 'x' over 'base' and returns, as `vi.resetModules()` + import would: a fresh page (module instance). */
async function saveThenFreshPage(warnings: unknown[] = []): Promise<Store> {
  disk({ markdown: 'base', lastModified: 'T1' }, () => ({
    body: { lastModified: 'T2', warnings },
  }));
  s.initDoc({ ...TARGET });
  s.enterEdit();
  await settle();
  s.setDocDraft('x');
  await s.saveDoc();
  vi.clearAllTimers(); // the old page's reload timer died with it
  loc.reload = vi.fn();
  vi.resetModules();
  return import('../../src/stores/doc-editor.ts');
}

describe('the page after a save (one reload, no settle reloads)', () => {
  it('the reloaded page shows Saved + findings once and schedules NO further reload', async () => {
    const warnings = [
      { severity: 'warning', rule: 'okf/stale', file: 'f', line: 2, message: 'old' },
    ];
    const page = await saveThenFreshPage(warnings);
    page.initDoc({ ...TARGET });
    expect(page.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved · 1 warning' });
    expect(page.$docWarnings.get()).toEqual([{ rule: 'okf/stale', message: 'old', line: 2 }]);
    expect(sessionData.has(`ctxman:saved:${KEY}`)).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(loc.reload).not.toHaveBeenCalled();
  });

  it('a plain-text or legacy record (with a reloads counter) is shown and schedules nothing', async () => {
    sessionData.set(`ctxman:saved:${KEY}`, 'Saved');
    s.initDoc({ ...TARGET });
    expect(s.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved' });
    sessionData.set(
      `ctxman:saved:${KEY}`,
      JSON.stringify({ message: 'Saved again', warnings: [], reloads: 3 }),
    );
    vi.resetModules();
    const page = await import('../../src/stores/doc-editor.ts');
    page.initDoc({ ...TARGET });
    expect(page.$docSave.get()).toEqual({ kind: 'saved', message: 'Saved again' });
    vi.advanceTimersByTime(60_000);
    expect(loc.reload).not.toHaveBeenCalled();
  });

  it('no record, no reload (a normal visit)', async () => {
    s.initDoc({ ...TARGET });
    vi.advanceTimersByTime(60_000);
    expect(loc.reload).not.toHaveBeenCalled();
    expect(s.$docSave.get().kind).toBe('idle');
  });

  it('a newer save restarts the reload timer', async () => {
    const page = await saveThenFreshPage();
    page.initDoc({ ...TARGET });
    disk({ markdown: 'x', lastModified: 'T2' }, () => ({
      body: { lastModified: 'T3', warnings: [] },
    }));
    page.enterEdit();
    await settle();
    page.setDocDraft('second');
    await page.saveDoc();
    expect(loc.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(page.RELOAD_AFTER_SAVE_MS);
    expect(loc.reload).toHaveBeenCalledTimes(1);
  });

  it('consuming the record leaves the draft backup of the file alone', async () => {
    sessionData.set(`ctxman:draft:${KEY}`, JSON.stringify({ text: 'kept', base: 'T2' }));
    sessionData.set(`ctxman:saved:${KEY}`, JSON.stringify({ message: 'Saved', warnings: [] }));
    s.initDoc({ ...TARGET });
    expect(JSON.parse(sessionData.get(`ctxman:draft:${KEY}`) ?? 'null')).toEqual({
      text: 'kept',
      base: 'T2',
    });
    expect(s.$docDirty.get()).toBe(false);
  });
});

describe('draft restore plan (shared with the markdown popups)', () => {
  it('restores a differing draft, stale only when its base is not the loaded lastModified', async () => {
    const { planRestore, restoredMessage } = await import('../../src/ui/markdown/draft-restore.ts');
    const disk = { text: 'disk', lastModified: 'T2' };
    expect(planRestore(null, disk)).toEqual({ text: 'disk', restored: false, stale: false });
    expect(planRestore({ text: 'disk', base: 'T1' }, disk)).toEqual({
      text: 'disk',
      restored: false,
      stale: false,
    });
    expect(planRestore({ text: 'mine', base: 'T2' }, disk)).toEqual({
      text: 'mine',
      restored: true,
      stale: false,
    });
    expect(planRestore({ text: 'mine', base: 'T1' }, disk)).toEqual({
      text: 'mine',
      restored: true,
      stale: true,
    });
    expect(restoredMessage(false)).toBe('Restored unsaved changes from earlier.');
    expect(restoredMessage(true)).toContain('the file changed on disk since');
  });

  it('keys a popup draft by endpoint and target id', async () => {
    const { mdDraftKey } = await import('../../src/ui/markdown/draft-restore.ts');
    expect(
      mdDraftKey({
        kind: 'context-notes',
        id: 'notes:kb:ctxman',
        slug: 'my-ctx',
        dataset: 'kb',
        target: 'ctxman',
        label: 'notes for ctxman',
      }),
    ).toBe('md:/api/context/my-ctx#notes:kb:ctxman');
    expect(
      mdDraftKey({ kind: 'recipe-preamble', id: 'preamble', slug: 'r1', label: 'preamble' }),
    ).toBe('md:/api/recipe/r1#preamble');
    expect(
      mdDraftKey({ kind: 'recipe-block', id: 'block:b1', slug: 'r1', blockId: 'b1', label: 'x' }),
    ).toBe('md:/api/recipe/r1#block:b1');
  });
});
