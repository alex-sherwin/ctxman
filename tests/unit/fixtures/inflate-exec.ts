// Shared builders and helpers of the inflate-material-exec tests: step constructors, the executeSteps harness,
// tool probes and local git fixtures. Real git, tar and fs in OS temp dirs; `tmp` is per importing test file.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { executeSteps } from '../../../src/lib/inflate/material-exec.ts';
import type { ExecuteContext } from '../../../src/lib/inflate/material-exec.ts';
import type {
  InflateDirManifest,
  ManifestEntry,
  MaterialStep,
  MaterialView,
  StepResult,
  StepUpdate,
} from '../../../src/lib/inflate/material-plan.ts';
import { parseDirManifest } from '../../../src/lib/inflate/output-dir.ts';
import { spawnCapture } from '../../../src/lib/proc.ts';
import { trackTemp, writeTree } from './data-fixtures.ts';

export const tmp = trackTemp();

export const hasTool = (cmd: string, args: string[]): boolean => {
  try {
    return spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
};
export const HAS_GIT = hasTool('git', ['--version']);
export const HAS_TAR = hasTool('tar', ['--version']);
export const HAS_ZIP = hasTool('zip', ['-v']);

// ---------------------------------------------------------------- builders

export const JOB_ID = 'abcdef12-0000-4000-8000-000000000000';

export type StepFields = Record<string, unknown>;
export const step = (
  kind: MaterialStep['kind'],
  id: string,
  rel: string,
  fields: StepFields = {},
) =>
  ({
    kind,
    id,
    path: rel,
    label: id,
    expect: 'create',
    after: [],
    ...fields,
  }) as MaterialStep;

export const dirStep = (): MaterialStep => step('ensureDir', 'dir', '', { fatal: true });
export const manifestStep = (): MaterialStep =>
  step('writeManifest', 'manifest', '.ctxman-inflate.json', { always: true });
export const symlinkStep = (key: string, rel: string, target: string): MaterialStep =>
  step('symlink', `okf:${key}`, rel, { key, target });
export const copyStep = (key: string, rel: string, from: string): MaterialStep =>
  step('copyDir', `okf:${key}`, rel, { key, from });
export const cloneStep = (
  key: string,
  rel: string,
  uri: string,
  fields: StepFields = {},
): MaterialStep =>
  step('gitClone', `clone:${key}`, rel, {
    key,
    uri,
    depth: 1,
    branch: null,
    sparse: null,
    newBranch: null,
    stage: false,
    ...fields,
  });
export const updateStep = (
  key: string,
  rel: string,
  uri: string,
  fields: StepFields = {},
): MaterialStep =>
  step('gitUpdate', `clone:${key}`, rel, {
    key,
    uri,
    depth: 1,
    branch: null,
    sparse: null,
    newBranch: null,
    expect: 'update',
    ...fields,
  });
export const worktreeStep = (
  key: string,
  rel: string,
  repo: string,
  fields: StepFields = {},
): MaterialStep =>
  step('gitWorktree', `worktree:${key}`, rel, {
    key,
    repo,
    branch: null,
    newBranch: null,
    ...fields,
  });
export const removeStep = (entry: ManifestEntry): MaterialStep =>
  step('remove', `rm:${entry.path}`, entry.path, { expect: 'remove', entry });

export function previousOf(entries: ManifestEntry[], over: Partial<InflateDirManifest> = {}) {
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

export function view(
  key: string,
  dest: string | null,
  extra: Partial<MaterialView> = {},
): MaterialView {
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
    newBranch: null,
    sparse: false,
    owner: null,
    edit: null,
    uriKind: null,
    state: 'planned',
    ...extra,
  };
}

export interface Harness {
  dir: string;
  run(steps: MaterialStep[], over?: Partial<ExecuteContext>): ReturnType<typeof executeSteps>;
  updates: StepUpdate[];
}

/** `dir` = a fresh temp working directory; `run` executes steps against it. */
export function harness(
  over: Partial<ExecuteContext> = {},
  dir = path.join(tmp.make(), 'w'),
): Harness {
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

export const find = (results: StepResult[], id: string): StepResult => {
  const found = results.find((r) => r.id === id);
  if (found === undefined) throw new Error(`no result for ${id}: ${results.map((r) => r.id)}`);
  return found;
};
export const statusOf = (results: StepResult[]): Record<string, string> =>
  Object.fromEntries(results.map((r) => [r.id, r.status]));
export const readManifest = (dir: string): InflateDirManifest => {
  const parsed = parseDirManifest(
    readFileSync(path.join(dir, '.ctxman-inflate.json'), 'utf8'),
    dir,
  );
  if (parsed.status !== 'ok') throw new Error(`manifest ${parsed.status}`);
  return parsed.manifest;
};
export const isLink = (p: string): boolean =>
  lstatSync(p, { throwIfNoEntry: false })?.isSymbolicLink() === true;
export const listTree = (root: string): string[] => {
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

// ---------------------------------------------------------------- git

export function git(cwd: string, ...args: string[]): string {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=ctxman-test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** A local repository with docs/ and src/; returns its path and its file:// URI. */
export function makeFixtureRepo(): { dir: string; uri: string } {
  const dir = tmp.make({
    'README.md': 'readme',
    'docs/guide.md': 'guide',
    'src/code.ts': 'code',
  });
  git(dir, 'init', '-q', '-b', 'trunk');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'one');
  return { dir, uri: pathToFileURL(dir).href };
}

export function commitFile(dir: string, rel: string, content: string): void {
  writeTree(dir, { [rel]: content });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', `change ${rel}`);
}
