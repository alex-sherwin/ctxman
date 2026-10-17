// PURE: the entry-name rule shared by the New context dialog (UI_SPEC §H.6) and the Tools Add Entry form
// (§I.5): same messages in both places. `registry.NAME_PATTERN` / `NAME_MAX_LENGTH` are the source of truth.
import { NAME_MAX_LENGTH, NAME_PATTERN } from '../../datasets/registry.ts';

/**
 * The first problem with `value` as an entry name, or null when it is fine.
 * `existing` adds the uniqueness rule (contexts already on disk).
 */
export function nameProblem(value: string, existing?: ReadonlySet<string>): string | null {
  if (value === '') return 'Required';
  if (!NAME_PATTERN.test(value)) {
    return 'Use lowercase letters, digits and single hyphens, e.g. auth-refactor';
  }
  if (value.length > NAME_MAX_LENGTH) return `${NAME_MAX_LENGTH} characters max`;
  if (existing?.has(value)) return 'A context with this name already exists';
  return null;
}
