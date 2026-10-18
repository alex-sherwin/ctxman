import type { ReactNode } from 'react';
import { getDataset, stateGroup as groupOf, stateLabel } from '../../datasets/registry.ts';
import type { DatasetId, StateGroup } from '../../datasets/registry.ts';
import { cx } from './utils.ts';

export interface BadgeProps {
  children: ReactNode;
  /** Default 'neutral'. 'tag' renders the mono `#tag` look. */
  tone?: 'neutral' | 'info' | 'success' | 'warn' | 'danger' | 'muted' | 'tag';
  dataset?: DatasetId;
  stateGroup?: StateGroup;
  /** The raw state id, emitted as `data-state`. */
  state?: string;
  mono?: boolean;
  title?: string;
  className?: string;
}

/** Plain `<span class="ck-badge">`. Astro twins emit the same markup. */
export function Badge({
  children,
  tone = 'neutral',
  dataset,
  stateGroup,
  state,
  mono,
  title,
  className,
}: BadgeProps) {
  return (
    <span
      className={cx(
        'ck-badge',
        dataset && 'ck-badge--ds',
        stateGroup && 'ck-badge--state',
        tone !== 'neutral' && `ck-badge--${tone}`,
        mono && 'ck-badge--mono',
        className,
      )}
      data-ds={dataset}
      data-state-group={stateGroup}
      data-state={state}
      title={title}
    >
      {stateGroup && <span className="ck-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Dataset id in mono with the dataset's color. */
export function DatasetBadge({ dataset }: { dataset: DatasetId }) {
  return (
    <Badge dataset={dataset} mono>
      {dataset}
    </Badge>
  );
}

/** Lifecycle state: registry label, group-colored pill with a shape cue. */
export function StateBadge({ dataset, state }: { dataset: DatasetId; state: string }) {
  const label =
    getDataset(dataset)?.states?.find((s) => s.id === state)?.label ?? stateLabel(state);
  return (
    <Badge stateGroup={groupOf(dataset, state)} state={state}>
      {label}
    </Badge>
  );
}
