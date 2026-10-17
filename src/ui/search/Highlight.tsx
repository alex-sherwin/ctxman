import { Fragment } from 'react';
import { segments } from '../../lib/search-highlight.ts';
import type { MatchRange } from '../../lib/search-highlight.ts';

export interface HighlightProps {
  text: string;
  /** Inclusive Fuse.js index pairs; short and overlapping ranges are cleaned up by `segments`. */
  ranges: readonly MatchRange[];
}

/** Text with the matched parts wrapped in `<mark class="cx-search__mark">`. Never injects HTML. */
export function Highlight({ text, ranges }: HighlightProps) {
  return (
    <>
      {segments(text, ranges).map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="cx-search__mark">
            {seg.text}
          </mark>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </>
  );
}
