// PURE (no fs, no DOM): the global search on top of Fuse (search-config.ts). Every value of a markdown file's
// frontmatter `tags` array is a search doc tag (search-index.ts) and is indexed ON ITS OWN twice: fuzzily by Fuse (the
// `tags` key) and exactly in a tag index (lower-cased tag -> docs), which `#tag` tokens of a query use: every `#tag`
// must be a tag of the doc (case-insensitive); the rest of the query is the fuzzy text. Used by the search widget
// store and the MCP `search` tool.
import type Fuse from 'fuse.js';
import type { FuseResult, FuseResultMatch } from 'fuse.js';
import type { SearchDoc } from './entry-summary.ts';
import { MIN_QUERY } from './search-config.ts';

export interface ParsedSearchQuery {
  /** The fuzzy part: the query without its `#tag` tokens. */
  text: string;
  /** `#tag` tokens, lower-cased, without the `#`, no repeats. */
  tags: string[];
}

/** `"#ui #Forge drag"` -> `{ text: 'drag', tags: ['ui', 'forge'] }`. A lone `#` is plain text. */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const text: string[] = [];
  const tags: string[] = [];
  for (const token of query.trim().split(/\s+/)) {
    if (token.length > 1 && token.startsWith('#')) {
      const tag = token.slice(1).toLowerCase();
      if (!tags.includes(tag)) tags.push(tag);
    } else if (token !== '') {
      text.push(token);
    }
  }
  return { text: text.join(' '), tags };
}

/** Lower-cased tag -> the positions (in `docs`) of the docs that carry it. */
export type TagIndex = ReadonlyMap<string, readonly number[]>;

export function buildTagIndex(docs: readonly SearchDoc[]): TagIndex {
  const index = new Map<string, number[]>();
  docs.forEach((doc, i) => {
    for (const tag of new Set(doc.tags.map((t) => t.toLowerCase()))) {
      const list = index.get(tag);
      if (list === undefined) index.set(tag, [i]);
      else list.push(i);
    }
  });
  return index;
}

/** True when a query is long enough to search: fuzzy text of MIN_QUERY characters, or at least one `#tag`. */
export function isSearchable(query: string): boolean {
  const parsed = parseSearchQuery(query);
  return parsed.tags.length > 0 || parsed.text.length >= MIN_QUERY;
}

/** Fuse-style matches for the doc's tags that `tags` names (so the result row shows and highlights them). */
function tagMatches(doc: SearchDoc, tags: readonly string[]): FuseResultMatch[] {
  const out: FuseResultMatch[] = [];
  doc.tags.forEach((tag, refIndex) => {
    if (tags.includes(tag.toLowerCase())) {
      out.push({ key: 'tags', refIndex, value: tag, indices: [[0, tag.length - 1]] });
    }
  });
  return out;
}

/**
 * Runs `query` over `docs` (the docs `fuse` and `tagIndex` were built from). Without `#tag` tokens it is the plain Fuse
 * search. With them, only the docs carrying every tag are kept: ranked by Fuse when there is fuzzy text of at least
 * MIN_QUERY characters, else all of them in index order (score 0). Kept hits get the matched tags in their `matches`.
 * `limit` applies after the tag filter.
 */
export function searchDocs(
  fuse: Fuse<SearchDoc>,
  docs: readonly SearchDoc[],
  tagIndex: TagIndex,
  query: string,
  limit?: number,
): FuseResult<SearchDoc>[] {
  const { text, tags } = parseSearchQuery(query);
  const cap = (hits: FuseResult<SearchDoc>[]) =>
    limit === undefined ? hits : hits.slice(0, limit);
  if (tags.length === 0) {
    if (text.length < MIN_QUERY) return [];
    return limit === undefined ? fuse.search(text) : fuse.search(text, { limit });
  }

  let keep = new Set<number>();
  tags.forEach((tag, i) => {
    const carriers = new Set(tagIndex.get(tag) ?? []);
    keep = i === 0 ? carriers : new Set([...keep].filter((doc) => carriers.has(doc)));
  });
  if (keep.size === 0) return [];

  // The named tags are highlighted whole (a fuzzy match of the same tag is replaced); other matches stay.
  const withTags = (hit: FuseResult<SearchDoc>): FuseResult<SearchDoc> => {
    const exact = tagMatches(hit.item, tags);
    const named = new Set(exact.map((m) => m.refIndex));
    const rest = (hit.matches ?? []).filter((m) => m.key !== 'tags' || !named.has(m.refIndex));
    return { ...hit, matches: [...rest, ...exact] };
  };

  if (text.length >= MIN_QUERY) {
    return cap(
      fuse
        .search(text)
        .filter((hit) => keep.has(hit.refIndex))
        .map(withTags),
    );
  }
  const hits: FuseResult<SearchDoc>[] = [];
  for (const refIndex of [...keep].sort((a, b) => a - b)) {
    const item = docs[refIndex];
    if (item !== undefined) hits.push(withTags({ item, refIndex, score: 0 }));
  }
  return cap(hits);
}
