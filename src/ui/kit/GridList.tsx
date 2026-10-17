import {
  GridList as AriaGridList,
  GridListItem as AriaGridListItem,
  type GridListItemProps,
  type GridListProps as AriaGridListProps,
} from 'react-aria-components';
import { kitClass } from './utils.ts';

export interface GridListProps<T> extends AriaGridListProps<T> {
  /** Shown when the list has no items. */
  emptyText?: string;
}

export function GridList<T extends object>({
  emptyText,
  renderEmptyState,
  className,
  ...rest
}: GridListProps<T>) {
  return (
    <AriaGridList
      {...rest}
      renderEmptyState={
        renderEmptyState ??
        (emptyText ? () => <div className="ck-gridlist__empty">{emptyText}</div> : undefined)
      }
      className={kitClass(className, 'ck-gridlist')}
    />
  );
}

export function GridListItem<T extends object>({ className, ...rest }: GridListItemProps<T>) {
  return <AriaGridListItem {...rest} className={kitClass(className, 'ck-gridlist__item')} />;
}
