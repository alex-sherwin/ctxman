import { describe, expect, it } from 'vitest';
import { LINKABLE_DATASETS, datasetDef } from '../../src/datasets/registry.ts';
import {
  BLOCK_ID_PATTERN,
  CLONE_DIR_MESSAGE,
  EXTRA_KEY,
  FAMILY_MODES,
  INFLATE_LAYOUTS,
  INFLATE_TARGETS,
  ITEM_KEY_PATTERN,
  ITEM_KIND_LABELS,
  ITEM_KINDS,
  LAYOUT_LABELS,
  MODE_IDS,
  OPTION_DEFS,
  OPTION_IDS,
  REFERENCE_MODE_IDS,
  SEGMENT_KEY_PATTERN,
  TARGETS,
  TREE_LIMIT_CHOICES,
  baseOptionValue,
  ctxKey,
  defaultModeFor,
  familyOf,
  inlineCode,
  isInflateTarget,
  isModeFor,
  isSafeRelativeDir,
  itemKey,
  itemKindOf,
  mdKey,
  modeDef,
  modesFor,
  nextBlockId,
  parseItemKey,
  resolveOptions,
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
    });
    expect(TARGETS.codex).toMatchObject({
      id: 'codex',
      label: 'Codex',
      sessionLine: 'Prepared by ctxman for a Codex session.',
      skillsDir: '.agents/skills',
      instructionsFile: 'AGENTS.md',
      skillsLine:
        'Skills go in `.agents/skills/<name>/`; project-wide instructions belong in `AGENTS.md`.',
    });
    expect(TARGETS.generic).toMatchObject({
      id: 'generic',
      label: 'Generic agent',
      sessionLine: 'Prepared by ctxman for an AI coding agent.',
      skillsDir: '.agents/skills',
      instructionsFile: null,
      skillsLine: null,
    });
  });

  it('eagerClause: bare @path for Claude Code, a backticked "read" sentence otherwise', () => {
    expect(TARGETS['claude-code'].eagerClause('/d/kb/demo/main.md')).toBe(
      'Read it before starting: @/d/kb/demo/main.md',
    );
    expect(TARGETS.codex.eagerClause('/d/kb/demo/main.md')).toBe(
      'Read `/d/kb/demo/main.md` before starting.',
    );
    expect(TARGETS.generic.eagerClause('/d/a b/main.md')).toBe(
      'Read `/d/a b/main.md` before starting.',
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
  it('lists the 11 kinds in order', () => {
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
        'Inline main.md',
        "Embed the entry's main.md.",
        ['includeFrontmatter', 'shiftHeadings', 'rewriteLinks'],
      ],
      [
        'inline-bundle',
        'Inline bundle',
        'Embed main.md and every concept file, in index order.',
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

describe('defaultModeFor (spec 4.3)', () => {
  const table: Record<ItemKind, [ModeId, ModeId, ModeId]> = {
    kb: ['inline-main', 'inline-main', 'inline-main'],
    rca: ['inline-main', 'inline-main', 'inline-main'],
    idea: ['summary', 'summary', 'summary'],
    task: ['summary', 'summary', 'summary'],
    bug: ['summary', 'summary', 'summary'],
    feature: ['summary', 'summary', 'summary'],
    project: ['summary', 'summary', 'summary'],
    skill: ['install', 'install', 'pointer'],
    'local-repo': ['describe', 'describe', 'describe'],
    'remote-repo': ['describe', 'describe', 'describe'],
    'remote-skill': ['install', 'install', 'describe'],
  };
  const targets: InflateTarget[] = ['claude-code', 'codex', 'generic'];

  it.each(ITEM_KINDS.map((k) => [k]))('%s', (kind) => {
    targets.forEach((target, i) => {
      expect(defaultModeFor(kind, target), `${kind}/${target}`).toBe(table[kind][i]);
      expect(isModeFor(kind, defaultModeFor(kind, target))).toBe(true);
    });
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
      'Absolute links',
      true,
      'Rewrite bundle and ctxman: links to absolute file paths.',
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
