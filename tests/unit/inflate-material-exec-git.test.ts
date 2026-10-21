// Git steps of material-exec against real git and local file:// fixture repos. Every case builds its own temp
// repos and working directory, so they run concurrently. (Split from inflate-material-exec.test.ts for speed.)
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
  isLink,
  makeFixtureRepo,
  manifestStep,
  removeStep,
  step,
  symlinkStep,
  tmp,
  updateStep,
  view,
  worktreeStep,
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
        newBranch: null,
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

describe.skipIf(!HAS_GIT).concurrent('work branches of clones (real git)', () => {
  it('clones, then creates and switches to the work branch; the manifest records it', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const { results, manifest } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri, { depth: 0, newBranch: 'work' }),
      manifestStep(),
    ]);
    expect(find(results, 'clone:reference/r')).toMatchObject({ status: 'ok', action: 'created' });
    const dest = path.join(h.dir, 'repos', 'r');
    expect(git(dest, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('work');
    expect(git(dest, 'rev-parse', 'HEAD')).toBe(git(repo.dir, 'rev-parse', 'trunk'));
    expect(manifest?.entries[0]).toMatchObject({ type: 'clone', depth: 0, newBranch: 'work' });
  });

  it('a re-run on the work branch only fetches; another branch is kept', async ({ expect }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const first = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri, { depth: 0, newBranch: 'work' }),
      manifestStep(),
    ]);
    const dest = path.join(h.dir, 'repos', 'r');
    commitFile(dest, 'mine.md', 'work in progress');
    const update = [
      dirStep(),
      updateStep('reference/r', 'repos/r', repo.uri, { depth: 0, newBranch: 'work' }),
      manifestStep(),
    ];
    const quiet = await h.run(update, { previous: first.manifest });
    expect(find(quiet.results, 'clone:reference/r')).toMatchObject({
      status: 'unchanged',
      message: 'on work branch work; fetched origin',
    });
    commitFile(repo.dir, 'upstream.md', 'upstream');
    const fetched = await h.run(update, { previous: quiet.manifest });
    expect(find(fetched.results, 'clone:reference/r')).toMatchObject({
      status: 'ok',
      action: 'updated',
      message: 'on work branch work; fetched origin',
    });
    // fetched, never merged: the working tree and the work branch are untouched
    expect(existsSync(path.join(dest, 'upstream.md'))).toBe(false);
    expect(existsSync(path.join(dest, 'mine.md'))).toBe(true);
    expect(git(dest, 'rev-parse', 'origin/trunk')).toBe(git(repo.dir, 'rev-parse', 'trunk'));

    git(dest, 'checkout', '-q', 'trunk');
    const elsewhere = await h.run(update, { previous: fetched.manifest });
    expect(find(elsewhere.results, 'clone:reference/r')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: 'on branch trunk, recipe wants work branch work; left as is',
    });
  });

  it('a stale clone is removed only when no commit is missing from its remote (work branch, detached HEAD)', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const first = await h.run([
      dirStep(),
      cloneStep('reference/w', 'repos/w', repo.uri, { depth: 0, newBranch: 'work' }),
      cloneStep('reference/d', 'repos/d', repo.uri, { depth: 0 }),
      cloneStep('reference/c', 'repos/c', repo.uri, { depth: 0, newBranch: 'clean' }),
      manifestStep(),
    ]);
    const entry = (p: string) => {
      const found = first.manifest?.entries.find((e) => e.path === p);
      if (found === undefined) throw new Error(`no entry ${p}`);
      return found;
    };
    // a commit on the work branch: it has no upstream, so `git status` shows no `[ahead N]`
    commitFile(path.join(h.dir, 'repos', 'w'), 'work.md', 'only here');
    // a commit on a detached HEAD
    git(path.join(h.dir, 'repos', 'd'), 'checkout', '-q', '--detach');
    commitFile(path.join(h.dir, 'repos', 'd'), 'detached.md', 'only here too');
    const { results, manifest } = await h.run(
      [
        dirStep(),
        removeStep(entry('repos/c')),
        removeStep(entry('repos/d')),
        removeStep(entry('repos/w')),
        manifestStep(),
      ],
      { previous: first.manifest },
    );
    for (const p of ['repos/w', 'repos/d']) {
      expect(find(results, `rm:${p}`), p).toMatchObject({
        status: 'skipped',
        action: 'kept',
        message: `kept ${p}: it has local changes or unpushed commits`,
      });
    }
    expect(readFileSync(path.join(h.dir, 'repos', 'w', 'work.md'), 'utf8')).toBe('only here');
    // a work branch without commits of its own holds nothing the remote lacks
    expect(find(results, 'rm:repos/c')).toMatchObject({ status: 'ok', action: 'removed' });
    expect(existsSync(path.join(h.dir, 'repos', 'c'))).toBe(false);
    expect(manifest?.entries.map((e) => e.path)).toEqual(['repos/d', 'repos/w']);
  });

  it('a failing switch removes the fresh clone', async ({ expect }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    // a branch name git refuses (a component may not start with a dot)
    const { results } = await h.run([
      dirStep(),
      cloneStep('reference/r', 'repos/r', repo.uri, { newBranch: 'a/.b' }),
    ]);
    expect(find(results, 'clone:reference/r').status).toBe('failed');
    expect(find(results, 'clone:reference/r').message).toMatch(/^git switch failed/);
    expect(existsSync(path.join(h.dir, 'repos', 'r'))).toBe(false);
  });
});

describe.skipIf(!HAS_GIT).concurrent('worktrees of local repositories (real git)', () => {
  const real = (p: string): string => realpathSync(p);

  it('adds a worktree on a new branch from Branch; commits land in the repository', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    git(repo.dir, 'branch', 'dev');
    const h = harness();
    const { results, manifest } = await h.run([
      dirStep(),
      worktreeStep('reference/l', 'repos/l', repo.dir, { branch: 'dev', newBranch: 'feat/x' }),
      manifestStep(),
    ]);
    expect(find(results, 'worktree:reference/l')).toMatchObject({
      status: 'ok',
      action: 'created',
      message: 'new branch feat/x from dev',
    });
    const dest = path.join(h.dir, 'repos', 'l');
    expect(git(dest, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('feat/x');
    expect(manifest?.entries).toEqual([
      {
        path: 'repos/l',
        type: 'worktree',
        key: 'reference/l',
        repo: real(repo.dir),
        branch: 'dev',
        newBranch: 'feat/x',
      },
    ]);
    commitFile(dest, 'feature.md', 'feature');
    expect(git(repo.dir, 'log', '-1', '--format=%s', 'feat/x')).toBe('change feature.md');
    // the original checkout is untouched
    expect(git(repo.dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('trunk');
    expect(existsSync(path.join(repo.dir, 'feature.md'))).toBe(false);
  });

  it('a re-run leaves the worktree as it is; on another branch it is kept', async ({ expect }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const steps = [
      dirStep(),
      worktreeStep('reference/l', 'repos/l', repo.dir, { newBranch: 'work' }),
      manifestStep(),
    ];
    const first = await h.run(steps);
    const dest = path.join(h.dir, 'repos', 'l');
    writeFileSync(path.join(dest, 'draft.md'), 'uncommitted');
    const again = await h.run(steps, { previous: first.manifest });
    expect(find(again.results, 'worktree:reference/l')).toMatchObject({
      status: 'unchanged',
      action: 'unchanged',
      message: `a worktree of ${real(repo.dir)}; left as is`,
    });
    expect(readFileSync(path.join(dest, 'draft.md'), 'utf8')).toBe('uncommitted');
    git(dest, 'switch', '-q', '-c', 'other');
    const moved = await h.run(steps, { previous: again.manifest });
    expect(find(moved.results, 'worktree:reference/l')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: 'on branch other, recipe wants work; left as is',
    });
  });

  it('reuses an existing New branch, detaches without branches, refuses a branch checked out elsewhere', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    git(repo.dir, 'branch', 'work');
    const h = harness();
    const { results } = await h.run([
      dirStep(),
      worktreeStep('reference/a', 'repos/a', repo.dir, { newBranch: 'work' }),
      worktreeStep('reference/b', 'repos/b', repo.dir),
      worktreeStep('reference/c', 'repos/c', repo.dir, { branch: 'trunk' }),
    ]);
    expect(find(results, 'worktree:reference/a')).toMatchObject({
      status: 'ok',
      message: 'the branch work already exists in the repository: checked it out',
    });
    expect(git(path.join(h.dir, 'repos', 'a'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('work');
    expect(find(results, 'worktree:reference/b').status).toBe('ok');
    expect(git(path.join(h.dir, 'repos', 'b'), 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
    // trunk is checked out in the repository itself
    expect(find(results, 'worktree:reference/c').status).toBe('failed');
    expect(find(results, 'worktree:reference/c').message).toMatch(
      /^git worktree add failed: .*; set New branch to work on a branch of your own$/,
    );
    expect(existsSync(path.join(h.dir, 'repos', 'c'))).toBe(false);
  });

  it('the written context sees how the work branch came about (created, reused, already there)', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    git(repo.dir, 'branch', 'old-work');
    const seen: (string | undefined)[] = [];
    const h = harness({
      materials: {
        'reference/a': view('reference/a', 'repos/a', {
          kind: 'local-repo',
          material: 'worktree',
          newBranch: 'fresh',
        }),
        'reference/b': view('reference/b', 'repos/b', {
          kind: 'local-repo',
          material: 'worktree',
          newBranch: 'old-work',
        }),
      },
      renderContext: (materials) => {
        seen.push(materials['reference/a']?.workBranch, materials['reference/b']?.workBranch);
        return '# context\n';
      },
    });
    const steps = [
      dirStep(),
      worktreeStep('reference/a', 'repos/a', repo.dir, { newBranch: 'fresh' }),
      worktreeStep('reference/b', 'repos/b', repo.dir, { newBranch: 'old-work' }),
      step('writeContext', 'context', 'AGENTS.md', { expect: 'write' }),
      manifestStep(),
    ];
    const first = await h.run(steps);
    expect(seen).toEqual(['created', 'reused']);
    seen.length = 0;
    await h.run(steps, { previous: first.manifest });
    expect(seen).toEqual(['present', 'present']);
  });

  it('refuses a path that is not the top level of a work tree, and a foreign directory', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    const plain = tmp.make({ 'a.md': 'a' });
    const h = harness();
    mkdirSync(path.join(h.dir, 'repos', 'taken'), { recursive: true });
    writeFileSync(path.join(h.dir, 'repos', 'taken', 'mine.md'), 'mine');
    const { results } = await h.run([
      dirStep(),
      worktreeStep('reference/sub', 'repos/sub', path.join(repo.dir, 'docs')),
      worktreeStep('reference/plain', 'repos/plain', plain),
      worktreeStep('reference/taken', 'repos/taken', repo.dir),
    ]);
    expect(find(results, 'worktree:reference/sub')).toMatchObject({
      status: 'failed',
      message: `${path.join(repo.dir, 'docs')} is not the top level of a git work tree`,
    });
    expect(find(results, 'worktree:reference/plain').status).toBe('failed');
    expect(find(results, 'worktree:reference/taken')).toMatchObject({
      status: 'failed',
      message: 'repos/taken exists and was not created by ctxman',
    });
    expect(readFileSync(path.join(h.dir, 'repos', 'taken', 'mine.md'), 'utf8')).toBe('mine');
  });

  it('replaces a recorded symlink with a worktree, and a worktree with a symlink', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const linkStep = () =>
      step('symlink', 'link:reference/l', 'repos/l', { key: 'reference/l', target: repo.dir });
    const linked = await h.run([dirStep(), linkStep(), manifestStep()]);
    const tree = await h.run(
      [
        dirStep(),
        worktreeStep('reference/l', 'repos/l', repo.dir, { newBranch: 'work' }),
        manifestStep(),
      ],
      { previous: linked.manifest },
    );
    expect(find(tree.results, 'worktree:reference/l')).toMatchObject({
      status: 'ok',
      action: 'replaced',
    });
    expect(isLink(path.join(h.dir, 'repos', 'l'))).toBe(false);
    const back = await h.run([dirStep(), linkStep(), manifestStep()], {
      previous: tree.manifest,
    });
    expect(find(back.results, 'link:reference/l')).toMatchObject({
      status: 'ok',
      action: 'replaced',
    });
    expect(isLink(path.join(h.dir, 'repos', 'l'))).toBe(true);
    // the worktree registration is gone, the work branch stays in the repository
    expect(git(repo.dir, 'worktree', 'list', '--porcelain')).not.toContain('repos/l');
    expect(git(repo.dir, 'branch', '--list', 'work')).toContain('work');
  });

  it('removes a stale worktree with git, never one with local changes or orphaned commits', async ({
    expect,
  }) => {
    const repo = makeFixtureRepo();
    const h = harness();
    const first = await h.run([
      dirStep(),
      worktreeStep('reference/clean', 'repos/clean', repo.dir, { newBranch: 'clean' }),
      worktreeStep('reference/dirty', 'repos/dirty', repo.dir, { newBranch: 'dirty' }),
      worktreeStep('reference/detached', 'repos/detached', repo.dir),
      manifestStep(),
    ]);
    const entries = first.manifest?.entries ?? [];
    const entry = (p: string) => {
      const found = entries.find((e) => e.path === p);
      if (found === undefined) throw new Error(`no entry ${p}`);
      return found;
    };
    writeFileSync(path.join(h.dir, 'repos', 'dirty', 'scratch.txt'), 'untracked');
    commitFile(path.join(h.dir, 'repos', 'detached'), 'lost.md', 'only here');
    const { results, manifest } = await h.run(
      [
        dirStep(),
        removeStep(entry('repos/clean')),
        removeStep(entry('repos/detached')),
        removeStep(entry('repos/dirty')),
        manifestStep(),
      ],
      { previous: first.manifest },
    );
    expect(find(results, 'rm:repos/clean')).toMatchObject({
      status: 'ok',
      action: 'removed',
      message: `removed the worktree; its commits stay in ${real(repo.dir)} (branch clean)`,
    });
    expect(existsSync(path.join(h.dir, 'repos', 'clean'))).toBe(false);
    expect(git(repo.dir, 'branch', '--list', 'clean')).toContain('clean');
    expect(find(results, 'rm:repos/dirty')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: 'kept repos/dirty: it has local changes; left in place',
    });
    expect(find(results, 'rm:repos/detached')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message:
        'kept repos/detached: it has commits on a detached HEAD that no branch holds; left in place',
    });
    expect(manifest?.entries.map((e) => e.path)).toEqual(['repos/detached', 'repos/dirty']);
  });

  it('keeps a recorded worktree whose repository is gone', async ({ expect }) => {
    const h = harness();
    mkdirSync(path.join(h.dir, 'repos', 'w'), { recursive: true });
    writeFileSync(path.join(h.dir, 'repos', 'w', '.git'), 'gitdir: /nowhere/.git/worktrees/w\n');
    const gone = path.join(tmp.make(), 'deleted-repo');
    const rec = {
      path: 'repos/w',
      type: 'worktree' as const,
      key: 'reference/w',
      repo: gone,
      branch: null,
      newBranch: 'work',
    };
    const { results } = await h.run([dirStep(), removeStep(rec)]);
    expect(find(results, 'rm:repos/w')).toMatchObject({
      status: 'skipped',
      action: 'kept',
      message: `kept repos/w: its repository ${gone} is gone; left in place`,
    });
    expect(existsSync(path.join(h.dir, 'repos', 'w', '.git'))).toBe(true);
  });
});
