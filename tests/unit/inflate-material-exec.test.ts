import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeSteps, probeTools, sha256Of } from '../../src/lib/inflate/material-exec.ts';
import type { ExecuteContext } from '../../src/lib/inflate/material-exec.ts';
import type {
  InflateDirManifest,
  ManifestEntry,
  MaterialStep,
  MaterialView,
  StepResult,
  StepUpdate,
} from '../../src/lib/inflate/material-plan.ts';
import { parseDirManifest } from '../../src/lib/inflate/output-dir.ts';
import { spawnCapture } from '../../src/lib/proc.ts';
import type { ProcRunner } from '../../src/lib/proc.ts';
import { trackTemp, writeTree } from './fixtures/data-fixtures.ts';

// Real git, tar and fs in OS temp dirs.
vi.setConfig({ testTimeout: 60_000 });

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const hasTool = (cmd: string, args: string[]): boolean => {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};
const HAS_GIT = hasTool('git', ['--version']);
const HAS_TAR = hasTool('tar', ['--version']);
const HAS_ZIP = hasTool('zip', ['-v']);

// ---------------------------------------------------------------- builders

const JOB_ID = 'abcdef12-0000-4000-8000-000000000000';

type StepFields = Record<string, unknown>;
const step = (kind: MaterialStep['kind'], id: string, rel: string, fields: StepFields = {}) =>
  ({
    kind,
    id,
    path: rel,
    label: id,
    expect: 'create',
    after: [],
    ...fields,
  }) as MaterialStep;

const dirStep = (): MaterialStep => step('ensureDir', 'dir', '', { fatal: true });
const manifestStep = (): MaterialStep =>
  step('writeManifest', 'manifest', '.ctxman-inflate.json', { always: true });
const symlinkStep = (key: string, rel: string, target: string): MaterialStep =>
  step('symlink', `okf:${key}`, rel, { key, target });
const copyStep = (key: string, rel: string, from: string): MaterialStep =>
  step('copyDir', `okf:${key}`, rel, { key, from });
const cloneStep = (key: string, rel: string, uri: string, fields: StepFields = {}): MaterialStep =>
  step('gitClone', `clone:${key}`, rel, {
    key,
    uri,
    depth: 1,
    branch: null,
    sparse: null,
    stage: false,
    ...fields,
  });
const updateStep = (key: string, rel: string, uri: string, fields: StepFields = {}): MaterialStep =>
  step('gitUpdate', `clone:${key}`, rel, {
    key,
    uri,
    depth: 1,
    branch: null,
    sparse: null,
    expect: 'update',
    ...fields,
  });
const removeStep = (entry: ManifestEntry): MaterialStep =>
  step('remove', `rm:${entry.path}`, entry.path, { expect: 'remove', entry });

function previousOf(entries: ManifestEntry[], over: Partial<InflateDirManifest> = {}) {
  return {
    format: 'ctxman-inflate',
    version: 1,
    recipe: 'demo',
    target: 'claude-code',
    contextFile: 'LLM_CONTEXT.md',
    generatedAt: '2026-01-01T00:00:00.000Z',
    jobId: 'old',
    entries,
    ...over,
  } satisfies InflateDirManifest;
}

function view(key: string, dest: string | null, extra: Partial<MaterialView> = {}): MaterialView {
  return {
    key,
    kind: 'kb',
    material: dest === null ? 'none' : 'symlink',
    title: key,
    description: '',
    dest,
    sourceAbs: null,
    uri: null,
    subpath: null,
    depth: null,
    branch: null,
    sparse: false,
    owner: null,
    state: 'planned',
    ...extra,
  };
}

interface Harness {
  dir: string;
  run(steps: MaterialStep[], over?: Partial<ExecuteContext>): ReturnType<typeof executeSteps>;
  updates: StepUpdate[];
}

/** `dir` = a fresh temp working directory; `run` executes steps against it. */
function harness(over: Partial<ExecuteContext> = {}, dir = path.join(tmp.make(), 'w')): Harness {
  const updates: StepUpdate[] = [];
  return {
    dir,
    updates,
    run: (steps, more = {}) =>
      executeSteps(steps, {
        dir,
        jobId: JOB_ID,
        recipe: 'demo',
        target: 'claude-code',
        contextFile: 'LLM_CONTEXT.md',
        previous: null,
        materials: {},
        signal: new AbortController().signal,
        onProgress: (u) => updates.push(u),
        proc: spawnCapture,
        now: () => new Date('2026-10-17T12:00:00.000Z'),
        renderContext: () => '# context\n',
        ...over,
        ...more,
      }),
  };
}

const find = (results: StepResult[], id: string): StepResult => {
  const found = results.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no result for ${id}: ${results.map((r) => r.id)}`);
  return found;
};
const statusOf = (results: StepResult[]): Record<string, string> =>
  Object.fromEntries(results.map((r) => [r.id, r.status]));
const readManifest = (dir: string): InflateDirManifest => {
  const parsed = parseDirManifest(
    readFileSync(path.join(dir, '.ctxman-inflate.json'), 'utf8'),
    dir,
  );
  if (parsed.status !== 'ok') throw new Error(`manifest ${parsed.status}`);
  return parsed.manifest;
};
const isLink = (p: string): boolean =>
  lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;
const listTree = (root: string): string[] => {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      out.push(r);
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
    }
  };
  walk(root, '');
  return out.sort();
};

// ---------------------------------------------------------------- ensureDir, manifest, after, fatal

describe('ensureDir, writeManifest and the loop', () => {
  it('creates the directory, then reports unchanged; the manifest is valid and sorted', async () => {
    const h = harness();
    const first = await h.run([dirStep(), manifestStep()]);
    expect(statusOf(first.results)).toEqual({ dir: 'ok', manifest: 'ok' });
    expect(find(first.results, 'dir').action).toBe('created');
    expect(first.manifest).toMatchObject({
      format: 'ctxman-inflate',
      version: 1,
      recipe: 'demo',
      target: 'claude-code',
      contextFile: 'LLM_CONTEXT.md',
      generatedAt: '2026-10-17T12:00:00.000Z',
      jobId: JOB_ID,
      entries: [],
    });
    const text = readFileSync(path.join(h.dir, '.ctxman-inflate.json'), 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual(first.manifest);

    const second = await h.run([dirStep(), manifestStep()]);
    expect(find(second.results, 'dir')).toMatchObject({ status: 'unchanged', action: 'unchanged' });
  });

  it('a fatal ensureDir failure skips later steps but still tries the always steps', async () => {
    const root = tmp.make({ afile: 'x' });
    const h = harness({}, path.join(root, 'afile'));
    const { results, manifest } = await h.run([
      dirStep(),
      step('writeContext', 'context', 'LLM_CONTEXT.md', { expect: 'write' }),
      step('cleanupStage', 'stage-cleanup', '.ctxman-tmp', { always: true }),
      manifestStep(),
    ]);
    expect(find(results, 'dir').status).toBe('failed');
    expect(find(results, 'dir').message).toContain('is not a directory');
    expect(find(results, 'context')).toMatchObject({
      status: 'skipped',
      message: 'skipped: dir failed',
    });
    expect(find(results, 'manifest').status).toBe('skipped');
    expect(manifest).toBeNull();
  });

  it('skips a step whose `after` dependency did not succeed', async () => {
    const h = harness();
    const { results } = await h.run([
      dirStep(),
      symlinkStep('kb/a', 'kb/a', path.join(h.dir, 'missing-source')),
      step('copyDir', 'dependent', 'kb/b', { from: h.dir, after: ['okf:kb/a'] }),
      step('copyDir', 'ghost', 'kb/c', { from: h.dir, after: ['never-existed'] }),
      manifestStep(),
    ]);
    expect(find(results, 'okf:kb/a').status).toBe('failed');
    expect(find(results, 'dependent')).toMatchObject({
      status: 'skipped',
      message: 'skipped: okf:kb/a did not succeed',
    });
    expect(find(results, 'ghost').message).toBe('skipped: never-existed did not succeed');
    expect(find(results, 'manifest').status).toBe('ok');
  });

  it('emits running, line and final events per step, and results carry a tail', async () => {
    const h = harness();
    const { results } = await h.run([dirStep(), manifestStep()]);
    expect(h.updates.map((u) => `${u.id}:${u.status}`)).toEqual([
      'dir:running',
      'dir:ok',
      'manifest:running',
      'manifest:ok',
    ]);
    expect(h.updates[1]?.result).toEqual(find(results, 'dir'));
  });

  it('manifest merge: previous entries overlaid with results, removed paths dropped, sorted', async () => {
    const source = tmp.make({ 'a/main.md': 'a' });
    const h = harness();
    mkdirSync(path.join(h.dir, 'old'), { recursive: true });
    symlinkSync(source, path.join(h.dir, 'old', 'gone'), 'dir');
    const gone: ManifestEntry = {
      path: 'old/gone',
      type: 'symlink',
      key: 'kb/gone',
      target: source,
    };
    const kept: ManifestEntry = { path: 'zz/kept', type: 'copy', key: 'kb/kept', source: '/s' };
    const { manifest } = await h.run(
      [
        dirStep(),
        removeStep(gone),
        symlinkStep('kb/new', 'kb/new', path.join(source, 'a')),
        manifestStep(),
      ],
      { previous: previousOf([gone, kept]), recipe: 'demo2', contextFile: 'CONTEXT.md' },
    );
    expect(manifest?.recipe).toBe('demo2');
    expect(manifest?.contextFile).toBe('CONTEXT.md');
    expect(manifest?.entries.map((e) => e.path)).toEqual(['kb/new', 'zz/kept']);
    expect(readManifest(h.dir).entries).toEqual(manifest?.entries);
  });

  it('manifest: an unreadable previous (null) starts from the new entries only', async () => {
    const source = tmp.make();
    const h = harness();
    const { manifest } = await h.run([
      dirStep(),
      symlinkStep('kb/new', 'kb/new', source),
      manifestStep(),
    ]);
    expect(manifest?.entries).toEqual([
      { path: 'kb/new', type: 'symlink', key: 'kb/new', target: source },
    ]);
  });

  it('refuses an unsafe step path and a parent that leaves the directory through a symlink', async () => {
    const outside = tmp.make();
    const source = tmp.make();
    const h = harness();
    mkdirSync(h.dir, { recursive: true });
    symlinkSync(outside, path.join(h.dir, 'escape'), 'dir');
    const { results } = await h.run([
      dirStep(),
      symlinkStep('kb/a', '../outside', source),
      symlinkStep('kb/b', 'escape/kb/b', source),
      manifestStep(),
    ]);
    expect(find(results, 'okf:kb/a')).toMatchObject({ status: 'failed', message: 'unsafe path' });
    expect(find(results, 'okf:kb/b')).toMatchObject({
      status: 'failed',
      message: 'path leaves the working directory',
    });
    expect(readdirSync(outside)).toEqual([]);
  });
});

// ---------------------------------------------------------------- symlinks

describe('symlink step', () => {
  it('creates, then is unchanged', async () => {
    const source = tmp.make({ 'main.md': 'x' });
    const h = harness();
    const steps = [dirStep(), symlinkStep('kb/x', 'kb/x', source), manifestStep()];
    const first = await h.run(steps);
    expect(find(first.results, 'okf:kb/x')).toMatchObject({ status: 'ok', action: 'created' });
    expect(isLink(path.join(h.dir, 'kb', 'x'))).toBe(true);
    expect(realpathSync(path.join(h.dir, 'kb', 'x'))).toBe(realpathSync(source));
    expect(find(first.results, 'okf:kb/x').entry).toEqual({
      path: 'kb/x',
      type: 'symlink',
      key: 'kb/x',
      target: source,
    });
    const second = await h.run(steps, { previous: first.manifest });
    expect(find(second.results, 'okf:kb/x')).toMatchObject({ status: 'unchanged' });
  });

  it('adopts an identical unrecorded symlink', async () => {
    const source = tmp.make();
    const h = harness();
    mkdirSync(path.join(h.dir, 'kb'), { recursive: true });
    symlinkSync(source, path.join(h.dir, 'kb', 'x'), 'dir');
    const { results, manifest } = await h.run([
      dirStep(),
      symlinkStep('kb/x', 'kb/x', source),
      manifestStep(),
    ]);
    expect(find(results, 'okf:kb/x').status).toBe('unchanged');
    expect(manifest?.entries.map((e) => e.path)).toEqual(['kb/x']);
  });

  it('replaces a recorded symlink that points elsewhere; the old target stays intact', async () => {
    const oldTarget = tmp.make({ 'keep.md': 'k' });
    const newTarget = tmp.make();
    const h = harness();
    mkdirSync(path.join(h.dir, 'kb'), { recursive: true });
    symlinkSync(oldTarget, path.join(h.dir, 'kb', 'x'), 'dir');
    const previous = previousOf([
      { path: 'kb/x', type: 'symlink', key: 'kb/x', target: oldTarget },
    ]);
    const { results } = await h.run([dirStep(), symlinkStep('kb/x', 'kb/x', newTarget)], {
      previous,
    });
    expect(find(results, 'okf:kb/x')).toMatchObject({ status: 'ok', action: 'replaced' });
    expect(realpathSync(path.join(h.dir, 'kb', 'x'))).toBe(realpathSync(newTarget));
    expect(existsSync(path.join(oldTarget, 'keep.md'))).toBe(true);
  });

  it('refuses to replace an unrecorded different symlink, directory or file', async () => {
    const source = tmp.make();
    const other = tmp.make();
    const h = harness();
    mkdirSync(path.join(h.dir, 'kb', 'dir'), { recursive: true });
    writeFileSync(path.join(h.dir, 'kb', 'file'), 'mine');
    symlinkSync(other, path.join(h.dir, 'kb', 'link'), 'dir');
    const { results } = await h.run([
      dirStep(),
      symlinkStep('kb/dir', 'kb/dir', source),
      symlinkStep('kb/file', 'kb/file', source),
      symlinkStep('kb/link', 'kb/link', source),
    ]);
    for (const id of ['okf:kb/dir', 'okf:kb/file', 'okf:kb/link']) {
      expect(find(results, id).status).toBe('failed');
      expect(find(results, id).message).toMatch(/exists and was not created by ctxman$/);
    }
    expect(readFileSync(path.join(h.dir, 'kb', 'file'), 'utf8')).toBe('mine');
    expect(realpathSync(path.join(h.dir, 'kb', 'link'))).toBe(realpathSync(other));
  });

  it('replaces a recorded copy with a symlink', async () => {
    const source = tmp.make();
    const h = harness();
    mkdirSync(path.join(h.dir, 'kb', 'x'), { recursive: true });
    writeFileSync(path.join(h.dir, 'kb', 'x', 'old.md'), 'old');
    const previous = previousOf([{ path: 'kb/x', type: 'copy', key: 'kb/x', source: '/s' }]);
    const { results } = await h.run([dirStep(), symlinkStep('kb/x', 'kb/x', source)], { previous });
    expect(find(results, 'okf:kb/x').action).toBe('replaced');
    expect(isLink(path.join(h.dir, 'kb', 'x'))).toBe(true);
  });

  it('fails when the source does not exist', async () => {
    const h = harness();
    const missing = path.join(tmp.make(), 'nope');
    const { results } = await h.run([dirStep(), symlinkStep('kb/x', 'kb/x', missing)]);
    expect(find(results, 'okf:kb/x')).toMatchObject({
      status: 'failed',
      message: `source ${missing} does not exist`,
    });
  });
});

// ---------------------------------------------------------------- copies

describe('copyDir step', () => {
  const sourceTree = {
    'main.md': 'main',
    'concepts/a.md': 'a',
    '.git/HEAD': 'ref',
    'node_modules/x/index.js': 'x',
    '.DS_Store': 'junk',
  };

  it('copies without .git, node_modules and .DS_Store, and leaves no temp sibling', async () => {
    const source = tmp.make(sourceTree);
    const h = harness();
    const { results } = await h.run([dirStep(), copyStep('skill/x', '.claude/skills/x', source)]);
    expect(find(results, 'okf:skill/x')).toMatchObject({ status: 'ok', action: 'created' });
    expect(listTree(h.dir)).toEqual([
      '.claude',
      '.claude/skills',
      '.claude/skills/x',
      '.claude/skills/x/concepts',
      '.claude/skills/x/concepts/a.md',
      '.claude/skills/x/main.md',
    ]);
    expect(find(results, 'okf:skill/x').entry).toEqual({
      path: '.claude/skills/x',
      type: 'copy',
      key: 'skill/x',
      source,
    });
  });

  it('replaces a recorded copy: stale files are gone, new files are there', async () => {
    const source = tmp.make({ 'main.md': 'v1', 'old.md': 'old' });
    const h = harness();
    const steps = [dirStep(), copyStep('kb/x', 'kb/x', source), manifestStep()];
    const first = await h.run(steps);
    writeFileSync(path.join(h.dir, 'kb', 'x', 'local.md'), 'local edit');
    writeFileSync(path.join(source, 'main.md'), 'v2');
    await import('node:fs').then(({ rmSync }) => rmSync(path.join(source, 'old.md')));
    const second = await h.run(steps, { previous: first.manifest });
    expect(find(second.results, 'okf:kb/x')).toMatchObject({ status: 'ok', action: 'replaced' });
    expect(listTree(path.join(h.dir, 'kb'))).toEqual(['x', 'x/main.md']);
    expect(readFileSync(path.join(h.dir, 'kb', 'x', 'main.md'), 'utf8')).toBe('v2');
    expect(listTree(h.dir).some((p) => p.includes('.ctxman-abcdef12'))).toBe(false);
  });

  it('refuses an unrecorded destination and removes its temp copy', async () => {
    const source = tmp.make({ 'main.md': 'x' });
    const h = harness();
    mkdirSync(path.join(h.dir, 'kb', 'x'), { recursive: true });
    writeFileSync(path.join(h.dir, 'kb', 'x', 'mine.md'), 'mine');
    const { results } = await h.run([dirStep(), copyStep('kb/x', 'kb/x', source)]);
    expect(find(results, 'okf:kb/x')).toMatchObject({
      status: 'failed',
      message: 'kb/x exists and was not created by ctxman',
    });
    expect(listTree(h.dir)).toEqual(['kb', 'kb/x', 'kb/x/mine.md']);
  });

  it('dereferences symlinks inside trusted data (relative links become real files)', async () => {
    const source = tmp.make({ 'real/doc.md': 'doc' });
    symlinkSync('real/doc.md', path.join(source, 'link.md'));
    const h = harness();
    await h.run([dirStep(), copyStep('kb/x', 'kb/x', source)]);
    const copied = path.join(h.dir, 'kb', 'x', 'link.md');
    expect(isLink(copied)).toBe(false);
    expect(readFileSync(copied, 'utf8')).toBe('doc');
  });

  it('fails for a missing source', async () => {
    const h = harness();
    const missing = path.join(tmp.make(), 'nope');
    const { results } = await h.run([dirStep(), copyStep('kb/x', 'kb/x', missing)]);
    expect(find(results, 'okf:kb/x').status).toBe('failed');
  });
});

// ---------------------------------------------------------------- git

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=ctxman-test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** A local repository with docs/ and src/; returns its path and its file:// URI. */
function makeFixtureRepo(): { dir: string; uri: string } {
  const dir = tmp.make({
    'README.md': 'readme',
    'docs/guide.md': 'guide',
    'src/code.ts': 'code',
  });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'one');
  return { dir, uri: pathToFileURL(dir).href };
}

function commitFile(dir: string, rel: string, content: string): void {
  writeTree(dir, { [rel]: content });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', `change ${rel}`);
}

describe.skipIf(!HAS_GIT)('git steps (real git, local file:// fixture)', () => {
  it('probeTools sees git', async () => {
    expect((await probeTools(spawnCapture)).git).toBe(true);
  });

  it('clones shallow (depth 1) and records the clone', async () => {
    const repo = makeFixtureRepo();
    commitFile(repo.dir, 'second.md', 'two');
    const h = harness();
    const { results, manifest } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri),
      manifestStep(),
    ]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'created' });
    const dest = path.join(h.dir, 'repos', 'r');
    expect(existsSync(path.join(dest, '.git'))).toBe(true);
    expect(existsSync(path.join(dest, 'second.md'))).toBe(true);
    expect(git(dest, 'rev-parse', '--is-shallow-repository')).toBe('true');
    expect(git(dest, 'config', '--get', 'remote.origin.url')).toBe(repo.uri);
    expect(manifest?.entries).toEqual([
      {
        path: 'repos/r',
        type: 'clone',
        key: 'reference/r',
        uri: repo.uri,
        branch: null,
        depth: 1,
        sparse: null,
      },
    ]);
    expect(find(results, 'clone:reference/r').tail.length).toBeGreaterThan(0);
  });

  it('clones full history with depth 0 and a branch', async () => {
    const repo = makeFixtureRepo();
    git(repo.dir, 'checkout', '-q', '-b', 'dev');
    commitFile(repo.dir, 'dev.md', 'dev');
    git(repo.dir, 'checkout', '-q', 'main');
    const h = harness();
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri, { depth: 0, branch: 'dev' }),
    ]);
    expect(find(results, 'clone:reference/r').status).toBe('ok');
    const dest = path.join(h.dir, 'repos', 'r');
    expect(git(dest, 'rev-parse', '--is-shallow-repository')).toBe('false');
    expect(git(dest, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('dev');
    expect(existsSync(path.join(dest, 'dev.md'))).toBe(true);
  });

  it('sparse clone leaves only the subpath (and root files)', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri, { sparse: 'docs' }),
    ]);
    expect(find(results, 'clone:reference/r').status).toBe('ok');
    const dest = path.join(h.dir, 'repos', 'r');
    expect(existsSync(path.join(dest, 'docs', 'guide.md'))).toBe(true);
    expect(existsSync(path.join(dest, 'src'))).toBe(false);
    expect(existsSync(path.join(dest, 'README.md'))).toBe(true);
  });

  it('a failing clone is a failed step and leaves nothing behind', async () => {
    const h = harness();
    const missing = pathToFileURL(path.join(tmp.make(), 'no-such-repo')).href;
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', missing),
      manifestStep(),
    ]);
    expect(find(results, 'clone:reference/r').status).toBe('failed');
    expect(find(results, 'clone:reference/r').message).toMatch(/^git clone failed: /);
    expect(existsSync(path.join(h.dir, 'repos', 'r'))).toBe(false);
    expect(find(results, 'manifest').status).toBe('ok');
  });

  it('refuses a uri that looks like an option', async () => {
    const h = harness();
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', '--upload-pack=touch /tmp/x'),
    ]);
    expect(find(results, 'clone:reference/r')).toMatchObject({
      status: 'failed',
      message: 'invalid git URI',
    });
  });

  it('clone into an existing clone of the same uri behaves as an update', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
    commitFile(repo.dir, 'later.md', 'later');
    const { results } = await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'updated' });
    expect(existsSync(path.join(h.dir, 'repos', 'r', 'later.md'))).toBe(true);
  });

  it('refuses a clone onto a foreign directory or another clone', async () => {
    const repo = makeFixtureRepo();
    const other = makeFixtureRepo();
    const h = harness();
    await h.run([dirStep(), cloneStep('reference/o', 'repos/o', other.uri)]);
    mkdirSync(path.join(h.dir, 'repos', 'foreign'), { recursive: true });
    writeFileSync(path.join(h.dir, 'repos', 'foreign', 'mine.md'), 'mine');
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/o', 'repos/o', repo.uri),
      cloneStep('reference/f', 'repos/foreign', repo.uri),
    ]);
    expect(find(results, 'clone:reference/o')).toMatchObject({
      status: 'failed',
      message: `repos/o is a clone of ${other.uri}, not ${repo.uri}`,
    });
    expect(find(results, 'clone:reference/f').status).toBe('failed');
    expect(readFileSync(path.join(h.dir, 'repos', 'foreign', 'mine.md'), 'utf8')).toBe('mine');
  });

  it('clones into an existing empty directory', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    mkdirSync(path.join(h.dir, 'repos', 'r'), { recursive: true });
    const { results } = await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'created' });
  });

  it('gitUpdate fast-forwards (updated) and is a no-op afterwards (unchanged)', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    const first = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri),
      manifestStep(),
    ]);
    commitFile(repo.dir, 'later.md', 'later');
    const update = [dirStep(), updateStep('reference/r', 'repos/r', repo.uri), manifestStep()];
    const second = await h.run(update, { previous: first.manifest });
    expect(find(second.results, 'clone:reference/r')).toMatchObject({
      status: 'ok',
      action: 'updated',
    });
    expect(existsSync(path.join(h.dir, 'repos', 'r', 'later.md'))).toBe(true);
    const third = await h.run(update, { previous: second.manifest });
    expect(find(third.results, 'clone:reference/r')).toMatchObject({
      status: 'unchanged',
      action: 'unchanged',
    });
    expect(third.manifest?.entries.map((e) => e.path)).toEqual(['repos/r']);
  });

  it('gitUpdate clones when the destination is missing', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    const { results } = await h.run([dirStep(), updateStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'created' });
  });

  it('gitUpdate fails for another origin, keeps a clone on another branch, and fails a diverged pull', async () => {
    const repo = makeFixtureRepo();
    const other = makeFixtureRepo();
    const h = harness();
    await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri, { depth: 0 })]);

    const wrongOrigin = await h.run([dirStep(), updateStep('reference/r', 'repos/r', other.uri)]);
    expect(find(wrongOrigin.results, 'clone:reference/r')).toMatchObject({
      status: 'failed',
      message: `repos/r is a clone of ${repo.uri}, not ${other.uri}`,
    });

    const branch = await h.run([
      dirStep(),
      updateStep('reference/r', 'repos/r', repo.uri, { branch: 'release' }),
    ]);
    expect(find(branch.results, 'clone:reference/r')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: 'on branch main, recipe wants release; left as is',
    });

    // a local commit in the clone and a different upstream commit: no fast-forward possible
    const dest = path.join(h.dir, 'repos', 'r');
    commitFile(dest, 'local.md', 'local');
    commitFile(repo.dir, 'upstream.md', 'upstream');
    const diverged = await h.run([dirStep(), updateStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(diverged.results, 'clone:reference/r').status).toBe('failed');
    expect(find(diverged.results, 'clone:reference/r').message).toMatch(/^git pull failed/);
    expect(existsSync(path.join(dest, 'local.md'))).toBe(true);
  });

  it('gitUpdate switches the sparse checkout when the recorded subpath differs', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    const first = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri, { sparse: 'docs' }),
      manifestStep(),
    ]);
    const dest = path.join(h.dir, 'repos', 'r');
    expect(existsSync(path.join(dest, 'src'))).toBe(false);
    const full = await h.run([dirStep(), updateStep('reference/r', 'repos/r', repo.uri)], {
      previous: first.manifest,
    });
    expect(find(full.results, 'clone:reference/r').status).not.toBe('failed');
    expect(existsSync(path.join(dest, 'src', 'code.ts'))).toBe(true);
  });

  it('a symlink step never replaces a recorded clone that has local changes', async () => {
    const repo = makeFixtureRepo();
    const source = tmp.make();
    const h = harness();
    const first = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri),
      manifestStep(),
    ]);
    writeFileSync(path.join(h.dir, 'repos', 'r', 'mine.txt'), 'untracked');
    const { results } = await h.run([dirStep(), symlinkStep('reference/r', 'repos/r', source)], {
      previous: first.manifest,
    });
    expect(find(results, 'okf:reference/r')).toMatchObject({
      status: 'failed',
      message: 'kept repos/r: it has local changes or unpushed commits',
    });
    expect(existsSync(path.join(h.dir, 'repos', 'r', 'mine.txt'))).toBe(true);
  });

  it('stage clone has no entry and is replaced on a re-run', async () => {
    const repo = makeFixtureRepo();
    const h = harness();
    const stage = step('gitClone', 'stage:reference/s', '.ctxman-tmp/s', {
      key: 'reference/s',
      uri: repo.uri,
      depth: 1,
      branch: null,
      sparse: 'docs',
      stage: true,
    });
    const first = await h.run([dirStep(), stage]);
    expect(find(first.results, 'stage:reference/s').entry).toBeUndefined();
    expect(existsSync(path.join(h.dir, '.ctxman-tmp', 's', 'docs', 'guide.md'))).toBe(true);
    const second = await h.run([dirStep(), stage]);
    expect(find(second.results, 'stage:reference/s').status).toBe('ok');
  });
});

// ---------------------------------------------------------------- remove

describe('remove step', () => {
  it('unlinks a recorded symlink and leaves the target intact', async () => {
    const source = tmp.make({ 'main.md': 'x' });
    const h = harness();
    const first = await h.run([dirStep(), symlinkStep('kb/x', 'kb/x', source), manifestStep()]);
    const entry = first.manifest?.entries[0] as ManifestEntry;
    const second = await h.run([dirStep(), removeStep(entry), manifestStep()], {
      previous: first.manifest,
    });
    expect(find(second.results, 'rm:kb/x')).toMatchObject({ status: 'ok', action: 'removed' });
    expect(isLink(path.join(h.dir, 'kb', 'x'))).toBe(false);
    expect(existsSync(path.join(source, 'main.md'))).toBe(true);
    expect(second.manifest?.entries).toEqual([]);
  });

  it('a path that is already gone is unchanged and leaves the manifest', async () => {
    const h = harness();
    const entry: ManifestEntry = { path: 'kb/x', type: 'symlink', key: 'kb/x', target: '/t' };
    const { results, manifest } = await h.run([dirStep(), removeStep(entry), manifestStep()], {
      previous: previousOf([entry]),
    });
    expect(find(results, 'rm:kb/x').status).toBe('unchanged');
    expect(manifest?.entries).toEqual([]);
  });

  it('removes a recorded copy and skill directory', async () => {
    const h = harness();
    for (const rel of ['kb/c', '.claude/skills/s']) {
      mkdirSync(path.join(h.dir, rel), { recursive: true });
      writeFileSync(path.join(h.dir, rel, 'f.md'), 'x');
    }
    const copy: ManifestEntry = { path: 'kb/c', type: 'copy', key: 'kb/c', source: '/s' };
    const skill: ManifestEntry = {
      path: '.claude/skills/s',
      type: 'skill',
      key: 'reference/s',
      uri: 'u',
      subpath: null,
    };
    const { results } = await h.run([dirStep(), removeStep(copy), removeStep(skill)]);
    expect(statusOf(results)).toMatchObject({ 'rm:kb/c': 'ok', 'rm:.claude/skills/s': 'ok' });
    expect(existsSync(path.join(h.dir, 'kb', 'c'))).toBe(false);
    expect(existsSync(path.join(h.dir, '.claude', 'skills', 's'))).toBe(false);
  });

  it('keeps a path whose type changed since ctxman created it', async () => {
    const source = tmp.make();
    const h = harness();
    mkdirSync(path.join(h.dir, 'kb', 'x'), { recursive: true });
    writeFileSync(path.join(h.dir, 'kb', 'x', 'mine.md'), 'mine');
    writeFileSync(path.join(h.dir, 'kb', 'y'), 'a file now');
    const asLink: ManifestEntry = { path: 'kb/x', type: 'symlink', key: 'kb/x', target: source };
    const asCopy: ManifestEntry = { path: 'kb/y', type: 'copy', key: 'kb/y', source: '/s' };
    const { results, manifest } = await h.run(
      [dirStep(), removeStep(asLink), removeStep(asCopy), manifestStep()],
      { previous: previousOf([asLink, asCopy]) },
    );
    for (const id of ['rm:kb/x', 'rm:kb/y']) {
      expect(find(results, id).status).toBe('skipped');
      expect(find(results, id).message).toMatch(/^kept kb\/[xy]: no longer what ctxman created$/);
    }
    expect(existsSync(path.join(h.dir, 'kb', 'x', 'mine.md'))).toBe(true);
    expect(manifest?.entries.map((e) => e.path)).toEqual(['kb/x', 'kb/y']);
  });

  it('removes an unedited file and keeps an edited one', async () => {
    const h = harness();
    mkdirSync(h.dir, { recursive: true });
    writeFileSync(path.join(h.dir, 'CLAUDE.md'), 'generated');
    writeFileSync(path.join(h.dir, 'AGENTS.md'), 'edited by the user');
    const claude: ManifestEntry = {
      path: 'CLAUDE.md',
      type: 'file',
      role: 'claude-md',
      sha256: sha256Of('generated'),
    };
    const agents: ManifestEntry = {
      path: 'AGENTS.md',
      type: 'file',
      role: 'agents-md',
      sha256: sha256Of('what ctxman wrote'),
    };
    const { results, manifest } = await h.run(
      [dirStep(), removeStep(claude), removeStep(agents), manifestStep()],
      { previous: previousOf([claude, agents]) },
    );
    expect(find(results, 'rm:CLAUDE.md').status).toBe('ok');
    expect(existsSync(path.join(h.dir, 'CLAUDE.md'))).toBe(false);
    expect(find(results, 'rm:AGENTS.md')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: 'kept AGENTS.md: edited since ctxman wrote it',
    });
    expect(readFileSync(path.join(h.dir, 'AGENTS.md'), 'utf8')).toBe('edited by the user');
    expect(manifest?.entries.map((e) => e.path)).toEqual(['AGENTS.md']);
  });

  describe.skipIf(!HAS_GIT)('clones', () => {
    const cloneEntry = (uri: string): ManifestEntry => ({
      path: 'repos/r',
      type: 'clone',
      key: 'reference/r',
      uri,
      branch: null,
      depth: 1,
      sparse: null,
    });

    it('removes a clean clone', async () => {
      const repo = makeFixtureRepo();
      const h = harness();
      await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
      const { results } = await h.run([dirStep(), removeStep(cloneEntry(repo.uri))]);
      expect(find(results, 'rm:repos/r')).toMatchObject({ status: 'ok', action: 'removed' });
      expect(existsSync(path.join(h.dir, 'repos', 'r'))).toBe(false);
    });

    it('keeps a clone with local changes (modified, untracked)', async () => {
      const repo = makeFixtureRepo();
      const h = harness();
      await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
      writeFileSync(path.join(h.dir, 'repos', 'r', 'new.txt'), 'untracked');
      const { results, manifest } = await h.run(
        [dirStep(), removeStep(cloneEntry(repo.uri)), manifestStep()],
        { previous: previousOf([cloneEntry(repo.uri)]) },
      );
      expect(find(results, 'rm:repos/r')).toMatchObject({
        status: 'skipped',
        action: 'kept',
        message: 'kept repos/r: it has local changes or unpushed commits',
      });
      expect(existsSync(path.join(h.dir, 'repos', 'r', 'new.txt'))).toBe(true);
      expect(manifest?.entries.map((e) => e.path)).toEqual(['repos/r']);
    });

    it('keeps a clone with unpushed commits', async () => {
      const repo = makeFixtureRepo();
      const h = harness();
      await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
      commitFile(path.join(h.dir, 'repos', 'r'), 'mine.md', 'mine');
      const { results } = await h.run([dirStep(), removeStep(cloneEntry(repo.uri))]);
      expect(find(results, 'rm:repos/r')).toMatchObject({ status: 'skipped', action: 'kept' });
      expect(existsSync(path.join(h.dir, 'repos', 'r', 'mine.md'))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------- archives and skills

const tgz = (files: Record<string, string>, links: Record<string, string> = {}): string => {
  const root = tmp.make(files);
  for (const [name, target] of Object.entries(links)) symlinkSync(target, path.join(root, name));
  const out = path.join(tmp.make(), 'archive.tgz');
  const r = spawnSync('tar', ['-czf', out, '-C', root, '.'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
};

const zipOf = (files: Record<string, string>): string => {
  const root = tmp.make(files);
  const out = path.join(tmp.make(), 'archive.zip');
  const r = spawnSync('zip', ['-qr', out, '.'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return out;
};

/** Stages an archive (copy into the working dir) and runs extract + placeSkill + cleanup. */
async function installFrom(
  h: Harness,
  archivePath: string,
  format: 'tgz' | 'zip',
  subpath: string | null,
  extra: Partial<ExecuteContext> = {},
) {
  const stageFile = `.ctxman-tmp/s.${format}`;
  return h.run(
    [
      dirStep(),
      step('download', 'dl:reference/s', stageFile, {
        key: 'reference/s',
        uri: 'https://example.invalid/s',
      }),
      step('extract', 'x:reference/s', '.ctxman-tmp/s', {
        key: 'reference/s',
        after: ['dl:reference/s'],
        archive: stageFile,
        format,
      }),
      step('placeSkill', 'skill:reference/s', '.claude/skills/s', {
        key: 'reference/s',
        after: ['x:reference/s'],
        stage: '.ctxman-tmp/s',
        subpath,
        uri: 'https://example.invalid/s',
      }),
      step('cleanupStage', 'stage-cleanup', '.ctxman-tmp', { always: true }),
      manifestStep(),
    ],
    {
      fetch: () => Promise.resolve(new Response(readFileSync(archivePath))),
      ...extra,
    },
  );
}

describe.skipIf(!HAS_TAR)('download, extract and placeSkill', () => {
  it('installs a skill from a tgz with a wrapper directory and a subpath, then cleans the stage', async () => {
    const archive = tgz({
      'pkg-1.0/README.md': 'readme',
      'pkg-1.0/skills/demo/SKILL.md': '---\nname: demo\n---\n',
      'pkg-1.0/skills/demo/references/r.md': 'ref',
      'pkg-1.0/skills/other/SKILL.md': 'other',
    });
    const h = harness();
    const { results, manifest } = await installFrom(h, archive, 'tgz', 'skills/demo');
    expect(statusOf(results)).toMatchObject({
      'dl:reference/s': 'ok',
      'x:reference/s': 'ok',
      'skill:reference/s': 'ok',
      'stage-cleanup': 'ok',
      manifest: 'ok',
    });
    expect(listTree(h.dir).filter((p) => p.startsWith('.claude'))).toEqual([
      '.claude',
      '.claude/skills',
      '.claude/skills/s',
      '.claude/skills/s/SKILL.md',
      '.claude/skills/s/references',
      '.claude/skills/s/references/r.md',
    ]);
    expect(existsSync(path.join(h.dir, '.ctxman-tmp'))).toBe(false);
    expect(manifest?.entries).toEqual([
      {
        path: '.claude/skills/s',
        type: 'skill',
        key: 'reference/s',
        uri: 'https://example.invalid/s',
        subpath: 'skills/demo',
      },
    ]);
  });

  it('finds SKILL.md in a single wrapper directory without a subpath, and at the archive root', async () => {
    const wrapped = tgz({ 'ksa-modding/SKILL.md': 'skill', 'ksa-modding/notes.md': 'n' });
    const h1 = harness();
    const r1 = await installFrom(h1, wrapped, 'tgz', null);
    expect(find(r1.results, 'skill:reference/s').status).toBe('ok');
    expect(existsSync(path.join(h1.dir, '.claude', 'skills', 's', 'notes.md'))).toBe(true);

    const flat = tgz({ 'SKILL.md': 'skill', 'sub/a.md': 'a' });
    const h2 = harness();
    const r2 = await installFrom(h2, flat, 'tgz', null);
    expect(find(r2.results, 'skill:reference/s').status).toBe('ok');
    expect(existsSync(path.join(h2.dir, '.claude', 'skills', 's', 'sub', 'a.md'))).toBe(true);
  });

  it('fails with a clear message when no SKILL.md exists, and the stage is still removed', async () => {
    const archive = tgz({ 'pkg/README.md': 'no skill here' });
    const h = harness();
    const { results } = await installFrom(h, archive, 'tgz', 'skills/demo');
    expect(find(results, 'skill:reference/s')).toMatchObject({
      status: 'failed',
      message: 'no SKILL.md found in https://example.invalid/s (subpath skills/demo)',
    });
    expect(find(results, 'stage-cleanup').status).toBe('ok');
    expect(existsSync(path.join(h.dir, '.ctxman-tmp'))).toBe(false);
    expect(existsSync(path.join(h.dir, '.claude'))).toBe(false);
  });

  it('drops symbolic links and .git when placing a skill', async () => {
    const archive = tgz(
      { 'SKILL.md': 'skill', 'real.md': 'real', '.git/HEAD': 'ref' },
      { 'escape.md': '/etc/passwd' },
    );
    const h = harness();
    const { results } = await installFrom(h, archive, 'tgz', null);
    expect(find(results, 'skill:reference/s').status).toBe('ok');
    expect(find(results, 'skill:reference/s').tail).toContain('skipped 1 symlinks');
    expect(listTree(path.join(h.dir, '.claude', 'skills', 's'))).toEqual(['SKILL.md', 'real.md']);
  });

  it('replaces a recorded skill on a re-run', async () => {
    const archive = tgz({ 'SKILL.md': 'v1' });
    const h = harness();
    const first = await installFrom(h, archive, 'tgz', null);
    writeFileSync(path.join(h.dir, '.claude', 'skills', 's', 'stale.md'), 'stale');
    const second = await installFrom(h, archive, 'tgz', null, { previous: first.manifest });
    expect(find(second.results, 'skill:reference/s')).toMatchObject({
      status: 'ok',
      action: 'replaced',
    });
    expect(listTree(path.join(h.dir, '.claude', 'skills', 's'))).toEqual(['SKILL.md']);
  });

  it.skipIf(!HAS_ZIP)('extracts a zip with tar (or unzip as the fallback)', async () => {
    const archive = zipOf({ 'wrap/SKILL.md': 'skill', 'wrap/ref/r.md': 'r' });
    const h = harness();
    const { results } = await installFrom(h, archive, 'zip', null);
    expect(find(results, 'x:reference/s').status).toBe('ok');
    expect(find(results, 'skill:reference/s').status).toBe('ok');
    expect(existsSync(path.join(h.dir, '.claude', 'skills', 's', 'ref', 'r.md'))).toBe(true);
  });

  it('fails extraction of a broken archive with the install hint', async () => {
    const root = tmp.make({ 'broken.tgz': 'this is not an archive' });
    const h = harness();
    const { results } = await installFrom(h, path.join(root, 'broken.tgz'), 'tgz', null);
    expect(find(results, 'x:reference/s')).toMatchObject({
      status: 'failed',
      message: 'could not extract .ctxman-tmp/s.tgz: install tar (bsdtar) or unzip',
    });
    expect(find(results, 'skill:reference/s')).toMatchObject({
      status: 'skipped',
      message: 'skipped: x:reference/s did not succeed',
    });
    expect(existsSync(path.join(h.dir, '.ctxman-tmp'))).toBe(false);
  });
});

describe('download step', () => {
  const downloadSteps = (): MaterialStep[] => [
    dirStep(),
    step('download', 'dl:k', '.ctxman-tmp/k.tgz', {
      key: 'k',
      uri: 'https://example.invalid/k.tgz',
    }),
  ];

  it('streams the body to the stage file and logs progress per MiB', async () => {
    const body = Buffer.alloc(2.5 * 1024 * 1024, 7);
    const h = harness();
    const { results } = await h.run(downloadSteps(), {
      fetch: () => Promise.resolve(new Response(body)),
    });
    expect(find(results, 'dl:k')).toMatchObject({ status: 'ok', action: 'created' });
    expect(find(results, 'dl:k').tail).toEqual(['1 MB', '2 MB']);
    expect(statSync(path.join(h.dir, '.ctxman-tmp', 'k.tgz')).size).toBe(body.length);
  });

  it('fails on a non-2xx status and removes nothing it did not write', async () => {
    const h = harness();
    const { results } = await h.run(downloadSteps(), {
      fetch: () => Promise.resolve(new Response('nope', { status: 404 })),
    });
    expect(find(results, 'dl:k')).toMatchObject({ status: 'failed', message: 'HTTP 404' });
  });

  it('fails when the announced size exceeds 256 MB', async () => {
    const h = harness();
    const { results } = await h.run(downloadSteps(), {
      fetch: () =>
        Promise.resolve(
          new Response('x', { headers: { 'content-length': String(300 * 1024 * 1024) } }),
        ),
    });
    expect(find(results, 'dl:k')).toMatchObject({
      status: 'failed',
      message: 'download larger than 256 MB',
    });
    expect(existsSync(path.join(h.dir, '.ctxman-tmp', 'k.tgz'))).toBe(false);
  });

  it('fails when the stream grows past 256 MB without announcing it, and removes the partial file', async () => {
    const chunk = Buffer.alloc(8 * 1024 * 1024, 1);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 40) {
          controller.close();
          return;
        }
        sent++;
        controller.enqueue(new Uint8Array(chunk));
      },
    });
    const h = harness();
    const { results } = await h.run(downloadSteps(), {
      fetch: () => Promise.resolve(new Response(stream)),
    });
    expect(find(results, 'dl:k')).toMatchObject({
      status: 'failed',
      message: 'download larger than 256 MB',
    });
    expect(existsSync(path.join(h.dir, '.ctxman-tmp', 'k.tgz'))).toBe(false);
  });

  it('turns a fetch rejection into a failed step and refuses non-http URLs', async () => {
    const h = harness();
    const rejected = await h.run(downloadSteps(), {
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    expect(find(rejected.results, 'dl:k')).toMatchObject({
      status: 'failed',
      message: 'fetch failed',
    });
    const file = await h.run(
      [dirStep(), step('download', 'dl:f', '.ctxman-tmp/f.tgz', { uri: 'file:///etc/passwd' })],
      { fetch: () => Promise.reject(new Error('must not be called')) },
    );
    expect(find(file.results, 'dl:f')).toMatchObject({
      status: 'failed',
      message: 'invalid download URL',
    });
  });

  it('cancels a download when the run is aborted', async () => {
    const controller = new AbortController();
    const h = harness();
    const pending = h.run(downloadSteps(), {
      signal: controller.signal,
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    });
    setTimeout(() => controller.abort(), 100);
    const { results } = await pending;
    expect(find(results, 'dl:k').status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------- files

describe('writeContext and writeFile', () => {
  const ctxStep = (): MaterialStep =>
    step('writeContext', 'context', 'LLM_CONTEXT.md', { expect: 'write' });
  const stubStep = (rel: string, content: string, role = 'claude-md'): MaterialStep =>
    step('writeFile', `stub:${rel}`, rel, { expect: 'write', role, content });

  it('writes the rendered context atomically, then reports unchanged for the same text', async () => {
    const h = harness({ renderContext: () => '# doc\n' });
    const steps = [dirStep(), ctxStep(), manifestStep()];
    const first = await h.run(steps);
    expect(find(first.results, 'context')).toMatchObject({ status: 'ok', action: 'written' });
    expect(readFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'utf8')).toBe('# doc\n');
    expect(readdirSync(h.dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    expect(first.manifest?.entries).toEqual([
      { path: 'LLM_CONTEXT.md', type: 'file', role: 'context', sha256: sha256Of('# doc\n') },
    ]);
    const second = await h.run(steps, { previous: first.manifest });
    expect(find(second.results, 'context')).toMatchObject({
      status: 'unchanged',
      action: 'unchanged',
    });
  });

  it('overwrites a recorded context file, with a warning when it was edited', async () => {
    const h = harness({ renderContext: () => 'new\n' });
    const steps = [dirStep(), ctxStep(), manifestStep()];
    mkdirSync(h.dir, { recursive: true });
    writeFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'generated\n');
    const unedited = previousOf([
      { path: 'LLM_CONTEXT.md', type: 'file', role: 'context', sha256: sha256Of('generated\n') },
    ]);
    const a = await h.run(steps, { previous: unedited });
    expect(find(a.results, 'context')).toMatchObject({
      status: 'ok',
      action: 'written',
      message: null,
    });
    expect(a.warnings).toEqual([]);

    writeFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'hand edited\n');
    const b = await h.run(steps, { previous: unedited, renderContext: () => 'newer\n' });
    expect(readFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'utf8')).toBe('newer\n');
    expect(find(b.results, 'context').message).toBe('local edits to LLM_CONTEXT.md were replaced');
    expect(b.warnings).toEqual([
      { code: 'context-file-edited', message: 'local edits to LLM_CONTEXT.md were replaced' },
    ]);
  });

  it('refuses a context file ctxman did not write (identical content is adopted)', async () => {
    const h = harness({ renderContext: () => 'new\n' });
    mkdirSync(h.dir, { recursive: true });
    writeFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'somebody else\n');
    const refused = await h.run([dirStep(), ctxStep()]);
    expect(find(refused.results, 'context')).toMatchObject({
      status: 'failed',
      message: 'LLM_CONTEXT.md exists and was not written by ctxman',
    });
    expect(readFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'utf8')).toBe('somebody else\n');

    writeFileSync(path.join(h.dir, 'LLM_CONTEXT.md'), 'new\n');
    const adopted = await h.run([dirStep(), ctxStep()]);
    expect(find(adopted.results, 'context').status).toBe('unchanged');
  });

  it('renders the context from the ACTUAL outcomes: failed items are marked failed with the reason', async () => {
    const source = tmp.make();
    const missing = path.join(tmp.make(), 'nope');
    const seen: MaterialView[] = [];
    const h = harness({
      materials: {
        'kb/ok': view('kb/ok', 'kb/ok'),
        'kb/bad': view('kb/bad', 'kb/bad'),
        'kb/none': view('kb/none', null),
      },
      renderContext: (materials) => {
        seen.push(...Object.values(materials));
        return 'doc\n';
      },
    });
    await h.run([
      dirStep(),
      symlinkStep('kb/ok', 'kb/ok', source),
      symlinkStep('kb/bad', 'kb/bad', missing),
      ctxStep(),
    ]);
    const byKey = Object.fromEntries(seen.map((v) => [v.key, v]));
    expect(byKey['kb/ok']?.state).toBe('ok');
    expect(byKey['kb/bad']).toMatchObject({
      state: 'failed',
      reason: `source ${missing} does not exist`,
    });
    expect(byKey['kb/none']?.state).toBe('planned');
  });

  it('a renderContext that throws is a failed step, not a crash', async () => {
    const h = harness({
      renderContext: () => {
        throw new Error('render exploded\nstack');
      },
    });
    const { results } = await h.run([dirStep(), ctxStep(), manifestStep()]);
    expect(find(results, 'context')).toMatchObject({
      status: 'failed',
      message: 'render exploded',
    });
    expect(find(results, 'manifest').status).toBe('ok');
  });

  it('writes a stub when absent, keeps it when unchanged, rewrites an unedited recorded stub', async () => {
    const h = harness();
    const steps = (content: string) => [dirStep(), stubStep('CLAUDE.md', content), manifestStep()];
    const first = await h.run(steps('v1\n'));
    expect(find(first.results, 'stub:CLAUDE.md')).toMatchObject({
      status: 'ok',
      action: 'written',
    });
    const same = await h.run(steps('v1\n'), { previous: first.manifest });
    expect(find(same.results, 'stub:CLAUDE.md').status).toBe('unchanged');
    const changed = await h.run(steps('v2\n'), { previous: same.manifest });
    expect(find(changed.results, 'stub:CLAUDE.md')).toMatchObject({
      status: 'ok',
      action: 'written',
    });
    expect(readFileSync(path.join(h.dir, 'CLAUDE.md'), 'utf8')).toBe('v2\n');
  });

  it('keeps an edited stub and an unrecorded existing stub', async () => {
    const h = harness();
    const first = await h.run([dirStep(), stubStep('CLAUDE.md', 'v1\n'), manifestStep()]);
    writeFileSync(path.join(h.dir, 'CLAUDE.md'), 'my own instructions\n');
    const edited = await h.run([dirStep(), stubStep('CLAUDE.md', 'v2\n'), manifestStep()], {
      previous: first.manifest,
    });
    expect(find(edited.results, 'stub:CLAUDE.md')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: 'kept CLAUDE.md: edited since ctxman wrote it',
    });
    expect(readFileSync(path.join(h.dir, 'CLAUDE.md'), 'utf8')).toBe('my own instructions\n');
    expect(edited.manifest?.entries.find((e) => e.path === 'CLAUDE.md')).toMatchObject({
      sha256: sha256Of('v1\n'),
    });

    writeFileSync(path.join(h.dir, 'AGENTS.md'), 'mine\n');
    const unrecorded = await h.run([dirStep(), stubStep('AGENTS.md', 'x\n', 'agents-md')]);
    expect(find(unrecorded.results, 'stub:AGENTS.md')).toMatchObject({
      status: 'skipped',
      message: 'kept the existing AGENTS.md',
    });
    expect(readFileSync(path.join(h.dir, 'AGENTS.md'), 'utf8')).toBe('mine\n');
  });
});

// ---------------------------------------------------------------- cancellation, delay

describe('cancellation and the step delay hook', () => {
  const sources = (): string[] => [tmp.make(), tmp.make(), tmp.make(), tmp.make()];

  it('an abort after step 2 cancels later steps; always steps (manifest) still run', async () => {
    const [a, b, c, d] = sources() as [string, string, string, string];
    const controller = new AbortController();
    const h = harness({
      signal: controller.signal,
      onProgress: (u) => {
        if (u.id === 'okf:kb/b' && u.result !== undefined) controller.abort();
      },
    });
    const { results, manifest } = await h.run([
      dirStep(),
      symlinkStep('kb/a', 'kb/a', a),
      symlinkStep('kb/b', 'kb/b', b),
      symlinkStep('kb/c', 'kb/c', c),
      symlinkStep('kb/d', 'kb/d', d),
      step('cleanupStage', 'stage-cleanup', '.ctxman-tmp', { always: true }),
      manifestStep(),
    ]);
    expect(statusOf(results)).toEqual({
      dir: 'ok',
      'okf:kb/a': 'ok',
      'okf:kb/b': 'ok',
      'okf:kb/c': 'cancelled',
      'okf:kb/d': 'cancelled',
      'stage-cleanup': 'unchanged',
      manifest: 'ok',
    });
    expect(find(results, 'okf:kb/c').message).toBe('the run was cancelled');
    expect(existsSync(path.join(h.dir, 'kb', 'c'))).toBe(false);
    expect(manifest?.entries.map((e) => e.path)).toEqual(['kb/a', 'kb/b']);
    expect(readManifest(h.dir).entries).toHaveLength(2);
  });

  it('stepDelayMs sleeps before each step and an abort during the sleep cancels the step', async () => {
    const [a, b] = sources() as [string, string, string, string];
    const controller = new AbortController();
    const h = harness({ signal: controller.signal, stepDelayMs: 150 });
    const started = Date.now();
    setTimeout(() => controller.abort(), 220);
    const { results } = await h.run([
      dirStep(),
      symlinkStep('kb/a', 'kb/a', a),
      symlinkStep('kb/b', 'kb/b', b),
      manifestStep(),
    ]);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(statusOf(results)).toEqual({
      dir: 'ok',
      'okf:kb/a': 'cancelled',
      'okf:kb/b': 'cancelled',
      manifest: 'ok',
    });
    // `running` was announced for the delayed step before it was cancelled
    expect(h.updates.some((u) => u.id === 'okf:kb/a' && u.status === 'running')).toBe(true);
  });

  it('stepDelayMs 0 or undefined adds no delay', async () => {
    const h = harness({ stepDelayMs: 0 });
    const started = Date.now();
    await h.run([dirStep(), manifestStep()]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it.skipIf(!HAS_GIT)('cancels a running git clone through the abort signal', async () => {
    const repo = makeFixtureRepo();
    const controller = new AbortController();
    // A fake runner that behaves like a long git clone until aborted.
    const proc: ProcRunner = (_cmd, _args, opts) =>
      new Promise((resolve) => {
        opts?.signal?.addEventListener('abort', () =>
          resolve({
            code: 130,
            stdout: '',
            tail: [],
            durationMs: 1,
            aborted: true,
            timedOut: false,
          }),
        );
        setTimeout(() => controller.abort(), 50);
      });
    const h = harness({ signal: controller.signal, proc });
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri),
      manifestStep(),
    ]);
    expect(find(results, 'clone:reference/r').status).toBe('cancelled');
    expect(existsSync(path.join(h.dir, 'repos', 'r'))).toBe(false);
    expect(find(results, 'manifest').status).toBe('ok');
  });
});

describe('probeTools', () => {
  it('uses the injected runner: exit 0 = present, cached per runner', async () => {
    const calls: string[] = [];
    const proc: ProcRunner = (cmd) => {
      calls.push(cmd);
      return Promise.resolve({
        code: cmd === 'unzip' ? 127 : 0,
        stdout: '',
        tail: [],
        durationMs: 1,
        aborted: false,
        timedOut: false,
      });
    };
    expect(await probeTools(proc)).toEqual({ git: true, tar: true, unzip: false });
    expect(await probeTools(proc)).toEqual({ git: true, tar: true, unzip: false });
    expect(calls.sort()).toEqual(['git', 'tar', 'unzip']);
  });
});
