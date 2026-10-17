import { afterEach, describe, expect, it } from 'vitest';
import { checkCollections } from '../../src/lib/collections-check.ts';
import { byRule, ruleIds, trackTemp, validDataTree } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('checkCollections', () => {
  it('passes a clean data tree and counts every collection file', async () => {
    const result = await checkCollections(tmp.make(validDataTree()));
    expect(result.findings).toEqual([]);
    // kb: 4 md; task: 2 md; skill: SKILL.md; reference + context yaml
    expect(result.filesChecked).toBe(9);
  });

  it('treats a missing or empty data dir as clean', async () => {
    expect(await checkCollections('/definitely/not/here')).toEqual({
      findings: [],
      filesChecked: 0,
    });
    expect(await checkCollections(tmp.make())).toEqual({ findings: [], filesChecked: 0 });
  });

  it('okf entries: schema issues (all of them) and name mismatch', async () => {
    const dir = tmp.make({
      'idea/oops/main.md': '---\ntype: Idea\nname: different\nstate: done\n---\n',
      'bug/fine/main.md': '---\ntype: Bug\nname: fine\ndescription: d\nstate: fixed\n---\n',
    });
    const { findings } = await checkCollections(dir);
    expect(ruleIds(findings)).toEqual(['collections/name-mismatch', 'collections/schema']);
    const schema = byRule(findings, 'collections/schema').map((f) => f.message);
    expect(schema).toHaveLength(2);
    expect(schema.some((m) => m.startsWith('description:'))).toBe(true);
    expect(schema.some((m) => m.startsWith('state:'))).toBe(true);
    expect(findings.every((f) => f.file === 'idea/oops/main.md')).toBe(true);
  });

  it('okf entries: missing or broken frontmatter is a schema error', async () => {
    const dir = tmp.make({
      'kb/plain/main.md': '# no frontmatter\n',
      'kb/broken/main.md': '---\ntype: a: b\n---\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => [f.file, f.rule, f.severity])).toEqual([
      ['kb/broken/main.md', 'collections/schema', 'error'],
      ['kb/plain/main.md', 'collections/schema', 'error'],
    ]);
  });

  it('docs collection: other markdown must have mapping frontmatter and a loose schema match', async () => {
    const dir = tmp.make({
      ...validDataTree(),
      'kb/demo/concepts/tags-string.md': '---\ntype: T\ntags: not-a-list\n---\n',
      'kb/demo/concepts/bad-yaml.md': '---\ntype: [oops\n---\n',
      'kb/demo/concepts/plain.md': '# no frontmatter is fine for the docs collection\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => f.file)).toEqual([
      'kb/demo/concepts/bad-yaml.md',
      'kb/demo/concepts/tags-string.md',
    ]);
  });

  it('skills: SKILL.md required, strict keys, name must equal the directory', async () => {
    const dir = tmp.make({
      'skill/no-md/notes.txt': 'x',
      'skill/strict/SKILL.md': '---\nname: strict\ndescription: d\ntags: [a]\n---\n',
      'skill/renamed/SKILL.md': '---\nname: other\ndescription: d\n---\n',
      'skill/ok/SKILL.md':
        '---\nname: ok\ndescription: d\nlicense: MIT\nmetadata:\n  version: "1"\n---\n',
      'skill/README.md': 'stray\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => [f.file, f.rule, f.severity])).toEqual([
      ['skill/README.md', 'collections/stray-file', 'warning'],
      ['skill/no-md', 'collections/missing-skill-md', 'error'],
      ['skill/renamed/SKILL.md', 'collections/name-mismatch', 'error'],
      ['skill/strict/SKILL.md', 'collections/schema', 'error'],
    ]);
    expect(byRule(findings, 'collections/schema')[0]?.message).toContain('tags');
  });

  it('reference and context yaml: schema, name vs stem, stray non-.yaml files', async () => {
    const dir = tmp.make({
      'reference/good.yaml':
        'name: good\ndescription: d\ntype: remote-repo\nuri: https://x.test/r.git\nowner: me\n',
      'reference/wrong-type.yaml':
        'name: wrong-type\ndescription: d\ntype: local-repo\nuri: https://x.test\nowner: me\n',
      'reference/other-name.yaml':
        'name: someone-else\ndescription: d\ntype: remote-repo\nuri: git@x.test:o/r.git\nowner: me\n',
      'reference/bad-uri.yaml':
        'name: bad-uri\ndescription: d\ntype: remote-repo\nuri: u\nowner: me\n',
      'reference/old.yml': 'name: old\n',
      'reference/notes.md': 'stray',
      'reference/broken.yaml': 'name: [oops\n',
      'context/empty.yaml': '',
      'context/dup.yaml':
        'name: dup\ndescription: d\nlinks:\n  - dataset: kb\n    slug: a\n  - dataset: kb\n    slug: a\n',
      'context/.hidden.yaml': 'ignored',
    });
    const { findings } = await checkCollections(dir);
    const summary = findings.map((f) => `${f.file} ${f.rule}`);
    expect(summary).toContain('reference/old.yml collections/stray-file');
    expect(summary).toContain('reference/notes.md collections/stray-file');
    expect(summary).toContain('reference/other-name.yaml collections/name-mismatch');
    expect(summary).toContain('reference/bad-uri.yaml collections/schema');
    expect(summary).toContain('reference/wrong-type.yaml collections/schema');
    expect(summary).toContain('reference/broken.yaml collections/schema');
    expect(summary).toContain('context/empty.yaml collections/schema');
    expect(summary).toContain('context/dup.yaml collections/schema');
    expect(summary.filter((s) => s.startsWith('reference/good.yaml'))).toEqual([]);
    expect(findings.some((f) => f.file.includes('.hidden'))).toBe(false);
    const stray = byRule(findings, 'collections/stray-file');
    expect(stray.every((f) => f.severity === 'warning')).toBe(true);
    expect(stray.find((f) => f.file.endsWith('.yml'))?.message).toContain('.yml');
  });

  it('dangling context links are warnings only (never errors)', async () => {
    const dir = tmp.make({
      ...validDataTree(),
      'context/dangling.yaml':
        'name: dangling\ndescription: d\nlinks:\n  - dataset: kb\n    slug: demo\n  - dataset: kb\n    slug: gone\n  - dataset: skill\n    slug: missing-skill\n  - dataset: reference\n    slug: nope\n  - dataset: task\n    slug: do-it\n',
    });
    const { findings } = await checkCollections(dir);
    expect(findings.map((f) => [f.rule, f.severity, f.message])).toEqual([
      ['collections/dangling-link', 'warning', 'link kb/gone does not exist'],
      ['collections/dangling-link', 'warning', 'link reference/nope does not exist'],
      ['collections/dangling-link', 'warning', 'link skill/missing-skill does not exist'],
    ]);
  });

  it('warns about unknown top-level directories but ignores files and dot-dirs', async () => {
    const dir = tmp.make({
      'misc/x.md': 'hello',
      '.git/config': '',
      'README.md': 'root readme',
    });
    const { findings } = await checkCollections(dir);
    expect(findings).toEqual([
      expect.objectContaining({
        rule: 'collections/unknown-dir',
        severity: 'warning',
        file: 'misc',
      }),
    ]);
  });
});
