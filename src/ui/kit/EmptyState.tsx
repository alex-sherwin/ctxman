import type { ReactNode } from 'react';
import { cx } from './utils.ts';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Left-aligned, tighter: for the body of a panel instead of a whole pane. */
  compact?: boolean;
}

export function EmptyState({ title, children, action, compact }: EmptyStateProps) {
  return (
    <div className={cx('ck-empty', compact && 'ck-empty--compact')}>
      <div className="ck-empty__title">{title}</div>
      {children != null && <div>{children}</div>}
      {action}
    </div>
  );
}
