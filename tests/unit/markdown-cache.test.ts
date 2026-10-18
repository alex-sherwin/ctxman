import { beforeEach, describe, expect, it } from 'vitest';
import { clearMarkdownCache, renderMarkdown } from '../../src/lib/markdown.ts';

beforeEach(() => clearMarkdownCache());

describe('renderMarkdown', () => {
  it('renders markdown and returns the identical string for the same source (memo)', async () => {
    const a = await renderMarkdown('# Hello\n\nSome **bold** text.');
    expect(a).toContain('<h1');
    expect(a).toContain('<strong>bold</strong>');
    expect(await renderMarkdown('# Hello\n\nSome **bold** text.')).toBe(a);
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

  it('keeps working past the cache cap (oldest entries are dropped)', async () => {
    for (let i = 0; i < 300; i++) await renderMarkdown(`item ${i}`);
    expect(await renderMarkdown('item 299')).toContain('item 299');
    expect(await renderMarkdown('item 0')).toContain('item 0');
  });
});
