import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkOutputPath, writeOutput } from '../../src/lib/inflate/write.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const DATA = path.resolve(os.tmpdir(), 'ctxman-data-dir-for-tests');
const failure = (raw: unknown) => {
  const r = checkOutputPath(raw, { dataDir: DATA });
  return r.ok ? null : r.message;
};

describe('checkOutputPath', () => {
  it('1. path is required: not a string or blank', () => {
    for (const bad of [undefined, null, 5, {}, [], '', '   ', '\n\t']) {
      expect(failure(bad), JSON.stringify(bad)).toBe('path is required');
    }
  });

  it('1. path is not valid: too long or containing NUL', () => {
    expect(failure(`${path.resolve('/')}${'a'.repeat(1030)}.md`)).toBe('path is not valid');
    expect(failure(`${path.resolve('/tmp')}/a\0b.md`)).toBe('path is not valid');
    // exactly 1024 characters is still checked further
    const p = path.join(
      path.resolve('/tmp'),
      `${'a'.repeat(1024 - path.resolve('/tmp').length - 4)}.md`,
    );
    expect(p.length).toBe(1024);
    expect(failure(p)).toBeNull();
  });

  it('2. path must be absolute', () => {
    for (const rel of ['out/brief.md', './brief.md', '../brief.md', 'brief.md', '~/brief.md']) {
      expect(failure(rel), rel).toBe('path must be absolute');
    }
  });

  it('3. path must end in .md (case-insensitive)', () => {
    const base = path.resolve('/tmp/ctxman-out');
    expect(failure(path.join(base, 'brief.txt'))).toBe('path must end in .md');
    expect(failure(path.join(base, 'brief'))).toBe('path must end in .md');
    expect(failure(path.join(base, 'brief.md.bak'))).toBe('path must end in .md');
    expect(failure(path.join(base, 'brief.markdown'))).toBe('path must end in .md');
    expect(failure(path.join(base, 'BRIEF.MD'))).toBeNull();
    expect(failure(path.join(base, 'brief.md'))).toBeNull();
  });

  it('4. no node_modules or .git segment', () => {
    const base = path.resolve('/tmp/ctxman-out');
    const msg = 'path must not be inside node_modules or .git';
    expect(failure(path.join(base, 'node_modules', 'x.md'))).toBe(msg);
    expect(failure(path.join(base, 'a', 'Node_Modules', 'b', 'x.md'))).toBe(msg);
    expect(failure(path.join(base, '.git', 'x.md'))).toBe(msg);
    expect(failure(path.join(base, '.GIT', 'x.md'))).toBe(msg);
    // only whole segments count
    expect(failure(path.join(base, 'node_modules_old', 'x.md'))).toBeNull();
    expect(failure(path.join(base, '.github', 'x.md'))).toBeNull();
    expect(failure(path.join(base, '.gitignore.md'))).toBeNull();
  });

  it('5. not inside the data directory (the directory itself included)', () => {
    const msg = 'path must not be inside the data directory';
    expect(failure(path.join(DATA, 'kb', 'x.md'))).toBe(msg);
    expect(failure(path.join(DATA, 'x.md'))).toBe(msg);
    expect(failure(path.join(DATA, 'a', '..', 'x.md'))).toBe(msg);
    // siblings and parents are fine
    expect(failure(`${DATA}-other/x.md`)).toBeNull();
    expect(failure(path.join(path.dirname(DATA), 'x.md'))).toBeNull();
  });

  it('order of rules: the first failure wins', () => {
    expect(failure(path.join(DATA, 'node_modules', 'x.txt'))).toBe('path must end in .md');
    expect(failure(path.join(DATA, 'node_modules', 'x.md'))).toBe(
      'path must not be inside node_modules or .git',
    );
    expect(failure('relative/node_modules/x.txt')).toBe('path must be absolute');
  });

  it('returns the normalized absolute path (trimmed, dot segments resolved)', () => {
    const base = path.resolve('/tmp/ctxman-out');
    const r = checkOutputPath(`  ${base}${path.sep}sub${path.sep}..${path.sep}brief.md  `, {
      dataDir: DATA,
    });
    expect(r).toEqual({ ok: true, path: path.join(base, 'brief.md') });
  });

  it('defaults the data directory to CTXMAN_DATA_DIR', () => {
    const dataDir = process.env.CTXMAN_DATA_DIR;
    expect(dataDir).toBeDefined();
    const r = checkOutputPath(path.join(dataDir ?? '', 'kb', 'x.md'));
    expect(r).toEqual({ ok: false, message: 'path must not be inside the data directory' });
    expect(checkOutputPath(path.join(process.cwd(), 'out', 'brief.md'))).toMatchObject({
      ok: true,
    });
  });
});

describe('writeOutput', () => {
  it('creates missing parent directories and reports the path and byte size', async () => {
    const root = tmp.make();
    const file = path.join(root, 'a', 'b', 'c', 'brief.md');
    const text = '# Brief\n\nHéllo\n';
    expect(await writeOutput(file, text)).toEqual({ path: file, bytes: Buffer.byteLength(text) });
    expect(Buffer.byteLength(text)).toBeGreaterThan(text.length);
    expect(readFileSync(file, 'utf8')).toBe(text);
  });

  it('overwrites an existing file', async () => {
    const root = tmp.make({ 'brief.md': 'old' });
    const file = path.join(root, 'brief.md');
    await writeOutput(file, 'new content\n');
    expect(readFileSync(file, 'utf8')).toBe('new content\n');
  });

  it('rejects a directory at the target path and leaves it alone', async () => {
    const root = tmp.make();
    const target = path.join(root, 'brief.md');
    mkdirSync(target);
    writeFileSync(path.join(target, 'inner.txt'), 'keep');
    await expect(writeOutput(target, 'x')).rejects.toThrow('a directory exists at that path');
    expect(readdirSync(target)).toEqual(['inner.txt']);
    expect(readdirSync(root).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('leaves no .tmp file behind after a successful or a failed write', async () => {
    const root = tmp.make();
    const file = path.join(root, 'brief.md');
    await writeOutput(file, 'one');
    await writeOutput(file, 'two');
    expect(readdirSync(root)).toEqual(['brief.md']);
    // a parent that is a file makes mkdir fail
    const blocker = path.join(root, 'blocker');
    writeFileSync(blocker, 'x');
    await expect(writeOutput(path.join(blocker, 'brief.md'), 'x')).rejects.toThrow();
    expect(readdirSync(root).sort()).toEqual(['blocker', 'brief.md']);
    expect(existsSync(`${file}.${process.pid}.tmp`)).toBe(false);
  });
});
