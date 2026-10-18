import { mkdirSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { entryAbsPath, entryFileRelPath, lastModifiedOf } from '../../src/lib/freshness.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const at = (iso: string): Date => new Date(iso);
const touch = (file: string, iso: string): void => utimesSync(file, at(iso), at(iso));

describe('entryAbsPath / entryFileRelPath', () => {
  const root = path.resolve('/data-root');

  it('uses the entry directory for okf and skill datasets', () => {
    expect(entryAbsPath('kb', 'foo', root)).toBe(path.join(root, 'kb', 'foo'));
    expect(entryAbsPath('skill', 'foo', root)).toBe(path.join(root, 'skill', 'foo'));
  });

  it('uses <slug>.yaml for data datasets', () => {
    expect(entryAbsPath('reference', 'foo', root)).toBe(path.join(root, 'reference', 'foo.yaml'));
    expect(entryAbsPath('context', 'foo', root)).toBe(path.join(root, 'context', 'foo.yaml'));
  });

  it('returns the posix entry file path per kind', () => {
    expect(entryFileRelPath('kb', 'foo')).toBe('kb/foo/index.md');
    expect(entryFileRelPath('project', 'foo')).toBe('project/foo/index.md');
    expect(entryFileRelPath('skill', 'foo')).toBe('skill/foo/SKILL.md');
    expect(entryFileRelPath('reference', 'foo')).toBe('reference/foo.yaml');
    expect(entryFileRelPath('context', 'foo')).toBe('context/foo.yaml');
  });
});

describe('lastModifiedOf', () => {
  it('returns a file mtime', async () => {
    const dir = tmp.make({ 'reference/a.yaml': 'name: a\n' });
    const file = path.join(dir, 'reference', 'a.yaml');
    touch(file, '2026-01-02T03:04:05.000Z');
    expect((await lastModifiedOf(file)).toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });

  it('returns the newest mtime of any file below a directory, recursively', async () => {
    const dir = tmp.make({
      'kb/x/index.md': 'a',
      'kb/x/concepts/deep/new.md': 'b',
      'kb/x/old.md': 'c',
    });
    const root = path.join(dir, 'kb', 'x');
    touch(path.join(root, 'index.md'), '2026-01-01T00:00:00.000Z');
    touch(path.join(root, 'old.md'), '2025-01-01T00:00:00.000Z');
    touch(path.join(root, 'concepts', 'deep', 'new.md'), '2026-03-01T12:00:00.000Z');
    expect((await lastModifiedOf(root)).toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });

  it('ignores dot-files and dot-directories at every level', async () => {
    const dir = tmp.make({
      'kb/x/index.md': 'a',
      'kb/x/.DS_Store': 'junk',
      'kb/x/.git/HEAD': 'junk',
      'kb/x/concepts/.hidden.md': 'junk',
    });
    const root = path.join(dir, 'kb', 'x');
    touch(path.join(root, 'index.md'), '2026-01-01T00:00:00.000Z');
    touch(path.join(root, '.DS_Store'), '2027-01-01T00:00:00.000Z');
    touch(path.join(root, '.git', 'HEAD'), '2027-01-01T00:00:00.000Z');
    touch(path.join(root, 'concepts', '.hidden.md'), '2027-01-01T00:00:00.000Z');
    expect((await lastModifiedOf(root)).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns the epoch for a missing path', async () => {
    const dir = tmp.make();
    expect(await lastModifiedOf(path.join(dir, 'nope'))).toEqual(new Date(0));
  });

  it('falls back to the directory mtime when it holds no files', async () => {
    const dir = tmp.make();
    const empty = path.join(dir, 'empty');
    mkdirSync(empty);
    touch(empty, '2026-05-05T00:00:00.000Z');
    expect((await lastModifiedOf(empty)).toISOString()).toBe('2026-05-05T00:00:00.000Z');
  });
});
