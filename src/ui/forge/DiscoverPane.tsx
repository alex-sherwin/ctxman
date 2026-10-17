// Left pane of the Forge: find entries in any linkable dataset and add them to the working context
// (UI_SPEC §H.4). Rows come from the shared entries cache, filtered client-side.
import { useStore } from '@nanostores/react';
import { flushSync } from 'react-dom';
import type { Key } from 'react-aria-components';
import { LINKABLE_DATASETS, datasetDef } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import type { EntrySummary } from '../../lib/entry-summary.ts';
import { $entries, ensureEntries } from '../../stores/entries.ts';
import {
  $discover,
  $forgeUrl,
  $linkedKeys,
  $working,
  $yamlInvalid,
  DISCOVER_CAP,
  addLink,
  linkKey,
  parseLinkKey,
  setDataset,
  setQuery,
  setStates,
  setTags,
} from '../../stores/forge.ts';
import {
  Badge,
  Button,
  ButtonLink,
  Chip,
  ChipGroup,
  Disclosure,
  GridList,
  GridListItem,
  SearchField,
  StateBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../kit/index.ts';

/** Tag chips shown inline; the rest go into "More tags". */
const VISIBLE_TAGS = 16;

interface RowProps {
  /** RAC infers the item id from this prop (the entries have no `id`/`key`): see useCachedChildren. */
  id: string;
  entry: EntrySummary;
  added: boolean;
  addDisabled: boolean;
}

function DiscoverRow({ id, entry, added, addDisabled }: RowProps) {
  const title = entry.title ?? entry.name;
  return (
    <GridListItem
      id={id}
      textValue={title}
      className="cx-discover__item"
      data-testid="forge-result"
      data-slug={entry.slug}
      data-added={added || undefined}
    >
      <div className="cx-discover__main">
        <div className="cx-row cx-discover__line">
          <span className="cx-discover__title cx-truncate">{title}</span>
          <code className="cx-discover__slug">{entry.slug}</code>
          {entry.state && <StateBadge dataset={entry.dataset} state={entry.state} />}
          {entry.stale && <Badge tone="warn">stale</Badge>}
          {entry.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="tag">
              {tag}
            </Badge>
          ))}
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
          isDisabled={added || addDisabled}
          onPress={() => addLink(entry.dataset as LinkableDatasetId, entry.slug)}
          aria-label={added ? `${title} already added` : `Add ${title} to context`}
          data-testid="forge-add"
        >
          {added ? '✓ Added' : '+ Add'}
        </Button>
      </div>
    </GridListItem>
  );
}

function DiscoverPanel({ dataset }: { dataset: LinkableDatasetId }) {
  const url = useStore($forgeUrl);
  const view = useStore($discover);
  const linked = useStore($linkedKeys);
  const working = useStore($working);
  const yamlInvalid = useStore($yamlInvalid);
  const def = datasetDef(dataset);

  const canAdd = working !== null && !yamlInvalid;
  const states = def.states;

  const selectedTags = new Set(url.tags);
  const inline = view.tagCounts.slice(0, VISIBLE_TAGS);
  const inlineIds = new Set(inline.map((t) => t.tag));
  const extraSelected = url.tags
    .filter((t) => !inlineIds.has(t))
    .map((tag) => ({ tag, count: view.tagCounts.find((c) => c.tag === tag)?.count ?? 0 }));
  const shownTags = [...inline, ...extraSelected];
  const moreTags = view.tagCounts.slice(VISIBLE_TAGS).filter((t) => !selectedTags.has(t.tag));

  /**
   * A tag picked from "More tags" moves up to the inline group: follow it with the focus so a keyboard
   * user does not lose their place when the clicked chip unmounts.
   */
  const onMoreTags = (keys: Set<Key>) => {
    const next = [...keys].map(String);
    const picked = next.find((t) => !url.tags.includes(t));
    flushSync(() => setTags(next));
    if (picked === undefined) return;
    const group = document.querySelector('[data-testid="forge-tag-chips"]');
    for (const chip of group?.children ?? []) {
      if (chip instanceof HTMLElement && chip.dataset.testid === `forge-chip-tag-${picked}`) {
        chip.focus();
      }
    }
  };

  const onAdd = (key: Key) => {
    const k = String(key);
    if (!canAdd || linked.has(k)) return;
    const { dataset: ds, slug } = parseLinkKey(k);
    addLink(ds, slug);
  };

  const emptyText =
    view.status === 'loading'
      ? 'Loading…'
      : view.total === 0
        ? `No ${def.plural} yet.`
        : 'No entries match these filters.';

  return (
    <>
      <div className="cx-forge__toolbar">
        <SearchField
          aria-label={`Filter ${def.plural}`}
          value={url.q}
          onChange={setQuery}
          size="sm"
          inputTestId="forge-filter-q"
          placeholder="Filter…"
        />
        {states && (
          <ChipGroup
            label="State"
            selectedKeys={url.states}
            onSelectionChange={(keys) => setStates([...keys].map(String))}
            data-testid="forge-state-chips"
          >
            {states.map((s) => (
              <Chip
                key={s.id}
                id={s.id}
                count={view.stateCounts[s.id] ?? 0}
                data-testid={`forge-chip-state-${s.id}`}
              >
                {s.label}
              </Chip>
            ))}
          </ChipGroup>
        )}
        {shownTags.length > 0 && (
          <ChipGroup
            label="Tags"
            selectedKeys={url.tags}
            onSelectionChange={(keys) => setTags([...keys].map(String))}
            data-testid="forge-tag-chips"
          >
            {shownTags.map(({ tag, count }) => (
              <Chip key={tag} id={tag} count={count} data-testid={`forge-chip-tag-${tag}`}>
                {tag}
              </Chip>
            ))}
          </ChipGroup>
        )}
        {moreTags.length > 0 && (
          <Disclosure title={`More tags (${moreTags.length})`} headingLevel={3}>
            <ChipGroup label="More tags" selectedKeys={url.tags} onSelectionChange={onMoreTags}>
              {moreTags.map(({ tag, count }) => (
                <Chip key={tag} id={tag} count={count} data-testid={`forge-chip-tag-${tag}`}>
                  {tag}
                </Chip>
              ))}
            </ChipGroup>
          </Disclosure>
        )}
        <div className="cx-forge__count" role="status" data-testid="forge-result-count">
          {view.matched} of {view.total}
          {view.matched > DISCOVER_CAP &&
            ` · Showing ${DISCOVER_CAP} of ${view.matched} — refine the filter.`}
        </div>
      </div>
      {working === null ? (
        <p className="cx-discover__hint" data-testid="forge-add-hint">
          Select or create a context to add items.
        </p>
      ) : (
        yamlInvalid && (
          <p className="cx-discover__hint" data-testid="forge-add-hint">
            Fix YAML errors first.
          </p>
        )
      )}
      <GridList
        aria-label={`${def.label} results`}
        items={view.items}
        dependencies={[linked, canAdd]}
        onAction={onAdd}
        emptyText={emptyText}
        renderEmptyState={
          view.status === 'error'
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
        data-testid="forge-results"
        className="cx-discover"
      >
        {(entry) => (
          <DiscoverRow
            id={linkKey(entry)}
            entry={entry}
            added={linked.has(linkKey(entry))}
            addDisabled={!canAdd}
          />
        )}
      </GridList>
    </>
  );
}

export function DiscoverPane() {
  const url = useStore($forgeUrl);
  const entries = useStore($entries);
  return (
    <section
      className="cx-forge__pane cx-forge__pane--discover"
      aria-labelledby="forge-discover-h"
      data-testid="forge-discover"
    >
      <header className="cx-forge__pane-header">
        <h2 id="forge-discover-h" className="cx-forge__pane-title">
          Discover
        </h2>
      </header>
      <Tabs
        selectedKey={url.dataset}
        onSelectionChange={(key) => setDataset(String(key) as LinkableDatasetId)}
        className="cx-forge__tabs"
      >
        <TabList aria-label="Datasets" className="cx-forge__tablist">
          {LINKABLE_DATASETS.map((id) => {
            const state = entries[id];
            return (
              <Tab
                key={id}
                id={id}
                dataset={id}
                count={state?.status === 'ready' ? state.entries.length : undefined}
                data-testid={`forge-tab-${id}`}
              >
                {datasetDef(id).navLabel}
              </Tab>
            );
          })}
        </TabList>
        {LINKABLE_DATASETS.map((id) => (
          <TabPanel key={id} id={id}>
            <DiscoverPanel dataset={id} />
          </TabPanel>
        ))}
      </Tabs>
    </section>
  );
}
