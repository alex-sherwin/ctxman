// The arktype models (src/datasets/arktypes.ts, JSON Schema generation only) must accept exactly what the zod
// schemas (src/datasets/schemas.ts, the runtime validators) accept. Samples are inline on purpose.
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  CLONE_DIR_PATTERN,
  GIT_REF_PATTERN,
  YAML_DATASET_TYPES,
  contextType,
  recipeType,
  referenceType,
} from '../../src/datasets/arktypes.ts';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import { contextSchema, recipeSchema, referenceSchema } from '../../src/datasets/schemas.ts';
import { isSafeGitRef, isSafeRelativeDir } from '../../src/lib/inflate/catalog.ts';
import { planNewEntry } from '../../src/lib/templates.ts';
import { parseYaml } from '../../src/lib/yaml.ts';

interface Zod {
  safeParse(value: unknown): { success: boolean };
}
type Sample = [label: string, value: unknown];

function expectParity(
  zod: Zod,
  ark: (value: unknown) => unknown,
  samples: readonly Sample[],
): void {
  let accepted = 0;
  for (const [label, value] of samples) {
    const zodOk = zod.safeParse(value).success;
    const arkOk = !(ark(value) instanceof type.errors);
    expect({ label, zod: zodOk, arktype: arkOk }).toEqual({ label, zod: zodOk, arktype: zodOk });
    if (zodOk) accepted++;
  }
  // The sample set must exercise both outcomes, or the comparison proves nothing.
  expect(accepted).toBeGreaterThanOrEqual(4);
  expect(samples.length - accepted).toBeGreaterThanOrEqual(4);
}

const withKeys = (base: Record<string, unknown>, change: Record<string, unknown>) => {
  const out: Record<string, unknown> = { ...base, ...change };
  for (const [key, value] of Object.entries(out)) if (value === undefined) delete out[key];
  return out;
};

// ---------------------------------------------------------------- reference

const localRepo = {
  name: 'r',
  description: 'd',
  type: 'local-repo',
  path: '/tmp/r',
  owner: 'me',
};
const remoteRepo = {
  name: 'r',
  description: 'd',
  type: 'remote-repo',
  uri: 'git@github.com:o/r.git',
  owner: 'not-me',
};
const remoteSkill = {
  name: 'r',
  description: 'd',
  type: 'remote-skill',
  uri: 'https://github.com/o/r.git',
  owner: 'me',
};

const referenceSamples: Sample[] = [
  ['local-repo', localRepo],
  ['local-repo + subpath + tags', { ...localRepo, subpath: 'src', tags: ['a', 'b'] }],
  ['remote-repo scp', remoteRepo],
  ['remote-repo ssh://', { ...remoteRepo, uri: 'ssh://git@h.test/o/r.git' }],
  ['remote-repo https', { ...remoteRepo, uri: 'https://github.com/o/r' }],
  ['remote-repo https .git', { ...remoteRepo, uri: 'https://github.com/o/r.git' }],
  ['remote-skill git', remoteSkill],
  ['remote-skill archive .tar.gz', { ...remoteSkill, uri: 'https://h.test/s.tar.gz' }],
  ['remote-skill archive .tgz', { ...remoteSkill, uri: 'https://h.test/s.tgz' }],
  ['remote-skill archive .zip', { ...remoteSkill, uri: 'https://h.test/s.zip' }],
  ['remote-skill subpath null', { ...remoteSkill, subpath: null }],
  ['remote-skill subpath string', { ...remoteSkill, subpath: 'skills/x' }],
  ['extra key', { ...localRepo, extra: 1 }],
  ['name uppercase', { ...localRepo, name: 'A' }],
  ['name 65 chars', { ...localRepo, name: 'a'.repeat(65) }],
  ['name 64 chars', { ...localRepo, name: 'a'.repeat(64) }],
  ['name double hyphen', { ...localRepo, name: 'a--b' }],
  ['name missing', withKeys(localRepo, { name: undefined })],
  ['description whitespace + newline', { ...localRepo, description: '  \n' }],
  ['description padded', { ...localRepo, description: ' x ' }],
  ['description single space', { ...localRepo, description: ' ' }],
  ['description empty', { ...localRepo, description: '' }],
  ['description missing', withKeys(localRepo, { description: undefined })],
  ['bad type', { ...localRepo, type: 'ftp' }],
  ['type missing', withKeys(localRepo, { type: undefined })],
  ['owner missing', withKeys(localRepo, { owner: undefined })],
  ['owner bad', { ...localRepo, owner: 'someone' }],
  ['archive uri on remote-repo', { ...remoteRepo, uri: 'https://h.test/s.zip' }],
  ['subpath null on remote-repo', { ...remoteRepo, subpath: null }],
  ['subpath null on local-repo', { ...localRepo, subpath: null }],
  ['uri on local-repo', { ...localRepo, uri: 'https://github.com/o/r.git' }],
  ['path on remote-repo', { ...remoteRepo, path: '/tmp' }],
  ['path empty', { ...localRepo, path: '' }],
  ['path missing', withKeys(localRepo, { path: undefined })],
  ['uri missing on remote-repo', withKeys(remoteRepo, { uri: undefined })],
  ['uri empty', { ...remoteRepo, uri: '' }],
  ['tags with empty string', { ...localRepo, tags: [''] }],
  ['tags ok', { ...localRepo, tags: ['a'] }],
  ['tags not an array', { ...localRepo, tags: 'a' }],
  ['uri https://host', { ...remoteRepo, uri: 'https://host' }],
  ['uri ssh://git@h/o/r.git', { ...remoteRepo, uri: 'ssh://git@h/o/r.git' }],
  ['uri http://h/o/r', { ...remoteRepo, uri: 'http://h/o/r' }],
  ['uri nonsense', { ...remoteRepo, uri: 'not a uri' }],
  ['uri scp without path', { ...remoteRepo, uri: 'git@github.com:' }],
  ['remote-skill uri ftp', { ...remoteSkill, uri: 'ftp://h.test/s.zip' }],
  ['remote-skill uri .rar', { ...remoteSkill, uri: 'https://h.test/b.rar' }],
  ['null', null],
  ['array', []],
  ['string', 'reference'],
  ['empty object', {}],
];

describe('arktype parity: reference', () => {
  it('agrees with referenceSchema on every sample', () => {
    expectParity(referenceSchema, referenceType, referenceSamples);
  });

  it('fills the same defaults: tags -> []', () => {
    const out = referenceType(localRepo);
    expect(out).not.toBeInstanceOf(type.errors);
    expect(out).toMatchObject({ tags: [] });
    expect(referenceSchema.parse(localRepo).tags).toEqual([]);
  });
});

// ---------------------------------------------------------------- context

const contextBase = { name: 'c', description: 'd' };
const link = (dataset: string, slug: string, extra: Record<string, unknown> = {}) => ({
  dataset,
  slug,
  ...extra,
});

const contextSamples: Sample[] = [
  ['minimal (no links)', contextBase],
  ['empty links', { ...contextBase, links: [] }],
  [
    'links + notes + tags',
    { ...contextBase, tags: ['t'], links: [link('kb', 'a', { notes: 'n' })] },
  ],
  [
    'every linkable dataset',
    {
      ...contextBase,
      links: DATASET_IDS.filter((d) => d !== 'context' && d !== 'recipe').map((d) => link(d, 'x')),
    },
  ],
  ['duplicate link', { ...contextBase, links: [link('kb', 'a'), link('kb', 'a')] }],
  [
    'duplicate link, different notes',
    {
      ...contextBase,
      links: [link('kb', 'a', { notes: '1' }), link('kb', 'a', { notes: '2' })],
    },
  ],
  ['same slug, other dataset', { ...contextBase, links: [link('kb', 'a'), link('task', 'a')] }],
  ['link to context', { ...contextBase, links: [link('context', 'a')] }],
  ['link to recipe', { ...contextBase, links: [link('recipe', 'a')] }],
  ['link to unknown dataset', { ...contextBase, links: [link('nope', 'a')] }],
  ['link slug invalid', { ...contextBase, links: [link('kb', 'A')] }],
  ['link extra key', { ...contextBase, links: [link('kb', 'a', { extra: true })] }],
  ['numeric notes', { ...contextBase, links: [link('kb', 'a', { notes: 3 })] }],
  ['links null', { ...contextBase, links: null }],
  ['links not an array', { ...contextBase, links: {} }],
  ['extra key', { ...contextBase, extra: 1 }],
  ['name invalid', { ...contextBase, name: 'Bad Name' }],
  ['description blank', { ...contextBase, description: '   ' }],
  ['description missing', { name: 'c' }],
  ['null', null],
  ['array', []],
];

describe('arktype parity: context', () => {
  it('agrees with contextSchema on every sample', () => {
    expectParity(contextSchema, contextType, contextSamples);
  });

  it('fills the same defaults: tags and links -> []', () => {
    expect(contextType(contextBase)).toMatchObject({ tags: [], links: [] });
    expect(contextSchema.parse(contextBase)).toMatchObject({ tags: [], links: [] });
  });
});

// ---------------------------------------------------------------- recipe

const recipeBase = { name: 'r', description: 'd' };
const R = (extra: Record<string, unknown>) => ({ ...recipeBase, ...extra });

const CLONE_DIRS = [
  '.ctxman/{name}',
  '{name}',
  '../x',
  'a/./b',
  'a//b',
  '/abs',
  '{nam}',
  'a b',
  '...',
  'a/..',
  '.x',
  'x.',
  'x'.repeat(200),
  'x'.repeat(201),
  '{name}{name}',
  '.{name}',
  'ok/dir-1_2',
  '',
  '.',
  '..',
  './a',
  'a/',
  'a\\b',
  'a/b/c/{name}',
  'é',
];

const GIT_REFS = [
  '',
  'main',
  'release/1.2',
  'v1.0.0',
  'feature/a-b_c',
  '-x',
  '--upload-pack=x',
  'a..b',
  '..',
  'a//b',
  'a/',
  '/a',
  'x.lock',
  'x.lock.y',
  'a/b.lock',
  'a b',
  'a@{1}',
  '.a',
  'a.',
  '9',
  'a\nb',
  'é',
  'a'.repeat(200),
  'a'.repeat(201),
];

const recipeSamples: Sample[] = [
  ['minimal', recipeBase],
  ['target codex', R({ target: 'codex' })],
  ['target generic', R({ target: 'generic' })],
  ['target bad', R({ target: 'cursor' })],
  ['layout flat', R({ layout: 'flat' })],
  ['layout bad', R({ layout: 'tree' })],
  [
    'full',
    R({
      tags: ['x'],
      target: 'codex',
      layout: 'flat',
      preamble: 'Hello\nworld',
      contexts: ['a', 'b'],
      items: [{ dataset: 'kb', slug: 'x' }],
      markdown: [{ id: 'b1', body: 'hi' }],
      overrides: [
        { key: 'kb/x', mode: 'summary', options: { shiftHeadings: false }, exclude: false },
      ],
      order: ['ctx:a', 'kb/x', 'md:b1', 'sec:extra'],
      defaults: { kb: { mode: 'inline-bundle', options: { treeLimit: 10 } } },
    }),
  ],
  ['duplicate contexts', R({ contexts: ['a', 'a'] })],
  ['context name invalid', R({ contexts: ['A'] })],
  [
    'duplicate items',
    R({
      items: [
        { dataset: 'kb', slug: 'x' },
        { dataset: 'kb', slug: 'x' },
      ],
    }),
  ],
  [
    'items kb/x + task/x',
    R({
      items: [
        { dataset: 'kb', slug: 'x' },
        { dataset: 'task', slug: 'x' },
      ],
    }),
  ],
  ['item to context', R({ items: [{ dataset: 'context', slug: 'x' }] })],
  ['item extra key', R({ items: [{ dataset: 'kb', slug: 'x', mode: 'summary' }] })],
  [
    'duplicate markdown block ids',
    R({
      markdown: [
        { id: 'b1', body: '' },
        { id: 'b1', body: 'x' },
      ],
    }),
  ],
  ['markdown block id bad', R({ markdown: [{ id: 'B 1', body: '' }] })],
  ['markdown block id empty', R({ markdown: [{ id: '', body: '' }] })],
  ['markdown body missing', R({ markdown: [{ id: 'b1' }] })],
  ['duplicate override keys', R({ overrides: [{ key: 'kb/x' }, { key: 'kb/x', exclude: true }] })],
  [
    'override mode ok (kb + inline-bundle)',
    R({ overrides: [{ key: 'kb/x', mode: 'inline-bundle' }] }),
  ],
  [
    'override mode not applicable (kb + install)',
    R({ overrides: [{ key: 'kb/x', mode: 'install' }] }),
  ],
  ['override skill + install', R({ overrides: [{ key: 'skill/x', mode: 'install' }] })],
  ['override skill + inline-main', R({ overrides: [{ key: 'skill/x', mode: 'inline-main' }] })],
  ['override reference + clone', R({ overrides: [{ key: 'reference/x', mode: 'clone' }] })],
  ['override reference + describe', R({ overrides: [{ key: 'reference/x', mode: 'describe' }] })],
  ['override reference + inline', R({ overrides: [{ key: 'reference/x', mode: 'inline' }] })],
  ['override key context/x', R({ overrides: [{ key: 'context/x' }] })],
  ['override key bare slug', R({ overrides: [{ key: 'x' }] })],
  ['override mode unknown', R({ overrides: [{ key: 'kb/x', mode: 'nope' }] })],
  ['override exclude not boolean', R({ overrides: [{ key: 'kb/x', exclude: 'yes' }] })],
  ['override extra key', R({ overrides: [{ key: 'kb/x', extra: 1 }] })],
  ['order sec:extra', R({ order: ['sec:extra'] })],
  ['order sec:other', R({ order: ['sec:other'] })],
  ['order ctx + md + item', R({ order: ['ctx:a', 'md:b1', 'kb/x'] })],
  ['order duplicate', R({ order: ['kb/x', 'kb/x'] })],
  ['order key invalid', R({ order: ['nope'] })],
  ['defaults ok', R({ defaults: { kb: { mode: 'summary' }, skill: { mode: 'install' } } })],
  ['defaults unknown kind context', R({ defaults: { context: { mode: 'summary' } } })],
  ['defaults mode not of kind (kb + clone)', R({ defaults: { kb: { mode: 'clone' } } })],
  [
    'defaults mode not of kind (skill + inline-main)',
    R({ defaults: { skill: { mode: 'inline-main' } } }),
  ],
  ['defaults mode unknown', R({ defaults: { kb: { mode: 'nope' } } })],
  ['defaults extra key', R({ defaults: { kb: { mode: 'summary', extra: 1 } } })],
  ['defaults null', R({ defaults: null })],
  ['treeLimit 0', R({ defaults: { kb: { options: { treeLimit: 0 } } } })],
  ['treeLimit 1.5', R({ defaults: { kb: { options: { treeLimit: 1.5 } } } })],
  ['treeLimit 1', R({ defaults: { kb: { options: { treeLimit: 1 } } } })],
  ['treeLimit 500', R({ defaults: { kb: { options: { treeLimit: 500 } } } })],
  ['treeLimit 501', R({ defaults: { kb: { options: { treeLimit: 501 } } } })],
  ['treeLimit string', R({ defaults: { kb: { options: { treeLimit: '5' } } } })],
  ['unknown option', R({ defaults: { kb: { options: { bogus: true } } } })],
  ['option not boolean', R({ defaults: { kb: { options: { eager: 1 } } } })],
  [
    'all options',
    R({
      defaults: {
        reference: {
          options: {
            includeFrontmatter: true,
            includeLog: false,
            shiftHeadings: true,
            rewriteLinks: false,
            eager: true,
            symlink: false,
            treeLimit: 50,
            cloneDir: '.ctxman/{name}',
            shallow: true,
            sparse: false,
          },
        },
      },
    }),
  ],
  // ---- output (Inflate v2)
  ['output empty', R({ output: {} })],
  [
    'output full',
    R({
      output: {
        dir: '~/ctxman-inflate/r',
        contextFile: 'CONTEXT.md',
        primary: 'reference/app',
        allowNonEmpty: true,
        stubs: { agentsMd: false, claudeMd: true, gitignore: false },
      },
    }),
  ],
  ['output dir ~', R({ output: { dir: '~/x' } })],
  ['output dir relative (a check warning, not a schema error)', R({ output: { dir: 'x/y' } })],
  ['output dir 1024 chars', R({ output: { dir: 'x'.repeat(1024) } })],
  ['output dir 1025 chars', R({ output: { dir: 'x'.repeat(1025) } })],
  ['output dir empty', R({ output: { dir: '' } })],
  ['output dir blank', R({ output: { dir: '   ' } })],
  ['output dir number', R({ output: { dir: 3 } })],
  ['output contextFile ok', R({ output: { contextFile: 'LLM_CONTEXT.md' } })],
  ['output contextFile folder', R({ output: { contextFile: 'a/b.md' } })],
  ['output contextFile no .md', R({ output: { contextFile: 'notes.txt' } })],
  ['output contextFile leading dot', R({ output: { contextFile: '.a.md' } })],
  ['output contextFile 100 + .md', R({ output: { contextFile: `${'a'.repeat(100)}.md` } })],
  ['output contextFile 101 + .md', R({ output: { contextFile: `${'a'.repeat(101)}.md` } })],
  ['output primary ok', R({ output: { primary: 'reference/x' } })],
  ['output primary kb', R({ output: { primary: 'kb/x' } })],
  ['output primary bad slug', R({ output: { primary: 'reference/X' } })],
  ['output primary bare', R({ output: { primary: 'x' } })],
  ['output allowNonEmpty false', R({ output: { allowNonEmpty: false } })],
  ['output allowNonEmpty string', R({ output: { allowNonEmpty: 'yes' } })],
  ['output stubs empty', R({ output: { stubs: {} } })],
  ['output stubs unknown key', R({ output: { stubs: { readme: true } } })],
  ['output stubs not boolean', R({ output: { stubs: { gitignore: 'no' } } })],
  ['output extra key', R({ output: { extra: 1 } })],
  ['output null', R({ output: null })],
  // ---- material (Inflate v2)
  ['defaults kb material copy', R({ defaults: { kb: { material: 'copy' } } })],
  ['defaults kb material none', R({ defaults: { kb: { material: 'none' } } })],
  ['defaults kb material clone', R({ defaults: { kb: { material: 'clone' } } })],
  ['defaults skill material copy', R({ defaults: { skill: { material: 'copy' } } })],
  ['defaults skill material symlink', R({ defaults: { skill: { material: 'symlink' } } })],
  [
    'defaults local-repo material symlink',
    R({ defaults: { 'local-repo': { material: 'symlink' } } }),
  ],
  ['defaults local-repo material clone', R({ defaults: { 'local-repo': { material: 'clone' } } })],
  [
    'defaults remote-repo material clone',
    R({ defaults: { 'remote-repo': { material: 'clone' } } }),
  ],
  [
    'defaults remote-repo material install',
    R({ defaults: { 'remote-repo': { material: 'install' } } }),
  ],
  [
    'defaults remote-skill material install',
    R({ defaults: { 'remote-skill': { material: 'install' } } }),
  ],
  ['defaults material unknown', R({ defaults: { kb: { material: 'nope' } } })],
  [
    'defaults materialOptions',
    R({
      defaults: {
        'remote-repo': { materialOptions: { cloneDepth: 10, branch: 'dev', subpathOnly: true } },
      },
    }),
  ],
  [
    'defaults materialOptions unknown key',
    R({ defaults: { kb: { materialOptions: { depth: 1 } } } }),
  ],
  [
    'override reference/x material copy',
    R({ overrides: [{ key: 'reference/x', material: 'copy' }] }),
  ],
  [
    'override reference/x material clone',
    R({ overrides: [{ key: 'reference/x', material: 'clone' }] }),
  ],
  [
    'override reference/x material symlink',
    R({ overrides: [{ key: 'reference/x', material: 'symlink' }] }),
  ],
  [
    'override reference/x material none',
    R({ overrides: [{ key: 'reference/x', material: 'none' }] }),
  ],
  [
    'override reference/x material install',
    R({ overrides: [{ key: 'reference/x', material: 'install' }] }),
  ],
  ['override skill/x material copy', R({ overrides: [{ key: 'skill/x', material: 'copy' }] })],
  ['override skill/x material clone', R({ overrides: [{ key: 'skill/x', material: 'clone' }] })],
  ['override kb/x material symlink', R({ overrides: [{ key: 'kb/x', material: 'symlink' }] })],
  ['override kb/x material install', R({ overrides: [{ key: 'kb/x', material: 'install' }] })],
  ['override material unknown', R({ overrides: [{ key: 'kb/x', material: 'nope' }] })],
  [
    'override mode + material both ok',
    R({ overrides: [{ key: 'reference/x', mode: 'clone', material: 'clone' }] }),
  ],
  [
    'override mode bad + material ok',
    R({ overrides: [{ key: 'kb/x', mode: 'clone', material: 'symlink' }] }),
  ],
  [
    'override materialOptions ok',
    R({ overrides: [{ key: 'reference/x', materialOptions: { cloneDepth: 0, branch: '' } }] }),
  ],
  [
    'override materialOptions cloneDepth -1',
    R({ overrides: [{ key: 'reference/x', materialOptions: { cloneDepth: -1 } }] }),
  ],
  [
    'override materialOptions cloneDepth 100000',
    R({ overrides: [{ key: 'reference/x', materialOptions: { cloneDepth: 100000 } }] }),
  ],
  [
    'override materialOptions cloneDepth 100001',
    R({ overrides: [{ key: 'reference/x', materialOptions: { cloneDepth: 100001 } }] }),
  ],
  [
    'override materialOptions cloneDepth 1.5',
    R({ overrides: [{ key: 'reference/x', materialOptions: { cloneDepth: 1.5 } }] }),
  ],
  [
    'override materialOptions subpathOnly string',
    R({ overrides: [{ key: 'reference/x', materialOptions: { subpathOnly: 'y' } }] }),
  ],
  [
    'override materialOptions extra key',
    R({ overrides: [{ key: 'reference/x', materialOptions: { other: 1 } }] }),
  ],
  ...GIT_REFS.map<Sample>((branch) => [
    `override branch ${JSON.stringify(branch.length > 40 ? `${branch.length} chars` : branch)}`,
    R({ overrides: [{ key: 'reference/x', materialOptions: { branch } }] }),
  ]),
  ...GIT_REFS.map<Sample>((branch) => [
    `default branch ${JSON.stringify(branch.length > 40 ? `${branch.length} chars` : branch)}`,
    R({ defaults: { 'remote-skill': { materialOptions: { branch } } } }),
  ]),
  ['preamble string', R({ preamble: 'text' })],
  ['preamble number', R({ preamble: 3 })],
  ['extra key', R({ extra: 1 })],
  ['name invalid', R({ name: 'Bad' })],
  ['description blank', R({ description: ' ' })],
  ['null', null],
  ['array', []],
  ...CLONE_DIRS.map<Sample>((cloneDir) => [
    `cloneDir ${JSON.stringify(cloneDir.length > 40 ? `${cloneDir.length} chars` : cloneDir)}`,
    R({ defaults: { reference: { options: { cloneDir } } } }),
  ]),
  ...CLONE_DIRS.map<Sample>((cloneDir) => [
    `override cloneDir ${JSON.stringify(cloneDir.length > 40 ? `${cloneDir.length} chars` : cloneDir)}`,
    R({ overrides: [{ key: 'reference/x', options: { cloneDir } }] }),
  ]),
];

describe('arktype parity: recipe', () => {
  it('agrees with recipeSchema on every sample', () => {
    expectParity(recipeSchema, recipeType, recipeSamples);
  });

  it('fills the same defaults', () => {
    const expected = {
      tags: [],
      target: 'claude-code',
      layout: 'grouped',
      contexts: [],
      items: [],
      markdown: [],
      overrides: [],
      order: [],
      defaults: {},
    };
    expect(recipeType(recipeBase)).toMatchObject(expected);
    expect(recipeSchema.parse(recipeBase)).toMatchObject(expected);
    // `output` itself has no default, but its contextFile has
    expect(recipeType(recipeBase)).not.toHaveProperty('output');
    expect(recipeSchema.parse(recipeBase)).not.toHaveProperty('output');
    expect(recipeType(R({ output: {} }))).toMatchObject({
      output: { contextFile: 'LLM_CONTEXT.md' },
    });
    expect(recipeSchema.parse(R({ output: {} }))).toMatchObject({
      output: { contextFile: 'LLM_CONTEXT.md' },
    });
  });

  it('GIT_REF_PATTERN is the regex form of isSafeGitRef', () => {
    for (const ref of GIT_REFS) {
      if (ref.length > 200) continue;
      expect(GIT_REF_PATTERN.test(ref), JSON.stringify(ref)).toBe(isSafeGitRef(ref));
    }
  });

  it('CLONE_DIR_PATTERN is the regex form of isSafeRelativeDir (every length 1..200 sample)', () => {
    for (const cloneDir of CLONE_DIRS) {
      if (cloneDir.length < 1 || cloneDir.length > 200) continue;
      expect(CLONE_DIR_PATTERN.test(cloneDir), JSON.stringify(cloneDir)).toBe(
        isSafeRelativeDir(cloneDir),
      );
    }
  });
});

// ---------------------------------------------------------------- templates

describe('arktype parity: files written by add-entry', () => {
  const now = new Date('2026-10-17T00:00:00Z');
  const files = [
    ...(['local-repo', 'remote-repo', 'remote-skill'] as const).map((t) =>
      planNewEntry('reference', 'demo', { now, type: t, description: 'A: tricky "one"' }),
    ),
    planNewEntry('context', 'demo', { now }),
    planNewEntry('recipe', 'demo', { now }),
  ].flat();

  it.each(files.map((f) => [f.relPath + (f.content.match(/^type: (.+)$/m)?.[1] ?? ''), f]))(
    '%s parses and validates in zod and arktype',
    (_label, file) => {
      const dataset = file.relPath.split('/')[0] as 'reference' | 'context' | 'recipe';
      const value = parseYaml(file.content);
      const zod = { reference: referenceSchema, context: contextSchema, recipe: recipeSchema }[
        dataset
      ];
      expect(zod.safeParse(value).success).toBe(true);
      expect(YAML_DATASET_TYPES[dataset](value)).not.toBeInstanceOf(type.errors);
    },
  );
});
