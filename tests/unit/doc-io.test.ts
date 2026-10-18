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
  DocIoError,
  isDocDatasetId,
  normalizeDocPath,
  readDoc,
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

const MAIN = `---\ntype: Knowledge Base\nname: x\ndescription: A KB.\n---\n\n# X\n`;

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
      'main.md',
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
    const dir = tmp.make({ 'kb/x/main.md': `${MAIN}é€\n` });
    const doc = await readDoc('kb', 'x', 'main.md', dir);
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
    const error = await failure(readDoc('context', 'x', 'main.md', dir));
    expect(error.code).toBe('bad-dataset');
    expect(error.message).toContain('kb');
    expect(error.message).toContain('skill');
  });

  it('throws bad-slug and bad-path before touching the disk', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    expect((await failure(readDoc('kb', '../x', 'main.md', dir))).code).toBe('bad-slug');
    expect((await failure(readDoc('kb', 'X', 'main.md', dir))).code).toBe('bad-slug');
    for (const bad of [undefined, '', '../x.md', 'a\\b.md', 'x.txt', '.hidden/x.md']) {
      expect((await failure(readDoc('kb', 'x', bad, dir))).code, String(bad)).toBe('bad-path');
    }
  });

  it('throws not-found for a missing entry and a missing file', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const noEntry = await failure(readDoc('kb', 'nope', 'main.md', dir));
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
    const dir = tmp.make({ 'kb/x/main.md': MAIN, 'outside.md': 'outside' });
    try {
      symlinkSync(path.join(dir, 'outside.md'), path.join(dir, 'kb', 'x', 'out.md'));
    } catch {
      return; // symlinks unavailable
    }
    expect((await failure(readDoc('kb', 'x', 'out.md', dir))).code).toBe('bad-path');
  });

  it('throws too-large above 512 KB and not-text for a NUL byte', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    writeFileSync(path.join(dir, 'kb', 'x', 'big.md'), 'a'.repeat(MAX_TEXT_BYTES + 1));
    writeFileSync(path.join(dir, 'kb', 'x', 'ok.md'), 'a'.repeat(MAX_TEXT_BYTES));
    writeFileSync(path.join(dir, 'kb', 'x', 'bin.md'), Buffer.from([65, 0, 66]));
    expect((await failure(readDoc('kb', 'x', 'big.md', dir))).code).toBe('too-large');
    expect((await readDoc('kb', 'x', 'ok.md', dir)).bytes).toBe(MAX_TEXT_BYTES);
    expect((await failure(readDoc('kb', 'x', 'bin.md', dir))).code).toBe('not-text');
  });
});

describe('writeDoc', () => {
  const file = (dir: string, rel = 'main.md') => path.join(dir, 'kb', 'x', ...rel.split('/'));

  it('writes the exact bytes (CRLF kept) and returns the new record', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const text =
      '---\r\ntype: Knowledge Base\r\nname: x\r\ndescription: Changed.\r\n---\r\n\r\n# X\r\n';
    const doc = await writeDoc('kb', 'x', 'main.md', { markdown: text }, dir);
    expect(readFileSync(file(dir), 'utf8')).toBe(text);
    expect(doc.markdown).toBe(text);
    expect(doc.bytes).toBe(Buffer.byteLength(text));
    expect(doc.path).toBe('main.md');
    expect(doc.lastModified).toBe(statSync(file(dir)).mtime.toISOString());
    expect(doc.warnings).toEqual([]);
  });

  it('keeps the file mode and leaves no temp file behind', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    if (process.platform !== 'win32') chmodSync(file(dir), 0o640);
    await writeDoc('kb', 'x', 'main.md', { markdown: `${MAIN}more\n` }, dir);
    if (process.platform !== 'win32') expect(statSync(file(dir)).mode & 0o777).toBe(0o640);
    expect(readdirSync(path.join(dir, 'kb', 'x'))).toEqual(['main.md']);
  });

  it('changes lastModified', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const old = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(file(dir), old, old);
    const before = (await readDoc('kb', 'x', 'main.md', dir)).lastModified;
    expect(before).toBe('2020-01-01T00:00:00.000Z');
    const after = await writeDoc('kb', 'x', 'main.md', { markdown: MAIN }, dir);
    expect(after.lastModified).not.toBe(before);
  });

  it('ifUnmodifiedSince equal to the current mtime writes', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const { lastModified } = await readDoc('kb', 'x', 'main.md', dir);
    const doc = await writeDoc(
      'kb',
      'x',
      'main.md',
      { markdown: `${MAIN}ok\n`, ifUnmodifiedSince: lastModified },
      dir,
    );
    expect(readFileSync(file(dir), 'utf8')).toBe(`${MAIN}ok\n`);
    expect(doc.lastModified).toBe(statSync(file(dir)).mtime.toISOString());
  });

  it('any other mtime, older or newer, is a conflict that carries the current mtime and keeps the file', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const current = new Date('2024-05-05T05:05:05.000Z');
    utimesSync(file(dir), current, current);
    for (const stale of ['2024-05-05T05:05:04.000Z', '2024-05-05T05:05:06.000Z']) {
      const error = await failure(
        writeDoc('kb', 'x', 'main.md', { markdown: 'lost', ifUnmodifiedSince: stale }, dir),
      );
      expect(error.code, stale).toBe('conflict');
      expect(error.lastModified).toBe('2024-05-05T05:05:05.000Z');
    }
    expect(readFileSync(file(dir), 'utf8')).toBe(MAIN);
    expect(readdirSync(path.join(dir, 'kb', 'x'))).toEqual(['main.md']);
  });

  it('omitting ifUnmodifiedSince writes unconditionally', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const old = new Date('2001-01-01T00:00:00.000Z');
    utimesSync(file(dir), old, old);
    await writeDoc('kb', 'x', 'main.md', { markdown: 'new\n' }, dir);
    expect(readFileSync(file(dir), 'utf8')).toBe('new\n');
  });

  it('rejects an invalid body with issues and writes nothing', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
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
      const error = await failure(writeDoc('kb', 'x', 'main.md', body, dir));
      expect(error.code, JSON.stringify(body)).toBe('invalid');
      expect(error.issues, JSON.stringify(body)).toEqual(issues);
    }
    expect(readFileSync(file(dir), 'utf8')).toBe(MAIN);
  });

  it('rejects markdown over 512 KB (too-large) and accepts exactly 512 KB', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const error = await failure(
      writeDoc('kb', 'x', 'main.md', { markdown: 'a'.repeat(MAX_TEXT_BYTES + 1) }, dir),
    );
    expect(error.code).toBe('too-large');
    await writeDoc('kb', 'x', 'main.md', { markdown: 'a'.repeat(MAX_TEXT_BYTES) }, dir);
    expect(statSync(file(dir)).size).toBe(MAX_TEXT_BYTES);
  });

  it('uses the path checks of readDoc (no create, no traversal, no dot files)', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN });
    const body = { markdown: 'x' };
    expect((await failure(writeDoc('kb', 'x', 'new.md', body, dir))).code).toBe('not-found');
    expect((await failure(writeDoc('kb', 'nope', 'main.md', body, dir))).code).toBe('not-found');
    expect((await failure(writeDoc('kb', 'x', '../y.md', body, dir))).code).toBe('bad-path');
    expect((await failure(writeDoc('context', 'x', 'main.md', body, dir))).code).toBe(
      'bad-dataset',
    );
    expect(existsSync(file(dir, 'new.md'))).toBe(false);
  });

  it('writes through a symlinked file inside the bundle: the link stays, its target changes', async () => {
    const dir = tmp.make({ 'kb/x/main.md': MAIN, 'kb/x/real/target.md': 'old\n' });
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
      'task/t/main.md':
        '---\ntype: Task\nname: t\ndescription: A task.\nstate: pending\n---\n\n# T\n',
    });
    const bad = '---\ntype: Task\nname: t\ndescription: A task.\nstate: nope\n---\n\n# T\n';
    const doc = await writeDoc('task', 't', 'main.md', { markdown: bad }, dir);
    expect(readFileSync(path.join(dir, 'task', 't', 'main.md'), 'utf8')).toBe(bad);
    expect(ruleIds(doc.warnings)).toContain('okf/entry-schema');
    expect(doc.warnings.every((w) => w.file === 'task/t/main.md')).toBe(true);
    expect(doc.warnings.some((w) => w.severity === 'error')).toBe(true);
  });
});

describe('validateDoc', () => {
  it('okf: a concept without type, a bad log heading, an extra root-index key', () => {
    expect(
      ruleIds(validateDoc('kb', 'x', 'concepts/c.md', '---\ndescription: d\n---\n# C\n')),
    ).toContain('okf/type');
    expect(
      ruleIds(validateDoc('kb', 'x', 'log.md', '# Update log\n\n## Yesterday\n* **Update**: x\n')),
    ).toContain('okf/log-heading');
    expect(
      ruleIds(validateDoc('kb', 'x', 'index.md', '---\nokf_version: "0.2"\nextra: 1\n---\n# I\n')),
    ).toContain('okf/index-frontmatter');
  });

  it('okf: a clean file has no findings, findings carry the data-dir relative file', () => {
    expect(validateDoc('kb', 'x', 'main.md', MAIN)).toEqual([]);
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
    const doc = await readDoc('kb', 'demo', 'main.md', dir);
    expect(doc.warnings).toEqual([]);
  });
});
