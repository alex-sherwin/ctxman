import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_TEXT_BYTES } from '../../src/lib/bundles.ts';
import {
  addConceptToIndex,
  addCreateToLog,
  appendLog,
  appendLogEntry,
  createDoc,
  deleteDoc,
  DocIoError,
  isDocDatasetId,
  normalizeDocPath,
  readDoc,
  removeConceptFromIndex,
  validateDoc,
  writeDoc,
} from '../../src/lib/doc-io.ts';
import { ruleIds, trackTemp, validKbBundle, writeTree } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

async function failure(promise: Promise<unknown>): Promise<DocIoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DocIoError) return error;
    throw error;
  }
  throw new Error('expected a DocIoError, but the call resolved');
}

const MAIN = `---\nokf_version: "0.2"\ntype: Knowledge Base\nname: x\ndescription: A KB.\n---\n\n# X\n`;

describe('isDocDatasetId', () => {
  it('accepts the okf datasets and skill only', () => {
    for (const ds of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project', 'skill']) {
      expect(isDocDatasetId(ds), ds).toBe(true);
    }
    for (const ds of ['context', 'recipe', 'reference', 'nope', '', undefined, 3]) {
      expect(isDocDatasetId(ds), String(ds)).toBe(false);
    }
  });
});

describe('normalizeDocPath', () => {
  it('returns valid paths unchanged', () => {
    for (const ok of [
      'index.md',
      'concepts/search.md',
      'concepts/a b.md',
      'a/b/c/d.md',
      'SKILL.md',
    ]) {
      expect(normalizeDocPath(ok), ok).toBe(ok);
    }
  });

  it('rejects everything else', () => {
    const bad: (string | undefined)[] = [
      undefined,
      '',
      'a//b.md',
      './a.md',
      '../a.md',
      'a/../b.md',
      'a/./b.md',
      '.hidden/x.md',
      'a/.hidden.md',
      'a\\b.md',
      '/abs.md',
      'x.MD',
      'x.txt',
      'x',
      'a/',
      'a/b.md/',
      'a\0b.md',
      `${'a'.repeat(510)}.md`,
      '.md',
      'a/.md',
    ];
    for (const raw of bad) expect(normalizeDocPath(raw), String(raw)).toBeNull();
  });

  it('allows exactly 512 characters', () => {
    const exact = `${'a'.repeat(509)}.md`;
    expect(exact).toHaveLength(512);
    expect(normalizeDocPath(exact)).toBe(exact);
    expect(normalizeDocPath(`${exact}x`)).toBeNull();
  });
});

describe('readDoc', () => {
  it('reads a file with path, bytes, ISO lastModified and warnings', async () => {
    const dir = tmp.make({ ...validKbBundle('demo') });
    const doc = await readDoc('kb', 'demo', 'concepts/one.md', dir);
    expect(doc.dataset).toBe('kb');
    expect(doc.slug).toBe('demo');
    expect(doc.path).toBe('concepts/one.md');
    expect(doc.markdown).toBe(
      readFileSync(path.join(dir, 'kb', 'demo', 'concepts', 'one.md'), 'utf8'),
    );
    expect(doc.bytes).toBe(Buffer.byteLength(doc.markdown));
    expect(doc.lastModified).toBe(
      statSync(path.join(dir, 'kb', 'demo', 'concepts', 'one.md')).mtime.toISOString(),
    );
    expect(doc.warnings).toEqual([]);
  });

  it('counts UTF-8 bytes, not characters', async () => {
    const dir = tmp.make({ 'kb/x/index.md': `${MAIN}é€\n` });
    const doc = await readDoc('kb', 'x', 'index.md', dir);
    expect(doc.bytes).toBe(Buffer.byteLength(`${MAIN}é€\n`));
    expect(doc.bytes).toBeGreaterThan(doc.markdown.length);
  });

  it('reads SKILL.md and other skill markdown', async () => {
    const dir = tmp.make({
      'skill/s/SKILL.md': '---\nname: s\ndescription: A skill.\n---\n\n# S\n',
      'skill/s/references/x.md': '# X\n',
    });
    expect((await readDoc('skill', 's', 'SKILL.md', dir)).warnings).toEqual([]);
    expect((await readDoc('skill', 's', 'references/x.md', dir)).markdown).toBe('# X\n');
  });

  it('throws bad-dataset for non-doc datasets (message lists the allowed ids)', async () => {
    const dir = tmp.make();
    const error = await failure(readDoc('context', 'x', 'index.md', dir));
    expect(error.code).toBe('bad-dataset');
    expect(error.message).toContain('kb');
    expect(error.message).toContain('skill');
  });

  it('throws bad-slug and bad-path before touching the disk', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    expect((await failure(readDoc('kb', '../x', 'index.md', dir))).code).toBe('bad-slug');
    expect((await failure(readDoc('kb', 'X', 'index.md', dir))).code).toBe('bad-slug');
    for (const bad of [undefined, '', '../x.md', 'a\\b.md', 'x.txt', '.hidden/x.md']) {
      expect((await failure(readDoc('kb', 'x', bad, dir))).code, String(bad)).toBe('bad-path');
    }
  });

  it('throws not-found for a missing entry and a missing file', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const noEntry = await failure(readDoc('kb', 'nope', 'index.md', dir));
    expect(noEntry.code).toBe('not-found');
    expect(noEntry.message).toBe('kb entry "nope" does not exist');
    const noFile = await failure(readDoc('kb', 'x', 'concepts/nope.md', dir));
    expect(noFile.code).toBe('not-found');
    expect(noFile.message).toBe('concepts/nope.md does not exist in kb/x');
    // a directory named like a markdown file is not a file
    mkdirSync(path.join(dir, 'kb', 'x', 'dir.md'));
    expect((await failure(readDoc('kb', 'x', 'dir.md', dir))).code).toBe('not-found');
  });

  it('throws bad-path for a symlink that leaves the bundle', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN, 'outside.md': 'outside' });
    try {
      symlinkSync(path.join(dir, 'outside.md'), path.join(dir, 'kb', 'x', 'out.md'));
    } catch {
      return; // symlinks unavailable
    }
    expect((await failure(readDoc('kb', 'x', 'out.md', dir))).code).toBe('bad-path');
  });

  it('throws too-large above 512 KB and not-text for a NUL byte', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    writeFileSync(path.join(dir, 'kb', 'x', 'big.md'), 'a'.repeat(MAX_TEXT_BYTES + 1));
    writeFileSync(path.join(dir, 'kb', 'x', 'ok.md'), 'a'.repeat(MAX_TEXT_BYTES));
    writeFileSync(path.join(dir, 'kb', 'x', 'bin.md'), Buffer.from([65, 0, 66]));
    expect((await failure(readDoc('kb', 'x', 'big.md', dir))).code).toBe('too-large');
    expect((await readDoc('kb', 'x', 'ok.md', dir)).bytes).toBe(MAX_TEXT_BYTES);
    expect((await failure(readDoc('kb', 'x', 'bin.md', dir))).code).toBe('not-text');
  });
});

describe('writeDoc', () => {
  const file = (dir: string, rel = 'index.md') => path.join(dir, 'kb', 'x', ...rel.split('/'));

  it('writes the exact bytes (CRLF kept) and returns the new record', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const text =
      '---\r\nokf_version: "0.2"\r\ntype: Knowledge Base\r\nname: x\r\ndescription: Changed.\r\n---\r\n\r\n# X\r\n';
    const doc = await writeDoc('kb', 'x', 'index.md', { markdown: text }, dir);
    expect(readFileSync(file(dir), 'utf8')).toBe(text);
    expect(doc.markdown).toBe(text);
    expect(doc.bytes).toBe(Buffer.byteLength(text));
    expect(doc.path).toBe('index.md');
    expect(doc.lastModified).toBe(statSync(file(dir)).mtime.toISOString());
    expect(doc.warnings).toEqual([]);
  });

  it('keeps the file mode and leaves no temp file behind', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    if (process.platform !== 'win32') chmodSync(file(dir), 0o640);
    await writeDoc('kb', 'x', 'index.md', { markdown: `${MAIN}more\n` }, dir);
    if (process.platform !== 'win32') expect(statSync(file(dir)).mode & 0o777).toBe(0o640);
    expect(readdirSync(path.join(dir, 'kb', 'x'))).toEqual(['index.md']);
  });

  it('changes lastModified', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const old = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(file(dir), old, old);
    const before = (await readDoc('kb', 'x', 'index.md', dir)).lastModified;
    expect(before).toBe('2020-01-01T00:00:00.000Z');
    const after = await writeDoc('kb', 'x', 'index.md', { markdown: MAIN }, dir);
    expect(after.lastModified).not.toBe(before);
  });

  it('ifUnmodifiedSince equal to the current mtime writes', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const { lastModified } = await readDoc('kb', 'x', 'index.md', dir);
    const doc = await writeDoc(
      'kb',
      'x',
      'index.md',
      { markdown: `${MAIN}ok\n`, ifUnmodifiedSince: lastModified },
      dir,
    );
    expect(readFileSync(file(dir), 'utf8')).toBe(`${MAIN}ok\n`);
    expect(doc.lastModified).toBe(statSync(file(dir)).mtime.toISOString());
  });

  it('any other mtime, older or newer, is a conflict that carries the current mtime and keeps the file', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const current = new Date('2024-05-05T05:05:05.000Z');
    utimesSync(file(dir), current, current);
    for (const stale of ['2024-05-05T05:05:04.000Z', '2024-05-05T05:05:06.000Z']) {
      const error = await failure(
        writeDoc('kb', 'x', 'index.md', { markdown: 'lost', ifUnmodifiedSince: stale }, dir),
      );
      expect(error.code, stale).toBe('conflict');
      expect(error.lastModified).toBe('2024-05-05T05:05:05.000Z');
    }
    expect(readFileSync(file(dir), 'utf8')).toBe(MAIN);
    expect(readdirSync(path.join(dir, 'kb', 'x'))).toEqual(['index.md']);
  });

  it('omitting ifUnmodifiedSince writes unconditionally', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const old = new Date('2001-01-01T00:00:00.000Z');
    utimesSync(file(dir), old, old);
    await writeDoc('kb', 'x', 'index.md', { markdown: 'new\n' }, dir);
    expect(readFileSync(file(dir), 'utf8')).toBe('new\n');
  });

  it('rejects an invalid body with issues and writes nothing', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const cases: [unknown, { path: string; message: string }[]][] = [
      [null, [{ path: '', message: 'must be an object' }]],
      [[], [{ path: '', message: 'must be an object' }]],
      ['text', [{ path: '', message: 'must be an object' }]],
      [{}, [{ path: 'markdown', message: 'must be a string' }]],
      [{ markdown: 3 }, [{ path: 'markdown', message: 'must be a string' }]],
      [
        { markdown: 'x', ifUnmodifiedSince: 'yesterday' },
        [{ path: 'ifUnmodifiedSince', message: 'must be an ISO date string' }],
      ],
      [
        { markdown: 'x', ifUnmodifiedSince: 5 },
        [{ path: 'ifUnmodifiedSince', message: 'must be an ISO date string' }],
      ],
      [{ markdown: 'x', extra: 1 }, [{ path: 'extra', message: 'unexpected property' }]],
    ];
    for (const [body, issues] of cases) {
      const error = await failure(writeDoc('kb', 'x', 'index.md', body, dir));
      expect(error.code, JSON.stringify(body)).toBe('invalid');
      expect(error.issues, JSON.stringify(body)).toEqual(issues);
    }
    expect(readFileSync(file(dir), 'utf8')).toBe(MAIN);
  });

  it('rejects markdown over 512 KB (too-large) and accepts exactly 512 KB', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const error = await failure(
      writeDoc('kb', 'x', 'index.md', { markdown: 'a'.repeat(MAX_TEXT_BYTES + 1) }, dir),
    );
    expect(error.code).toBe('too-large');
    await writeDoc('kb', 'x', 'index.md', { markdown: 'a'.repeat(MAX_TEXT_BYTES) }, dir);
    expect(statSync(file(dir)).size).toBe(MAX_TEXT_BYTES);
  });

  it('uses the path checks of readDoc (no create, no traversal, no dot files)', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const body = { markdown: 'x' };
    expect((await failure(writeDoc('kb', 'x', 'new.md', body, dir))).code).toBe('not-found');
    expect((await failure(writeDoc('kb', 'nope', 'index.md', body, dir))).code).toBe('not-found');
    expect((await failure(writeDoc('kb', 'x', '../y.md', body, dir))).code).toBe('bad-path');
    expect((await failure(writeDoc('context', 'x', 'index.md', body, dir))).code).toBe(
      'bad-dataset',
    );
    expect(existsSync(file(dir, 'new.md'))).toBe(false);
  });

  it('writes through a symlinked file inside the bundle: the link stays, its target changes', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN, 'kb/x/real/target.md': 'old\n' });
    const link = file(dir, 'link.md');
    try {
      symlinkSync(file(dir, 'real/target.md'), link);
    } catch {
      return; // symlinks unavailable
    }
    await writeDoc('kb', 'x', 'link.md', { markdown: 'through the link\n' }, dir);
    expect(readFileSync(file(dir, 'real/target.md'), 'utf8')).toBe('through the link\n');
    expect(readFileSync(link, 'utf8')).toBe('through the link\n');
    // still a symlink
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(path.join(dir, 'kb', 'x', 'real'))).toEqual(['target.md']);
  });

  it('saves invalid frontmatter and reports findings as warnings', async () => {
    const dir = tmp.make({
      'task/t/index.md':
        '---\ntype: Task\nname: t\ndescription: A task.\nstate: pending\n---\n\n# T\n',
    });
    const bad = '---\ntype: Task\nname: t\ndescription: A task.\nstate: nope\n---\n\n# T\n';
    const doc = await writeDoc('task', 't', 'index.md', { markdown: bad }, dir);
    expect(readFileSync(path.join(dir, 'task', 't', 'index.md'), 'utf8')).toBe(bad);
    expect(ruleIds(doc.warnings)).toContain('okf/entry-schema');
    expect(doc.warnings.every((w) => w.file === 'task/t/index.md')).toBe(true);
    expect(doc.warnings.some((w) => w.severity === 'error')).toBe(true);
  });
});

describe('validateDoc', () => {
  it('okf: a concept without type, a bad log heading, a wrong okf_version on the entry', () => {
    expect(
      ruleIds(validateDoc('kb', 'x', 'concepts/c.md', '---\ndescription: d\n---\n# C\n')),
    ).toContain('okf/type');
    expect(
      ruleIds(validateDoc('kb', 'x', 'log.md', '# Update log\n\n## Yesterday\n* **Update**: x\n')),
    ).toContain('okf/log-heading');
    expect(
      ruleIds(
        validateDoc(
          'kb',
          'x',
          'index.md',
          '---\nokf_version: "0.3"\ntype: Knowledge Base\nname: x\ndescription: d\n---\n# I\n',
        ),
      ),
    ).toContain('okf/index-frontmatter');
  });

  it('okf: a clean file has no findings, findings carry the data-dir relative file', () => {
    expect(validateDoc('kb', 'x', 'index.md', MAIN)).toEqual([]);
    const findings = validateDoc('kb', 'x', 'concepts/c.md', 'no frontmatter');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.file === 'kb/x/concepts/c.md')).toBe(true);
  });

  it('skill: SKILL.md extra key and name mismatch; other markdown files have no rules', () => {
    const extra = validateDoc(
      'skill',
      's',
      'SKILL.md',
      '---\nname: s\ndescription: d\nfoo: 1\n---\n',
    );
    expect(ruleIds(extra)).toEqual(['collections/schema']);
    expect(extra[0]?.file).toBe('skill/s/SKILL.md');
    const mismatch = validateDoc(
      'skill',
      's',
      'SKILL.md',
      '---\nname: other\ndescription: d\n---\n',
    );
    expect(ruleIds(mismatch)).toEqual(['collections/name-mismatch']);
    expect(validateDoc('skill', 's', 'references/x.md', 'anything')).toEqual([]);
    expect(validateDoc('skill', 's', 'SKILL.md', '---\nname: s\ndescription: d\n---\n')).toEqual(
      [],
    );
  });

  it('is exercised through a full data tree', async () => {
    const dir = tmp.make();
    writeTree(dir, validKbBundle('demo'));
    const doc = await readDoc('kb', 'demo', 'index.md', dir);
    expect(doc.warnings).toEqual([]);
  });
});

describe('link findings as warnings (validateDoc / readDoc / writeDoc)', () => {
  const concept = (body: string): string => `---\ntype: Concept\n---\n${body}`;

  it('validateDoc appends the link findings of that file, resolved against the given data dir', () => {
    const dir = tmp.make({
      'task/exists/index.md':
        '---\ntype: Task\nname: exists\ndescription: d\nstate: pending\n---\n',
    });
    const source = concept(
      '[a](./nope.md) [b](ctxman:idea/e2e-nope) [c](ctxman:task/exists) [d](ctxman:Bad)\n',
    );
    const findings = validateDoc('kb', 'x', 'concepts/c.md', source, dir);
    expect(ruleIds(findings)).toEqual([
      'links/broken',
      'links/ctxman-invalid',
      'links/ctxman-target',
    ]);
    expect(findings.every((f) => f.file === 'kb/x/concepts/c.md')).toBe(true);
    const target = findings.find((f) => f.rule === 'links/ctxman-target');
    expect(target?.message).toContain('idea/e2e-nope');
    expect(target?.line).toBe(4);
  });

  it('also covers skill markdown files and index.md frontmatter relations', () => {
    const dir = tmp.make();
    expect(ruleIds(validateDoc('skill', 's', 'references/x.md', '[x](./gone.md)\n', dir))).toEqual([
      'links/broken',
    ]);
    const main =
      '---\nokf_version: "0.2"\ntype: Task\nname: x\ndescription: d\nstate: pending\nlinks:\n  - dataset: idea\n    slug: e2e-nope\n    rel: related\n---\n';
    expect(ruleIds(validateDoc('task', 'x', 'index.md', main, dir))).toEqual([
      'links/relation-target',
    ]);
  });

  it('PUT and GET return them in warnings; the save still never blocks', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN, 'kb/x/concepts/c.md': concept('# C\n') });
    const source = concept('[a](./nope.md) and [b](ctxman:idea/e2e-nope)\n');
    const saved = await writeDoc('kb', 'x', 'concepts/c.md', { markdown: source }, dir);
    expect(ruleIds(saved.warnings)).toEqual(['links/broken', 'links/ctxman-target']);
    expect(readFileSync(path.join(dir, 'kb', 'x', 'concepts', 'c.md'), 'utf8')).toBe(source);
    const read = await readDoc('kb', 'x', 'concepts/c.md', dir);
    expect(ruleIds(read.warnings)).toEqual(['links/broken', 'links/ctxman-target']);
  });
});

describe('writeDoc runs under the per-file lock', () => {
  it('serializes concurrent saves of one file: each sees the previous mtime guard', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const old = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(path.join(dir, 'kb', 'x', 'index.md'), old, old);
    const first = await readDoc('kb', 'x', 'index.md', dir);
    const results = await Promise.allSettled([
      writeDoc(
        'kb',
        'x',
        'index.md',
        { markdown: `${MAIN}one\n`, ifUnmodifiedSince: first.lastModified },
        dir,
      ),
      writeDoc(
        'kb',
        'x',
        'index.md',
        { markdown: `${MAIN}two\n`, ifUnmodifiedSince: first.lastModified },
        dir,
      ),
    ]);
    // Only one can win the optimistic check; the other waited for it and then conflicted.
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as DocIoError).code).toBe('conflict');
  });
});

describe('addConceptToIndex', () => {
  const concept = { title: 'New one', path: 'concepts/new-one.md', description: 'Brand new.' };
  const line = '[New one](/concepts/new-one.md) - Brand new.';

  it('inserts after the last list item of ## Concepts, using the section bullet', () => {
    const source =
      '---\nokf_version: "0.2"\n---\n# T\n\n## Entry\n\n* [T](/index.md) - E.\n\n## Concepts\n\n- [A](/concepts/a.md) - A.\n- [B](/concepts/b.md) - B.\n\n## Other\n\n* x\n';
    expect(addConceptToIndex(source, concept)).toBe(
      source.replace('- [B](/concepts/b.md) - B.\n', `- [B](/concepts/b.md) - B.\n- ${line}\n`),
    );
  });

  it('matches the heading case-insensitively, ignores headings in code and keeps deeper headings in the section', () => {
    const source =
      '# T\n\n```\n## Concepts\n```\n\n## CONCEPTS\n\n### Sub\n\n* [A](/concepts/a.md) - A.\n';
    expect(addConceptToIndex(source, concept)).toBe(`${source}* ${line}\n`);
  });

  it('keeps continuation lines of the last item attached', () => {
    const source = '## Concepts\n\n* [A](/concepts/a.md) - A long\n  description.\n\n## Next\n';
    expect(addConceptToIndex(source, concept)).toBe(
      '## Concepts\n\n* [A](/concepts/a.md) - A long\n  description.\n' + `* ${line}\n\n## Next\n`,
    );
  });

  it('a section without a list gets the item after the heading and one blank line', () => {
    expect(addConceptToIndex('# T\n\n## Concepts\n', concept)).toBe(
      `# T\n\n## Concepts\n\n* ${line}\n`,
    );
    expect(addConceptToIndex('# T\n\n## Concepts\n\n## Next\n', concept)).toBe(
      `# T\n\n## Concepts\n\n* ${line}\n\n## Next\n`,
    );
    expect(addConceptToIndex('# T\n## Concepts\n## Next\n', concept)).toBe(
      `# T\n## Concepts\n\n* ${line}\n\n## Next\n`,
    );
  });

  it('without the heading appends one, with exactly one blank line before it', () => {
    expect(addConceptToIndex('# T\n', concept)).toBe(`# T\n\n## Concepts\n\n* ${line}\n`);
    expect(addConceptToIndex('# T\n\n\n\n', concept)).toBe(`# T\n\n## Concepts\n\n* ${line}\n`);
    expect(addConceptToIndex('', concept)).toBe(`## Concepts\n\n* ${line}\n`);
  });

  it('uses the title as the description text when none is given, escapes link text and encodes the path', () => {
    expect(
      addConceptToIndex('## Concepts\n', { title: 'A [b] c', path: 'concepts/a b (1).md' }),
    ).toBe('## Concepts\n\n* [A \\[b\\] c](/concepts/a%20b%20%281%29.md) - A [b] c\n');
  });

  it('keeps CRLF files CRLF', () => {
    const source = '# T\r\n\r\n## Concepts\r\n\r\n* [A](/concepts/a.md) - A.\r\n';
    expect(addConceptToIndex(source, concept)).toBe(`${source}* ${line}\r\n`);
    expect(addConceptToIndex('# T\r\n', concept)).toBe(
      `# T\r\n\r\n## Concepts\r\n\r\n* ${line}\r\n`,
    );
  });
});

describe('addCreateToLog', () => {
  const concept = { title: 'New one', path: 'concepts/new-one.md' };
  const entry = '* **Create**: Created [New one](/concepts/new-one.md).';

  it("adds under today's heading when it is the first one", () => {
    const source =
      '# Update log\n\n## 2026-10-18\n* **Update**: Edited.\n\n## 2026-10-17\n* **Create**: Created.\n';
    expect(addCreateToLog(source, concept, '2026-10-18')).toBe(
      source.replace('## 2026-10-18\n', `## 2026-10-18\n${entry}\n`),
    );
  });

  it('adds a new dated section before the first ## heading otherwise', () => {
    const source = '# Update log\n\n## 2026-10-17\n* **Create**: Created.\n';
    expect(addCreateToLog(source, concept, '2026-10-18')).toBe(
      `# Update log\n\n## 2026-10-18\n${entry}\n\n## 2026-10-17\n* **Create**: Created.\n`,
    );
    // today exists but is not the newest section: still a new section on top
    expect(
      addCreateToLog('## 2026-10-19\n* x\n\n## 2026-10-18\n* y\n', concept, '2026-10-18'),
    ).toBe(`## 2026-10-18\n${entry}\n\n## 2026-10-19\n* x\n\n## 2026-10-18\n* y\n`);
  });

  it('appends a dated section when there is no heading, and ignores headings in code', () => {
    expect(addCreateToLog('# Update log\n', concept, '2026-10-18')).toBe(
      `# Update log\n\n## 2026-10-18\n${entry}\n`,
    );
    expect(addCreateToLog('# Update log\n\n```\n## 2026-10-18\n```\n', concept, '2026-10-18')).toBe(
      `# Update log\n\n\`\`\`\n## 2026-10-18\n\`\`\`\n\n## 2026-10-18\n${entry}\n`,
    );
    expect(addCreateToLog('', concept, '2026-10-18')).toBe(`## 2026-10-18\n${entry}\n`);
  });
});

describe('appendLogEntry', () => {
  const line = '* **Note**: Did a thing.';

  it('adds under today when it is the newest heading, else a new section on top', () => {
    expect(appendLogEntry('# Update log\n\n## 2026-10-18\n* old\n', '2026-10-18', line)).toBe(
      `# Update log\n\n## 2026-10-18\n${line}\n* old\n`,
    );
    expect(appendLogEntry('# Update log\n\n## 2026-10-17\n* old\n', '2026-10-18', line)).toBe(
      `# Update log\n\n## 2026-10-18\n${line}\n\n## 2026-10-17\n* old\n`,
    );
  });

  it('keeps CRLF files CRLF and handles an empty file', () => {
    expect(appendLogEntry('# L\r\n\r\n## 2026-10-17\r\n* o\r\n', '2026-10-18', line)).toBe(
      `# L\r\n\r\n## 2026-10-18\r\n${line}\r\n\r\n## 2026-10-17\r\n* o\r\n`,
    );
    expect(appendLogEntry('', '2026-10-18', line)).toBe(`## 2026-10-18\n${line}\n`);
  });
});

describe('appendLog', () => {
  it('appends under today in the bundle log and returns the head', async () => {
    const dir = tmp.make({
      ...validKbBundle('demo'),
      'kb/demo/log.md': '# Update log\n\n## 2026-10-17\n* **Create**: Created.\n',
    });
    const result = await appendLog('kb', 'demo', 'Reviewed\nthe plan', '2026-10-18', dir);
    expect(result.created).toBe(false);
    expect(result.entry).toBe('* Reviewed the plan');
    expect(result.head).toBe('## 2026-10-18\n* Reviewed the plan');
    const next = readFileSync(path.join(dir, 'kb', 'demo', 'log.md'), 'utf8');
    expect(next).toBe(
      '# Update log\n\n## 2026-10-18\n* Reviewed the plan\n\n## 2026-10-17\n* **Create**: Created.\n',
    );
    const again = await appendLog('kb', 'demo', 'Second', '2026-10-18', dir);
    expect(again.head).toBe('## 2026-10-18\n* Second\n* Reviewed the plan');
  });

  it('creates log.md when it is missing', async () => {
    const files = validKbBundle('demo');
    delete files['kb/demo/log.md'];
    const dir = tmp.make(files);
    const result = await appendLog('kb', 'demo', 'First', '2026-10-18', dir);
    expect(result.created).toBe(true);
    expect(readFileSync(path.join(dir, 'kb', 'demo', 'log.md'), 'utf8')).toBe(
      '# Update log\n\n## 2026-10-18\n* First\n',
    );
  });

  it('refuses a bad dataset, slug, empty text and a missing entry', async () => {
    const dir = tmp.make(validKbBundle('demo'));
    expect((await failure(appendLog('reference', 'demo', 'x', '2026-10-18', dir))).code).toBe(
      'bad-dataset',
    );
    expect((await failure(appendLog('kb', 'Bad Slug', 'x', '2026-10-18', dir))).code).toBe(
      'bad-slug',
    );
    expect((await failure(appendLog('kb', 'demo', '  ', '2026-10-18', dir))).code).toBe('invalid');
    expect((await failure(appendLog('kb', 'nope', 'x', '2026-10-18', dir))).code).toBe('not-found');
  });
});

describe('createDoc', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  const bundle = (): Record<string, string> => validKbBundle('demo');

  it('creates the file, lists it in index.md and logs it, atomically', async () => {
    const dir = tmp.make(bundle());
    const created = await createDoc(
      'kb',
      'demo',
      'concepts/w2-new.md',
      { title: 'W2 new', type: 'Guide', description: 'A new guide.' },
      dir,
      now,
    );
    expect(created).toMatchObject({
      dataset: 'kb',
      slug: 'demo',
      path: 'concepts/w2-new.md',
      url: '/kb/demo/doc/concepts/w2-new',
      warnings: [],
    });
    const file = path.join(dir, 'kb', 'demo', 'concepts', 'w2-new.md');
    expect(readFileSync(file, 'utf8')).toBe(
      '---\ntype: Guide\ntitle: W2 new\ndescription: A new guide.\n---\n\n# W2 new\n',
    );
    expect(created.lastModified).toBe(statSync(file).mtime.toISOString());
    const index = readFileSync(path.join(dir, 'kb', 'demo', 'index.md'), 'utf8');
    expect(index).toBe(
      // The entry has no `## Concepts` section yet: one is appended.
      `${validKbBundle('demo')['kb/demo/index.md']!}\n## Concepts\n\n* [W2 new](/concepts/w2-new.md) - A new guide.\n`,
    );
    expect(readFileSync(path.join(dir, 'kb', 'demo', 'log.md'), 'utf8')).toBe(
      '# Update log\n\n## 2026-10-18\n* **Create**: Created [W2 new](/concepts/w2-new.md).\n* **Update**: Edited.\n\n## 2026-10-17\n* **Create**: Created [Demo](/index.md).\n',
    );
    // Nothing is left behind and the bundle still passes the okf + link checks.
    expect(readdirSync(path.join(dir, 'kb', 'demo', 'concepts')).sort()).toEqual([
      'one.md',
      'w2-new.md',
    ]);
    expect(ruleIds(validateDoc('kb', 'demo', 'index.md', index, dir))).toEqual([]);
  });

  it('defaults type to Concept, omits a blank description and creates missing folders', async () => {
    const dir = tmp.make(bundle());
    await createDoc(
      'kb',
      'demo',
      'concepts/deep/er/x.md',
      { title: ' A\n title ', description: '  ' },
      dir,
      now,
    );
    expect(
      readFileSync(path.join(dir, 'kb', 'demo', 'concepts', 'deep', 'er', 'x.md'), 'utf8'),
    ).toBe('---\ntype: Concept\ntitle: A title\n---\n\n# A title\n');
    expect(readFileSync(path.join(dir, 'kb', 'demo', 'index.md'), 'utf8')).toContain(
      '* [A title](/concepts/deep/er/x.md) - A title\n',
    );
  });

  it('is fine in a bundle without index.md / log.md (they are not created)', async () => {
    const dir = tmp.make({ 'kb/x/index.md': MAIN });
    const created = await createDoc('kb', 'x', 'a.md', { title: 'A' }, dir, now);
    expect(created.warnings).toEqual([]);
    expect(readdirSync(path.join(dir, 'kb', 'x')).sort()).toEqual(['a.md', 'index.md']);
  });

  it('answers exists for an existing file (also a directory or a dangling symlink) and changes nothing', async () => {
    const dir = tmp.make(bundle());
    const before = readFileSync(path.join(dir, 'kb', 'demo', 'index.md'), 'utf8');
    for (const target of ['concepts/one.md']) {
      const error = await failure(createDoc('kb', 'demo', target, { title: 'X' }, dir, now));
      expect(error.code, target).toBe('exists');
    }
    mkdirSync(path.join(dir, 'kb', 'demo', 'folder.md'));
    expect(
      (await failure(createDoc('kb', 'demo', 'folder.md', { title: 'X' }, dir, now))).code,
    ).toBe('exists');
    if (process.platform !== 'win32') {
      symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'kb', 'demo', 'dangling.md'));
      expect(
        (await failure(createDoc('kb', 'demo', 'dangling.md', { title: 'X' }, dir, now))).code,
      ).toBe('exists');
    }
    expect(readFileSync(path.join(dir, 'kb', 'demo', 'index.md'), 'utf8')).toBe(before);
    expect(readFileSync(path.join(dir, 'kb', 'demo', 'concepts', 'one.md'), 'utf8')).toBe(
      validKbBundle('demo')['kb/demo/concepts/one.md'],
    );
  });

  it('reserves index.md, log.md and the root index.md', async () => {
    const dir = tmp.make(bundle());
    for (const target of [
      'index.md',
      'log.md',
      'index.md',
      'concepts/index.md',
      'concepts/log.md',
    ]) {
      const error = await failure(createDoc('kb', 'demo', target, { title: 'X' }, dir, now));
      expect(error.code, target).toBe('bad-path');
    }
  });

  it('rejects bad datasets, slugs, paths and bodies before writing', async () => {
    const dir = tmp.make(bundle());
    expect((await failure(createDoc('skill', 'demo', 'a.md', { title: 'X' }, dir))).code).toBe(
      'bad-dataset',
    );
    expect((await failure(createDoc('context', 'demo', 'a.md', { title: 'X' }, dir))).code).toBe(
      'bad-dataset',
    );
    expect((await failure(createDoc('kb', 'Bad', 'a.md', { title: 'X' }, dir))).code).toBe(
      'bad-slug',
    );
    for (const bad of [undefined, '', '../x.md', 'a/../b.md', '.hidden/x.md', 'x.txt', '/abs.md']) {
      expect(
        (await failure(createDoc('kb', 'demo', bad, { title: 'X' }, dir))).code,
        String(bad),
      ).toBe('bad-path');
    }
    expect((await failure(createDoc('kb', 'missing', 'a.md', { title: 'X' }, dir))).code).toBe(
      'not-found',
    );

    const body = await failure(
      createDoc(
        'kb',
        'demo',
        'a.md',
        { title: '', type: 5, description: 'x'.repeat(1025), extra: 1 },
        dir,
      ),
    );
    expect(body.code).toBe('invalid');
    expect(body.issues.map((i) => i.path).sort()).toEqual([
      'description',
      'extra',
      'title',
      'type',
    ]);
    expect((await failure(createDoc('kb', 'demo', 'a.md', 'nope', dir))).code).toBe('invalid');
    expect(
      (await failure(createDoc('kb', 'demo', 'a.md', { title: 'x'.repeat(201) }, dir))).issues[0]
        ?.path,
    ).toBe('title');
    expect(existsSync(path.join(dir, 'kb', 'demo', 'a.md'))).toBe(false);
  });

  it('never writes through a symlinked folder that leaves the bundle', async () => {
    if (process.platform === 'win32') return;
    const dir = tmp.make(bundle());
    const outside = tmp.make({ 'keep.txt': 'x' });
    symlinkSync(outside, path.join(dir, 'kb', 'demo', 'escape'));
    const error = await failure(
      createDoc('kb', 'demo', 'escape/new/x.md', { title: 'X' }, dir, now),
    );
    expect(error.code).toBe('bad-path');
    expect(readdirSync(outside)).toEqual(['keep.txt']);
  });

  it('refuses a path with a file where a folder is needed', async () => {
    const dir = tmp.make(bundle());
    const error = await failure(
      createDoc('kb', 'demo', 'concepts/one.md/inner.md', { title: 'X' }, dir, now),
    );
    expect(error.code).toBe('bad-path');
  });

  it('two concurrent creates of the same file: one wins, one gets exists', async () => {
    const dir = tmp.make(bundle());
    const results = await Promise.allSettled([
      createDoc('kb', 'demo', 'concepts/race.md', { title: 'One' }, dir, now),
      createDoc('kb', 'demo', 'concepts/race.md', { title: 'Two' }, dir, now),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const index = readFileSync(path.join(dir, 'kb', 'demo', 'index.md'), 'utf8');
    expect(index.match(/race\.md/g)).toHaveLength(1);
  });

  it('concurrent creates of different files list every one in index.md and log.md', async () => {
    const dir = tmp.make(bundle());
    const names = ['a', 'b', 'c', 'd', 'e'];
    await Promise.all(
      names.map((n) => createDoc('kb', 'demo', `concepts/${n}.md`, { title: `T ${n}` }, dir, now)),
    );
    const index = readFileSync(path.join(dir, 'kb', 'demo', 'index.md'), 'utf8');
    const log = readFileSync(path.join(dir, 'kb', 'demo', 'log.md'), 'utf8');
    for (const n of names) {
      expect(index).toContain(`(/concepts/${n}.md)`);
      expect(log).toContain(`(/concepts/${n}.md)`);
    }
  });
});

describe('removeConceptFromIndex', () => {
  const index = [
    '# X',
    '',
    'See [one](/concepts/one.md) in the text.',
    '',
    '## Concepts',
    '',
    '* [One](/concepts/one.md) - The first.',
    '  continued line of one',
    '* [Two](./concepts/two.md) - The second.',
    '- [Space](/notes/a%20b.md) - Encoded.',
    '',
    '## Later',
    '',
    '* [One again](/concepts/one.md)',
    '',
  ].join('\n');

  it('drops the Concepts items (and their continuation lines) that link to the file, nothing else', () => {
    const out = removeConceptFromIndex(index, 'concepts/one.md');
    expect(out).not.toContain('* [One](/concepts/one.md)');
    expect(out).not.toContain('continued line of one');
    expect(out).toContain('See [one](/concepts/one.md) in the text.');
    expect(out).toContain('* [Two](./concepts/two.md) - The second.');
    expect(out).toContain('* [One again](/concepts/one.md)');
    expect(removeConceptFromIndex(index, 'concepts/two.md')).not.toContain('[Two]');
    expect(removeConceptFromIndex(index, 'notes/a b.md')).not.toContain('[Space]');
  });

  it('returns the source unchanged when nothing is listed', () => {
    expect(removeConceptFromIndex(index, 'concepts/none.md')).toBe(index);
    expect(removeConceptFromIndex('# No section\n', 'a.md')).toBe('# No section\n');
  });
});

describe('deleteDoc', () => {
  const now = new Date('2026-10-19T09:00:00Z');

  it('removes the file, its Concepts line and the folders left empty, and logs it in an existing log.md', async () => {
    const dir = tmp.make(validKbBundle('demo'));
    await createDoc('kb', 'demo', 'references/deep/abc.md', { title: 'Abc' }, dir, now);
    const deleted = await deleteDoc('kb', 'demo', 'references/deep/abc.md', dir, now);
    expect(deleted.path).toBe('references/deep/abc.md');
    expect(deleted.url).toBe('/kb/demo');
    const root = path.join(dir, 'kb', 'demo');
    expect(existsSync(path.join(root, 'references'))).toBe(false);
    expect(readFileSync(path.join(root, 'index.md'), 'utf8')).not.toContain(
      'references/deep/abc.md',
    );
    const log = readFileSync(path.join(root, 'log.md'), 'utf8');
    expect(log).toContain('## 2026-10-19\n* **Delete**: Deleted `references/deep/abc.md`.\n');
    // the Create line of the log still links to it: reported, not rewritten
    expect(deleted.warnings).toEqual([
      expect.objectContaining({
        rule: 'links/broken',
        file: 'kb/demo/log.md',
        message: 'still links to the deleted references/deep/abc.md',
      }),
    ]);
  });

  it('keeps folders that still hold something and never creates a log.md', async () => {
    const dir = tmp.make({
      'kb/x/index.md': MAIN,
      'kb/x/notes/a.md': '---\ntype: Concept\n---\n# A\n\nSee [b](./b.md).\n',
      'kb/x/notes/b.md': '---\ntype: Concept\n---\n# B\n',
    });
    const deleted = await deleteDoc('kb', 'x', 'notes/b.md', dir, now);
    expect(deleted.warnings).toEqual([
      expect.objectContaining({ rule: 'links/broken', file: 'kb/x/notes/a.md', line: 6 }),
    ]);
    expect(readdirSync(path.join(dir, 'kb', 'x')).sort()).toEqual(['index.md', 'notes']);
    expect(readdirSync(path.join(dir, 'kb', 'x', 'notes'))).toEqual(['a.md']);
  });

  it('deletes a nested index.md and log.md itself', async () => {
    const dir = tmp.make(validKbBundle('demo'));
    writeTree(dir, { 'kb/demo/concepts/index.md': '# Concepts\n' });
    await deleteDoc('kb', 'demo', 'concepts/index.md', dir, now);
    expect(existsSync(path.join(dir, 'kb', 'demo', 'concepts', 'index.md'))).toBe(false);
    await deleteDoc('kb', 'demo', 'log.md', dir, now);
    expect(existsSync(path.join(dir, 'kb', 'demo', 'log.md'))).toBe(false);
  });

  it('unlinks a symlinked file and leaves its target alone', async () => {
    const dir = tmp.make(validKbBundle('demo'));
    const root = path.join(dir, 'kb', 'demo');
    symlinkSync(path.join(root, 'concepts', 'one.md'), path.join(root, 'alias.md'));
    await deleteDoc('kb', 'demo', 'alias.md', dir, now);
    expect(existsSync(path.join(root, 'alias.md'))).toBe(false);
    expect(existsSync(path.join(root, 'concepts', 'one.md'))).toBe(true);
  });

  it('refuses the entry index.md, skills, bad paths, missing files and links out of the bundle', async () => {
    const dir = tmp.make(validKbBundle('demo'));
    const root = path.join(dir, 'kb', 'demo');
    writeTree(dir, { 'outside.md': '# Outside\n' });
    symlinkSync(path.join(dir, 'outside.md'), path.join(root, 'out.md'));
    const cases: [string, string, string, string][] = [
      ['kb', 'demo', 'index.md', 'bad-path'],
      ['skill', 'demo', 'x.md', 'bad-dataset'],
      ['reference', 'demo', 'x.md', 'bad-dataset'],
      ['kb', 'Bad Slug', 'x.md', 'bad-slug'],
      ['kb', 'demo', '../x.md', 'bad-path'],
      ['kb', 'demo', 'concepts/one.txt', 'bad-path'],
      ['kb', 'demo', 'out.md', 'bad-path'],
      ['kb', 'demo', 'concepts/missing.md', 'not-found'],
      ['kb', 'nope', 'a.md', 'not-found'],
    ];
    for (const [ds, slug, rel, code] of cases) {
      expect((await failure(deleteDoc(ds, slug, rel, dir, now))).code, `${ds}/${slug}/${rel}`).toBe(
        code,
      );
    }
    expect(existsSync(path.join(root, 'index.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'outside.md'))).toBe(true);
  });
});
