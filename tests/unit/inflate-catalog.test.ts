import { describe, expect, it } from 'vitest';
import { LINKABLE_DATASETS, datasetDef } from '../../src/datasets/registry.ts';
import {
  BLOCK_ID_PATTERN,
  CLONE_DIR_MESSAGE,
  CONTEXT_FILE_PATTERN,
  DEFAULT_CONTEXT_FILE,
  DEFAULT_DIR_TEMPLATE,
  DIR_MANIFEST_FILE,
  EXTRA_KEY,
  FAMILY_MATERIALS,
  FOLDERS_DIR,
  FAMILY_MODES,
  INFLATE_LAYOUTS,
  INFLATE_TARGETS,
  ITEM_KEY_PATTERN,
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  LAYOUT_LABELS,
  MATERIAL_IDS,
  MATERIAL_OPTION_DEFS,
  MATERIAL_OPTION_IDS,
  MODE_IDS,
  OPTION_DEFS,
  OPTION_IDS,
  PRIMARY_KEY_PATTERN,
  REFERENCE_MATERIAL_IDS,
  REFERENCE_MODE_IDS,
  REPOS_DIR,
  SEGMENT_KEY_PATTERN,
  STAGE_DIR,
  STUB_FILES,
  STUB_IDS,
  STUB_LABELS,
  TARGETS,
  TREE_LIMIT_CHOICES,
  baseMaterialOptionValue,
  baseOptionValue,
  ctxKey,
  defaultDirFor,
  defaultMaterialFor,
  defaultModeFor,
  familyOf,
  inlineCode,
  isEditEligible,
  isInflateTarget,
  isMaterialFor,
  isModeFor,
  isModeForPlacement,
  isPortableAbsoluteDir,
  isPrimaryEligible,
  isSafeGitRef,
  isSafeRelativeDir,
  itemKey,
  itemKindOf,
  materialDef,
  materialDescription,
  materialDest,
  materialLabel,
  materialsFor,
  mdKey,
  modeDef,
  modesFor,
  modesForPlacement,
  nextBlockId,
  parseItemKey,
  remoteSkillDirName,
  resolveMaterialOptions,
  resolveOptions,
  stubDefaults,
} from '../../src/lib/inflate/catalog.ts';
import type { InflateTarget, ItemKind, ModeId } from '../../src/lib/inflate/catalog.ts';

describe('TARGETS (spec 4.1)', () => {
  it('lists the targets in order', () => {
    expect([...INFLATE_TARGETS]).toEqual(['claude-code', 'codex', 'generic']);
    expect(Object.keys(TARGETS)).toEqual([...INFLATE_TARGETS]);
    expect(isInflateTarget('codex')).toBe(true);
    expect(isInflateTarget('vim')).toBe(false);
    expect(isInflateTarget(undefined)).toBe(false);
  });

  it('has the exact labels, lines and directories', () => {
    expect(TARGETS['claude-code']).toMatchObject({
      id: 'claude-code',
      label: 'Claude Code',
      sessionLine: 'Prepared by ctxman for a Claude Code session.',
      skillsDir: '.claude/skills',
      instructionsFile: 'CLAUDE.md',
      skillsLine:
        'Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.',
      skillsIntro: 'Installed in `.claude/skills/`, where Claude Code discovers them.',
    });
    expect(TARGETS.codex).toMatchObject({
      id: 'codex',
      label: 'Codex',
      sessionLine: 'Prepared by ctxman for a Codex session.',
      skillsDir: '.agents/skills',
      instructionsFile: 'AGENTS.md',
      skillsLine:
        'Skills go in `.agents/skills/<name>/`; project-wide instructions belong in `AGENTS.md`.',
      skillsIntro: 'Installed in `.agents/skills/`, where Codex discovers them.',
    });
    expect(TARGETS.generic).toMatchObject({
      id: 'generic',
      label: 'Generic agent',
      sessionLine: 'Prepared by ctxman for an AI coding agent.',
      skillsDir: '.agents/skills',
      instructionsFile: null,
      skillsLine: null,
      skillsIntro: 'Installed in `.agents/skills/`.',
    });
  });

  it('eagerClause: bare @path for Claude Code, a backticked "read" sentence otherwise', () => {
    expect(TARGETS['claude-code'].eagerClause('/d/kb/demo/index.md')).toBe(
      'Read it before starting: @/d/kb/demo/index.md',
    );
    expect(TARGETS.codex.eagerClause('/d/kb/demo/index.md')).toBe(
      'Read `/d/kb/demo/index.md` before starting.',
    );
    expect(TARGETS.generic.eagerClause('/d/a b/index.md')).toBe(
      'Read `/d/a b/index.md` before starting.',
    );
  });
});

describe('layouts', () => {
  it('has grouped and flat', () => {
    expect([...INFLATE_LAYOUTS]).toEqual(['grouped', 'flat']);
    expect(LAYOUT_LABELS).toEqual({ grouped: 'Grouped', flat: 'Flat' });
  });
});

describe('inlineCode', () => {
  it('wraps in one backtick when the text has none', () => {
    expect(inlineCode('/a/b')).toBe('`/a/b`');
  });
  it('uses a longer fence than the longest backtick run', () => {
    expect(inlineCode('a`b')).toBe('``a`b``');
    expect(inlineCode('a``b`c')).toBe('```a``b`c```');
  });
  it('pads with a space when the text starts or ends with a backtick', () => {
    expect(inlineCode('`a')).toBe('`` `a ``');
    expect(inlineCode('a`')).toBe('`` a` ``');
  });
});

describe('item kinds', () => {
  it('lists the 12 kinds in order', () => {
    expect([...ITEM_KINDS]).toEqual([
      'kb',
      'rca',
      'idea',
      'task',
      'bug',
      'feature',
      'project',
      'skill',
      'local-repo',
      'local-folder',
      'remote-repo',
      'remote-skill',
    ]);
  });

  it('labels: okf type, Skill, reference type labels', () => {
    expect(ITEM_KIND_LABELS).toEqual({
      kb: 'Knowledge Base',
      rca: 'Root Cause Analysis',
      idea: 'Idea',
      task: 'Task',
      bug: 'Bug',
      feature: 'Feature',
      project: 'Project',
      skill: 'Skill',
      'local-repo': 'Local repo',
      'local-folder': 'Local folder',
      'remote-repo': 'Remote repo',
      'remote-skill': 'Remote skill',
    });
    for (const id of ['kb', 'task'] as const) {
      expect(ITEM_KIND_LABELS[id]).toBe(datasetDef(id).okfType);
    }
  });

  it('itemKindOf: dataset, or the reference type; null for a reference without a type', () => {
    for (const ds of LINKABLE_DATASETS.filter((d) => d !== 'reference')) {
      expect(itemKindOf(ds)).toBe(ds);
      expect(itemKindOf(ds, 'local-repo')).toBe(ds);
    }
    expect(itemKindOf('reference', 'local-repo')).toBe('local-repo');
    expect(itemKindOf('reference', 'remote-repo')).toBe('remote-repo');
    expect(itemKindOf('reference', 'remote-skill')).toBe('remote-skill');
    expect(itemKindOf('reference')).toBeNull();
  });

  it('familyOf groups okf datasets', () => {
    for (const k of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const) {
      expect(familyOf(k)).toBe('okf');
    }
    for (const k of ['skill', 'local-repo', 'remote-repo', 'remote-skill'] as const) {
      expect(familyOf(k)).toBe(k);
    }
  });
});

describe('modes (spec 4.2)', () => {
  const rows = (kind: ItemKind) =>
    modesFor(kind).map((m) => [m.id, m.label, m.description, [...m.options]]);

  it('okf', () => {
    expect(rows('kb')).toEqual([
      [
        'inline-main',
        'Inline entry',
        "Embed the entry's index.md.",
        ['includeFrontmatter', 'shiftHeadings', 'rewriteLinks'],
      ],
      [
        'inline-bundle',
        'Inline bundle',
        'Embed index.md and every concept file, in index order.',
        ['includeFrontmatter', 'includeLog', 'shiftHeadings', 'rewriteLinks'],
      ],
      ['summary', 'Summary', 'Title, state, tags, description and the file path.', []],
      ['pointer', 'Pointer', 'One line with the file path.', ['eager']],
    ]);
    expect(modesFor('bug')).toBe(FAMILY_MODES.okf);
  });

  it('skill', () => {
    expect(rows('skill')).toEqual([
      [
        'install',
        'Install',
        'Copy (or symlink) the skill folder into the harness skills directory.',
        ['symlink'],
      ],
      [
        'inline',
        'Inline SKILL.md',
        "Embed SKILL.md and list the skill's other files.",
        ['includeFrontmatter', 'shiftHeadings', 'rewriteLinks'],
      ],
      ['pointer', 'Pointer', 'Description plus the SKILL.md path.', ['eager']],
    ]);
  });

  it('local-repo, remote-repo, remote-skill', () => {
    expect(rows('local-repo')).toEqual([
      ['describe', 'Describe', 'Name, description, path and owner.', []],
      ['tree', 'Describe + tree', 'Also list the top-level entries of the path.', ['treeLimit']],
    ]);
    expect(rows('remote-repo')).toEqual([
      ['describe', 'Describe', 'Name, description, URI and subpath.', []],
      [
        'clone',
        'Clone',
        'git clone instructions into the project.',
        ['cloneDir', 'shallow', 'sparse'],
      ],
    ]);
    expect(rows('remote-skill')).toEqual([
      ['install', 'Install', 'Clone or download the skill into the harness skills directory.', []],
      ['describe', 'Describe', 'Name, description, URI and skill folder.', []],
    ]);
  });

  it('every mode id is used and REFERENCE_MODE_IDS are the reference-only ones', () => {
    const used = new Set(Object.values(FAMILY_MODES).flatMap((ms) => ms.map((m) => m.id)));
    expect([...used].sort()).toEqual([...MODE_IDS].sort());
    expect([...REFERENCE_MODE_IDS]).toEqual(['describe', 'tree', 'clone', 'install']);
  });

  it('isModeFor / modeDef', () => {
    expect(isModeFor('kb', 'summary')).toBe(true);
    expect(isModeFor('kb', 'install')).toBe(false);
    expect(isModeFor('skill', 'install')).toBe(true);
    expect(isModeFor('local-repo', 'clone')).toBe(false);
    expect(isModeFor('kb', 'nope')).toBe(false);
    expect(modeDef('remote-repo', 'clone')?.label).toBe('Clone');
    expect(modeDef('kb', 'clone')).toBeUndefined();
  });
});

describe('defaultModeFor (spec 4.3, ROUND3 §H.1: every okf kind is inline-main)', () => {
  const table: Record<ItemKind, [ModeId, ModeId, ModeId]> = {
    kb: ['inline-main', 'inline-main', 'inline-main'],
    rca: ['inline-main', 'inline-main', 'inline-main'],
    idea: ['inline-main', 'inline-main', 'inline-main'],
    task: ['inline-main', 'inline-main', 'inline-main'],
    bug: ['inline-main', 'inline-main', 'inline-main'],
    feature: ['inline-main', 'inline-main', 'inline-main'],
    project: ['inline-main', 'inline-main', 'inline-main'],
    skill: ['install', 'install', 'pointer'],
    'local-repo': ['describe', 'describe', 'describe'],
    'local-folder': ['describe', 'describe', 'describe'],
    'remote-repo': ['describe', 'describe', 'describe'],
    'remote-skill': ['install', 'install', 'describe'],
  };
  const targets: InflateTarget[] = ['claude-code', 'codex', 'generic'];

  it.each(ITEM_KINDS.map((k) => [k]))('%s', (kind) => {
    targets.forEach((target, i) => {
      expect(defaultModeFor(kind, target), `${kind}/${target}`).toBe(table[kind][i]);
      expect(defaultModeFor(kind, target, false), `${kind}/${target}`).toBe(table[kind][i]);
      expect(isModeFor(kind, defaultModeFor(kind, target))).toBe(true);
    });
  });
});

describe('modes per placement (plans/INFLATE_V3_PLAN.md §3.3)', () => {
  const ids = (kind: ItemKind, placed: boolean) => modesForPlacement(kind, placed).map((m) => m.id);

  it('not placed: the family list, unchanged', () => {
    for (const kind of ITEM_KINDS) {
      expect(modesForPlacement(kind, false), kind).toBe(modesFor(kind));
    }
    expect(ids('kb', false)).toEqual(['inline-main', 'inline-bundle', 'summary', 'pointer']);
    expect(ids('skill', false)).toEqual(['install', 'inline', 'pointer']);
    expect(ids('remote-repo', false)).toEqual(['describe', 'clone']);
    expect(ids('remote-skill', false)).toEqual(['install', 'describe']);
  });

  it('placed okf: summary (Summary + links) first, then pointer, inline-main, inline-bundle', () => {
    for (const kind of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const) {
      expect(ids(kind, true), kind).toEqual(['summary', 'pointer', 'inline-main', 'inline-bundle']);
    }
    const [summary, pointer, main, bundle] = modesForPlacement('kb', true);
    expect(summary).toEqual({
      id: 'summary',
      label: 'Summary + links',
      description:
        "Description, state and tags with relative links to the bundle's files; nothing inlined.",
      options: [],
    });
    expect(pointer?.options).toEqual(['eager']);
    // the inline modes are the family definitions, untouched
    expect(main).toBe(FAMILY_MODES.okf.find((m) => m.id === 'inline-main'));
    expect(bundle).toBe(FAMILY_MODES.okf.find((m) => m.id === 'inline-bundle'));
  });

  it('placed skill: pointer labelled Link, then inline', () => {
    expect(ids('skill', true)).toEqual(['pointer', 'inline']);
    expect(modesForPlacement('skill', true)[0]).toEqual({
      id: 'pointer',
      label: 'Link',
      description: 'Listed with a link to its SKILL.md; the harness discovers it.',
      options: ['eager'],
    });
  });

  it('placed repositories and remote skills', () => {
    expect(ids('local-repo', true)).toEqual(['describe', 'tree']);
    expect(ids('remote-repo', true)).toEqual(['describe']);
    expect(ids('remote-skill', true)).toEqual(['describe']);
  });

  it('every placed mode is a family mode with the family options', () => {
    for (const kind of ITEM_KINDS) {
      for (const placed of [false, true]) {
        for (const mode of modesForPlacement(kind, placed)) {
          expect(isModeFor(kind, mode.id), `${kind}/${mode.id}`).toBe(true);
          expect([...mode.options], `${kind}/${mode.id}`).toEqual([
            ...(modeDef(kind, mode.id)?.options ?? []),
          ]);
        }
      }
    }
  });

  it('isModeForPlacement', () => {
    expect(isModeForPlacement('skill', 'install', false)).toBe(true);
    expect(isModeForPlacement('skill', 'install', true)).toBe(false);
    expect(isModeForPlacement('kb', 'summary', true)).toBe(true);
    expect(isModeForPlacement('remote-repo', 'clone', true)).toBe(false);
    expect(isModeForPlacement('remote-repo', 'clone', false)).toBe(true);
    expect(isModeForPlacement('kb', 'nope', true)).toBe(false);
  });

  it('defaultModeFor(kind, target, placed): the first placed mode; summary, pointer and describe', () => {
    const placed: Record<ItemKind, [ModeId, ModeId, ModeId]> = {
      kb: ['summary', 'summary', 'summary'],
      rca: ['summary', 'summary', 'summary'],
      idea: ['summary', 'summary', 'summary'],
      task: ['summary', 'summary', 'summary'],
      bug: ['summary', 'summary', 'summary'],
      feature: ['summary', 'summary', 'summary'],
      project: ['summary', 'summary', 'summary'],
      skill: ['pointer', 'pointer', 'pointer'],
      'local-repo': ['describe', 'describe', 'describe'],
      'local-folder': ['describe', 'describe', 'describe'],
      'remote-repo': ['describe', 'describe', 'describe'],
      'remote-skill': ['describe', 'describe', 'describe'],
    };
    for (const kind of ITEM_KINDS) {
      INFLATE_TARGETS.forEach((target, i) => {
        const mode = defaultModeFor(kind, target, true);
        expect(mode, `${kind}/${target}`).toBe(placed[kind][i]);
        expect(modesForPlacement(kind, true)[0]?.id, `${kind}/${target}`).toBe(mode);
        expect(isModeForPlacement(kind, mode, true)).toBe(true);
      });
    }
  });
});

describe('options (spec 4.4)', () => {
  it('OPTION_IDS order and one def per id', () => {
    expect([...OPTION_IDS]).toEqual([
      'includeFrontmatter',
      'includeLog',
      'shiftHeadings',
      'rewriteLinks',
      'eager',
      'symlink',
      'treeLimit',
      'cloneDir',
      'shallow',
      'sparse',
    ]);
    for (const id of OPTION_IDS) expect(OPTION_DEFS[id].id).toBe(id);
  });

  it('labels, defaults, controls and help', () => {
    const row = (id: (typeof OPTION_IDS)[number]) => {
      const d = OPTION_DEFS[id];
      return [d.control, d.label, d.default, d.help];
    };
    expect(row('includeFrontmatter')).toEqual([
      'checkbox',
      'Frontmatter',
      false,
      'Include the raw YAML frontmatter.',
    ]);
    expect(row('includeLog')).toEqual(['checkbox', 'Update log', false, 'Append log.md.']);
    expect(row('shiftHeadings')).toEqual([
      'checkbox',
      'Shift headings',
      true,
      "Nest the item's headings under its section.",
    ]);
    expect(row('rewriteLinks')).toEqual([
      'checkbox',
      'Resolve links',
      true,
      'Rewrite bundle and ctxman: links to file paths (relative inside a working directory).',
    ]);
    expect(row('eager')).toEqual([
      'checkbox',
      'Load up front',
      false,
      'Claude Code: @-mention the file; others: "read before starting".',
    ]);
    expect(row('symlink')).toEqual([
      'checkbox',
      'Symlink',
      false,
      'Symlink instead of copying the skill folder.',
    ]);
    expect(row('treeLimit')).toEqual(['select-number', 'Entries', 50, 'Maximum entries listed.']);
    expect(row('cloneDir')).toEqual([
      'text',
      'Clone into',
      '.ctxman/refs/{name}',
      'Project-relative directory; {name} = reference name.',
    ]);
    expect(row('shallow')).toEqual(['checkbox', 'Shallow', true, 'Clone with --depth 1.']);
    expect(row('sparse')).toEqual([
      'checkbox',
      'Sparse subpath',
      false,
      'Check out only the subpath (git sparse-checkout).',
    ]);
    expect([...TREE_LIMIT_CHOICES]).toEqual([10, 25, 50, 100, 200, 500]);
    const tree = OPTION_DEFS.treeLimit;
    expect(tree.control === 'select-number' && tree.choices).toEqual([...TREE_LIMIT_CHOICES]);
  });

  it('resolveOptions returns only the mode options: override ?? recipe ?? default', () => {
    expect(resolveOptions('kb', 'inline-main', 'x', {})).toEqual({
      includeFrontmatter: false,
      shiftHeadings: true,
      rewriteLinks: true,
    });
    expect(
      resolveOptions('kb', 'inline-bundle', 'x', {
        recipe: { includeLog: true, shiftHeadings: false },
        override: { shiftHeadings: true, includeFrontmatter: true },
      }),
    ).toEqual({
      includeFrontmatter: true,
      includeLog: true,
      shiftHeadings: true,
      rewriteLinks: true,
    });
    expect(resolveOptions('kb', 'summary', 'x', { recipe: { includeLog: true } })).toEqual({});
    expect(resolveOptions('kb', 'install', 'x', {})).toEqual({});
  });

  it('{name} in cloneDir becomes the slug (defaults, recipe and override layers)', () => {
    expect(resolveOptions('remote-repo', 'clone', 'astro-docs', {})).toEqual({
      cloneDir: '.ctxman/refs/astro-docs',
      shallow: true,
      sparse: false,
    });
    expect(
      resolveOptions('remote-repo', 'clone', 'a', { recipe: { cloneDir: 'refs/{name}-r' } }),
    ).toMatchObject({ cloneDir: 'refs/a-r' });
    expect(
      resolveOptions('remote-repo', 'clone', 'a', {
        recipe: { cloneDir: 'refs/{name}-r' },
        override: { cloneDir: 'x/{name}' },
      }),
    ).toMatchObject({ cloneDir: 'x/a' });
    expect(resolveOptions('local-repo', 'tree', 'x', { override: { treeLimit: 10 } })).toEqual({
      treeLimit: 10,
    });
  });

  it('baseOptionValue is what resolveOptions gives without the override layer', () => {
    expect(baseOptionValue('kb', 'inline-main', 'shiftHeadings', 'x')).toBe(true);
    expect(
      baseOptionValue('kb', 'inline-main', 'shiftHeadings', 'x', { shiftHeadings: false }),
    ).toBe(false);
    expect(baseOptionValue('remote-repo', 'clone', 'cloneDir', 'n')).toBe('.ctxman/refs/n');
    expect(baseOptionValue('remote-repo', 'clone', 'cloneDir', 'n', { cloneDir: 'a/{name}' })).toBe(
      'a/n',
    );
  });
});

describe('isSafeRelativeDir', () => {
  it('accepts project-relative directories, with an optional {name}', () => {
    for (const ok of ['.ctxman/refs/{name}', 'refs/a-b', 'a', 'a.b/c_d', '{name}', '.hidden']) {
      expect(isSafeRelativeDir(ok), ok).toBe(true);
    }
  });
  it('rejects absolute, parent, dot, drive, space and empty segments', () => {
    for (const bad of [
      '/x',
      '../x',
      'a/../b',
      'C:/x',
      'a b',
      '',
      '.',
      '..',
      'a/./b',
      'a//b',
      'a/',
      'a\\b',
      '~/x',
    ]) {
      expect(isSafeRelativeDir(bad), bad).toBe(false);
    }
  });
  it('has a message', () => {
    expect(CLONE_DIR_MESSAGE).toContain('relative path');
  });
});

describe('keys', () => {
  it('builders', () => {
    expect(itemKey('kb', 'demo')).toBe('kb/demo');
    expect(mdKey('b1')).toBe('md:b1');
    expect(ctxKey('c')).toBe('ctx:c');
    expect(EXTRA_KEY).toBe('sec:extra');
  });

  it('parseItemKey', () => {
    expect(parseItemKey('reference/astro-docs')).toEqual({
      dataset: 'reference',
      slug: 'astro-docs',
    });
    expect(parseItemKey('kb/demo')).toEqual({ dataset: 'kb', slug: 'demo' });
    for (const bad of [
      'context/x',
      'recipe/x',
      'kb',
      'kb/',
      'kb/A',
      'md:b1',
      'kb/a/b',
      'x/y',
      `kb/${'a'.repeat(65)}`,
    ]) {
      expect(parseItemKey(bad), bad).toBeNull();
    }
  });

  it('ITEM_KEY_PATTERN matches linkable dataset item keys only', () => {
    for (const ds of LINKABLE_DATASETS) expect(ITEM_KEY_PATTERN.test(`${ds}/some-name`)).toBe(true);
    for (const bad of ['context/x', 'recipe/x', 'kb/', 'kb/Bad', 'kb/a--b', 'md:b1', ' kb/x']) {
      expect(ITEM_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('BLOCK_ID_PATTERN is the entry-name pattern', () => {
    for (const ok of ['b1', 'intro', 'a-b-2']) expect(BLOCK_ID_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['', 'B1', 'a_b', '-a']) expect(BLOCK_ID_PATTERN.test(bad), bad).toBe(false);
  });

  it('SEGMENT_KEY_PATTERN: item, md:, ctx: and sec:extra', () => {
    for (const ok of ['kb/demo', 'md:b1', 'ctx:ctxman-dev', 'sec:extra', 'reference/r']) {
      expect(SEGMENT_KEY_PATTERN.test(ok), ok).toBe(true);
    }
    for (const bad of ['sec:other', 'md:', 'ctx:A', 'context/x', 'kb', 'sec:extra2', 'x:y']) {
      expect(SEGMENT_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('nextBlockId', () => {
    expect(nextBlockId([])).toBe('b1');
    expect(nextBlockId(['b1', 'b7', 'x'])).toBe('b8');
    expect(nextBlockId(['x', 'b02'])).toBe('b3');
    expect(nextBlockId(['intro'])).toBe('b1');
  });
});

describe('output constants and helpers (plans/INFLATE_V2_SPEC.md §3)', () => {
  it('names the context file, manifest, staging and repos folders', () => {
    expect(DEFAULT_CONTEXT_FILE).toBe('LLM_CONTEXT.md');
    expect(DIR_MANIFEST_FILE).toBe('.ctxman-inflate.json');
    expect(STAGE_DIR).toBe('.ctxman-tmp');
    expect(REPOS_DIR).toBe('repos');
    expect(FOLDERS_DIR).toBe('folders');
    expect(DEFAULT_DIR_TEMPLATE).toBe('~/ctxman-inflate/{name}');
    expect(defaultDirFor('ctxman-dev-brief')).toBe('~/ctxman-inflate/ctxman-dev-brief');
  });

  it('CONTEXT_FILE_PATTERN: a plain .md file name', () => {
    for (const ok of [
      'LLM_CONTEXT.md',
      'CONTEXT.md',
      'a.md',
      'x-1.2_3.md',
      `${'a'.repeat(100)}.md`,
    ]) {
      expect(CONTEXT_FILE_PATTERN.test(ok), ok).toBe(true);
    }
    for (const bad of [
      '',
      '.md',
      'a',
      'a.txt',
      'a/b.md',
      'a\\b.md',
      '../a.md',
      '-a.md',
      '.hidden.md',
      'a b.md',
      `${'a'.repeat(101)}.md`,
    ]) {
      expect(CONTEXT_FILE_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('PRIMARY_KEY_PATTERN: reference/<slug> only', () => {
    expect(PRIMARY_KEY_PATTERN.test('reference/astro-docs')).toBe(true);
    for (const bad of [
      'kb/x',
      'reference/',
      'reference/A',
      'reference/a/b',
      'reference',
      'ref/x',
    ]) {
      expect(PRIMARY_KEY_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('stubs: ids, files, labels and per-target defaults', () => {
    expect([...STUB_IDS]).toEqual(['agentsMd', 'claudeMd', 'gitignore']);
    expect(STUB_FILES).toEqual({
      agentsMd: 'AGENTS.md',
      claudeMd: 'CLAUDE.md',
      gitignore: '.gitignore',
    });
    expect(STUB_LABELS).toEqual({
      agentsMd: 'AGENTS.md stub',
      claudeMd: 'CLAUDE.md stub',
      gitignore: '.gitignore',
    });
    expect(stubDefaults('claude-code')).toEqual({
      agentsMd: false,
      claudeMd: true,
      gitignore: true,
    });
    expect(stubDefaults('codex')).toEqual({ agentsMd: true, claudeMd: false, gitignore: true });
    expect(stubDefaults('generic')).toEqual({ agentsMd: true, claudeMd: false, gitignore: true });
  });

  it('isPortableAbsoluteDir: posix, home and win32 absolute forms', () => {
    for (const ok of ['~', '~/x', '~\\x', '/x', '/', 'C:\\x', 'c:/x', '\\\\srv\\x', '  /padded']) {
      expect(isPortableAbsoluteDir(ok), ok).toBe(true);
    }
    for (const bad of ['x', './x', '../x', '~user/x', '', '  ', 'C:x', 'srv/x']) {
      expect(isPortableAbsoluteDir(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('isSafeGitRef: empty (default branch) or a plain branch / tag name', () => {
    for (const ok of ['', 'trunk', 'release/1.2', 'v1.0.0', 'feature/a-b_c', 'a'.repeat(200)]) {
      expect(isSafeGitRef(ok), ok).toBe(true);
    }
    for (const bad of [
      '-x',
      '--upload-pack=x',
      'a..b',
      'a//b',
      'a/',
      'x.lock',
      'a b',
      'a@{1}',
      '/a',
      '.a',
      'a\nb',
      'a'.repeat(201),
    ]) {
      expect(isSafeGitRef(bad), bad).toBe(false);
    }
  });
});

describe('materials (plans/INFLATE_V2_SPEC.md §3)', () => {
  const row = (kind: ItemKind) =>
    materialsFor(kind).map((m) => [m.id, m.label, m.description, [...m.options]]);

  it('lists the ids, the reference subset and the option ids', () => {
    expect([...MATERIAL_IDS]).toEqual(['none', 'symlink', 'copy', 'clone', 'install']);
    expect([...REFERENCE_MATERIAL_IDS]).toEqual(['none', 'symlink', 'copy', 'clone', 'install']);
    expect([...MATERIAL_OPTION_IDS]).toEqual(['cloneDepth', 'branch', 'subpathOnly']);
    expect(Object.keys(FAMILY_MATERIALS)).toEqual([
      'okf',
      'skill',
      'local-repo',
      'local-folder',
      'remote-repo',
      'remote-skill',
    ]);
  });

  const notPlaced = [
    'none',
    "Don't place",
    'Nothing is placed; LLM_CONTEXT.md points at the original path or URI.',
    [],
  ];

  it("okf kinds: symlink, copy, Don't place", () => {
    for (const kind of ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const) {
      expect(materialsFor(kind)).toBe(FAMILY_MATERIALS.okf);
    }
    expect(row('kb')).toEqual([
      [
        'symlink',
        'Symlink',
        'Link to the original bundle at <dataset>/<slug>; edits change the ctxman entry.',
        [],
      ],
      ['copy', 'Copy', 'Snapshot at <dataset>/<slug>; replaced on every run.', []],
      notPlaced,
    ]);
  });

  it("skill: symlink (new, default), copy, Don't place", () => {
    expect(row('skill')).toEqual([
      [
        'symlink',
        'Symlink',
        'Link to the original skill folder; edits change the ctxman skill.',
        [],
      ],
      ['copy', 'Copy', 'Snapshot in the harness skills directory; replaced on every run.', []],
      notPlaced,
    ]);
  });

  it("local-repo: symlink, copy (new), Don't place", () => {
    expect(row('local-repo')).toEqual([
      [
        'symlink',
        'Symlink',
        'Link to the original repository at repos/<name>; edits change it.',
        [],
      ],
      [
        'copy',
        'Copy',
        'Snapshot without .git and node_modules at repos/<name>; replaced on every run.',
        [],
      ],
      notPlaced,
    ]);
  });

  it("local-folder: symlink, copy, Don't place, placed under folders/", () => {
    expect(row('local-folder')).toEqual([
      ['symlink', 'Symlink', 'Link to the original folder at folders/<name>; edits change it.', []],
      [
        'copy',
        'Copy',
        'Snapshot without node_modules at folders/<name>; replaced on every run.',
        [],
      ],
      notPlaced,
    ]);
    // same modes as a local repository, also when placed
    expect(modesFor('local-folder')).toBe(modesFor('local-repo'));
    expect(modesForPlacement('local-folder', true).map((m) => m.id)).toEqual(['describe', 'tree']);
  });

  it("remote-repo: clone, Don't place", () => {
    expect(row('remote-repo')).toEqual([
      [
        'clone',
        'Clone',
        'git clone into repos/<name>; later runs pull (fast-forward only).',
        ['cloneDepth', 'branch', 'subpathOnly'],
      ],
      notPlaced,
    ]);
  });

  it("remote-skill: install (Clone or download), Don't place", () => {
    expect(row('remote-skill')).toEqual([
      [
        'install',
        'Clone or download',
        'Clone the git repository or download the archive, then copy the skill folder into the harness skills directory; replaced on every run.',
        ['branch'],
      ],
      notPlaced,
    ]);
  });

  it('no material is called "Mention only" any more', () => {
    for (const kind of ITEM_KINDS) {
      expect(materialsFor(kind).map((m) => m.label)).not.toContain('Mention only');
      expect(materialDef(kind, 'none')?.label, kind).toBe("Don't place");
    }
  });

  it('materialLabel / materialDescription: remote-skill install follows the URI kind', () => {
    expect(materialLabel('remote-skill', 'install', 'git')).toBe('Clone');
    expect(materialLabel('remote-skill', 'install', 'archive')).toBe('Download');
    expect(materialLabel('remote-skill', 'install')).toBe('Clone or download');
    expect(materialLabel('remote-skill', 'install', null)).toBe('Clone or download');
    expect(materialDescription('remote-skill', 'install', 'git')).toMatch(/^Clone the repository/);
    expect(materialDescription('remote-skill', 'install', 'archive')).toMatch(
      /^Download the archive/,
    );
    expect(materialDescription('remote-skill', 'install')).toBe(
      materialDef('remote-skill', 'install')?.description,
    );
    // everything else is the static text, whatever the URI kind
    expect(materialLabel('remote-skill', 'none', 'git')).toBe("Don't place");
    expect(materialLabel('remote-repo', 'clone', 'archive')).toBe('Clone');
    expect(materialLabel('kb', 'symlink')).toBe('Symlink');
    expect(materialLabel('skill', 'copy')).toBe('Copy');
    expect(materialLabel('local-repo', 'none')).toBe("Don't place");
    expect(materialDescription('local-repo', 'copy')).toBe(
      'Snapshot without .git and node_modules at repos/<name>; replaced on every run.',
    );
    expect(materialDescription('kb', 'none')).toBe(
      'Nothing is placed; LLM_CONTEXT.md points at the original path or URI.',
    );
  });

  it('every material id is used by some family; reference ids are the non-okf/skill ones', () => {
    const used = new Set(Object.values(FAMILY_MATERIALS).flatMap((defs) => defs.map((d) => d.id)));
    expect([...used].sort()).toEqual([...MATERIAL_IDS].sort());
    const referenceIds = new Set(
      (['local-repo', 'local-folder', 'remote-repo', 'remote-skill'] as const).flatMap((k) =>
        materialsFor(k).map((m) => m.id),
      ),
    );
    expect([...referenceIds].sort()).toEqual([...REFERENCE_MATERIAL_IDS].sort());
  });

  it('isMaterialFor / materialDef', () => {
    expect(isMaterialFor('kb', 'symlink')).toBe(true);
    expect(isMaterialFor('kb', 'clone')).toBe(false);
    expect(isMaterialFor('skill', 'symlink')).toBe(true);
    expect(isMaterialFor('skill', 'clone')).toBe(false);
    expect(isMaterialFor('local-repo', 'copy')).toBe(true);
    expect(isMaterialFor('remote-repo', 'copy')).toBe(false);
    expect(isMaterialFor('remote-repo', 'clone')).toBe(true);
    expect(isMaterialFor('remote-skill', 'install')).toBe(true);
    expect(isMaterialFor('remote-skill', 'clone')).toBe(false);
    expect(isMaterialFor('kb', 'nope')).toBe(false);
    expect(materialDef('remote-repo', 'clone')?.label).toBe('Clone');
    expect(materialDef('kb', 'clone')).toBeUndefined();
  });

  it('defaultMaterialFor per kind and target', () => {
    for (const target of INFLATE_TARGETS) {
      const got = Object.fromEntries(ITEM_KINDS.map((k) => [k, defaultMaterialFor(k, target)]));
      expect(got, target).toEqual({
        kb: 'symlink',
        rca: 'symlink',
        idea: 'symlink',
        task: 'symlink',
        bug: 'symlink',
        feature: 'symlink',
        project: 'symlink',
        skill: 'symlink',
        'local-repo': 'symlink',
        'local-folder': 'symlink',
        'remote-repo': 'clone',
        'remote-skill': 'install',
      });
    }
    for (const kind of ITEM_KINDS) {
      expect(isMaterialFor(kind, defaultMaterialFor(kind, 'claude-code')), kind).toBe(true);
      // the default is the first entry of the Select list
      expect(materialsFor(kind)[0]?.id, kind).toBe(defaultMaterialFor(kind, 'claude-code'));
    }
  });

  it('isPrimaryEligible: remote-repo + clone, local-repo + symlink', () => {
    expect(isPrimaryEligible('remote-repo', 'clone')).toBe(true);
    expect(isPrimaryEligible('local-repo', 'symlink')).toBe(true);
    expect(isPrimaryEligible('remote-repo', 'none')).toBe(false);
    expect(isPrimaryEligible('local-repo', 'none')).toBe(false);
    expect(isPrimaryEligible('local-repo', 'clone')).toBe(false);
    expect(isPrimaryEligible('remote-skill', 'install')).toBe(false);
    expect(isPrimaryEligible('kb', 'symlink')).toBe(false);
    expect(isPrimaryEligible(null, 'clone')).toBe(false);
    expect(isPrimaryEligible('remote-repo', null)).toBe(false);
    // a copy has no .git
    expect(isPrimaryEligible('local-repo', 'copy')).toBe(false);
    // a local folder is not a git repository
    expect(isPrimaryEligible('local-folder', 'symlink')).toBe(false);
    expect(isPrimaryEligible('local-folder', 'copy')).toBe(false);
  });

  it('isEditEligible: local-repo / local-folder symlink or none, remote-repo clone (plans/INFLATE_V3_PLAN.md §3.2)', () => {
    expect(isEditEligible('local-repo', 'symlink')).toBe(true);
    expect(isEditEligible('local-repo', 'none')).toBe(true);
    expect(isEditEligible('local-folder', 'symlink')).toBe(true);
    expect(isEditEligible('local-folder', 'none')).toBe(true);
    expect(isEditEligible('remote-repo', 'clone')).toBe(true);
    // a copy is a snapshot, a not-cloned remote cannot be edited
    expect(isEditEligible('local-repo', 'copy')).toBe(false);
    expect(isEditEligible('local-folder', 'copy')).toBe(false);
    expect(isEditEligible('remote-repo', 'none')).toBe(false);
    expect(isEditEligible('remote-skill', 'install')).toBe(false);
    expect(isEditEligible('skill', 'symlink')).toBe(false);
    expect(isEditEligible('kb', 'symlink')).toBe(false);
    expect(isEditEligible(null, 'clone')).toBe(false);
    expect(isEditEligible('remote-repo', null)).toBe(false);
  });

  it('MATERIAL_OPTION_DEFS: controls, labels, defaults, help', () => {
    expect(Object.keys(MATERIAL_OPTION_DEFS)).toEqual([...MATERIAL_OPTION_IDS]);
    expect(MATERIAL_OPTION_DEFS.cloneDepth).toEqual({
      id: 'cloneDepth',
      control: 'select-number',
      label: 'Depth',
      help: 'Commits of history to fetch; 0 = full history.',
      default: 1,
      choices: [1, 10, 50, 0],
    });
    expect(MATERIAL_OPTION_DEFS.branch).toEqual({
      id: 'branch',
      control: 'text',
      label: 'Branch',
      help: 'Branch or tag; empty = the default branch.',
      default: '',
    });
    expect(MATERIAL_OPTION_DEFS.subpathOnly).toEqual({
      id: 'subpathOnly',
      control: 'checkbox',
      label: 'Subpath only',
      help: "Sparse checkout of the reference's subpath only.",
      default: false,
    });
  });

  it('resolveMaterialOptions: only the material options, override ?? recipe ?? built-in', () => {
    expect(resolveMaterialOptions('remote-repo', 'clone', {})).toEqual({
      cloneDepth: 1,
      branch: '',
      subpathOnly: false,
    });
    expect(
      resolveMaterialOptions('remote-repo', 'clone', {
        recipe: { cloneDepth: 10, branch: 'dev' },
        override: { cloneDepth: 0, subpathOnly: true },
      }),
    ).toEqual({ cloneDepth: 0, branch: 'dev', subpathOnly: true });
    // 0 / '' / false are values, not "unset"
    expect(
      resolveMaterialOptions('remote-repo', 'clone', {
        recipe: { cloneDepth: 50, branch: 'dev', subpathOnly: true },
        override: { cloneDepth: 0, branch: '', subpathOnly: false },
      }),
    ).toEqual({ cloneDepth: 0, branch: '', subpathOnly: false });
    expect(
      resolveMaterialOptions('remote-skill', 'install', { override: { branch: 'v2' } }),
    ).toEqual({ branch: 'v2' });
    expect(resolveMaterialOptions('remote-repo', 'none', { override: { branch: 'x' } })).toEqual(
      {},
    );
    expect(resolveMaterialOptions('kb', 'symlink', {})).toEqual({});
  });

  it('baseMaterialOptionValue is what resolveMaterialOptions gives without the override layer', () => {
    expect(baseMaterialOptionValue('cloneDepth')).toBe(1);
    expect(baseMaterialOptionValue('cloneDepth', { cloneDepth: 0 })).toBe(0);
    expect(baseMaterialOptionValue('branch', { branch: 'dev' })).toBe('dev');
    expect(baseMaterialOptionValue('subpathOnly', {})).toBe(false);
    expect(baseMaterialOptionValue('subpathOnly', { subpathOnly: true })).toBe(true);
  });

  it('remoteSkillDirName: the last subpath segment when it is an entry name, else the slug (D14)', () => {
    expect(remoteSkillDirName('anthropic-skills', 'skills/skill-creator')).toBe('skill-creator');
    expect(remoteSkillDirName('anthropic-skills', '/skills/skill-creator/')).toBe('skill-creator');
    expect(remoteSkillDirName('anthropic-skills', '  skills/skill-creator  ')).toBe(
      'skill-creator',
    );
    expect(remoteSkillDirName('anthropic-skills', 'skill-creator')).toBe('skill-creator');
    expect(remoteSkillDirName('anthropic-skills', 'Bad Name')).toBe('anthropic-skills');
    expect(remoteSkillDirName('anthropic-skills', 'skills/Bad_Name')).toBe('anthropic-skills');
    expect(remoteSkillDirName('anthropic-skills', '')).toBe('anthropic-skills');
    expect(remoteSkillDirName('anthropic-skills', '/')).toBe('anthropic-skills');
    expect(remoteSkillDirName('anthropic-skills', null)).toBe('anthropic-skills');
    expect(remoteSkillDirName('anthropic-skills', undefined)).toBe('anthropic-skills');
    expect(remoteSkillDirName('s', `x/${'a'.repeat(65)}`)).toBe('s');
  });

  it('materialDest per kind and target (posix, relative to the working directory)', () => {
    expect(materialDest('kb', 'kb', 'ctxman', 'claude-code')).toBe('kb/ctxman');
    expect(materialDest('task', 'task', 'write-agents-md', 'generic')).toBe('task/write-agents-md');
    expect(materialDest('skill', 'skill', 'okf-authoring', 'claude-code')).toBe(
      '.claude/skills/okf-authoring',
    );
    expect(materialDest('skill', 'skill', 'okf-authoring', 'codex')).toBe(
      '.agents/skills/okf-authoring',
    );
    expect(materialDest('skill', 'skill', 'okf-authoring', 'generic')).toBe(
      '.agents/skills/okf-authoring',
    );
    expect(materialDest('local-repo', 'reference', 'blasto', 'claude-code')).toBe('repos/blasto');
    expect(materialDest('local-folder', 'reference', 'notes', 'codex')).toBe('folders/notes');
    expect(materialDest('remote-repo', 'reference', 'astro-docs', 'codex')).toBe(
      'repos/astro-docs',
    );
    expect(
      materialDest(
        'remote-skill',
        'reference',
        'anthropic-skills',
        'claude-code',
        'skills/skill-creator',
      ),
    ).toBe('.claude/skills/skill-creator');
    expect(materialDest('remote-skill', 'reference', 'ksa-modding', 'codex', null)).toBe(
      '.agents/skills/ksa-modding',
    );
    expect(materialDest('remote-skill', 'reference', 'anthropic-skills', 'codex', 'Bad Name')).toBe(
      '.agents/skills/anthropic-skills',
    );
  });
});
