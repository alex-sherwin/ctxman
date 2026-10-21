// NODE (no fs calls; satteri parses, links.ts checks): makes imported agent text inert markdown
// (concepts/agent-history.md). Session and plan text can carry fetched web content, so before it reaches a bundle:
//   - every `<` outside code (fenced, indented, inline) becomes `&lt;`, except an http(s)/mailto autolink: the
//     renderer passes raw HTML through, so imported text must never contain any;
//   - a link, image or reference definition whose destination is not http(s), mailto or a `#fragment` becomes
//     `text (`dest`)` (an image `alt (`src`)`; a definition is escaped), so an import adds no `links/*` findings and
//     no javascript:/file: links;
//   - ATX headings move down by `shift` levels (capped at 6; setext headings become ATX), never inside code;
//   - an unclosed top-level fence is closed, so it cannot swallow what follows.
// Code ranges come from satteri's own mdast (the parser src/lib/markdown.ts renders with), so "outside code" means
// exactly what the renderer will treat as text. The document pass then repeats the escape on the whole body, applies
// the bundle checker's own link model (links.ts#extractLinks: it also reads links inside indented or nested code
// that CommonMark keeps literal) and loops until both are stable.
import { markdownToMdast } from 'satteri';
import { inlineCode } from '../inflate/catalog.ts';
import { classifyHref, extractLinks } from '../links.ts';
import type { InertTransform } from './markdown.ts';

interface Point {
  offset?: number;
}
interface Node {
  type: string;
  position?: { start: Point; end: Point };
  children?: Node[];
  url?: string;
  alt?: string | null;
  title?: string | null;
  label?: string | null;
  depth?: number;
}

const parse = (source: string): Node =>
  markdownToMdast(source, { features: { gfm: true, frontmatter: false } }) as unknown as Node;

/** Destinations an imported link keeps: http(s), mailto, and in-page fragments. */
export function isAllowedUrl(url: string | undefined | null): boolean {
  const value = (url ?? '').trim();
  return value.startsWith('#') || /^(?:https?|mailto):/i.test(value);
}

function span(node: Node): [number, number] | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return typeof start === 'number' && typeof end === 'number' && end >= start ? [start, end] : null;
}

/** `<` becomes `&lt;` unless a backslash already makes it literal. */
function escapeLt(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) {
      out += text.slice(i, i + 2);
      i++;
    } else {
      out += c === '<' ? '&lt;' : c;
    }
  }
  return out;
}

/** A link destination that needs no angle brackets: spaces, parentheses and angle brackets percent-encoded. */
const destination = (url: string): string =>
  url.replace(/[ ()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

const titlePart = (title: string | null | undefined): string =>
  title === null || title === undefined || title === ''
    ? ''
    : ` "${title.replace(/[\\"]/g, '\\$&').replaceAll('<', '&lt;')}"`;

const alt = (value: string | null | undefined): string =>
  (value ?? '').replace(/[\\[\]]/g, '\\$&').replaceAll('<', '&lt;');

const neutralized = (label: string, url: string): string =>
  `${label.trim() === '' ? '' : `${label} `}(${inlineCode(url.replace(/\s+/g, ' '))})`;

/** One rewrite of `source` from one parse (see the header); `shift` moves the headings. */
function rewrite(source: string, shift: number): string {
  const sorted = (children: readonly Node[] | undefined): { node: Node; at: [number, number] }[] =>
    (children ?? [])
      .map((node) => ({ node, at: span(node) }))
      .filter((child): child is { node: Node; at: [number, number] } => child.at !== null)
      .sort((a, b) => a.at[0] - b.at[0]);

  /** `source[from, to)` with the nodes in `children` (inside that range) rewritten; the gaps escaped. */
  const range = (from: number, to: number, children: readonly Node[] | undefined): string => {
    let out = '';
    let pos = from;
    for (const { node, at } of sorted(children)) {
      if (at[0] < pos || at[1] > to) continue; // overlapping or outside: its text is a gap
      out += escapeLt(source.slice(pos, at[0]));
      out += emit(node, at);
      pos = at[1];
    }
    return out + escapeLt(source.slice(pos, to));
  };

  /** The label range of a link-like node: its children's span, or empty right after the `[`. */
  const label = (node: Node): string => {
    const kids = sorted(node.children);
    const first = kids[0];
    const last = kids.at(-1);
    if (first === undefined || last === undefined) return '';
    return range(first.at[0], last.at[1], node.children);
  };

  const emit = (node: Node, at: [number, number]): string => {
    const [start, end] = at;
    const raw = source.slice(start, end);
    switch (node.type) {
      case 'code':
      case 'inlineCode':
      case 'math':
      case 'inlineMath':
        return raw;
      case 'html':
        return raw.replaceAll('<', '&lt;');
      case 'link': {
        const url = node.url ?? '';
        if (raw.startsWith('<')) return isAllowedUrl(url) ? raw : escapeLt(raw); // autolink
        if (!raw.startsWith('[')) return raw; // GFM literal autolink (www., https://, an e-mail address)
        const text = label(node);
        return isAllowedUrl(url)
          ? `[${text}](${destination(url)}${titlePart(node.title)})`
          : neutralized(text, url);
      }
      case 'image': {
        const url = node.url ?? '';
        return isAllowedUrl(url)
          ? `![${alt(node.alt)}](${destination(url)}${titlePart(node.title)})`
          : neutralized(alt(node.alt), url);
      }
      case 'definition': {
        const url = node.url ?? '';
        if (isAllowedUrl(url)) {
          return `[${node.label ?? ''}]: ${destination(url)}${titlePart(node.title)}`;
        }
        // No longer a definition: the escaped `[` makes the line plain text.
        return `\\${escapeLt(raw)}`;
      }
      case 'heading': {
        const level = Math.min(6, (node.depth ?? 1) + shift);
        const hashes = /^#{1,6}/.exec(raw)?.[0];
        if (hashes !== undefined) {
          return (
            '#'.repeat(shift > 0 ? level : hashes.length) +
            range(start + hashes.length, end, node.children)
          );
        }
        if (shift === 0) return range(start, end, node.children);
        // A setext heading becomes ATX at its new level (its lines joined).
        return `${'#'.repeat(level)} ${label(node).replace(/\s*\n\s*/g, ' ')}`;
      }
      default:
        return node.children === undefined ? escapeLt(raw) : range(start, end, node.children);
    }
  };

  const root = parse(source);
  return range(0, source.length, root.children);
}

/** The fence that closes the last top-level node when it is a fenced code block left open, else ''. */
function openFence(source: string): string {
  const last = parse(source).children?.at(-1);
  if (last?.type !== 'code') return '';
  const at = span(last);
  if (at === null) return '';
  const lines = source.slice(at[0], at[1]).split('\n');
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(lines[0] ?? '')?.[1];
  if (fence === undefined) return ''; // indented code
  const char = fence[0] ?? '`';
  const close = new RegExp(`^ {0,3}\\${char}{${fence.length},}\\s*$`);
  return lines.length > 1 && close.test(lines.at(-1) ?? '') ? '' : fence;
}

/** Up to `rounds` rewrites until the text no longer changes; null when it never settles. */
function settle(source: string, rounds: number, step: (text: string) => string): string | null {
  let current = source;
  for (let round = 0; round < rounds; round++) {
    const next = step(current);
    if (next === current) return current;
    current = next;
  }
  return null;
}

/** One message or plan: escaped, links neutralized, headings shifted, an open fence closed. */
export function inertBlock(source: string, shift = 0): string {
  const text = source.replace(/\r\n?/g, '\n');
  const first = rewrite(text, shift);
  const settled =
    settle(first, 4, (current) => rewrite(current, 0)) ?? first.replaceAll('<', '&lt;');
  const fence = openFence(settled);
  return fence === '' ? settled : `${settled.replace(/\n*$/, '')}\n${fence}`;
}

/** Links the bundle checker validates (bundle paths, `ctxman:`), turned into plain text, until none is left. */
export function checkerSafeLinks(source: string): string {
  let current = source;
  for (let round = 0; round < 8; round++) {
    const bad = extractLinks(current).filter((link) => {
      const href = link.href.trim();
      if (href === '') return false;
      const kind = classifyHref(href);
      return kind === 'bundle' || kind === 'ctxman';
    });
    if (bad.length === 0) return current;
    let out = current;
    let limit = Number.POSITIVE_INFINITY;
    // Right to left; a link around one already replaced waits for the next round.
    for (const link of [...bad].sort((a, b) => b.start - a.start)) {
      if (link.end > limit) continue;
      const replacement =
        link.kind === 'definition'
          ? `\\${out.slice(link.start, link.end)}`
          : link.kind === 'autolink'
            ? `&lt;${out.slice(link.start + 1, link.end)}`
            : neutralized(link.text, link.href);
      out = out.slice(0, link.start) + replacement + out.slice(link.end);
      limit = link.start;
    }
    current = out;
  }
  return current;
}

/** The whole generated body: the escape again over everything, then the checker's link model, until stable. */
export function inertDocument(source: string): string {
  const settled = settle(source, 4, (current) => checkerSafeLinks(rewrite(current, 0)));
  // Never settles (no known input does this): no `<` survives anywhere, code included.
  return settled ?? checkerSafeLinks(source.replaceAll('<', '&lt;'));
}

/** The transform the markdown generator (markdown.ts, PURE) is given. */
export const INERT: InertTransform = { block: inertBlock, document: inertDocument };
