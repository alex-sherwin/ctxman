// Shared "choose an entry" dialog (ROUND3_SPEC §E.6): Insert link in the editors, Add child / Add relation in the
// detail tools. The Discover-pane row pattern (src/ui/forge/DiscoverPane.tsx) in a Modal: search, dataset
// chips, rows with dataset / state badges, Enter or the row button picks. Entries come from the shared entries
// cache (`$entries`), loaded on open. Browser-only; Monaco-free, kit parts imported by file.
import { useStore } from '@nanostores/react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { LINKABLE_DATASETS, datasetDef } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { $entries, ensureAllEntries } from '../../stores/entries.ts';
import { Badge, DatasetBadge, StateBadge } from '../kit/Badge.tsx';
import { Button } from '../kit/Button.tsx';
import { Chip, ChipGroup } from '../kit/Chip.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { SearchField } from '../kit/Field.tsx';
import { GridList, GridListItem } from '../kit/GridList.tsx';
import { pickerKey, pickerRows } from './picker-rows.ts';

export interface EntryPickerProps {
  isOpen: boolean;
  /** Dialog heading: 'Insert link to entry', 'Add child', 'Link to entry'. */
  title: string;
  /** Default `LINKABLE_DATASETS`. More than one adds an 'All' chip, first and selected. */
  datasets?: readonly LinkableDatasetId[];
  /** `'ds/slug'` keys: the row is disabled and its button reads "added". */
  exclude?: ReadonlySet<string>;
  /** Row button label. Default 'Insert'. */
  actionLabel?: string;
  /** Rendered above the list (e.g. a relation Select). */
  extra?: ReactNode;
  /** Enter, a row click or the row button. The caller closes the dialog. */
  onPick(entry: EntrySummary): void;
  onClose(): void;
  /** Prefix of every test id (`<id>-search`, `-ds-<id|all>`, `-row`, `-pick`, `-cancel`). Default 'link-picker'. */
  testId?: string;
}

type PickerDataset = LinkableDatasetId | 'all';

const NO_EXCLUDE: ReadonlySet<string> = new Set();

interface BodyProps extends Omit<EntryPickerProps, 'isOpen' | 'testId'> {
  testId: string;
}

/** Mounted only while the dialog is open, so the search text and the chip reset on every open. */
function PickerDialog({
  title,
  datasets = LINKABLE_DATASETS,
  exclude = NO_EXCLUDE,
  actionLabel = 'Insert',
  extra,
  onPick,
  onClose,
  testId,
}: BodyProps) {
  const states = useStore($entries);
  const [q, setQ] = useState('');
  const [dataset, setDataset] = useState<PickerDataset>(
    datasets.length > 1 ? 'all' : (datasets[0] ?? 'all'),
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureAllEntries(datasets);
  }, [datasets]);

  const active: readonly LinkableDatasetId[] = dataset === 'all' ? datasets : [dataset];
  const pool = active.flatMap((ds) => states[ds]?.entries ?? []);
  const { rows, matched } = pickerRows(pool, q);
  const loading = active.some((ds) => {
    const s = states[ds];
    return s === undefined || (s.status === 'loading' && s.entries.length === 0);
  });
  const failed = active.filter((ds) => states[ds]?.status === 'error');

  const pickable = (e: EntrySummary) => !exclude.has(pickerKey(e));
  const pick = (e: EntrySummary) => {
    if (pickable(e)) onPick(e);
  };

  const countOf = (ds: LinkableDatasetId): number | undefined => {
    const s = states[ds];
    return s?.status === 'ready' ? s.entries.length : undefined;
  };
  const allCounts = datasets.map(countOf);
  const allCount = allCounts.every((n) => n !== undefined)
    ? allCounts.reduce<number>((sum, n) => sum + (n ?? 0), 0)
    : undefined;

  const emptyText = loading
    ? 'Loading…'
    : pool.length === 0
      ? 'Nothing to pick yet.'
      : 'No entries match this filter.';

  return (
    <Dialog
      title={title}
      bodyClassName="cx-picker__body"
      footer={
        <Button variant="secondary" onPress={onClose} data-testid={`${testId}-cancel`}>
          Cancel
        </Button>
      }
    >
      {extra}
      <div className="cx-picker__toolbar">
        <SearchField
          aria-label="Filter entries"
          value={q}
          onChange={setQ}
          onSubmit={() => {
            const first = rows.find(pickable);
            if (first) onPick(first);
          }}
          onKeyDown={(e) => {
            // react-aria stops every key that a custom onKeyDown does not release: Esc must still close the dialog
            e.continuePropagation();
            if (e.key !== 'ArrowDown') return;
            const first = listRef.current?.querySelector<HTMLElement>(
              '[role="row"]:not([aria-disabled="true"])',
            );
            if (!first) return;
            e.preventDefault();
            first.focus();
          }}
          autoFocus
          size="sm"
          placeholder="Filter by title, name, description or tag…"
          inputTestId={`${testId}-search`}
        />
        {datasets.length > 1 && (
          <ChipGroup
            label="Dataset"
            selectionMode="single"
            disallowEmptySelection
            selectedKeys={[dataset]}
            onSelectionChange={(keys) => {
              const key = [...keys][0];
              if (key !== undefined) setDataset(String(key) as PickerDataset);
            }}
            data-testid={`${testId}-datasets`}
          >
            <Chip id="all" count={allCount} data-testid={`${testId}-ds-all`}>
              All
            </Chip>
            {datasets.map((ds) => (
              <Chip
                key={ds}
                id={ds}
                dataset={ds}
                count={countOf(ds)}
                data-testid={`${testId}-ds-${ds}`}
              >
                {datasetDef(ds).navLabel}
              </Chip>
            ))}
          </ChipGroup>
        )}
        <div className="cx-forge__count" role="status" data-testid={`${testId}-count`}>
          {loading
            ? 'Loading…'
            : matched > rows.length
              ? `Showing ${rows.length} of ${matched} — refine the filter`
              : `${matched} ${matched === 1 ? 'entry' : 'entries'}`}
        </div>
      </div>
      {failed.length > 0 && (
        <div className="cx-picker__error" role="alert">
          <span>Couldn't load {failed.map((ds) => datasetDef(ds).plural).join(', ')}.</span>
          <Button size="sm" onPress={() => ensureAllEntries(failed)}>
            Retry
          </Button>
        </div>
      )}
      <div className="cx-picker__list" ref={listRef}>
        <GridList
          aria-label="Entries"
          onAction={(key) => {
            const hit = rows.find((e) => pickerKey(e) === String(key));
            if (hit) pick(hit);
          }}
          emptyText={emptyText}
          data-testid={`${testId}-results`}
        >
          {rows.map((entry) => {
            const key = pickerKey(entry);
            const label = entry.title ?? entry.name;
            const excluded = !pickable(entry);
            return (
              <GridListItem
                key={key}
                id={key}
                textValue={label}
                isDisabled={excluded}
                className="cx-discover__item cx-picker__item"
                data-testid={`${testId}-row`}
                data-key={key}
              >
                <div className="cx-discover__main">
                  <div className="cx-row cx-discover__line">
                    <span className="cx-discover__title cx-truncate">{label}</span>
                    <code className="cx-discover__slug">{entry.slug}</code>
                    <DatasetBadge dataset={entry.dataset} />
                    {entry.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
                    {entry.stale && <Badge tone="warn">stale</Badge>}
                  </div>
                  <p className="cx-discover__desc cx-truncate">{entry.description}</p>
                </div>
                <div className="cx-discover__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={excluded}
                    onPress={() => pick(entry)}
                    aria-label={excluded ? `${label} already added` : `${actionLabel} ${label}`}
                    data-testid={`${testId}-pick`}
                  >
                    {excluded ? 'added' : actionLabel}
                  </Button>
                </div>
              </GridListItem>
            );
          })}
        </GridList>
      </div>
    </Dialog>
  );
}

export function EntryPicker({
  isOpen,
  onClose,
  testId = 'link-picker',
  ...rest
}: EntryPickerProps) {
  return (
    <Modal
      isOpen={isOpen}
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="cx-picker"
      testId={testId}
    >
      <PickerDialog {...rest} onClose={onClose} testId={testId} />
    </Modal>
  );
}
