import {
  Cell as AriaCell,
  Column as AriaColumn,
  Row as AriaRow,
  Table as AriaTable,
  TableBody as AriaTableBody,
  TableHeader as AriaTableHeader,
  type CellProps,
  type ColumnProps,
  type RowProps,
  type TableBodyProps,
  type TableHeaderProps,
  type TableProps as AriaTableProps,
} from 'react-aria-components';
import { kitClass } from './utils.ts';

export interface TableProps extends AriaTableProps {
  density?: 'normal' | 'compact';
}

/**
 * Data table (react-aria Table: a real `<table>` with grid keyboard navigation). Use exactly one
 * `<Column isRowHeader>`; non-interactive tables set no `selectionMode`. SSR pages use the HTML twin
 * (`ck-table`, `ck-table__head`, `ck-table__th`, `ck-table__body`, `ck-table__row`, `ck-table__td`).
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

export function Column({ align, className, ...rest }: ColumnProps & { align?: 'start' | 'end' }) {
  return (
    <AriaColumn
      {...rest}
      className={kitClass(className, 'ck-table__th', align === 'end' && 'ck-table__th--end')}
    />
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
