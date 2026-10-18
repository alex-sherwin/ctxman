// PURE (no fs, no astro:*; browser-safe). Parse, normalise and serialise a recipe document
// (plans/INFLATE_SPEC.md §3.3). Written by src/lib/recipe-io.ts; the Inflate island uses sameRecipe()
// for its dirty check.
import { recipeSchema } from '../../datasets/schemas.ts';
import type { InflateOptionsInput, RecipeData } from '../../datasets/schemas.ts';
import { describeIssue, issuePath } from '../findings.ts';
import { stringifyYaml } from '../yaml.ts';
import { ITEM_KINDS, OPTION_IDS } from './catalog.ts';

/** Same shape as context-io `Issue`: path = zod issue path joined with '.', '' for the root. */
export interface RecipeIssue {
  path: string;
  message: string;
}

/**
 * recipeSchema.safeParse plus an optional `name === expectedName` check
 * (code 'name-mismatch': recipe names cannot be changed).
 */
export function parseRecipe(
  input: unknown,
  expectedName?: string,
):
  | { ok: true; recipe: RecipeData }
  | { ok: false; code: 'invalid' | 'name-mismatch'; issues: RecipeIssue[] } {
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'invalid',
      issues: parsed.error.issues.map((i) => ({
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

/** Options in OPTION_IDS order with undefined values dropped; undefined when nothing is left. */
function optionsObject(
  options: InflateOptionsInput | undefined,
): Record<string, unknown> | undefined {
  if (options === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const id of OPTION_IDS) {
    const value = options[id];
    if (value !== undefined) out[id] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Plain object in serializer key order: name, description, tags (non-empty), target, layout,
 * preamble (non-blank), contexts, items, markdown (non-empty), overrides (non-empty, no-op entries
 * dropped), order (non-empty), defaults (at least one kind with a mode or option).
 */
export function recipeToYamlObject(r: RecipeData): Record<string, unknown> {
  const doc: Record<string, unknown> = { name: r.name, description: r.description };
  if (r.tags.length > 0) doc.tags = [...r.tags];
  doc.target = r.target;
  doc.layout = r.layout;
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
