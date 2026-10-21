import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeDirPlan,
  planInflateDir,
  toDirPlanResponse,
} from '../../src/lib/inflate/dir-plan.ts';
import type { DirPlanInternal, DirPlanResult } from '../../src/lib/inflate/dir-plan.ts';
import { createFsSources } from '../../src/lib/inflate/fs-sources.ts';
import { inflateRecipe } from '../../src/lib/inflate/pipeline.ts';
import type { StepUpdate } from '../../src/lib/inflate/material-plan.ts';
import { serializeDirManifest } from '../../src/lib/inflate/output-dir.ts';
import type { ProcRunner } from '../../src/lib/proc.ts';
import { runOverridesSchema } from '../../src/datasets/schemas.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';
import { SEED_NOW, seedRecipe, seedTree } from './fixtures/inflate-seed.ts';
import { assertValid } from '../../src/datasets/validate.ts';

vi.setConfig({ testTimeout: 60_000 });

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const NOW = new Date(SEED_NOW);
const noOverrides = assertValid(runOverridesSchema, {});
const overrides = (given: Record<string, unknown>) => assertValid(runOverridesSchema, given);

/** Every tool "installed", nothing spawned. */
const fakeProc: ProcRunner = () =>
  Promise.resolve({
    code: 0,
    stdout: '',
    tail: [],
    durationMs: 0,
    aborted: false,
    timedOut: false,
  });

const HOME = '/home/test';

function setup(extraTree: Record<string, string> = {}) {
  const dataDir = tmp.make(seedTree(extraTree));
  const work = path.join(tmp.make(), 'w');
  const sources = createFsSources({ dataDir, nowMs: Date.parse(SEED_NOW), homeDir: HOME });
  const plan = (
    run: Record<string, unknown> = {},
    recipe = seedRecipe(),
    proc: ProcRunner = fakeProc,
  ) =>
    planInflateDir({
      recipe,
      overrides: overrides({ dir: work, ...run }),
      now: NOW,
      sources,
      proc,
      dataDir,
      repoRoot: path.join(tmp.make(), 'repo'),
      homeDir: HOME,
    });
  return { dataDir, work, sources, plan };
}

const stepIds = (r: DirPlanResult): string[] => r.steps.map((s) => s.id);

describe('planInflateDir: document mode', () => {
  it('without a directory the document is the v1 absolute render', async () => {
    const { dataDir, sources } = setup();
    const recipe = seedRecipe({ output: undefined });
    const result = await planInflateDir({
      recipe,
      overrides: noOverrides,
      now: NOW,
      sources,
      proc: fakeProc,
      dataDir,
    });
    expect(result).toMatchObject({
      dir: null,
      dirInput: null,
      dirState: null,
      blocking: [],
      steps: [],
      applied: [],
      contextFile: 'AGENTS.md',
    });
    expect(result.internal).toBeUndefined();
    const v1 = await inflateRecipe(recipe, sources, NOW);
    expect(result.document.markdown).toBe(v1.markdown);
    expect(result.document.markdown).not.toContain('## Working directory map');
  });

  it('a recipe output.dir is used; an invalid one is blocked with the absolute document', async () => {
    const { dataDir, sources } = setup();
    const result = await planInflateDir({
      recipe: seedRecipe({ output: { dir: 'relative/dir', contextFile: 'LLM_CONTEXT.md' } }),
      overrides: noOverrides,
      now: NOW,
      sources,
      proc: fakeProc,
      dataDir,
    });
    expect(result.dir).toBeNull();
    expect(result.dirInput).toBe('relative/dir');
    expect(result.blocking).toEqual([
      { code: 'bad-dir', message: 'dir must be absolute or start with ~/' },
    ]);
    expect(result.steps).toEqual([]);
    expect(result.document.markdown).not.toContain('## Working directory map');
    expect(result.internal).toBeUndefined();
  });
});

describe('planInflateDir: directory mode', () => {
  it('plans the seed like spec 6.4 and renders the relative document', async () => {
    const { work, plan } = setup();
    const result = await plan();
    expect(result.dir).toBe(path.resolve(work));
    expect(result.dirInput).toBe(work);
    expect(result.blocking).toEqual([]);
    expect(result.dirState).toEqual({
      exists: false,
      empty: true,
      hasManifest: false,
      manifestRecipe: null,
    });
    expect(stepIds(result)).toEqual([
      'dir',
      'okf:kb/ctxman',
      'okf:kb/astro-content-layer',
      'okf:rca/astro-dev-full-reload-on-save',
      'okf:idea/context-inflate',
      'okf:task/write-agents-md',
      'okf:feature/context-forge',
      'okf:project/ctxman-v1',
      'skill:skill/okf-authoring',
      'skill:skill/ctxman-add-entry',
      'clone:reference/astro-docs',
      'context',
      'stub:CLAUDE.md',
      'stub:.gitignore',
      'manifest',
    ]);
    expect(result.applied).toEqual(['dir']);
    const md = result.document.markdown;
    expect(md).toContain('## Working directory map');
    expect(md).toContain('## Primary repository');
    expect(md).toContain('[`repos/astro-docs/`](repos/astro-docs/)');
  });

  it('is deterministic and never writes anything', async () => {
    const { work, plan } = setup();
    const a = await plan();
    const b = await plan();
    expect(b.steps).toEqual(a.steps);
    expect(b.document.markdown).toBe(a.document.markdown);
    expect(existsSync(work)).toBe(false);
  });

  it('applies run overrides (material none, primary null) and lists them', async () => {
    const { plan } = setup();
    const result = await plan({
      primary: null,
      contextFile: 'CONTEXT.md',
      items: { 'reference/astro-docs': { material: 'none' }, 'kb/ctxman': { material: 'copy' } },
    });
    expect(result.applied).toEqual([
      'dir',
      'contextFile',
      'primary',
      'reference/astro-docs',
      'kb/ctxman',
    ]);
    expect(result.contextFile).toBe('CONTEXT.md');
    const ids = stepIds(result);
    expect(ids).not.toContain('clone:reference/astro-docs');
    expect(ids).toContain('context');
    const copy = result.steps.find((s) => s.id === 'okf:kb/ctxman');
    expect(copy?.kind).toBe('copyDir');
    expect(result.steps.find((s) => s.id === 'context')?.path).toBe('CONTEXT.md');
    expect(result.document.markdown).not.toContain('## Primary repository');
  });

  it('lists an edit-only run override in applied too', async () => {
    const { plan } = setup();
    const result = await plan({ items: { 'reference/astro-docs': { edit: false } } });
    expect(result.applied).toEqual(['dir', 'reference/astro-docs']);
  });

  it('blocks a non-empty directory without a manifest, still returns the steps; allowNonEmpty unblocks', async () => {
    const { work, plan } = setup();
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, 'notes.txt'), 'mine');
    const blocked = await plan();
    expect(blocked.blocking.map((b) => b.code)).toEqual(['dir-not-empty']);
    expect(blocked.steps.length).toBeGreaterThan(5);
    expect(blocked.dirState).toMatchObject({ exists: true, empty: false, hasManifest: false });

    const allowed = await plan({ allowNonEmpty: true });
    expect(allowed.blocking).toEqual([]);
    expect(allowed.applied).toEqual(['dir', 'allowNonEmpty']);
  });

  it('a directory inside the data directory or the repository is bad-dir', async () => {
    const { dataDir, sources } = setup();
    const repoRoot = tmp.make();
    for (const dir of [
      path.join(dataDir, 'out'),
      path.join(repoRoot, 'out'),
      `${repoRoot}/node_modules/x`,
    ]) {
      const result = await planInflateDir({
        recipe: seedRecipe(),
        overrides: overrides({ dir }),
        now: NOW,
        sources,
        proc: fakeProc,
        dataDir,
        repoRoot,
        homeDir: HOME,
      });
      expect(
        result.blocking.map((b) => b.code),
        dir,
      ).toEqual(['bad-dir']);
      expect(result.steps).toEqual([]);
    }
  });

  it('reads a previous manifest: dirState, removal of stale paths and the foreign-recipe warning', async () => {
    const { work, plan } = setup();
    mkdirSync(path.join(work, 'kb', 'gone'), { recursive: true });
    writeFileSync(
      path.join(work, '.ctxman-inflate.json'),
      serializeDirManifest({
        format: 'ctxman-inflate',
        version: 1,
        recipe: 'some-other-recipe',
        target: 'claude-code',
        contextFile: 'LLM_CONTEXT.md',
        generatedAt: '2026-01-01T00:00:00.000Z',
        jobId: 'old',
        entries: [{ path: 'kb/gone', type: 'copy', key: 'kb/gone', source: '/s' }],
      }),
    );
    const result = await plan();
    expect(result.blocking).toEqual([]);
    expect(result.dirState).toEqual({
      exists: true,
      empty: false,
      hasManifest: true,
      manifestRecipe: 'some-other-recipe',
    });
    expect(stepIds(result).slice(0, 3)).toEqual(['dir', 'rm:kb/gone', 'okf:kb/ctxman']);
    expect(result.warnings.map((w) => w.code)).toContain('manifest-other-recipe');
    expect(result.document.manifest.warnings).toEqual(result.warnings);
  });

  it('warns up front about a context file the run will not write (foreign, or an edited stub)', async () => {
    const { work, plan } = setup();
    mkdirSync(work, { recursive: true });
    const hint = 'move it away or choose another context file name';
    const contextWarnings = (r: DirPlanResult) =>
      r.warnings.filter((w) => w.code === 'context-file-exists').map((w) => w.message);

    // an AGENTS.md ctxman never wrote
    writeFileSync(path.join(work, 'AGENTS.md'), 'the project instructions\n');
    const foreign = await plan({ allowNonEmpty: true });
    expect(contextWarnings(foreign)).toEqual([
      `AGENTS.md already exists in ${work} and was not written by ctxman, so the run will not write it; ${hint}`,
    ]);
    // another context file name: nothing to warn about
    expect(contextWarnings(await plan({ allowNonEmpty: true, contextFile: 'CONTEXT.md' }))).toEqual(
      [],
    );

    // the AGENTS.md stub of a directory made with the old default LLM_CONTEXT.md
    const stub = 'stub\n';
    const manifestWith = (sha: string) =>
      serializeDirManifest({
        format: 'ctxman-inflate',
        version: 1,
        recipe: 'ctxman-dev-brief',
        target: 'codex',
        contextFile: 'LLM_CONTEXT.md',
        generatedAt: '2026-01-01T00:00:00.000Z',
        jobId: 'old',
        entries: [{ path: 'AGENTS.md', type: 'file', role: 'agents-md', sha256: sha }],
      });
    const { sha256Of } = await import('../../src/lib/inflate/material-exec.ts');
    writeFileSync(path.join(work, 'AGENTS.md'), stub);
    writeFileSync(path.join(work, '.ctxman-inflate.json'), manifestWith(sha256Of(stub)));
    expect(contextWarnings(await plan())).toEqual([]);
    writeFileSync(path.join(work, 'AGENTS.md'), 'my own notes\n');
    expect(contextWarnings(await plan())).toEqual([
      `AGENTS.md is a stub ctxman wrote earlier and it was edited since, so the run will not replace it; ${hint}`,
    ]);
  });

  it('an unreadable manifest blocks, and with allowNonEmpty becomes a manifest-unreadable warning', async () => {
    const { work, plan } = setup();
    mkdirSync(work, { recursive: true });
    writeFileSync(path.join(work, '.ctxman-inflate.json'), '{broken');
    const blocked = await plan();
    expect(blocked.blocking.map((b) => b.code)).toEqual(['manifest-invalid']);
    const allowed = await plan({ allowNonEmpty: true });
    expect(allowed.blocking).toEqual([]);
    expect(allowed.warnings.map((w) => w.code)).toContain('manifest-unreadable');
    expect(stepIds(allowed).some((id) => id.startsWith('rm:'))).toBe(false);
  });

  it('demotes git materials to a warning when git is missing', async () => {
    const { plan } = setup();
    const noGit: ProcRunner = (cmd) =>
      Promise.resolve({
        code: cmd === 'git' ? 127 : 0,
        stdout: '',
        tail: [],
        durationMs: 0,
        aborted: false,
        timedOut: false,
      });
    // a fresh runner object is not in the 60 s tool cache
    const result = await plan({}, seedRecipe(), noGit);
    expect(stepIds(result)).not.toContain('clone:reference/astro-docs');
    expect(result.warnings.some((w) => w.code === 'tool-missing')).toBe(true);
  });

  it('toDirPlanResponse drops the server-only internal part', async () => {
    const { plan } = setup();
    const result = await plan();
    expect(result.internal).toBeDefined();
    const response = toDirPlanResponse(result);
    expect(Object.keys(response).sort()).toEqual([
      'applied',
      'blocking',
      'contextFile',
      'dir',
      'dirInput',
      'dirState',
      'document',
      'steps',
      'warnings',
    ]);
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });
});

// ---------------------------------------------------------------- plan + execute, real fs and git

const HAS_GIT = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=ctxman-test', '-c', 'user.email=test@example.invalid', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
}

describe.skipIf(!HAS_GIT)('plan and execute the seed into a temp directory', () => {
  const ENV_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'] as const;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  /** The reference URI https://github.com/withastro/docs.git is served by a local repository (insteadOf). */
  function mapGithubTo(repoDir: string): void {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = `url.${pathToFileURL(repoDir).href}.insteadOf`;
    process.env.GIT_CONFIG_VALUE_0 = 'https://github.com/withastro/docs.git';
  }

  function docsRepo(): string {
    const dir = tmp.make({
      'README.md': 'docs',
      'src/content/docs/en/index.md': '# English',
      'src/content/docs/fr/index.md': '# French',
    });
    git(dir, 'init', '-q', '-b', 'trunk');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'docs');
    return dir;
  }

  async function runPlanned(
    planned: DirPlanResult,
    jobId = 'abcdef12-0000-4000-8000-000000000000',
  ) {
    if (planned.internal === undefined) throw new Error('no internal part');
    const updates: StepUpdate[] = [];
    const outcome = await executeDirPlan(
      { ...planned, internal: planned.internal as DirPlanInternal },
      {
        jobId,
        signal: new AbortController().signal,
        onProgress: (u) => updates.push(u),
        now: () => NOW,
      },
    );
    return {
      ...outcome,
      updates,
      status: Object.fromEntries(outcome.results.map((r) => [r.id, r.status])),
    };
  }

  it('places every kind of material, writes relative context, stubs and manifest, and is idempotent', async () => {
    mapGithubTo(docsRepo());
    const { dataDir, work, plan } = setup();
    // the plan probes the real tools here, the execution uses the real spawn
    const first = await runPlanned(
      await plan({}, seedRecipe(), (await import('../../src/lib/proc.ts')).spawnCapture),
    );
    expect(Object.values(first.status).every((s) => s === 'ok')).toBe(true);
    expect(first.results).toHaveLength(15);

    expect(lstatSync(path.join(work, 'kb', 'ctxman')).isSymbolicLink()).toBe(true);
    expect(realpathSync(path.join(work, 'kb', 'ctxman'))).toBe(
      realpathSync(path.join(dataDir, 'kb', 'ctxman')),
    );
    // v3: a skill is symlinked by default (the file is reachable through the link)
    expect(
      lstatSync(path.join(work, '.claude', 'skills', 'okf-authoring', 'SKILL.md')).isFile(),
    ).toBe(true);
    expect(lstatSync(path.join(work, '.claude', 'skills', 'okf-authoring')).isSymbolicLink()).toBe(
      true,
    );
    expect(realpathSync(path.join(work, '.claude', 'skills', 'okf-authoring'))).toBe(
      realpathSync(path.join(dataDir, 'skill', 'okf-authoring')),
    );
    const clone = path.join(work, 'repos', 'astro-docs');
    expect(existsSync(path.join(clone, '.git'))).toBe(true);
    expect(existsSync(path.join(clone, 'src', 'content', 'docs', 'en', 'index.md'))).toBe(true);
    expect(existsSync(path.join(clone, 'src', 'content', 'docs', 'fr'))).toBe(false);

    const context = readFileSync(path.join(work, 'AGENTS.md'), 'utf8');
    expect(context).toContain('## Working directory map');
    expect(context).toContain('## Primary repository');
    expect(context).toContain('[`repos/astro-docs/`](repos/astro-docs/)');
    // mounted items are relative; only the unmounted reference link keeps its absolute data path
    for (const ds of ['kb', 'rca', 'idea', 'task', 'feature', 'project', 'skill']) {
      expect(context).not.toContain(path.join(dataDir, ds));
    }
    expect(readFileSync(path.join(work, 'CLAUDE.md'), 'utf8').endsWith('@AGENTS.md\n')).toBe(true);
    expect(readFileSync(path.join(work, '.gitignore'), 'utf8')).toContain('/repos/');
    const manifest = JSON.parse(readFileSync(path.join(work, '.ctxman-inflate.json'), 'utf8')) as {
      entries: { path: string }[];
    };
    expect(manifest.entries.map((e) => e.path)).toEqual([
      '.claude/skills/ctxman-add-entry',
      '.claude/skills/okf-authoring',
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'feature/context-forge',
      'idea/context-inflate',
      'kb/astro-content-layer',
      'kb/ctxman',
      'project/ctxman-v1',
      'rca/astro-dev-full-reload-on-save',
      'repos/astro-docs',
      'task/write-agents-md',
    ]);

    // the same run again: nothing duplicated, links kept, clone pulled (unchanged)
    const spawn = (await import('../../src/lib/proc.ts')).spawnCapture;
    const second = await runPlanned(
      await plan({}, seedRecipe(), spawn),
      'fedcba98-0000-4000-8000-000000000000',
    );
    expect(second.status['okf:kb/ctxman']).toBe('unchanged');
    expect(second.status['clone:reference/astro-docs']).toBe('unchanged');
    expect(second.status['context']).toBe('unchanged');
    expect(second.status['stub:CLAUDE.md']).toBe('unchanged');
    expect(second.status['stub:.gitignore']).toBe('unchanged');
    expect(second.status['skill:skill/okf-authoring']).toBe('unchanged');
    expect(second.status['okf:kb/ctxman']).toBe('unchanged');
    expect(second.results.some((r) => r.status === 'failed')).toBe(false);
    const replanned = await plan({}, seedRecipe(), spawn);
    expect(replanned.dirState?.hasManifest).toBe(true);
    expect(stepIds(replanned)).toContain('clone:reference/astro-docs');
    expect(replanned.steps.find((s) => s.id === 'clone:reference/astro-docs')?.kind).toBe(
      'gitUpdate',
    );

    // remove an item from the recipe: only its symlink goes away
    const trimmed = seedRecipe({
      overrides: [
        { key: 'reference/astro-docs', material: 'clone', materialOptions: { subpathOnly: true } },
      ],
      items: [],
    });
    const third = await runPlanned(
      await plan({ items: {}, primary: null }, { ...trimmed, contexts: ['ctxman-dev'] }, spawn),
      '01234567-0000-4000-8000-000000000000',
    );
    expect(third.results.some((r) => r.status === 'failed')).toBe(false);
    expect(existsSync(path.join(work, '.claude', 'skills', 'ctxman-add-entry'))).toBe(false);
    expect(existsSync(path.join(work, 'kb', 'ctxman'))).toBe(true);
    expect(existsSync(path.join(dataDir, 'skill', 'ctxman-add-entry', 'SKILL.md'))).toBe(true);
    expect(third.results.find((r) => r.id === 'rm:.claude/skills/ctxman-add-entry')?.action).toBe(
      'removed',
    );
  });

  it('v3: a symlinked skill and a copied local repository are placed, replaced and cleaned up', async () => {
    const repo = tmp.make({
      'README.md': 'readme',
      'old.md': 'old',
      'src/index.ts': 'code',
      '.git/HEAD': 'ref: refs/heads/trunk',
      'node_modules/dep/index.js': 'dep',
      '.DS_Store': 'junk',
    });
    const { dataDir, work, plan } = setup({
      'reference/lr.yaml': `name: lr\ndescription: A local repository.\ntype: local-repo\npath: ${repo}\nowner: me\n`,
    });
    const spawn = (await import('../../src/lib/proc.ts')).spawnCapture;
    const recipe = (items: string[]) =>
      seedRecipe({
        layout: 'flat',
        contexts: [],
        markdown: [],
        order: [],
        overrides: [{ key: 'reference/lr', material: 'copy' }],
        output: { dir: work },
        items: items.map((key) => {
          const [dataset, slug] = key.split('/');
          return { dataset, slug };
        }),
      });
    const skillLink = path.join(work, '.claude', 'skills', 'okf-authoring');
    const repoCopy = path.join(work, 'repos', 'lr');
    const both = ['skill/okf-authoring', 'reference/lr'];

    // run 1: the skill is a symlink, the repository a snapshot without .git and node_modules
    const first = await runPlanned(await plan({}, recipe(both), spawn));
    expect(first.status).toMatchObject({
      'skill:skill/okf-authoring': 'ok',
      'link:reference/lr': 'ok',
    });
    expect(first.results.some((r) => r.status === 'failed')).toBe(false);
    expect(lstatSync(skillLink).isSymbolicLink()).toBe(true);
    expect(realpathSync(skillLink)).toBe(
      realpathSync(path.join(dataDir, 'skill', 'okf-authoring')),
    );
    expect(lstatSync(repoCopy).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(repoCopy, 'src', 'index.ts'), 'utf8')).toBe('code');
    expect(existsSync(path.join(repoCopy, '.git'))).toBe(false);
    expect(existsSync(path.join(repoCopy, 'node_modules'))).toBe(false);
    expect(existsSync(path.join(repoCopy, '.DS_Store'))).toBe(false);
    const manifest = JSON.parse(readFileSync(path.join(work, '.ctxman-inflate.json'), 'utf8')) as {
      entries: { path: string; type: string }[];
    };
    const typeOf = (p: string) => manifest.entries.find((e) => e.path === p)?.type;
    expect(typeOf('.claude/skills/okf-authoring')).toBe('symlink');
    expect(typeOf('repos/lr')).toBe('copy');
    // a symlinked skill is ignored without the directory-only trailing slash
    const ignore = readFileSync(path.join(work, '.gitignore'), 'utf8');
    expect(ignore).toContain('\n/.claude/skills/okf-authoring\n');
    expect(ignore).toContain('\n/repos/\n');

    // run 2: the link is unchanged, the snapshot follows the source (new file in, removed file out)
    writeFileSync(path.join(repo, 'new.md'), 'new');
    rmSync(path.join(repo, 'old.md'));
    const second = await runPlanned(
      await plan({}, recipe(both), spawn),
      'fedcba98-0000-4000-8000-000000000000',
    );
    expect(second.status['skill:skill/okf-authoring']).toBe('unchanged');
    expect(second.results.find((r) => r.id === 'link:reference/lr')).toMatchObject({
      status: 'ok',
      action: 'replaced',
    });
    expect(existsSync(path.join(repoCopy, 'new.md'))).toBe(true);
    expect(existsSync(path.join(repoCopy, 'old.md'))).toBe(false);

    // run 3: the materials are swapped by run overrides (skill copy, repository symlink); sources untouched
    const swapped = await runPlanned(
      await plan(
        {
          items: {
            'skill/okf-authoring': { material: 'copy' },
            'reference/lr': { material: 'symlink' },
          },
        },
        recipe(both),
        spawn,
      ),
      '01234567-0000-4000-8000-000000000000',
    );
    expect(swapped.results.some((r) => r.status === 'failed')).toBe(false);
    expect(lstatSync(skillLink).isSymbolicLink()).toBe(false);
    expect(readFileSync(path.join(skillLink, 'SKILL.md'), 'utf8')).toContain('okf-authoring');
    expect(lstatSync(repoCopy).isSymbolicLink()).toBe(true);
    expect(realpathSync(repoCopy)).toBe(realpathSync(repo));
    expect(existsSync(path.join(dataDir, 'skill', 'okf-authoring', 'SKILL.md'))).toBe(true);

    // run 4: both items leave the recipe; the copy is deleted, the symlink unlinked, the sources stay
    const gone = await runPlanned(
      await plan({}, recipe([]), spawn),
      '76543210-0000-4000-8000-000000000000',
    );
    expect(gone.results.some((r) => r.status === 'failed')).toBe(false);
    expect(existsSync(skillLink)).toBe(false);
    expect(existsSync(repoCopy)).toBe(false);
    expect(existsSync(path.join(repo, 'src', 'index.ts'))).toBe(true);
    expect(existsSync(path.join(dataDir, 'skill', 'okf-authoring', 'SKILL.md'))).toBe(true);
  });

  it('a failing clone is reported in the written context file', async () => {
    mapGithubTo(path.join(tmp.make(), 'does-not-exist'));
    const { work, plan } = setup();
    const spawn = (await import('../../src/lib/proc.ts')).spawnCapture;
    const run = await runPlanned(await plan({}, seedRecipe(), spawn));
    expect(run.status['clone:reference/astro-docs']).toBe('failed');
    expect(run.status['context']).toBe('ok');
    const context = readFileSync(path.join(work, 'AGENTS.md'), 'utf8');
    expect(context).toContain('not placed');
    expect(context).not.toContain('## Primary repository');
    expect(existsSync(path.join(work, 'repos', 'astro-docs'))).toBe(false);
  });
});
