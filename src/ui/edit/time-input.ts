// Browser-safe + PURE: how TimeEditor turns typed text into a `time` entry. Enter adds the text as ONE ISO 8601
// duration (upper-cased: `pt1h30m` -> `PT1H30M`) when it is one; anything else stays in the input with the problem
// shown. Repeats are fine (two sessions of PT1H are two entries).
import { normalizeIsoDuration } from '../../lib/iso8601.ts';

export const TIME_INPUT_PROBLEM = 'Not an ISO 8601 duration: use e.g. PT1H30M, PT45M or P1D';

export type TimeInputResult =
  | { ok: true; values: string[] }
  | { ok: false; problem: string | null };

/** `text` committed with Enter: the list with the duration appended, or why not (null = nothing typed). */
export function addTimeInput(values: readonly string[], text: string): TimeInputResult {
  if (text.trim() === '') return { ok: false, problem: null };
  const duration = normalizeIsoDuration(text);
  return duration === null
    ? { ok: false, problem: TIME_INPUT_PROBLEM }
    : { ok: true, values: [...values, duration] };
}
