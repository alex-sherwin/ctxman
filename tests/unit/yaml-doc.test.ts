import { describe, expect, it } from 'vitest';
import { contextSchema, recipeSchema, referenceSchema } from '../../src/datasets/schemas.ts';
import { parseYamlDoc } from '../../src/lib/yaml-doc.ts';

describe('parseYamlDoc (reference)', () => {
  const parse = (text: string, expectedName?: string) =>
    parseYamlDoc(text, referenceSchema, expectedName === undefined ? {} : { expectedName });

  it('accepts a valid reference and fills the defaults', () => {
    const r = parse('name: r\ndescription: d\ntype: local-repo\npath: ~/x\nowner: me\n', 'r');
    expect(r).toEqual({
      ok: true,
      doc: { name: 'r', description: 'd', tags: [], type: 'local-repo', path: '~/x', owner: 'me' },
    });
  });

  it('positions a bad uri on its value; the strict uri rule is a custom predicate (the JSON Schema pattern is a hint)', () => {
    const r = parse(
      ['name: r', 'description: d', 'type: remote-repo', 'uri: nope', 'owner: me', ''].join('\n'),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({
        line: 4,
        column: 6,
        endLine: 4,
        endColumn: 10,
        source: 'schema',
        coveredBySchema: false,
      });
      expect(r.issues[0]!.message.startsWith('uri: ')).toBe(true);
    }
  });

  it("points the other variant's key out as unrecognized", () => {
    const r = parse(
      'name: r\ndescription: d\ntype: remote-repo\nuri: git@github.com:o/r.git\npath: /x\nowner: me\n',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]).toMatchObject({ line: 5, column: 1, endLine: 5, endColumn: 5 });
      expect(r.issues[0]!.message).toContain('Unrecognized key "path"');
    }
  });

  it('reports an unknown type and a missing owner', () => {
    const bad = parse('name: r\ndescription: d\ntype: nope\n');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.issues[0]!.line).toBe(3);
      expect(bad.issues[0]!.message).toContain('type');
    }
    const missing = parse('name: r\ndescription: d\ntype: local-repo\npath: /x\n');
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.issues.some((i) => i.message.startsWith('owner: '))).toBe(true);
    }
  });

  it('refuses a changed name only when expectedName is given', () => {
    const text = 'name: other\ndescription: d\ntype: local-repo\npath: /x\nowner: me\n';
    expect(parse(text).ok).toBe(true);
    const r = parse(text, 'r');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues).toHaveLength(1);
      expect(r.issues[0]).toMatchObject({ line: 1, column: 7, coveredBySchema: false });
      expect(r.issues[0]!.message).toBe('name must stay "r" (rename isn\'t supported)');
    }
  });

  it('supports a custom name message and syntax errors first', () => {
    const r = parseYamlDoc('name: other\n', referenceSchema, {
      expectedName: 'r',
      nameMessage: (n) => `keep ${n}`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message)).toContain('keep r');

    const syntax = parse('name: r\ndescription: [oops\n');
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) {
      expect(syntax.issues.every((i) => i.source === 'yaml' && i.coveredBySchema)).toBe(true);
    }
  });
});

describe('parseYamlDoc (context, recipe)', () => {
  it('context: a duplicate link is not covered by the JSON Schema', () => {
    const r = parseYamlDoc(
      'name: c\ndescription: d\nlinks:\n  - {dataset: kb, slug: x}\n  - {dataset: kb, slug: x}\n',
      contextSchema,
      { expectedName: 'c' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]).toMatchObject({ line: 5, source: 'schema', coveredBySchema: false });
    }
  });

  it('recipe: positions a nested problem and keeps unspecified defaults', () => {
    const ok = parseYamlDoc('name: r\ndescription: d\n', recipeSchema, { expectedName: 'r' });
    expect(ok.ok).toBe(true);
    if (ok.ok)
      expect(ok.doc).toMatchObject({ target: 'claude-code', layout: 'grouped', contexts: [] });

    const bad = parseYamlDoc(
      'name: r\ndescription: d\ntarget: vim\ncontexts: [A B]\n',
      recipeSchema,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      const lines = bad.issues.map((i) => i.line);
      expect(lines).toEqual([...lines].sort((a, b) => a - b));
      expect(bad.issues[0]).toMatchObject({ line: 3, column: 9 });
      expect(bad.issues.some((i) => i.line === 4)).toBe(true);
    }
  });

  it('treats an empty document and a non-mapping root as invalid, never a crash', () => {
    for (const text of ['', '- a\n- b\n', '42\n']) {
      const r = parseYamlDoc(text, referenceSchema);
      expect(r.ok).toBe(false);
      if (!r.ok) for (const i of r.issues) expect(i.endColumn).toBeGreaterThan(i.column);
    }
  });
});
