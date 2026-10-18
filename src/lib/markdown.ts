// NODE (no fs): runtime markdown -> HTML for every body ctxman shows (entry and doc bodies, context link notes).
// Uses Sätteri, the processor Astro 7 uses for .md content, with the shared Shiki config. Results are memoized by
// the SHA-1 of the source (small FIFO cap) so a re-render of unchanged text is free.
import { createHash } from 'node:crypto';
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import { SHIKI_CONFIG } from './markdown-config.ts';

type Renderer = Awaited<ReturnType<typeof createSatteriMarkdownProcessor>>;
let renderer: Promise<Renderer> | undefined;

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
  renderer ??= createSatteriMarkdownProcessor({ shikiConfig: SHIKI_CONFIG });
  const result = await (await renderer).render(markdown);
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result.code);
  return result.code;
}
