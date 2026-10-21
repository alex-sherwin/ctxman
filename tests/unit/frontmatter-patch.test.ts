import { describe, expect, it } from 'vitest';
import {
  modifiedStamp,
  patchFrontmatter,
  stampModified,
  stripFrontmatter,
  trimLeadingBlankLines,
} from '../../src/lib/frontmatter-patch.ts';
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

  it('quotes a date-time to the second (the timestamp tag would read a Date back), not a bare date', () => {
    const out = patched('---\ntype: T\n---\n', {
      resolved: '2026-10-19T14:30:05+02:00',
      stale_after: '2027-01-01',
      title: '2026-10-19T14:30',
    });
    expect(out).toContain('\nresolved: "2026-10-19T14:30:05+02:00"\n');
    expect(out).toContain('\nstale_after: 2027-01-01\n');
    expect(out).toContain('\ntitle: 2026-10-19T14:30\n');
    const parsed = parseFrontmatter(out);
    expect(parsed.ok && parsed.doc.data.resolved).toBe('2026-10-19T14:30:05+02:00');
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

  it('places time (a flow list) after tags and resolved after time', () => {
    expect(
      patched(base, {
        state: 'pending',
        tags: ['a'],
        time: ['PT1H', 'PT1H'],
        resolved: '2026-10-19',
      }),
    ).toBe(
      '---\ntype: Task\nname: n\ndescription: d\nstate: pending\ntags: [a]\ntime: [PT1H, PT1H]\nresolved: 2026-10-19\ngenerated:\n  by: x\n---\nbody\n',
    );
    expect(patched(base, { resolved: '2026-10-19' })).toBe(
      '---\ntype: Task\nname: n\ndescription: d\nresolved: 2026-10-19\ngenerated:\n  by: x\n---\nbody\n',
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

describe('stampModified', () => {
  const NOW = new Date(Date.UTC(2026, 9, 20, 14, 3, 12, 987));
  const LINE = 'modified: "2026-10-20T14:03:12Z"';

  it('formats UTC to the second with a Z', () => {
    expect(modifiedStamp(NOW)).toBe('2026-10-20T14:03:12Z');
    expect(modifiedStamp(new Date('2026-01-02T03:04:05.000+02:00'))).toBe('2026-01-02T01:04:05Z');
  });

  it('appends the quoted key at the end of the frontmatter, every other byte unchanged', () => {
    const source = '---\ntype: Guide\ntags: [a,  b]   # keep\n---\n\n# Title\n';
    expect(stampModified(source, NOW)).toBe(
      `---\ntype: Guide\ntags: [a,  b]   # keep\n${LINE}\n---\n\n# Title\n`,
    );
  });

  it('keeps blank lines before the closing line below the new key', () => {
    expect(stampModified('---\ntype: Guide\n\n---\nBody\n', NOW)).toBe(
      `---\ntype: Guide\n${LINE}\n\n---\nBody\n`,
    );
  });

  it('replaces an existing modified in place (quoted, unquoted or a block value)', () => {
    const before = '---\ntype: Guide\nmodified: "2020-01-01T00:00:00Z"\nname: x\n---\nBody\n';
    expect(stampModified(before, NOW)).toBe(`---\ntype: Guide\n${LINE}\nname: x\n---\nBody\n`);
    const plain = '---\nmodified: 2020-01-01T00:00:00Z # old\ntype: Guide\n---\n';
    expect(stampModified(plain, NOW)).toBe(`---\n${LINE}\ntype: Guide\n---\n`);
    const block = '---\nmodified:\n  - a\n  - b\ntype: Guide\n---\n';
    expect(stampModified(block, NOW)).toBe(`---\n${LINE}\ntype: Guide\n---\n`);
  });

  it('is idempotent for the same time and moves forward with a later one', () => {
    const once = stampModified('---\ntype: Guide\n---\n', NOW);
    expect(stampModified(once, NOW)).toBe(once);
    expect(stampModified(once, new Date(NOW.getTime() + 61_000))).toBe(
      '---\ntype: Guide\nmodified: "2026-10-20T14:04:13Z"\n---\n',
    );
  });

  it('reads back as the string that was written (not a Date)', () => {
    const parsed = parseFrontmatter(stampModified('---\ntype: Guide\n---\n# T\n', NOW));
    expect(parsed.ok && parsed.doc.data.modified).toBe('2026-10-20T14:03:12Z');
  });

  it('keeps CRLF line endings and a BOM', () => {
    const source = '\uFEFF---\r\ntype: Guide\r\n---\r\n# T\r\n';
    expect(stampModified(source, NOW)).toBe(
      `\uFEFF---\r\ntype: Guide\r\n${LINE}\r\n---\r\n# T\r\n`,
    );
  });

  it('gives an empty frontmatter block the key', () => {
    expect(stampModified('---\n---\n# T\n', NOW)).toBe(`---\n${LINE}\n---\n# T\n`);
  });

  it('returns text without frontmatter, or with frontmatter that is not a usable mapping, unchanged', () => {
    for (const source of [
      '# No frontmatter\n',
      '',
      '---\ntype: Guide\n# never closed\n',
      '---\n- a\n- b\n---\n# list\n',
      '---\ntype: [unclosed\n---\n',
      '---\ntype: A\ntype: B\n---\n',
      'Text first\n---\ntype: Guide\n---\n',
    ]) {
      expect(stampModified(source, NOW)).toBe(source);
    }
  });
});

describe('stripFrontmatter / trimLeadingBlankLines', () => {
  it('drops the frontmatter block and the blank lines after it', () => {
    expect(stripFrontmatter('---\ntype: Guide\nname: x\n---\n\n# Title\n\nText.\n')).toBe(
      '# Title\n\nText.\n',
    );
    expect(stripFrontmatter('---\ntype: Guide\n---\n# Title\n')).toBe('# Title\n');
  });

  it('keeps a thematic break and later --- lines of the body', () => {
    expect(stripFrontmatter('---\na: 1\n---\nA\n\n---\n\nB\n')).toBe('A\n\n---\n\nB\n');
  });

  it('keeps CRLF, drops a BOM; a frontmatter-only file copies as empty text', () => {
    expect(stripFrontmatter('\uFEFF---\r\na: 1\r\n---\r\n\r\n# T\r\n')).toBe('# T\r\n');
    expect(stripFrontmatter('---\na: 1\n---')).toBe('');
    expect(stripFrontmatter('---\na: 1\n---\n')).toBe('');
  });

  it('text without a closed frontmatter block loses only a BOM and its leading blank lines', () => {
    expect(stripFrontmatter('\n\n# Log\n\n## 2026-10-20\n')).toBe('# Log\n\n## 2026-10-20\n');
    expect(stripFrontmatter('\uFEFF# T\n')).toBe('# T\n');
    expect(stripFrontmatter('---\nnot closed\n')).toBe('---\nnot closed\n');
    expect(stripFrontmatter('')).toBe('');
  });

  it('trimLeadingBlankLines removes whitespace-only lines only', () => {
    expect(trimLeadingBlankLines(' \t\n\r\n  indented\n')).toBe('  indented\n');
    expect(trimLeadingBlankLines('x\n\n')).toBe('x\n\n');
  });
});
