import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASETS } from '../../src/datasets/registry.ts';
import { deleteEndpoint, deleteEntry, deleteSummary } from '../../src/ui/entry/delete-entry.ts';

afterEach(() => vi.unstubAllGlobals());

describe('deleteEndpoint', () => {
  it('routes okf bundles and skills through /api/entry', () => {
    for (const def of DATASETS.filter((d) => d.kind !== 'data')) {
      expect(deleteEndpoint(def.id, 'my-entry')).toBe(`/api/entry/${def.id}/my-entry`);
    }
  });

  it('routes the yaml datasets to their own CRUD routes', () => {
    expect(deleteEndpoint('reference', 'r')).toBe('/api/reference/r');
    expect(deleteEndpoint('context', 'c')).toBe('/api/context/c');
    expect(deleteEndpoint('recipe', 'x')).toBe('/api/recipe/x');
  });

  it('encodes the slug', () => {
    expect(deleteEndpoint('task', '../x')).toBe('/api/entry/task/..%2Fx');
  });
});

describe('deleteSummary', () => {
  it('names the folder or the yaml file', () => {
    expect(deleteSummary('task', 'a')).toBe(
      'This removes the whole folder task/a and every file in it.',
    );
    expect(deleteSummary('skill', 's')).toContain('whole folder skill/s');
    expect(deleteSummary('context', 'c')).toBe('This removes context/c.yaml.');
  });
});

describe('deleteEntry', () => {
  it('resolves ok on 204 and failure text on an error, never throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'not-found', message: 'gone' }), { status: 404 }),
      )
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await deleteEntry('task', 'a')).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/entry/task/a');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' });
    expect(await deleteEntry('task', 'a')).toEqual({ ok: false, failure: 'gone' });
    expect(await deleteEntry('task', 'a')).toEqual({ ok: false, failure: 'offline' });
    expect(await deleteEntry('nope', 'a')).toEqual({
      ok: false,
      failure: '"nope" is not a dataset',
    });
  });
});
