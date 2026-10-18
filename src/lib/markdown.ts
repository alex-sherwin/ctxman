// NODE (no fs): runtime markdown -> HTML for every body ctxman shows (entry and doc bodies, context link notes).
// Sätteri, the processor Astro 7 uses for .md content, with Astro's own highlight and heading-id plugins and the
// shared Shiki config, but WITHOUT Astro's image plugins: those swap a relative `<img src>` for an `__ASTRO_IMAGE_`
// placeholder that only Astro's build-time asset pipeline resolves, and ctxman renders at request time. Image
// sources stay as written; rewriteRenderedHtml (links.ts) points them at the bundle file route. Results are
// memoized by the SHA-1 of the source (small FIFO cap) so a re-render of unchanged text is free.
import { createHash } from 'node:crypto';
import {
  satteriCreateHighlightFn,
  satteriHeadingIdsPlugin,
  satteriHighlightPlugin,
} from '@astrojs/markdown-satteri';
import { markdownToHtml } from 'satteri';
import { SHIKI_CONFIG } from './markdown-config.ts';

type HighlightFn = NonNullable<Awaited<ReturnType<typeof satteriCreateHighlightFn>>>;
let highlighter: Promise<HighlightFn | undefined> | undefined;

/** Code fence languages left unhighlighted (Astro's default `syntaxHighlight.excludeLangs`). */
const EXCLUDE_LANGS = ['math'];

/** Maximum number of memoized renderings; the oldest key is dropped when the cap is reached. */
const CACHE_MAX = 256;
const cache = new Map<string, string>();

/** Empties the memo (tests). */
export function clearMarkdownCache(): void {
  cache.clear();
}

/** Render trusted local markdown to an HTML string (GFM, Shiki-highlighted code). '' for blank input. */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (markdown.trim() === '') return '';
  const key = createHash('sha1').update(markdown).digest('hex');
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  highlighter ??= satteriCreateHighlightFn('shiki', SHIKI_CONFIG);
  const highlight = await highlighter;
  const { html } = await markdownToHtml(markdown, {
    hastPlugins: [
      ...(highlight ? [satteriHighlightPlugin(highlight, EXCLUDE_LANGS)] : []),
      satteriHeadingIdsPlugin(),
    ],
    // Astro's defaults (`markdown.gfm`, `markdown.smartypants`).
    features: { gfm: true, smartPunctuation: true },
  });
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, html);
  return html;
}
