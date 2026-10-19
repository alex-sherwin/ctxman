// The remembered list sort (src/lib/list-sort-memory.ts): the cookie a sort choice writes and the redirect a list
// URL without a sort gets from it.
import { describe, expect, it } from 'vitest';
import {
  parseRememberedSort,
  rememberedSortHref,
  serializeRememberedSort,
  sortCookie,
  sortCookieName,
} from '../../src/lib/list-sort-memory.ts';

const url = (path: string): URL => new URL(path, 'http://127.0.0.1:4321');

describe('parseRememberedSort', () => {
  it('reads `<sort>.<dir>` for a sort of the dataset', () => {
    expect(parseRememberedSort('name.asc', 'task')).toEqual({ sort: 'name', dir: 'asc' });
    expect(parseRememberedSort('state.desc', 'task')).toEqual({ sort: 'state', dir: 'desc' });
    expect(parseRememberedSort('modified.asc', 'kb')).toEqual({ sort: 'modified', dir: 'asc' });
    expect(parseRememberedSort('links.desc', 'context')).toEqual({ sort: 'links', dir: 'desc' });
  });

  it('round-trips serializeRememberedSort', () => {
    const value = { sort: 'owner', dir: 'desc' } as const;
    expect(parseRememberedSort(serializeRememberedSort(value), 'reference')).toEqual(value);
  });

  it('is null for the default sort, a sort the dataset lacks and unreadable values', () => {
    expect(parseRememberedSort('modified.desc', 'task')).toBeNull();
    expect(parseRememberedSort('state.asc', 'kb')).toBeNull();
    expect(parseRememberedSort('links.asc', 'recipe')).toBeNull();
    expect(parseRememberedSort('name', 'task')).toBeNull();
    expect(parseRememberedSort('name.up', 'task')).toBeNull();
    expect(parseRememberedSort('name.asc.x', 'task')).toBeNull();
    expect(parseRememberedSort('', 'task')).toBeNull();
    expect(parseRememberedSort(undefined, 'task')).toBeNull();
  });
});

describe('rememberedSortHref', () => {
  it('sends a list URL without `sort` and `dir` to the remembered sort, filters kept', () => {
    expect(rememberedSortHref(url('/task'), 'task', 'name.asc')).toBe('/task?sort=name');
    expect(rememberedSortHref(url('/task?state=pending'), 'task', 'name.desc')).toBe(
      '/task?state=pending&sort=name&dir=desc',
    );
    expect(rememberedSortHref(url('/kb'), 'kb', 'modified.asc')).toBe('/kb?dir=asc');
  });

  it('leaves a URL that names a sort or a direction, and lists with nothing remembered', () => {
    expect(rememberedSortHref(url('/task?sort=state'), 'task', 'name.asc')).toBeNull();
    expect(rememberedSortHref(url('/task?dir=asc'), 'task', 'name.asc')).toBeNull();
    expect(rememberedSortHref(url('/task'), 'task', undefined)).toBeNull();
    expect(rememberedSortHref(url('/task'), 'task', 'modified.desc')).toBeNull();
    expect(rememberedSortHref(url('/kb'), 'kb', 'state.asc')).toBeNull();
  });

  it('always lands on a URL it would leave alone (no redirect loop)', () => {
    for (const cookie of ['name.asc', 'name.desc', 'modified.asc', 'state.asc', 'state.desc']) {
      const href = rememberedSortHref(url('/task?q=x'), 'task', cookie);
      expect(href).not.toBeNull();
      expect(rememberedSortHref(url(href ?? ''), 'task', cookie)).toBeNull();
    }
  });
});

describe('sortCookie', () => {
  it('stores a chosen sort for a year under the dataset name', () => {
    expect(sortCookieName('task')).toBe('ctxman-sort-task');
    expect(sortCookie('task', 'name', 'desc')).toBe(
      'ctxman-sort-task=name.desc; Path=/; Max-Age=31536000; SameSite=Lax',
    );
  });

  it('removes the cookie when the default sort is chosen', () => {
    expect(sortCookie('kb', 'modified', 'desc')).toBe(
      'ctxman-sort-kb=; Path=/; Max-Age=0; SameSite=Lax',
    );
  });
});
