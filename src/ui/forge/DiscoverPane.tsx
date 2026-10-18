// Left pane of the Forge: find entries in any linkable dataset (or in all of them, the "All" tab) and add them to
// the working context (UI_SPEC §H.4, ROUND3_SPEC §E.8). Rows come from the shared entries cache, filtered
// client-side. A row whose entry has `child` relations (a project) can be added together with its children.
import { useStore } from '@nanostores/react';
import { flushSync } from 'react-dom';
import type { Key } from 'react-aria-components';
import { LINKABLE_DATASETS, datasetDef } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import { isDiscoverDataset } from '../../lib/url-state.ts';
import type { DiscoverDataset } from '../../lib/url-state.ts';
import { discoverTabCount } from '../../stores/discover.ts';
import { $entries, ensureAllEntries, ensureEntries } from '../../stores/entries.ts';
import {
  $discover,
  $forgeUrl,
  $linkedKeys,
  $working,
  $yamlInvalid,
  DISCOVER_CAP,
  addLink,
  addLinks,
  addableChildren,
  linkKey,
  parseLinkKey,
  setDataset,
  setQuery,
  setStates,
  setTags,
} from '../../stores/forge.ts';
import {
  Button,
  ButtonLink,
  Chip,
  ChipGroup,
  Disclosure,
  ErrorText,
  GridList,
  Icon,
  Notice,
  SearchField,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from '../kit/index.ts';
import { EntryRow } from '../pickers/EntryRow.tsx';

/** Tag chips shown inline; the rest go into "More tags". */
const VISIBLE_TAGS = 16;

function DiscoverPanel({ dataset }: { dataset: DiscoverDataset }) {
  const url = useStore($forgeUrl);
  const view = useStore($discover);
  const entries = useStore($entries);
  const linked = useStore($linkedKeys);
  const working = useStore($working);
  const yamlInvalid = useStore($yamlInvalid);
  const isAll = dataset === 'all';
  const def = isAll ? null : datasetDef(dataset);
  const plural = def?.plural ?? 'entries';

  const canAdd = working !== null && !yamlInvalid;
  // "All" mixes lifecycles that share no state ids: no state chips there
  const states = def?.states;

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
        ? `No ${plural} yet.`
        : 'No entries match these filters.';

  return (
    <>
      <div className="cx-forge__toolbar">
        <SearchField
          aria-label={`Filter ${plural}`}
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
          <Disclosure title={`More tags (${moreTags.length})`}>
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
        <Notice tone="info" testId="forge-add-hint" className="cx-discover__hint">
          Select or create a context to add items.
        </Notice>
      ) : (
        yamlInvalid && (
          <Notice tone="info" testId="forge-add-hint" className="cx-discover__hint">
            Fix YAML errors first.
          </Notice>
        )
      )}
      {isAll && view.status === 'error' && view.items.length > 0 && (
        <ErrorText as="div" className="ck-error--row cx-discover__notice">
          <span>{view.error ?? "Couldn't load some entries"}.</span>
          <Button size="sm" onPress={() => ensureAllEntries()}>
            Retry
          </Button>
        </ErrorText>
      )}
      <GridList
        aria-label={`${def?.label ?? 'All'} results`}
        items={view.items}
        dependencies={[linked, canAdd, entries, isAll]}
        onAction={onAdd}
        emptyText={emptyText}
        renderEmptyState={
          view.status === 'error'
            ? () => (
                <ErrorText as="div" className="ck-gridlist__empty ck-error--row">
                  <span>Couldn't load entries.</span>
                  <Button
                    size="sm"
                    onPress={() => (isAll ? ensureAllEntries() : ensureEntries(dataset))}
                  >
                    Retry
                  </Button>
                </ErrorText>
              )
            : undefined
        }
        data-testid="forge-results"
        className="cx-discover"
      >
        {(entry) => {
          const key = linkKey(entry);
          const added = linked.has(key);
          const addable = addableChildren(entry, entries, linked);
          const title = entry.title ?? entry.name;
          const n = addable.length;
          const kids = `${n} ${n === 1 ? 'child' : 'children'}`;
          const addDisabled = !canAdd;
          return (
            <EntryRow
              id={key}
              entry={entry}
              testId="forge-result"
              showDataset={isAll}
              tags={3}
              showInvalid
              invalidTestId="forge-invalid"
              attrs={{
                'data-slug': entry.slug,
                'data-dataset': entry.dataset,
                'data-added': added ? 'true' : undefined,
                'data-invalid': entry.invalid ? '' : undefined,
              }}
              actions={
                <>
                  <ButtonLink
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={`Open ${title} in a new tab`}
                  >
                    <Icon name="external" size={13} />
                  </ButtonLink>
                  {n > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      isDisabled={addDisabled}
                      onPress={() =>
                        addLinks([
                          { dataset: entry.dataset as LinkableDatasetId, slug: entry.slug },
                          ...addable,
                        ])
                      }
                      aria-label={
                        added ? `Add the ${kids} of ${title}` : `Add ${title} with ${kids}`
                      }
                      data-testid="forge-add-children"
                    >
                      {added ? `+ Add ${kids}` : `+ Add with ${kids}`}
                    </Button>
                  )}
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
                </>
              }
            />
          );
        }}
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
        <h2 id="forge-discover-h" className="cx-forge__pane-title ck-label">
          Discover
        </h2>
      </header>
      <Tabs
        selectedKey={url.dataset}
        onSelectionChange={(key) => {
          const next = String(key);
          if (isDiscoverDataset(next)) setDataset(next);
        }}
        className="cx-forge__tabs"
      >
        <TabList aria-label="Datasets" className="cx-forge__tablist">
          <Tab id="all" count={discoverTabCount(entries, 'all')} data-testid="forge-tab-all">
            All
          </Tab>
          {LINKABLE_DATASETS.map((id) => (
            <Tab
              key={id}
              id={id}
              dataset={id}
              count={discoverTabCount(entries, id)}
              data-testid={`forge-tab-${id}`}
            >
              {datasetDef(id).navLabel}
            </Tab>
          ))}
        </TabList>
        <TabPanel id="all">
          <DiscoverPanel dataset="all" />
        </TabPanel>
        {LINKABLE_DATASETS.map((id) => (
          <TabPanel key={id} id={id}>
            <DiscoverPanel dataset={id} />
          </TabPanel>
        ))}
      </Tabs>
    </section>
  );
}
