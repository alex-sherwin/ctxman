import { describe, expect, it, vi } from 'vitest';
import {
  COPY_FORMATS,
  copyFormat,
  lazyConverter,
  preloadCopyFormats,
} from '../../src/lib/copy-formats.ts';
import { markdownToJira } from '../../src/lib/jira-markup.ts';

describe('COPY_FORMATS', () => {
  it('has unique ids that fit a test id suffix, and a label and a status per row', () => {
    const ids = COPY_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of COPY_FORMATS) {
      expect(f.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(f.label).not.toBe('');
      expect(f.copied).toMatch(/^Copied /);
    }
  });

  it('offers Copy as JIRA Markup, which converts with markdownToJira', async () => {
    const jira = copyFormat('jira');
    expect(jira?.label).toBe('Copy as JIRA Markup');
    expect(jira?.copied).toBe('Copied as JIRA Markup');
    const markdown = '# Title\n\nSome **bold** text and `code`.\n\n- one\n- two\n';
    expect(await jira?.convert(markdown)).toBe(markdownToJira(markdown));
  });

  it('copyFormat answers undefined for an unknown or missing id', () => {
    expect(copyFormat('html')).toBeUndefined();
    expect(copyFormat(undefined)).toBeUndefined();
  });

  it('preloadCopyFormats never throws', () => {
    expect(() => preloadCopyFormats()).not.toThrow();
  });
});

describe('lazyConverter', () => {
  it('loads the converter once, on the first preload or convert', async () => {
    const load = vi.fn(async () => (md: string) => md.toUpperCase());
    const lazy = lazyConverter(load);
    expect(load).not.toHaveBeenCalled();
    lazy.preload();
    lazy.preload();
    expect(await lazy.convert('a')).toBe('A');
    expect(await lazy.convert('b')).toBe('B');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects convert when the load fails, and loads again on the next call', async () => {
    let fail = true;
    const load = vi.fn(async () => {
      if (fail) throw new Error('chunk failed');
      return (md: string) => `[${md}]`;
    });
    const lazy = lazyConverter(load);
    lazy.preload(); // swallowed: no unhandled rejection
    await expect(lazy.convert('x')).rejects.toThrow('chunk failed');
    fail = false;
    expect(await lazy.convert('x')).toBe('[x]');
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
