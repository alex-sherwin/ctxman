import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMarkdownCache,
  markdownCacheSize,
  MEMO_BUDGET_CHARS,
  renderMarkdown,
  renderMarkdownDoc,
} from '../../src/lib/markdown.ts';

beforeEach(() => clearMarkdownCache());

describe('renderMarkdown', () => {
  it('renders markdown and returns the identical string for the same source (memo)', async () => {
    const a = await renderMarkdown('# Hello\n\nSome **bold** text.');
    expect(a).toContain('<h1');
    expect(a).toContain('<strong>bold</strong>');
    expect(await renderMarkdown('# Hello\n\nSome **bold** text.')).toBe(a);
  });

  it('memo: false renders every time and keeps nothing; highlight: false leaves code blocks plain', async () => {
    const source = '# Preview\n\n```ts\nconst a = 1;\n```\n';
    const a = await renderMarkdown(source, { memo: false, highlight: false });
    expect(markdownCacheSize()).toEqual({ entries: 0, chars: 0 });
    expect(a).toContain('<h1 id="preview">Preview</h1>');
    expect(a).not.toContain('astro-code');
    expect(a).toContain('<div class="cx-codeblock"><pre><code class="language-ts">const a = 1;');
    expect(await renderMarkdown(source, { memo: false })).toContain('astro-code');
    expect(markdownCacheSize().entries).toBe(0);
    await renderMarkdown(source);
    expect(markdownCacheSize().entries).toBe(1);
  });

  it('the memo stays within its character budget; a rendering over a quarter of it is not kept', async () => {
    const big = `${'word '.repeat(MEMO_BUDGET_CHARS / 4 / 5 + 10)}\n`;
    await renderMarkdown(big);
    expect(markdownCacheSize()).toEqual({ entries: 0, chars: 0 });
    const html = await renderMarkdown('Small **one**');
    expect(markdownCacheSize()).toEqual({ entries: 1, chars: html.length });
  });

  it('returns an empty string for blank input', async () => {
    expect(await renderMarkdown('  \n')).toBe('');
  });

  it('keeps relative images as plain <img src alt> (no Astro image placeholder)', async () => {
    const html = await renderMarkdown(
      '![alt text](now.heic) ![b](./img/a.png "t") ![c](/root.png)',
    );
    expect(html.trim()).toBe(
      '<p><img src="now.heic" alt="alt text"> <img src="./img/a.png" alt="b" title="t"> <img src="/root.png" alt="c"></p>',
    );
    expect(html).not.toMatch(/astro_image/i);
  });

  it('keeps the Astro pipeline features: heading ids, Shiki, smart punctuation, GFM', async () => {
    const html = await renderMarkdown(
      '# Hello World\n\n"quoted" -- text\n\n```ts\nconst a = 1;\n```\n\n| a |\n| - |\n| 1 |\n\n```math\nx\n```\n',
    );
    expect(html).toContain('<h1 id="hello-world">Hello World</h1>');
    expect(html).toContain('“quoted” – text');
    expect(html).toContain('<pre class="astro-code ctxman-cyber"');
    expect(html).toContain('<table>');
    expect(html).toContain('<code class="language-math">x');
  });

  it('wraps every code block with a floating Copy button (highlighted, plain and nested ones)', async () => {
    const html = await renderMarkdown(
      '```ts\nconst a = 1;\n```\n\n```\nplain\n```\n\n- item\n\n  ```sh\n  ls\n  ```\n\nInline `code` stays.\n',
    );
    expect(html.match(/<div class="cx-codeblock"><pre /g)).toHaveLength(3);
    expect(
      html.match(/<button type="button" class="[^"]*cx-codeblock__copy" data-copy-code/g),
    ).toHaveLength(3);
    // the button and its live region follow the <pre> inside the wrapper
    expect(html).toContain(
      '</code></pre><button type="button" class="ck-button ck-button--ghost ck-button--sm ck-button--glow ck-copy cx-codeblock__copy" data-copy-code="" aria-label="Copy code">',
    );
    expect(html).toContain(
      '<span class="ck-sr-only" role="status" data-copy-status=""></span></div>',
    );
    expect(html).toContain('<svg class="ck-icon ck-copy__check" width="13" height="13"');
    expect(html).toContain('<p>Inline <code>code</code> stays.</p>');
  });

  it('collects the headings with their ids and text (not the footnotes label)', async () => {
    const { headings } = await renderMarkdownDoc(
      '# Title\n\nText[^1].\n\n## Use `code` here\n\n### Sub\n\n## Use code here\n\n[^1]: Note.\n',
    );
    expect(headings).toEqual([
      { depth: 1, id: 'title', text: 'Title' },
      { depth: 2, id: 'use-code-here', text: 'Use code here' },
      { depth: 3, id: 'sub', text: 'Sub' },
      { depth: 2, id: 'use-code-here-1', text: 'Use code here' },
    ]);
    expect(await renderMarkdownDoc('  ')).toEqual({ html: '', headings: [] });
  });

  it('keeps working past the cache cap (oldest entries are dropped)', async () => {
    for (let i = 0; i < 300; i++) await renderMarkdown(`item ${i}`);
    expect(await renderMarkdown('item 299')).toContain('item 299');
    expect(await renderMarkdown('item 0')).toContain('item 0');
  });
});
