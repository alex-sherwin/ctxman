// PURE (no fs, no astro:*; browser-safe). The Context Inflate catalog: targets, layouts, item kinds,
// include modes, options and segment keys. This is the contract the recipe schema, the expander, the
// renderer and the Inflate UI island all share (plans/INFLATE_SPEC.md §4, plans/INFLATE_V3_PLAN.md §3). Imports
// only the registry (and a type from remote-uri).
import {
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  REFERENCE_TYPE_LABELS,
  datasetDef,
} from '../../datasets/registry.ts';
import type { LinkableDatasetId, OkfDatasetId, ReferenceType } from '../../datasets/registry.ts';
import type { RemoteUriKind } from '../remote-uri.ts';

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
  /** Working-directory document: the sentence under `## Skills` (plans/INFLATE_V2_SPEC.md §3). */
  skillsIntro: string;
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
    skillsIntro: 'Installed in `.claude/skills/`, where Claude Code discovers them.',
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
    skillsIntro: 'Installed in `.agents/skills/`, where Codex discovers them.',
    eagerClause: (abs) => `Read ${inlineCode(abs)} before starting.`,
  },
  generic: {
    id: 'generic',
    label: 'Generic agent',
    sessionLine: 'Prepared by ctxman for an AI coding agent.',
    skillsDir: '.agents/skills',
    instructionsFile: null,
    skillsLine: null,
    skillsIntro: 'Installed in `.agents/skills/`.',
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
  'local-folder',
  'remote-repo',
  'remote-skill',
  'snippet',
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
  'local-folder': REFERENCE_TYPE_LABELS['local-folder'],
  'remote-repo': REFERENCE_TYPE_LABELS['remote-repo'],
  'remote-skill': REFERENCE_TYPE_LABELS['remote-skill'],
  snippet: 'Snippet',
};

export type ModeFamily =
  | 'okf'
  | 'skill'
  | 'local-repo'
  | 'local-folder'
  | 'remote-repo'
  | 'remote-skill'
  | 'snippet';

export function familyOf(kind: ItemKind): ModeFamily {
  switch (kind) {
    case 'skill':
    case 'local-repo':
    case 'local-folder':
    case 'remote-repo':
    case 'remote-skill':
    case 'snippet':
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
    label: 'Resolve links',
    help: 'Rewrite bundle and ctxman: links to file paths (relative inside a working directory).',
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

/** Local repositories and local folders: both live at a path on this machine. */
const LOCAL_PATH_MODES: readonly ModeDef[] = [
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
];

export const FAMILY_MODES: Readonly<Record<ModeFamily, readonly ModeDef[]>> = {
  okf: [
    {
      id: 'inline-main',
      label: 'Inline entry',
      description: "Embed the entry's index.md.",
      options: ['includeFrontmatter', 'shiftHeadings', 'rewriteLinks'],
    },
    {
      id: 'inline-bundle',
      label: 'Inline bundle',
      description: 'Embed index.md and every concept file, in index order.',
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
  'local-repo': LOCAL_PATH_MODES,
  'local-folder': LOCAL_PATH_MODES,
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
  // A snippet is its markdown: there is no file to point at or place, so it is always inlined.
  snippet: [
    {
      id: 'inline',
      label: 'Inline',
      description: "Embed the snippet's markdown.",
      options: ['shiftHeadings', 'rewriteLinks'],
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

// Placement-aware mode lists (plans/INFLATE_V3_PLAN.md §3.3). `modesFor(kind)` stays the FAMILY list (what the
// schema accepts); `modesForPlacement` is what the UI offers and the expander honours: an item that is PLACED in a
// working directory is referenced with relative links instead of being inlined or installed with commands.
const PLACED_OKF_MODES: readonly ModeDef[] = [
  {
    id: 'summary',
    label: 'Summary + links',
    description:
      "Description, state and tags with relative links to the bundle's files; nothing inlined.",
    options: [],
  },
  pointerMode('One line with a link to the entry file.'),
  ...FAMILY_MODES.okf.filter((m) => m.id === 'inline-main' || m.id === 'inline-bundle'),
];
const PLACED_SKILL_MODES: readonly ModeDef[] = [
  {
    id: 'pointer',
    label: 'Link',
    description: 'Listed with a link to its SKILL.md; the harness discovers it.',
    options: ['eager'],
  },
  ...FAMILY_MODES.skill.filter((m) => m.id === 'inline'),
];
const PLACED_MODES: Readonly<Record<ModeFamily, readonly ModeDef[]>> = {
  okf: PLACED_OKF_MODES,
  skill: PLACED_SKILL_MODES,
  'local-repo': FAMILY_MODES['local-repo'],
  'local-folder': FAMILY_MODES['local-folder'],
  'remote-repo': FAMILY_MODES['remote-repo'].filter((m) => m.id === 'describe'),
  'remote-skill': FAMILY_MODES['remote-skill'].filter((m) => m.id === 'describe'),
  snippet: FAMILY_MODES.snippet,
};

/**
 * The modes offered for an item that is `placed` in a working directory (first = default) or not (the family
 * list of `modesFor`, today's behaviour). Every id is also in `modesFor(kind)`.
 */
export function modesForPlacement(kind: ItemKind, placed: boolean): readonly ModeDef[] {
  const family = familyOf(kind);
  return placed ? PLACED_MODES[family] : FAMILY_MODES[family];
}

/** True when `mode` is in `modesForPlacement(kind, placed)`. */
export function isModeForPlacement(kind: ItemKind, mode: string, placed: boolean): mode is ModeId {
  return modesForPlacement(kind, placed).some((m) => m.id === mode);
}

/**
 * Built-in default mode. `placed` (false = document only, or material none) switches to the referencing
 * defaults of plans/INFLATE_V3_PLAN.md §3.3: okf `summary`, skill `pointer`, remote-skill `describe`; the
 * two-argument form is today's behaviour.
 */
export function defaultModeFor(kind: ItemKind, target: InflateTarget, placed = false): ModeId {
  switch (familyOf(kind)) {
    case 'okf':
      // Document only: every okf kind is brought in as its index.md (plans/ROUND3_SPEC.md §H.1); a brief with
      // only a description for a task or project says too little. Placed: the files are right there.
      return placed ? 'summary' : 'inline-main';
    case 'skill':
      return placed || target === 'generic' ? 'pointer' : 'install';
    case 'local-repo':
    case 'local-folder':
    case 'remote-repo':
      return 'describe';
    case 'remote-skill':
      return placed || target === 'generic' ? 'describe' : 'install';
    case 'snippet':
      return 'inline';
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

// ---------------------------------------------------------------- output (working directory, plans/INFLATE_V2_SPEC.md §3)

export const DEFAULT_CONTEXT_FILE = 'LLM_CONTEXT.md';
export const DEFAULT_DIR_TEMPLATE = '~/ctxman-inflate/{name}';
export const defaultDirFor = (recipeName: string): string =>
  DEFAULT_DIR_TEMPLATE.replace('{name}', recipeName);

export const CONTEXT_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.md$/;
export const CONTEXT_FILE_MESSAGE =
  'must be a file name ending in .md (letters, digits, . _ -; no folders)';

/** `reference/<NAME>` */
export const PRIMARY_KEY_PATTERN: RegExp = new RegExp(`^reference\\/${NAME_SOURCE}$`);

/** What ctxman owns inside a working directory. */
export const DIR_MANIFEST_FILE = '.ctxman-inflate.json';
/** Staging folder for remote-skill installs (inside the working directory, removed after a run). */
export const STAGE_DIR = '.ctxman-tmp';
/** Destination folder of cloned / linked repositories. */
export const REPOS_DIR = 'repos';
/** Destination folder of linked / copied local folders (plain folders, not git repositories). */
export const FOLDERS_DIR = 'folders';

export const STUB_IDS = ['agentsMd', 'claudeMd', 'gitignore'] as const;
export type StubId = (typeof STUB_IDS)[number];
export const STUB_FILES = {
  agentsMd: 'AGENTS.md',
  claudeMd: 'CLAUDE.md',
  gitignore: '.gitignore',
} as const satisfies Record<StubId, string>;
export const STUB_LABELS = {
  agentsMd: 'AGENTS.md stub',
  claudeMd: 'CLAUDE.md stub',
  gitignore: '.gitignore',
} as const satisfies Record<StubId, string>;

/** claude-code: claudeMd; codex, generic: agentsMd; gitignore always. */
export function stubDefaults(target: InflateTarget): Record<StubId, boolean> {
  return target === 'claude-code'
    ? { agentsMd: false, claudeMd: true, gitignore: true }
    : { agentsMd: true, claudeMd: false, gitignore: true };
}

const PORTABLE_ABSOLUTE_DIR = /^(?:~(?:[\\/]|$)|\/|[A-Za-z]:[\\/]|\\\\)/;

/**
 * `~`, `~/…`, `~\…`, `/…`, `X:\…` / `X:/…`, `\\server\…` (posix OR win32 absolute; checked on the client too,
 * where `node:path` is unavailable and the host OS is unknown).
 */
export function isPortableAbsoluteDir(value: string): boolean {
  return PORTABLE_ABSOLUTE_DIR.test(value.trim());
}

export const GIT_REF_MESSAGE =
  'must be a branch or tag name (letters, digits, . _ - /; no "..", no leading "-")';

const GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/**
 * '' (= the default branch) or /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/ without '..', '//', '@{', a trailing
 * '/' or a trailing '.lock'. The value is passed to git as `--branch <value>` (argv, never a shell), and the
 * leading alphanumeric rules out option injection.
 */
export function isSafeGitRef(value: string): boolean {
  if (value === '') return true;
  if (!GIT_REF.test(value)) return false;
  return (
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !value.endsWith('/') &&
    !value.endsWith('.lock')
  );
}

// ---------------------------------------------------------------- materials (what is PLACED in the working directory)

export const MATERIAL_IDS = ['none', 'symlink', 'copy', 'clone', 'install'] as const;
export type MaterialId = (typeof MATERIAL_IDS)[number];

/** Materials a `reference/<slug>` override key may name (the reference type is not known from the key). */
export const REFERENCE_MATERIAL_IDS = [
  'none',
  'symlink',
  'copy',
  'clone',
  'install',
] as const satisfies readonly MaterialId[];

export const MATERIAL_OPTION_IDS = ['cloneDepth', 'branch', 'subpathOnly'] as const;
export type MaterialOptionId = (typeof MATERIAL_OPTION_IDS)[number];

export interface MaterialOptions {
  /** Commits of history to fetch; 0 = full history. */
  cloneDepth: number;
  /** '' = the default branch. */
  branch: string;
  subpathOnly: boolean;
}

export interface MaterialDef {
  id: MaterialId;
  label: string;
  description: string;
  options: readonly MaterialOptionId[];
}

const DONT_PLACE = "Don't place";
const NOT_PLACED = 'Nothing is placed; LLM_CONTEXT.md points at the original path or URI.';

const dontPlace = (): MaterialDef => ({
  id: 'none',
  label: DONT_PLACE,
  description: NOT_PLACED,
  options: [],
});

/** Order = Select order; the first entry is the built-in default (plans/INFLATE_V3_PLAN.md §3.1). */
export const FAMILY_MATERIALS: Readonly<Record<ModeFamily, readonly MaterialDef[]>> = {
  okf: [
    {
      id: 'symlink',
      label: 'Symlink',
      description:
        'Link to the original bundle at <dataset>/<slug>; edits change the ctxman entry.',
      options: [],
    },
    {
      id: 'copy',
      label: 'Copy',
      description: 'Snapshot at <dataset>/<slug>; replaced on every run.',
      options: [],
    },
    dontPlace(),
  ],
  skill: [
    {
      id: 'symlink',
      label: 'Symlink',
      description: 'Link to the original skill folder; edits change the ctxman skill.',
      options: [],
    },
    {
      id: 'copy',
      label: 'Copy',
      description: 'Snapshot in the harness skills directory; replaced on every run.',
      options: [],
    },
    dontPlace(),
  ],
  'local-repo': [
    {
      id: 'symlink',
      label: 'Symlink',
      description: 'Link to the original repository at repos/<name>; edits change it.',
      options: [],
    },
    {
      id: 'copy',
      label: 'Copy',
      description: 'Snapshot without .git and node_modules at repos/<name>; replaced on every run.',
      options: [],
    },
    dontPlace(),
  ],
  'local-folder': [
    {
      id: 'symlink',
      label: 'Symlink',
      description: 'Link to the original folder at folders/<name>; edits change it.',
      options: [],
    },
    {
      id: 'copy',
      label: 'Copy',
      description: 'Snapshot without node_modules at folders/<name>; replaced on every run.',
      options: [],
    },
    dontPlace(),
  ],
  'remote-repo': [
    {
      id: 'clone',
      label: 'Clone',
      description: 'git clone into repos/<name>; later runs pull (fast-forward only).',
      options: ['cloneDepth', 'branch', 'subpathOnly'],
    },
    dontPlace(),
  ],
  'remote-skill': [
    {
      // The label depends on the URI kind: use `materialLabel` / `materialDescription`, not these fields.
      id: 'install',
      label: 'Clone or download',
      description:
        'Clone the git repository or download the archive, then copy the skill folder into the harness skills directory; replaced on every run.',
      options: ['branch'],
    },
    dontPlace(),
  ],
  // Nothing to place: the markdown is written into LLM_CONTEXT.md itself.
  snippet: [
    {
      id: 'none',
      label: DONT_PLACE,
      description: 'Nothing to place: the markdown is written into LLM_CONTEXT.md.',
      options: [],
    },
  ],
};

export function materialsFor(kind: ItemKind): readonly MaterialDef[] {
  return FAMILY_MATERIALS[familyOf(kind)];
}

/** False for a kind with nothing to place (snippet: its markdown is in the context file): it has no Place choice. */
export function isPlaceableKind(kind: ItemKind): boolean {
  return materialsFor(kind).some((m) => m.id !== 'none');
}

export function materialDef(kind: ItemKind, material: MaterialId): MaterialDef | undefined {
  return materialsFor(kind).find((m) => m.id === material);
}

export function isMaterialFor(kind: ItemKind, material: string): material is MaterialId {
  return materialsFor(kind).some((m) => m.id === material);
}

/**
 * Select label of a material. A remote-skill `install` reads "Clone" for a git URI, "Download" for an archive
 * URI and "Clone or download" while the kind is unknown; everything else is the static `MaterialDef.label`.
 * The UI and the renderer use this, never `MaterialDef.label` for remote skills.
 */
export function materialLabel(
  kind: ItemKind,
  material: MaterialId,
  uriKind?: RemoteUriKind | null,
): string {
  if (kind === 'remote-skill' && material === 'install') {
    return uriKind === 'git' ? 'Clone' : uriKind === 'archive' ? 'Download' : 'Clone or download';
  }
  return materialDef(kind, material)?.label ?? material;
}

/** Select item description of a material (the remote-skill `install` text follows the URI kind). */
export function materialDescription(
  kind: ItemKind,
  material: MaterialId,
  uriKind?: RemoteUriKind | null,
): string {
  if (kind === 'remote-skill' && material === 'install') {
    if (uriKind === 'git') {
      return 'Clone the repository, then copy the skill folder into the harness skills directory; replaced on every run.';
    }
    if (uriKind === 'archive') {
      return 'Download the archive, then copy the skill folder into the harness skills directory; replaced on every run.';
    }
  }
  return materialDef(kind, material)?.description ?? '';
}

/**
 * okf symlink · skill symlink · local-repo symlink · local-folder symlink · remote-repo clone · remote-skill
 * install · snippet none (all targets).
 */
export function defaultMaterialFor(kind: ItemKind, _target: InflateTarget): MaterialId {
  // The first entry of each family list (checked by a unit test).
  switch (familyOf(kind)) {
    case 'okf':
    case 'skill':
    case 'local-repo':
    case 'local-folder':
      return 'symlink';
    case 'remote-repo':
      return 'clone';
    case 'remote-skill':
      return 'install';
    case 'snippet':
      return 'none';
  }
}

/**
 * A primary repository is a remote-repo with material clone, or a local-repo with material symlink (a copy has no
 * .git). A local folder is never primary: it is not a git repository.
 */
export function isPrimaryEligible(kind: ItemKind | null, material: MaterialId | null): boolean {
  return (
    (kind === 'remote-repo' && material === 'clone') ||
    (kind === 'local-repo' && material === 'symlink')
  );
}

/**
 * May the session change files in this repository or folder (plans/INFLATE_V3_PLAN.md §3.2)? A local repository
 * or local folder that is symlinked or not placed (its original path), or a cloned remote repository. A copy is
 * a snapshot and a not-cloned remote cannot be edited, so neither is eligible. The default is `true` for the
 * valid primary and `false` for every other item.
 */
export function isEditEligible(kind: ItemKind | null, material: MaterialId | null): boolean {
  return (
    ((kind === 'local-repo' || kind === 'local-folder') &&
      (material === 'symlink' || material === 'none')) ||
    (kind === 'remote-repo' && material === 'clone')
  );
}

export type MaterialOptionDef =
  | {
      id: 'cloneDepth';
      control: 'select-number';
      label: 'Depth';
      help: string;
      default: 1;
      choices: readonly [1, 10, 50, 0];
    }
  | { id: 'branch'; control: 'text'; label: 'Branch'; help: string; default: '' }
  | { id: 'subpathOnly'; control: 'checkbox'; label: 'Subpath only'; help: string; default: false };

export const MATERIAL_OPTION_DEFS: Readonly<Record<MaterialOptionId, MaterialOptionDef>> = {
  cloneDepth: {
    id: 'cloneDepth',
    control: 'select-number',
    label: 'Depth',
    help: 'Commits of history to fetch; 0 = full history.',
    default: 1,
    choices: [1, 10, 50, 0],
  },
  branch: {
    id: 'branch',
    control: 'text',
    label: 'Branch',
    help: 'Branch or tag; empty = the default branch.',
    default: '',
  },
  subpathOnly: {
    id: 'subpathOnly',
    control: 'checkbox',
    label: 'Subpath only',
    help: "Sparse checkout of the reference's subpath only.",
    default: false,
  },
};

/** What `resolveMaterialOptions` gives for `id` without the override layer (recipe default ?? built-in). */
export function baseMaterialOptionValue(
  id: MaterialOptionId,
  recipe?: Partial<MaterialOptions>,
): MaterialOptions[MaterialOptionId] {
  return recipe?.[id] ?? MATERIAL_OPTION_DEFS[id].default;
}

/**
 * Resolved material options for one item: only the material's own options, each = override ?? recipe default
 * ?? built-in (the mirror of `resolveOptions`).
 */
export function resolveMaterialOptions(
  kind: ItemKind,
  material: MaterialId,
  layers: { recipe?: Partial<MaterialOptions>; override?: Partial<MaterialOptions> },
): Partial<MaterialOptions> {
  const out: Record<string, MaterialOptions[MaterialOptionId]> = {};
  for (const id of materialDef(kind, material)?.options ?? []) {
    out[id] = layers.override?.[id] ?? baseMaterialOptionValue(id, layers.recipe);
  }
  return out as Partial<MaterialOptions>;
}

// ---------------------------------------------------------------- destinations (posix, relative to the working directory)

/**
 * Last segment of the trimmed subpath when it is a valid entry name (agentskills.io: the folder name must equal
 * the skill `name`), else `slug` (D14).
 */
export function remoteSkillDirName(slug: string, subpath: string | null | undefined): string {
  const clean = (subpath ?? '').trim().replace(/^\/+|\/+$/g, '');
  const last = clean.split('/').pop() ?? '';
  return NAME_PATTERN.test(last) && last.length <= NAME_MAX_LENGTH ? last : slug;
}

/**
 * okf `<dataset>/<slug>` · skill `<skillsDir>/<slug>` · local/remote repo `repos/<slug>` · local folder
 * `folders/<slug>` · remote-skill `<skillsDir>/<remoteSkillDirName>`.
 */
export function materialDest(
  kind: ItemKind,
  dataset: LinkableDatasetId,
  slug: string,
  target: InflateTarget,
  subpath?: string | null,
): string {
  switch (familyOf(kind)) {
    case 'okf':
      return `${dataset}/${slug}`;
    case 'skill':
      return `${TARGETS[target].skillsDir}/${slug}`;
    case 'local-repo':
    case 'remote-repo':
      return `${REPOS_DIR}/${slug}`;
    case 'local-folder':
      return `${FOLDERS_DIR}/${slug}`;
    case 'remote-skill':
      return `${TARGETS[target].skillsDir}/${remoteSkillDirName(slug, subpath)}`;
    case 'snippet':
      // never placed (its only material is `none`); a stable path keeps the switch exhaustive
      return `snippet/${slug}`;
  }
}
