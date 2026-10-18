// PURE helpers for the Inflate island (INFLATE_SPEC §9.3): byte sizes, the collapsed markdown-block
// summary (shared with the Forge notes) and the recipe name rule of the New recipe dialog.
import { nameProblem } from '../forge/validate-name.ts';

export { firstLine, lineCount, plural } from '../forge/notes.ts';

/** `512 B`, `1.5 KB`, `2.0 MB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * The first problem with `value` as a recipe name, or null when it is fine: the shared entry-name rule,
 * plus `new` (reserved: it is the URL of the New recipe dialog) and uniqueness against `existing`.
 */
export function recipeNameProblem(value: string, existing?: ReadonlySet<string>): string | null {
  const base = nameProblem(value);
  if (base !== null) return base;
  if (value === 'new') return '"new" is reserved';
  if (existing?.has(value)) return 'A recipe with this name already exists';
  return null;
}
