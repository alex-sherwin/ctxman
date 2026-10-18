// PURE (no fs, no astro:*; browser-safe): the name and tag rules shared by every create / edit UI: the New
// context / New recipe dialogs, the Tools Add Entry form and the DataForm (ROUND2_UI_SPEC §C.3, §J). Same
// messages in every place. `registry.NAME_PATTERN` / `NAME_MAX_LENGTH` are the source of truth for names.
import { NAME_MAX_LENGTH, NAME_PATTERN } from '../datasets/registry.ts';

/**
 * The first problem with `value` as an entry name, or null when it is fine.
 * `existing` adds the uniqueness rule (entries already on disk); `noun` names them in the message
 * ("A context with this name already exists"; default 'context' for the Forge).
 */
export function nameProblem(
  value: string,
  existing?: ReadonlySet<string>,
  noun = 'context',
): string | null {
  if (value === '') return 'Required';
  if (!NAME_PATTERN.test(value)) {
    return 'Use lowercase letters, digits and single hyphens, e.g. auth-refactor';
  }
  if (value.length > NAME_MAX_LENGTH) return `${NAME_MAX_LENGTH} characters max`;
  if (existing?.has(value)) return `A ${noun} with this name already exists`;
  return null;
}

/** A tag: starts with a lowercase letter or digit, then lowercase letters, digits and hyphens. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** What the user typed as a tag, normalized: trimmed, lowercased, whitespace runs become one hyphen. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/** The first problem with an already normalized `tag` ('' is "nothing typed yet" and not a problem). */
export function tagProblem(tag: string): string | null {
  return tag === '' || TAG_PATTERN.test(tag) ? null : 'Lowercase letters, digits and hyphens';
}
