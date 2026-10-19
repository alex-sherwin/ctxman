import type { ReactNode } from 'react';
import {
  Cell as AriaCell,
  Column as AriaColumn,
  ColumnResizer,
  ResizableTableContainer,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
  type CellProps,
  type ColumnProps as AriaColumnProps,
  type ColumnRenderProps,
  type ResizableTableContainerProps,
  type RowProps,
  type TableBodyProps,
  type TableHeaderProps,
  type TableProps as AriaTableProps,
} from 'react-aria-components';
import { Icon } from './Icon.tsx';
import { cx, kitClass } from './utils.ts';

export interface TableProps extends AriaTableProps {
  density?: 'normal' | 'compact';
}

/**
 * Data table (react-aria Table: a real `<table>` with grid keyboard navigation). Use exactly one
 * `<Column isRowHeader>`; non-interactive tables set no `selectionMode`. SSR pages use the HTML twin
 * (`ck-table`, `ck-table__head`, `ck-table__th`, `ck-table__body`, `ck-table__row`, `ck-table__td`).
 * Resizable columns: wrap the Table in `ResizableTable` and set `allowsResizing` on the columns.
 */
export function Table({ density = 'normal', className, ...rest }: TableProps) {
  return (
    <AriaTable
      {...rest}
      className={kitClass(className, 'ck-table', density === 'compact' && 'ck-table--compact')}
    />
  );
}

export function TableHeader<T extends object>({ className, ...rest }: TableHeaderProps<T>) {
  return <AriaTableHeader {...rest} className={kitClass(className, 'ck-table__head')} />;
}

/**
 * The scroll box of a table with resizable columns (react-aria ResizableTableContainer: it measures this box to
 * lay the columns out). Columns wider than the box scroll sideways; give it a max-height and the header sticks.
 */
export function ResizableTable({ className, ...rest }: ResizableTableContainerProps) {
  return <ResizableTableContainer {...rest} className={cx('ck-table-scroll', className)} />;
}

export interface ColumnProps extends AriaColumnProps {
  align?: 'start' | 'end';
  /** A drag handle on the right edge (the Table must sit in a `ResizableTable`). */
  allowsResizing?: boolean;
  /** Extra header controls after the label and the sort arrow, e.g. a column menu button. */
  actions?: ReactNode | ((values: ColumnRenderProps) => ReactNode);
}

/** With `allowsSorting` a press on the header sorts and an arrow shows the direction of the sorted column. */
export function Column({
  align,
  allowsResizing,
  actions,
  className,
  children,
  ...rest
}: ColumnProps) {
  return (
    <AriaColumn
      {...rest}
      className={kitClass(
        className,
        'ck-table__th',
        align === 'end' && 'ck-table__th--end',
        allowsResizing && 'ck-table__th--resizable',
      )}
    >
      {(rp) => {
        const label = typeof children === 'function' ? children(rp) : children;
        if (!rp.allowsSorting && !allowsResizing && actions === undefined) return label;
        return (
          <span className="ck-table__colhead">
            <span className="ck-table__colname">{label}</span>
            {rp.allowsSorting && (
              <span className="ck-table__sort" data-dir={rp.sortDirection} aria-hidden="true">
                <Icon name="chevron" size={12} />
              </span>
            )}
            {typeof actions === 'function' ? actions(rp) : actions}
            {allowsResizing && <ColumnResizer className="ck-table__resizer" />}
          </span>
        );
      }}
    </AriaColumn>
  );
}

export function TableBody<T extends object>({ className, ...rest }: TableBodyProps<T>) {
  return <AriaTableBody {...rest} className={kitClass(className, 'ck-table__body')} />;
}

/** With `href` the whole row is a link (modifier clicks open new tabs). */
export function Row<T extends object>({ className, ...rest }: RowProps<T>) {
  return <AriaRow {...rest} className={kitClass(className, 'ck-table__row')} />;
}

export function Cell({ align, className, ...rest }: CellProps & { align?: 'start' | 'end' }) {
  return (
    <AriaCell
      {...rest}
      className={kitClass(className, 'ck-table__td', align === 'end' && 'ck-table__td--end')}
    />
  );
}
