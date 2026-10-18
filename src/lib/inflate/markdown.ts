// NODE* (no fs calls of its own; imports src/lib/okf.ts and src/lib/links.ts): markdown text helpers for
// the Context Inflate renderer (plans/INFLATE_SPEC.md §6.1). Never import from the browser island.
import { classifyHref, parseCtxmanHref, resolveBundleHref } from '../links.ts';
import { maskMarkdownCode } from '../okf.ts';
import { inlineCode } from './catalog.ts';
import type { Note } from './expand.ts';
import type { EntryRef } from './pipeline.ts';

export { inlineCode };

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/**
 * A fenced code block: fence = max(3, longest line-leading backtick run in `text` + 1) backticks, so the
 * text can never close it early.
 */
export function fenced(text: string, lang: string): string {
  let longest = 0;
  for (const line of text.split('\n')) {
    const run = /^ {0,3}(`+)/.exec(line)?.[1];
    if (run !== undefined) longest = Math.max(longest, run.length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${text.replace(/\n+$/, '')}\n${fence}`;
}

const HEADING = /^( {0,3})(#{1,6})(?=[ \t]|$)/;

/**
 * Shifts the ATX headings of `body` so the shallowest one lands on level `base` (clamped to 1..6, deeper
 * headings keep their distance and are clamped at 6). Headings inside code are left alone. Setext headings
 * are not touched (documented limitation).
 */
export function shiftHeadings(body: string, base: number): string {
  const maskedLines = maskMarkdownCode(body).split('\n');
  let min = 7;
  for (const line of maskedLines) {
    const hashes = HEADING.exec(line)?.[2];
    if (hashes !== undefined) min = Math.min(min, hashes.length);
  }
  if (min === 7) return body;
  const delta = Math.min(base, 6) - min;
  return body
    .split('\n')
    .map((line, i) => {
      const m = HEADING.exec(maskedLines[i] ?? '');
      if (m === null) return line;
      const level = clamp((m[2] ?? '').length + delta, 1, 6);
      return `${m[1] ?? ''}${'#'.repeat(level)}${line.slice(m[0].length)}`;
    })
    .join('\n');
}

const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Drops the first non-blank line of `body` (and the blank lines right after it) when it is an ATX heading
 * whose text equals `title` (trimmed, whitespace-collapsed, case-insensitive). Applied before shiftHeadings.
 */
export function stripLeadingTitle(body: string, title: string): string {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first === -1) return body;
  const m = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(lines[first] ?? '');
  if (m === null || norm(m[1] ?? '') !== norm(title)) return body;
  let next = first + 1;
  while (next < lines.length && (lines[next] ?? '').trim() === '') next++;
  return lines.slice(next).join('\n');
}

const INLINE_DEST = /\]\([ \t]*(<[^>\n]*>|[^\s)]+)/g;
// Footnote definitions (`[^note]: text`) are not link definitions.
const REF_DEF = /^( {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*)(<[^>\n]*>|\S+)/gm;

/**
 * Rewrites bundle-relative and `ctxman:` link destinations (inline links, images, reference definitions;
 * never inside code) to absolute file paths. Unresolvable destinations are left unchanged.
 */
export function rewriteLinks(
  body: string,
  ctx: {
    fromRel: string;
    files: ReadonlyMap<string, string>;
    targets: Readonly<Record<string, EntryRef | null>>;
  },
): string {
  const masked = maskMarkdownCode(body);
  const found: { start: number; end: number; destination: string }[] = [];
  for (const m of masked.matchAll(INLINE_DEST)) {
    const destination = m[1] ?? '';
    const end = (m.index ?? 0) + m[0].length;
    found.push({ start: end - destination.length, end, destination });
  }
  for (const m of masked.matchAll(REF_DEF)) {
    const destination = m[2] ?? '';
    const end = (m.index ?? 0) + m[0].length;
    found.push({ start: end - destination.length, end, destination });
  }
  found.sort((a, b) => b.start - a.start);

  let out = body;
  for (const { start, end, destination } of found) {
    const wrapped = destination.startsWith('<');
    const d = wrapped ? destination.slice(1, -1) : destination;
    const abs = resolveDestination(d, ctx);
    if (abs === null) continue;
    const hash = d.indexOf('#');
    const fragment = hash === -1 ? '' : d.slice(hash + 1);
    const next = abs + (fragment === '' ? '' : `#${fragment}`);
    out = out.slice(0, start) + (/[\s()<>]/.test(next) ? `<${next}>` : next) + out.slice(end);
  }
  return out;
}

function resolveDestination(
  d: string,
  ctx: {
    fromRel: string;
    files: ReadonlyMap<string, string>;
    targets: Readonly<Record<string, EntryRef | null>>;
  },
): string | null {
  if (d.trim() === '') return null;
  const kind = classifyHref(d);
  if (kind === 'bundle') {
    const resolved = resolveBundleHref(d, ctx.fromRel);
    return 'path' in resolved ? (ctx.files.get(resolved.path) ?? null) : null;
  }
  if (kind === 'ctxman') {
    const target = parseCtxmanHref(d);
    return target === null ? null : (ctx.targets[`${target.dataset}/${target.slug}`]?.abs ?? null);
  }
  return null;
}

/** Shell-safe word: unchanged when it only holds safe characters, else single-quoted. */
export function shQuote(s: string): string {
  return /^[A-Za-z0-9._/:@%+=,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
}

/** Blockquote with the context's guidance for an item; '' when there are no notes. */
export function guidance(notes: readonly Note[]): string {
  return notes
    .map((note) => {
      const lines = note.notes.replace(/\r\n?/g, '\n').trim().split('\n');
      return [
        `> **From context \`${note.context}\`:** ${lines[0] ?? ''}`,
        ...lines.slice(1).map((line) => (line.trim() === '' ? '>' : `> ${line}`)),
      ].join('\n');
    })
    .join('\n>\n');
}

/** `### Title` — level clamped to 1..6, whitespace in the text collapsed. */
export function headingText(level: number, text: string): string {
  return `${'#'.repeat(clamp(level, 1, 6))} ${text.replace(/\s+/g, ' ').trim()}`;
}

/**
 * `text` with whitespace runs collapsed to one space; longer than `max` characters it is cut to `max - 1`
 * characters (trailing space dropped) plus `…`.
 */
export function truncateText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Rows as aligned plain-text lines: the name column is padded to `min(maxWidth, longest name + 2)` characters
 * (at least two spaces always separate a longer name from its note); rows without a note are just the name.
 */
export function alignRows(
  rows: readonly { name: string; note?: string | null }[],
  maxWidth = 40,
): string[] {
  const width = Math.min(maxWidth, Math.max(0, ...rows.map((r) => r.name.length)) + 2);
  return rows.map(({ name, note }) =>
    note === undefined || note === null || note === ''
      ? name
      : `${name}${' '.repeat(Math.max(2, width - name.length))}${note}`,
  );
}
