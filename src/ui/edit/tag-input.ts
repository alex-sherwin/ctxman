// Browser-safe + PURE: how TagEditor turns typed text into tags (UX-26). Text is split on commas and
// whitespace, so `stardew,skill, ui` and `stardew skill ui` both give three tags. While typing, only the
// tokens that are followed by a separator are complete; the last token stays in the input until a separator,
// Enter or blur ends it. Invalid tokens are never dropped: they stay in the input with the problem shown.
import { normalizeTag, tagProblem } from '../../lib/names.ts';

const SEPARATORS = /[\s,]+/;

export interface TagInputResult {
  /** Normalized, valid, not yet present, in typing order, no duplicates. */
  add: string[];
  /** What stays in the input (invalid or unfinished tokens, joined by a space). */
  rest: string;
}

/**
 * `text` = the input value. `final` = the pending last token counts as finished too (Enter, blur).
 * Tokens already in `existing` are swallowed silently (no duplicates).
 */
export function splitTagInput(
  text: string,
  existing: readonly string[],
  final: boolean,
): TagInputResult {
  const tokens = text.split(SEPARATORS).filter((t) => t !== '');
  const endsWithSeparator = /[\s,]$/.test(text);
  // Everything is complete when finished or when the text ends with a separator; else the last token is pending.
  const pending = final || endsWithSeparator ? [] : tokens.slice(-1);
  const complete = final || endsWithSeparator ? tokens : tokens.slice(0, -1);

  const add: string[] = [];
  const keep: string[] = [];
  for (const token of complete) {
    const tag = normalizeTag(token);
    if (tagProblem(tag) !== null) keep.push(token);
    else if (!existing.includes(tag) && !add.includes(tag)) add.push(tag);
  }
  return { add, rest: [...keep, ...pending].join(' ') };
}

/** The first problem among the tokens of `text` (what the input shows as its error), or null. */
export function tagInputProblem(text: string): string | null {
  for (const token of text.split(SEPARATORS)) {
    if (token === '') continue;
    const problem = tagProblem(normalizeTag(token));
    if (problem !== null) return problem;
  }
  return null;
}
