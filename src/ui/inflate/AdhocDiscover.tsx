// "Add items" part of the Sources pane (INFLATE_SPEC §9.3, ROUND3_SPEC §E.8): find any linkable entry (or search
// all datasets at once, the "All" tab) and add it to the recipe as an ad hoc item. Same approach as the Forge
// Discover pane: rows come from the shared `$entries` cache and are filtered client-side (`$adhoc`).
import { useStore } from '@nanostores/react';
import type { Key } from 'react-aria-components';
import { LINKABLE_DATASETS, datasetDef } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { isDiscoverDataset } from '../../lib/url-state.ts';
import type { DiscoverDataset } from '../../lib/url-state.ts';
import { discoverTabCount } from '../../stores/discover.ts';
import { $entries, ensureAllEntries, ensureEntries } from '../../stores/entries.ts';
import {
  $adhoc,
  $inflateUrl,
  $working,
  ADHOC_CAP,
  addItem,
  setDataset,
  setQuery,
} from '../../stores/inflate.ts';
import {
  Badge,
  Button,
  ButtonLink,
  DatasetBadge,
  GridList,
  GridListItem,
  SearchField,
  StateBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../kit/index.ts';
import { invalidTitle } from '../forge/link-label.ts';

const keyOf = (e: { dataset: string; slug: string }): string => `${e.dataset}/${e.slug}`;

interface RowProps {
  /** RAC infers the item id from this prop (the entries have no `id`/`key`): see useCachedChildren. */
  id: string;
  entry: EntrySummary;
  added: boolean;
  /** The "All" tab: the dataset is not implied by the tab, so the row says it. */
  showDataset: boolean;
}

function ResultRow({ id, entry, added, showDataset }: RowProps) {
  const title = entry.title ?? entry.name;
  return (
    <GridListItem
      id={id}
      textValue={title}
      className="cx-discover__item"
      data-testid="inflate-result"
      data-slug={entry.slug}
      data-dataset={entry.dataset}
      data-added={added || undefined}
      data-invalid={entry.invalid ? '' : undefined}
    >
      <div className="cx-discover__main">
        <div className="cx-row cx-discover__line">
          <span className="cx-discover__title cx-truncate">{title}</span>
          <code className="cx-discover__slug">{entry.slug}</code>
          {showDataset && <DatasetBadge dataset={entry.dataset} />}
          {entry.refType && <Badge tone="muted">{entry.refType}</Badge>}
          {entry.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
          {entry.invalid && (
            <span data-testid="inflate-invalid">
              <Badge tone="danger" title={invalidTitle(entry)}>
                invalid
              </Badge>
            </span>
          )}
          {entry.stale && <Badge tone="warn">stale</Badge>}
        </div>
        <p className="cx-discover__desc cx-truncate">{entry.description}</p>
      </div>
      <div className="cx-discover__actions">
        <ButtonLink
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label={`Open ${title} in a new tab`}
        >
          ↗
        </ButtonLink>
        <Button
          size="sm"
          variant={added ? 'ghost' : 'secondary'}
          isDisabled={added}
          onPress={() => addItem(entry.dataset as LinkableDatasetId, entry.slug)}
          aria-label={added ? `${title} already added` : `Add ${title} to the recipe`}
          data-testid="inflate-add"
        >
          {added ? '✓ Added' : '+ Add'}
        </Button>
      </div>
    </GridListItem>
  );
}

function ResultsPanel({ dataset }: { dataset: DiscoverDataset }) {
  const url = useStore($inflateUrl);
  const view = useStore($adhoc);
  const working = useStore($working);
  const isAll = dataset === 'all';
  const def = isAll ? null : datasetDef(dataset);
  const plural = def?.plural ?? 'entries';

  const added = new Set((working?.items ?? []).map(keyOf));

  const onAdd = (key: Key) => {
    const k = String(key);
    if (added.has(k)) return;
    const entry = view.items.find((e) => keyOf(e) === k);
    if (entry !== undefined) addItem(entry.dataset as LinkableDatasetId, entry.slug);
  };

  const emptyText =
    view.status === 'loading'
      ? 'Loading…'
      : view.total === 0
        ? `No ${plural} yet.`
        : 'No entries match this filter.';

  return (
    <>
      <div className="cx-forge__toolbar">
        <SearchField
          aria-label={`Filter ${plural}`}
          value={url.q}
          onChange={setQuery}
          size="sm"
          inputTestId="inflate-filter-q"
          placeholder="Filter…"
        />
        <div className="cx-forge__count" role="status" data-testid="inflate-result-count">
          {view.matched} of {view.total}
          {view.matched > ADHOC_CAP &&
            ` · Showing ${ADHOC_CAP} of ${view.matched} — refine the filter.`}
        </div>
      </div>
      {isAll && view.status === 'error' && view.items.length > 0 && (
        <div className="cx-discover__error cx-discover__notice" role="alert">
          <span>{view.error ?? "Couldn't load some entries"}.</span>
          <Button size="sm" onPress={() => ensureAllEntries()}>
            Retry
          </Button>
        </div>
      )}
      <GridList
        aria-label={`${def?.label ?? 'All'} results`}
        items={view.items}
        dependencies={[added, isAll]}
        onAction={onAdd}
        emptyText={emptyText}
        renderEmptyState={
          view.status === 'error'
            ? () => (
                <div className="ck-gridlist__empty cx-discover__error" role="alert">
                  <span>Couldn't load entries.</span>
                  <Button
                    size="sm"
                    onPress={() => (isAll ? ensureAllEntries() : ensureEntries(dataset))}
                  >
                    Retry
                  </Button>
                </div>
              )
            : undefined
        }
        data-testid="inflate-results"
        className="cx-discover cx-adhoc__results"
      >
        {(entry) => (
          <ResultRow
            id={keyOf(entry)}
            entry={entry}
            added={added.has(keyOf(entry))}
            showDataset={isAll}
          />
        )}
      </GridList>
    </>
  );
}

export function AdhocDiscover() {
  const url = useStore($inflateUrl);
  const entries = useStore($entries);
  return (
    <div className="cx-adhoc">
      <h3 className="cx-label">Add items</h3>
      <Tabs
        selectedKey={url.dataset}
        onSelectionChange={(key) => {
          const next = String(key);
          if (isDiscoverDataset(next)) setDataset(next);
        }}
        className="cx-adhoc__tabs"
      >
        <TabList aria-label="Datasets" className="cx-forge__tablist">
          <Tab id="all" count={discoverTabCount(entries, 'all')} data-testid="inflate-tab-all">
            All
          </Tab>
          {LINKABLE_DATASETS.map((id) => (
            <Tab
              key={id}
              id={id}
              dataset={id}
              count={discoverTabCount(entries, id)}
              data-testid={`inflate-tab-${id}`}
            >
              {datasetDef(id).navLabel}
            </Tab>
          ))}
        </TabList>
        <TabPanel id="all">
          <ResultsPanel dataset="all" />
        </TabPanel>
        {LINKABLE_DATASETS.map((id) => (
          <TabPanel key={id} id={id}>
            <ResultsPanel dataset={id} />
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
