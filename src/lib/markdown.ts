// SERVER-ONLY runtime markdown → HTML for strings that are not collection entries (context link notes).
// Uses Sätteri, the same processor Astro 7 uses for .md content, with the same Shiki config.
import { createSatteriMarkdownProcessor } from '@astrojs/markdown-satteri';
import { SHIKI_CONFIG } from './markdown-config.ts';

type Renderer = Awaited<ReturnType<typeof createSatteriMarkdownProcessor>>;
let renderer: Promise<Renderer> | undefined;

/** Render trusted local markdown to an HTML string (GFM, Shiki-highlighted code). '' for blank input. */
export async function renderMarkdown(markdown: string): Promise<string> {
  if (markdown.trim() === '') return '';
  renderer ??= createSatteriMarkdownProcessor({ shikiConfig: SHIKI_CONFIG });
  const result = await (await renderer).render(markdown);
  return result.code;
}
