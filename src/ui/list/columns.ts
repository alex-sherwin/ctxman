// PURE: the columns of a dataset list table (ListTable island, `/<ds>`): which columns a dataset shows, in order,
// their header labels, default and minimum widths (RAC column sizes: px or `<n>fr`) and the URL sort a header sets.
// Every list shows Entry, Description and Modified; the rest depend on the dataset (Time, the total of the logged
// `time`, right before Modified on task, feature, bug and rca lists).
import { getDataset, isTimeTrackedDatasetId } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import type { ListSort } from '../../lib/url-state.ts';

export const LIST_COLUMN_IDS = [
  'entry',
  'desc',
  'state',
  'tags',
  'type',
  'owner',
  'links',
  'target',
  'contexts',
  'time',
  'modified',
] as const;
export type ListColumnId = (typeof LIST_COLUMN_IDS)[number];

/** A RAC column size: pixels, a percentage of the table, or a share (`fr`) of the space left over. */
export type ColumnWidth = number | `${number}%` | `${number}fr`;

export interface ListColumn {
  id: ListColumnId;
  label: string;
  defaultWidth: ColumnWidth;
  /** Pixels; also what a resize can never go below. */
  minWidth: number;
  /** The `sort` a press on the header sets; undefined = not sortable. */
  sort?: ListSort;
  /** The Entry column (the row header) is always shown. */
  hideable: boolean;
}

const COLUMNS: Readonly<Record<ListColumnId, ListColumn>> = {
  entry: {
    id: 'entry',
    label: 'Entry',
    defaultWidth: '2fr',
    minWidth: 180,
    sort: 'name',
    hideable: false,
  },
  desc: { id: 'desc', label: 'Description', defaultWidth: '3fr', minWidth: 120, hideable: true },
  state: {
    id: 'state',
    label: 'State',
    defaultWidth: 140,
    minWidth: 110,
    sort: 'state',
    hideable: true,
  },
  tags: { id: 'tags', label: 'Tags', defaultWidth: 200, minWidth: 80, hideable: true },
  type: {
    id: 'type',
    label: 'Type',
    defaultWidth: 190,
    minWidth: 90,
    sort: 'type',
    hideable: true,
  },
  owner: {
    id: 'owner',
    label: 'Owner',
    defaultWidth: 100,
    minWidth: 80,
    sort: 'owner',
    hideable: true,
  },
  links: {
    id: 'links',
    label: 'Links',
    defaultWidth: 90,
    minWidth: 70,
    sort: 'links',
    hideable: true,
  },
  target: {
    id: 'target',
    label: 'Target',
    defaultWidth: 130,
    minWidth: 90,
    sort: 'target',
    hideable: true,
  },
  contexts: {
    id: 'contexts',
    label: 'Contexts',
    defaultWidth: 110,
    minWidth: 90,
    sort: 'contexts',
    hideable: true,
  },
  time: {
    id: 'time',
    label: 'Time',
    defaultWidth: 100,
    minWidth: 70,
    sort: 'time',
    hideable: true,
  },
  modified: {
    id: 'modified',
    label: 'Modified',
    defaultWidth: 130,
    minWidth: 100,
    sort: 'modified',
    hideable: true,
  },
};

export function isListColumnId(value: unknown): value is ListColumnId {
  return typeof value === 'string' && (LIST_COLUMN_IDS as readonly string[]).includes(value);
}

/** Every column the list of `dataset` has, in display order (hidden ones included). */
export function listColumns(dataset: DatasetId): readonly ListColumn[] {
  const ids: readonly ListColumnId[] =
    dataset === 'reference'
      ? ['entry', 'desc', 'type', 'owner', 'modified']
      : dataset === 'context'
        ? ['entry', 'desc', 'links', 'tags', 'modified']
        : dataset === 'recipe'
          ? ['entry', 'desc', 'target', 'contexts', 'tags', 'modified']
          : getDataset(dataset)?.states
            ? ['entry', 'desc', 'state', 'tags', 'modified']
            : ['entry', 'desc', 'tags', 'modified'];
  const withTime = isTimeTrackedDatasetId(dataset)
    ? [...ids.slice(0, -1), 'time' as const, ...ids.slice(-1)]
    : ids;
  return withTime.map((id) => COLUMNS[id]);
}
