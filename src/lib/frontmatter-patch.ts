// PURE (no fs, no astro:*): patch the TOP-LEVEL keys of a markdown file's YAML frontmatter by source range.
// Only the given keys are touched; every other byte of the file (comments, folded scalars, flow sequences,
// timestamps, unknown keys, the body) is returned exactly as it was. The frontmatter is NEVER re-serialized as a
// whole: `Document.toString()` re-flows folded scalars, re-pads flow sequences and rewrites timestamps, so the
// parse below is only used to find ranges. Spec: plans/ROUND3_SPEC.md §B.4 (A7).
import { Document, isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Pair } from 'yaml';

/** undefined = delete the key; any other value = set it. */
export type FrontmatterChanges = Readonly<Record<string, unknown>>;
export type PatchResult =
  | { ok: true; source: string; changed: boolean }
  | { ok: false; error: string };

/**
 * Where a NEW key goes: after the first of these keys that is present (in the file or inserted earlier in the
 * same patch). No present anchor (or none listed) = the end of the frontmatter.
 */
const ANCHORS: Readonly<Record<string, readonly string[]>> = {
  title: ['name'],
  state: ['description'],
  tags: ['state', 'description'],
  stale_after: ['tags'],
  status: ['tags'],
};

/** Keys written as a flow sequence (`tags: [a, b]`) when they do not exist yet; existing keys keep their style. */
const FLOW_BY_DEFAULT: ReadonlySet<string> = new Set(['tags']);

interface Edit {
  /** Replaced range [start, end) of the LF frontmatter text (start === end = a pure insertion). */
  start: number;
  end: number;
  text: string;
  /** Insertions at the same position keep the order they were requested in. */
  seq: number;
}

/**
 * Applies `changes` to the frontmatter of `source` (a whole markdown file). Algorithm (§B.4):
 * - the frontmatter is the text between the leading `---` line and the next `---` line (same test as
 *   `okf.splitFrontmatter`); a BOM and CRLF line endings (those of the opening line) are kept, the body is never
 *   touched, not even when its line endings differ;
 * - an existing key is found by parsing the frontmatter (YAML core schema, no timestamp tag) and its span is
 *   the whole line range of its pair (key line to last value line); full-line comments above it stay, a trailing
 *   comment on a replaced single-line value is dropped;
 * - a set key's new text is `key: value` stringified on its own (flow style kept for a flow sequence);
 * - a new key is inserted after its anchor (see ANCHORS) or at the end; deleting a missing key is a no-op;
 * - a duplicate key, bad YAML or a non-mapping frontmatter fails with a message and nothing is changed.
 * `changed` is false (and `source` is returned as is) when the result would equal the input.
 */
export function patchFrontmatter(source: string, changes: FrontmatterChanges): PatchResult {
  const region = locateFrontmatter(source);
  if (region === null) return { ok: false, error: 'missing frontmatter' };

  const raw = region.text;
  const doc = parseDocument(raw, { schema: 'core', merge: true });
  const firstError = doc.errors[0];
  if (firstError !== undefined)
    return { ok: false, error: firstError.message.split('\n')[0] ?? 'invalid YAML' };
  if (doc.contents !== null && !isMap(doc.contents)) {
    return { ok: false, error: 'frontmatter is not a mapping' };
  }
  const map = isMap(doc.contents) ? doc.contents : null;

  // Top-level pairs by key, with the line span of each.
  const spans = new Map<string, { start: number; end: number; pair: Pair }>();
  for (const pair of map?.items ?? []) {
    if (!isScalar(pair.key) || typeof pair.key.value !== 'string') continue;
    const keyRange = pair.key.range;
    if (!keyRange) continue;
    const valueRange = pair.value?.range ?? null;
    const lastChar = valueRange === null ? keyRange[1] : Math.max(valueRange[1] - 1, keyRange[1]);
    spans.set(pair.key.value, {
      start: lineStart(raw, keyRange[0]),
      end: lineEnd(raw, lastChar),
      pair,
    });
  }

  const edits: Edit[] = [];
  // Where the keys inserted by this patch ended up, so a later new key can anchor on an earlier one.
  const insertedAt = new Map<string, number>();
  let seq = 0;
  /** End of the last non-blank line: blank lines before the closing `---` stay below an appended key. */
  const appendPos = raw.replace(/\n+$/, '').length;

  for (const [key, value] of Object.entries(changes)) {
    const existing = spans.get(key);
    if (value === undefined) {
      if (existing === undefined) continue;
      // Remove the span with its newline; the last line of the text takes the newline before it instead.
      const { start, end } = existing;
      edits.push(
        end < raw.length
          ? { start, end: end + 1, text: '', seq: seq++ }
          : { start: Math.max(start - 1, 0), end, text: '', seq: seq++ },
      );
      continue;
    }

    if (existing !== undefined) {
      const oldValue = existing.pair.value;
      const flow = isSeq(oldValue) && oldValue.flow === true;
      edits.push({
        start: existing.start,
        end: existing.end,
        text: stringifyPair(key, value, flow),
        seq: seq++,
      });
      continue;
    }

    const text = stringifyPair(key, value, FLOW_BY_DEFAULT.has(key));
    let pos = appendPos;
    for (const anchor of ANCHORS[key] ?? []) {
      const at = insertedAt.get(anchor) ?? spans.get(anchor)?.end;
      if (at !== undefined) {
        pos = at;
        break;
      }
    }
    insertedAt.set(key, pos);
    edits.push({ start: pos, end: pos, text: pos === 0 ? text : `\n${text}`, seq: seq++ });
  }

  // Bottom-up so earlier offsets stay valid; insertions at the same offset keep their request order.
  let patched = raw;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.seq - a.seq)) {
    patched = patched.slice(0, edit.start) + edit.text + patched.slice(edit.end);
  }
  if (patched === raw) return { ok: true, source, changed: false };

  const block = patched === '' ? '' : patched.replaceAll('\n', region.eol) + region.eol;
  return {
    ok: true,
    source: source.slice(0, region.start) + block + source.slice(region.end),
    changed: true,
  };
}

interface FrontmatterRegion {
  /** The frontmatter lines joined with '\n' (CRLF normalized), without the final line break. */
  text: string;
  /** Offsets in `source` of the first character after the opening `---` line and of the closing `---` line. */
  start: number;
  end: number;
  eol: string;
}

/** Offsets of the frontmatter block in `source`, or null when there is none (see `okf.splitFrontmatter`). */
function locateFrontmatter(source: string): FrontmatterRegion | null {
  const bom = source.startsWith('﻿') ? 1 : 0;
  let lineBegin = bom;
  let opened = false;
  let start = 0;
  let eol = '\n';
  while (lineBegin <= source.length) {
    const nl = source.indexOf('\n', lineBegin);
    const lineStop = nl === -1 ? source.length : nl;
    const line = source.slice(lineBegin, lineStop).trimEnd();
    if (!opened) {
      if (line !== '---') return null;
      opened = true;
      start = nl === -1 ? source.length : nl + 1;
      // The line ending of the opening line is the file's: new frontmatter lines are written with it.
      if (nl > 0 && source[nl - 1] === '\r') eol = '\r\n';
    } else if (line === '---') {
      // The frontmatter text ends before the line break that precedes the closing line.
      const rawEnd =
        lineBegin > start ? lineBegin - (source[lineBegin - 2] === '\r' ? 2 : 1) : start;
      const text = source.slice(start, rawEnd).replaceAll('\r\n', '\n');
      return {
        text,
        start,
        end: lineBegin,
        eol,
      };
    }
    if (nl === -1) return null;
    lineBegin = nl + 1;
  }
  return null;
}

/** Index of the first character of the line containing `index`. */
function lineStart(text: string, index: number): number {
  return text.lastIndexOf('\n', index - 1) + 1;
}

/** Index of the line break ending the line containing `index` (or the text length for the last line). */
function lineEnd(text: string, index: number): number {
  const nl = text.indexOf('\n', index);
  return nl === -1 ? text.length : nl;
}

/** `key: value` as YAML on its own (no trailing newline); `flow` writes a sequence of scalars as `[a, b]`. */
function stringifyPair(key: string, value: unknown, flow: boolean): string {
  const doc = new Document({ [key]: value }, { aliasDuplicateObjects: false });
  if (flow) {
    const node = doc.get(key, true);
    // Flow style only suits sequences of scalars; a list of mappings (`links`) stays a block list.
    if (isSeq(node) && node.items.every((item) => isScalar(item))) node.flow = true;
  }
  return doc
    .toString({ lineWidth: 0, blockQuote: 'literal', flowCollectionPadding: false })
    .replace(/\n$/, '');
}
