// ListTable island (`/<ds>` list pages): the filtered, sorted entries of one dataset as a react-aria Table.
// client:only like every island: the page renders no table markup, only the data as JSON (list-data.ts), which the
// island reads when it mounts and renders in its final layout (stored widths, hidden columns, density) at once.
// - Rows are links (RAC Row `href`: a press anywhere, Enter on a focused row; Cmd/Ctrl/middle click open a tab).
//   The title is a real `<a tabIndex={-1}>` as well, for its context menu and the status-bar URL.
// - Columns resize (drag the right edge, or "Resize column" in the column menu + arrow keys) and can be hidden;
//   widths, hidden columns and the row density are remembered per dataset in localStorage (table-prefs.ts).
// - Sorting is URL state like every other list control: a header press (or the column menu) navigates to the same
//   list with `sort` / `dir`, and the server sorts (filterEntries). The choice is remembered first
//   (list-sort-memory.ts): a list URL without a sort opens in the last one chosen.
// - The state select is the native one src/scripts/shell.ts saves (StateSelect.tsx); `keyboardNavigationBehavior
//   ="tab"` keeps arrow keys and Enter inside it instead of moving through the grid, and its cell keeps the events
//   of a change from pressing the row (a change saves and reloads the list, it never opens the entry).
// - The last column holds the row's actions as icon buttons: Log time (task, feature, bug, rca: LogTimeDialog.tsx)
//   and Delete… (the confirm dialog of EntryMenu.tsx, shared with the EntryMenus island of detail pages). A write
//   reloads the list; Log time leaves a message for the reloaded page (list-flash.ts).
import { useStore } from '@nanostores/react';
import { useEffect, useMemo, useState } from 'react';
import type { Key } from 'react-aria-components';
import { getDataset, isTimeTrackedDatasetId, OWNER_LABELS } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { defaultSortDir } from '../../lib/entry-filter.ts';
import type { SortDir } from '../../lib/entry-filter.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { TARGETS } from '../../lib/inflate/catalog.ts';
import { formatSeconds } from '../../lib/iso8601.ts';
import { rememberListSort } from '../../lib/list-sort-memory.ts';
import { formatAbsolute, formatRelative } from '../../lib/time.ts';
import { listSortHref } from '../../lib/url-state.ts';
import type { ListSort } from '../../lib/url-state.ts';
import { $now } from '../../stores/now.ts';
import { Button } from '../kit/Button.tsx';
import { Icon } from '../kit/Icon.tsx';
import { Menu, MenuItem, MenuSection, MenuTrigger } from '../kit/Menu.tsx';
import { Popover } from '../kit/Popover.tsx';
import { Status } from '../kit/Status.tsx';
import { Tooltip } from '../kit/Tooltip.tsx';
import { DeleteEntryDialog } from '../menus/EntryMenu.tsx';
import type { MenuTarget } from '../menus/EntryMenu.tsx';
import { Cell, Column, ResizableTable, Row, Table, TableBody, TableHeader } from '../kit/Table.tsx';
import { listColumns } from './columns.ts';
import type { ListColumn, ListColumnId } from './columns.ts';
import { readListData } from './list-data.ts';
import type { ListData } from './list-data.ts';
import { clearListFlash, readListFlash } from './list-flash.ts';
import { LogTimeDialog } from './LogTimeDialog.tsx';
import type { LogTimeTarget } from './LogTimeDialog.tsx';
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

/** The actions column after the data columns: the row's icon buttons. Fixed width; never sorted, resized or hidden. */
interface ActionsColumn {
  id: 'actions';
}
const ACTIONS_COLUMN: ActionsColumn = { id: 'actions' };
/** Fits one small icon button plus the cell padding; each more button adds its width and the gap. */
const ACTIONS_WIDTH = 44;
const ACTION_STEP = 24;

/** The same list sorted by `sort` / `dir`: a navigation, the server sorts. Remembered as the list's sort. */
function goSort(dataset: DatasetId, sort: ListSort, dir: SortDir): void {
  rememberListSort(dataset, sort, dir);
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
  // The row whose "Log time" dialog is open.
  const [logging, setLogging] = useState<LogTimeTarget | null>(null);
  // What the last row action did before the reload (Log time); shown once.
  const [flash] = useState(readListFlash);
  useEffect(() => clearListFlash(), []);
  const timeTracked = isTimeTrackedDatasetId(dataset);
  const actionsWidth = ACTIONS_WIDTH + (timeTracked ? ACTION_STEP : 0);

  const allColumns = useMemo(() => listColumns(dataset), [dataset]);
  // The data columns the layout shows; the table renders them plus the actions column.
  const columns = useMemo(
    () => allColumns.filter((c) => !prefs.hidden.includes(c.id)),
    [allColumns, prefs.hidden],
  );
  const tableColumns = useMemo(() => [...columns, ACTIONS_COLUMN], [columns]);
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
    goSort(dataset, next, nextDir);
  }

  return (
    <div className="cx-ltable" data-testid="list-results" data-sorting={sorting || undefined}>
      <div className="cx-ltable__bar">
        {flash !== null && (
          <Status kind="ok" className="cx-ltable__flash" testId="list-flash">
            {flash}
          </Status>
        )}
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
              column.id === 'actions' ? (
                <Column
                  id="actions"
                  width={actionsWidth}
                  minWidth={actionsWidth}
                  textValue="Actions"
                  className="cx-table__th--actions"
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
                    {column.id === 'actions' ? (
                      <RowActions
                        entry={e}
                        timeTracked={timeTracked}
                        onLogTime={setLogging}
                        onDelete={setAsking}
                      />
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
      {logging !== null && <LogTimeDialog target={logging} onClose={() => setLogging(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- row actions

interface RowActionsProps {
  entry: EntrySummary;
  /** task, feature, bug, rca: the row has Log time. */
  timeTracked: boolean;
  onLogTime: (target: LogTimeTarget) => void;
  onDelete: (target: MenuTarget) => void;
}

/** The icon buttons of a row. RAC buttons keep their presses to themselves: the row link never sees them. */
function RowActions({ entry: e, timeTracked, onLogTime, onDelete }: RowActionsProps) {
  const title = e.title ?? e.name;
  return (
    <span className="cx-ltable__actions" data-testid="row-actions">
      {timeTracked && (
        <Tooltip content="Log time">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`Log time on ${title}`}
            onPress={() => onLogTime({ dataset: e.dataset, slug: e.slug, title })}
            data-testid="row-log-time"
          >
            <Icon name="clock" />
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Delete…">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          tone="danger"
          aria-label={`Delete ${title}`}
          onPress={() => onDelete({ dataset: e.dataset, slug: e.slug, title, context: 'row' })}
          data-testid="row-delete"
        >
          <Icon name="trash" />
        </Button>
      </Tooltip>
    </span>
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
            {e.issueKey !== undefined && (
              <span
                className="ck-badge ck-badge--muted ck-badge--mono"
                title="Issue key"
                data-testid="issue-key-badge"
              >
                {e.issueKey}
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
    case 'time':
      return e.timeSeconds === undefined ? null : e.timeSeconds === null ? (
        <span
          className="cx-mono cx-subtle"
          title="No total (a value has years or months, or is not a duration)"
          data-testid="row-time"
        >
          ?
        </span>
      ) : (
        <span className="cx-mono" data-testid="row-time">
          {formatSeconds(e.timeSeconds)}
        </span>
      );
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
