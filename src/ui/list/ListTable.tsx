// ListTable island (`/<ds>` list pages): the filtered, sorted entries of one dataset as a react-aria Table.
// client:only like every island: the page renders no table markup, only the data as JSON (list-data.ts), which the
// island reads when it mounts and renders in its final layout (stored widths, hidden columns, density) at once.
// - Rows are links (RAC Row `href`: a press anywhere, Enter on a focused row; Cmd/Ctrl/middle click open a tab).
//   The title is a real `<a tabIndex={-1}>` as well, for its context menu and the status-bar URL.
// - Columns resize (drag the right edge, or "Resize column" in the column menu + arrow keys) and can be hidden;
//   widths, hidden columns and the row density are remembered per dataset in localStorage (table-prefs.ts).
// - Sorting is URL state like every other list control: a header press (or the column menu) navigates to the same
//   list with `sort` / `dir`, and the server sorts (filterEntries).
// - The state select is the native one src/scripts/shell.ts saves (StateSelect.tsx); `keyboardNavigationBehavior
//   ="tab"` keeps arrow keys and Enter inside it instead of moving through the grid.
// - The last column holds the entry's `⋯` menu (EntryMenu.tsx, shared with the EntryMenus island of detail pages).
import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { getDataset, OWNER_LABELS } from '../../datasets/registry.ts';
import { defaultSortDir } from '../../lib/entry-filter.ts';
import type { SortDir } from '../../lib/entry-filter.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { TARGETS } from '../../lib/inflate/catalog.ts';
import { formatAbsolute, formatRelative } from '../../lib/time.ts';
import { listSortHref } from '../../lib/url-state.ts';
import type { ListSort } from '../../lib/url-state.ts';
import { $now } from '../../stores/now.ts';
import { Button } from '../kit/Button.tsx';
import { Icon } from '../kit/Icon.tsx';
import { Menu, MenuItem, MenuSection, MenuTrigger } from '../kit/Menu.tsx';
import { Popover } from '../kit/Popover.tsx';
import { DeleteEntryDialog, EntryMenu } from '../menus/EntryMenu.tsx';
import type { MenuTarget } from '../menus/EntryMenu.tsx';
import { Cell, Column, ResizableTable, Row, Table, TableBody, TableHeader } from '../kit/Table.tsx';
import { listColumns } from './columns.ts';
import type { ListColumn, ListColumnId } from './columns.ts';
import { readListData } from './list-data.ts';
import type { ListData } from './list-data.ts';
import { StateSelect } from './StateSelect.tsx';
import {
  DEFAULT_TABLE_PREFS,
  setTablePrefs,
  toColumnWidth,
  useTablePrefs,
  withHidden,
  withWidths,
} from './table-prefs.ts';
import type { TableDensity, TablePrefs } from './table-prefs.ts';

const MAX_TAGS = 4;

/** The actions column after the data columns: the row's `⋯` menu. Fixed width; never sorted, resized or hidden. */
interface MenuColumn {
  id: 'menu';
}
const MENU_COLUMN: MenuColumn = { id: 'menu' };
const MENU_WIDTH = 44;

/** The same list sorted by `sort` / `dir`: a navigation, the server sorts. */
function goSort(sort: ListSort, dir: SortDir): void {
  location.assign(listSortHref(`${location.pathname}${location.search}`, sort, dir));
}

export default function ListTable() {
  // client:only: the island mounts after the page is parsed, so the data element exists on the first render.
  const [data] = useState(readListData);
  if (data === null) return null;
  return <ListTableView data={data} />;
}

function ListTableView({ data }: { data: ListData }) {
  const { dataset, entries, sort, dir } = data;
  const def = getDataset(dataset);
  const prefs = useTablePrefs(dataset);
  // The ticking clock is 0 until it has started: the page's render time stands in.
  const tick = useStore($now);
  const now = tick === 0 ? data.now : tick;
  // Widths while a resize drag is under way (the columns are controlled); stored once the drag ends.
  const [dragWidths, setDragWidths] = useState<ReadonlyMap<Key, unknown> | null>(null);
  // A sort was chosen and the page is navigating: the rows dim until it arrives.
  const [sorting, setSorting] = useState(false);
  // The row whose "Delete…" is being confirmed.
  const [asking, setAsking] = useState<MenuTarget | null>(null);

  const allColumns = useMemo(() => listColumns(dataset), [dataset]);
  // The data columns the layout shows; the table renders them plus the actions column.
  const columns = useMemo(
    () => allColumns.filter((c) => !prefs.hidden.includes(c.id)),
    [allColumns, prefs.hidden],
  );
  const tableColumns = useMemo(() => [...columns, MENU_COLUMN], [columns]);
  const widthOf = (c: ListColumn) =>
    toColumnWidth(dragWidths?.get(c.id)) ?? prefs.widths[c.id] ?? c.defaultWidth;
  const sorted = columns.find((c) => c.sort === sort);

  // Back to this page from the bfcache after a sort navigation: the rows are no longer on their way out.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSorting(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  function update(next: TablePrefs) {
    setTablePrefs(dataset, next);
  }

  function sortBy(next: ListSort, nextDir: SortDir) {
    if (next === sort && nextDir === dir) return;
    setSorting(true);
    goSort(next, nextDir);
  }

  return (
    <div className="cx-ltable" data-testid="list-results" data-sorting={sorting || undefined}>
      <div className="cx-ltable__bar">
        <LayoutMenu
          columns={allColumns}
          prefs={prefs}
          onChange={update}
          label={def?.plural ?? dataset}
        />
      </div>
      <ResizableTable
        className="cx-ltable__scroll"
        onResize={setDragWidths}
        onResizeEnd={(widths) => {
          setDragWidths(null);
          update(withWidths(prefs, widths));
        }}
      >
        <Table
          aria-label={def?.label ?? dataset}
          density={prefs.density}
          keyboardNavigationBehavior="tab"
          className="cx-table"
          sortDescriptor={
            sorted === undefined
              ? undefined
              : { column: sorted.id, direction: dir === 'asc' ? 'ascending' : 'descending' }
          }
          onSortChange={(descriptor) => {
            const column = columns.find((c) => c.id === descriptor.column);
            if (column?.sort === undefined) return;
            // Pressing the sorted column flips it; another column starts in its own direction (newest first, …).
            const nextDir =
              column.sort === sort
                ? descriptor.direction === 'ascending'
                  ? 'asc'
                  : 'desc'
                : defaultSortDir(column.sort);
            sortBy(column.sort, nextDir);
          }}
        >
          <TableHeader columns={tableColumns} dependencies={[prefs, dragWidths]}>
            {(column) =>
              column.id === 'menu' ? (
                <Column
                  id="menu"
                  width={MENU_WIDTH}
                  minWidth={MENU_WIDTH}
                  textValue="Actions"
                  className="cx-table__th--menu"
                >
                  <span className="ck-sr-only">Actions</span>
                </Column>
              ) : (
                <Column
                  id={column.id}
                  isRowHeader={column.id === 'entry'}
                  allowsSorting={column.sort !== undefined}
                  allowsResizing
                  width={widthOf(column)}
                  minWidth={column.minWidth}
                  textValue={column.label}
                  className={`cx-table__th--${column.id}`}
                  actions={({ startResize }) => (
                    <ColumnMenu
                      column={column}
                      onSort={(nextDir) => {
                        if (column.sort !== undefined) sortBy(column.sort, nextDir);
                      }}
                      onResize={startResize}
                      onHide={() => update(withHidden(prefs, column.id, true))}
                    />
                  )}
                >
                  {column.label}
                </Column>
              )
            }
          </TableHeader>
          <TableBody items={entries} dependencies={[tableColumns, now]}>
            {(e) => (
              <Row
                id={e.slug}
                href={e.url}
                textValue={e.title ?? e.name}
                columns={tableColumns}
                className="cx-table__row"
                data-testid="list-row"
                data-slug={e.slug}
              >
                {(column) => (
                  <Cell className={`cx-table__td--${column.id}`}>
                    {column.id === 'menu' ? (
                      <span data-testid="row-menu-slot">
                        <EntryMenu
                          target={{
                            dataset: e.dataset,
                            slug: e.slug,
                            title: e.title ?? e.name,
                            context: 'row',
                          }}
                          onDelete={setAsking}
                        />
                      </span>
                    ) : (
                      <CellContent entry={e} column={column.id} now={now} />
                    )}
                  </Cell>
                )}
              </Row>
            )}
          </TableBody>
        </Table>
      </ResizableTable>
      {asking !== null && <DeleteEntryDialog target={asking} onClose={() => setAsking(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- cells

function CellContent({
  entry: e,
  column,
  now,
}: {
  entry: EntrySummary;
  column: ListColumnId;
  now: number;
}) {
  const title = e.title ?? e.name;
  switch (column) {
    case 'entry': {
      const issue = e.invalid?.[0];
      return (
        <>
          <span className="ck-entryline">
            <a className="ck-entryline__title cx-table__title" href={e.url} tabIndex={-1}>
              {title}
            </a>
            {e.invalid && (
              <span
                className="ck-badge ck-badge--danger"
                title={
                  issue === undefined
                    ? 'The entry file is invalid'
                    : issue.path === ''
                      ? issue.message
                      : `${issue.path}: ${issue.message}`
                }
                data-testid="invalid-badge"
              >
                invalid
              </span>
            )}
            {e.stale && (
              <span
                className="ck-badge ck-badge--warn"
                title={e.staleAfter ? `stale since ${e.staleAfter}` : 'stale'}
              >
                stale
              </span>
            )}
            {e.okfStatus === 'draft' && <span className="ck-badge ck-badge--muted">draft</span>}
            {e.okfStatus === 'deprecated' && (
              <span className="ck-badge ck-badge--danger">deprecated</span>
            )}
          </span>
          {e.title !== undefined && e.title !== e.name && (
            <code className="ck-entryline__slug cx-table__slug">{e.slug}</code>
          )}
        </>
      );
    }
    case 'desc':
      return (
        <span className="ck-entryline__desc cx-truncate" title={e.description}>
          {e.description}
        </span>
      );
    case 'state':
      return <StateSelect dataset={e.dataset} slug={e.slug} title={title} state={e.state} />;
    case 'tags':
      return (
        <span className="cx-row">
          {e.tags.slice(0, MAX_TAGS).map((t) => (
            <span key={t} className="ck-badge ck-badge--tag">
              {t}
            </span>
          ))}
          {e.tags.length > MAX_TAGS && (
            <span className="ck-badge ck-badge--muted" title={e.tags.slice(MAX_TAGS).join(', ')}>
              +{e.tags.length - MAX_TAGS}
            </span>
          )}
        </span>
      );
    case 'type':
      return (
        <span className="cx-row cx-nowrap">
          {e.refType && (
            <span className="ck-badge ck-badge--muted ck-badge--mono">{e.refType}</span>
          )}
          {e.uriKind && (
            <span className="ck-badge ck-badge--info ck-badge--mono" data-testid="uri-kind-badge">
              {e.uriKind}
            </span>
          )}
        </span>
      );
    case 'owner':
      return e.owner === undefined ? null : <>{OWNER_LABELS[e.owner]}</>;
    case 'links':
      return <span className="cx-mono">{e.linkCount ?? 0}</span>;
    case 'target':
      return e.recipeTarget === undefined ? null : (
        <span className="ck-badge ck-badge--info ck-badge--mono" data-testid="recipe-target-badge">
          {TARGETS[e.recipeTarget].label}
        </span>
      );
    case 'contexts':
      return <span className="cx-mono">{e.contextCount ?? 0}</span>;
    case 'modified':
      return (
        <time
          className="cx-freshness"
          dateTime={e.lastModified}
          title={formatAbsolute(e.lastModified)}
        >
          {formatRelative(e.lastModified, now)}
        </time>
      );
  }
}

// ---------------------------------------------------------------- menus

/** A check mark slot for the selectable menu items (react-aria sets their aria-checked). */
function Check({ on }: { on: boolean }) {
  return (
    <span className="cx-ltable__check" aria-hidden="true">
      {on && <Icon name="check" size={12} />}
    </span>
  );
}

interface ColumnMenuProps {
  column: ListColumn;
  onSort: (dir: SortDir) => void;
  onResize: () => void;
  onHide: () => void;
}

/** The "…" button in a column header: sort either way, resize from the keyboard, hide. */
function ColumnMenu({ column, onSort, onResize, onHide }: ColumnMenuProps) {
  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={`${column.label} column options`}
        className="cx-ltable__colmenu"
        data-testid={`list-colmenu-${column.id}`}
      >
        <Icon name="more" size={14} />
      </Button>
      <Popover placement="bottom end">
        <Menu
          aria-label={`${column.label} column`}
          onAction={(key) => {
            if (key === 'asc' || key === 'desc') onSort(key);
            else if (key === 'resize') onResize();
            else if (key === 'hide') onHide();
          }}
        >
          {column.sort !== undefined && <MenuItem id="asc">Sort ascending</MenuItem>}
          {column.sort !== undefined && <MenuItem id="desc">Sort descending</MenuItem>}
          <MenuItem id="resize">Resize column</MenuItem>
          {column.hideable && <MenuItem id="hide">Hide column</MenuItem>}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

interface LayoutMenuProps {
  columns: readonly ListColumn[];
  prefs: TablePrefs;
  onChange: (next: TablePrefs) => void;
  /** Lowercase plural of the dataset, for the accessible name. */
  label: string;
}

const DENSITIES: readonly { id: TableDensity; label: string }[] = [
  { id: 'normal', label: 'Comfortable' },
  { id: 'compact', label: 'Compact' },
];

/** Above the table: which columns show, the row density, and resetting the stored layout. */
function LayoutMenu({ columns, prefs, onChange, label }: LayoutMenuProps) {
  const hideable = columns.filter((c) => c.hideable);
  const shown = hideable.filter((c) => !prefs.hidden.includes(c.id)).map((c) => c.id);
  const customized =
    Object.keys(prefs.widths).length > 0 ||
    prefs.hidden.length > 0 ||
    prefs.density !== DEFAULT_TABLE_PREFS.density;
  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="sm"
        glow
        aria-label={`Table layout of the ${label} list`}
        data-testid="list-layout"
      >
        Columns <Icon name="chevron" size={12} />
      </Button>
      <Popover placement="bottom end">
        <Menu
          aria-label="Table layout"
          onAction={(key) => {
            if (key === 'reset-widths') onChange({ ...prefs, widths: {} });
            else if (key === 'reset') onChange(DEFAULT_TABLE_PREFS);
          }}
          data-testid="list-layout-menu"
        >
          <MenuSection
            title="Columns"
            selectionMode="multiple"
            selectedKeys={shown}
            shouldCloseOnSelect={false}
            onSelectionChange={(keys) => {
              const visible = keys === 'all' ? null : new Set<Key>(keys);
              let next = prefs;
              for (const c of hideable)
                next = withHidden(next, c.id, visible !== null && !visible.has(c.id));
              onChange(next);
            }}
          >
            {hideable.map((c) => (
              <MenuItem
                key={c.id}
                id={c.id}
                textValue={c.label}
                data-testid={`list-layout-col-${c.id}`}
              >
                {({ isSelected }) => (
                  <>
                    <Check on={isSelected} />
                    {c.label}
                  </>
                )}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection
            title="Density"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[prefs.density]}
            onSelectionChange={(keys) => {
              const density = keys === 'all' ? undefined : [...keys][0];
              if (density === 'normal' || density === 'compact') onChange({ ...prefs, density });
            }}
          >
            {DENSITIES.map((d) => (
              <MenuItem
                key={d.id}
                id={d.id}
                textValue={d.label}
                data-testid={`list-layout-density-${d.id}`}
              >
                {({ isSelected }) => (
                  <>
                    <Check on={isSelected} />
                    {d.label}
                  </>
                )}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection>
            <MenuItem
              id="reset-widths"
              isDisabled={Object.keys(prefs.widths).length === 0}
              data-testid="list-layout-reset-widths"
            >
              Reset column widths
            </MenuItem>
            <MenuItem id="reset" isDisabled={!customized} data-testid="list-layout-reset">
              Reset layout
            </MenuItem>
          </MenuSection>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
