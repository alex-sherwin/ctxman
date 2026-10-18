// PURE helpers for the links list: the label and "missing" flag of a link, resolved from the entries cache
// ($entries). Shared by ContextPane (row textValue, drag handle label, row attributes) and LinkRow (the title).
import type { DatasetId } from '../../datasets/registry.ts';
import type { ContextLink } from '../../datasets/schemas.ts';
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
