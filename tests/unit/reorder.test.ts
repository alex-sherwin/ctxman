import { describe, expect, it } from 'vitest';
import { reorderKeys } from '../../src/lib/reorder.ts';

const KEYS = ['a', 'b', 'c', 'd', 'e'];

describe('reorderKeys', () => {
  it('moves a single key up (before the target)', () => {
    expect(reorderKeys(KEYS, ['d'], 'b', 'before')).toEqual(['a', 'd', 'b', 'c', 'e']);
  });

  it('moves a single key down (after the target)', () => {
    expect(reorderKeys(KEYS, ['b'], 'd', 'after')).toEqual(['a', 'c', 'd', 'b', 'e']);
  });

  it('moves to the first position', () => {
    expect(reorderKeys(KEYS, ['c'], 'a', 'before')).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('moves to the last position', () => {
    expect(reorderKeys(KEYS, ['c'], 'e', 'after')).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('is a no-op when dropping next to the original place', () => {
    expect(reorderKeys(KEYS, ['c'], 'b', 'after')).toEqual(KEYS);
    expect(reorderKeys(KEYS, ['c'], 'd', 'before')).toEqual(KEYS);
  });

  it('keeps the current relative order of several moved keys, whatever order they are given in', () => {
    expect(reorderKeys(KEYS, ['d', 'b'], 'e', 'after')).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(reorderKeys(KEYS, ['e', 'a'], 'c', 'before')).toEqual(['b', 'a', 'e', 'c', 'd']);
  });

  it('returns an unchanged copy when the target is one of the moving keys', () => {
    const out = reorderKeys(KEYS, ['b', 'c'], 'c', 'after');
    expect(out).toEqual(KEYS);
    expect(out).not.toBe(KEYS);
  });

  it('returns an unchanged copy when the target is unknown', () => {
    expect(reorderKeys(KEYS, ['b'], 'zzz', 'before')).toEqual(KEYS);
  });

  it('ignores moving keys that are not in the list', () => {
    expect(reorderKeys(KEYS, ['zzz', 'e'], 'a', 'before')).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(reorderKeys(KEYS, ['zzz'], 'a', 'before')).toEqual(KEYS);
  });

  it('handles empty input', () => {
    expect(reorderKeys([], ['a'], 'b', 'before')).toEqual([]);
    expect(reorderKeys(KEYS, [], 'b', 'before')).toEqual(KEYS);
  });

  it('does not mutate its inputs', () => {
    const keys = [...KEYS];
    const moving = ['d', 'b'];
    reorderKeys(keys, moving, 'a', 'before');
    expect(keys).toEqual(KEYS);
    expect(moving).toEqual(['d', 'b']);
  });
});
