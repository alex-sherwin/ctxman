// PURE (no fs; browser-safe): which headings of a rendered document the headings nav of an okf / skill page lists
// (src/components/DocToc.astro), from the headings src/lib/markdown.ts#renderMarkdownDoc collects.

export interface TocHeading {
  depth: number;
  id: string;
  text: string;
}

export interface TocEntry {
  id: string;
  text: string;
  /** 0 = the shallowest level listed; at most {@link MAX_TOC_LEVEL}. */
  level: number;
}

/** Deeper headings than this (h5, h6) are not listed. */
export const MAX_TOC_DEPTH = 4;
export const MAX_TOC_LEVEL = MAX_TOC_DEPTH - 1;

/**
 * The nav entries: headings h1-h4, minus a lone h1 at the top (the document title), indented relative to the
 * shallowest one left. Fewer than two entries is no nav at all ([]).
 */
export function tocEntries(headings: readonly TocHeading[]): TocEntry[] {
  let listed = headings.filter((h) => h.depth >= 1 && h.depth <= MAX_TOC_DEPTH);
  const h1s = listed.filter((h) => h.depth === 1);
  if (h1s.length === 1 && listed[0]?.depth === 1) listed = listed.slice(1);
  if (listed.length < 2) return [];
  const top = Math.min(...listed.map((h) => h.depth));
  return listed.map((h) => ({
    id: h.id,
    text: h.text,
    level: Math.min(h.depth - top, MAX_TOC_LEVEL),
  }));
}
