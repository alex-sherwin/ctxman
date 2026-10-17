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
  'context',
] as const;
export type DatasetId = (typeof DATASET_IDS)[number];

/** okf = OKF v0.2 bundle dir (index.md + main.md); skill = agentskills.io dir (SKILL.md); data = one YAML file. */
export type DatasetKind = 'okf' | 'skill' | 'data';

export const OKF_DATASET_IDS = ['kb', 'rca', 'idea', 'task', 'bug', 'feature', 'project'] as const;
export type OkfDatasetId = (typeof OKF_DATASET_IDS)[number];

/** Datasets a context may link to: everything except context, registry order. */
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
] as const;
export type LinkableDatasetId = (typeof LINKABLE_DATASETS)[number];

// Lifecycle state ids are kebab-case in data files (tuples feed z.enum in schemas.ts).
export const IDEA_STATES = ['pending', 'in-progress', 'complete', 'abandoned'] as const;
export const TASK_STATES = ['pending', 'in-progress', 'complete', 'wont-do'] as const;
export const BUG_STATES = ['pending', 'in-progress', 'fixed', 'wont-fix'] as const;
export const FEATURE_STATES = ['pending', 'in-progress', 'complete', 'wont-do'] as const;
export const PROJECT_STATES = ['pending', 'in-progress', 'complete', 'wont-do'] as const;
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
  complete: 'Complete',
  abandoned: 'Abandoned',
  'wont-do': "Won't do",
  fixed: 'Fixed',
  'wont-fix': "Won't fix",
};

export const STATE_GROUPS: Readonly<Record<LifecycleStateId, StateGroup>> = {
  pending: 'neutral',
  'in-progress': 'active',
  complete: 'done',
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

export const REFERENCE_TYPES = ['local-repo', 'remote-repo', 'remote-skill'] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];
export const REFERENCE_TYPE_LABELS: Readonly<Record<ReferenceType, string>> = {
  'local-repo': 'Local repo',
  'remote-repo': 'Remote repo',
  'remote-skill': 'Remote skill',
};

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
  /** okf: data/<id>/<name>/main.md; skill: data/skill/<name>/SKILL.md; data: data/<id>/<name>.yaml */
  readonly entryFile: 'main.md' | 'SKILL.md' | '.yaml';
  /** OKF `type` that add-entry writes into main.md (okf kind only). */
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
    entryFile: 'main.md',
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
    entryFile: 'main.md',
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
    entryFile: 'main.md',
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
    entryFile: 'main.md',
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
    entryFile: 'main.md',
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
    entryFile: 'main.md',
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
    entryFile: 'main.md',
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
    id: 'context',
    label: 'Contexts',
    navLabel: 'Contexts',
    plural: 'contexts',
    singular: 'context',
    kind: 'data',
    entryFile: '.yaml',
    description: 'Reusable, evergreen sets of links to other entries, handed to agent sessions.',
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

export function isLinkableDatasetId(value: unknown): value is LinkableDatasetId {
  return typeof value === 'string' && (LINKABLE_DATASETS as readonly string[]).includes(value);
}

export function isReferenceType(value: unknown): value is ReferenceType {
  return typeof value === 'string' && (REFERENCE_TYPES as readonly string[]).includes(value);
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
