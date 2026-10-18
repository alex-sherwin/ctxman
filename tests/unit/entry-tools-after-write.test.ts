import { afterEach, describe, expect, it, vi } from 'vitest';
import { $docEdit, $docTarget, RELOAD_FALLBACK_MS } from '../../src/stores/doc-editor.ts';
import { takeSave } from '../../src/ui/edit/last-save.ts';
import { afterWrite, STATUS_KEY } from '../../src/ui/entry/after-write.ts';
import {
  $entryStatus,
  initEntryStatus,
  showEntryStatus,
  STATUS_VISIBLE_MS,
} from '../../src/ui/entry/entry-status.ts';

function stubSession(): Map<string, string> {
  const data = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
  return data;
}

/** Mounting `$docEdit` (any `.get()` of an unwatched store) registers a popstate listener on `window`. */
function stubBrowser(): void {
  vi.stubGlobal('location', { search: '', pathname: '/', hash: '' });
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  $entryStatus.set('');
  $docEdit.set(false);
  $docTarget.set(null);
});

describe('STATUS_KEY', () => {
  it('is per entry', () => {
    expect(STATUS_KEY('task', 'a')).toBe('entry:task/a');
  });
});

describe('afterWrite', () => {
  it('without a dev reload: remembers the message and reloads at once', () => {
    stubSession();
    const reload = vi.fn();
    afterWrite(STATUS_KEY('task', 'a'), 'Added to ctx', { devReload: false, reload });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeSave(STATUS_KEY('task', 'a'))).toBe('Added to ctx');
  });

  it('with a dev reload: reloads only after the fallback delay', () => {
    vi.useFakeTimers();
    stubSession();
    stubBrowser();
    const reload = vi.fn();
    afterWrite(STATUS_KEY('task', 'a'), 'Saved details', { reload });
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS - 1);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('the fallback reload is skipped while the doc editor is open', () => {
    vi.useFakeTimers();
    stubSession();
    const reload = vi.fn();
    afterWrite('k', 'Saved', { reload, isEditing: () => true });
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 2);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reads $docEditing by default: a DocEditor mounted AND in edit mode', () => {
    vi.useFakeTimers();
    stubSession();
    stubBrowser();
    const reload = vi.fn();
    $docTarget.set({ dataset: 'kb', slug: 'demo', path: 'main.md' });
    $docEdit.set(true);
    afterWrite('k', 'Saved', { reload });
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).not.toHaveBeenCalled();
    $docEdit.set(false);
    afterWrite('k', 'Saved', { reload });
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('afterWrite without a DocEditor', () => {
  it('still reloads when only ?edit=1 is set (the reference form has no DocEditor)', () => {
    vi.useFakeTimers();
    stubSession();
    stubBrowser();
    const reload = vi.fn();
    $docEdit.set(true); // $docTarget stays null: no DocEditor island on this page
    afterWrite('k', 'Saved', { reload });
    vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('entry status', () => {
  it('shows a message and clears it after STATUS_VISIBLE_MS', () => {
    vi.useFakeTimers();
    showEntryStatus('Saved details');
    expect($entryStatus.get()).toBe('Saved details');
    vi.advanceTimersByTime(STATUS_VISIBLE_MS - 1);
    expect($entryStatus.get()).toBe('Saved details');
    vi.advanceTimersByTime(1);
    expect($entryStatus.get()).toBe('');
  });

  it('a newer message restarts the timer', () => {
    vi.useFakeTimers();
    showEntryStatus('one');
    vi.advanceTimersByTime(STATUS_VISIBLE_MS - 100);
    showEntryStatus('two');
    vi.advanceTimersByTime(STATUS_VISIBLE_MS - 100);
    expect($entryStatus.get()).toBe('two');
    vi.advanceTimersByTime(100);
    expect($entryStatus.get()).toBe('');
  });

  it('initEntryStatus takes the message the previous page parked, once', () => {
    vi.useFakeTimers();
    stubSession();
    afterWrite(STATUS_KEY('kb', 'x'), 'Removed link', { devReload: false, reload: () => {} });
    initEntryStatus(STATUS_KEY('kb', 'x'));
    expect($entryStatus.get()).toBe('Removed link');
    $entryStatus.set('');
    initEntryStatus(STATUS_KEY('kb', 'x'));
    expect($entryStatus.get()).toBe('');
  });
});
