// PURE (no fs, no `astro:*`; browser-safe): text helpers for inserting `ctxman:<dataset>/<slug>` links into
// markdown from Monaco's completion provider (src/ui/editor/link-completion.ts) and the EntryPicker
// (ROUND3_SPEC §F.1). Decides WHEN a link completion applies, WHAT text replaces the typed fragment, and how a
// markdown link is written.

export type LinkCompletionKind = 'target' | 'paren' | 'wiki' | 'word';

export interface LinkCompletionContext {
  kind: LinkCompletionKind;
  /** 0-based start of the replaced text in `before`. */
  start: number;
  /** The fragment typed so far (after `ctxman:` / `](` / `[[`; the whole word for 'word'). */
  typed: string;
}

/** The minimum of an entry the helpers need. */
export interface LinkEntry {
  dataset: string;
  slug: string;
  title: string;
}

const TARGET_RE = /(?:^|[\s(<[])ctxman:([a-z0-9/-]*)$/i;
const PAREN_RE = /\]\(([^\s()]*)$/;
const WIKI_RE = /\[\[([^[\]]*)$/;
const WORD_RE = /[\w-]*$/;

const SCHEME = 'ctxman:';

/**
 * Which completion (if any) applies at the cursor. `before` = the line text left of the cursor. First match wins:
 * - target: `ctxman:<typed>` after whitespace, `(`, `<` or `[` (or at the line start); only the part after the
 *   scheme is replaced.
 * - paren: `](<typed>` where `<typed>` is a prefix of `ctxman:` (so `](` and `](ctx` complete, `](./x.md` does not).
 * - wiki: `[[<typed>`; the `[[` is replaced by the whole link.
 * - word: only when `opts.explicit` (Ctrl+Space): the word before the cursor (possibly empty).
 * A bare `[` never triggers (task lists `- [ ]` and footnotes would fire on every keystroke).
 */
export function linkCompletionContext(
  before: string,
  opts: { explicit: boolean },
): LinkCompletionContext | null {
  const target = TARGET_RE.exec(before);
  if (target) {
    const typed = target[1] ?? '';
    return { kind: 'target', start: before.length - typed.length, typed };
  }
  const paren = PAREN_RE.exec(before);
  if (paren) {
    const typed = paren[1] ?? '';
    if (SCHEME.startsWith(typed.toLowerCase())) {
      return { kind: 'paren', start: before.length - typed.length, typed };
    }
  }
  const wiki = WIKI_RE.exec(before);
  if (wiki) return { kind: 'wiki', start: wiki.index, typed: wiki[1] ?? '' };
  if (opts.explicit) {
    const word = WORD_RE.exec(before);
    const typed = word?.[0] ?? '';
    return { kind: 'word', start: before.length - typed.length, typed };
  }
  return null;
}

/** Escapes `\`, `[` and `]` so the text cannot end the link text early (same as `templates.ts` `linkText`). */
export function escapeLinkText(s: string): string {
  return s.replace(/([\\[\]])/g, '\\$1');
}

/** `[Title](ctxman:ds/slug)`, the title escaped. */
export function markdownLink(title: string, ds: string, slug: string): string {
  return `[${escapeLinkText(title)}](${SCHEME}${ds}/${slug})`;
}

/**
 * The text that replaces the completion range. target: `ds/slug`; paren: `ctxman:ds/slug` plus a closing `)`
 * unless the text after the cursor already starts with one; wiki and word: the whole markdown link.
 */
export function linkInsertText(kind: LinkCompletionKind, e: LinkEntry, after: string): string {
  switch (kind) {
    case 'target':
      return `${e.dataset}/${e.slug}`;
    case 'paren':
      return `${SCHEME}${e.dataset}/${e.slug}${after.startsWith(')') ? '' : ')'}`;
    case 'wiki':
    case 'word':
      return markdownLink(e.title, e.dataset, e.slug);
  }
}

/**
 * What Monaco filters the typed fragment against. It starts with the text that is already in the range, so the
 * typed prefix always matches: target `ds/slug title`; paren `ctxman:ds/slug title`; wiki `[[title ds/slug`;
 * word `title ds/slug`.
 */
export function linkFilterText(kind: LinkCompletionKind, e: LinkEntry): string {
  switch (kind) {
    case 'target':
      return `${e.dataset}/${e.slug} ${e.title}`;
    case 'paren':
      return `${SCHEME}${e.dataset}/${e.slug} ${e.title}`;
    case 'wiki':
      return `[[${e.title} ${e.dataset}/${e.slug}`;
    case 'word':
      return `${e.title} ${e.dataset}/${e.slug}`;
  }
}
