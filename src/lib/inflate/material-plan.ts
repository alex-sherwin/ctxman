// PURE (no fs, no astro:*; browser-safe). The working-directory plan of Context Inflate v2
// (plans/INFLATE_V2_SPEC.md §6, plans/INFLATE_V3_PLAN.md §6: skill symlink, local-repo copy): `planMaterialization` turns an expanded plan plus the gathered paths and the
// previous `.ctxman-inflate.json` into an ordered list of steps; the NODE executor (`material-exec.ts`) runs
// them and the renderer (`render.ts`) describes their outcome. Every type that crosses the API lives here so
// the island never imports a NODE / SERVER module (spec §2). The only imports from other inflate files that
// are not PURE are `import type`s (erased).
import { OKF_DATASET_IDS } from '../../datasets/registry.ts';
import type { Owner } from '../../datasets/registry.ts';
import { isLocalReference } from '../../datasets/schemas.ts';
import {
  DEFAULT_CONTEXT_FILE,
  DIR_MANIFEST_FILE,
  FOLDERS_DIR,
  ITEM_KIND_LABELS,
  MATERIAL_OPTION_DEFS,
  REPOS_DIR,
  STAGE_DIR,
  STUB_DEFAULTS,
  STUB_FILES,
  familyOf,
  isContextStub,
  isEditEligible,
  materialDest,
} from './catalog.ts';
import type { InflateTarget, ItemKind, MaterialId, ModeFamily } from './catalog.ts';
import type { ExpandedPlan, InflateWarning, ItemSegment } from './expand.ts';
import type { PlanContent } from './pipeline.ts';
import type { InflateResult } from './render.ts';

// ---------------------------------------------------------------- manifest (`<W>/.ctxman-inflate.json`)

/** The role of a file a run writes. */
export type FileRole = 'context' | 'agents-md' | 'gitignore';
/**
 * The role of a recorded file: also `claude-md`, the `CLAUDE.md` stub an older ctxman wrote. No run writes one now;
 * a previous manifest's entry is a stale path like any other (removed while unedited, kept when edited).
 */
export type RecordedFileRole = FileRole | 'claude-md';
export type ManifestEntry =
  | { path: string; type: 'symlink'; key: string; target: string }
  | { path: string; type: 'copy'; key: string; source: string }
  | {
      path: string;
      type: 'clone';
      key: string;
      uri: string;
      branch: string | null;
      depth: number;
      sparse: string | null;
      /** The work branch created after the clone; null = none (also for manifests written before it existed). */
      newBranch: string | null;
    }
  | {
      path: string;
      type: 'worktree';
      key: string;
      /** Absolute, real path of the top level of the local repository the worktree belongs to. */
      repo: string;
      branch: string | null;
      newBranch: string | null;
    }
  | { path: string; type: 'skill'; key: string; uri: string; subpath: string | null }
  | { path: string; type: 'file'; role: RecordedFileRole; sha256: string };
export interface InflateDirManifest {
  format: 'ctxman-inflate';
  version: 1;
  recipe: string;
  target: InflateTarget;
  contextFile: string;
  generatedAt: string;
  jobId: string;
  /** Sorted by path (posix, relative to <W>, no '..', not absolute). */
  entries: ManifestEntry[];
}

// ---------------------------------------------------------------- steps

export type StepExpect = 'create' | 'keep' | 'replace' | 'update' | 'remove' | 'write';
interface StepBase {
  /** Stable id (spec §6.3). */
  id: string;
  /** Posix path relative to <W> this step creates / changes ('' = <W>). */
  path: string;
  label: string;
  expect: StepExpect;
  /** Item key for material steps. */
  key?: string;
  /** Step ids that must end ok|unchanged, else this step is skipped. */
  after: string[];
  /** Runs after a cancel / fatal error too. */
  always?: true;
  /** A failure aborts every later non-`always` step. */
  fatal?: true;
}
export type MaterialStep = StepBase &
  (
    | { kind: 'ensureDir' }
    | { kind: 'remove'; entry: ManifestEntry }
    | { kind: 'symlink'; target: string /* abs */ }
    | { kind: 'copyDir'; from: string /* abs */ }
    | {
        kind: 'gitClone';
        uri: string;
        depth: number;
        branch: string | null;
        sparse: string | null;
        /** Create and switch to this branch right after the clone. */
        newBranch: string | null;
        stage: boolean;
      }
    | {
        kind: 'gitUpdate';
        uri: string;
        depth: number;
        branch: string | null;
        sparse: string | null;
        /** Set: the clone works on this branch; a re-run only fetches (no pull). */
        newBranch: string | null;
      }
    | {
        kind: 'gitWorktree';
        /** abs: the local repository (its top level). */
        repo: string;
        branch: string | null;
        newBranch: string | null;
      }
    | { kind: 'download'; uri: string } // path = stage file
    | { kind: 'extract'; archive: string /* rel */; format: 'tgz' | 'zip' } // path = stage dir
    | { kind: 'placeSkill'; stage: string /* rel */; subpath: string | null; uri: string }
    | { kind: 'cleanupStage' }
    | { kind: 'writeContext' }
    | { kind: 'writeFile'; role: Exclude<FileRole, 'context'>; content: string }
    | { kind: 'writeManifest' }
  );

/** What happened to / is planned for one included item (spec §6.1). */
export interface MaterialView {
  key: string;
  kind: ItemKind;
  material: MaterialId;
  title: string;
  description: string;
  /** Posix rel dest in <W>; null for 'none'. */
  dest: string | null;
  /** okf / skill root, local repo or local folder root (abs). */
  sourceAbs: string | null;
  uri: string | null;
  subpath: string | null;
  depth: number | null;
  /** clone / install / worktree: the branch or tag checked out (or the start point of `newBranch`). */
  branch: string | null;
  /** clone / worktree: the branch created for the work; null = none. */
  newBranch: string | null;
  /**
   * Set by a run for a worktree with `newBranch` (absent in a plan, which says "created from"): `created` (made
   * from Branch now), `reused` (the branch already existed and was checked out) or `present` (the worktree was
   * already there, left as it is: how its branch came about is not known).
   */
  workBranch?: 'created' | 'reused' | 'present';
  sparse: boolean;
  /** References keep their `owner`; ctxman's own okf entries and local skills are always `'me'`. */
  owner: Owner | null;
  /**
   * Editable: may the session change files here? null = not eligible (see `isEditEligible`); otherwise the
   * item's `edit` (override ?? is the valid primary). Recomputed for the demoted `none` view.
   */
  edit: boolean | null;
  /** remote-skill: 'git' | 'archive' (selects the Clone / Download label); null for every other kind. */
  uriKind: 'git' | 'archive' | null;
  state: 'planned' | 'ok' | 'failed';
  /** failed: why (shown in the document). */
  reason?: string;
}

export interface MaterialPlanInput {
  /** Of the effective recipe (run overrides already applied). */
  plan: ExpandedPlan;
  /** `gatherContent(plan)`: rootAbs, local. */
  content: PlanContent;
  /** Validated absolute <W>. */
  dir: string;
  dirExists: boolean;
  previous: InflateDirManifest | null;
  tools: { git: boolean; tar: boolean; unzip: boolean };
}
export interface MaterialPlan {
  steps: MaterialStep[];
  /** Every INCLUDED item with a kind, in segment order (material none included). */
  materials: Record<string, MaterialView>;
  /** Context file + stubs that will be written (map rows), in map order. */
  files: { path: string; role: FileRole }[];
  /** Valid primary key (placed in the directory) or null. */
  primary: string | null;
  warnings: InflateWarning[];
}

// ---------------------------------------------------------------- execution + API types (spec §7, §8)

export type StepStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'unchanged'
  | 'skipped'
  | 'failed'
  | 'cancelled';
export interface StepResult {
  id: string;
  status: Exclude<StepStatus, 'pending' | 'running'>;
  action: 'created' | 'replaced' | 'updated' | 'unchanged' | 'removed' | 'kept' | 'written' | null;
  message: string | null;
  durationMs: number;
  tail: string[];
  /** What <W> now holds at step.path that ctxman owns. */
  entry?: ManifestEntry;
}
export interface StepUpdate {
  id: string;
  status: StepStatus;
  line?: string;
  result?: StepResult;
}
export type BlockingCode = 'bad-dir' | 'dir-not-directory' | 'dir-not-empty' | 'manifest-invalid';

/** `POST /api/inflate/plan` answer (`DirPlanResult` of dir-plan.ts without its server-only `internal`). */
export interface DirPlanResponse {
  /** null = no directory (document mode). */
  dir: string | null;
  dirInput: string | null;
  contextFile: string;
  dirState: {
    exists: boolean;
    empty: boolean;
    hasManifest: boolean;
    manifestRecipe: string | null;
  } | null;
  blocking: { code: BlockingCode; message: string }[];
  steps: MaterialStep[];
  /** Plan + material + manifest warnings, deduped like renderPlan. */
  warnings: InflateWarning[];
  /** dir set: the RELATIVE document as a run would write it (materials 'planned'); else the v1 absolute render. */
  document: InflateResult;
  /** Run overrides applied: 'dir', 'contextFile', 'primary', 'allowNonEmpty', item keys. */
  applied: string[];
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface JobStep {
  id: string;
  kind: MaterialStep['kind'];
  label: string;
  path: string;
  key: string | null;
  expect: StepExpect;
  status: StepStatus;
  action: StepResult['action'];
  message: string | null;
  startedAt: string | null;
  durationMs: number | null;
  tail: string[];
}
export interface InflateJob {
  id: string;
  recipe: string;
  dir: string;
  /** Absolute path of the context file. */
  contextFile: string;
  status: JobStatus;
  cancelRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  steps: JobStep[];
  warnings: InflateWarning[];
  error: string | null;
  summary: {
    ok: number;
    unchanged: number;
    skipped: number;
    failed: number;
    cancelled: number;
    removed: number;
  } | null;
}

// ---------------------------------------------------------------- small helpers

/** `subpath` trimmed with leading / trailing slashes removed; '' when absent. */
export function cleanSubpath(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
}

const DEFAULT_CLONE_DEPTH = MATERIAL_OPTION_DEFS.cloneDepth.default as number;

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `zip` when the URL pathname ends `.zip` (case-insensitive), else `tgz`. */
export function archiveFormat(uri: string): 'tgz' | 'zip' {
  try {
    return /\.zip$/i.test(new URL(uri).pathname) ? 'zip' : 'tgz';
  } catch {
    return /\.zip$/i.test(uri) ? 'zip' : 'tgz';
  }
}

/**
 * Maps an absolute path of a mounted source (an item placed in the working directory, state not `failed`) to
 * its posix path relative to <W>; any other path is returned unchanged (spec §9.2). The longest source wins,
 * `\` in the remainder becomes `/`.
 */
export function createPathMapper(
  materials: Readonly<Record<string, MaterialView>>,
): (abs: string) => string {
  const mounts: { src: string; dest: string }[] = [];
  for (const view of Object.values(materials)) {
    if (view.dest === null || view.sourceAbs === null || view.state === 'failed') continue;
    mounts.push({ src: view.sourceAbs, dest: view.dest });
  }
  mounts.sort((a, b) => b.src.length - a.src.length);
  return (abs) => {
    for (const { src, dest } of mounts) {
      if (abs === src) return dest;
      if (abs.startsWith(`${src}/`) || abs.startsWith(`${src}\\`)) {
        return `${dest}/${abs.slice(src.length + 1).replaceAll('\\', '/')}`;
      }
    }
    return abs;
  };
}

// ---------------------------------------------------------------- stub texts (spec §6.5)

/**
 * `.gitignore` of a working directory: the manifest, the staging folder, then one line per distinct "ignore
 * root" in map order (`/repos/`, `/folders/`, `/<dataset>/`, each skill destination). `paths` = the placed destinations;
 * `links` = those among them that are symlinks themselves (a symlinked skill): git does not match a symlink
 * with a trailing-slash pattern, so these are written without the slash.
 */
export function gitignoreText(
  recipe: string,
  paths: readonly string[],
  links: readonly string[] = [],
): string {
  const under =
    (root: string) =>
    (p: string): boolean =>
      p === root || p.startsWith(`${root}/`);
  const isRepo = under(REPOS_DIR);
  const isFolder = under(FOLDERS_DIR);
  const dataset = (p: string): string | undefined =>
    OKF_DATASET_IDS.find((ds) => p === ds || p.startsWith(`${ds}/`));
  const roots: string[] = [];
  const add = (root: string): void => {
    if (!roots.includes(root)) roots.push(root);
  };
  if (paths.some(isRepo)) add(`/${REPOS_DIR}/`);
  if (paths.some(isFolder)) add(`/${FOLDERS_DIR}/`);
  for (const ds of OKF_DATASET_IDS) {
    if (paths.some((p) => dataset(p) === ds)) add(`/${ds}/`);
  }
  for (const p of paths) {
    if (!isRepo(p) && !isFolder(p) && dataset(p) === undefined) {
      add(links.includes(p) ? `/${p}` : `/${p}/`);
    }
  }
  return (
    [
      `# Generated by ctxman (recipe ${recipe}): machine-specific content.`,
      `/${DIR_MANIFEST_FILE}`,
      `/${STAGE_DIR}/`,
      ...roots,
    ].join('\n') + '\n'
  );
}

/** The `AGENTS.md` stub (written when the context file has another name): points to it. Ends with one newline. */
export function agentsMdText(recipe: string, contextFile: string): string {
  return [
    `# ${recipe}`,
    '',
    `Generated by ctxman from the recipe \`${recipe}\`. Read \`${contextFile}\` first: it maps the repositories, skills and knowledge in this directory.`,
    '',
    'Paths in it are relative to this directory.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- planner

interface Placed {
  view: MaterialView;
  seg: ItemSegment;
  family: ModeFamily;
  /** remote-skill: 'git' | 'archive'. */
  uriKind: 'git' | 'archive' | null;
}

/**
 * Pure and deterministic: the same input always gives the same steps, in the order of spec §6.2 (ensureDir,
 * removals, okf, skills, local repos, local folders, remote repos, remote skills, stage cleanup, context file, the
 * removal of an old context file (after the new one is written), stubs, manifest). Items that cannot be placed are demoted to material `none` with a warning (no step).
 */
export function planMaterialization(input: MaterialPlanInput): MaterialPlan {
  const { plan, content, dir, dirExists, previous, tools } = input;
  const recipe = plan.recipe;
  const target = recipe.target;
  const output = recipe.output;
  const contextFile = output?.contextFile ?? DEFAULT_CONTEXT_FILE;
  const warnings: InflateWarning[] = [];

  // 1. one view per included item with a kind
  const materials: Record<string, MaterialView> = {};
  const candidates: Placed[] = [];
  const taken = new Map<string, string>();
  const previousAt = (path: string): ManifestEntry | undefined =>
    previous?.entries.find((e) => e.path === path);

  for (const seg of plan.segments) {
    if (seg.type !== 'item' || seg.status !== 'included') continue;
    if (seg.kind === null || seg.material === null || seg.meta === null) continue;
    const { kind, material, key } = seg;
    const family = familyOf(kind);
    const ref = seg.meta.ref;
    const ic = content.items[key];
    const subpath = cleanSubpath(ref?.subpath);
    const opts = seg.materialOptions;
    const uriKind =
      family === 'remote-skill' && seg.meta.uriKind !== undefined ? seg.meta.uriKind : null;
    const clone = material === 'clone';
    const worktree = material === 'worktree';
    const branch = opts.branch ?? '';
    const newBranch = opts.newBranch ?? '';
    const view: MaterialView = {
      key,
      kind,
      material,
      title: seg.title,
      description: seg.meta.description,
      dest:
        material === 'none'
          ? null
          : materialDest(kind, seg.dataset, seg.slug, target, ref?.subpath, seg.meta.folder),
      sourceAbs:
        family === 'okf' || family === 'skill'
          ? (ic?.rootAbs ?? null)
          : family === 'local-repo' || family === 'local-folder'
            ? (ic?.local?.root ?? null)
            : null,
      uri: ref !== undefined && !isLocalReference(ref) ? ref.uri : null,
      subpath: subpath === '' ? null : subpath,
      depth: clone ? (opts.cloneDepth ?? DEFAULT_CLONE_DEPTH) : null,
      branch: (clone || worktree || material === 'install') && branch !== '' ? branch : null,
      newBranch: (clone || worktree) && newBranch !== '' ? newBranch : null,
      sparse: clone && opts.subpathOnly === true && subpath !== '',
      owner: ref?.owner ?? (family === 'okf' || family === 'skill' ? 'me' : null),
      edit: seg.edit,
      uriKind,
      state: 'planned',
    };
    materials[key] = view;

    const demote = (code: InflateWarning['code'], message: string): void => {
      view.material = 'none';
      view.dest = null;
      view.depth = null;
      view.branch = null;
      view.newBranch = null;
      view.sparse = false;
      // Not placed any more: a local repository or folder is editable at its original path only when asked for
      // (the primary default needs a placed repository), anything else loses the flag.
      view.edit = isEditEligible(kind, 'none')
        ? seg.editSource === 'override' && seg.edit === true
        : null;
      warnings.push({ code, message: `${key}: ${message}; nothing placed`, key });
    };

    if (material === 'none' || view.dest === null) continue;
    const dest = view.dest;
    const other = taken.get(dest);
    if (other !== undefined) {
      demote('dest-collision', `${dest} is already used by ${other}`);
      continue;
    }

    switch (family) {
      case 'okf':
        if (material !== 'symlink' && material !== 'copy') {
          demote(
            'material-invalid',
            `material "${material}" does not apply to ${ITEM_KIND_LABELS[kind]}`,
          );
        } else if (view.sourceAbs === null) {
          demote('source-missing', 'the source path is unknown');
        }
        break;
      case 'skill':
        if (material !== 'symlink' && material !== 'copy') {
          demote(
            'material-invalid',
            `material "${material}" does not apply to ${ITEM_KIND_LABELS[kind]}`,
          );
        } else if (view.sourceAbs === null) {
          demote('source-missing', 'the source path is unknown');
        }
        break;
      case 'local-repo':
      case 'local-folder': {
        const local = ic?.local;
        if (
          material !== 'symlink' &&
          material !== 'copy' &&
          !(family === 'local-repo' && worktree)
        ) {
          demote(
            'material-invalid',
            `material "${material}" does not apply to ${ITEM_KIND_LABELS[kind]}`,
          );
        } else if (local === undefined) {
          demote('source-missing', 'the local path is unknown');
        } else if (!local.exists) {
          demote('source-missing', `${local.root} does not exist`);
        } else if (worktree && !tools.git) {
          demote('tool-missing', 'git is not installed');
        }
        break;
      }
      case 'remote-repo':
        if (material !== 'clone') {
          demote(
            'material-invalid',
            `material "${material}" does not apply to ${ITEM_KIND_LABELS[kind]}`,
          );
        } else if (!tools.git) {
          demote('tool-missing', 'git is not installed');
        } else if (view.uri === null) {
          demote('source-missing', 'the URI is unknown');
        }
        break;
      case 'remote-skill':
        if (material !== 'install') {
          demote(
            'material-invalid',
            `material "${material}" does not apply to ${ITEM_KIND_LABELS[kind]}`,
          );
        } else if (uriKind === null) {
          demote('source-missing', 'unknown URI kind');
        } else if (view.uri === null) {
          demote('source-missing', 'the URI is unknown');
        } else if (uriKind === 'git') {
          if (!tools.git) demote('tool-missing', 'git is not installed');
        } else if (archiveFormat(view.uri) === 'zip' ? !tools.tar && !tools.unzip : !tools.tar) {
          demote('tool-missing', 'tar is not installed');
        }
        break;
    }
    if (view.dest === null) continue;
    taken.set(dest, key);
    candidates.push({ view, seg, family, uriKind });
  }

  // 3. primary
  let primary: string | null = null;
  if (plan.primary?.status === 'ok') {
    const view = materials[plan.primary.key];
    if (view !== undefined && view.dest !== null) {
      primary = view.key;
    } else {
      warnings.push({
        code: 'primary-invalid',
        message: `primary ${plan.primary.key} is not placed in the directory`,
        key: plan.primary.key,
      });
    }
  }

  // 4. owned paths
  const placedDests = candidates.map((c) => c.view.dest as string);
  // (a recipe's deprecated `stubs.claudeMd` is ignored: no run writes CLAUDE.md)
  const stubIds = [
    { id: 'agentsMd', role: 'agents-md' },
    { id: 'gitignore', role: 'gitignore' },
  ] as const;
  const stubs = stubIds.filter(({ id }) => {
    if (!(output?.stubs?.[id] ?? STUB_DEFAULTS[id])) return false;
    if (isContextStub(id, contextFile)) return false;
    return id !== 'gitignore' || placedDests.length > 0;
  });
  const files: MaterialPlan['files'] = [
    { path: contextFile, role: 'context' },
    ...stubs.map(({ id, role }) => ({ path: STUB_FILES[id], role })),
  ];
  const owned = new Set<string>([...placedDests, ...files.map((f) => f.path)]);
  const underOwned = (path: string): boolean => {
    for (const p of owned) if (path.startsWith(`${p}/`)) return true;
    return false;
  };

  // 5. steps
  const steps: MaterialStep[] = [];
  steps.push({
    kind: 'ensureDir',
    id: 'dir',
    path: '',
    label: `${dirExists ? 'Use' : 'Create'} ${dir}`,
    expect: dirExists ? 'keep' : 'create',
    after: [],
    fatal: true,
  });

  const stale = (previous?.entries ?? [])
    .filter((e) => !owned.has(e.path) && !underOwned(e.path))
    .sort((a, b) => compareText(a.path, b.path));
  const removeStep = (entry: ManifestEntry, after: string[]): MaterialStep => ({
    kind: 'remove',
    id: `rm:${entry.path}`,
    path: entry.path,
    label: `Remove ${entry.path}`,
    expect: 'remove',
    after,
    entry,
  });
  // An old context file (a renamed one, or LLM_CONTEXT.md of an older ctxman) goes only once the new one is
  // written: its removal is planned right after the `context` step and depends on it.
  const isOldContext = (e: ManifestEntry): boolean => e.type === 'file' && e.role === 'context';
  for (const entry of stale) {
    if (!isOldContext(entry)) steps.push(removeStep(entry, []));
  }

  const expectFor = (path: string): 'create' | 'replace' =>
    previousAt(path) === undefined ? 'create' : 'replace';
  const group = (family: ModeFamily): Placed[] => candidates.filter((c) => c.family === family);

  for (const { view } of group('okf')) {
    const dest = view.dest as string;
    const source = view.sourceAbs as string;
    steps.push(
      view.material === 'symlink'
        ? {
            kind: 'symlink',
            id: `okf:${view.key}`,
            path: dest,
            label: `Symlink ${dest} → ${source}`,
            expect: expectFor(dest),
            key: view.key,
            after: [],
            target: source,
          }
        : {
            kind: 'copyDir',
            id: `okf:${view.key}`,
            path: dest,
            label: `Copy ${view.key} → ${dest}`,
            expect: expectFor(dest),
            key: view.key,
            after: [],
            from: source,
          },
    );
  }
  for (const { view, seg } of group('skill')) {
    const dest = view.dest as string;
    const source = view.sourceAbs as string;
    steps.push(
      view.material === 'symlink'
        ? {
            kind: 'symlink',
            id: `skill:${view.key}`,
            path: dest,
            label: `Symlink ${dest} → ${source}`,
            expect: expectFor(dest),
            key: view.key,
            after: [],
            target: source,
          }
        : {
            kind: 'copyDir',
            id: `skill:${view.key}`,
            path: dest,
            label: `Copy skill ${seg.slug} → ${dest}`,
            expect: expectFor(dest),
            key: view.key,
            after: [],
            from: source,
          },
    );
  }
  for (const { view } of [...group('local-repo'), ...group('local-folder')]) {
    const dest = view.dest as string;
    const source = view.sourceAbs as string;
    if (view.material === 'worktree') {
      const on =
        view.newBranch !== null
          ? ` (new branch ${view.newBranch})`
          : view.branch !== null
            ? ` (${view.branch})`
            : ' (detached)';
      steps.push({
        kind: 'gitWorktree',
        id: `worktree:${view.key}`,
        path: dest,
        label: `git worktree ${dest} → ${source}${on}`,
        // a worktree recorded there is left as it is
        expect: previousAt(dest)?.type === 'worktree' ? 'keep' : expectFor(dest),
        key: view.key,
        after: [],
        repo: source,
        branch: view.branch,
        newBranch: view.newBranch,
      });
      continue;
    }
    steps.push(
      view.material === 'copy'
        ? {
            kind: 'copyDir',
            id: `link:${view.key}`,
            path: dest,
            label: `Copy ${source} → ${dest}`,
            expect: expectFor(dest),
            key: view.key,
            after: [],
            from: source,
          }
        : {
            kind: 'symlink',
            id: `link:${view.key}`,
            path: dest,
            label: `Symlink ${dest} → ${source}`,
            expect: expectFor(dest),
            key: view.key,
            after: [],
            target: source,
          },
    );
  }
  for (const { view } of group('remote-repo')) {
    const dest = view.dest as string;
    const uri = view.uri as string;
    const before = previousAt(dest);
    const update = before?.type === 'clone' && before.uri === uri;
    const common = {
      id: `clone:${view.key}`,
      path: dest,
      key: view.key,
      after: [],
      uri,
      depth: view.depth ?? DEFAULT_CLONE_DEPTH,
      branch: view.branch,
      sparse: view.sparse ? view.subpath : null,
      newBranch: view.newBranch,
    };
    steps.push(
      update
        ? {
            kind: 'gitUpdate',
            // on a work branch a re-run only fetches: the branch has no upstream to pull from
            label: view.newBranch === null ? `git pull ${dest}` : `git fetch ${dest}`,
            expect: 'update',
            ...common,
          }
        : {
            kind: 'gitClone',
            label: `git clone ${uri} → ${dest}`,
            expect: 'create',
            stage: false,
            ...common,
          },
    );
  }
  const skills = group('remote-skill');
  for (const { view, seg, uriKind } of skills) {
    const dest = view.dest as string;
    const uri = view.uri as string;
    const stage = `${STAGE_DIR}/${seg.slug}`;
    let last: string;
    if (uriKind === 'git') {
      last = `stage:${view.key}`;
      steps.push({
        kind: 'gitClone',
        id: last,
        path: stage,
        label: `git clone ${uri} (staging)`,
        expect: 'create',
        key: view.key,
        after: [],
        uri,
        // a temporary clone the skill folder is copied out of: no history needed
        depth: 1,
        branch: view.branch,
        sparse: view.subpath,
        newBranch: null,
        stage: true,
      });
    } else {
      const format = archiveFormat(uri);
      const archive = `${stage}.${format}`;
      steps.push({
        kind: 'download',
        id: `dl:${view.key}`,
        path: archive,
        label: `Download ${uri}`,
        expect: 'create',
        key: view.key,
        after: [],
        uri,
      });
      last = `x:${view.key}`;
      steps.push({
        kind: 'extract',
        id: last,
        path: stage,
        label: `Extract ${archive}`,
        expect: 'create',
        key: view.key,
        after: [`dl:${view.key}`],
        archive,
        format,
      });
    }
    steps.push({
      kind: 'placeSkill',
      id: `skill:${view.key}`,
      path: dest,
      label: `Install skill → ${dest}`,
      expect: expectFor(dest),
      key: view.key,
      after: [last],
      stage,
      subpath: view.subpath,
      uri,
    });
  }
  if (skills.length > 0) {
    steps.push({
      kind: 'cleanupStage',
      id: 'stage-cleanup',
      path: STAGE_DIR,
      label: `Remove ${STAGE_DIR}`,
      expect: 'remove',
      after: [],
      always: true,
    });
  }

  steps.push({
    kind: 'writeContext',
    id: 'context',
    path: contextFile,
    label: `Write ${contextFile}`,
    expect: 'write',
    after: [],
  });
  for (const entry of stale) {
    if (isOldContext(entry)) steps.push(removeStep(entry, ['context']));
  }
  for (const { id, role } of stubs) {
    const file = STUB_FILES[id];
    steps.push({
      kind: 'writeFile',
      id: `stub:${file}`,
      path: file,
      label: `Write ${file}`,
      expect: 'write',
      after: [],
      role,
      content:
        role === 'gitignore'
          ? gitignoreText(
              recipe.name,
              placedDests,
              candidates
                .filter((c) => c.family === 'skill' && c.view.material === 'symlink')
                .map((c) => c.view.dest as string),
            )
          : agentsMdText(recipe.name, contextFile),
    });
  }
  steps.push({
    kind: 'writeManifest',
    id: 'manifest',
    path: DIR_MANIFEST_FILE,
    label: `Write ${DIR_MANIFEST_FILE}`,
    expect: 'write',
    after: [],
    always: true,
  });

  // 6. foreign directory
  if (previous !== null && previous.recipe !== recipe.name) {
    warnings.push({
      code: 'manifest-other-recipe',
      message: `this directory was inflated from recipe "${previous.recipe}"; ${stale.length} of its paths will be removed`,
    });
  }

  return { steps, materials, files, primary, warnings };
}
