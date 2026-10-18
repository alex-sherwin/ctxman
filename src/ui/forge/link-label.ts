// PURE helpers for the links list: the label and "missing" flag of a link, resolved from the entries cache
// ($entries). Shared by ContextPane (row textValue, drag handle label, row attributes) and LinkRow (the title);
// `invalidTitle` also serves the Discover rows of both islands.
import type { DatasetId } from '../../datasets/registry.ts';
import type { ContextLink } from '../../datasets/schemas.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import type { EntriesState } from '../../stores/entries.ts';

type EntriesMap = Partial<Record<DatasetId, EntriesState>>;

/** Row label: the cached entry title, else its name, else the slug (while loading or when missing). */
export function labelOf(entries: EntriesMap, link: ContextLink): string {
  const entry = entries[link.dataset]?.entries.find((e) => e.slug === link.slug);
  return entry?.title ?? entry?.name ?? link.slug;
}

/** True once the dataset is loaded and no entry has this slug. */
export function isMissing(entries: EntriesMap, link: ContextLink): boolean {
  const cache = entries[link.dataset];
  return cache?.status === 'ready' && !cache.entries.some((e) => e.slug === link.slug);
}

/**
 * Tooltip text of the "invalid" flag on an entry whose file fails its schema: the issues, `path: message`, joined
 * by `; `. Undefined for a valid entry. Shared by the Forge and Inflate Discover rows and the links list.
 */
export function invalidTitle(entry: Pick<EntrySummary, 'invalid'>): string | undefined {
  if (entry.invalid === undefined || entry.invalid.length === 0) return undefined;
  return entry.invalid.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');
}
