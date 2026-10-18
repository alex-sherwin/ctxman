import { describe, expect, it } from 'vitest';
import { patchFrontmatter } from '../../src/lib/frontmatter-patch.ts';
import { parseFrontmatter } from '../../src/lib/okf.ts';

const BODY = '\n# Title\n\nBody text with `code` and a [link](/x.md).\n';

/** A realistic frontmatter: comments, a folded scalar, a flow seq, a timestamp, unknown keys. */
const RICH = [
  '---',
  'type: Task',
  '# the name of the task',
  'name: write-it',
  'title: Write it',
  'description: >-',
  '  A folded',
  '  description.',
  'state: complete   # done already',
  'tags: [docs,   agents]',
  'x-custom: {a: 1,  b: [2,3]}',
  'generated:',
  '  by: claude-code/seed',
  '  at: 2026-10-17T11:20:00Z',
  '# trailing comment',
  '---',
].join('\n');

const RICH_SOURCE = RICH + '\n' + BODY;

function patched(source: string, changes: Record<string, unknown>): string {
  const result = patchFrontmatter(source, changes);
  if (!result.ok) throw new Error(result.error);
  return result.source;
}

function lines(text: string): string[] {
  return text.split('\n');
}

describe('patchFrontmatter: untouched bytes', () => {
  it('replaces one value and leaves every other line, comment and the body identical', () => {
    const out = patched(RICH_SOURCE, { state: 'pending' });
    const expected = RICH_SOURCE.replace('state: complete   # done already', 'state: pending');
    expect(out).toBe(expected);
    // folded scalar, odd flow spacing, timestamp with Z and the unknown flow map survive byte for byte.
    for (const keep of [
      'description: >-\n  A folded\n  description.\n',
      'tags: [docs,   agents]',
      'x-custom: {a: 1,  b: [2,3]}',
      'at: 2026-10-17T11:20:00Z',
      '# the name of the task',
      '# trailing comment',
    ]) {
      expect(out).toContain(keep);
    }
    expect(out.endsWith(BODY)).toBe(true);
  });

  it('replacing a folded scalar replaces the whole block and nothing else', () => {
    const out = patched(RICH_SOURCE, { description: 'One line now.' });
    expect(out).toBe(
      RICH_SOURCE.replace(
        'description: >-\n  A folded\n  description.\n',
        'description: One line now.\n',
      ),
    );
  });

  it('replacing a block mapping (generated) removes all of its lines', () => {
    const out = patched(RICH_SOURCE, { generated: 'x' });
    expect(out).toBe(
      RICH_SOURCE.replace(
        'generated:\n  by: claude-code/seed\n  at: 2026-10-17T11:20:00Z',
        'generated: x',
      ),
    );
  });

  it('reports no change and returns the source as is when the patch is empty or deletes a missing key', () => {
    expect(patchFrontmatter(RICH_SOURCE, {})).toEqual({
      ok: true,
      source: RICH_SOURCE,
      changed: false,
    });
    expect(patchFrontmatter(RICH_SOURCE, { stale_after: undefined, nope: undefined })).toEqual({
      ok: true,
      source: RICH_SOURCE,
      changed: false,
    });
  });
});

describe('patchFrontmatter: set, replace, delete', () => {
  it('keeps the flow style of an existing sequence and writes the new items', () => {
    const out = patched(RICH_SOURCE, { tags: ['ctxman', 'roadmap', 'v1'] });
    expect(out).toContain('\ntags: [ctxman, roadmap, v1]\n');
    expect(out).not.toContain('docs');
  });

  it('keeps a block sequence block-style', () => {
    const source = '---\ntype: T\ntags:\n  - a\n  - b\n---\nbody\n';
    expect(patched(source, { tags: ['a', 'c'] })).toBe(
      '---\ntype: T\ntags:\n  - a\n  - c\n---\nbody\n',
    );
  });

  it('writes an empty tags list as []', () => {
    expect(patched(RICH_SOURCE, { tags: [] })).toContain('\ntags: []\n');
  });

  it('quotes values that need it and writes dates plain', () => {
    const out = patched(RICH_SOURCE, { title: 'New: title with colon', stale_after: '2027-01-01' });
    expect(out).toContain('\ntitle: "New: title with colon"\n');
    expect(out).toContain('\nstale_after: 2027-01-01\n');
    // The result is still valid frontmatter with the expected values.
    const parsed = parseFrontmatter(out);
    expect(parsed.ok && parsed.doc.data.title).toBe('New: title with colon');
  });

  it('quotes strings that look like other YAML types', () => {
    const out = patched('---\ntype: T\n---\n', { title: 'true', description: '123' });
    const parsed = parseFrontmatter(out);
    expect(parsed.ok && parsed.doc.data).toMatchObject({ title: 'true', description: '123' });
  });

  it('deletes a key together with its lines', () => {
    expect(patched(RICH_SOURCE, { tags: undefined })).toBe(
      RICH_SOURCE.replace('tags: [docs,   agents]\n', ''),
    );
    expect(patched(RICH_SOURCE, { generated: undefined })).toBe(
      RICH_SOURCE.replace('generated:\n  by: claude-code/seed\n  at: 2026-10-17T11:20:00Z\n', ''),
    );
  });

  it('deletes the last key of the frontmatter without leaving a blank line', () => {
    const source = '---\ntype: T\nname: n\nstate: pending\n---\nbody\n';
    expect(patched(source, { state: undefined })).toBe('---\ntype: T\nname: n\n---\nbody\n');
  });

  it('deleting every key leaves an empty frontmatter block', () => {
    expect(patched('---\ntype: T\n---\nbody\n', { type: undefined })).toBe('---\n---\nbody\n');
  });

  it('writes links as a block list in key order dataset, slug, rel', () => {
    const out = patched(RICH_SOURCE, {
      links: [
        { dataset: 'task', slug: 'a', rel: 'child' },
        { dataset: 'kb', slug: 'b', rel: 'related' },
      ],
    });
    expect(out).toContain(
      '\nlinks:\n  - dataset: task\n    slug: a\n    rel: child\n  - dataset: kb\n    slug: b\n    rel: related\n---\n',
    );
    const parsed = parseFrontmatter(out);
    expect(parsed.ok && parsed.doc.data.links).toEqual([
      { dataset: 'task', slug: 'a', rel: 'child' },
      { dataset: 'kb', slug: 'b', rel: 'related' },
    ]);
  });

  it('replaces an existing links block (even a flow one) with a block list', () => {
    const source = '---\ntype: T\nlinks: []\nname: n\n---\n';
    const out = patched(source, { links: [{ dataset: 'kb', slug: 'x', rel: 'related' }] });
    expect(out).toBe(
      '---\ntype: T\nlinks:\n  - dataset: kb\n    slug: x\n    rel: related\nname: n\n---\n',
    );
  });

  it('applies several changes at once', () => {
    const out = patched(RICH_SOURCE, { state: 'pending', title: undefined, tags: ['a'] });
    expect(lines(out)).toContain('state: pending');
    expect(lines(out)).toContain('tags: [a]');
    expect(out).not.toContain('title: Write it');
    expect(out).toContain('# the name of the task\nname: write-it\ndescription: >-');
  });
});

describe('patchFrontmatter: inserting new keys', () => {
  const base = '---\ntype: Task\nname: n\ndescription: d\ngenerated:\n  by: x\n---\nbody\n';

  it('places title after name, state after description, tags after state', () => {
    expect(patched(base, { title: 'T' })).toBe(
      '---\ntype: Task\nname: n\ntitle: T\ndescription: d\ngenerated:\n  by: x\n---\nbody\n',
    );
    expect(patched(base, { state: 'pending' })).toBe(
      '---\ntype: Task\nname: n\ndescription: d\nstate: pending\ngenerated:\n  by: x\n---\nbody\n',
    );
    expect(patched(base, { state: 'pending', tags: ['a', 'b'] })).toBe(
      '---\ntype: Task\nname: n\ndescription: d\nstate: pending\ntags: [a, b]\ngenerated:\n  by: x\n---\nbody\n',
    );
  });

  it('places tags after description when there is no state, and stale_after / status after tags', () => {
    expect(patched(base, { tags: ['a'], stale_after: '2027-01-01', status: 'draft' })).toBe(
      '---\ntype: Task\nname: n\ndescription: d\ntags: [a]\nstale_after: 2027-01-01\nstatus: draft\ngenerated:\n  by: x\n---\nbody\n',
    );
  });

  it('puts keys without a present anchor, and links, at the end of the frontmatter', () => {
    const source = '---\ntype: Task\nname: n\n---\nbody\n';
    expect(
      patched(source, {
        stale_after: '2027-01-01',
        links: [{ dataset: 'kb', slug: 'x', rel: 'related' }],
      }),
    ).toBe(
      '---\ntype: Task\nname: n\nstale_after: 2027-01-01\nlinks:\n  - dataset: kb\n    slug: x\n    rel: related\n---\nbody\n',
    );
  });

  it('inserts after a multi-line anchor value', () => {
    const source = '---\ntype: T\nname: n\ndescription: >-\n  folded\n  text\ngenerated: x\n---\n';
    expect(patched(source, { state: 'pending' })).toBe(
      '---\ntype: T\nname: n\ndescription: >-\n  folded\n  text\nstate: pending\ngenerated: x\n---\n',
    );
  });

  it('appends below a comment at the end and above trailing blank lines', () => {
    expect(patched('---\ntype: T\n# note\n---\n', { stale_after: '2027-01-01' })).toBe(
      '---\ntype: T\n# note\nstale_after: 2027-01-01\n---\n',
    );
    expect(patched('---\ntype: T\n\n---\n', { stale_after: '2027-01-01' })).toBe(
      '---\ntype: T\nstale_after: 2027-01-01\n\n---\n',
    );
  });

  it('fills an empty frontmatter block', () => {
    expect(patched('---\n---\nbody\n', { type: 'Task' })).toBe('---\ntype: Task\n---\nbody\n');
  });

  it('moves a key when it is deleted and its anchor-dependent key is added in the same patch', () => {
    const source = '---\ntype: T\nname: n\ndescription: d\nstate: pending\n---\n';
    expect(patched(source, { state: undefined, tags: ['a'] })).toBe(
      '---\ntype: T\nname: n\ndescription: d\ntags: [a]\n---\n',
    );
  });
});

describe('patchFrontmatter: line endings, BOM and failures', () => {
  it('keeps CRLF line endings, writing new lines with CRLF and leaving the body bytes alone', () => {
    const source = '---\r\ntype: Task\r\nname: n\r\nstate: pending\r\n---\r\n\r\nBody\r\nline\r\n';
    const out = patched(source, { state: 'complete', tags: ['a'] });
    expect(out).toBe(
      '---\r\ntype: Task\r\nname: n\r\nstate: complete\r\ntags: [a]\r\n---\r\n\r\nBody\r\nline\r\n',
    );
  });

  it('never rewrites the body even when it mixes line endings', () => {
    const body = '\nA\r\nB\nC\r\n';
    const out = patched('---\ntype: T\nstate: a\n---\n' + body, { state: 'b' });
    expect(out).toBe('---\ntype: T\nstate: b\n---\n' + body);
  });

  it('keeps a leading BOM', () => {
    const out = patched('﻿---\ntype: T\nstate: a\n---\nbody\n', { state: 'b' });
    expect(out).toBe('﻿---\ntype: T\nstate: b\n---\nbody\n');
  });

  it('accepts trailing spaces on the delimiter lines', () => {
    expect(patched('--- \ntype: T\nstate: a\n---  \nbody', { state: 'b' })).toBe(
      '--- \ntype: T\nstate: b\n---  \nbody',
    );
  });

  it('fails without frontmatter, with an unclosed block, on a duplicate key and on a non-mapping', () => {
    expect(patchFrontmatter('# just a body\n', { state: 'a' })).toEqual({
      ok: false,
      error: 'missing frontmatter',
    });
    expect(patchFrontmatter('---\ntype: T\n', { state: 'a' })).toEqual({
      ok: false,
      error: 'missing frontmatter',
    });
    expect(patchFrontmatter('', { state: 'a' })).toEqual({
      ok: false,
      error: 'missing frontmatter',
    });
    const duplicate = patchFrontmatter('---\nstate: a\nstate: b\n---\n', { state: 'c' });
    expect(duplicate.ok).toBe(false);
    expect(!duplicate.ok && duplicate.error).toMatch(/duplicate|unique/i);
    expect(patchFrontmatter('---\n- a\n- b\n---\n', { state: 'a' })).toEqual({
      ok: false,
      error: 'frontmatter is not a mapping',
    });
    const bad = patchFrontmatter('---\nstate: [a\n---\n', { state: 'a' });
    expect(bad.ok).toBe(false);
  });

  it('is idempotent: patching the result with the same changes changes nothing', () => {
    const once = patched(RICH_SOURCE, {
      state: 'pending',
      tags: ['x', 'y'],
      stale_after: '2027-01-01',
    });
    const twice = patchFrontmatter(once, {
      state: 'pending',
      tags: ['x', 'y'],
      stale_after: '2027-01-01',
    });
    expect(twice).toEqual({ ok: true, source: once, changed: false });
  });
});
