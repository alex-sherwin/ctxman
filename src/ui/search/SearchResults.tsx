import { useStore } from '@nanostores/react';
import type { FuseResult } from 'fuse.js';
import { getDataset } from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import type { SearchDoc } from '../../lib/entry-summary.ts';
import { keyRanges, matchingTags, pickSnippet } from '../../lib/search-highlight.ts';
import { MIN_QUERY } from '../../lib/search-config.ts';
import {
  $searchDatasets,
  $searchIndex,
  $searchQuery,
  $searchView,
  flushSearchUrl,
  loadSearchIndex,
  setSearchDatasets,
} from '../../stores/search.ts';
// Kit components are imported BY FILE: the kit barrel (index.ts) re-exports the Monaco editor.
import { Badge, DatasetBadge, StateBadge } from '../kit/Badge.tsx';
import { Button, Spinner } from '../kit/Button.tsx';
import { ListBox, ListBoxItem, ListBoxSection } from '../kit/ListBox.tsx';
import { Highlight } from './Highlight.tsx';

function datasetLabels(ids: readonly DatasetId[]): string {
  return ids.map((id) => getDataset(id)?.label ?? id).join(', ');
}

function ResultBody({ hit }: { hit: FuseResult<SearchDoc> }) {
  const doc = hit.item;
  const snippet = pickSnippet(hit);
  const tags = matchingTags(hit);
  const location =
    doc.path === null ? `${doc.dataset}/${doc.slug}` : `${doc.dataset}/${doc.slug}/${doc.path}`;
  return (
    <>
      <div className="cx-search__row">
        <span className="cx-search__title">
          <Highlight text={doc.title || doc.name} ranges={keyRanges(hit, 'title')} />
        </span>
        {doc.state !== undefined && <StateBadge dataset={doc.dataset} state={doc.state} />}
        <code className="cx-search__path">{location}</code>
      </div>
      {snippet.text !== '' && (
        <div className="cx-search__snippet">
          <Highlight text={snippet.text} ranges={snippet.ranges} />
        </div>
      )}
      {tags.length > 0 && (
        <div className="cx-search__tags">
          {tags.map((t) => (
            <Badge key={t.tag} tone="tag">
              <span>
                <Highlight text={t.tag} ranges={t.ranges} />
              </span>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}

/** `renderEmptyState` of the results list: loading, error, hint, or no hits. */
function SearchEmpty() {
  const index = useStore($searchIndex);
  const query = useStore($searchQuery);
  const datasets = useStore($searchDatasets);

  if (index.status === 'loading' || index.status === 'idle') {
    return (
      <div className="cx-search__empty">
        <Spinner /> <span>Loading search index…</span>
      </div>
    );
  }
  if (index.status === 'error') {
    return (
      <div className="cx-search__empty">
        <span>Couldn’t load the search index.</span>
        {index.error !== undefined && <span className="cx-subtle">{index.error}</span>}
        <Button
          variant="secondary"
          size="sm"
          onPress={() => loadSearchIndex(true)}
          data-testid="search-retry"
        >
          Retry
        </Button>
      </div>
    );
  }
  const q = query.trim();
  if (q.length < MIN_QUERY) {
    return (
      <div className="cx-search__empty">
        <span>
          Type at least {MIN_QUERY} characters; <code>#tag</code> matches a tag exactly. Use the
          chips (Tab) to limit datasets.
        </span>
      </div>
    );
  }
  return (
    <div className="cx-search__empty">
      <span>
        No results for “{q}”{datasets.length > 0 && <> in {datasetLabels(datasets)}</>}
      </span>
      {datasets.length > 0 && (
        <Button variant="secondary" size="sm" onPress={() => setSearchDatasets([])}>
          Search all datasets
        </Button>
      )}
    </div>
  );
}

/** Scroll container + sectioned result list. Result rows are links (`href`), so Enter/click navigate. */
export function SearchResults() {
  const view = useStore($searchView);
  return (
    <div
      className="cx-search__results"
      onClickCapture={flushSearchUrl}
      onKeyDownCapture={(e) => {
        if (e.key === 'Enter') flushSearchUrl();
      }}
    >
      <ListBox
        aria-label="Search results"
        className="cx-search__listbox"
        selectionMode="none"
        data-testid="search-results"
        items={view.groups}
        renderEmptyState={() => <SearchEmpty />}
      >
        {(g) => (
          <ListBoxSection
            id={g.dataset}
            data-ds={g.dataset}
            items={g.hits}
            title={
              <>
                <DatasetBadge dataset={g.dataset} /> {getDataset(g.dataset)?.label ?? g.dataset}{' '}
                <span className="cx-subtle">{g.hits.length}</span>
              </>
            }
          >
            {(h) => (
              <ListBoxItem
                id={h.item.id}
                href={h.item.url}
                textValue={h.item.title || h.item.name}
                className="cx-search__item"
                data-testid="search-result"
              >
                <ResultBody hit={h} />
              </ListBoxItem>
            )}
          </ListBoxSection>
        )}
      </ListBox>
    </div>
  );
}
