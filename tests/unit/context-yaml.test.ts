import { describe, expect, it } from 'vitest';
import { serializeContext as serializeServer } from '../../src/lib/context-io.ts';
import { parseContextYaml, sameContext, serializeContext } from '../../src/lib/context-yaml.ts';
import type { ContextDoc } from '../../src/lib/entry-summary.ts';

const doc = (over: Partial<ContextDoc> = {}): ContextDoc => ({
  name: 'my-ctx',
  description: 'A context',
  tags: ['alpha', 'beta'],
  links: [
    { dataset: 'kb', slug: 'ctxman', notes: 'Read the overview.\nThen skim details.' },
    { dataset: 'task', slug: 'do-it' },
  ],
  ...over,
});

describe('serializeContext', () => {
  it('writes fixed key order, literal blocks for multi-line notes, and omits empty tags / blank notes', () => {
    const text = serializeContext(
      doc({
        tags: [],
        links: [
          { dataset: 'kb', slug: 'a', notes: 'line one\nline two' },
          { dataset: 'task', slug: 'b', notes: '   \n' },
          { dataset: 'bug', slug: 'c' },
        ],
      }),
    );
    expect(text).toBe(
      [
        'name: my-ctx',
        'description: A context',
        'links:',
        '  - dataset: kb',
        '    slug: a',
        '    notes: |',
        '      line one',
        '      line two',
        '  - dataset: task',
        '    slug: b',
        '  - dataset: bug',
        '    slug: c',
        '',
      ].join('\n'),
    );
  });

  it('is byte-identical to the server writer (context-io)', () => {
    for (const d of [
      doc(),
      doc({ tags: undefined }),
      doc({ links: [] }),
      doc({ links: [{ dataset: 'kb', slug: 'x', notes: 'trailing   \n\n' }] }),
      doc({ description: 'has: colon and # hash' }),
    ]) {
      expect(serializeContext(d)).toBe(serializeServer({ ...d, tags: d.tags ?? [] }));
    }
  });

  it('round-trips through parseContextYaml', () => {
    const d = doc();
    const r = parseContextYaml(serializeContext(d), 'my-ctx');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.name).toBe('my-ctx');
      expect(r.doc.tags).toEqual(['alpha', 'beta']);
      expect(r.doc.links[0]).toEqual({
        dataset: 'kb',
        slug: 'ctxman',
        notes: 'Read the overview.\nThen skim details.\n',
      });
      expect(r.doc.links[1]).toEqual({ dataset: 'task', slug: 'do-it' });
    }
  });
});

describe('parseContextYaml', () => {
  it('accepts a minimal document and fills the defaults', () => {
    const r = parseContextYaml('name: c\ndescription: d\n', 'c');
    expect(r).toEqual({ ok: true, doc: { name: 'c', description: 'd', tags: [], links: [] } });
  });

  it('maps a syntax error to a 1-based line/column', () => {
    const r = parseContextYaml('name: c\ndescription: [a\nlinks: []\n', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      const first = r.issues[0]!;
      expect(first.source).toBe('yaml');
      expect(first.line).toBeGreaterThanOrEqual(2);
      expect(first.column).toBeGreaterThanOrEqual(1);
      expect(first.endColumn).toBeGreaterThan(first.column);
      expect(first.message.length).toBeGreaterThan(0);
    }
  });

  it('reports tab indentation as a yaml error', () => {
    const r = parseContextYaml('name: c\ndescription: d\nlinks:\n\t- dataset: kb\n', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.every((i) => i.source === 'yaml')).toBe(true);
  });

  it('positions a schema problem on the offending value', () => {
    const text = [
      'name: c',
      'description: d',
      'links:',
      '  - dataset: kb',
      '    slug: Not Kebab',
      '',
    ].join('\n');
    const r = parseContextYaml(text, 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      const issue = r.issues[0]!;
      expect(issue.source).toBe('schema');
      expect(issue.line).toBe(5);
      expect(issue.column).toBe(11);
      expect(issue.endLine).toBe(5);
      expect(issue.endColumn).toBe(20);
      expect(issue.message.startsWith('links.0.slug: ')).toBe(true);
    }
  });

  it('flags an unknown dataset id', () => {
    const r = parseContextYaml(
      'name: c\ndescription: d\nlinks:\n  - dataset: nope\n    slug: x\n',
      'c',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.line).toBe(4);
      expect(r.issues[0]!.message).toContain('links.0.dataset');
    }
  });

  it('points an unknown property at its key', () => {
    const r = parseContextYaml('name: c\ndescription: d\nextra: 1\nlinks: []\n', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ line: 3, column: 1, endLine: 3, endColumn: 6 });
      expect(r.issues[0]!.message).toContain('Unrecognized key "extra"');
    }
  });

  it('says "Required" for a missing field and falls back to line 1', () => {
    const r = parseContextYaml('description: d\nlinks: []\n', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const issue = r.issues.find((i) => i.message.startsWith('name'));
      expect(issue?.message).toBe('name: Required');
      expect(issue?.line).toBe(1);
    }
  });

  it('reports a duplicate link on the second link', () => {
    const text = [
      'name: c',
      'description: d',
      'links:',
      '  - dataset: kb',
      '    slug: x',
      '  - dataset: kb',
      '    slug: x',
      '',
    ].join('\n');
    const r = parseContextYaml(text, 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]!.line).toBe(6);
      expect(r.issues[0]!.message).toContain('duplicate link kb/x');
    }
  });

  it('refuses to rename the context', () => {
    const r = parseContextYaml('name: other\ndescription: d\n', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ line: 1, column: 7, source: 'schema' });
      expect(r.issues[0]!.message).toBe('name must stay "c" (rename isn\'t supported)');
    }
  });

  it('treats an empty document as missing required fields, not a crash', () => {
    const r = parseContextYaml('', 'c');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(0);
      for (const i of r.issues) {
        expect(i.line).toBe(1);
        expect(i.endColumn).toBeGreaterThan(i.column);
      }
    }
  });

  it('rejects a non-mapping root', () => {
    const r = parseContextYaml('- a\n- b\n', 'c');
    expect(r.ok).toBe(false);
  });

  it('sorts issues by position', () => {
    const r = parseContextYaml(
      'extra: 1\nname: c\ndescription: ""\nlinks:\n  - dataset: kb\n    slug: BAD\n',
      'c',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const lines = r.issues.map((i) => i.line);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
      expect(lines.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('sameContext', () => {
  it('ignores key order and absent-vs-empty tags / notes', () => {
    const a = doc({ tags: undefined, links: [{ dataset: 'kb', slug: 'x' }] });
    const b = {
      links: [{ slug: 'x', dataset: 'kb', notes: '' }],
      tags: [],
      description: 'A context',
      name: 'my-ctx',
    } satisfies ContextDoc;
    expect(sameContext(a, b)).toBe(true);
  });

  it('detects real differences, including link order and null', () => {
    const a = doc();
    expect(sameContext(a, doc({ description: 'other' }))).toBe(false);
    expect(sameContext(a, doc({ links: [...a.links].reverse() }))).toBe(false);
    expect(sameContext(a, null)).toBe(false);
    expect(sameContext(null, null)).toBe(true);
  });
});
