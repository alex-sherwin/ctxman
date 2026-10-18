import type { ReactNode } from 'react';
import { cx } from './utils.ts';

export type NoticeTone = 'info' | 'warn' | 'danger';

export interface NoticeProps {
  /** Default 'info'. */
  tone?: NoticeTone;
  /** 'row' = text left, `actions` right, one line. Default 'block'. */
  layout?: 'block' | 'row';
  actions?: ReactNode;
  /** Default 'status'; 'alert' only for conflicts / blocking problems; 'none' for lists that are not announcements. */
  role?: 'status' | 'alert' | 'none';
  children: ReactNode;
  testId?: string;
  className?: string;
  /** `data-*` only (e.g. `data-stale`). */
  attrs?: Record<`data-${string}`, string | undefined>;
}

/** A banner: tinted background and a left accent bar (`.ck-notice[data-tone]`). */
export function Notice({
  tone = 'info',
  layout = 'block',
  actions,
  role = 'status',
  children,
  testId,
  className,
  attrs,
}: NoticeProps) {
  return (
    <div
      className={cx('ck-notice', layout === 'row' && 'ck-notice--row', className)}
      data-tone={tone}
      role={role === 'none' ? undefined : role}
      data-testid={testId}
      {...attrs}
    >
      {layout === 'row' ? <span className="ck-notice__text">{children}</span> : children}
      {actions != null && <span className="ck-notice__actions">{actions}</span>}
    </div>
  );
}
