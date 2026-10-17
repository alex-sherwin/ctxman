import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listBundleFiles,
  MAX_TEXT_BYTES,
  readBundleText,
  safeJoin,
  walkFiles,
} from '../../src/lib/bundles.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('safeJoin', () => {
  const root = path.resolve('/bundle-root/x');

  it('joins inside-the-root relative paths', () => {
    expect(safeJoin(root, 'main.md')).toBe(path.join(root, 'main.md'));
    expect(safeJoin(root, 'concepts/a.md')).toBe(path.join(root, 'concepts', 'a.md'));
    expect(safeJoin(root, 'a/../b.md')).toBe(path.join(root, 'b.md'));
  });

  it('rejects traversal, absolute paths and NUL', () => {
    expect(safeJoin(root, '../x')).toBeNull();
    expect(safeJoin(root, '..')).toBeNull();
    expect(safeJoin(root, 'a/../../x')).toBeNull();
    expect(safeJoin(root, '/etc/passwd')).toBeNull();
    expect(safeJoin(root, 'C:\\Windows\\win.ini')).toBeNull();
    expect(safeJoin(root, 'a\0b.md')).toBeNull();
  });

  it('does not treat sibling directories with a shared prefix as inside', () => {
    expect(safeJoin(root, '../x-evil/secret.md')).toBeNull();
  });
});

describe('walkFiles', () => {
  it('lists regular files recursively as sorted posix paths, skipping dot entries', async () => {
    const dir = tmp.make({
      'b.md': '',
      'a/z.md': '',
      'a/.hidden': '',
      '.git/config': '',
      'a/sub/y.md': '',
    });
    expect(await walkFiles(dir)).toEqual(['a/sub/y.md', 'a/z.md', 'b.md']);
  });

  it('returns [] for a missing directory', async () => {
    expect(await walkFiles(path.join(tmp.make(), 'nope'))).toEqual([]);
  });
});

describe('listBundleFiles', () => {
  it('orders index.md, main.md, log.md first, then directories before files', async () => {
    const dir = tmp.make({
      'kb/x/zeta.md': 'z',
      'kb/x/log.md': 'l',
      'kb/x/concepts/b.md': 'b',
      'kb/x/concepts/a.md': 'a',
      'kb/x/concepts/deep/c.md': 'c',
      'kb/x/main.md': 'm',
      'kb/x/alpha.md': 'a',
      'kb/x/index.md': 'i',
      'kb/x/.DS_Store': 'junk',
      'kb/x/assets/pic.png': 'png',
    });
    const files = await listBundleFiles('kb', 'x', dir);
    expect(files.map((f) => f.path)).toEqual([
      'index.md',
      'main.md',
      'log.md',
      'assets/pic.png',
      'concepts/deep/c.md',
      'concepts/a.md',
      'concepts/b.md',
      'alpha.md',
      'zeta.md',
    ]);
    expect(files.slice(0, 3).map((f) => f.role)).toEqual(['root-index', 'entry', 'log']);
    expect(files[3]?.role).toBeUndefined();
  });

  it('reports size, ISO mtime and kind', async () => {
    const dir = tmp.make({
      'skill/s/SKILL.md': '# s',
      'skill/s/scripts/run.py': 'print(1)',
      'skill/s/assets/logo.png': 'x',
      'skill/s/assets/blob': 'a\0b',
      'skill/s/NOTES': 'plain',
    });
    const files = await listBundleFiles('skill', 's', dir);
    const kinds = Object.fromEntries(files.map((f) => [f.path, f.kind]));
    expect(kinds).toEqual({
      'SKILL.md': 'markdown',
      'assets/blob': 'binary',
      'assets/logo.png': 'binary',
      'scripts/run.py': 'text',
      NOTES: 'text',
    });
    expect(files[0]).toMatchObject({ path: 'SKILL.md', role: 'entry', size: 3 });
    expect(files[0]?.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('uses SKILL.md (not main.md) as the entry of a skill', async () => {
    const dir = tmp.make({ 'skill/s/main.md': 'm', 'skill/s/SKILL.md': 's' });
    const files = await listBundleFiles('skill', 's', dir);
    expect(files.map((f) => [f.path, f.role])).toEqual([
      ['SKILL.md', 'entry'],
      ['main.md', undefined],
    ]);
  });

  it('returns [] for a missing bundle or an invalid slug', async () => {
    const dir = tmp.make({ 'kb/x/main.md': '' });
    expect(await listBundleFiles('kb', 'nope', dir)).toEqual([]);
    expect(await listBundleFiles('kb', '../kb/x', dir)).toEqual([]);
  });
});

describe('readBundleText', () => {
  it('reads text files by bundle-relative path', async () => {
    const dir = tmp.make({ 'kb/x/concepts/a.md': '# Hello\n' });
    expect(await readBundleText('kb', 'x', 'concepts/a.md', dir)).toBe('# Hello\n');
  });

  it('returns null for traversal, absolute paths, NUL, missing files and directories', async () => {
    const dir = tmp.make({ 'kb/x/main.md': 'm', 'kb/secret.md': 'secret' });
    expect(await readBundleText('kb', 'x', '../secret.md', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', path.join(dir, 'kb', 'secret.md'), dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'main.md\0', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'nope.md', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', '.', dir)).toBeNull();
    expect(await readBundleText('kb', '../x', 'main.md', dir)).toBeNull();
  });

  it('returns null for binary and oversized files', async () => {
    const dir = tmp.make();
    const root = path.join(dir, 'kb', 'x');
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    writeFileSync(path.join(root, 'ok.txt'), 'a'.repeat(MAX_TEXT_BYTES));
    writeFileSync(path.join(root, 'big.txt'), 'a'.repeat(MAX_TEXT_BYTES + 1));
    expect(await readBundleText('kb', 'x', 'bin.dat', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'big.txt', dir)).toBeNull();
    expect((await readBundleText('kb', 'x', 'ok.txt', dir))?.length).toBe(MAX_TEXT_BYTES);
  });

  it('refuses symlinks that point outside the bundle', async () => {
    const dir = tmp.make({ 'kb/x/main.md': 'm', 'outside.md': 'outside' });
    try {
      symlinkSync(path.join(dir, 'outside.md'), path.join(dir, 'kb', 'x', 'link.md'));
    } catch {
      return; // symlinks unavailable (e.g. Windows without privileges)
    }
    expect(await readBundleText('kb', 'x', 'link.md', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'main.md', dir)).toBe('m');
  });
});
