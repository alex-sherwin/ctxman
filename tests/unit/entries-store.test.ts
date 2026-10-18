import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINKABLE_DATASETS } from '../../src/datasets/registry.ts';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';
import {
  $entries,
  ensureAllEntries,
  ensureEntries,
  findEntry,
  waitForEntry,
} from '../../src/stores/entries.ts';

const entry = (dataset: string, slug: string): EntrySummary =>
  ({
    dataset,
    slug,
    name: slug,
    title: slug,
    url: `/${dataset}/${slug}`,
  }) as unknown as EntrySummary;

interface Call {
  dataset: string | null;
}

/** A fetch stub: `respond(dataset, callNumber)` returns the entries (or a status) per request. */
function stubFetch(respond: (dataset: string, n: number) => EntrySummary[] | number | Error): {
  calls: Call[];
} {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), 'http://ctxman.invalid');
      const dataset = url.searchParams.get('dataset');
      calls.push({ dataset });
      const out = respond(dataset ?? '', calls.filter((c) => c.dataset === dataset).length);
      if (out instanceof Error) throw out;
      if (typeof out === 'number') return new Response('{}', { status: out });
      return new Response(JSON.stringify({ entries: out }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return { calls };
}

beforeEach(() => {
  $entries.set({});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ensureAllEntries', () => {
  it('prefetches every linkable dataset once by default', async () => {
    const { calls } = stubFetch((ds) => [entry(ds, 'one')]);
    ensureAllEntries();
    ensureAllEntries(); // no-op while loading
    await vi.waitFor(() => {
      for (const ds of LINKABLE_DATASETS) expect($entries.get()[ds]?.status).toBe('ready');
    });
    expect(calls.map((c) => c.dataset).sort()).toEqual([...LINKABLE_DATASETS].sort());
    expect(findEntry('kb', 'one')?.slug).toBe('one');
  });

  it('loads only the given datasets, and nothing that is already ready', async () => {
    const { calls } = stubFetch((ds) => [entry(ds, 'a')]);
    ensureEntries('task');
    await vi.waitFor(() => expect($entries.get().task?.status).toBe('ready'));
    ensureAllEntries(['task', 'bug']);
    await vi.waitFor(() => expect($entries.get().bug?.status).toBe('ready'));
    expect(calls.map((c) => c.dataset)).toEqual(['task', 'bug']);
  });
});

describe('waitForEntry', () => {
  it('resolves true at once when the entry is listed and stores the response', async () => {
    const { calls } = stubFetch(() => [entry('reference', 'new-ref'), entry('reference', 'other')]);
    await expect(waitForEntry('reference', 'new-ref')).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect($entries.get().reference?.status).toBe('ready');
    expect($entries.get().reference?.entries.map((e) => e.slug)).toEqual(['new-ref', 'other']);
  });

  it('polls every intervalMs until the entry appears', async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch((_ds, n) =>
      n < 3 ? [entry('task', 'old')] : [entry('task', 'old'), entry('task', 'fresh')],
    );
    const result = waitForEntry('task', 'fresh', { timeoutMs: 5000, intervalMs: 250 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(calls).toHaveLength(2);
    expect($entries.get().task).toBeUndefined(); // not stored until the entry is there
    await vi.advanceTimersByTimeAsync(250);
    await expect(result).resolves.toBe(true);
    expect(calls).toHaveLength(3);
    expect(findEntry('task', 'fresh')).toBeDefined();
  });

  it('resolves false after timeoutMs without storing anything', async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch(() => [entry('idea', 'old')]);
    const result = waitForEntry('idea', 'never', { timeoutMs: 1000, intervalMs: 300 });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(false);
    // t = 0, 300, 600, 900 and a last one clipped to the deadline at 1000
    expect(calls).toHaveLength(5);
    expect($entries.get().idea).toBeUndefined();
  });

  it('keeps polling through HTTP and network errors', async () => {
    vi.useFakeTimers();
    const { calls } = stubFetch((_ds, n) =>
      n === 1 ? 500 : n === 2 ? new Error('offline') : [entry('feature', 'f')],
    );
    const result = waitForEntry('feature', 'f', { intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(300);
    await expect(result).resolves.toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('is never rejected, even when every request fails', async () => {
    vi.useFakeTimers();
    stubFetch(() => new Error('down'));
    const result = waitForEntry('bug', 'x', { timeoutMs: 500, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBe(false);
  });

  it('wins over an older in-flight load of the same dataset', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const stale = first;
        first = false;
        if (stale) await gate; // the older request answers last, with a list that lacks the entry
        const entries = stale ? [entry('kb', 'a')] : [entry('kb', 'a'), entry('kb', 'b')];
        return new Response(JSON.stringify({ entries }), { status: 200 });
      }),
    );
    ensureEntries('kb'); // request 1 (stale, held back)
    await expect(waitForEntry('kb', 'b')).resolves.toBe(true); // request 2
    release?.();
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect($entries.get().kb?.entries.map((e) => e.slug)).toEqual(['a', 'b']);
  });
});
