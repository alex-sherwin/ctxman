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

// ---------------------------------------------------------------- clones (entry-clone.ts, the Clone… dialog)

/** A trailing `-copy` / `-copy-<n>` of a name: cloning a clone suggests the next copy of the first one. */
const COPY_SUFFIX = /-copy(?:-\d+)?$/;

/**
 * The first free name for a copy of `slug`: `<slug>-copy`, then `<slug>-copy-2`, `-copy-3`… (`existing` = the names
 * of the dataset's entries). A `-copy[-n]` the slug already ends with is not repeated, and the base is shortened so
 * the name stays within NAME_MAX_LENGTH (no trailing hyphen).
 */
export function suggestCloneName(slug: string, existing: ReadonlySet<string>): string {
  const stem = slug.replace(COPY_SUFFIX, '') || slug;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '-copy' : `-copy-${n}`;
    const base = stem.slice(0, NAME_MAX_LENGTH - suffix.length).replace(/-+$/, '');
    const name = `${base}${suffix}`;
    if (!existing.has(name)) return name;
  }
}

/** The title of a copy: "<title> (copy)"; a title that already ends in "(copy)" / "(copy 2)" stays as it is. */
export function cloneTitle(title: string): string {
  const t = title.trim();
  return /\(copy(?: \d+)?\)$/.test(t) ? t : `${t} (copy)`;
}
