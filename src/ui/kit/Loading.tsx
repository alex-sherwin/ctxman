import { cx } from './utils.ts';

export interface LoadingProps {
  /** Default 'Loading…'. */
  label?: string;
  testId?: string;
  className?: string;
}

/** Centered spinner + label for a pane that is still loading. The spinner is decorative; the wrapper is the live region. */
export function Loading({ label = 'Loading…', testId, className }: LoadingProps) {
  return (
    <div className={cx('ck-loading', className)} role="status" data-testid={testId}>
      <span className="ck-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
