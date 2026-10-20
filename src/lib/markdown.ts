// NODE (no fs): runtime markdown -> HTML for every body ctxman shows (entry and doc bodies, context link notes).
// Sätteri, the processor Astro 7 uses for .md content, with Astro's own highlight and heading-id plugins and the
// shared Shiki config, but WITHOUT Astro's image plugins: those swap a relative `<img src>` for an `__ASTRO_IMAGE_`
// placeholder that only Astro's build-time asset pipeline resolves, and ctxman renders at request time. Image
// sources stay as written; rewriteRenderedHtml (links.ts) points them at the bundle file route. Two plugins of our
// own: every code block gets a Copy button (`div.cx-codeblock > pre + button[data-copy-code]`, src/scripts/shell.ts
// copies the block's text) and the headings are collected for the page's headings nav. Results are memoized by the
// SHA-1 of the source (small FIFO cap) so a re-render of unchanged text is free.
import { createHash } from 'node:crypto';
import {
  satteriCreateHighlightFn,
  satteriHeadingIdsPlugin,
  satteriHighlightPlugin,
} from '@astrojs/markdown-satteri';
import { markdownToHtml } from 'satteri';
import type { HastPluginDefinition } from 'satteri';
import { iconSvg } from '../ui/kit/icons.ts';
import { SHIKI_CONFIG } from './markdown-config.ts';

type HighlightFn = NonNullable<Awaited<ReturnType<typeof satteriCreateHighlightFn>>>;
let highlighter: Promise<HighlightFn | undefined> | undefined;

/** Code fence languages left unhighlighted (Astro's default `syntaxHighlight.excludeLangs`). */
const EXCLUDE_LANGS = ['math'];

/** One heading of a rendered document, in document order. */
export interface MarkdownHeading {
  /** 1-6. */
  depth: number;
  /** The `id` the heading-ids plugin gave it (the anchor). */
  id: string;
  /** Its plain text. */
  text: string;
}

export interface RenderedMarkdown {
  html: string;
  headings: MarkdownHeading[];
}

/** Maximum number of memoized renderings; the oldest key is dropped when the cap is reached. */
const CACHE_MAX = 256;
const cache = new Map<string, RenderedMarkdown>();

/** Empties the memo (tests). */
export function clearMarkdownCache(): void {
  cache.clear();
}

/**
 * The wrapper every `<pre>` is moved into (as its first child): the SSR copy button (the markup of
 * src/components/CopyButton.astro without `data-copy`; `data-copy-code` copies the sibling `<pre>`) and its live region.
 */
const CODE_BLOCK_WRAPPER =
  '<div class="cx-codeblock">' +
  '<button type="button" class="ck-button ck-button--ghost ck-button--sm ck-button--glow ck-copy cx-codeblock__copy" data-copy-code aria-label="Copy code">' +
  `<span class="ck-button__label"><span class="ck-copy__face"><span class="ck-copy__text">Copy</span>${iconSvg('check', 13, 'ck-copy__check')}</span></span>` +
  '</button><span class="ck-sr-only" role="status" data-copy-status></span></div>';

const codeCopyPlugin: HastPluginDefinition = {
  name: 'ctxman-code-copy',
  element: {
    filter: ['pre'],
    visit(node, ctx) {
      ctx.wrapNode(node, { raw: CODE_BLOCK_WRAPPER });
    },
  },
};

/** Collects the headings (after heading-ids gave them their `id`) into `out`; GFM's sr-only "Footnotes" label is left out. */
function collectHeadingsPlugin(out: MarkdownHeading[]): HastPluginDefinition {
  return {
    name: 'ctxman-collect-headings',
    element: {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      visit(node, ctx) {
        const props = node.properties ?? {};
        const id = props.id;
        const className = Array.isArray(props.className) ? props.className : [];
        if (typeof id !== 'string' || id === '' || className.includes('sr-only')) return;
        const text = ctx.textContent(node).replace(/\s+/g, ' ').trim();
        if (text === '') return;
        out.push({ depth: Number.parseInt(node.tagName.slice(1), 10), id, text });
      },
    },
  };
}

/**
 * Render trusted local markdown to an HTML string (GFM, Shiki-highlighted code with a Copy button) plus its headings.
 * Blank input renders to '' with no headings.
 */
export async function renderMarkdownDoc(markdown: string): Promise<RenderedMarkdown> {
  if (markdown.trim() === '') return { html: '', headings: [] };
  const key = createHash('sha1').update(markdown).digest('hex');
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  highlighter ??= satteriCreateHighlightFn('shiki', SHIKI_CONFIG);
  const highlight = await highlighter;
  const headings: MarkdownHeading[] = [];
  const { html } = await markdownToHtml(markdown, {
    hastPlugins: [
      ...(highlight ? [satteriHighlightPlugin(highlight, EXCLUDE_LANGS)] : []),
      satteriHeadingIdsPlugin(),
      collectHeadingsPlugin(headings),
      codeCopyPlugin,
    ],
    // Astro's defaults (`markdown.gfm`, `markdown.smartypants`).
    features: { gfm: true, smartPunctuation: true },
  });
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const rendered = { html, headings };
  cache.set(key, rendered);
  return rendered;
}

/** Render trusted local markdown to an HTML string (see {@link renderMarkdownDoc}). '' for blank input. */
export async function renderMarkdown(markdown: string): Promise<string> {
  return (await renderMarkdownDoc(markdown)).html;
}
