// PURE (browser-safe): which rows the EntryPicker shows (ROUND3_SPEC §E.6). Text filter = the shared
// `filterEntries` (every whitespace-separated term must appear in name + title + description + tags), order =
// registry dataset order then title, capped so a big dataset never renders thousands of rows.
import { filterEntries } from '../../lib/entry-filter.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { compareEntries } from '../../stores/entries.ts';

/** Rows rendered at most; the rest is reached by refining the filter. */
export const PICKER_CAP = 200;

export interface PickerRows {
  /** At most `cap` rows. */
  rows: EntrySummary[];
  /** Entries that matched the filter (>= rows.length). */
  matched: number;
}

export function pickerRows(
  entries: readonly EntrySummary[],
  q: string,
  cap: number = PICKER_CAP,
): PickerRows {
  const matched = filterEntries(entries, { q, sort: 'name' }).sort(compareEntries);
  return { rows: matched.slice(0, cap), matched: matched.length };
}

/** `ds/slug`, the key of a row and the format of the picker's `exclude` set. */
export function pickerKey(e: Pick<EntrySummary, 'dataset' | 'slug'>): string {
  return `${e.dataset}/${e.slug}`;
}
