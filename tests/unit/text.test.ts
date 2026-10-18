import { describe, expect, it } from 'vitest';
import { clone, omit } from '../../src/lib/object.ts';
import { firstLine, lineCount, plural } from '../../src/lib/text.ts';

describe('text helpers', () => {
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
    expect(plural(0, 'problem')).toBe('0 problems');
  });
});

describe('object helpers', () => {
  it('clone is a deep copy', () => {
    const a = { x: { y: [1, 2] } };
    const b = clone(a);
    expect(b).toEqual(a);
    expect(b.x).not.toBe(a.x);
  });

  it('omit drops one key and leaves the input alone', () => {
    const a = { x: 1, y: 2 };
    expect(omit(a, 'x')).toEqual({ y: 2 });
    expect(a).toEqual({ x: 1, y: 2 });
  });
});
