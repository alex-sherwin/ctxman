import { beforeEach, describe, expect, it } from 'vitest';
import { clearMarkdownCache, renderMarkdown } from '../../src/lib/markdown.ts';

beforeEach(() => clearMarkdownCache());

describe('renderMarkdown', () => {
  it('renders markdown and returns the identical string for the same source (memo)', async () => {
    const a = await renderMarkdown('# Hello\n\nSome **bold** text.');
    expect(a).toContain('<h1');
    expect(a).toContain('<strong>bold</strong>');
    expect(await renderMarkdown('# Hello\n\nSome **bold** text.')).toBe(a);
  });

  it('returns an empty string for blank input', async () => {
    expect(await renderMarkdown('  \n')).toBe('');
  });

  it('keeps working past the cache cap (oldest entries are dropped)', async () => {
    for (let i = 0; i < 300; i++) await renderMarkdown(`item ${i}`);
    expect(await renderMarkdown('item 299')).toContain('item 299');
    expect(await renderMarkdown('item 0')).toContain('item 0');
  });
});
