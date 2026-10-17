import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="ck-empty">
      <div className="ck-empty__title">{title}</div>
      {children != null && <div>{children}</div>}
      {action}
    </div>
  );
}
