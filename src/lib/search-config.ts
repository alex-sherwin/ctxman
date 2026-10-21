// PURE Fuse.js configuration for the global search widget (UI_SPEC §G.1). Imported by the island store
// (src/stores/search.ts); keep it free of browser/node APIs so tests and tools can reuse it.
import type { IFuseOptions } from 'fuse.js';
import type { SearchDoc } from './entry-summary.ts';

export const FUSE_OPTIONS: IFuseOptions<SearchDoc> = {
  keys: [
    { name: 'title', weight: 0.4 },
    { name: 'name', weight: 0.3 },
    { name: 'issueKey', weight: 0.3 },
    { name: 'tags', weight: 0.2 },
    { name: 'description', weight: 0.2 },
    { name: 'headings', weight: 0.15 },
    { name: 'body', weight: 0.1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
  includeMatches: true,
  includeScore: true,
  minMatchCharLength: 2,
};

/** Below this many characters (after trim) no search runs and the widget shows a hint. */
export const MIN_QUERY = 2;

/** Hard cap on the rows rendered, applied after the dataset filter. */
export const MAX_RESULTS = 60;
