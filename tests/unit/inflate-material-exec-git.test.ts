// Git steps of material-exec against real git and local file:// fixture repos. Every case builds its own temp
// repos and working directory, so they run concurrently. (Split from inflate-material-exec.test.ts for speed.)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, it, vi } from 'vitest';
import { probeTools } from '../../src/lib/inflate/material-exec.ts';
import { spawnCapture } from '../../src/lib/proc.ts';
import {
  HAS_GIT,
  cloneStep,
  commitFile,
  dirStep,
  find,
  git,
  harness,
  makeFixtureRepo,
  manifestStep,
  step,
  symlinkStep,
  tmp,
  updateStep,
} from './fixtures/inflate-exec.ts';

vi.setConfig({ testTimeout: 60_000 });

// concurrent cases share `tmp`: clean up once, after all of them
afterAll(() => tmp.cleanup());

describe.skipIf(!HAS_GIT).concurrent('git steps (real git, local file:// fixture)', () => {
  it('probeTools sees git', async ({ expect }) => {
    expect((await probeTools(spawnCapture)).git).toBe(true);
  });

  it('clones shallow (depth 1) and records the clone', async ({ expect }) => {
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

  it('clones full history with depth 0 and a branch', async ({ expect }) => {
    const repo = makeFixtureRepo();
    git(repo.dir, 'checkout', '-q', '-b', 'dev');
    commitFile(repo.dir, 'dev.md', 'dev');
    git(repo.dir, 'checkout', '-q', 'trunk');
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

  it('sparse clone leaves only the subpath (and root files)', async ({ expect }) => {
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

  it('a failing clone is a failed step and leaves nothing behind', async ({ expect }) => {
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

  it('refuses a uri that looks like an option', async ({ expect }) => {
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

  it('clone into an existing clone of the same uri behaves as an update', async ({ expect }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
    commitFile(repo.dir, 'later.md', 'later');
    const { results } = await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'updated' });
    expect(existsSync(path.join(h.dir, 'repos', 'r', 'later.md'))).toBe(true);
  });

  it('refuses a clone onto a foreign directory or another clone', async ({ expect }) => {
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

  it('clones into an existing empty directory', async ({ expect }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    mkdirSync(path.join(h.dir, 'repos', 'r'), { recursive: true });
    const { results } = await h.run([dirStep(), cloneStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'created' });
  });

  it('gitUpdate fast-forwards (updated) and is a no-op afterwards (unchanged)', async ({
    expect,
  }) => {
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

  it('gitUpdate clones when the destination is missing', async ({ expect }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const { results } = await h.run([dirStep(), updateStep('reference/r', 'repos/r', repo.uri)]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'created' });
  });

  it('gitUpdate fails for another origin, keeps a clone on another branch, and fails a diverged pull', async ({
    expect,
  }) => {
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
      message: 'on branch trunk, recipe wants release; left as is',
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

  it('gitUpdate switches the sparse checkout when the recorded subpath differs', async ({
    expect,
  }) => {
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

  it('a symlink step never replaces a recorded clone that has local changes', async ({
    expect,
  }) => {
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

  it('stage clone has no entry and is replaced on a re-run', async ({ expect }) => {
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
