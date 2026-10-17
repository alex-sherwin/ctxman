// PURE match -> display helpers for the search widget (UI_SPEC §G.5). Turns Fuse.js match indices into
// highlight segments and picks the one-line snippet shown under a result title. No DOM, no React.
import type { FuseResult, FuseResultMatch } from 'fuse.js';
import type { SearchDoc } from './entry-summary.ts';

/** Inclusive `[start, end]` character indices, exactly as Fuse.js reports them. */
export type MatchRange = readonly [number, number];

export interface Segment {
  text: string;
  hit: boolean;
}

export interface Snippet {
  text: string;
  /** Normalized (sorted, merged, >= 2 chars) inclusive ranges, relative to `text`. */
  ranges: [number, number][];
}

/** Ranges shorter than this many characters are noise and never highlighted. */
export const MIN_RANGE_LENGTH = 2;
/** Default number of characters kept on each side of the first body match. */
export const SNIPPET_RADIUS = 60;
/** Descriptions up to this long are shown whole; longer ones are windowed (or cut when unmatched). */
export const DESCRIPTION_MAX = 160;

const ELLIPSIS = '…';
const isSpace = (ch: string | undefined): boolean => ch !== undefined && /\s/.test(ch);

/**
 * Clamp to `[0, length - 1]`, sort, merge overlapping or touching ranges, then drop merged ranges shorter
 * than {@link MIN_RANGE_LENGTH} (`end - start + 1 < 2`). Pure; never mutates its input.
 */
export function normalizeRanges(ranges: readonly MatchRange[], length: number): [number, number][] {
  const clamped: [number, number][] = [];
  for (const [start, end] of ranges) {
    const s = Math.max(0, start);
    const e = Math.min(length - 1, end);
    if (e >= s) clamped.push([s, e]);
  }
  clamped.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [s, e] of clamped) {
    const last = merged.at(-1);
    if (last !== undefined && s <= last[1] + 1) {
      if (e > last[1]) last[1] = e;
    } else {
      merged.push([s, e]);
    }
  }
  return merged.filter(([s, e]) => e - s + 1 >= MIN_RANGE_LENGTH);
}

/**
 * Split `text` into alternating plain / hit segments. Overlapping ranges are merged and ranges shorter
 * than 2 characters are dropped (see {@link normalizeRanges}). Concatenating the segments gives `text`.
 */
export function segments(text: string, ranges: readonly MatchRange[]): Segment[] {
  if (text === '') return [];
  const out: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of normalizeRanges(ranges, text.length)) {
    if (start > cursor) out.push({ text: text.slice(cursor, start), hit: false });
    out.push({ text: text.slice(start, end + 1), hit: true });
    cursor = end + 1;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/** Normalized match ranges of a single-valued key (`title`, `name`, `description`, `body`). */
export function keyRanges(hit: FuseResult<SearchDoc>, key: keyof SearchDoc): [number, number][] {
  const match = hit.matches?.find((m) => m.key === key);
  const value = hit.item[key];
  if (match === undefined || typeof value !== 'string') return [];
  return normalizeRanges(match.indices, value.length);
}

/** Tags of the doc that Fuse matched, each with its normalized ranges (document order). */
export function matchingTags(
  hit: FuseResult<SearchDoc>,
): { tag: string; ranges: [number, number][] }[] {
  const out: { tag: string; ranges: [number, number][] }[] = [];
  for (const m of hit.matches ?? []) {
    if (m.key !== 'tags') continue;
    const tag = m.value ?? (m.refIndex === undefined ? undefined : hit.item.tags[m.refIndex]);
    if (tag === undefined) continue;
    const ranges = normalizeRanges(m.indices, tag.length);
    if (ranges.length > 0) out.push({ tag, ranges });
  }
  return out;
}

/** A window of `text` around the first range, cut at word boundaries, with `…` at cut ends. */
function windowAround(text: string, ranges: [number, number][], radius: number): Snippet {
  const first = ranges[0];
  if (first === undefined) return { text, ranges };
  let start = Math.max(0, first[0] - radius);
  let end = Math.min(text.length, first[1] + 1 + radius); // exclusive

  // Start mid-word? Skip to just after the next whitespace, but never past the match itself.
  if (start > 0 && !isSpace(text[start - 1])) {
    for (let i = start; i < first[0]; i++) {
      if (isSpace(text[i])) {
        start = i + 1;
        break;
      }
    }
  }
  // End mid-word? Pull back to the last whitespace, but never before the match end.
  if (end < text.length && !isSpace(text[end])) {
    for (let i = end - 1; i > first[1]; i--) {
      if (isSpace(text[i])) {
        end = i;
        break;
      }
    }
  }
  const slice = text.slice(start, end);
  start += slice.length - slice.trimStart().length;
  end -= slice.length - slice.trimEnd().length;

  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < text.length ? ELLIPSIS : '';
  const body = `${prefix}${text.slice(start, end)}${suffix}`;
  const shift = prefix.length - start;
  const rebased: [number, number][] = [];
  for (const [s, e] of ranges) {
    const cs = Math.max(s, start);
    const ce = Math.min(e, end - 1);
    if (ce >= cs) rebased.push([cs + shift, ce + shift]);
  }
  return { text: body, ranges: normalizeRanges(rebased, body.length) };
}

function firstMatch(
  matches: readonly FuseResultMatch[] | undefined,
  key: string,
): { match: FuseResultMatch; ranges: [number, number][]; value: string } | undefined {
  const candidates = (matches ?? [])
    .filter((m) => m.key === key && m.value !== undefined)
    .sort((a, b) => (a.refIndex ?? 0) - (b.refIndex ?? 0));
  for (const match of candidates) {
    const value = match.value ?? '';
    const ranges = normalizeRanges(match.indices, value.length);
    if (ranges.length > 0) return { match, ranges, value };
  }
  return undefined;
}

/**
 * The one-line snippet under a result title. Priority:
 * 1. `description` match (whole text; windowed when longer than {@link DESCRIPTION_MAX});
 * 2. first `headings` match, prefixed with `§ `;
 * 3. `body` match: a window of +-`radius` characters around the first range, trimmed to word boundaries,
 *    `…` added at each cut end, ranges re-based and clipped to the window;
 * 4. otherwise the start of the description (first 160 chars, or of the body when there is none), no ranges.
 */
export function pickSnippet(hit: FuseResult<SearchDoc>, radius = SNIPPET_RADIUS): Snippet {
  const doc = hit.item;

  const description = firstMatch(hit.matches, 'description');
  if (description !== undefined) {
    return description.value.length <= DESCRIPTION_MAX
      ? { text: description.value, ranges: description.ranges }
      : windowAround(description.value, description.ranges, radius);
  }

  const heading = firstMatch(hit.matches, 'headings');
  if (heading !== undefined) {
    const prefix = '§ ';
    return {
      text: `${prefix}${heading.value}`,
      ranges: heading.ranges.map(([s, e]): [number, number] => [
        s + prefix.length,
        e + prefix.length,
      ]),
    };
  }

  const body = firstMatch(hit.matches, 'body');
  if (body !== undefined) return windowAround(body.value, body.ranges, radius);

  return { text: (doc.description || doc.body).slice(0, DESCRIPTION_MAX), ranges: [] };
}
