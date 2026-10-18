import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import type { InflateWarning } from '../../src/lib/inflate/expand.ts';
import {
  archiveFormat,
  cleanSubpath,
  createPathMapper,
  gitignoreText,
  planMaterialization,
  stubText,
} from '../../src/lib/inflate/material-plan.ts';
import type {
  InflateDirManifest,
  ManifestEntry,
  MaterialPlan,
  MaterialPlanInput,
  MaterialView,
} from '../../src/lib/inflate/material-plan.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';
import { prepare, referenceYaml, seedRecipe, seedTree } from './fixtures/inflate-seed.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const W = '/work/ctxman-dev-brief';
const ALL_TOOLS = { git: true, tar: true, unzip: true };

interface World {
  D: string;
  repo: string;
}

/** The seed-like tree plus a skill `foo`, a local repo and one reference of every remote shape. */
function world(): World {
  const repo = tmp.make({ 'README.md': '', 'src/index.ts': '' });
  const D = tmp.make(
    seedTree({
      'skill/foo/SKILL.md': `---\nname: foo\ndescription: A local skill.\n---\n\n# Foo\n`,
      'reference/lr.yaml': referenceYaml(
        'lr',
        `type: local-repo\npath: ${repo}\nsubpath: src\nowner: me\n`,
      ),
      'reference/lr-gone.yaml': referenceYaml(
        'lr-gone',
        `type: local-repo\npath: ${path.join(repo, 'missing')}\nowner: me\n`,
      ),
      'reference/rr.yaml': referenceYaml(
        'rr',
        'type: remote-repo\nuri: git@github.com:o/r.git\nsubpath: docs\nowner: me\n',
      ),
      'reference/rs-git.yaml': referenceYaml(
        'rs-git',
        'type: remote-skill\nuri: https://github.com/o/skills.git\nsubpath: skills/foo\nowner: me\n',
      ),
      'reference/rs-git-root.yaml': referenceYaml(
        'rs-git-root',
        'type: remote-skill\nuri: https://github.com/o/root-skill.git\nowner: not-me\n',
      ),
      'reference/rs-tgz.yaml': referenceYaml(
        'rs-tgz',
        'type: remote-skill\nuri: https://h.test/skill.tar.gz\nowner: me\n',
      ),
      'reference/rs-zip.yaml': referenceYaml(
        'rs-zip',
        'type: remote-skill\nuri: https://h.test/skill.ZIP\nsubpath: pkg/zipped\nowner: me\n',
      ),
    }),
  );
  return { D, repo };
}

/** A recipe holding only ad hoc items (flat layout: segment order = items order). */
function adhoc(
  items: readonly string[],
  change: Record<string, unknown> = {},
  overrides: Record<string, unknown>[] = [],
): RecipeData {
  return seedRecipe({
    layout: 'flat',
    output: { dir: W },
    contexts: [],
    items: items.map((key) => {
      const [dataset, slug] = key.split('/');
      return { dataset, slug };
    }),
    markdown: [],
    overrides,
    order: [],
    ...change,
  });
}

async function plan(
  w: World,
  recipe: RecipeData,
  extra: Partial<Omit<MaterialPlanInput, 'plan' | 'content'>> = {},
): Promise<MaterialPlan> {
  const prepared = await prepare(w.D, recipe);
  return planMaterialization({
    ...prepared,
    dir: W,
    dirExists: false,
    previous: null,
    tools: ALL_TOOLS,
    ...extra,
  });
}

const ids = (p: MaterialPlan): string[] => p.steps.map((s) => s.id);
const codes = (warnings: readonly InflateWarning[]): string[] => warnings.map((w) => w.code);

function manifest(
  entries: ManifestEntry[],
  change: Partial<InflateDirManifest> = {},
): InflateDirManifest {
  return {
    format: 'ctxman-inflate',
    version: 1,
    recipe: 'ctxman-dev-brief',
    target: 'claude-code',
    contextFile: 'LLM_CONTEXT.md',
    generatedAt: '2026-10-17T12:00:00.000Z',
    jobId: 'a4752759-d16a-4199-aa1f-1440b492a804',
    entries,
    ...change,
  };
}

const file = (
  p: string,
  role: 'context' | 'claude-md' | 'agents-md' | 'gitignore',
): ManifestEntry => ({
  path: p,
  type: 'file',
  role,
  sha256: 'x',
});

// ---------------------------------------------------------------- the seed (spec §6.4)

describe('planMaterialization: seed-shaped recipe', () => {
  it('produces exactly the 15 step ids of spec §6.4 in order', async () => {
    const w = world();
    const p = await plan(w, seedRecipe());
    expect(ids(p)).toEqual([
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
    expect(p.warnings).toEqual([]);
    expect(p.primary).toBe('reference/astro-docs');
  });

  it('fills every step field (kinds, paths, labels, expect, after, flags)', async () => {
    const w = world();
    const p = await plan(w, seedRecipe());
    const step = (id: string) => p.steps.find((s) => s.id === id);

    expect(step('dir')).toEqual({
      kind: 'ensureDir',
      id: 'dir',
      path: '',
      label: `Create ${W}`,
      expect: 'create',
      after: [],
      fatal: true,
    });
    expect(step('okf:kb/ctxman')).toEqual({
      kind: 'symlink',
      id: 'okf:kb/ctxman',
      path: 'kb/ctxman',
      label: `Symlink kb/ctxman → ${path.join(w.D, 'kb', 'ctxman')}`,
      expect: 'create',
      key: 'kb/ctxman',
      after: [],
      target: path.join(w.D, 'kb', 'ctxman'),
    });
    expect(step('skill:skill/okf-authoring')).toEqual({
      kind: 'copyDir',
      id: 'skill:skill/okf-authoring',
      path: '.claude/skills/okf-authoring',
      label: 'Copy skill okf-authoring → .claude/skills/okf-authoring',
      expect: 'create',
      key: 'skill/okf-authoring',
      after: [],
      from: path.join(w.D, 'skill', 'okf-authoring'),
    });
    expect(step('clone:reference/astro-docs')).toEqual({
      kind: 'gitClone',
      id: 'clone:reference/astro-docs',
      path: 'repos/astro-docs',
      label: 'git clone https://github.com/withastro/docs.git → repos/astro-docs',
      expect: 'create',
      key: 'reference/astro-docs',
      after: [],
      uri: 'https://github.com/withastro/docs.git',
      depth: 1,
      branch: null,
      sparse: 'src/content/docs/en',
      stage: false,
    });
    expect(step('context')).toEqual({
      kind: 'writeContext',
      id: 'context',
      path: 'LLM_CONTEXT.md',
      label: 'Write LLM_CONTEXT.md',
      expect: 'write',
      after: [],
    });
    expect(step('stub:CLAUDE.md')).toEqual({
      kind: 'writeFile',
      id: 'stub:CLAUDE.md',
      path: 'CLAUDE.md',
      label: 'Write CLAUDE.md',
      expect: 'write',
      after: [],
      role: 'claude-md',
      content: stubText('claude-md', 'ctxman-dev-brief', 'LLM_CONTEXT.md'),
    });
    expect(step('stub:.gitignore')).toMatchObject({
      role: 'gitignore',
      content: gitignoreText('ctxman-dev-brief', [
        'kb/ctxman',
        'kb/astro-content-layer',
        'rca/astro-dev-full-reload-on-save',
        'idea/context-inflate',
        'task/write-agents-md',
        'feature/context-forge',
        'project/ctxman-v1',
        '.claude/skills/okf-authoring',
        '.claude/skills/ctxman-add-entry',
        'repos/astro-docs',
      ]),
    });
    expect(step('manifest')).toEqual({
      kind: 'writeManifest',
      id: 'manifest',
      path: '.ctxman-inflate.json',
      label: 'Write .ctxman-inflate.json',
      expect: 'write',
      after: [],
      always: true,
    });
  });

  it('describes every included item (none included), skips excluded ones', async () => {
    const w = world();
    const p = await plan(w, seedRecipe());
    expect(Object.keys(p.materials)).toEqual([
      'kb/ctxman',
      'kb/astro-content-layer',
      'rca/astro-dev-full-reload-on-save',
      'idea/context-inflate',
      'task/write-agents-md',
      'feature/context-forge',
      'project/ctxman-v1',
      'skill/okf-authoring',
      'reference/astro-docs',
      'skill/ctxman-add-entry',
    ]);
    expect(p.materials['bug/stale-badge-timezone']).toBeUndefined();
    expect(p.materials['reference/astro-docs']).toEqual({
      key: 'reference/astro-docs',
      kind: 'remote-repo',
      material: 'clone',
      title: 'astro-docs',
      description:
        'The Astro documentation source, English content. Consult it for content collections, loaders, routing and configuration.',
      dest: 'repos/astro-docs',
      sourceAbs: null,
      uri: 'https://github.com/withastro/docs.git',
      subpath: 'src/content/docs/en',
      depth: 1,
      branch: null,
      sparse: true,
      owner: 'not-me',
      state: 'planned',
    });
    expect(p.materials['kb/ctxman']).toMatchObject({
      material: 'symlink',
      dest: 'kb/ctxman',
      sourceAbs: path.join(w.D, 'kb', 'ctxman'),
      uri: null,
      owner: null,
      depth: null,
      sparse: false,
    });
    expect(p.files).toEqual([
      { path: 'LLM_CONTEXT.md', role: 'context' },
      { path: 'CLAUDE.md', role: 'claude-md' },
      { path: '.gitignore', role: 'gitignore' },
    ]);
  });

  it('is deterministic: two calls give deeply equal plans (also as JSON)', async () => {
    const w = world();
    const first = await plan(w, seedRecipe());
    const second = await plan(w, seedRecipe());
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('an existing directory is used (expect keep), a missing one created', async () => {
    const w = world();
    const p = await plan(w, seedRecipe(), { dirExists: true });
    expect(p.steps[0]).toMatchObject({ label: `Use ${W}`, expect: 'keep', fatal: true });
  });

  it('never needs the filesystem: no-output recipes still plan with defaults', async () => {
    const w = world();
    const p = await plan(w, seedRecipe({ output: undefined }));
    expect(p.primary).toBeNull();
    expect(ids(p)).toContain('context');
    expect(ids(p)).toContain('stub:CLAUDE.md');
  });
});

// ---------------------------------------------------------------- previous manifest

describe('planMaterialization: previous manifest', () => {
  const claudeStub = file('CLAUDE.md', 'claude-md');

  it('uses gitUpdate (expect update) iff the previous manifest has the same clone', async () => {
    const w = world();
    const cloneEntry = (uri: string): ManifestEntry => ({
      path: 'repos/astro-docs',
      type: 'clone',
      key: 'reference/astro-docs',
      uri,
      branch: null,
      depth: 1,
      sparse: null,
    });
    const same = await plan(w, seedRecipe(), {
      previous: manifest([cloneEntry('https://github.com/withastro/docs.git')]),
    });
    expect(same.steps.find((s) => s.id === 'clone:reference/astro-docs')).toEqual({
      kind: 'gitUpdate',
      id: 'clone:reference/astro-docs',
      path: 'repos/astro-docs',
      label: 'git pull repos/astro-docs',
      expect: 'update',
      key: 'reference/astro-docs',
      after: [],
      uri: 'https://github.com/withastro/docs.git',
      depth: 1,
      branch: null,
      sparse: 'src/content/docs/en',
    });
    const other = await plan(w, seedRecipe(), {
      previous: manifest([cloneEntry('https://example.test/other/docs.git')]),
    });
    expect(other.steps.find((s) => s.id === 'clone:reference/astro-docs')).toMatchObject({
      kind: 'gitClone',
      expect: 'create',
    });
    const none = await plan(w, seedRecipe());
    expect(none.steps.find((s) => s.id === 'clone:reference/astro-docs')?.kind).toBe('gitClone');
  });

  it('expects replace where the previous manifest has an entry at the path, create elsewhere', async () => {
    const w = world();
    const p = await plan(w, seedRecipe(), {
      previous: manifest([
        { path: 'kb/ctxman', type: 'symlink', key: 'kb/ctxman', target: '/old' },
        {
          path: '.claude/skills/okf-authoring',
          type: 'copy',
          key: 'skill/okf-authoring',
          source: '/old',
        },
      ]),
    });
    const expectOf = (id: string) => p.steps.find((s) => s.id === id)?.expect;
    expect(expectOf('okf:kb/ctxman')).toBe('replace');
    expect(expectOf('skill:skill/okf-authoring')).toBe('replace');
    expect(expectOf('okf:kb/astro-content-layer')).toBe('create');
    expect(expectOf('skill:skill/ctxman-add-entry')).toBe('create');
  });

  it('removes only previous paths the new plan does not own, sorted by path, right after ensureDir', async () => {
    const w = world();
    const previous = manifest([
      file('LLM_CONTEXT.md', 'context'),
      claudeStub,
      file('AGENTS.md', 'agents-md'),
      {
        path: 'repos/zeta',
        type: 'clone',
        key: 'reference/zeta',
        uri: 'u',
        branch: null,
        depth: 1,
        sparse: null,
      },
      { path: 'kb/ctxman', type: 'symlink', key: 'kb/ctxman', target: '/old' },
      { path: 'kb/old-entry', type: 'symlink', key: 'kb/old-entry', target: '/old' },
      { path: '.claude/skills/gone', type: 'copy', key: 'skill/gone', source: '/old' },
      // below a path the plan owns: never removed separately
      { path: 'kb/ctxman/nested', type: 'copy', key: 'x/y', source: '/old' },
    ]);
    const p = await plan(w, seedRecipe(), { previous });
    const removed = p.steps.filter((s) => s.kind === 'remove');
    expect(removed.map((s) => s.id)).toEqual([
      'rm:.claude/skills/gone',
      'rm:AGENTS.md',
      'rm:kb/old-entry',
      'rm:repos/zeta',
    ]);
    expect(ids(p).slice(0, 5)).toEqual([
      'dir',
      'rm:.claude/skills/gone',
      'rm:AGENTS.md',
      'rm:kb/old-entry',
      'rm:repos/zeta',
    ]);
    expect(removed[1]).toEqual({
      kind: 'remove',
      id: 'rm:AGENTS.md',
      path: 'AGENTS.md',
      label: 'Remove AGENTS.md',
      expect: 'remove',
      after: [],
      entry: file('AGENTS.md', 'agents-md'),
    });
    // owned paths (context file, CLAUDE.md, kb/ctxman) are not removed
    expect(ids(p)).not.toContain('rm:CLAUDE.md');
    expect(ids(p)).not.toContain('rm:kb/ctxman');
    expect(ids(p)).not.toContain('rm:kb/ctxman/nested');
  });

  it('removes the recorded stub when it is switched off and the old context file when it is renamed', async () => {
    const w = world();
    const previous = manifest([file('LLM_CONTEXT.md', 'context'), claudeStub]);
    const p = await plan(
      w,
      seedRecipe({ output: { dir: W, contextFile: 'CONTEXT.md', stubs: { claudeMd: false } } }),
      { previous },
    );
    expect(p.steps.filter((s) => s.kind === 'remove').map((s) => s.path)).toEqual([
      'CLAUDE.md',
      'LLM_CONTEXT.md',
    ]);
  });

  it('removes nothing when there is no previous manifest', async () => {
    const w = world();
    const p = await plan(w, seedRecipe());
    expect(p.steps.some((s) => s.kind === 'remove')).toBe(false);
  });

  it('warns manifest-other-recipe with the number of removed paths', async () => {
    const w = world();
    const previous = manifest(
      [
        {
          path: 'repos/zeta',
          type: 'clone',
          key: 'reference/zeta',
          uri: 'u',
          branch: null,
          depth: 1,
          sparse: null,
        },
        { path: 'kb/old-entry', type: 'symlink', key: 'kb/old-entry', target: '/old' },
      ],
      { recipe: 'some-other-recipe' },
    );
    const p = await plan(w, seedRecipe(), { previous });
    expect(p.warnings).toEqual([
      {
        code: 'manifest-other-recipe',
        message:
          'this directory was inflated from recipe "some-other-recipe"; 2 of its paths will be removed',
      },
    ]);
    const same = await plan(w, seedRecipe(), {
      previous: { ...previous, recipe: 'ctxman-dev-brief' },
    });
    expect(codes(same.warnings)).toEqual([]);
  });
});

// ---------------------------------------------------------------- demotions

describe('planMaterialization: demotion to none with a warning', () => {
  it('demotes the second of two items with the same dest (dest-collision)', async () => {
    const w = world();
    // skill/foo -> .claude/skills/foo; reference/rs-git (subpath skills/foo) -> .claude/skills/foo
    const p = await plan(w, adhoc(['skill/foo', 'reference/rs-git']));
    expect(ids(p)).toContain('skill:skill/foo');
    expect(ids(p)).not.toContain('skill:reference/rs-git');
    expect(ids(p)).not.toContain('stage:reference/rs-git');
    expect(p.warnings).toEqual([
      {
        code: 'dest-collision',
        message:
          'reference/rs-git: .claude/skills/foo is already used by skill/foo; nothing placed',
        key: 'reference/rs-git',
      },
    ]);
    expect(p.materials['reference/rs-git']).toMatchObject({
      material: 'none',
      dest: null,
      uri: 'https://github.com/o/skills.git',
      subpath: 'skills/foo',
    });
    expect(p.materials['skill/foo']).toMatchObject({
      material: 'copy',
      dest: '.claude/skills/foo',
    });
  });

  it('the first item wins in segment order', async () => {
    const w = world();
    const p = await plan(w, adhoc(['reference/rs-git', 'skill/foo']));
    expect(ids(p)).toContain('skill:reference/rs-git');
    expect(ids(p)).not.toContain('skill:skill/foo');
    expect(p.warnings[0]).toMatchObject({ code: 'dest-collision', key: 'skill/foo' });
  });

  it('an item demoted for another reason does not occupy its dest', async () => {
    const w = world();
    const p = await plan(w, adhoc(['reference/rs-git', 'skill/foo']), {
      tools: { git: false, tar: true, unzip: true },
    });
    expect(codes(p.warnings)).toEqual(['tool-missing']);
    expect(ids(p)).toContain('skill:skill/foo');
  });

  it('demotes a clone and a git skill install when git is missing', async () => {
    const w = world();
    const p = await plan(
      w,
      adhoc(['reference/rr', 'reference/rs-git', 'reference/rs-tgz'], {}, [
        { key: 'reference/rr', material: 'clone' },
      ]),
      { tools: { git: false, tar: true, unzip: false } },
    );
    expect(p.warnings).toEqual([
      {
        code: 'tool-missing',
        message: 'reference/rr: git is not installed; nothing placed',
        key: 'reference/rr',
      },
      {
        code: 'tool-missing',
        message: 'reference/rs-git: git is not installed; nothing placed',
        key: 'reference/rs-git',
      },
    ]);
    expect(ids(p)).toContain('dl:reference/rs-tgz');
    expect(ids(p)).not.toContain('clone:reference/rr');
    expect(p.materials['reference/rr']).toMatchObject({
      material: 'none',
      dest: null,
      sparse: false,
    });
  });

  it('archives need tar; a zip needs tar or unzip', async () => {
    const w = world();
    const recipe = adhoc(['reference/rs-tgz', 'reference/rs-zip']);
    const noTar = await plan(w, recipe, { tools: { git: true, tar: false, unzip: true } });
    expect(noTar.warnings).toEqual([
      {
        code: 'tool-missing',
        message: 'reference/rs-tgz: tar is not installed; nothing placed',
        key: 'reference/rs-tgz',
      },
    ]);
    expect(ids(noTar)).toContain('dl:reference/rs-zip');
    const neither = await plan(w, recipe, { tools: { git: true, tar: false, unzip: false } });
    expect(neither.warnings.map((x) => x.key)).toEqual(['reference/rs-tgz', 'reference/rs-zip']);
    expect(ids(neither)).not.toContain('stage-cleanup');
    const tarOnly = await plan(w, recipe, { tools: { git: true, tar: true, unzip: false } });
    expect(tarOnly.warnings).toEqual([]);
  });

  it('demotes a local repo symlink whose path does not exist (source-missing)', async () => {
    const w = world();
    const p = await plan(
      w,
      adhoc(['reference/lr', 'reference/lr-gone'], {}, [
        { key: 'reference/lr', material: 'symlink' },
        { key: 'reference/lr-gone', material: 'symlink' },
      ]),
    );
    expect(p.warnings).toEqual([
      {
        code: 'source-missing',
        message: `reference/lr-gone: ${path.join(w.repo, 'missing')} does not exist; nothing placed`,
        key: 'reference/lr-gone',
      },
    ]);
    expect(ids(p)).toContain('link:reference/lr');
    expect(ids(p)).not.toContain('link:reference/lr-gone');
    expect(p.materials['reference/lr-gone']).toMatchObject({ material: 'none', dest: null });
    expect(p.materials['reference/lr']).toMatchObject({
      material: 'symlink',
      dest: 'repos/lr',
      sourceAbs: w.repo,
      subpath: 'src',
    });
  });

  it('demotes a primary that was placed nowhere with a primary-invalid warning', async () => {
    const w = world();
    const p = await plan(w, seedRecipe(), { tools: { git: false, tar: true, unzip: true } });
    expect(p.primary).toBeNull();
    expect(p.warnings).toEqual([
      {
        code: 'tool-missing',
        message: 'reference/astro-docs: git is not installed; nothing placed',
        key: 'reference/astro-docs',
      },
      {
        code: 'primary-invalid',
        message: 'primary reference/astro-docs is not placed in the directory',
        key: 'reference/astro-docs',
      },
    ]);
    // nothing placed for the repo, so no .gitignore line for repos/
    const ignore = p.steps.find((s) => s.id === 'stub:.gitignore');
    expect(ignore).toMatchObject({ content: expect.not.stringContaining('/repos/') });
  });
});

// ---------------------------------------------------------------- primary

describe('planMaterialization: primary', () => {
  it('is null without output.primary', async () => {
    const w = world();
    const p = await plan(w, seedRecipe({ output: { dir: W } }));
    expect(p.primary).toBeNull();
    expect(p.warnings).toEqual([]);
  });

  it('is the key when the plan validated it and the repo is placed (local symlink too)', async () => {
    const w = world();
    const local = await plan(
      w,
      adhoc(['reference/lr'], { output: { dir: W, primary: 'reference/lr' } }, [
        { key: 'reference/lr', material: 'symlink' },
      ]),
    );
    expect(local.primary).toBe('reference/lr');
  });

  it('an invalid primary (plan verdict) yields null and no extra warning', async () => {
    const w = world();
    // material none -> not eligible
    const p = await plan(
      w,
      adhoc(['reference/rr'], { output: { dir: W, primary: 'reference/rr' } }),
    );
    expect(p.primary).toBeNull();
    expect(p.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------- groups: remote repos, remote skills

describe('planMaterialization: step groups', () => {
  it('orders okf, skills, local repos, remote repos, remote skills, then stage cleanup and the writes', async () => {
    const w = world();
    const recipe = adhoc(
      [
        'reference/rs-tgz',
        'reference/rr',
        'reference/lr',
        'skill/foo',
        'kb/ctxman',
        'reference/rs-git-root',
      ],
      {},
      [
        { key: 'reference/rr', material: 'clone' },
        { key: 'reference/lr', material: 'symlink' },
      ],
    );
    const p = await plan(w, recipe);
    expect(ids(p)).toEqual([
      'dir',
      'okf:kb/ctxman',
      'skill:skill/foo',
      'link:reference/lr',
      'clone:reference/rr',
      'dl:reference/rs-tgz',
      'x:reference/rs-tgz',
      'skill:reference/rs-tgz',
      'stage:reference/rs-git-root',
      'skill:reference/rs-git-root',
      'stage-cleanup',
      'context',
      'stub:CLAUDE.md',
      'stub:.gitignore',
      'manifest',
    ]);
  });

  it('remote skill from git: staged shallow clone of the subpath, then placeSkill', async () => {
    const w = world();
    const p = await plan(
      w,
      adhoc(['reference/rs-git'], {}, [
        { key: 'reference/rs-git', materialOptions: { branch: 'release/1.2' } },
      ]),
    );
    const byId = (id: string) => p.steps.find((s) => s.id === id);
    expect(byId('stage:reference/rs-git')).toEqual({
      kind: 'gitClone',
      id: 'stage:reference/rs-git',
      path: '.ctxman-tmp/rs-git',
      label: 'git clone https://github.com/o/skills.git (staging)',
      expect: 'create',
      key: 'reference/rs-git',
      after: [],
      uri: 'https://github.com/o/skills.git',
      depth: 1,
      branch: 'release/1.2',
      sparse: 'skills/foo',
      stage: true,
    });
    expect(byId('skill:reference/rs-git')).toEqual({
      kind: 'placeSkill',
      id: 'skill:reference/rs-git',
      path: '.claude/skills/foo',
      label: 'Install skill → .claude/skills/foo',
      expect: 'create',
      key: 'reference/rs-git',
      after: ['stage:reference/rs-git'],
      stage: '.ctxman-tmp/rs-git',
      subpath: 'skills/foo',
      uri: 'https://github.com/o/skills.git',
    });
    expect(byId('stage-cleanup')).toEqual({
      kind: 'cleanupStage',
      id: 'stage-cleanup',
      path: '.ctxman-tmp',
      label: 'Remove .ctxman-tmp',
      expect: 'remove',
      after: [],
      always: true,
    });
    expect(p.materials['reference/rs-git']).toMatchObject({
      material: 'install',
      dest: '.claude/skills/foo',
      branch: 'release/1.2',
      depth: null,
      sparse: false,
    });
  });

  it('remote skill from an archive: download, extract, placeSkill (tgz and zip)', async () => {
    const w = world();
    const p = await plan(w, adhoc(['reference/rs-tgz', 'reference/rs-zip']));
    const byId = (id: string) => p.steps.find((s) => s.id === id);
    expect(byId('dl:reference/rs-tgz')).toEqual({
      kind: 'download',
      id: 'dl:reference/rs-tgz',
      path: '.ctxman-tmp/rs-tgz.tgz',
      label: 'Download https://h.test/skill.tar.gz',
      expect: 'create',
      key: 'reference/rs-tgz',
      after: [],
      uri: 'https://h.test/skill.tar.gz',
    });
    expect(byId('x:reference/rs-tgz')).toEqual({
      kind: 'extract',
      id: 'x:reference/rs-tgz',
      path: '.ctxman-tmp/rs-tgz',
      label: 'Extract .ctxman-tmp/rs-tgz.tgz',
      expect: 'create',
      key: 'reference/rs-tgz',
      after: ['dl:reference/rs-tgz'],
      archive: '.ctxman-tmp/rs-tgz.tgz',
      format: 'tgz',
    });
    expect(byId('skill:reference/rs-tgz')).toMatchObject({
      kind: 'placeSkill',
      path: '.claude/skills/rs-tgz',
      after: ['x:reference/rs-tgz'],
      stage: '.ctxman-tmp/rs-tgz',
      subpath: null,
    });
    // .ZIP (case-insensitive) with a subpath -> dir name = last subpath segment
    expect(byId('dl:reference/rs-zip')).toMatchObject({ path: '.ctxman-tmp/rs-zip.zip' });
    expect(byId('x:reference/rs-zip')).toMatchObject({
      format: 'zip',
      archive: '.ctxman-tmp/rs-zip.zip',
    });
    expect(byId('skill:reference/rs-zip')).toMatchObject({
      path: '.claude/skills/zipped',
      subpath: 'pkg/zipped',
    });
  });

  it('a recipe without remote skills has no stage cleanup', async () => {
    const w = world();
    const p = await plan(w, seedRecipe());
    expect(ids(p)).not.toContain('stage-cleanup');
  });

  it('okf copy material, local-repo link and codex skills dir', async () => {
    const w = world();
    const p = await plan(
      w,
      adhoc(['kb/ctxman', 'skill/foo', 'reference/lr'], { target: 'codex' }, [
        { key: 'kb/ctxman', material: 'copy' },
        { key: 'reference/lr', material: 'symlink' },
      ]),
    );
    expect(p.steps.find((s) => s.id === 'okf:kb/ctxman')).toEqual({
      kind: 'copyDir',
      id: 'okf:kb/ctxman',
      path: 'kb/ctxman',
      label: 'Copy kb/ctxman → kb/ctxman',
      expect: 'create',
      key: 'kb/ctxman',
      after: [],
      from: path.join(w.D, 'kb', 'ctxman'),
    });
    expect(p.steps.find((s) => s.id === 'skill:skill/foo')).toMatchObject({
      path: '.agents/skills/foo',
    });
    expect(p.steps.find((s) => s.id === 'link:reference/lr')).toEqual({
      kind: 'symlink',
      id: 'link:reference/lr',
      path: 'repos/lr',
      label: `Symlink repos/lr → ${w.repo}`,
      expect: 'create',
      key: 'reference/lr',
      after: [],
      target: w.repo,
    });
  });

  it('material none places nothing for that item', async () => {
    const w = world();
    const p = await plan(
      w,
      adhoc(['kb/ctxman', 'skill/foo'], {}, [
        { key: 'kb/ctxman', material: 'none' },
        { key: 'skill/foo', material: 'none' },
      ]),
    );
    expect(ids(p)).toEqual(['dir', 'context', 'stub:CLAUDE.md', 'manifest']);
    expect(p.materials['kb/ctxman']).toMatchObject({ material: 'none', dest: null });
    expect(p.warnings).toEqual([]);
  });

  it('cloneDepth, branch and subpathOnly flow into the clone step and the view', async () => {
    const w = world();
    const p = await plan(
      w,
      adhoc(['reference/rr'], {}, [
        {
          key: 'reference/rr',
          material: 'clone',
          materialOptions: { cloneDepth: 0, branch: 'main', subpathOnly: true },
        },
      ]),
    );
    expect(p.steps.find((s) => s.id === 'clone:reference/rr')).toMatchObject({
      kind: 'gitClone',
      uri: 'git@github.com:o/r.git',
      depth: 0,
      branch: 'main',
      sparse: 'docs',
    });
    expect(p.materials['reference/rr']).toMatchObject({ depth: 0, branch: 'main', sparse: true });
    const plain = await plan(
      w,
      adhoc(['reference/rr'], {}, [{ key: 'reference/rr', material: 'clone' }]),
    );
    expect(plain.steps.find((s) => s.id === 'clone:reference/rr')).toMatchObject({
      depth: 1,
      branch: null,
      sparse: null,
    });
  });
});

// ---------------------------------------------------------------- context file + stubs

describe('planMaterialization: context file and stubs', () => {
  it('uses the configured context file name in the step, label and file list', async () => {
    const w = world();
    const p = await plan(w, seedRecipe({ output: { dir: W, contextFile: 'CONTEXT.md' } }));
    expect(p.steps.find((s) => s.kind === 'writeContext')).toMatchObject({
      id: 'context',
      path: 'CONTEXT.md',
      label: 'Write CONTEXT.md',
    });
    expect(p.files[0]).toEqual({ path: 'CONTEXT.md', role: 'context' });
    expect(p.steps.find((s) => s.id === 'stub:CLAUDE.md')).toMatchObject({
      content: expect.stringContaining('@CONTEXT.md\n'),
    });
  });

  it('a stub whose name equals the context file (case-insensitive) is not written', async () => {
    const w = world();
    const p = await plan(w, seedRecipe({ output: { dir: W, contextFile: 'CLAUDE.md' } }));
    expect(ids(p)).not.toContain('stub:CLAUDE.md');
    expect(p.files.map((f) => f.path)).toEqual(['CLAUDE.md', '.gitignore']);
    const lower = await plan(w, seedRecipe({ output: { dir: W, contextFile: 'claude.md' } }));
    expect(ids(lower)).not.toContain('stub:CLAUDE.md');
  });

  it('claude-code gets CLAUDE.md, codex and generic get AGENTS.md; both can be switched', async () => {
    const w = world();
    const claude = await plan(w, seedRecipe());
    expect(ids(claude).filter((id) => id.startsWith('stub:'))).toEqual([
      'stub:CLAUDE.md',
      'stub:.gitignore',
    ]);
    for (const target of ['codex', 'generic']) {
      const p = await plan(w, seedRecipe({ target }));
      expect(ids(p).filter((id) => id.startsWith('stub:'))).toEqual([
        'stub:AGENTS.md',
        'stub:.gitignore',
      ]);
      expect(p.steps.find((s) => s.id === 'stub:AGENTS.md')).toMatchObject({
        role: 'agents-md',
        content: stubText('agents-md', 'ctxman-dev-brief', 'LLM_CONTEXT.md'),
      });
    }
    const both = await plan(
      w,
      seedRecipe({ output: { dir: W, stubs: { agentsMd: true, gitignore: false } } }),
    );
    expect(ids(both).filter((id) => id.startsWith('stub:'))).toEqual([
      'stub:CLAUDE.md',
      'stub:AGENTS.md',
    ]);
    expect(both.files.map((f) => f.role)).toEqual(['context', 'claude-md', 'agents-md']);
    const off = await plan(
      w,
      seedRecipe({ output: { dir: W, stubs: { claudeMd: false, gitignore: false } } }),
    );
    expect(ids(off).filter((id) => id.startsWith('stub:'))).toEqual([]);
  });

  it('.gitignore is written only when something is placed', async () => {
    const w = world();
    const none = await plan(w, adhoc(['kb/ctxman'], {}, [{ key: 'kb/ctxman', material: 'none' }]));
    expect(ids(none)).not.toContain('stub:.gitignore');
    expect(none.files.map((f) => f.role)).toEqual(['context', 'claude-md']);
    const some = await plan(w, adhoc(['kb/ctxman']));
    expect(ids(some)).toContain('stub:.gitignore');
  });
});

// ---------------------------------------------------------------- pure helpers

describe('stub texts', () => {
  it('CLAUDE.md imports the context file with a bare @line', () => {
    expect(stubText('claude-md', 'demo', 'LLM_CONTEXT.md')).toBe(
      [
        '# demo',
        '',
        'Generated by ctxman from the recipe `demo`. LLM_CONTEXT.md maps the repositories, skills and knowledge in this directory; read it first.',
        '',
        '@LLM_CONTEXT.md',
        '',
      ].join('\n'),
    );
  });

  it('AGENTS.md points to the context file', () => {
    expect(stubText('agents-md', 'demo', 'CONTEXT.md')).toBe(
      [
        '# demo',
        '',
        'Generated by ctxman from the recipe `demo`. Read `CONTEXT.md` first: it maps the repositories, skills and knowledge in this directory.',
        '',
        'Paths in it are relative to this directory.',
        '',
      ].join('\n'),
    );
  });

  it('.gitignore lists the manifest, the stage dir, then ignore roots in map order', () => {
    expect(
      gitignoreText('demo', [
        '.claude/skills/b',
        'task/t',
        'repos/x',
        'kb/a',
        'kb/c',
        '.claude/skills/a',
        'repos/y',
      ]),
    ).toBe(
      [
        '# Generated by ctxman (recipe demo): machine-specific content.',
        '/.ctxman-inflate.json',
        '/.ctxman-tmp/',
        '/repos/',
        '/kb/',
        '/task/',
        '/.claude/skills/b/',
        '/.claude/skills/a/',
        '',
      ].join('\n'),
    );
    expect(gitignoreText('demo', [])).toBe(
      '# Generated by ctxman (recipe demo): machine-specific content.\n/.ctxman-inflate.json\n/.ctxman-tmp/\n',
    );
  });
});

describe('cleanSubpath / archiveFormat', () => {
  it('trims and strips slashes', () => {
    expect(cleanSubpath('/a/b/ ')).toBe('a/b');
    expect(cleanSubpath('  ')).toBe('');
    expect(cleanSubpath(undefined)).toBe('');
    expect(cleanSubpath(null)).toBe('');
  });

  it('detects zip by URL pathname, case-insensitive; everything else is tgz', () => {
    expect(archiveFormat('https://h.test/a.zip')).toBe('zip');
    expect(archiveFormat('https://h.test/a.ZIP')).toBe('zip');
    expect(archiveFormat('https://h.test/a.tar.gz')).toBe('tgz');
    expect(archiveFormat('https://h.test/a.tgz')).toBe('tgz');
    expect(archiveFormat('not a url.zip')).toBe('zip');
  });
});

describe('createPathMapper (mount mapping)', () => {
  const view = (
    key: string,
    sourceAbs: string | null,
    dest: string | null,
    state: MaterialView['state'] = 'planned',
  ): MaterialView => ({
    key,
    kind: 'kb',
    material: dest === null ? 'none' : 'symlink',
    title: key,
    description: '',
    dest,
    sourceAbs,
    uri: null,
    subpath: null,
    depth: null,
    branch: null,
    sparse: false,
    owner: null,
    state,
  });
  const mapper = (views: MaterialView[]) =>
    createPathMapper(Object.fromEntries(views.map((v) => [v.key, v])));

  it('maps the source itself and everything below it; others stay absolute', () => {
    const map = mapper([view('kb/a', '/data/kb/a', 'kb/a')]);
    expect(map('/data/kb/a')).toBe('kb/a');
    expect(map('/data/kb/a/main.md')).toBe('kb/a/main.md');
    expect(map('/data/kb/a/concepts/x.md')).toBe('kb/a/concepts/x.md');
    expect(map('/data/kb/ab/main.md')).toBe('/data/kb/ab/main.md');
    expect(map('/data/kb/a.md')).toBe('/data/kb/a.md');
    expect(map('/elsewhere/x')).toBe('/elsewhere/x');
  });

  it('the longest source wins (a repo inside another mounted tree)', () => {
    const map = mapper([
      view('reference/outer', '/code', 'repos/outer'),
      view('reference/inner', '/code/inner', 'repos/inner'),
    ]);
    expect(map('/code/inner/src/a.ts')).toBe('repos/inner/src/a.ts');
    expect(map('/code/other/b.ts')).toBe('repos/outer/other/b.ts');
  });

  it('converts backslash separators of the remainder', () => {
    const map = mapper([view('kb/a', 'C:\\data\\kb\\a', 'kb/a')]);
    expect(map('C:\\data\\kb\\a\\concepts\\x.md')).toBe('kb/a/concepts/x.md');
    expect(map('C:\\data\\kb\\a')).toBe('kb/a');
  });

  it('ignores failed views, views without a dest and views without a source', () => {
    const map = mapper([
      view('kb/failed', '/data/kb/failed', 'kb/failed', 'failed'),
      view('kb/none', '/data/kb/none', null),
      view('reference/remote', null, 'repos/remote'),
    ]);
    expect(map('/data/kb/failed/main.md')).toBe('/data/kb/failed/main.md');
    expect(map('/data/kb/none/main.md')).toBe('/data/kb/none/main.md');
    expect(map('repos/remote')).toBe('repos/remote');
  });

  it('an ok view still maps (state ok = placed)', () => {
    const map = mapper([view('kb/a', '/data/kb/a', 'kb/a', 'ok')]);
    expect(map('/data/kb/a/main.md')).toBe('kb/a/main.md');
  });
});
