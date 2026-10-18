import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listBundleFiles,
  MAX_TEXT_BYTES,
  readBundleText,
  resolveBundleFile,
  safeJoin,
  walkFiles,
} from '../../src/lib/bundles.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('safeJoin', () => {
  const root = path.resolve('/bundle-root/x');

  it('joins inside-the-root relative paths', () => {
    expect(safeJoin(root, 'index.md')).toBe(path.join(root, 'index.md'));
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
  it('orders index.md, log.md first, then directories before files', async () => {
    const dir = tmp.make({
      'kb/x/zeta.md': 'z',
      'kb/x/log.md': 'l',
      'kb/x/concepts/b.md': 'b',
      'kb/x/concepts/a.md': 'a',
      'kb/x/concepts/deep/c.md': 'c',
      'kb/x/alpha.md': 'a',
      'kb/x/index.md': 'i',
      'kb/x/.DS_Store': 'junk',
      'kb/x/assets/pic.png': 'png',
    });
    const files = await listBundleFiles('kb', 'x', dir);
    expect(files.map((f) => f.path)).toEqual([
      'index.md',
      'log.md',
      'assets/pic.png',
      'concepts/deep/c.md',
      'concepts/a.md',
      'concepts/b.md',
      'alpha.md',
      'zeta.md',
    ]);
    expect(files.slice(0, 2).map((f) => f.role)).toEqual(['entry', 'log']);
    expect(files[2]?.role).toBeUndefined();
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

  it('uses SKILL.md (not index.md) as the entry of a skill', async () => {
    const dir = tmp.make({ 'skill/s/index.md': 'm', 'skill/s/SKILL.md': 's' });
    const files = await listBundleFiles('skill', 's', dir);
    expect(files.map((f) => [f.path, f.role])).toEqual([
      ['SKILL.md', 'entry'],
      ['index.md', undefined],
    ]);
  });

  it('returns [] for a missing bundle or an invalid slug', async () => {
    const dir = tmp.make({ 'kb/x/index.md': '' });
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
    const dir = tmp.make({ 'kb/x/index.md': 'm', 'kb/secret.md': 'secret' });
    expect(await readBundleText('kb', 'x', '../secret.md', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', path.join(dir, 'kb', 'secret.md'), dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'index.md\0', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'nope.md', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', '.', dir)).toBeNull();
    expect(await readBundleText('kb', '../x', 'index.md', dir)).toBeNull();
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
    const dir = tmp.make({ 'kb/x/index.md': 'm', 'outside.md': 'outside' });
    try {
      symlinkSync(path.join(dir, 'outside.md'), path.join(dir, 'kb', 'x', 'link.md'));
    } catch {
      return; // symlinks unavailable (e.g. Windows without privileges)
    }
    expect(await readBundleText('kb', 'x', 'link.md', dir)).toBeNull();
    expect(await readBundleText('kb', 'x', 'index.md', dir)).toBe('m');
  });
});

describe('resolveBundleFile', () => {
  it('locates an existing regular file with its real path, size, mtime and mode', async () => {
    const dir = tmp.make({ 'kb/x/concepts/a.md': '# Hello\n' });
    const result = await resolveBundleFile('kb', 'x', 'concepts/a.md', dir);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root).toBe(path.join(dir, 'kb', 'x'));
    expect(result.abs).toBe(path.join(dir, 'kb', 'x', 'concepts', 'a.md'));
    expect(result.realAbs).toBe(realpathSync(result.abs));
    expect(result.size).toBe(8);
    expect(result.mtime).toBeInstanceOf(Date);
    expect(result.mode & 0o400).toBe(0o400);
  });

  it('reports no-entry for a missing entry dir or an invalid slug', async () => {
    const dir = tmp.make({ 'kb/x/index.md': 'm' });
    expect(await resolveBundleFile('kb', 'nope', 'index.md', dir)).toEqual({
      ok: false,
      reason: 'no-entry',
    });
    expect(await resolveBundleFile('kb', '../x', 'index.md', dir)).toEqual({
      ok: false,
      reason: 'no-entry',
    });
    // an entry that is a file, not a directory
    const file = tmp.make({ 'kb/flat': 'x' });
    expect(await resolveBundleFile('kb', 'flat', 'index.md', file)).toEqual({
      ok: false,
      reason: 'no-entry',
    });
  });

  it('reports not-found for a missing file, a directory and the entry dir itself', async () => {
    const dir = tmp.make({ 'kb/x/index.md': 'm', 'kb/x/concepts/a.md': 'a' });
    for (const rel of ['nope.md', 'concepts', '.', 'index.md/x']) {
      expect(await resolveBundleFile('kb', 'x', rel, dir), rel).toEqual({
        ok: false,
        reason: 'not-found',
      });
    }
  });

  it('reports bad-path for traversal, absolute paths and NUL', async () => {
    const dir = tmp.make({ 'kb/x/index.md': 'm', 'kb/secret.md': 'secret' });
    for (const rel of ['../secret.md', path.join(dir, 'kb', 'secret.md'), 'index.md\0']) {
      expect(await resolveBundleFile('kb', 'x', rel, dir), rel).toEqual({
        ok: false,
        reason: 'bad-path',
      });
    }
  });

  it('reports outside for a symlink out of the bundle; a symlink inside resolves to its target', async () => {
    const dir = tmp.make({ 'kb/x/index.md': 'm', 'kb/x/real.md': 'r', 'outside.md': 'outside' });
    try {
      symlinkSync(path.join(dir, 'outside.md'), path.join(dir, 'kb', 'x', 'out.md'));
      symlinkSync(path.join(dir, 'kb', 'x', 'real.md'), path.join(dir, 'kb', 'x', 'in.md'));
    } catch {
      return; // symlinks unavailable (e.g. Windows without privileges)
    }
    expect(await resolveBundleFile('kb', 'x', 'out.md', dir)).toEqual({
      ok: false,
      reason: 'outside',
    });
    const inside = await resolveBundleFile('kb', 'x', 'in.md', dir);
    expect(inside.ok).toBe(true);
    if (!inside.ok) return;
    expect(inside.abs).toBe(path.join(dir, 'kb', 'x', 'in.md'));
    expect(inside.realAbs).toBe(realpathSync(path.join(dir, 'kb', 'x', 'real.md')));
  });
});
