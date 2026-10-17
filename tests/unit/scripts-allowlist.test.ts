import { describe, expect, it } from 'vitest';
import { SCRIPTS, getScript, isScriptName } from '../../src/lib/scripts-allowlist.ts';

describe('scripts allowlist', () => {
  it('has unique names', () => {
    const names = SCRIPTS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has exactly one add script and four check scripts', () => {
    expect(SCRIPTS.filter((s) => s.kind === 'add').map((s) => s.name)).toEqual(['add']);
    expect(SCRIPTS.filter((s) => s.kind === 'check').map((s) => s.name)).toEqual([
      'check',
      'check-okf',
      'check-links',
      'check-collections',
    ]);
  });

  it('points every script at a repo-relative scripts/*.ts file', () => {
    for (const s of SCRIPTS) {
      expect(s.file, s.name).toMatch(/^scripts\/[a-z-]+\.ts$/);
    }
    expect(new Set(SCRIPTS.map((s) => s.file)).size).toBe(SCRIPTS.length);
  });

  it('gives every script a label and a description', () => {
    for (const s of SCRIPTS) {
      expect(s.label, s.name).not.toBe('');
      expect(s.description, s.name).not.toBe('');
    }
  });

  it('getScript looks up by name and rejects anything else', () => {
    expect(getScript('add')?.file).toBe('scripts/add-entry.ts');
    expect(getScript('check')?.file).toBe('scripts/check-all.ts');
    expect(getScript('check-okf')?.kind).toBe('check');
    expect(getScript('rm')).toBeUndefined();
    expect(getScript('')).toBeUndefined();
    expect(getScript('constructor')).toBeUndefined();
    expect(getScript('../scripts/check-all')).toBeUndefined();
    expect(getScript('Add')).toBeUndefined();
  });

  it('isScriptName is a strict guard', () => {
    expect(isScriptName('check-links')).toBe(true);
    expect(isScriptName('check-all')).toBe(false);
    expect(isScriptName(undefined)).toBe(false);
    expect(isScriptName(5)).toBe(false);
  });
});
