// One row of an entry list in a GridList: "title · slug · badges" over the description, with right-hand actions.
// Shared by the EntryPicker, the Forge Discover pane and the Inflate ad hoc Discover pane. Browser-only; kit parts
// imported by file. Badge order: dataset, [refType], state, invalid, stale, tags.
import type { ReactNode } from 'react';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { Badge, DatasetBadge, StateBadge } from '../kit/Badge.tsx';
import { GridListItem } from '../kit/GridList.tsx';
import { cx } from '../kit/utils.ts';
import { invalidTitle } from './picker-rows.ts';

export interface EntryRowProps {
  /** The RAC item id (the caller's key: `ds/slug` or `ds:slug`). */
  id: string;
  entry: EntrySummary;
  /** `data-testid` of the row. */
  testId: string;
  /** A DatasetBadge after the slug (the All tab, the picker). */
  showDataset?: boolean;
  /** The first n tags as tag badges (Forge rows: 3). Default 0. */
  tags?: number;
  /** A muted refType badge (Inflate rows). */
  showRefType?: boolean;
  /** A danger "invalid" badge with `invalidTitle(entry)` as its title. */
  showInvalid?: boolean;
  /** Wraps the invalid badge in `<span data-testid>` (forge-invalid / inflate-invalid). */
  invalidTestId?: string;
  isDisabled?: boolean;
  /** `data-*` only: data-slug, data-dataset, data-added, data-invalid, data-key. */
  attrs?: Record<`data-${string}`, string | undefined>;
  /** Right-hand controls. */
  actions: ReactNode;
  className?: string;
}

export function EntryRow({
  id,
  entry,
  testId,
  showDataset,
  tags = 0,
  showRefType,
  showInvalid,
  invalidTestId,
  isDisabled,
  attrs,
  actions,
  className,
}: EntryRowProps) {
  const title = entry.title ?? entry.name;
  const invalidBadge = (
    <Badge tone="danger" title={invalidTitle(entry)}>
      invalid
    </Badge>
  );
  return (
    <GridListItem
      id={id}
      textValue={title}
      isDisabled={isDisabled}
      className={cx('ck-entryrow', className)}
      data-testid={testId}
      {...attrs}
    >
      <div className="ck-entryrow__main">
        <div className="ck-entryline">
          <span className="ck-entryline__title cx-truncate">{title}</span>
          <code className="ck-entryline__slug">{entry.slug}</code>
          {showDataset && <DatasetBadge dataset={entry.dataset} />}
          {showRefType && entry.refType && <Badge tone="muted">{entry.refType}</Badge>}
          {entry.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
          {showInvalid &&
            entry.invalid &&
            (invalidTestId ? (
              <span data-testid={invalidTestId}>{invalidBadge}</span>
            ) : (
              invalidBadge
            ))}
          {entry.stale && <Badge tone="warn">stale</Badge>}
          {entry.tags.slice(0, tags).map((t) => (
            <Badge key={t} tone="tag">
              {t}
            </Badge>
          ))}
        </div>
        <p className="ck-entryline__desc cx-truncate">{entry.description}</p>
      </div>
      <div className="ck-entryrow__actions">{actions}</div>
    </GridListItem>
  );
}
