import { describe, expect, it } from 'vitest';
import {
  escapeLinkText,
  linkCompletionContext,
  linkFilterText,
  linkInsertText,
  markdownLink,
} from '../../src/lib/link-insert.ts';
import { planNewEntry } from '../../src/lib/templates.ts';

const ctx = (before: string, explicit = false) => linkCompletionContext(before, { explicit });

describe('linkCompletionContext: target (ctxman:)', () => {
  it('fires after the scheme and replaces only the part after it', () => {
    expect(ctx('see ctxman:')).toEqual({ kind: 'target', start: 11, typed: '' });
    expect(ctx('see ctxman:kb/ok')).toEqual({ kind: 'target', start: 11, typed: 'kb/ok' });
    expect(ctx('ctxman:')).toEqual({ kind: 'target', start: 7, typed: '' });
  });

  it('accepts the scheme after whitespace, (, < and [ and any letter case', () => {
    expect(ctx('[a](ctxman:t')?.kind).toBe('target');
    expect(ctx('<ctxman:t')?.kind).toBe('target');
    expect(ctx('[ctxman:t')?.kind).toBe('target');
    expect(ctx('x CTXMAN:Kb/a')?.kind).toBe('target');
  });

  it('does not fire when the scheme is part of a longer word or the text is not a slug', () => {
    expect(ctx('myctxman:')).toBeNull();
    expect(ctx('ctxman:kb/a b')).toBeNull();
    expect(ctx('ctxman:kb/a)')).toBeNull();
  });

  it('wins over the paren and wiki forms', () => {
    expect(ctx('[a](ctxman:')).toMatchObject({ kind: 'target', typed: '' });
    expect(ctx('[[ctxman:k')).toMatchObject({ kind: 'target', typed: 'k' });
  });
});

describe('linkCompletionContext: paren (](...)', () => {
  it('fires on `](` and on a typed prefix of the scheme', () => {
    expect(ctx('[text](')).toEqual({ kind: 'paren', start: 7, typed: '' });
    expect(ctx('[text](ctx')).toEqual({ kind: 'paren', start: 7, typed: 'ctx' });
    expect(ctx('[text](CTXMAN')).toEqual({ kind: 'paren', start: 7, typed: 'CTXMAN' });
  });

  it('stays quiet for other destinations', () => {
    expect(ctx('[text](./x.md')).toBeNull();
    expect(ctx('[text](/x.md')).toBeNull();
    expect(ctx('[text](https://a')).toBeNull();
    expect(ctx('[text](x y')).toBeNull();
  });
});

describe('linkCompletionContext: wiki ([[)', () => {
  it('fires on `[[` and replaces the brackets too', () => {
    expect(ctx('[[')).toEqual({ kind: 'wiki', start: 0, typed: '' });
    expect(ctx('see [[Write')).toEqual({ kind: 'wiki', start: 4, typed: 'Write' });
    expect(ctx('see [[Write AGENTS')).toEqual({ kind: 'wiki', start: 4, typed: 'Write AGENTS' });
  });

  it('uses the last `[[` and stops at a closing bracket', () => {
    expect(ctx('[[a]] and [[b')).toEqual({ kind: 'wiki', start: 10, typed: 'b' });
    expect(ctx('[[done]]')).toBeNull();
  });

  it('never fires on a bare `[` (task lists, footnotes, links)', () => {
    expect(ctx('- [')).toBeNull();
    expect(ctx('- [ ')).toBeNull();
    expect(ctx('text[^1')).toBeNull();
    expect(ctx('[link')).toBeNull();
    expect(ctx('')).toBeNull();
    expect(ctx('plain text')).toBeNull();
  });
});

describe('linkCompletionContext: word (Ctrl+Space)', () => {
  it('only fires when explicit and replaces the word before the cursor', () => {
    expect(ctx('plain wri')).toBeNull();
    expect(ctx('plain wri', true)).toEqual({ kind: 'word', start: 6, typed: 'wri' });
    expect(ctx('plain ', true)).toEqual({ kind: 'word', start: 6, typed: '' });
    expect(ctx('', true)).toEqual({ kind: 'word', start: 0, typed: '' });
    expect(ctx('a task-list', true)).toEqual({ kind: 'word', start: 2, typed: 'task-list' });
  });

  it('keeps the specific kinds when explicit', () => {
    expect(ctx('ctxman:k', true)?.kind).toBe('target');
    expect(ctx('](', true)?.kind).toBe('paren');
    expect(ctx('[[x', true)?.kind).toBe('wiki');
  });
});

describe('escapeLinkText / markdownLink', () => {
  it('escapes backslash and both square brackets', () => {
    expect(escapeLinkText('a[b]\\c')).toBe('a\\[b\\]\\\\c');
    expect(escapeLinkText('plain')).toBe('plain');
  });

  it('gives the same output as templates.ts linkText (checked through a planned entry)', () => {
    const title = 'a[b]\\c';
    const files = planNewEntry('kb', 'x', { title, description: 'd', now: new Date() });
    const index = files.find((f) => f.relPath === 'kb/x/index.md');
    expect(index?.content).toContain(`[${escapeLinkText(title)}](/main.md)`);
  });

  it('writes [Title](ctxman:ds/slug) with the title escaped', () => {
    expect(markdownLink('Write AGENTS.md', 'task', 'write-agents-md')).toBe(
      '[Write AGENTS.md](ctxman:task/write-agents-md)',
    );
    expect(markdownLink('A [draft]', 'kb', 'a')).toBe('[A \\[draft\\]](ctxman:kb/a)');
  });
});

describe('linkInsertText / linkFilterText', () => {
  const e = { dataset: 'task', slug: 'write-agents-md', title: 'Write AGENTS.md' };

  it('target inserts ds/slug', () => {
    expect(linkInsertText('target', e, '')).toBe('task/write-agents-md');
    expect(linkFilterText('target', e)).toBe('task/write-agents-md Write AGENTS.md');
  });

  it('paren inserts ctxman:ds/slug and closes the parenthesis unless one follows', () => {
    expect(linkInsertText('paren', e, '')).toBe('ctxman:task/write-agents-md)');
    expect(linkInsertText('paren', e, ' more')).toBe('ctxman:task/write-agents-md)');
    expect(linkInsertText('paren', e, ') more')).toBe('ctxman:task/write-agents-md');
    expect(linkFilterText('paren', e)).toBe('ctxman:task/write-agents-md Write AGENTS.md');
  });

  it('wiki and word insert the whole link', () => {
    const link = '[Write AGENTS.md](ctxman:task/write-agents-md)';
    expect(linkInsertText('wiki', e, '')).toBe(link);
    expect(linkInsertText('word', e, ')')).toBe(link);
    expect(linkFilterText('wiki', e)).toBe('[[Write AGENTS.md task/write-agents-md');
    expect(linkFilterText('word', e)).toBe('Write AGENTS.md task/write-agents-md');
  });

  it('filter texts begin with what is already in the replaced range', () => {
    // paren: the range is the scheme prefix the user typed; wiki: the range includes the `[[`
    expect(linkFilterText('paren', e).startsWith('ctxman:')).toBe(true);
    expect(linkFilterText('wiki', e).startsWith('[[')).toBe(true);
    // target: the range is the slug part, which is also the start of the text
    expect(linkFilterText('target', e).startsWith('task/write')).toBe(true);
  });
});
