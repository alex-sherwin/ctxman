import { afterEach, describe, expect, it } from 'vitest';
import {
  checkOkf,
  classifyOkfPath,
  listBundles,
  maskMarkdownCode,
  parseFrontmatter,
  parseFrontmatterLoose,
  splitFrontmatter,
  validateOkfFile,
} from '../../src/lib/okf.ts';
import { exitCode, formatReport, toReport } from '../../src/lib/findings.ts';
import type { Finding } from '../../src/lib/findings.ts';
import { byRule, ruleIds, trackTemp, validKbBundle } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('splitFrontmatter', () => {
  it('splits raw frontmatter from the body and reports the body start line', () => {
    const r = splitFrontmatter('---\ntype: A\nname: b\n---\n# Hi\n');
    expect(r).toEqual({ raw: 'type: A\nname: b', body: '# Hi\n', bodyLine: 5 });
  });

  it('accepts a BOM and normalizes CRLF', () => {
    const r = splitFrontmatter('﻿---\r\ntype: A\r\n---\r\nbody\r\n');
    expect(r).toEqual({ raw: 'type: A', body: 'body\n', bodyLine: 4 });
  });

  it('returns null without an opening or closing delimiter', () => {
    expect(splitFrontmatter('# no frontmatter\n')).toBeNull();
    expect(splitFrontmatter('---\ntype: A\nno close\n')).toBeNull();
    expect(splitFrontmatter(' ---\ntype: A\n---\n')).toBeNull();
  });

  it('allows empty frontmatter and an empty body', () => {
    expect(splitFrontmatter('---\n---\n')).toEqual({ raw: '', body: '', bodyLine: 3 });
    expect(splitFrontmatter('---\na: 1\n---')).toEqual({ raw: 'a: 1', body: '', bodyLine: 4 });
  });
});

describe('parseFrontmatter', () => {
  it('parses a mapping and keeps unquoted dates as Date objects', () => {
    const r = parseFrontmatter('---\ntype: A\nstale_after: 2026-12-01\n---\nbody');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.data.type).toBe('A');
      expect(r.doc.data.stale_after).toBeInstanceOf(Date);
      expect(r.doc.body).toBe('body');
      expect(r.doc.bodyLine).toBe(5);
    }
  });

  it('reports missing frontmatter, YAML errors (with a line) and non-mappings', () => {
    expect(parseFrontmatter('# nope')).toMatchObject({ ok: false, error: 'missing frontmatter' });
    const bad = parseFrontmatter('---\ntype: a: b\n---\n');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error).toMatch(/mapping/i);
      expect(bad.line).toBe(2);
    }
    expect(parseFrontmatter('---\n- a\n- b\n---\n')).toMatchObject({
      ok: false,
      error: 'frontmatter is not a mapping',
    });
  });

  it('treats empty frontmatter as an empty mapping', () => {
    const r = parseFrontmatter('---\n---\nbody');
    expect(r.ok && r.doc.data).toEqual({});
  });
});

describe('parseFrontmatterLoose', () => {
  it('returns the whole source as body when there is no frontmatter', () => {
    expect(parseFrontmatterLoose('# Log\n')).toEqual({ data: {}, body: '# Log\n', bodyLine: 1 });
  });
  it('parses frontmatter and throws on bad YAML', () => {
    expect(parseFrontmatterLoose('---\nokf_version: "0.2"\n---\n# x').data).toEqual({
      okf_version: '0.2',
    });
    expect(() => parseFrontmatterLoose('---\na: b: c\n---\n')).toThrow();
  });
});

describe('classifyOkfPath', () => {
  it('index.md is the entry at the root, a nested index.md and log.md are reserved', () => {
    expect(classifyOkfPath('index.md')).toBe('root-index');
    expect(classifyOkfPath('concepts/index.md')).toBe('index');
    expect(classifyOkfPath('log.md')).toBe('log');
    expect(classifyOkfPath('a/b/log.md')).toBe('log');
    expect(classifyOkfPath('entry.md')).toBe('concept');
    expect(classifyOkfPath('concepts/search.md')).toBe('concept');
  });
});

describe('maskMarkdownCode', () => {
  it('blanks fenced and inline code while preserving length and newlines', () => {
    const src = 'a `[x](y)` b\n```\n[z](w)\n```\nend\n';
    const masked = maskMarkdownCode(src);
    expect(masked).toHaveLength(src.length);
    expect(masked.split('\n')).toHaveLength(src.split('\n').length);
    expect(masked).not.toContain('[x]');
    expect(masked).not.toContain('[z]');
    expect(masked).toContain('end');
  });
});

function conceptFindings(source: string, relPath = 'concepts/x.md') {
  return validateOkfFile({
    dataset: 'kb',
    bundle: 'demo',
    relPath,
    source,
    file: `kb/demo/${relPath}`,
  });
}

describe('validateOkfFile concept rules', () => {
  it('accepts a minimal concept', () => {
    expect(conceptFindings('---\ntype: Thing\n---\n# Hello\n')).toEqual([]);
  });

  it('okf/frontmatter: missing, unparseable, not a mapping', () => {
    expect(ruleIds(conceptFindings('# plain\n'))).toEqual(['okf/frontmatter']);
    expect(ruleIds(conceptFindings('---\ntype: a: b\n---\n'))).toEqual(['okf/frontmatter']);
    expect(ruleIds(conceptFindings('---\n- x\n---\n'))).toEqual(['okf/frontmatter']);
  });

  it('okf/type: missing, empty, non-string (once each, no schema duplicate)', () => {
    for (const fm of ['title: x', 'type: ""', 'type: 5', 'type: [a]']) {
      const found = conceptFindings(`---\n${fm}\n---\n`);
      expect(ruleIds(found)).toEqual(['okf/type']);
      expect(found).toHaveLength(1);
    }
  });

  it('okf/concept-schema: generated without at, bad status, bad sources', () => {
    const found = conceptFindings(
      '---\ntype: T\ngenerated:\n  by: x\nstatus: weird\nsources:\n  - id: a\n---\n',
    );
    expect(ruleIds(found)).toEqual(['okf/concept-schema']);
    const messages = found.map((f) => f.message).join('\n');
    expect(messages).toContain('generated.at');
    expect(messages).toContain('status');
    expect(messages).toContain('sources.0.resource');
  });

  it('okf/stale-after-format: unquoted date and YYYY-MM-DD string pass, others fail once', () => {
    expect(conceptFindings('---\ntype: T\nstale_after: 2026-12-01\n---\n')).toEqual([]);
    expect(conceptFindings('---\ntype: T\nstale_after: "2026-12-01"\n---\n')).toEqual([]);
    for (const value of [
      '"soon"',
      '"2026-13-01"',
      '"12/01/2026"',
      '20261201',
      '2026-12-01T10:30:00Z',
    ]) {
      const found = conceptFindings(`---\ntype: T\nstale_after: ${value}\n---\n`);
      expect(ruleIds(found)).toEqual(['okf/stale-after-format']);
      expect(found[0]?.line).toBe(3);
    }
  });

  it('okf/footnote-source: undefined footnote warns, sources id and definitions satisfy it', () => {
    const found = conceptFindings(
      '---\ntype: T\nsources:\n  - id: spec\n    resource: https://x.test\n---\nA[^spec] B[^note] C[^lost] D[^lost]\n\n[^note]: text\n\n`[^code]`\n',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      severity: 'warning',
      rule: 'okf/footnote-source',
      line: 7,
    });
    expect(found[0]?.message).toContain('[^lost]');
  });

  it('accepts CRLF files with a BOM and still ignores code fences', () => {
    const source =
      '\uFEFF---\r\ntype: T\r\n---\r\n# Hi\r\n```\r\nA[^ignored]\r\n```\r\nText[^real]\r\n\r\n[^real]: ok\r\n';
    expect(conceptFindings(source)).toEqual([]);
  });

  it('includes file and 1-based line of the offending key', () => {
    const found = conceptFindings('---\ntitle: x\ntype: 5\n---\n');
    expect(found[0]).toMatchObject({ file: 'kb/demo/concepts/x.md', line: 3 });
  });
});

describe('validateOkfFile index.md rules', () => {
  const entry = (fm: string) =>
    validateOkfFile({
      dataset: 'task',
      bundle: 'demo',
      relPath: 'index.md',
      source: `---\n${fm}\n---\n`,
      file: 'task/demo/index.md',
    });

  it('passes a valid lifecycle entry', () => {
    expect(
      entry('okf_version: "0.2"\ntype: Task\nname: demo\ndescription: d\nstate: pending'),
    ).toEqual([]);
  });

  it('okf/entry-schema: one finding per schema issue as "path: message"', () => {
    const found = entry('okf_version: "0.2"\ntype: Task\nname: demo\nstate: done');
    expect(ruleIds(found)).toEqual(['okf/entry-schema']);
    const messages = found.map((f) => f.message);
    expect(messages.some((m) => m.startsWith('description:'))).toBe(true);
    expect(messages.some((m) => m.startsWith('state:'))).toBe(true);
  });

  it('okf/name-mismatch and okf/type-mismatch', () => {
    const found = entry(
      'okf_version: "0.2"\ntype: Weird\nname: other\ndescription: d\nstate: pending',
    );
    expect(ruleIds(found)).toEqual(['okf/name-mismatch', 'okf/type-mismatch']);
    expect(byRule(found, 'okf/type-mismatch')[0]?.severity).toBe('warning');
    expect(byRule(found, 'okf/name-mismatch')[0]?.severity).toBe('error');
  });

  it('only the bundle-root index.md is the entry (a nested index.md is navigation, any other file a concept)', () => {
    const found = validateOkfFile({
      dataset: 'task',
      bundle: 'demo',
      relPath: 'concepts/entry.md',
      source: '---\ntype: Note\n---\n',
      file: 'task/demo/concepts/entry.md',
    });
    expect(found).toEqual([]);
  });
});

describe('validateOkfFile reserved files', () => {
  const run = (relPath: string, source: string) =>
    validateOkfFile({ dataset: 'kb', bundle: 'demo', relPath, source, file: `kb/demo/${relPath}` });

  const rootIndex = (fm: string) => run('index.md', `---\n${fm}\n---\n# Index\n`);

  it('root index.md (the entry): okf_version "0.2" first, no finding for a valid kb entry', () => {
    expect(
      rootIndex('okf_version: "0.2"\ntype: Knowledge Base\nname: demo\ndescription: d'),
    ).toEqual([]);
  });

  it('okf/index-version: a root index.md without okf_version is a warning', () => {
    const found = rootIndex('type: Knowledge Base\nname: demo\ndescription: d');
    expect(found.map((f) => [f.rule, f.severity])).toEqual([['okf/index-version', 'warning']]);
  });

  it('root index.md without frontmatter is okf/frontmatter', () => {
    expect(ruleIds(run('index.md', '# Index\n'))).toEqual(['okf/frontmatter']);
  });

  it('okf/index-frontmatter: wrong or non-string version (once, no schema duplicate)', () => {
    for (const version of ['"0.3"', '0.2']) {
      const found = rootIndex(
        `okf_version: ${version}\ntype: Knowledge Base\nname: demo\ndescription: d`,
      );
      expect(ruleIds(found)).toEqual(['okf/index-frontmatter']);
      expect(found[0]?.severity).toBe('error');
    }
    expect(ruleIds(rootIndex('a: b: c'))).toEqual(['okf/frontmatter']);
  });

  it('okf/reserved-frontmatter: nested index.md and any log.md with frontmatter', () => {
    expect(ruleIds(run('concepts/index.md', '---\ntype: T\n---\n'))).toEqual([
      'okf/reserved-frontmatter',
    ]);
    expect(ruleIds(run('concepts/index.md', '---\nokf_version: "0.2"\n---\n'))).toEqual([
      'okf/reserved-frontmatter',
    ]);
    expect(ruleIds(run('log.md', '---\ntype: T\n---\n## 2026-01-01\n'))).toEqual([
      'okf/reserved-frontmatter',
    ]);
    expect(run('concepts/index.md', '# Concepts\n')).toEqual([]);
  });

  it('okf/log-heading: dated headings only; code fences and deeper headings are ignored', () => {
    const ok = run(
      'log.md',
      '# Log\n\n## 2026-02-01\n* x\n\n```\n## not a date\n```\n\n### detail\n\n## 2026-01-01\n',
    );
    expect(ok).toEqual([]);
    const bad = run('log.md', '# Log\n\n## Tuesday\n\n## 2026-02-30\n');
    expect(bad.map((f) => f.rule)).toEqual(['okf/log-heading', 'okf/log-heading']);
    expect(bad.map((f) => f.line)).toEqual([3, 5]);
  });

  it('okf/log-order: warns when dates are not strictly newest-first', () => {
    const found = run('log.md', '## 2026-01-01\n\n## 2026-02-01\n\n## 2026-02-01\n');
    expect(found.map((f) => [f.rule, f.severity, f.line])).toEqual([
      ['okf/log-order', 'warning', 3],
      ['okf/log-order', 'warning', 5],
    ]);
  });
});

describe('checkOkf', () => {
  it('yields no findings for a clean bundle and counts files', async () => {
    const dir = tmp.make(validKbBundle());
    const result = await checkOkf(dir);
    expect(result.findings).toEqual([]);
    expect(result.filesChecked).toBe(3);
  });

  it('treats a missing data dir as empty', async () => {
    expect(await checkOkf('/definitely/not/here')).toEqual({ findings: [], filesChecked: 0 });
  });

  it('fires every rule id on a crafted tree', async () => {
    const dir = tmp.make({
      // bundle-level
      'kb/README.md': 'stray\n',
      'kb/Bad_Name/index.md': '---\ntype: Knowledge Base\nname: Bad_Name\ndescription: d\n---\n',
      'kb/no-index/concepts/x.md': '---\ntype: T\n---\n',
      'kb/no-version/index.md':
        '---\ntype: Knowledge Base\nname: no-version\ndescription: d\n---\n',
      'kb/.hidden/ignored.md': 'not checked',
      // file-level
      'kb/crafted/index.md':
        '---\nokf_version: "0.3"\ntype: Weird\nname: not-crafted\ndescription: d\nstale_after: soon\ngenerated:\n  by: x\n---\nText[^lost]\n',
      'kb/crafted/concepts/no-fm.md': '# nothing\n',
      'kb/crafted/concepts/no-type.md': '---\ntitle: x\n---\n',
      'kb/crafted/concepts/index.md': '---\ntype: T\n---\n',
      'kb/crafted/log.md': '## nope\n\n## 2026-01-01\n\n## 2026-02-01\n',
      'task/crafted/index.md': '---\ntype: Task\nname: crafted\ndescription: d\nstate: nope\n---\n',
    });
    const { findings } = await checkOkf(dir);
    const rules = ruleIds(findings);
    for (const rule of [
      'okf/stray-file',
      'okf/bad-bundle-name',
      'okf/index-version',
      'okf/missing-index',
      'okf/frontmatter',
      'okf/type',
      'okf/concept-schema',
      'okf/entry-schema',
      'okf/name-mismatch',
      'okf/type-mismatch',
      'okf/stale-after-format',
      'okf/footnote-source',
      'okf/index-frontmatter',
      'okf/reserved-frontmatter',
      'okf/log-heading',
      'okf/log-order',
    ]) {
      expect(rules, rule).toContain(rule);
    }
    // never reaches into dot-directories
    expect(findings.some((f) => f.file.includes('.hidden'))).toBe(false);
    // finding paths are data-dir relative posix
    expect(byRule(findings, 'okf/missing-index').map((f) => f.file)).toContain('kb/no-index');
    expect(byRule(findings, 'okf/missing-index')[0]?.severity).toBe('error');
    expect(byRule(findings, 'okf/index-version').map((f) => f.file)).toContain(
      'kb/no-version/index.md',
    );
    expect(byRule(findings, 'okf/stray-file')[0]?.file).toBe('kb/README.md');
  });

  it('lists bundle directories sorted, skipping files and dot-dirs', async () => {
    const dir = tmp.make({
      'kb/b/index.md': '',
      'kb/a/index.md': '',
      'kb/.git/x': '',
      'kb/file.md': '',
    });
    expect(await listBundles('kb', dir)).toEqual(['a', 'b']);
    expect(await listBundles('task', dir)).toEqual([]);
  });
});

describe('findings report', () => {
  const f = (severity: Finding['severity'], rule: string, file: string, line?: number): Finding =>
    line === undefined
      ? { severity, rule, file, message: 'm' }
      : { severity, rule, file, line, message: 'm' };

  it('sorts by file, line, rule and counts errors and warnings', () => {
    const report = toReport(
      [
        f('warning', 'b/rule', 'kb/b/index.md', 3),
        f('error', 'a/rule', 'kb/b/index.md', 3),
        f('error', 'z/rule', 'kb/a/index.md', 9),
        f('error', 'z/rule', 'kb/a/index.md'),
      ],
      4,
    );
    expect(report.findings.map((x) => [x.file, x.line, x.rule])).toEqual([
      ['kb/a/index.md', undefined, 'z/rule'],
      ['kb/a/index.md', 9, 'z/rule'],
      ['kb/b/index.md', 3, 'a/rule'],
      ['kb/b/index.md', 3, 'b/rule'],
    ]);
    expect(report).toMatchObject({ ok: false, errors: 3, warnings: 1, filesChecked: 4 });
    expect(exitCode(report)).toBe(1);
  });

  it('warnings alone keep ok true and exit code 0', () => {
    const report = toReport([f('warning', 'w/rule', 'x.md')]);
    expect(report).toMatchObject({ ok: true, errors: 0, warnings: 1 });
    expect(exitCode(report)).toBe(0);
  });

  it('formats finding lines and a summary', () => {
    const text = formatReport(
      'OKF',
      toReport(
        [
          f('error', 'okf/type', 'kb/x/index.md', 2),
          f('warning', 'okf/stray-file', 'kb/README.md'),
        ],
        5,
      ),
    );
    expect(text.split('\n')).toEqual([
      'WARN  okf/stray-file kb/README.md m',
      'ERROR okf/type kb/x/index.md:2 m',
      'OKF: 1 errors, 1 warnings (5 files)',
    ]);
    expect(formatReport('Links', toReport([], 12))).toBe('Links: OK (12 files)');
    expect(formatReport('Links', toReport([]))).toBe('Links: OK');
  });
});
