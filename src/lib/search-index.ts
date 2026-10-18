// PURE builders for the fuse.js search index (PLAN §E.16, UI_SPEC §0.5 SearchDoc). The server
// (src/lib/entries.ts) feeds these with collection data + raw markdown bodies; they never touch fs.
import {
  OKF_ENTRY_FILE,
  OWNER_LABELS,
  REFERENCE_TYPE_LABELS,
  docUrl,
  entryUrl,
} from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';
import type { ContextData, RecipeData, ReferenceData, SkillData } from '../datasets/schemas.ts';
import type { SearchDoc } from './entry-summary.ts';
import { TARGETS, itemKey } from './inflate/catalog.ts';
import { classifyRemoteUri } from './remote-uri.ts';

/** Upper bound for a doc `body` (keeps the JSON index and the in-browser Fuse index small). */
export const MAX_BODY_CHARS = 20_000;

// ---------------------------------------------------------------- markdown → text

const FRONTMATTER = /^﻿?---[ \t]*\n(?:[\s\S]*?\n)?---[ \t]*(?:\n|$)/;

function stripFrontmatter(md: string): string {
  return md.replace(/\r\n?/g, '\n').replace(FRONTMATTER, '');
}

interface FenceState {
  char: string;
  len: number;
}

interface WalkedLine {
  text: string;
  /** true for lines inside a fenced code block (fence marker lines themselves are not emitted). */
  code: boolean;
}

/** Split markdown into lines, flagging fenced code content and dropping the ``` / ~~~ marker lines. */
function walkLines(md: string): WalkedLine[] {
  const out: WalkedLine[] = [];
  let fence: FenceState | null = null;
  for (const text of md.split('\n')) {
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(text);
      if (open) {
        const marker = open[1] ?? '```';
        fence = { char: marker.charAt(0), len: marker.length };
        continue;
      }
      out.push({ text, code: false });
    } else {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
      const marker = close?.[1];
      if (marker !== undefined && marker.charAt(0) === fence.char && marker.length >= fence.len) {
        fence = null;
        continue;
      }
      out.push({ text, code: true });
    }
  }
  return out;
}

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

const SPAN_OPEN = '';
const SPAN_CLOSE = '';

/** Strip inline markdown/HTML from a single line, keeping the visible text (and inline code verbatim). */
function cleanInline(input: string): string {
  // Park inline code spans and backslash-escaped punctuation so their content (`Array<string>`,
  // `a_b`, `\*`) is not mangled by the stripping below; restored at the end.
  const parked: string[] = [];
  const park = (text: string): string => {
    parked.push(text);
    return `${SPAN_OPEN}${parked.length - 1}${SPAN_CLOSE}`;
  };
  let s = input
    .replace(/(`+)(.+?)\1/g, (_m, _ticks: string, code: string) => park(code))
    .replace(/\\([!-/:-@[-`{-~])/g, (_m, ch: string) => park(ch));
  s = s
    .replace(/<!--.*?-->/g, ' ')
    .replace(/<((?:https?|mailto|ftp):[^>\s]+)>/gi, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\*+/g, '')
    .replace(/~~/g, '')
    // Underscore emphasis only at word boundaries, so snake_case identifiers survive.
    .replace(/(^|[^\p{L}\p{N}_])_{1,3}(?=\S)/gu, '$1')
    .replace(/(?<=\S)_{1,3}(?![\p{L}\p{N}_])/gu, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (e) => ENTITIES[e] ?? e);
  return s.replace(
    new RegExp(`${SPAN_OPEN}(\\d+)${SPAN_CLOSE}`, 'g'),
    (_m, i: string) => parked[Number(i)] ?? '',
  );
}

/** Strip block-level markers from one non-code line, then its inline markup. '' = nothing to index. */
function cleanLine(raw: string): string {
  if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(raw)) return ''; // horizontal rule
  if (/^ {0,3}=+[ \t]*$/.test(raw)) return ''; // setext underline
  if (
    raw.includes('|') &&
    /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/.test(raw)
  ) {
    return ''; // table separator row
  }
  if (/^ {0,3}\[(?!\^)[^\]]+\]:[ \t]*\S/.test(raw)) return ''; // link reference definition

  let s = raw
    .replace(/^ {0,3}\[\^[^\]]+\]:[ \t]*/, '') // footnote definition marker
    .replace(/^(?: {0,3}>[ \t]?)+/, '') // blockquote
    .replace(/^ {0,3}#{1,6}(?:[ \t]+|$)/, '') // ATX heading marker
    .replace(/[ \t]+#+[ \t]*$/, '') // ATX closing sequence
    .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/, '') // list marker
    .replace(/^\[[ xX]\][ \t]+/, ''); // task checkbox
  if (s.includes('|')) s = s.replace(/(?<!\\)\|/g, ' '); // table pipes
  return cleanInline(s);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  // Do not end on half of a surrogate pair.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * Plain searchable text of a markdown document: frontmatter, HTML tags, link/image syntax (text kept),
 * emphasis and heading markers and table pipes are dropped; fenced code CONTENT is kept; whitespace is
 * collapsed to single spaces; capped at 20_000 chars.
 */
export function markdownToText(md: string): string {
  const parts: string[] = [];
  for (const line of walkLines(stripFrontmatter(md))) {
    parts.push(line.code ? line.text : cleanLine(line.text));
  }
  return truncate(parts.join('\n').replace(/\s+/g, ' ').trim(), MAX_BODY_CHARS);
}

interface Heading {
  level: number;
  text: string;
}

function scanHeadings(md: string, maxLevel: number): Heading[] {
  const out: Heading[] = [];
  for (const line of walkLines(stripFrontmatter(md))) {
    if (line.code) continue;
    const m = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line.text);
    const hashes = m?.[1];
    if (hashes === undefined || hashes.length > maxLevel) continue;
    const text = cleanInline((m?.[2] ?? '').replace(/[ \t]+#+[ \t]*$/, ''))
      .replace(/\s+/g, ' ')
      .trim();
    if (text !== '') out.push({ level: hashes.length, text });
  }
  return out;
}

/** Text of ATX headings (levels 1-4) in document order, outside frontmatter and code fences. */
export function extractHeadings(md: string): string[] {
  return scanHeadings(md, 4).map((h) => h.text);
}

// ---------------------------------------------------------------- doc builders

const stringOr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const tagsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];

function basename(relPath: string): string {
  const file = relPath.split('/').pop() ?? relPath;
  return file.replace(/\.md$/, '');
}

/**
 * One SearchDoc for one markdown file of an okf bundle. The root `index.md` is the entry itself (id
 * `<ds>/<slug>`, path null, carries the lifecycle state); any other file is a sub-doc
 * (id `<ds>/<slug>/<path without .md>`). Title: frontmatter title, else the first `# ` heading, else
 * (the entry) frontmatter name / `entryTitle`, else the file name.
 */
export function okfDocToSearchDoc(a: {
  dataset: OkfDatasetId;
  slug: string;
  /** 'index.md' (the entry) | 'concepts/x.md' */
  relPath: string;
  data: Record<string, unknown>;
  body: string;
  entryTitle: string;
}): SearchDoc {
  const isEntry = a.relPath === OKF_ENTRY_FILE;
  const firstH1 = scanHeadings(a.body, 1)[0]?.text;
  const title =
    stringOr(a.data.title) ??
    firstH1 ??
    (isEntry ? (stringOr(a.data.name) ?? stringOr(a.entryTitle) ?? a.slug) : basename(a.relPath));
  const doc: SearchDoc = {
    id: isEntry
      ? `${a.dataset}/${a.slug}`
      : `${a.dataset}/${a.slug}/${a.relPath.replace(/\.md$/, '')}`,
    dataset: a.dataset,
    slug: a.slug,
    path: isEntry ? null : a.relPath,
    title,
    name: a.slug,
    description: stringOr(a.data.description) ?? '',
    tags: tagsOf(a.data.tags),
    headings: extractHeadings(a.body),
    body: markdownToText(a.body),
    url: isEntry ? entryUrl(a.dataset, a.slug) : docUrl(a.dataset, a.slug, a.relPath),
  };
  const state = isEntry ? stringOr(a.data.state) : undefined;
  if (state !== undefined) doc.state = state;
  return doc;
}

/** SKILL.md of a skill directory. Title = first `# ` heading, else the skill name. */
export function skillToSearchDoc(slug: string, data: SkillData, body: string): SearchDoc {
  return {
    id: `skill/${slug}`,
    dataset: 'skill',
    slug,
    path: null,
    title: scanHeadings(body, 1)[0]?.text ?? data.name,
    name: data.name,
    description: data.description,
    tags: [],
    headings: extractHeadings(body),
    body: markdownToText(body),
    url: entryUrl('skill', slug),
  };
}

/** A reference: the body is its data fields flattened to one readable line. */
export function referenceToSearchDoc(slug: string, data: ReferenceData): SearchDoc {
  const location = data.type === 'local-repo' ? data.path : data.uri;
  const uriKind = data.type === 'remote-skill' ? classifyRemoteUri(data.uri) : null;
  const body = [
    REFERENCE_TYPE_LABELS[data.type],
    uriKind ?? undefined,
    location,
    stringOr(data.subpath),
    `owner: ${OWNER_LABELS[data.owner]}`,
  ]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
  return {
    id: `reference/${slug}`,
    dataset: 'reference',
    slug,
    path: null,
    title: data.name,
    name: data.name,
    description: data.description,
    tags: [...data.tags],
    headings: [],
    body,
    url: entryUrl('reference', slug),
  };
}

/** A context: the body is its description, then one line per link (`kb/foo` + that link's notes text). */
export function contextToSearchDoc(slug: string, data: ContextData): SearchDoc {
  const lines = [
    data.description,
    ...data.links.map((link) => {
      const notes = link.notes === undefined ? '' : markdownToText(link.notes);
      return notes === ''
        ? `${link.dataset}/${link.slug}`
        : `${link.dataset}/${link.slug} ${notes}`;
    }),
  ];
  return {
    id: `context/${slug}`,
    dataset: 'context',
    slug,
    path: null,
    title: data.name,
    name: data.name,
    description: data.description,
    tags: [...data.tags],
    headings: [],
    body: truncate(lines.join('\n'), MAX_BODY_CHARS),
    url: entryUrl('context', slug),
  };
}

/**
 * A recipe: the body is its description, target and layout, listed contexts and ad hoc items, then the
 * plain text of the preamble and every markdown block.
 */
export function recipeToSearchDoc(slug: string, data: RecipeData): SearchDoc {
  const lines = [
    data.description,
    `target: ${TARGETS[data.target].label} · layout: ${data.layout}`,
    data.contexts.length > 0 ? `contexts: ${data.contexts.join(', ')}` : '',
    ...data.items.map((item) => itemKey(item.dataset, item.slug)),
    markdownToText(data.preamble ?? ''),
    ...data.markdown.map((block) => markdownToText(block.body)),
  ].filter((line) => line !== '');
  return {
    id: `recipe/${slug}`,
    dataset: 'recipe',
    slug,
    path: null,
    title: data.name,
    name: data.name,
    description: data.description,
    tags: [...data.tags],
    headings: [],
    body: truncate(lines.join('\n'), MAX_BODY_CHARS),
    url: entryUrl('recipe', slug),
  };
}
