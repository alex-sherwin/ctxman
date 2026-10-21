import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  blockingFor,
  checkOutputDir,
  inspectOutputDir,
  isSafeEntryPath,
  parseDirManifest,
  serializeDirManifest,
} from '../../src/lib/inflate/output-dir.ts';
import type { InflateDirManifest } from '../../src/lib/inflate/material-plan.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const sha = 'a'.repeat(64);
const manifest = (over: Partial<InflateDirManifest> = {}): InflateDirManifest => ({
  format: 'ctxman-inflate',
  version: 1,
  recipe: 'demo',
  target: 'claude-code',
  contextFile: 'AGENTS.md',
  generatedAt: '2026-10-17T12:00:00.000Z',
  jobId: 'a4752759-d16a-4199-aa1f-1440b492a804',
  entries: [
    {
      path: '.claude/skills/okf-authoring',
      type: 'copy',
      key: 'skill/okf-authoring',
      source: '/s',
    },
    { path: 'AGENTS.md', type: 'file', role: 'context', sha256: sha },
    { path: 'kb/ctxman', type: 'symlink', key: 'kb/ctxman', target: '/d/kb/ctxman' },
    {
      path: 'repos/docs',
      type: 'clone',
      key: 'reference/docs',
      uri: 'https://example.invalid/docs.git',
      branch: null,
      depth: 1,
      sparse: 'docs',
      newBranch: 'work',
    },
    {
      path: 'repos/local',
      type: 'worktree',
      key: 'reference/local',
      repo: '/src/local',
      branch: 'trunk',
      newBranch: null,
    },
    {
      path: 'skills/x',
      type: 'skill',
      key: 'reference/x',
      uri: 'https://e.invalid/x.git',
      subpath: null,
    },
  ],
  ...over,
});

describe('checkOutputDir', () => {
  // Fixed roots so the rules do not depend on where the tests run.
  const dataDir = path.resolve(path.sep, 'srv', 'ctxman', 'data');
  const repoRoot = path.resolve(path.sep, 'srv', 'ctxman');
  const homeDir = path.resolve(path.sep, 'home', 'me');
  const opts = { dataDir, repoRoot, homeDir };
  const message = (raw: unknown): string => {
    const r = checkOutputDir(raw, opts);
    if (r.ok) throw new Error(`expected a failure for ${String(raw)}`);
    return r.message;
  };

  it('requires a non-blank string, at most 1024 characters, without NUL', () => {
    expect(message(undefined)).toBe('dir is required');
    expect(message(3)).toBe('dir is required');
    expect(message('   ')).toBe('dir is required');
    expect(message(`/${'a'.repeat(1030)}`)).toBe('dir is not valid');
    expect(message('/tmp/a\0b')).toBe('dir is not valid');
  });

  it('expands ~ and ~/x with the injected home directory, refuses ~user', () => {
    expect(message('~')).toBe('dir must not be your home directory');
    const nested = checkOutputDir('~/ctxman-inflate/demo', opts);
    expect(nested).toEqual({
      ok: true,
      abs: path.join(homeDir, 'ctxman-inflate', 'demo'),
      input: '~/ctxman-inflate/demo',
    });
    expect(checkOutputDir('~\\ctxman-inflate\\demo', opts)).toMatchObject({
      ok: true,
      abs: path.join(homeDir, 'ctxman-inflate', 'demo'),
    });
    expect(message('~other/x')).toBe('dir must be absolute or start with ~/');
  });

  it('requires an absolute path', () => {
    expect(message('relative/dir')).toBe('dir must be absolute or start with ~/');
    expect(message('./x')).toBe('dir must be absolute or start with ~/');
  });

  it('refuses a filesystem root and the home directory', () => {
    expect(message(path.parse(homeDir).root)).toBe('dir must not be a filesystem root');
    expect(message(homeDir)).toBe('dir must not be your home directory');
    expect(message(`${homeDir}${path.sep}`)).toBe('dir must not be your home directory');
  });

  it('refuses node_modules and .git segments (any case)', () => {
    expect(message('/work/node_modules/x')).toBe('dir must not be inside node_modules or .git');
    expect(message('/work/.GIT/x')).toBe('dir must not be inside node_modules or .git');
    expect(checkOutputDir('/work/.github/x', opts).ok).toBe(true);
  });

  it('refuses the data directory, anything inside it and anything containing it', () => {
    const text = 'dir must not contain or be inside the data directory';
    expect(message(dataDir)).toBe(text);
    expect(message(path.join(dataDir, 'kb'))).toBe(text);
    // the data directory lives in the repository, so the repository root contains it too
    expect(message(repoRoot)).toBe(text);
  });

  it('refuses the ctxman repository, inside it and containing it', () => {
    const text = 'dir must not contain or be inside the ctxman repository';
    const elsewhere = { ...opts, dataDir: path.resolve(path.sep, 'srv', 'other-data') };
    const repoMessage = (raw: string): string => {
      const r = checkOutputDir(raw, elsewhere);
      if (r.ok) throw new Error(`expected a failure for ${raw}`);
      return r.message;
    };
    expect(repoMessage(repoRoot)).toBe(text);
    expect(repoMessage(path.join(repoRoot, 'out', 'demo'))).toBe(text);
    expect(repoMessage(path.resolve(path.sep, 'srv'))).toBe(
      'dir must not contain or be inside the data directory',
    );
    expect(checkOutputDir('/srv/ctxman-inflate/demo', elsewhere).ok).toBe(true);
    expect(checkOutputDir('/srv/ctxman-inflate/demo', opts).ok).toBe(true);
  });

  it('accepts a normal absolute directory and trims the input', () => {
    const r = checkOutputDir('  /work/demo/  ', opts);
    expect(r).toEqual({ ok: true, abs: path.resolve('/work/demo'), input: '/work/demo/' });
  });

  it('defaults to the real data dir, repo root and home directory', () => {
    const inside = checkOutputDir(path.join(process.cwd(), 'out', 'x'));
    expect(inside.ok).toBe(false);
    expect(checkOutputDir(os.homedir())).toMatchObject({ ok: false });
    expect(checkOutputDir(path.join(os.tmpdir(), 'ctxman-check-ok'))).toMatchObject({ ok: true });
  });
});

describe('inspectOutputDir + blockingFor', () => {
  const opts = { dataDir: '/nowhere/data', repoRoot: '/nowhere/repo', homeDir: '/nowhere/home' };
  const checkOf = (abs: string) => checkOutputDir(abs, opts);
  const blockingOf = async (abs: string, allowNonEmpty = false) =>
    blockingFor(checkOf(abs), await inspectOutputDir(abs), allowNonEmpty, opts);

  it('a missing directory is fine and reports its projected real path', async () => {
    const root = tmp.make();
    const abs = path.join(root, 'a', 'b');
    const insp = await inspectOutputDir(abs);
    expect(insp).toMatchObject({ exists: false, kind: null, entries: [], manifestStatus: 'none' });
    expect(insp.realAbs).toBe(path.join(await realRoot(root), 'a', 'b'));
    expect(await blockingOf(abs)).toEqual([]);
  });

  it('an empty directory, or one with only OS litter, is fine', async () => {
    const root = tmp.make({ '.DS_Store': 'x', 'Thumbs.db': 'x', 'desktop.ini': 'x' });
    const insp = await inspectOutputDir(root);
    expect(insp).toMatchObject({ exists: true, kind: 'dir', entries: [], manifestStatus: 'none' });
    expect(await blockingOf(root)).toEqual([]);
  });

  it('a non-empty directory without a manifest blocks unless allowNonEmpty', async () => {
    const root = tmp.make({ 'notes.txt': 'hello' });
    const blocked = await blockingOf(root);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.code).toBe('dir-not-empty');
    expect(blocked[0]?.message).toBe(
      `${root} is not empty and was not created by ctxman; allow a non-empty directory to use it`,
    );
    expect(await blockingOf(root, true)).toEqual([]);
  });

  it('a readable manifest makes a non-empty directory usable and is returned', async () => {
    const root = tmp.make({
      'notes.txt': 'hello',
      '.ctxman-inflate.json': serializeDirManifest(manifest()),
    });
    const insp = await inspectOutputDir(root);
    expect(insp.manifestStatus).toBe('ok');
    expect(insp.manifest?.recipe).toBe('demo');
    expect(insp.manifest?.entries).toHaveLength(6);
    expect(await blockingOf(root)).toEqual([]);
  });

  it('an unreadable or unknown manifest blocks unless allowNonEmpty', async () => {
    const bad = tmp.make({ '.ctxman-inflate.json': '{not json' });
    expect((await inspectOutputDir(bad)).manifestStatus).toBe('invalid');
    const blocked = await blockingOf(bad);
    expect(blocked[0]?.code).toBe('manifest-invalid');
    expect(blocked[0]?.message).toBe(
      `${bad}/.ctxman-inflate.json cannot be read; allow a non-empty directory to run anyway (nothing will be removed)`,
    );
    expect(await blockingOf(bad, true)).toEqual([]);

    const future = tmp.make({
      '.ctxman-inflate.json': JSON.stringify({ ...manifest(), version: 2 }),
    });
    expect((await inspectOutputDir(future)).manifestStatus).toBe('unknown-version');
    expect((await blockingOf(future))[0]?.code).toBe('manifest-invalid');
    expect((await inspectOutputDir(future)).manifest).toBeNull();
  });

  it('a file at the path is dir-not-directory', async () => {
    const root = tmp.make({ afile: 'x' });
    const abs = path.join(root, 'afile');
    const insp = await inspectOutputDir(abs);
    expect(insp).toMatchObject({ exists: true, kind: 'file' });
    expect(await blockingOf(abs)).toEqual([
      { code: 'dir-not-directory', message: `${abs} exists and is not a directory` },
    ]);
  });

  it('a failed check is bad-dir', () => {
    expect(blockingFor(checkOf('relative'), null, false, opts)).toEqual([
      { code: 'bad-dir', message: 'dir must be absolute or start with ~/' },
    ]);
  });

  it('a symlinked directory is re-checked through its real path', async () => {
    const root = tmp.make();
    const real = path.join(root, 'repo', 'node_modules', 'inside');
    mkdirSync(real, { recursive: true });
    const link = path.join(root, 'link');
    symlinkSync(real, link, 'dir');
    const blocked = await blockingOf(link);
    expect(blocked[0]?.code).toBe('bad-dir');
    expect(blocked[0]?.message).toContain('node_modules');

    // a symlinked ANCESTOR of a missing directory too
    const through = path.join(link, 'new');
    const missing = await blockingOf(through);
    expect(missing[0]?.code).toBe('bad-dir');
  });

  it('a symlink to the data directory is refused through its real path', async () => {
    const root = tmp.make({ 'data/kb/x.md': 'x' });
    const dataDir = path.join(root, 'data');
    const link = path.join(root, 'elsewhere');
    symlinkSync(dataDir, link, 'dir');
    // the configured data dir is spelled through a different symlink than the checked one
    const alias = path.join(root, 'alias');
    symlinkSync(dataDir, alias, 'dir');
    const optsReal = {
      dataDir: alias,
      repoRoot: path.join(root, 'repo'),
      homeDir: '/nowhere/home',
    };
    const check = checkOutputDir(link, optsReal);
    expect(check.ok).toBe(true);
    const blocked = blockingFor(check, await inspectOutputDir(link), true, optsReal);
    expect(blocked[0]?.code).toBe('bad-dir');
    expect(blocked[0]?.message).toContain('data directory');
  });
});

async function realRoot(dir: string): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(dir);
}

describe('parseDirManifest', () => {
  const dir = path.resolve('/work/demo');
  const parse = (value: unknown) => parseDirManifest(JSON.stringify(value), dir);

  it('round-trips serializeDirManifest (2-space indent, trailing newline, key order)', () => {
    const text = serializeDirManifest(manifest());
    expect(text.endsWith('}\n')).toBe(true);
    expect(
      text.startsWith('{\n  "format": "ctxman-inflate",\n  "version": 1,\n  "recipe": "demo",'),
    ).toBe(true);
    const parsed = parseDirManifest(text, dir);
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') expect(parsed.manifest).toEqual(manifest());
  });

  it('writes newBranch after sparse and the worktree keys in order', () => {
    const text = serializeDirManifest(manifest());
    expect(text).toContain('"sparse": "docs",\n      "newBranch": "work"\n');
    expect(text).toContain(
      '"type": "worktree",\n      "key": "reference/local",\n      "repo": "/src/local",\n      "branch": "trunk",\n      "newBranch": null\n',
    );
  });

  it('reads a clone entry written before work branches (no newBranch) as newBranch null', () => {
    const old = {
      ...manifest(),
      entries: [
        {
          path: 'repos/docs',
          type: 'clone',
          key: 'reference/docs',
          uri: 'u',
          branch: null,
          depth: 1,
          sparse: null,
        },
      ],
    };
    const parsed = parse(old);
    expect(parsed.status).toBe('ok');
    if (parsed.status === 'ok') {
      expect(parsed.manifest.entries).toEqual([{ ...old.entries[0], newBranch: null }]);
    }
    // a worktree entry is strict: every key, nothing else
    const worktree = { path: 'repos/w', type: 'worktree', key: 'k', repo: '/r', branch: null };
    expect(parse({ ...manifest(), entries: [worktree] }).status).toBe('invalid');
    expect(
      parse({ ...manifest(), entries: [{ ...worktree, newBranch: null, extra: 1 }] }).status,
    ).toBe('invalid');
    expect(parse({ ...manifest(), entries: [{ ...worktree, newBranch: null }] }).status).toBe('ok');
  });

  it('reports invalid JSON, non-objects and schema problems as invalid', () => {
    expect(parseDirManifest('{', dir).status).toBe('invalid');
    expect(parse([]).status).toBe('invalid');
    expect(parse(null).status).toBe('invalid');
    expect(parse({ ...manifest(), recipe: 3 }).status).toBe('invalid');
    expect(parse({ ...manifest(), extra: true }).status).toBe('invalid');
    expect(parse({ ...manifest(), entries: [{ path: 'x', type: 'weird' }] }).status).toBe(
      'invalid',
    );
    expect(
      parse({
        ...manifest(),
        entries: [{ path: 'x', type: 'file', role: 'context', sha256: 'zz' }],
      }).status,
    ).toBe('invalid');
  });

  it('reports another format or version as unknown-version', () => {
    expect(parse({ ...manifest(), version: 2 }).status).toBe('unknown-version');
    expect(parse({ ...manifest(), format: 'something-else' }).status).toBe('unknown-version');
  });

  it('rejects unsafe or duplicate entry paths', () => {
    const entry = (p: string) => ({ path: p, type: 'symlink', key: 'k', target: '/t' });
    for (const bad of [
      '../x',
      '/abs',
      'a/../../x',
      '',
      '.',
      'a//b',
      'a\\b',
      '.git/x',
      'repos/.git',
      '.ctxman-inflate.json',
    ]) {
      expect(parse({ ...manifest(), entries: [entry(bad)] }).status, bad).toBe('invalid');
    }
    expect(parse({ ...manifest(), entries: [entry('a'), entry('a')] }).status).toBe('invalid');
    expect(parse({ ...manifest(), entries: [entry('.gitignore'), entry('a/b')] }).status).toBe(
      'ok',
    );
  });

  it('isSafeEntryPath', () => {
    expect(isSafeEntryPath(dir, 'kb/ctxman')).toBe(true);
    expect(isSafeEntryPath(dir, '../etc')).toBe(false);
    expect(isSafeEntryPath(dir, 'a/./b')).toBe(false);
  });

  it('writeFileSync-ed manifests are read from disk by inspectOutputDir', async () => {
    const root = tmp.make();
    writeFileSync(path.join(root, '.ctxman-inflate.json'), serializeDirManifest(manifest()));
    const insp = await inspectOutputDir(root);
    expect(insp.manifestStatus).toBe('ok');
    expect(insp.entries).toEqual(['.ctxman-inflate.json']);
  });
});
