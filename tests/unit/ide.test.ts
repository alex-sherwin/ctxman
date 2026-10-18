import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildIdeInvocation,
  IDE_COMMAND_ENV,
  ideTargetFor,
  ideTargetForDir,
  launchIde,
  platformFallbacks,
  resolveIdeCommand,
} from '../../src/lib/ide.ts';
import { serializeDirManifest } from '../../src/lib/inflate/output-dir.ts';
import type { InflateDirManifest } from '../../src/lib/inflate/material-plan.ts';
import { trackTemp, validKbBundle } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const posixOnly = process.platform === 'win32' ? it.skip : it;

/** Writes `rel` below `dir` with the given mode and returns its absolute path. */
function makeFile(dir: string, rel: string, mode: number, content = '#!/bin/sh\n'): string {
  const abs = path.join(dir, ...rel.split('/'));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  chmodSync(abs, mode);
  return abs;
}

describe('resolveIdeCommand', () => {
  posixOnly('finds an executable `code` in PATH and skips a non-executable one earlier', () => {
    const dir = tmp.make();
    makeFile(dir, 'first/code', 0o644);
    const wanted = makeFile(dir, 'second/code', 0o755);
    const env = { PATH: `${path.join(dir, 'first')}:${path.join(dir, 'second')}` };
    expect(resolveIdeCommand({ env, platform: 'linux', cwd: dir, fallbacks: [] })).toEqual({
      ok: true,
      command: wanted,
    });
  });

  posixOnly('matches the PATH key case-insensitively', () => {
    const dir = tmp.make();
    const wanted = makeFile(dir, 'bin/code', 0o755);
    const env = { Path: path.join(dir, 'bin') };
    expect(resolveIdeCommand({ env, platform: 'linux', cwd: dir, fallbacks: [] })).toEqual({
      ok: true,
      command: wanted,
    });
  });

  posixOnly('reports what was tried when nothing is found', () => {
    const dir = tmp.make();
    const result = resolveIdeCommand({
      env: { PATH: path.join(dir, 'empty') },
      platform: 'linux',
      cwd: dir,
      fallbacks: [path.join(dir, 'fallback-code')],
    });
    expect(result).toEqual({
      ok: false,
      tried: [path.join(dir, 'empty', 'code'), path.join(dir, 'fallback-code')],
    });
  });

  posixOnly('uses fallbacks only when the override is unset and PATH has no code', () => {
    const dir = tmp.make();
    const fallback = makeFile(dir, 'fb/code', 0o755);
    const inPath = makeFile(dir, 'bin/code', 0o755);
    const env = { PATH: path.join(dir, 'bin') };
    expect(resolveIdeCommand({ env, platform: 'linux', cwd: dir, fallbacks: [fallback] })).toEqual({
      ok: true,
      command: inPath,
    });
    expect(
      resolveIdeCommand({ env: { PATH: '' }, platform: 'linux', cwd: dir, fallbacks: [fallback] }),
    ).toEqual({ ok: true, command: fallback });
    // a blank override counts as unset
    expect(
      resolveIdeCommand({
        env: { PATH: '', [IDE_COMMAND_ENV]: '   ' },
        platform: 'linux',
        cwd: dir,
        fallbacks: [fallback],
      }),
    ).toEqual({ ok: true, command: fallback });
  });

  posixOnly('an override name is searched in PATH instead of `code`', () => {
    const dir = tmp.make();
    makeFile(dir, 'bin/code', 0o755);
    const cursor = makeFile(dir, 'bin/cursor', 0o755);
    const env = { PATH: path.join(dir, 'bin'), [IDE_COMMAND_ENV]: 'cursor' };
    expect(resolveIdeCommand({ env, platform: 'linux', cwd: dir, fallbacks: [] })).toEqual({
      ok: true,
      command: cursor,
    });
  });

  posixOnly('an override path is used as is, a relative one resolves against cwd', () => {
    const dir = tmp.make();
    const abs = makeFile(dir, 'tools/my-ide', 0o755);
    expect(
      resolveIdeCommand({ env: { [IDE_COMMAND_ENV]: abs }, platform: 'linux', cwd: '/' }),
    ).toEqual({ ok: true, command: abs });
    expect(
      resolveIdeCommand({
        env: { [IDE_COMMAND_ENV]: './tools/my-ide' },
        platform: 'linux',
        cwd: dir,
      }),
    ).toEqual({ ok: true, command: abs });
  });

  posixOnly('a missing override never falls back to code in PATH or the fallbacks', () => {
    const dir = tmp.make();
    makeFile(dir, 'bin/code', 0o755);
    const fallback = makeFile(dir, 'fb/code', 0o755);
    const missing = path.join(dir, 'nope', 'ide');
    const byPath = resolveIdeCommand({
      env: { PATH: path.join(dir, 'bin'), [IDE_COMMAND_ENV]: missing },
      platform: 'linux',
      cwd: dir,
      fallbacks: [fallback],
    });
    expect(byPath).toEqual({ ok: false, tried: [missing] });
    const byName = resolveIdeCommand({
      env: { PATH: path.join(dir, 'bin'), [IDE_COMMAND_ENV]: 'not-installed' },
      platform: 'linux',
      cwd: dir,
      fallbacks: [fallback],
    });
    expect(byName.ok).toBe(false);
  });

  posixOnly('a directory or a non-executable override is not usable', () => {
    const dir = tmp.make();
    makeFile(dir, 'plain/ide', 0o644);
    const asDir = resolveIdeCommand({
      env: { [IDE_COMMAND_ENV]: path.join(dir, 'plain') },
      platform: 'linux',
    });
    const plain = resolveIdeCommand({
      env: { [IDE_COMMAND_ENV]: path.join(dir, 'plain', 'ide') },
      platform: 'linux',
    });
    expect(asDir.ok).toBe(false);
    expect(plain.ok).toBe(false);
  });

  it('win32: finds code.cmd through PATHEXT in a ;-separated PATH (no executable bit needed)', () => {
    const dir = tmp.make();
    const wanted = makeFile(dir, 'bin/code.cmd', 0o644);
    const env = {
      Path: `${path.join(dir, 'other')};${path.join(dir, 'bin')}`,
      PATHEXT: '.exe;.cmd',
    };
    expect(resolveIdeCommand({ env, platform: 'win32', cwd: dir, fallbacks: [] })).toEqual({
      ok: true,
      command: wanted,
    });
  });

  it('win32: a name that already ends with a PATHEXT extension is tried as is; default PATHEXT', () => {
    const dir = tmp.make();
    const exe = makeFile(dir, 'bin/ide.exe', 0o644);
    const cmd = makeFile(dir, 'bin/other.CMD', 0o644);
    const base = { PATH: path.join(dir, 'bin') };
    expect(
      resolveIdeCommand({
        env: { ...base, [IDE_COMMAND_ENV]: 'ide.exe' },
        platform: 'win32',
        cwd: dir,
      }),
    ).toEqual({ ok: true, command: exe });
    expect(
      resolveIdeCommand({
        env: { ...base, [IDE_COMMAND_ENV]: 'other' },
        platform: 'win32',
        cwd: dir,
      }),
    ).toEqual({ ok: true, command: cmd });
  });

  it('win32: strips quotes around PATH entries', () => {
    const dir = tmp.make();
    const wanted = makeFile(dir, 'my bin/code.exe', 0o644);
    const env = { PATH: `"${path.join(dir, 'my bin')}"`, PATHEXT: '.exe' };
    expect(resolveIdeCommand({ env, platform: 'win32', cwd: dir, fallbacks: [] })).toEqual({
      ok: true,
      command: wanted,
    });
  });
});

describe('platformFallbacks', () => {
  it('lists the well-known VS Code locations per platform', () => {
    expect(platformFallbacks('darwin', {})).toEqual([
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
    ]);
    expect(platformFallbacks('linux', {})).toEqual(['/usr/bin/code', '/snap/bin/code']);
    expect(platformFallbacks('freebsd', {})).toEqual([]);
  });

  it('win32 uses LOCALAPPDATA and ProgramFiles when set', () => {
    expect(platformFallbacks('win32', {})).toEqual([]);
    expect(
      platformFallbacks('win32', {
        LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local',
        ProgramFiles: 'C:\\PF',
      }),
    ).toEqual([
      'C:\\Users\\a\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      'C:\\PF\\Microsoft VS Code\\bin\\code.cmd',
    ]);
  });
});

describe('buildIdeInvocation', () => {
  const target = { root: '/data/kb/x', file: '/data/kb/x/index.md' };

  it('posix: runs the command directly with [root, file] and nothing else', () => {
    expect(buildIdeInvocation('/usr/local/bin/code', target, 'darwin')).toEqual({
      file: '/usr/local/bin/code',
      args: ['/data/kb/x', '/data/kb/x/index.md'],
      display: ['/usr/local/bin/code', '/data/kb/x', '/data/kb/x/index.md'],
    });
    expect(buildIdeInvocation('/usr/bin/code', target, 'linux').windowsVerbatimArguments).toBe(
      undefined,
    );
  });

  it('a folder alone (an inflated directory): args are [root] and nothing else', () => {
    expect(buildIdeInvocation('/usr/local/bin/code', { root: '/work/dir' }, 'linux')).toEqual({
      file: '/usr/local/bin/code',
      args: ['/work/dir'],
      display: ['/usr/local/bin/code', '/work/dir'],
    });
    expect(
      buildIdeInvocation('C:\\Code\\code.cmd', { root: 'C:\\work dir' }, 'win32', {
        ComSpec: 'cmd.exe',
      }),
    ).toEqual({
      file: 'cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Code\\code.cmd" "C:\\work dir""'],
      windowsVerbatimArguments: true,
      display: ['C:\\Code\\code.cmd', 'C:\\work dir'],
    });
  });

  it('win32 + .exe: direct, no cmd.exe', () => {
    const winTarget = { root: 'C:\\data\\kb\\x', file: 'C:\\data\\kb\\x\\index.md' };
    expect(buildIdeInvocation('C:\\Code\\code.exe', winTarget, 'win32', {})).toEqual({
      file: 'C:\\Code\\code.exe',
      args: ['C:\\data\\kb\\x', 'C:\\data\\kb\\x\\index.md'],
      display: ['C:\\Code\\code.exe', 'C:\\data\\kb\\x', 'C:\\data\\kb\\x\\index.md'],
    });
  });

  it('win32 + .cmd/.bat: ComSpec with /d /s /c, one quoted command line, verbatim arguments', () => {
    const winTarget = { root: 'C:\\data\\kb\\x y', file: 'C:\\data\\kb\\x y\\index.md' };
    const expected = {
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        '""C:\\Code\\bin\\code.cmd" "C:\\data\\kb\\x y" "C:\\data\\kb\\x y\\index.md""',
      ],
      windowsVerbatimArguments: true,
      display: ['C:\\Code\\bin\\code.cmd', 'C:\\data\\kb\\x y', 'C:\\data\\kb\\x y\\index.md'],
    };
    const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
    expect(buildIdeInvocation('C:\\Code\\bin\\code.cmd', winTarget, 'win32', env)).toEqual(
      expected,
    );
    expect(buildIdeInvocation('C:\\Code\\bin\\CODE.BAT', winTarget, 'win32', env).file).toBe(
      expected.file,
    );
    expect(buildIdeInvocation('C:\\Code\\bin\\code.cmd', winTarget, 'win32', {}).file).toBe(
      'cmd.exe',
    );
  });

  it('win32 + .cmd: rejects characters cmd.exe would reinterpret', () => {
    for (const bad of ['a"b', 'a%PATH%b', 'a\nb', 'a\rb']) {
      const winTarget = { root: `C:\\data\\${bad}`, file: 'C:\\data\\x.md' };
      expect(() => buildIdeInvocation('C:\\c.cmd', winTarget, 'win32', {}), bad).toThrow(
        /unsupported character/,
      );
      expect(() => buildIdeInvocation(`C:\\${bad}.cmd`, target, 'win32', {}), bad).toThrow(
        /unsupported character/,
      );
    }
    // the same characters are fine without cmd.exe
    expect(() =>
      buildIdeInvocation('/bin/code', { root: '/a%b', file: '/a%b/x.md' }, 'linux'),
    ).not.toThrow();
  });
});

describe('ideTargetFor', () => {
  function dataTree(): string {
    return tmp.make({
      ...validKbBundle('demo'),
      'skill/my-skill/SKILL.md': '---\nname: my-skill\ndescription: d\n---\n',
      'skill/my-skill/scripts/run.py': 'print(1)\n',
      'reference/repo.yaml': 'name: repo\n',
      'context/ctx.yaml': 'name: ctx\n',
      'recipe/brief.yaml': 'name: brief\n',
    });
  }

  it('okf: the entry dir and index.md by default', async () => {
    const dir = dataTree();
    expect(await ideTargetFor('kb', 'demo', undefined, dir)).toEqual({
      ok: true,
      target: {
        root: path.join(dir, 'kb', 'demo'),
        file: path.join(dir, 'kb', 'demo', 'index.md'),
      },
    });
  });

  it('skill: SKILL.md by default', async () => {
    const dir = dataTree();
    expect(await ideTargetFor('skill', 'my-skill', undefined, dir)).toEqual({
      ok: true,
      target: {
        root: path.join(dir, 'skill', 'my-skill'),
        file: path.join(dir, 'skill', 'my-skill', 'SKILL.md'),
      },
    });
  });

  it('an explicit bundle-relative path (any existing regular file)', async () => {
    const dir = dataTree();
    expect(await ideTargetFor('kb', 'demo', 'concepts/one.md', dir)).toEqual({
      ok: true,
      target: {
        root: path.join(dir, 'kb', 'demo'),
        file: path.join(dir, 'kb', 'demo', 'concepts', 'one.md'),
      },
    });
    const script = await ideTargetFor('skill', 'my-skill', 'scripts/run.py', dir);
    expect(script.ok).toBe(true);
  });

  it('yaml datasets: the data dir and <ds>/<slug>.yaml', async () => {
    const dir = dataTree();
    for (const ds of ['reference', 'context', 'recipe'] as const) {
      const slug = { reference: 'repo', context: 'ctx', recipe: 'brief' }[ds];
      expect(await ideTargetFor(ds, slug, undefined, dir)).toEqual({
        ok: true,
        target: { root: dir, file: path.join(dir, ds, `${slug}.yaml`) },
      });
    }
  });

  it('a path for a yaml dataset is bad-path', async () => {
    const dir = dataTree();
    const result = await ideTargetFor('reference', 'repo', 'x.md', dir);
    expect(result).toMatchObject({ ok: false, error: 'bad-path' });
  });

  it('unsafe paths are bad-path; missing entries and files are not-found', async () => {
    const dir = dataTree();
    for (const rel of ['../index.md', '/etc/passwd', 'a\0b']) {
      expect(await ideTargetFor('kb', 'demo', rel, dir), rel).toMatchObject({
        ok: false,
        error: 'bad-path',
      });
    }
    expect(await ideTargetFor('kb', '../demo', undefined, dir)).toMatchObject({
      ok: false,
      error: 'bad-path',
    });
    for (const [ds, slug, rel] of [
      ['kb', 'nope', undefined],
      ['kb', 'demo', 'concepts/missing.md'],
      ['kb', 'demo', 'concepts'],
      ['skill', 'nope', undefined],
      ['reference', 'nope', undefined],
      ['context', 'nope', undefined],
      ['recipe', 'nope', undefined],
    ] as const) {
      expect(await ideTargetFor(ds, slug, rel, dir), `${ds}/${slug}/${rel}`).toMatchObject({
        ok: false,
        error: 'not-found',
      });
    }
  });
});

describe('ideTargetForDir', () => {
  const manifest: InflateDirManifest = {
    format: 'ctxman-inflate',
    version: 1,
    recipe: 'demo',
    target: 'claude-code',
    contextFile: 'LLM_CONTEXT.md',
    generatedAt: '2026-01-01T00:00:00.000Z',
    jobId: '0b9f3c1e-5a7d-4e21-9c0a-3f6d8b2a1e47',
    entries: [],
  };

  it('a directory with a valid manifest opens as a folder alone', async () => {
    const dir = tmp.make({ '.ctxman-inflate.json': serializeDirManifest(manifest) });
    expect(await ideTargetForDir(dir)).toEqual({ ok: true, target: { root: path.resolve(dir) } });
  });

  it('a directory without a manifest, with an unreadable one or a missing one is not-found', async () => {
    const plain = tmp.make({ 'README.md': 'x' });
    expect(await ideTargetForDir(plain)).toEqual({
      ok: false,
      error: 'not-found',
      message: 'not an inflated directory',
    });
    const broken = tmp.make({ '.ctxman-inflate.json': '{ nope' });
    expect((await ideTargetForDir(broken)).ok).toBe(false);
    const foreign = tmp.make({
      '.ctxman-inflate.json': JSON.stringify({ format: 'other', version: 1 }),
    });
    expect((await ideTargetForDir(foreign)).ok).toBe(false);
    const missing = path.join(tmp.make(), 'does-not-exist');
    expect(await ideTargetForDir(missing)).toMatchObject({ ok: false, error: 'not-found' });
  });

  it('a file at the path is not-found', async () => {
    const dir = tmp.make({ 'file.json': serializeDirManifest(manifest) });
    expect(await ideTargetForDir(path.join(dir, 'file.json'))).toMatchObject({
      ok: false,
      error: 'not-found',
    });
  });

  it('unsafe directories are bad-path, whatever they contain', async () => {
    const dataDir = tmp.make({ '.ctxman-inflate.json': serializeDirManifest(manifest) });
    const inside = path.join(dataDir, 'sub');
    mkdirSync(inside);
    writeFileSync(path.join(inside, '.ctxman-inflate.json'), serializeDirManifest(manifest));
    for (const input of ['', '   ', 'relative/dir', './x', '~someone/x', '/']) {
      expect(await ideTargetForDir(input), input).toMatchObject({ ok: false, error: 'bad-path' });
    }
    expect(await ideTargetForDir(inside, { dataDir })).toMatchObject({
      ok: false,
      error: 'bad-path',
    });
    expect(await ideTargetForDir(dataDir, { dataDir })).toMatchObject({
      ok: false,
      error: 'bad-path',
    });
  });

  it('expands ~ with the given home directory', async () => {
    const home = tmp.make();
    const work = path.join(home, 'work');
    mkdirSync(work);
    writeFileSync(path.join(work, '.ctxman-inflate.json'), serializeDirManifest(manifest));
    expect(await ideTargetForDir('~/work', { homeDir: home })).toEqual({
      ok: true,
      target: { root: work },
    });
  });
});

describe('launchIde', () => {
  posixOnly('spawns the command detached with [root, file] and resolves on spawn', async () => {
    const dir = tmp.make();
    const record = path.join(dir, 'calls.jsonl');
    const script = makeFile(
      dir,
      'bin/fake-ide',
      0o755,
      `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.CTXMAN_IDE_RECORD, JSON.stringify(process.argv.slice(2)) + '\\n');\n`,
    );
    const target = { root: dir, file: path.join(dir, 'index.md') };
    process.env.CTXMAN_IDE_RECORD = record;
    try {
      await launchIde(buildIdeInvocation(script, target, 'linux'), dir);
      const deadline = Date.now() + 2000;
      while (!existsSync(record) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
    } finally {
      delete process.env.CTXMAN_IDE_RECORD;
    }
    expect(
      readFileSync(record, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l)),
    ).toEqual([[target.root, target.file]]);
  });

  posixOnly(
    'rejects with EACCES for a non-executable file and ENOENT for a missing one',
    async () => {
      const dir = tmp.make();
      const plain = makeFile(dir, 'plain', 0o644);
      const target = { root: dir, file: path.join(dir, 'index.md') };
      await expect(
        launchIde(buildIdeInvocation(plain, target, 'linux'), dir),
      ).rejects.toMatchObject({
        code: 'EACCES',
      });
      await expect(
        launchIde(buildIdeInvocation(path.join(dir, 'missing'), target, 'linux'), dir),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
});
