// The data of a list page for the ListTable island. The page writes it as JSON into
// `<script type="application/json" id="ctxman-list-data">` (`serializeListData`, server side); the client:only island
// reads it when it mounts (`readListData`). Nothing of the table is rendered on the server.
import type { DatasetId } from '../../datasets/registry.ts';
import type { SortDir } from '../../lib/entry-filter.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import type { ListSort } from '../../lib/url-state.ts';

/** The id of the JSON `<script>` element (not `cx-`: that prefix is for classes, see css-classes.test.ts). */
export const LIST_DATA_ID = 'ctxman-list-data';

export interface ListData {
  dataset: DatasetId;
  /** Already filtered and sorted by the server. */
  entries: EntrySummary[];
  sort: ListSort;
  dir: SortDir;
  /** Time of the page render: "5 minutes ago" until the island's clock (`$now`) has ticked. */
  now: number;
}

/** JSON that is safe inside a `<script>` element: every `<` escaped, so no value can close it early. */
export function serializeListData(data: ListData): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** The page's list data, or null when the element is missing or unreadable. Browser only. */
export function readListData(): ListData | null {
  const text = document.getElementById(LIST_DATA_ID)?.textContent;
  if (!text) return null;
  try {
    return JSON.parse(text) as ListData;
  } catch {
    return null;
  }
}
