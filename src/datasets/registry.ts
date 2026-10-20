// SINGLE SOURCE OF TRUTH for ctxman datasets (contract: plans/PLAN.md §D, plans/UI_SPEC.md §0.5).
// Pure TS (erasable syntax only, no astro:* imports) so it runs under Node 24 type stripping,
// Vitest, Astro SSR and browser islands alike.

export const DATASET_IDS = [
  'kb',
  'rca',
  'idea',
  'task',
  'bug',
  'feature',
  'project',
  'skill',
  'reference',
  'snippet',
  'context',
  'recipe',
] as const;
export type DatasetId = (typeof DATASET_IDS)[number];

/** okf = OKF v0.2 bundle dir (index.md = the entry, optional log.md and concepts); skill = agentskills.io dir (SKILL.md); data = one YAML file. */
export type DatasetKind = 'okf' | 'skill' | 'data';

/** The entry file of every okf bundle: the bundle-root `index.md` (entry frontmatter + `okf_version` + body). */
export const OKF_ENTRY_FILE = 'index.md';

export const OKF_DATASET_IDS = ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const;
export type OkfDatasetId = (typeof OKF_DATASET_IDS)[number];

/**
 * okf datasets whose entries track work: an optional `time` (ISO 8601 durations, one per stretch of work) and an
 * optional `resolved` (the ISO 8601 date or date-time the work was resolved) in the entry frontmatter.
 */
export const TIME_TRACKED_DATASETS = ['rca', 'task', 'bug', 'feature'] as const;
export type TimeTrackedDatasetId = (typeof TIME_TRACKED_DATASETS)[number];

/** Datasets a context (or recipe) may link to: everything except context and recipe, registry order. */
export const LINKABLE_DATASETS = [
  'kb',
  'rca',
  'idea',
  'task',
  'bug',
  'feature',
  'project',
  'skill',
  'reference',
  'snippet',
] as const;
export type LinkableDatasetId = (typeof LINKABLE_DATASETS)[number];

/** Order of the dataset links in the header nav (every dataset once). Everything else keeps the registry order. */
export const NAV_DATASET_IDS = [
  'kb',
  'idea',
  'feature',
  'task',
  'snippet',
  'project',
  'reference',
  'bug',
  'rca',
  'skill',
  'context',
  'recipe',
] as const satisfies readonly DatasetId[];

// Lifecycle state ids are kebab-case in data files (tuples feed type.enumerated in schemas.ts).
export const IDEA_STATES = ['pending', 'in-progress', 'complete', 'abandoned'] as const;
export const TASK_STATES = ['pending', 'in-progress', 'complete', 'wont-do'] as const;
export const BUG_STATES = ['pending', 'in-progress', 'fixed', 'wont-fix'] as const;
export const FEATURE_STATES = ['pending', 'in-progress', 'complete', 'wont-do'] as const;
export const PROJECT_STATES = ['pending', 'wip', 'stable', 'abandoned', 'wont-do'] as const;
export type LifecycleStateId =
  | (typeof IDEA_STATES)[number]
  | (typeof TASK_STATES)[number]
  | (typeof BUG_STATES)[number]
  | (typeof FEATURE_STATES)[number]
  | (typeof PROJECT_STATES)[number];

/** Visual/semantic grouping of states (UI_SPEC §0.5). */
export type StateGroup = 'neutral' | 'active' | 'done' | 'closed';

export const STATE_LABELS: Readonly<Record<LifecycleStateId, string>> = {
  pending: 'Pending',
  'in-progress': 'In progress',
  wip: 'WIP',
  complete: 'Complete',
  stable: 'Stable',
  abandoned: 'Abandoned',
  'wont-do': "Won't do",
  fixed: 'Fixed',
  'wont-fix': "Won't fix",
};

export const STATE_GROUPS: Readonly<Record<LifecycleStateId, StateGroup>> = {
  pending: 'neutral',
  'in-progress': 'active',
  wip: 'active',
  complete: 'done',
  stable: 'done',
  fixed: 'done',
  abandoned: 'closed',
  'wont-do': 'closed',
  'wont-fix': 'closed',
};

export interface StateDef {
  readonly id: LifecycleStateId;
  readonly label: string;
  readonly group: StateGroup;
}

const states = (ids: readonly LifecycleStateId[]): readonly StateDef[] =>
  ids.map((id) => ({ id, label: STATE_LABELS[id], group: STATE_GROUPS[id] }));

/** Structured relation kinds of an okf entry's frontmatter `links` (from = the entry that declares it). */
export const ENTRY_RELS = ['child', 'related', 'depends-on'] as const;
export type EntryRel = (typeof ENTRY_RELS)[number];
export const ENTRY_REL_LABELS: Readonly<Record<EntryRel, string>> = {
  child: 'Child',
  related: 'Related',
  'depends-on': 'Depends on',
};
/** What the TARGET's page calls an incoming edge. */
export const ENTRY_REL_INVERSE_LABELS: Readonly<Record<EntryRel, string>> = {
  child: 'Parent',
  related: 'Related',
  'depends-on': 'Required by',
};

export function isEntryRel(value: unknown): value is EntryRel {
  return typeof value === 'string' && (ENTRY_RELS as readonly string[]).includes(value);
}

export const REFERENCE_TYPES = [
  'local-repo',
  'local-folder',
  'remote-repo',
  'remote-skill',
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];
export const REFERENCE_TYPE_LABELS: Readonly<Record<ReferenceType, string>> = {
  'local-repo': 'Local repo',
  'local-folder': 'Local folder',
  'remote-repo': 'Remote repo',
  'remote-skill': 'Remote skill',
};

/** Reference types that live at a `path` on this machine (a git repository, or a plain folder); the others have a `uri`. */
export const LOCAL_REFERENCE_TYPES = ['local-repo', 'local-folder'] as const;
export type LocalReferenceType = (typeof LOCAL_REFERENCE_TYPES)[number];

export const OWNERS = ['me', 'not-me'] as const;
export type Owner = (typeof OWNERS)[number];
export const OWNER_LABELS: Readonly<Record<Owner, string>> = { me: 'me', 'not-me': 'not me' };

export interface DatasetDef {
  readonly id: DatasetId;
  /** Page title / breadcrumb label, e.g. 'Knowledge base', 'Tasks'. */
  readonly label: string;
  /** Short nav label, e.g. 'KB', 'Tasks'. */
  readonly navLabel: string;
  /** Lowercase plural noun used in sentences: 'No tasks yet.', 'Filter knowledge base entries'. */
  readonly plural: string;
  /** Lowercase singular noun used in 'New task'. */
  readonly singular: string;
  readonly kind: DatasetKind;
  /** Lifecycle states in lifecycle order; undefined = no lifecycle. First state = default for new entries. */
  readonly states?: readonly StateDef[];
  /** okf: data/<id>/<name>/index.md; skill: data/skill/<name>/SKILL.md; data: data/<id>/<name>.yaml */
  readonly entryFile: typeof OKF_ENTRY_FILE | 'SKILL.md' | '.yaml';
  /** OKF `type` that add-entry writes into index.md (okf kind only). */
  readonly okfType?: string;
  /** One sentence shown on the dashboard card. */
  readonly description: string;
}

export const DATASETS: readonly DatasetDef[] = [
  {
    id: 'kb',
    label: 'Knowledge base',
    navLabel: 'KB',
    plural: 'knowledge base entries',
    singular: 'kb entry',
    kind: 'okf',
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Knowledge Base',
    description: 'OKF bundles describing something that already exists.',
  },
  {
    id: 'rca',
    label: 'Root cause analyses',
    navLabel: 'RCA',
    plural: 'root cause analyses',
    singular: 'RCA',
    kind: 'okf',
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Root Cause Analysis',
    description: 'Write-ups of past incidents and solved problems, kept to avoid repeats.',
  },
  {
    id: 'idea',
    label: 'Ideas',
    navLabel: 'Ideas',
    plural: 'ideas',
    singular: 'idea',
    kind: 'okf',
    states: states(IDEA_STATES),
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Idea',
    description: 'Ideas worth exploring, from rough thoughts to proposals.',
  },
  {
    id: 'task',
    label: 'Tasks',
    navLabel: 'Tasks',
    plural: 'tasks',
    singular: 'task',
    kind: 'okf',
    states: states(TASK_STATES),
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Task',
    description: 'Discrete units of work.',
  },
  {
    id: 'bug',
    label: 'Bugs',
    navLabel: 'Bugs',
    plural: 'bugs',
    singular: 'bug',
    kind: 'okf',
    states: states(BUG_STATES),
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Bug',
    description: 'Defects to reproduce, diagnose and fix.',
  },
  {
    id: 'feature',
    label: 'Features',
    navLabel: 'Features',
    plural: 'features',
    singular: 'feature',
    kind: 'okf',
    states: states(FEATURE_STATES),
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Feature',
    description: 'User-facing capabilities to design and build.',
  },
  {
    id: 'project',
    label: 'Projects',
    navLabel: 'Projects',
    plural: 'projects',
    singular: 'project',
    kind: 'okf',
    states: states(PROJECT_STATES),
    entryFile: OKF_ENTRY_FILE,
    okfType: 'Project',
    description: 'Large scopes of work spanning ideas, tasks, features and knowledge.',
  },
  {
    id: 'skill',
    label: 'Skills',
    navLabel: 'Skills',
    plural: 'skills',
    singular: 'skill',
    kind: 'skill',
    entryFile: 'SKILL.md',
    description: 'agentskills.io-compliant agent skill folders.',
  },
  {
    id: 'reference',
    label: 'References',
    navLabel: 'References',
    plural: 'references',
    singular: 'reference',
    kind: 'data',
    entryFile: '.yaml',
    description: 'Pointers to things outside this repo: local repos, remote repos, remote skills.',
  },
  {
    id: 'snippet',
    label: 'Snippets',
    navLabel: 'Snippets',
    plural: 'snippets',
    singular: 'snippet',
    kind: 'data',
    entryFile: '.yaml',
    description:
      'Reusable markdown text, such as instructions you give every session, to include in contexts and recipes.',
  },
  {
    id: 'context',
    label: 'Contexts',
    navLabel: 'Contexts',
    plural: 'contexts',
    singular: 'context',
    kind: 'data',
    entryFile: '.yaml',
    description: 'Reusable, evergreen sets of links to other entries, handed to agent sessions.',
  },
  {
    id: 'recipe',
    label: 'Inflate recipes',
    navLabel: 'Recipes',
    plural: 'recipes',
    singular: 'recipe',
    kind: 'data',
    entryFile: '.yaml',
    description:
      'Saved Context Inflate compositions: contexts, extra items, include modes and ordering.',
  },
];

const BY_ID = new Map<string, DatasetDef>(DATASETS.map((d) => [d.id, d]));

export function getDataset(id: string): DatasetDef | undefined {
  return BY_ID.get(id);
}

/** Like getDataset but for ids already known valid (throws on programmer error). */
export function datasetDef(id: DatasetId): DatasetDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`unknown dataset ${id}`);
  return def;
}

export function isDatasetId(value: unknown): value is DatasetId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function isOkfDatasetId(value: unknown): value is OkfDatasetId {
  return typeof value === 'string' && (OKF_DATASET_IDS as readonly string[]).includes(value);
}

export function isTimeTrackedDatasetId(value: unknown): value is TimeTrackedDatasetId {
  return typeof value === 'string' && (TIME_TRACKED_DATASETS as readonly string[]).includes(value);
}

export function isLinkableDatasetId(value: unknown): value is LinkableDatasetId {
  return typeof value === 'string' && (LINKABLE_DATASETS as readonly string[]).includes(value);
}

export function isReferenceType(value: unknown): value is ReferenceType {
  return typeof value === 'string' && (REFERENCE_TYPES as readonly string[]).includes(value);
}

export function isLocalReferenceType(value: unknown): value is LocalReferenceType {
  return typeof value === 'string' && (LOCAL_REFERENCE_TYPES as readonly string[]).includes(value);
}

/** Group for a state id; 'neutral' when the dataset has no lifecycle or the state is unknown. */
export function stateGroup(dataset: DatasetId, state: string): StateGroup {
  return getDataset(dataset)?.states?.find((s) => s.id === state)?.group ?? 'neutral';
}

/** Display label for a state id; falls back to the raw id. */
export function stateLabel(state: string): string {
  return (STATE_LABELS as Record<string, string>)[state] ?? state;
}

/**
 * Entry names (= dir name / file stem = collection id = slug). agentskills.io rule applied to every
 * dataset: 1-64 chars, a-z 0-9 and single hyphens, no leading/trailing hyphen.
 */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_MAX_LENGTH = 64;

export function isValidName(value: string): boolean {
  return value.length >= 1 && value.length <= NAME_MAX_LENGTH && NAME_PATTERN.test(value);
}

/** Canonical URL of an entry: '/kb/foo'. */
export function entryUrl(dataset: DatasetId, slug: string): string {
  return `/${dataset}/${slug}`;
}

/** URL of a bundle sub-doc; `docPath` is bundle-relative WITH or without '.md' ('concepts/x.md' → '/kb/foo/doc/concepts/x'). */
export function docUrl(dataset: DatasetId, slug: string, docPath: string): string {
  return `/${dataset}/${slug}/doc/${docPath.replace(/\.md$/, '')}`;
}

/** URL of the raw bytes of a bundle file (images…); `relPath` is bundle-relative and NOT encoded ('img/a b.png' → '/kb/foo/file/img/a%20b.png'). */
export function fileUrl(dataset: DatasetId, slug: string, relPath: string): string {
  return `/${dataset}/${slug}/file/${relPath.split('/').map(encodeURIComponent).join('/')}`;
}
