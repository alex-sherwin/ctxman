import type { ReactNode } from 'react';
import { cx } from './utils.ts';

export type StatusKind =
  | 'idle'
  | 'loading'
  | 'busy'
  | 'saving'
  | 'dirty'
  | 'ready'
  | 'saved'
  | 'ok'
  | 'done'
  | 'error'
  | 'conflict'
  | 'blocked'
  | 'lost';

export interface StatusProps {
  kind: StatusKind;
  children: ReactNode;
  testId?: string;
  /** Placement / size classes of the owner; the colour comes from `kind`. */
  className?: string;
  /** Default 'status'. */
  role?: 'status' | 'alert';
  /** `data-*` only. */
  attrs?: Record<`data-${string}`, string | undefined>;
}

/** An inline status line (`span.ck-status[data-kind]`). SSR twin: the same class on any element. */
export function Status({ kind, children, testId, className, role = 'status', attrs }: StatusProps) {
  return (
    <span
      className={cx('ck-status', className)}
      role={role}
      data-kind={kind}
      data-testid={testId}
      {...attrs}
    >
      {children}
    </span>
  );
}

export interface ErrorTextProps {
  children: ReactNode;
  testId?: string;
  className?: string;
  /** Default 'p'. */
  as?: 'p' | 'ul' | 'div';
  /** Default 'alert'; 'none' for a list that is not an announcement. */
  role?: 'alert' | 'status' | 'none';
}

/** Inline error text (`.ck-error`). Add `ck-error--row` through `className` for a message with a Retry button. */
export function ErrorText({
  children,
  testId,
  className,
  as = 'p',
  role = 'alert',
}: ErrorTextProps) {
  const As = as;
  return (
    <As
      className={cx('ck-error', className)}
      role={role === 'none' ? undefined : role}
      data-testid={testId}
    >
      {children}
    </As>
  );
}
