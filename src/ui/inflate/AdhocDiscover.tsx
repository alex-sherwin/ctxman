// "Add items" part of the Sources pane (INFLATE_SPEC §9.3): find any linkable entry and add it to the
// recipe as an ad hoc item. Same approach as the Forge Discover pane: rows come from the shared
// `$entries` cache and are filtered client-side with `filterEntries`.
import { useStore } from '@nanostores/react';
import type { Key } from 'react-aria-components';
import { LINKABLE_DATASETS, datasetDef } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { filterEntries } from '../../lib/entry-filter.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { $entries, ensureEntries } from '../../stores/entries.ts';
import type { EntriesState } from '../../stores/entries.ts';
import { $inflateUrl, $working, addItem, setDataset, setQuery } from '../../stores/inflate.ts';
import {
  Badge,
  Button,
  ButtonLink,
  GridList,
  GridListItem,
  SearchField,
  StateBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../kit/index.ts';

/** Rows rendered per dataset; the filter narrows the rest. */
const RESULT_CAP = 200;

const keyOf = (e: { dataset: string; slug: string }): string => `${e.dataset}/${e.slug}`;

interface RowProps {
  /** RAC infers the item id from this prop (the entries have no `id`/`key`): see useCachedChildren. */
  id: string;
  entry: EntrySummary;
  added: boolean;
}

function ResultRow({ id, entry, added }: RowProps) {
  const title = entry.title ?? entry.name;
  return (
    <GridListItem
      id={id}
      textValue={title}
      className="cx-discover__item"
      data-testid="inflate-result"
      data-slug={entry.slug}
      data-added={added || undefined}
    >
      <div className="cx-discover__main">
        <div className="cx-row cx-discover__line">
          <span className="cx-discover__title cx-truncate">{title}</span>
          <code className="cx-discover__slug">{entry.slug}</code>
          {entry.refType && <Badge tone="muted">{entry.refType}</Badge>}
          {entry.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
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

function ResultsPanel({ dataset }: { dataset: LinkableDatasetId }) {
  const url = useStore($inflateUrl);
  const entries = useStore($entries, { keys: [dataset] });
  const working = useStore($working);
  const def = datasetDef(dataset);

  const state = entries[dataset];
  const all = state?.entries ?? [];
  const matched = filterEntries(all, { q: url.q, sort: 'modified' });
  const items = matched.slice(0, RESULT_CAP);
  const added = new Set((working?.items ?? []).map(keyOf));
  const status = state?.status ?? 'loading';

  const onAdd = (key: Key) => {
    const k = String(key);
    if (added.has(k)) return;
    const entry = items.find((e) => keyOf(e) === k);
    if (entry !== undefined) addItem(dataset, entry.slug);
  };

  const emptyText =
    status === 'loading'
      ? 'Loading…'
      : all.length === 0
        ? `No ${def.plural} yet.`
        : 'No entries match this filter.';

  return (
    <>
      <div className="cx-forge__toolbar">
        <SearchField
          aria-label={`Filter ${def.plural}`}
          value={url.q}
          onChange={setQuery}
          size="sm"
          inputTestId="inflate-filter-q"
          placeholder="Filter…"
        />
        <div className="cx-forge__count" role="status" data-testid="inflate-result-count">
          {matched.length} of {all.length}
          {matched.length > RESULT_CAP &&
            ` · Showing ${RESULT_CAP} of ${matched.length} — refine the filter.`}
        </div>
      </div>
      <GridList
        aria-label={`${def.label} results`}
        items={items}
        dependencies={[added]}
        onAction={onAdd}
        emptyText={emptyText}
        renderEmptyState={
          status === 'error'
            ? () => (
                <div className="ck-gridlist__empty cx-discover__error" role="alert">
                  <span>Couldn't load entries.</span>
                  <Button size="sm" onPress={() => ensureEntries(dataset)}>
                    Retry
                  </Button>
                </div>
              )
            : undefined
        }
        data-testid="inflate-results"
        className="cx-discover cx-adhoc__results"
      >
        {(entry) => <ResultRow id={keyOf(entry)} entry={entry} added={added.has(keyOf(entry))} />}
      </GridList>
    </>
  );
}

/** Tab count: `null` (dimmed ellipsis) while the first load is in flight, nothing after an error. */
function tabCount(state: EntriesState | undefined): number | null | undefined {
  if (state === undefined || (state.status === 'loading' && state.entries.length === 0))
    return null;
  return state.status === 'error' ? undefined : state.entries.length;
}

export function AdhocDiscover() {
  const url = useStore($inflateUrl);
  const entries = useStore($entries);
  return (
    <div className="cx-adhoc">
      <h3 className="cx-label">Add items</h3>
      <Tabs
        selectedKey={url.dataset}
        onSelectionChange={(key) => setDataset(String(key) as LinkableDatasetId)}
        className="cx-adhoc__tabs"
      >
        <TabList aria-label="Datasets" className="cx-forge__tablist">
          {LINKABLE_DATASETS.map((id) => {
            const state = entries[id];
            return (
              <Tab
                key={id}
                id={id}
                dataset={id}
                count={tabCount(state)}
                data-testid={`inflate-tab-${id}`}
              >
                {datasetDef(id).navLabel}
              </Tab>
            );
          })}
        </TabList>
        {LINKABLE_DATASETS.map((id) => (
          <TabPanel key={id} id={id}>
            <ResultsPanel dataset={id} />
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}
