// PURE (no fs, no astro:*; browser-safe). The Context Inflate catalog: targets, layouts, item kinds,
// include modes, options and segment keys. This is the contract the recipe schema, the expander, the
// renderer and the Inflate UI island all share (plans/INFLATE_SPEC.md §4). Imports only the registry.
import {
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  REFERENCE_TYPE_LABELS,
  datasetDef,
} from '../../datasets/registry.ts';
import type { LinkableDatasetId, OkfDatasetId, ReferenceType } from '../../datasets/registry.ts';

// ---------------------------------------------------------------- inline code

/**
 * `s` as a markdown code span: n = (longest run of '`' in s) + 1 backticks around it, with one space of
 * padding inside when s starts or ends with '`'. inlineCode('/a/b') === '`/a/b`'.
 * Lives here so `TARGETS[…].eagerClause` can use it; markdown.ts re-exports it.
 */
export function inlineCode(s: string): string {
  let longest = 0;
  for (const run of s.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const ticks = '`'.repeat(longest + 1);
  const pad = s.startsWith('`') || s.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${s}${pad}${ticks}`;
}

// ---------------------------------------------------------------- targets

export const INFLATE_TARGETS = ['claude-code', 'codex', 'generic'] as const;
export type InflateTarget = (typeof INFLATE_TARGETS)[number];

export interface TargetDef {
  id: InflateTarget;
  /** 'Claude Code' | 'Codex' | 'Generic agent' */
  label: string;
  /** Header line 1 (spec §6.3). */
  sessionLine: string;
  /** '.claude/skills' | '.agents/skills' | '.agents/skills' */
  skillsDir: string;
  /** 'CLAUDE.md' | 'AGENTS.md' | null */
  instructionsFile: string | null;
  /** Header line 3; null = omitted. */
  skillsLine: string | null;
  /** Sentence that makes the agent load `abs` up front (option `eager`). */
  eagerClause(abs: string): string;
}

export const TARGETS: Readonly<Record<InflateTarget, TargetDef>> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    sessionLine: 'Prepared by ctxman for a Claude Code session.',
    skillsDir: '.claude/skills',
    instructionsFile: 'CLAUDE.md',
    skillsLine:
      'Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.',
    // Claude Code expands a bare `@path` by loading the file (D3), so no backticks here.
    eagerClause: (abs) => `Read it before starting: @${abs}`,
  },
  codex: {
    id: 'codex',
    label: 'Codex',
    sessionLine: 'Prepared by ctxman for a Codex session.',
    skillsDir: '.agents/skills',
    instructionsFile: 'AGENTS.md',
    skillsLine:
      'Skills go in `.agents/skills/<name>/`; project-wide instructions belong in `AGENTS.md`.',
    eagerClause: (abs) => `Read ${inlineCode(abs)} before starting.`,
  },
  generic: {
    id: 'generic',
    label: 'Generic agent',
    sessionLine: 'Prepared by ctxman for an AI coding agent.',
    skillsDir: '.agents/skills',
    instructionsFile: null,
    skillsLine: null,
    eagerClause: (abs) => `Read ${inlineCode(abs)} before starting.`,
  },
};

export function isInflateTarget(v: unknown): v is InflateTarget {
  return typeof v === 'string' && (INFLATE_TARGETS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- layouts

export const INFLATE_LAYOUTS = ['grouped', 'flat'] as const;
export type InflateLayout = (typeof INFLATE_LAYOUTS)[number];
export const LAYOUT_LABELS = { grouped: 'Grouped', flat: 'Flat' } as const satisfies Record<
  InflateLayout,
  string
>;

// ---------------------------------------------------------------- item kinds (dataset, or reference type)

export const ITEM_KINDS = [
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
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

const okfLabel = (id: OkfDatasetId): string => datasetDef(id).okfType ?? id;

export const ITEM_KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  kb: okfLabel('kb'),
  rca: okfLabel('rca'),
  idea: okfLabel('idea'),
  task: okfLabel('task'),
  bug: okfLabel('bug'),
  feature: okfLabel('feature'),
  project: okfLabel('project'),
  skill: 'Skill',
  'local-repo': REFERENCE_TYPE_LABELS['local-repo'],
  'remote-repo': REFERENCE_TYPE_LABELS['remote-repo'],
  'remote-skill': REFERENCE_TYPE_LABELS['remote-skill'],
};

export type ModeFamily = 'okf' | 'skill' | 'local-repo' | 'remote-repo' | 'remote-skill';

export function familyOf(kind: ItemKind): ModeFamily {
  switch (kind) {
    case 'skill':
    case 'local-repo':
    case 'remote-repo':
    case 'remote-skill':
      return kind;
    default:
      return 'okf';
  }
}

/** dataset ≠ reference → dataset; reference → refType; reference without refType → null. */
export function itemKindOf(dataset: LinkableDatasetId, refType?: ReferenceType): ItemKind | null {
  if (dataset !== 'reference') return dataset;
  return refType ?? null;
}

// ---------------------------------------------------------------- options

export const OPTION_IDS = [
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
] as const;
export type OptionId = (typeof OPTION_IDS)[number];

export interface InflateOptions {
  includeFrontmatter: boolean;
  includeLog: boolean;
  shiftHeadings: boolean;
  rewriteLinks: boolean;
  eager: boolean;
  symlink: boolean;
  treeLimit: number;
  cloneDir: string;
  shallow: boolean;
  sparse: boolean;
}

export type BooleanOptionId = {
  [K in OptionId]: InflateOptions[K] extends boolean ? K : never;
}[OptionId];

export const TREE_LIMIT_CHOICES = [10, 25, 50, 100, 200, 500] as const;

export type OptionDef =
  | { id: BooleanOptionId; control: 'checkbox'; label: string; help: string; default: boolean }
  | {
      id: 'treeLimit';
      control: 'select-number';
      label: string;
      help: string;
      default: number;
      choices: readonly number[];
    }
  | { id: 'cloneDir'; control: 'text'; label: string; help: string; default: string };

export const OPTION_DEFS: Readonly<Record<OptionId, OptionDef>> = {
  includeFrontmatter: {
    id: 'includeFrontmatter',
    control: 'checkbox',
    label: 'Frontmatter',
    help: 'Include the raw YAML frontmatter.',
    default: false,
  },
  includeLog: {
    id: 'includeLog',
    control: 'checkbox',
    label: 'Update log',
    help: 'Append log.md.',
    default: false,
  },
  shiftHeadings: {
    id: 'shiftHeadings',
    control: 'checkbox',
    label: 'Shift headings',
    help: "Nest the item's headings under its section.",
    default: true,
  },
  rewriteLinks: {
    id: 'rewriteLinks',
    control: 'checkbox',
    label: 'Absolute links',
    help: 'Rewrite bundle and ctxman: links to absolute file paths.',
    default: true,
  },
  eager: {
    id: 'eager',
    control: 'checkbox',
    label: 'Load up front',
    help: 'Claude Code: @-mention the file; others: "read before starting".',
    default: false,
  },
  symlink: {
    id: 'symlink',
    control: 'checkbox',
    label: 'Symlink',
    help: 'Symlink instead of copying the skill folder.',
    default: false,
  },
  treeLimit: {
    id: 'treeLimit',
    control: 'select-number',
    label: 'Entries',
    help: 'Maximum entries listed.',
    default: 50,
    choices: TREE_LIMIT_CHOICES,
  },
  cloneDir: {
    id: 'cloneDir',
    control: 'text',
    label: 'Clone into',
    help: 'Project-relative directory; {name} = reference name.',
    default: '.ctxman/refs/{name}',
  },
  shallow: {
    id: 'shallow',
    control: 'checkbox',
    label: 'Shallow',
    help: 'Clone with --depth 1.',
    default: true,
  },
  sparse: {
    id: 'sparse',
    control: 'checkbox',
    label: 'Sparse subpath',
    help: 'Check out only the subpath (git sparse-checkout).',
    default: false,
  },
};

export const CLONE_DIR_MESSAGE =
  'must be a relative path inside the project (letters, digits, . _ - /, optional {name})';

const SAFE_DIR = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** `{name}` → 'x', then /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/ and no segment '.' or '..'. */
export function isSafeRelativeDir(value: string): boolean {
  const probe = value.replaceAll('{name}', 'x');
  if (!SAFE_DIR.test(probe)) return false;
  return probe.split('/').every((segment) => segment !== '.' && segment !== '..');
}

// ---------------------------------------------------------------- modes

export const MODE_IDS = [
  'inline-main',
  'inline-bundle',
  'summary',
  'pointer',
  'inline',
  'install',
  'describe',
  'tree',
  'clone',
] as const;
export type ModeId = (typeof MODE_IDS)[number];

/** Modes a `reference/<slug>` override key may name (its reference type is not known from the key alone). */
export const REFERENCE_MODE_IDS = [
  'describe',
  'tree',
  'clone',
  'install',
] as const satisfies readonly ModeId[];

export interface ModeDef {
  id: ModeId;
  label: string;
  description: string;
  options: readonly OptionId[];
}

const pointerMode = (description: string): ModeDef => ({
  id: 'pointer',
  label: 'Pointer',
  description,
  options: ['eager'],
});

export const FAMILY_MODES: Readonly<Record<ModeFamily, readonly ModeDef[]>> = {
  okf: [
    {
      id: 'inline-main',
      label: 'Inline main.md',
      description: "Embed the entry's main.md.",
      options: ['includeFrontmatter', 'shiftHeadings', 'rewriteLinks'],
    },
    {
      id: 'inline-bundle',
      label: 'Inline bundle',
      description: 'Embed main.md and every concept file, in index order.',
      options: ['includeFrontmatter', 'includeLog', 'shiftHeadings', 'rewriteLinks'],
    },
    {
      id: 'summary',
      label: 'Summary',
      description: 'Title, state, tags, description and the file path.',
      options: [],
    },
    pointerMode('One line with the file path.'),
  ],
  skill: [
    {
      id: 'install',
      label: 'Install',
      description: 'Copy (or symlink) the skill folder into the harness skills directory.',
      options: ['symlink'],
    },
    {
      id: 'inline',
      label: 'Inline SKILL.md',
      description: "Embed SKILL.md and list the skill's other files.",
      options: ['includeFrontmatter', 'shiftHeadings', 'rewriteLinks'],
    },
    pointerMode('Description plus the SKILL.md path.'),
  ],
  'local-repo': [
    {
      id: 'describe',
      label: 'Describe',
      description: 'Name, description, path and owner.',
      options: [],
    },
    {
      id: 'tree',
      label: 'Describe + tree',
      description: 'Also list the top-level entries of the path.',
      options: ['treeLimit'],
    },
  ],
  'remote-repo': [
    {
      id: 'describe',
      label: 'Describe',
      description: 'Name, description, URI and subpath.',
      options: [],
    },
    {
      id: 'clone',
      label: 'Clone',
      description: 'git clone instructions into the project.',
      options: ['cloneDir', 'shallow', 'sparse'],
    },
  ],
  'remote-skill': [
    {
      id: 'install',
      label: 'Install',
      description: 'Clone or download the skill into the harness skills directory.',
      options: [],
    },
    {
      id: 'describe',
      label: 'Describe',
      description: 'Name, description, URI and skill folder.',
      options: [],
    },
  ],
};

export function modesFor(kind: ItemKind): readonly ModeDef[] {
  return FAMILY_MODES[familyOf(kind)];
}

export function modeDef(kind: ItemKind, mode: ModeId): ModeDef | undefined {
  return modesFor(kind).find((m) => m.id === mode);
}

export function isModeFor(kind: ItemKind, mode: string): mode is ModeId {
  return modesFor(kind).some((m) => m.id === mode);
}

export function defaultModeFor(kind: ItemKind, target: InflateTarget): ModeId {
  switch (familyOf(kind)) {
    case 'okf':
      return kind === 'kb' || kind === 'rca' ? 'inline-main' : 'summary';
    case 'skill':
      return target === 'generic' ? 'pointer' : 'install';
    case 'local-repo':
      return 'describe';
    case 'remote-repo':
      return 'describe';
    case 'remote-skill':
      return target === 'generic' ? 'describe' : 'install';
  }
}

// ---------------------------------------------------------------- option resolution

function withName(value: string, slug: string): string {
  return value.replaceAll('{name}', slug);
}

function defaultOf(option: OptionId, slug: string): InflateOptions[OptionId] {
  const def = OPTION_DEFS[option];
  return def.control === 'text' ? withName(def.default, slug) : def.default;
}

/**
 * What `resolveOptions` would give for `option` without the override layer
 * (recipe default ?? built-in default; `{name}` in cloneDir → slug).
 */
export function baseOptionValue(
  _kind: ItemKind,
  _mode: ModeId,
  option: OptionId,
  slug: string,
  recipe?: Partial<InflateOptions>,
): InflateOptions[OptionId] {
  const given = recipe?.[option];
  if (given === undefined) return defaultOf(option, slug);
  return typeof given === 'string' ? withName(given, slug) : given;
}

/**
 * Resolved options for one item: only the mode's options, each = override ?? recipe default ??
 * OPTION_DEFS default; `{name}` in cloneDir → slug.
 */
export function resolveOptions(
  kind: ItemKind,
  mode: ModeId,
  slug: string,
  layers: { recipe?: Partial<InflateOptions>; override?: Partial<InflateOptions> },
): Partial<InflateOptions> {
  const out: Record<string, InflateOptions[OptionId]> = {};
  for (const option of modeDef(kind, mode)?.options ?? []) {
    const override = layers.override?.[option];
    out[option] =
      override === undefined
        ? baseOptionValue(kind, mode, option, slug, layers.recipe)
        : typeof override === 'string'
          ? withName(override, slug)
          : override;
  }
  return out as Partial<InflateOptions>;
}

// ---------------------------------------------------------------- segment keys

/** Fixed key of the "Additional items" intro (grouped layout only). */
export const EXTRA_KEY = 'sec:extra';
export const itemKey = (dataset: LinkableDatasetId, slug: string): string => `${dataset}/${slug}`;
export const mdKey = (id: string): string => `md:${id}`;
export const ctxKey = (slug: string): string => `ctx:${slug}`;

const NAME_SOURCE = NAME_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');

/** `<linkable dataset>/<NAME>` */
export const ITEM_KEY_PATTERN = new RegExp(`^(${LINKABLE_DATASETS.join('|')})\\/${NAME_SOURCE}$`);
/** Markdown block ids are entry-style names. */
export const BLOCK_ID_PATTERN: RegExp = NAME_PATTERN;
/** item key | md:<NAME> | ctx:<NAME> | sec:extra */
export const SEGMENT_KEY_PATTERN = new RegExp(
  `^(?:(?:${LINKABLE_DATASETS.join('|')})\\/${NAME_SOURCE}|md:${NAME_SOURCE}|ctx:${NAME_SOURCE}|${EXTRA_KEY})$`,
);

export function parseItemKey(key: string): { dataset: LinkableDatasetId; slug: string } | null {
  if (!ITEM_KEY_PATTERN.test(key)) return null;
  const at = key.indexOf('/');
  const dataset = key.slice(0, at) as LinkableDatasetId;
  const slug = key.slice(at + 1);
  return slug.length <= NAME_MAX_LENGTH ? { dataset, slug } : null;
}

/** 'b' + (1 + max N over ids matching /^b(\d+)$/), starting at 'b1'. */
export function nextBlockId(existing: readonly string[]): string {
  let max = 0;
  for (const id of existing) {
    const m = /^b(\d+)$/.exec(id);
    if (m !== null) max = Math.max(max, Number(m[1]));
  }
  return `b${max + 1}`;
}
