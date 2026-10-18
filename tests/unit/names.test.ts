import { describe, expect, it } from 'vitest';
import { TAG_PATTERN, nameProblem, normalizeTag, tagProblem } from '../../src/lib/names.ts';
import { nameProblem as reExported } from '../../src/ui/forge/validate-name.ts';

describe('nameProblem', () => {
  it('accepts kebab-case names up to 64 characters', () => {
    expect(nameProblem('auth-refactor')).toBeNull();
    expect(nameProblem('a')).toBeNull();
    expect(nameProblem('a1-b2-c3')).toBeNull();
    expect(nameProblem('a'.repeat(64))).toBeNull();
  });

  it('says Required for the empty string', () => {
    expect(nameProblem('')).toBe('Required');
  });

  it('rejects anything but lowercase letters, digits and single hyphens', () => {
    for (const bad of [
      'Bad Name',
      'double--hyphen',
      '-lead',
      'trail-',
      'UPPER',
      'a_b',
      'a.b',
      ' x',
    ]) {
      expect(nameProblem(bad), bad).toContain('lowercase letters');
    }
  });

  it('enforces the length limit', () => {
    expect(nameProblem('a'.repeat(65))).toBe('64 characters max');
  });

  it('checks uniqueness against `existing`, naming the noun', () => {
    const existing = new Set(['taken']);
    expect(nameProblem('taken', existing)).toBe('A context with this name already exists');
    expect(nameProblem('taken', existing, 'recipe')).toBe('A recipe with this name already exists');
    expect(nameProblem('free', existing, 'recipe')).toBeNull();
  });

  it('reports format problems before uniqueness', () => {
    expect(nameProblem('Taken', new Set(['Taken']))).toContain('lowercase letters');
  });

  it('is re-exported from the old Forge path', () => {
    expect(reExported).toBe(nameProblem);
  });
});

describe('tags', () => {
  it('normalizes what the user typed', () => {
    expect(normalizeTag('  Hello   World ')).toBe('hello-world');
    expect(normalizeTag('a-b')).toBe('a-b');
    expect(normalizeTag('   ')).toBe('');
  });

  it('accepts lowercase letters, digits and hyphens, not starting with a hyphen', () => {
    for (const ok of ['a', '9', 'a-b', 'a--b', 'x1-y2']) {
      expect(TAG_PATTERN.test(ok), ok).toBe(true);
      expect(tagProblem(ok), ok).toBeNull();
    }
    for (const bad of ['-a', 'A', 'a b', 'a_b', 'a.b']) {
      expect(tagProblem(bad), bad).toBe('Lowercase letters, digits and hyphens');
    }
  });

  it('treats the empty string as "nothing typed yet"', () => {
    expect(tagProblem('')).toBeNull();
  });
});
