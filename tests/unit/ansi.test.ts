import { describe, expect, it } from 'vitest';
import { stripAnsi } from '../../src/lib/ansi.ts';

describe('stripAnsi', () => {
  it('strips color codes', () => {
    expect(stripAnsi('\x1b[31mERROR\x1b[0m done')).toBe('ERROR done');
    expect(stripAnsi('\x1b[1;32mOK\x1b[0m')).toBe('OK');
    expect(stripAnsi('\x1b[38;5;208morange\x1b[39m')).toBe('orange');
  });

  it('strips cursor / erase sequences', () => {
    expect(stripAnsi('a\x1b[2Kb\x1b[1Ac')).toBe('abc');
    expect(stripAnsi('\x1b[Hhome')).toBe('home');
  });

  it('leaves plain text, newlines and unrelated brackets alone', () => {
    const text = 'line 1\nline [2] (3)\n\ttabbed';
    expect(stripAnsi(text)).toBe(text);
    expect(stripAnsi('')).toBe('');
  });

  it('is idempotent and handles many sequences', () => {
    const colored = '\x1b[31ma\x1b[0m'.repeat(1000);
    const once = stripAnsi(colored);
    expect(once).toBe('a'.repeat(1000));
    expect(stripAnsi(once)).toBe(once);
  });
});
