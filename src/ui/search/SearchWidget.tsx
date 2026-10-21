import { useStore } from '@nanostores/react';
import type { KeyboardEvent } from 'react';
import { Autocomplete } from 'react-aria-components';
import type { Key } from 'react-aria-components';
import { DATASETS, isDatasetId } from '../../datasets/registry.ts';
import { MAX_RESULTS, MIN_QUERY } from '../../lib/search-config.ts';
import {
  $searchDatasets,
  $searchIndex,
  $searchOpen,
  $searchQuery,
  $searchView,
  closeSearch,
  flushSearchUrl,
  loadSearchIndex,
  setSearchDatasets,
  setSearchQuery,
} from '../../stores/search.ts';
import type { SearchIndexState, SearchView } from '../../stores/search.ts';
// Kit components are imported BY FILE: the kit barrel (index.ts) re-exports the Monaco editor,
// which needs `window` and is megabytes of JS this island must not pull in.
import { Button } from '../kit/Button.tsx';
import { Chip, ChipGroup } from '../kit/Chip.tsx';
import { Dialog, Modal } from '../kit/Dialog.tsx';
import { SearchField } from '../kit/Field.tsx';
import { Kbd } from '../kit/Kbd.tsx';
import { SearchResults } from './SearchResults.tsx';

const ALL_KEYS: readonly string[] = ['all'];

function countText(index: SearchIndexState, hasQuery: boolean, view: SearchView): string {
  if (index.status === 'loading') return 'Loading index…';
  if (index.status !== 'ready' || !hasQuery) return '';
  const noun = view.total === 1 ? 'result' : 'results';
  return `${view.total} ${noun}${view.capped ? ` · showing first ${MAX_RESULTS}` : ''}`;
}

/**
 * Plain Enter in the search input opens the result that has the keyboard (virtual) focus, else the first result.
 * RAC's Autocomplete only acts on a focused result: typing forward focuses the first one, but a deletion (Backspace,
 * cut) clears that focus on purpose and a query restored from the URL never sets it, so Enter did nothing although
 * results were listed. search.css shows the first result as focused in that state, so the highlight is what opens.
 */
function onInputEnter(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
  if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;
  if (!(e.target instanceof HTMLInputElement)) return;
  const focused = e.currentTarget.parentElement?.querySelector<HTMLAnchorElement>(
    '.cx-search__item[data-focused]',
  );
  const url = focused?.getAttribute('href') ?? $searchView.get().groups[0]?.hits[0]?.item.url;
  if (url === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  flushSearchUrl();
  location.assign(url);
}

/**
 * Full-screen global search (UI_SPEC §G). Mounted once in Base.astro as
 * `<SearchWidget client:only="react" />`; opened by the header button, Cmd/Ctrl+K, `/` or `?search=1`.
 */
export function SearchWidget() {
  const open = useStore($searchOpen);
  const query = useStore($searchQuery);
  const datasets = useStore($searchDatasets);
  const index = useStore($searchIndex);
  const view = useStore($searchView);
  const hasQuery = query.trim().length >= MIN_QUERY;

  function onChips(keys: Set<Key>) {
    const next = [...keys].map(String);
    if (next.includes('all') && datasets.length > 0) setSearchDatasets([]);
    else setSearchDatasets(next.filter(isDatasetId));
  }

  return (
    <Modal
      variant="fullscreen"
      isOpen={open}
      onOpenChange={(o) => {
        if (!o) closeSearch();
      }}
      isDismissable
      testId="search-modal"
    >
      <div className="cx-search__fx cyber-scanlines cyber-scanlines--fine" aria-hidden="true" />
      <Dialog aria-label="Search ctxman" className="cx-search" bodyClassName="cx-search__body">
        <Autocomplete
          inputValue={query}
          onInputChange={setSearchQuery}
          disableAutoFocusFirst={false}
        >
          <header className="cx-search__bar" onKeyDownCapture={onInputEnter}>
            <SearchField
              aria-label="Search all datasets"
              autoFocus
              size="lg"
              inputTestId="search-input"
              placeholder="Search titles, tags, headings, content…"
            />
            <Button
              variant="ghost"
              size="sm"
              glow
              onPress={closeSearch}
              aria-label="Close search"
              data-testid="search-close"
            >
              <Kbd>Esc</Kbd>
            </Button>
          </header>
          <div className="cx-search__filters">
            <ChipGroup
              label="Filter by dataset"
              selectionMode="multiple"
              selectedKeys={datasets.length > 0 ? datasets : ALL_KEYS}
              onSelectionChange={onChips}
              data-testid="search-dataset-chips"
            >
              <Chip id="all" data-testid="search-chip-all">
                All
              </Chip>
              {DATASETS.map((d) => (
                <Chip
                  key={d.id}
                  id={d.id}
                  dataset={d.id}
                  count={
                    hasQuery && index.status === 'ready' ? view.countsByDataset[d.id] : undefined
                  }
                  data-testid={`search-chip-${d.id}`}
                >
                  {d.id}
                </Chip>
              ))}
            </ChipGroup>
            <span className="cx-search__count" role="status" data-testid="search-count">
              {countText(index, hasQuery, view)}
            </span>
          </div>
          <SearchResults />
          <footer className="cx-search__footer">
            <span className="cx-search__hint">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="cx-search__hint">
              <Kbd>↵</Kbd> open
            </span>
            <span className="cx-search__hint">
              <Kbd>Tab</Kbd> filters
            </span>
            <span className="cx-search__hint">
              <Kbd>Esc</Kbd> clear / close
            </span>
            <span className="cx-search__spacer" />
            <span className="cx-subtle">{index.docs.length} docs indexed</span>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => loadSearchIndex(true)}
              data-testid="search-reload"
            >
              Reload index
            </Button>
          </footer>
        </Autocomplete>
      </Dialog>
    </Modal>
  );
}

export default SearchWidget;
