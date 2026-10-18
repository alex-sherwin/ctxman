import { afterEach, describe, expect, it } from 'vitest';
import { checkCollections } from '../../src/lib/collections-check.ts';
import { sortFindings } from '../../src/lib/findings.ts';
import { validateSkillFile } from '../../src/lib/skill-check.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const FILE = 'skill/s/SKILL.md';

describe('validateSkillFile', () => {
  it('accepts a valid SKILL.md', () => {
    const source =
      '---\nname: s\ndescription: A skill.\nlicense: MIT\nmetadata:\n  a: b\n---\n\n# S\n';
    expect(validateSkillFile(source, 's', FILE)).toEqual([]);
  });

  it('reports missing frontmatter as one collections/schema error on line 1', () => {
    expect(validateSkillFile('# S\n', 's', FILE)).toEqual([
      {
        severity: 'error',
        rule: 'collections/schema',
        file: FILE,
        line: 1,
        message: 'frontmatter: missing frontmatter',
      },
    ]);
  });

  it('reports unparsable YAML with the parse error line', () => {
    const findings = validateSkillFile('---\nname: [oops\n---\n', 's', FILE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: 'collections/schema',
      file: FILE,
    });
    expect(findings[0]?.message).toMatch(/^frontmatter: /);
    expect(findings[0]?.line).toBeGreaterThan(0);
  });

  it('reports every skillSchema issue (strict: unknown keys, missing description)', () => {
    const findings = validateSkillFile('---\nname: s\nfoo: 1\n---\n', 's', FILE);
    expect(findings.every((f) => f.rule === 'collections/schema' && f.severity === 'error')).toBe(
      true,
    );
    const messages = findings.map((f) => f.message).join('\n');
    expect(messages).toContain('foo');
    expect(messages).toContain('description');
  });

  it('reports a name that differs from the directory (also when the schema fails)', () => {
    const findings = validateSkillFile('---\nname: other\ndescription: d\n---\n', 's', FILE);
    expect(findings).toEqual([
      {
        severity: 'error',
        rule: 'collections/name-mismatch',
        file: FILE,
        message: 'name "other" must equal the directory name "s"',
      },
    ]);
    const both = validateSkillFile('---\nname: other\nfoo: 1\n---\n', 's', FILE);
    expect(both.map((f) => f.rule).sort()).toEqual([
      'collections/name-mismatch',
      'collections/schema',
      'collections/schema',
    ]);
  });

  it('matches what the compliance check reports for the same file', async () => {
    const sources = [
      '---\nname: s\ndescription: A skill.\n---\n',
      '# no frontmatter\n',
      '---\nname: other\ndescription: d\nfoo: 1\n---\n',
      '---\nname: [oops\n---\n',
      '---\ndescription: d\n---\n',
    ];
    for (const source of sources) {
      const dir = tmp.make({ [FILE]: source });
      const { findings } = await checkCollections(dir);
      const fromCheck = findings.filter((f) => f.file === FILE);
      expect(fromCheck, source).toEqual(sortFindings(validateSkillFile(source, 's', FILE)));
    }
  });
});
