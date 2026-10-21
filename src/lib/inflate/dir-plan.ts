// NODE (fs through `output-dir.ts` and the injected sources): the dry run of an Inflate run into a working
// directory and the preparation `/api/inflate/run` executes (plans/INFLATE_V2_SPEC.md §8.1). Nothing is
// written. Without an output directory the result is the v1 absolute document ("document mode").
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecipeData } from '../../datasets/schemas.ts';
import type { InflateRunOverrides } from '../../datasets/schemas.ts';
import { spawnCapture } from '../proc.ts';
import type { ProcRunner } from '../proc.ts';
import { DEFAULT_CONTEXT_FILE } from './catalog.ts';
import type { ExpandedPlan, InflateWarning } from './expand.ts';
import { createFsSources } from './fs-sources.ts';
import { executeSteps, probeTools, sha256Of } from './material-exec.ts';
import type { ExecuteOutcome } from './material-exec.ts';
import { planMaterialization } from './material-plan.ts';
import type {
  DirPlanResponse,
  InflateDirManifest,
  MaterialPlan,
  MaterialView,
  StepUpdate,
} from './material-plan.ts';
import { blockingFor, checkOutputDir, inspectOutputDir } from './output-dir.ts';
import type { DirCheckOptions, DirInspection } from './output-dir.ts';
import { prepareInflate } from './pipeline.ts';
import type { InflateSources, PlanContent } from './pipeline.ts';
import { applyRunOverrides } from './recipe.ts';
import { renderPlan } from './render.ts';
import type { RenderOutput } from './render.ts';

/** What `/api/inflate/run` needs besides the response fields; never serialized. */
export interface DirPlanInternal {
  recipe: RecipeData;
  plan: ExpandedPlan;
  content: PlanContent;
  materials: Record<string, MaterialView>;
  previous: InflateDirManifest | null;
  output: RenderOutput;
  /** Absolute `<W>`. */
  dir: string;
}

export interface DirPlanResult extends DirPlanResponse {
  /** Server-side only (strip before sending). */
  internal?: DirPlanInternal;
}

export interface PlanInflateDirInput {
  recipe: RecipeData;
  overrides: InflateRunOverrides;
  now: Date;
  sources?: InflateSources;
  proc?: ProcRunner;
  dataDir?: string;
  repoRoot?: string;
  homeDir?: string;
}

const warningId = (w: InflateWarning): string => `${w.code}\u0000${w.key ?? ''}\u0000${w.message}`;

function dedupe(warnings: readonly InflateWarning[]): InflateWarning[] {
  const seen = new Set<string>();
  const out: InflateWarning[] = [];
  for (const w of warnings) {
    const id = warningId(w);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(w);
  }
  return out;
}

/** The run overrides that were given: dir, contextFile, primary, allowNonEmpty, then item keys. */
function appliedOverrides(run: InflateRunOverrides): string[] {
  const applied: string[] = [];
  if (run.dir !== undefined) applied.push('dir');
  if (run.contextFile !== undefined) applied.push('contextFile');
  if (run.primary !== undefined) applied.push('primary');
  if (run.allowNonEmpty !== undefined) applied.push('allowNonEmpty');
  for (const [key, given] of Object.entries(run.items)) {
    if (
      given.material !== undefined ||
      given.materialOptions !== undefined ||
      given.edit !== undefined
    ) {
      applied.push(key);
    }
  }
  return applied;
}

const CONTEXT_FILE_HINT = 'move it away or choose another context file name';

/**
 * The up-front warning of a context file the run will refuse to write (its `writeContext` step fails): one ctxman
 * did not write (not in the manifest), or a stub ctxman wrote there that was edited since (an `AGENTS.md` stub of
 * a directory made with another context file name). null when the run may write it.
 */
async function contextFileWarning(
  dir: string,
  contextFile: string,
  insp: DirInspection,
  previous: InflateDirManifest | null,
): Promise<InflateWarning | null> {
  if (!insp.exists || insp.kind !== 'dir' || !insp.entries.includes(contextFile)) return null;
  const rec = previous?.entries.find((e) => e.path === contextFile);
  if (rec === undefined || rec.type !== 'file') {
    return {
      code: 'context-file-exists',
      message: `${contextFile} already exists in ${dir} and was not written by ctxman, so the run will not write it; ${CONTEXT_FILE_HINT}`,
    };
  }
  if (rec.role === 'context') return null;
  let text: Buffer;
  try {
    text = await readFile(path.join(dir, contextFile));
  } catch {
    return null;
  }
  if (sha256Of(text) === rec.sha256) return null;
  return {
    code: 'context-file-exists',
    message: `${contextFile} is a stub ctxman wrote earlier and it was edited since, so the run will not replace it; ${CONTEXT_FILE_HINT}`,
  };
}

/**
 * `applyRunOverrides` → expand + gather → (directory set) check, inspect, probe tools, `planMaterialization`
 * and the relative document; (no directory) the v1 absolute document. Steps are returned even when the
 * directory is blocked (the UI shows them dimmed).
 */
export async function planInflateDir(input: PlanInflateDirInput): Promise<DirPlanResult> {
  const { overrides, now } = input;
  const generatedAt = now.toISOString();
  const effective = applyRunOverrides(input.recipe, overrides);
  const { plan, content } = await prepareInflate(effective, input.sources ?? createFsSources());
  const output = effective.output;
  const contextFile = output?.contextFile ?? DEFAULT_CONTEXT_FILE;
  const applied = appliedOverrides(overrides);

  const absolute = (extra: readonly InflateWarning[] = []): DirPlanResponse['document'] => {
    const document = renderPlan(plan, content, { generatedAt });
    document.manifest.warnings = dedupe([...document.manifest.warnings, ...extra]);
    return document;
  };

  if (output?.dir === undefined) {
    const document = absolute();
    return {
      dir: null,
      dirInput: null,
      contextFile,
      dirState: null,
      blocking: [],
      steps: [],
      warnings: document.manifest.warnings,
      document,
      applied,
    };
  }

  const dirOptions: DirCheckOptions = {
    ...(input.dataDir === undefined ? {} : { dataDir: input.dataDir }),
    ...(input.repoRoot === undefined ? {} : { repoRoot: input.repoRoot }),
    ...(input.homeDir === undefined ? {} : { homeDir: input.homeDir }),
  };
  const check = checkOutputDir(output.dir, dirOptions);
  if (!check.ok) {
    const document = absolute();
    return {
      dir: null,
      dirInput: output.dir,
      contextFile,
      dirState: null,
      blocking: blockingFor(check, null, false, dirOptions),
      steps: [],
      warnings: document.manifest.warnings,
      document,
      applied,
    };
  }

  const allowNonEmpty = output.allowNonEmpty === true;
  const proc = input.proc ?? spawnCapture;
  const inspection = await inspectOutputDir(check.abs);
  const blocking = blockingFor(check, inspection, allowNonEmpty, dirOptions);
  const tools = await probeTools(proc);
  const previous = inspection.manifestStatus === 'ok' ? inspection.manifest : null;

  const extraWarnings: InflateWarning[] = [];
  if (
    (inspection.manifestStatus === 'invalid' || inspection.manifestStatus === 'unknown-version') &&
    allowNonEmpty
  ) {
    extraWarnings.push({
      code: 'manifest-unreadable',
      message: `${check.abs}/.ctxman-inflate.json cannot be read; nothing previously created there will be removed`,
    });
  }

  const contextWarning = await contextFileWarning(check.abs, contextFile, inspection, previous);
  if (contextWarning !== null) extraWarnings.push(contextWarning);

  const materialPlan: MaterialPlan = planMaterialization({
    plan,
    content,
    dir: check.abs,
    dirExists: inspection.exists && inspection.kind === 'dir',
    previous,
    tools,
  });
  const renderOutput: RenderOutput = {
    dir: check.abs,
    contextFile,
    primary: materialPlan.primary,
    target: effective.target,
    materials: materialPlan.materials,
    files: materialPlan.files,
  };
  const document = renderPlan(plan, content, { generatedAt, output: renderOutput });
  const warnings = dedupe([
    ...document.manifest.warnings,
    ...materialPlan.warnings,
    ...extraWarnings,
  ]);
  document.manifest.warnings = warnings;

  return {
    dir: check.abs,
    dirInput: check.input,
    contextFile,
    dirState: {
      exists: inspection.exists,
      empty: inspection.entries.length === 0,
      hasManifest: inspection.manifestStatus === 'ok',
      manifestRecipe: inspection.manifest?.recipe ?? null,
    },
    blocking,
    steps: materialPlan.steps,
    warnings,
    document,
    applied,
    internal: {
      recipe: effective,
      plan,
      content,
      materials: materialPlan.materials,
      previous,
      output: renderOutput,
      dir: check.abs,
    },
  };
}

/** `DirPlanResult` without its server-only `internal`. */
export function toDirPlanResponse(result: DirPlanResult): DirPlanResponse {
  return {
    dir: result.dir,
    dirInput: result.dirInput,
    contextFile: result.contextFile,
    dirState: result.dirState,
    blocking: result.blocking,
    steps: result.steps,
    warnings: result.warnings,
    document: result.document,
    applied: result.applied,
  };
}

export interface ExecuteDirPlanOptions {
  jobId: string;
  signal: AbortSignal;
  onProgress(update: StepUpdate): void;
  proc?: ProcRunner;
  fetch?: typeof fetch;
  /** Test hook (`stepDelayFromEnv()` in the route). */
  stepDelayMs?: number;
  now?: () => Date;
}

/**
 * Runs the steps of a planned (and unblocked) directory run: `executeSteps` with the context the plan
 * prepared. `renderContext` renders the document again for the ACTUAL outcomes (failed items are shown as
 * not placed), so the context file always matches what is on disk.
 */
export function executeDirPlan(
  planned: DirPlanResult & { internal: DirPlanInternal },
  opts: ExecuteDirPlanOptions,
): Promise<ExecuteOutcome> {
  const { internal } = planned;
  const now = opts.now ?? ((): Date => new Date());
  return executeSteps(planned.steps, {
    dir: internal.dir,
    jobId: opts.jobId,
    recipe: internal.recipe.name,
    target: internal.recipe.target,
    contextFile: planned.contextFile,
    previous: internal.previous,
    materials: internal.materials,
    signal: opts.signal,
    onProgress: opts.onProgress,
    proc: opts.proc ?? spawnCapture,
    ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    now,
    renderContext: (materials) =>
      renderPlan(internal.plan, internal.content, {
        generatedAt: now().toISOString(),
        output: { ...internal.output, materials },
      }).markdown,
    ...(opts.stepDelayMs === undefined ? {} : { stepDelayMs: opts.stepDelayMs }),
  });
}
