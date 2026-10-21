// PURE (no fs, no astro:*; browser-safe). Parse, normalise and serialise a recipe document
// (plans/INFLATE_SPEC.md §3.3) and apply run-time overrides to it (plans/INFLATE_V2_SPEC.md §4.3). Written by
// src/lib/recipe-io.ts; the Inflate island uses sameRecipe() for its dirty check.
import { recipeSchema, runOverridesSchema } from '../../datasets/schemas.ts';
import type {
  InflateOptionsInput,
  InflateRunOverrides,
  MaterialOptionsInput,
  RecipeData,
  RecipeOutput,
} from '../../datasets/schemas.ts';
import { validate } from '../../datasets/validate.ts';
import { describeIssue, issuePath } from '../findings.ts';
import { stringifyYaml } from '../yaml.ts';
import {
  DEFAULT_CONTEXT_FILE,
  ITEM_KINDS,
  MATERIAL_OPTION_IDS,
  OPTION_IDS,
  STUB_IDS,
} from './catalog.ts';

/** Same shape as context-io `Issue`: path = issue path joined with '.', '' for the root. */
export interface RecipeIssue {
  path: string;
  message: string;
}

/**
 * validate(recipeSchema, …) plus an optional `name === expectedName` check
 * (code 'name-mismatch': recipe names cannot be changed).
 */
export function parseRecipe(
  input: unknown,
  expectedName?: string,
):
  | { ok: true; recipe: RecipeData }
  | { ok: false; code: 'invalid' | 'name-mismatch'; issues: RecipeIssue[] } {
  const parsed = validate(recipeSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      issues: parsed.issues.map((i) => ({
        path: issuePath(i.path),
        message: describeIssue(i, input ?? {}),
      })),
    };
  }
  if (expectedName !== undefined && parsed.data.name !== expectedName) {
    return {
      ok: false,
      code: 'name-mismatch',
      issues: [
        {
          path: 'name',
          message: `name must equal "${expectedName}" (recipe names cannot be changed)`,
        },
      ],
    };
  }
  return { ok: true, recipe: parsed.data };
}

/** CRLF → LF, trimEnd; '' when blank, else text + '\n'. */
export function normalizeText(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n').trimEnd();
  return normalized.trim() === '' ? '' : `${normalized}\n`;
}

/** `values` restricted to `ids`, in `ids` order, undefined values dropped; undefined when nothing is left. */
function pickObject(
  values: Record<string, unknown> | undefined,
  ids: readonly string[],
): Record<string, unknown> | undefined {
  if (values === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const id of ids) {
    const value = values[id];
    if (value !== undefined) out[id] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/** Options in OPTION_IDS order with undefined values dropped; undefined when nothing is left. */
function optionsObject(
  options: InflateOptionsInput | undefined,
): Record<string, unknown> | undefined {
  return pickObject(options, OPTION_IDS);
}

/** Material options in MATERIAL_OPTION_IDS order with undefined values dropped; undefined when empty. */
function materialOptionsObject(
  options: MaterialOptionsInput | undefined,
): Record<string, unknown> | undefined {
  return pickObject(options, MATERIAL_OPTION_IDS);
}

/**
 * `output` in serializer key order: dir (if set), contextFile (if not the default), primary, allowNonEmpty
 * (only true), stubs (only defined keys, STUB_IDS order: the deprecated `claudeMd` is dropped). undefined when
 * nothing is left.
 */
function outputObject(output: RecipeOutput | undefined): Record<string, unknown> | undefined {
  if (output === undefined) return undefined;
  const out: Record<string, unknown> = {};
  if (output.dir !== undefined && output.dir !== '') out.dir = output.dir;
  if (output.contextFile !== undefined && output.contextFile !== DEFAULT_CONTEXT_FILE) {
    out.contextFile = output.contextFile;
  }
  if (output.primary !== undefined) out.primary = output.primary;
  if (output.allowNonEmpty === true) out.allowNonEmpty = true;
  const stubs = pickObject(output.stubs, STUB_IDS);
  if (stubs !== undefined) out.stubs = stubs;
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Plain object in serializer key order: name, description, tags (non-empty), target, layout,
 * output (non-empty), preamble (non-blank), contexts, items, markdown (non-empty), overrides (non-empty,
 * no-op entries dropped; each key, mode, options, material, materialOptions, edit, exclude), order (non-empty),
 * defaults (at least one kind with a mode, option, material or material option).
 */
export function recipeToYamlObject(r: RecipeData): Record<string, unknown> {
  const doc: Record<string, unknown> = { name: r.name, description: r.description };
  if (r.tags.length > 0) doc.tags = [...r.tags];
  doc.target = r.target;
  doc.layout = r.layout;
  const output = outputObject(r.output);
  if (output !== undefined) doc.output = output;
  const preamble = normalizeText(r.preamble ?? '');
  if (preamble !== '') doc.preamble = preamble;
  doc.contexts = [...r.contexts];
  doc.items = r.items.map((item) => ({ dataset: item.dataset, slug: item.slug }));
  if (r.markdown.length > 0) {
    doc.markdown = r.markdown.map((block) => ({ id: block.id, body: normalizeText(block.body) }));
  }

  const overrides: Record<string, unknown>[] = [];
  for (const override of r.overrides) {
    const entry: Record<string, unknown> = { key: override.key };
    if (override.mode !== undefined) entry.mode = override.mode;
    const options = optionsObject(override.options);
    if (options !== undefined) entry.options = options;
    if (override.material !== undefined) entry.material = override.material;
    const materialOptions = materialOptionsObject(override.materialOptions);
    if (materialOptions !== undefined) entry.materialOptions = materialOptions;
    if (override.edit !== undefined) entry.edit = override.edit;
    if (override.exclude === true) entry.exclude = true;
    if (Object.keys(entry).length > 1) overrides.push(entry);
  }
  if (overrides.length > 0) doc.overrides = overrides;

  if (r.order.length > 0) doc.order = [...r.order];

  const defaults: Record<string, unknown> = {};
  for (const kind of ITEM_KINDS) {
    const def = r.defaults[kind];
    if (def === undefined) continue;
    const entry: Record<string, unknown> = {};
    if (def.mode !== undefined) entry.mode = def.mode;
    const options = optionsObject(def.options);
    if (options !== undefined) entry.options = options;
    if (def.material !== undefined) entry.material = def.material;
    const materialOptions = materialOptionsObject(def.materialOptions);
    if (materialOptions !== undefined) entry.materialOptions = materialOptions;
    if (Object.keys(entry).length > 0) defaults[kind] = entry;
  }
  if (Object.keys(defaults).length > 0) doc.defaults = defaults;
  return doc;
}

export function serializeRecipe(r: RecipeData): string {
  return stringifyYaml(recipeToYamlObject(r));
}

/** JSON of recipeToYamlObject equal; null === null only. */
export function sameRecipe(a: RecipeData | null, b: RecipeData | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(recipeToYamlObject(a)) === JSON.stringify(recipeToYamlObject(b));
}

// ---------------------------------------------------------------- run-time overrides (plans/INFLATE_V2_SPEC.md §4.3)

/**
 * The effective recipe of one working-directory run: `r` with the run overrides merged in. Never mutates `r`
 * or `run`. `output` = { contextFile: default, ...r.output } with `run.dir` / `contextFile` / `allowNonEmpty`
 * replacing, `run.primary === null` deleting `primary` and a string setting it; `output` is only present when
 * the recipe had one or the run gave anything. Per `run.items[key]`: the recipe override of `key` (appended
 * as `{ key }` when absent) gets `material` replaced, `materialOptions` merged over the existing ones and
 * `edit` replaced.
 */
export function applyRunOverrides(r: RecipeData, run: InflateRunOverrides): RecipeData {
  const next: RecipeData = { ...r };

  const givesOutput =
    run.dir !== undefined ||
    run.contextFile !== undefined ||
    run.primary !== undefined ||
    run.allowNonEmpty !== undefined;
  if (r.output !== undefined || givesOutput) {
    const output: RecipeOutput = { contextFile: DEFAULT_CONTEXT_FILE, ...r.output };
    if (run.dir !== undefined) output.dir = run.dir;
    if (run.contextFile !== undefined) output.contextFile = run.contextFile;
    if (run.primary === null) delete output.primary;
    else if (run.primary !== undefined) output.primary = run.primary;
    if (run.allowNonEmpty !== undefined) output.allowNonEmpty = run.allowNonEmpty;
    next.output = output;
  }

  const overrides = r.overrides.map((o) => ({ ...o }));
  for (const [key, given] of Object.entries(run.items)) {
    if (!givesItemOverride(given)) continue;
    let override = overrides.find((o) => o.key === key);
    if (override === undefined) {
      override = { key };
      overrides.push(override);
    }
    if (given.material !== undefined) override.material = given.material;
    if (given.materialOptions !== undefined) {
      override.materialOptions = { ...override.materialOptions, ...given.materialOptions };
    }
    if (given.edit !== undefined) override.edit = given.edit;
  }
  next.overrides = overrides;
  return next;
}

/** True when a run override of one item sets anything (material, material options or the Editable flag). */
function givesItemOverride(given: InflateRunOverrides['items'][string]): boolean {
  return (
    given.material !== undefined || given.materialOptions !== undefined || given.edit !== undefined
  );
}

/** 1 each for dir, contextFile, primary (incl. null), allowNonEmpty, plus 1 per item key with a material, options or edit. */
export function runOverrideCount(run: InflateRunOverrides): number {
  let count = 0;
  if (run.dir !== undefined) count++;
  if (run.contextFile !== undefined) count++;
  if (run.primary !== undefined) count++;
  if (run.allowNonEmpty !== undefined) count++;
  for (const given of Object.values(run.items)) {
    if (givesItemOverride(given)) count++;
  }
  return count;
}

/**
 * Validates the body of `POST /api/inflate/plan` and `/run`: `{ recipe, overrides? }`. Recipe issues are
 * prefixed `recipe.` (`recipe` for a root issue), override issues `overrides.`; an absent `overrides` is
 * `{ items: {} }`.
 */
export function parseRunRequest(
  body: unknown,
):
  | { ok: true; recipe: RecipeData; overrides: InflateRunOverrides }
  | { ok: false; issues: RecipeIssue[] } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      issues: [{ path: '', message: 'request body must be { recipe, overrides? }' }],
    };
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((k) => k !== 'recipe' && k !== 'overrides')) {
    return {
      ok: false,
      issues: [{ path: '', message: 'request body must be { recipe, overrides? }' }],
    };
  }
  const prefixed = (prefix: string, path: string): string =>
    path === '' ? prefix : `${prefix}.${path}`;
  const issues: RecipeIssue[] = [];

  const parsedRecipe = parseRecipe(record.recipe);
  if (!parsedRecipe.ok) {
    for (const issue of parsedRecipe.issues) {
      issues.push({ path: prefixed('recipe', issue.path), message: issue.message });
    }
  }

  const rawOverrides = record.overrides ?? {};
  const parsedOverrides = validate(runOverridesSchema, rawOverrides);
  if (!parsedOverrides.success) {
    for (const issue of parsedOverrides.issues) {
      issues.push({
        path: prefixed('overrides', issuePath(issue.path)),
        message: describeIssue(issue, rawOverrides),
      });
    }
  }

  if (!parsedRecipe.ok || !parsedOverrides.success) return { ok: false, issues };
  return { ok: true, recipe: parsedRecipe.recipe, overrides: parsedOverrides.data };
}
