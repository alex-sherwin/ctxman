import { afterEach, describe, expect, it } from 'vitest';
import {
  checkLinks,
  classifyHref,
  extractLinks,
  parseCtxmanHref,
  resolveBundleHref,
  rewriteRenderedHtml,
} from '../../src/lib/links.ts';
import {
  byRule,
  ruleIds,
  trackTemp,
  validDataTree,
  validKbBundle,
} from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

describe('extractLinks', () => {
  it('finds inline links, images, reference definitions and autolinks with line numbers', () => {
    const md = [
      '# Title', // 1
      '', // 2
      'See [one](/a.md) and ![pic](./pic.png "Title").', // 3
      '', // 4
      '[ref]: ./ref.md "Ref title"', // 5
      'Auto <https://example.com/auto> link.', // 6
      '[multi', // 7
      'line](/ml.md)', // 8
      '[parens](/p_(x).md) and [angle](<my file.md>)', // 9
      '[empty]()', // 10
    ].join('\n');
    expect(extractLinks(md).map((l) => [l.href, l.text, l.line, l.image])).toEqual([
      ['/a.md', 'one', 3, false],
      ['./pic.png', 'pic', 3, true],
      ['./ref.md', 'ref', 5, false],
      ['https://example.com/auto', 'https://example.com/auto', 6, false],
      ['/ml.md', 'multi\nline', 7, false],
      ['/p_(x).md', 'parens', 9, false],
      ['my file.md', 'angle', 9, false],
      ['', 'empty', 10, false],
    ]);
  });

  it('skips fenced code (backtick and tilde), inline code and footnote markers', () => {
    const md = [
      '```md',
      '[fenced](/skip1.md)',
      '```',
      '~~~',
      '[tilde](/skip2.md)',
      '~~~',
      'Inline `[code](/skip3.md)` and ``[double](/skip4.md)`` here.',
      'Footnote[^1] and [real](/keep.md).',
      '',
      '[^1]: [def](/keep2.md)',
    ].join('\n');
    expect(extractLinks(md).map((l) => l.href)).toEqual(['/keep.md', '/keep2.md']);
  });

  it('handles CRLF line endings (fences, line numbers, definitions)', () => {
    const md = '# T\r\n\r\n```\r\n[skip](/s.md)\r\n```\r\n[a](/a.md)\r\n[ref]: /r.md\r\n';
    expect(extractLinks(md).map((l) => [l.href, l.line])).toEqual([
      ['/a.md', 6],
      ['/r.md', 7],
    ]);
  });

  it('keeps nested links in images inside links and ignores a lone bracket', () => {
    const md = '[![badge](img.svg)](/target.md) and [just text] and \\[escaped](/no.md)';
    expect(extractLinks(md).map((l) => l.href)).toEqual(['/target.md', 'img.svg']);
  });

  it('does not let an unclosed fence or backtick swallow other paragraphs wrongly', () => {
    const md = 'A stray ` backtick\n\n[kept](/k.md)\n\n`code` and [also](/a.md)';
    expect(extractLinks(md).map((l) => l.href)).toEqual(['/k.md', '/a.md']);
  });
});

describe('classifyHref', () => {
  it.each([
    ['#section', 'anchor'],
    ['ctxman:feature/x', 'ctxman'],
    ['CTXMAN:feature/x', 'ctxman'],
    ['https://example.com', 'external'],
    ['mailto:a@b.c', 'external'],
    ['file:///tmp/x', 'external'],
    ['//cdn.example.com/x.js', 'external'],
    ['/concepts/x.md', 'bundle'],
    ['./x.md', 'bundle'],
    ['../x.md#a', 'bundle'],
    ['x.md', 'bundle'],
    ['dir/file.md', 'bundle'],
  ] as const)('%s -> %s', (href, expected) => {
    expect(classifyHref(href)).toBe(expected);
  });
});

describe('resolveBundleHref', () => {
  it('resolves bundle-root paths', () => {
    expect(resolveBundleHref('/concepts/x.md', 'main.md')).toEqual({ path: 'concepts/x.md' });
    expect(resolveBundleHref('/x.md', 'concepts/deep/y.md')).toEqual({ path: 'x.md' });
  });

  it('resolves relative paths against the source file directory', () => {
    expect(resolveBundleHref('./x.md', 'main.md')).toEqual({ path: 'x.md' });
    expect(resolveBundleHref('x.md', 'concepts/y.md')).toEqual({ path: 'concepts/x.md' });
    expect(resolveBundleHref('../main.md', 'concepts/y.md')).toEqual({ path: 'main.md' });
    expect(resolveBundleHref('a/../b.md', 'main.md')).toEqual({ path: 'b.md' });
  });

  it('flags paths that leave the bundle', () => {
    expect(resolveBundleHref('../x.md', 'main.md')).toEqual({ escapes: true });
    expect(resolveBundleHref('../../x.md', 'concepts/y.md')).toEqual({ escapes: true });
    expect(resolveBundleHref('/../x.md', 'main.md')).toEqual({ escapes: true });
  });

  it('drops query and fragment and decodes percent-escapes', () => {
    expect(resolveBundleHref('x.md#section', 'main.md')).toEqual({ path: 'x.md' });
    expect(resolveBundleHref('x.md?raw=1#a', 'main.md')).toEqual({ path: 'x.md' });
    expect(resolveBundleHref('my%20file.md', 'main.md')).toEqual({ path: 'my file.md' });
    expect(resolveBundleHref('bad%zz.md', 'main.md')).toEqual({ path: 'bad%zz.md' });
  });
});

describe('parseCtxmanHref', () => {
  it('parses dataset, slug and fragment', () => {
    expect(parseCtxmanHref('ctxman:feature/context-forge')).toEqual({
      dataset: 'feature',
      slug: 'context-forge',
    });
    expect(parseCtxmanHref('ctxman:kb/ctxman#overview')).toEqual({
      dataset: 'kb',
      slug: 'ctxman',
      fragment: 'overview',
    });
    expect(parseCtxmanHref('ctxman:context/my-ctx')).toEqual({
      dataset: 'context',
      slug: 'my-ctx',
    });
  });

  it('rejects unknown datasets, bad slugs and extra segments', () => {
    for (const bad of [
      'ctxman:nope/x',
      'ctxman:kb/Bad_Slug',
      'ctxman:kb',
      'ctxman:kb/a/b',
      'ctxman:/kb/x',
      'ctxman:kb/x?y=1',
    ]) {
      expect(parseCtxmanHref(bad), bad).toBeNull();
    }
  });
});

describe('checkLinks', () => {
  it('passes a clean data tree (okf bundle, skill dir, ctxman targets)', async () => {
    const dir = tmp.make(validDataTree());
    const result = await checkLinks(dir);
    expect(result.findings).toEqual([]);
    expect(result.filesChecked).toBeGreaterThanOrEqual(5);
  });

  it('reports broken, escaping, invalid and dangling links with file and line', async () => {
    const dir = tmp.make({
      ...validKbBundle('demo'),
      'feature/exists/main.md':
        '---\ntype: Feature\nname: exists\ndescription: d\nstate: pending\n---\n',
      'kb/demo/concepts/bad.md': [
        '---',
        'type: Concept',
        '---',
        '# Bad', // 4
        '',
        '[broken](/concepts/missing.md)', // 6
        '[rel broken](../nope.md#x)', // 7
        '[escape](../../outside.md)', // 8
        '[img](./missing.png)', // 9
        '[fine](/main.md) [web](https://example.com/x.md) [top](#top)', // 10
        '[good](ctxman:feature/exists) [dangling](ctxman:feature/gone#a)', // 11
        '[invalid](ctxman:nodataset/x) [bad slug](ctxman:kb/Bad_Slug)', // 12
        '```',
        '[in fence](/ignored.md)',
        '```',
      ].join('\n'),
    });
    const { findings } = await checkLinks(dir);
    const file = 'kb/demo/concepts/bad.md';
    expect(findings.every((f) => f.file === file)).toBe(true);
    const at = (rule: string) => byRule(findings, rule).map((f) => f.line);
    expect(at('links/broken')).toEqual([6, 7, 9]);
    expect(at('links/escapes-bundle')).toEqual([8]);
    expect(at('links/ctxman-target')).toEqual([11]);
    expect(at('links/ctxman-invalid')).toEqual([12, 12]);
    expect(byRule(findings, 'links/ctxman-target')[0]?.severity).toBe('warning');
    expect(byRule(findings, 'links/broken')[0]?.severity).toBe('error');
    expect(ruleIds(findings)).toEqual([
      'links/broken',
      'links/ctxman-invalid',
      'links/ctxman-target',
      'links/escapes-bundle',
    ]);
  });

  it('checks skill directories against the skill root', async () => {
    const dir = tmp.make({
      'skill/s/SKILL.md':
        '---\nname: s\ndescription: d\n---\n\n[ok](references/a.md) [bad](references/b.md) [root](/references/a.md)\n',
      'skill/s/references/a.md': '# A\n[up](../SKILL.md)\n',
    });
    const { findings, filesChecked } = await checkLinks(dir);
    expect(filesChecked).toBe(2);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'links/broken',
      file: 'skill/s/SKILL.md',
      line: 6,
    });
  });

  it('reports lines relative to the file, not the body, when frontmatter is present', async () => {
    const dir = tmp.make({
      'kb/demo/main.md': '---\ntype: T\nname: demo\ndescription: d\n---\n\n[x](/missing.md)\n',
    });
    const { findings } = await checkLinks(dir);
    expect(findings[0]?.line).toBe(7);
  });
});

describe('rewriteRenderedHtml', () => {
  const ctx = { dataset: 'kb', slug: 'ctxman', fromRelPath: 'main.md' } as const;
  const html = (href: string) => `<p><a href="${href}">x</a></p>`;

  it('maps main.md to the entry page and other .md files to sub-doc routes', () => {
    expect(rewriteRenderedHtml(html('/main.md'), ctx)).toBe(html('/kb/ctxman'));
    expect(rewriteRenderedHtml(html('/concepts/datasets.md'), ctx)).toBe(
      html('/kb/ctxman/doc/concepts/datasets'),
    );
    expect(rewriteRenderedHtml(html('./log.md'), ctx)).toBe(html('/kb/ctxman/doc/log'));
  });

  it('resolves relative to the page being rendered and keeps fragments', () => {
    const sub = { ...ctx, fromRelPath: 'concepts/search.md' };
    expect(rewriteRenderedHtml(html('../main.md#overview'), sub)).toBe(html('/kb/ctxman#overview'));
    expect(rewriteRenderedHtml(html('datasets.md#a'), sub)).toBe(
      html('/kb/ctxman/doc/concepts/datasets#a'),
    );
  });

  it('encodes spaces in sub-doc paths', () => {
    expect(rewriteRenderedHtml(html('my%20file.md'), ctx)).toBe(html('/kb/ctxman/doc/my%20file'));
  });

  it('rewrites ctxman: links to entry routes', () => {
    expect(rewriteRenderedHtml(html('ctxman:feature/context-forge'), ctx)).toBe(
      html('/feature/context-forge'),
    );
    expect(rewriteRenderedHtml(html('ctxman:kb/x#a'), ctx)).toBe(html('/kb/x#a'));
    expect(rewriteRenderedHtml(html('ctxman:bogus/x'), ctx)).toBe(html('ctxman:bogus/x'));
  });

  it('opens external links in a new tab and leaves anchors and non-md targets alone', () => {
    expect(rewriteRenderedHtml(html('https://example.com/a?b=1&amp;c=2'), ctx)).toBe(
      '<p><a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noreferrer">x</a></p>',
    );
    expect(rewriteRenderedHtml('<a href="https://e.com" target="_self">x</a>', ctx)).toBe(
      '<a href="https://e.com" target="_self" rel="noreferrer">x</a>',
    );
    expect(rewriteRenderedHtml(html('//cdn.example.com/x'), ctx)).toContain('target="_blank"');
    expect(rewriteRenderedHtml(html('mailto:a@b.c'), ctx)).toBe(html('mailto:a@b.c'));
    expect(rewriteRenderedHtml(html('#top'), ctx)).toBe(html('#top'));
    expect(rewriteRenderedHtml(html('/assets/pic.png'), ctx)).toBe(html('/assets/pic.png'));
    expect(rewriteRenderedHtml(html('../../escape.md'), ctx)).toBe(html('../../escape.md'));
  });

  it('only touches <a href>, not other markup', () => {
    const src = '<img src="/x.md"><code>href="/y.md"</code><link href="/z.md">';
    expect(rewriteRenderedHtml(src, ctx)).toBe(src);
  });

  it('leaves bundle links unchanged for skill entries but still rewrites ctxman: and external', () => {
    const skill = { dataset: 'skill', slug: 's', fromRelPath: 'SKILL.md' } as const;
    expect(rewriteRenderedHtml(html('references/a.md'), skill)).toBe(html('references/a.md'));
    expect(rewriteRenderedHtml(html('ctxman:kb/x'), skill)).toBe(html('/kb/x'));
    expect(rewriteRenderedHtml(html('https://e.com'), skill)).toContain('target="_blank"');
  });

  it('does not misinterpret $ patterns in rewritten URLs', () => {
    expect(rewriteRenderedHtml(html('/a$&amp;b.md'), ctx)).toBe(html('/kb/ctxman/doc/a$&amp;b'));
  });
});
