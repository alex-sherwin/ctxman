import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkFileLinks,
  checkFrontmatterLinks,
  checkLinks,
  classifyHref,
  extractLinks,
  parseCtxmanHref,
  resolveBundleHref,
  rewriteRenderedHtml,
} from '../../src/lib/links.ts';
import { sortFindings } from '../../src/lib/findings.ts';
import { walkFiles } from '../../src/lib/bundles.ts';
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

/** A tree with every kind of link finding, relation findings included. */
function linkFixture(): Record<string, string> {
  return {
    ...validKbBundle('demo'),
    'feature/exists/main.md':
      '---\ntype: Feature\nname: exists\ndescription: d\nstate: pending\n---\n',
    'kb/demo/concepts/bad.md': [
      '---',
      'type: Concept',
      '---',
      '[broken](/concepts/missing.md) [escape](../../outside.md)',
      '[good](ctxman:feature/exists) [dangling](ctxman:feature/gone) [bad](ctxman:nope/x)',
    ].join('\n'),
    'task/rel/main.md': [
      '---',
      'type: Task',
      'name: rel',
      'description: d',
      'state: pending',
      'links:',
      '  - dataset: feature',
      '    slug: exists',
      '    rel: depends-on',
      '  - dataset: kb',
      '    slug: gone',
      '---',
      '[broken](./missing.md)',
    ].join('\n'),
    'skill/s/SKILL.md': '---\nname: s\ndescription: d\n---\n[bad](references/b.md)\n',
  };
}

describe('checkFileLinks', () => {
  it('reports exactly what checkLinks reports, file by file', async () => {
    const dir = tmp.make(linkFixture());
    const expected = (await checkLinks(dir)).findings;
    expect(expected.length).toBeGreaterThan(6);
    const actual: ReturnType<typeof checkFileLinks> = [];
    for (const [dataset, names] of [
      ['kb', ['demo']],
      ['task', ['rel']],
      ['feature', ['exists']],
      ['skill', ['s']],
    ] as const) {
      for (const name of names) {
        const root = path.join(dir, dataset, name);
        for (const relPath of (await walkFiles(root)).filter((f) => f.endsWith('.md'))) {
          const source = readFileSync(path.join(root, ...relPath.split('/')), 'utf8');
          actual.push(...checkFileLinks({ dataset, name, relPath, source, dataDir: dir }));
        }
      }
    }
    expect(sortFindings(actual)).toEqual(expected);
  });

  it('works on unsaved text: file path, frontmatter-relative lines, and the bundle on disk', () => {
    const dir = tmp.make({ ...validKbBundle('demo') });
    const source = '---\ntype: Concept\n---\n\n[ok](/main.md) [no](/concepts/nope.md)\n';
    expect(
      checkFileLinks({
        dataset: 'kb',
        name: 'demo',
        relPath: 'concepts/new.md',
        source,
        dataDir: dir,
      }),
    ).toEqual([
      {
        severity: 'error',
        rule: 'links/broken',
        file: 'kb/demo/concepts/new.md',
        line: 5,
        message: 'broken link "/concepts/nope.md": concepts/nope.md does not exist in the bundle',
      },
    ]);
  });

  it('runs the relation checks for an okf main.md only', () => {
    const dir = tmp.make();
    const source =
      '---\ntype: Task\nname: t\ndescription: d\nstate: pending\nlinks:\n  - dataset: kb\n    slug: gone\n---\n';
    const rules = (relPath: string, dataset: 'task' | 'skill' = 'task') =>
      checkFileLinks({ dataset, name: 't', relPath, source, dataDir: dir }).map((f) => f.rule);
    expect(rules('main.md')).toEqual(['links/relation-target']);
    expect(rules('concepts/x.md')).toEqual([]);
    expect(rules('main.md', 'skill')).toEqual([]);
  });
});

describe('checkFrontmatterLinks', () => {
  const entry = (links: string[], extra = ''): string =>
    `---\ntype: Task\nname: t\ndescription: d\nstate: pending\n${extra}links:\n${links.join('\n')}\n---\n# T\n`;
  const link = (dataset: string, slug: string, rel?: string): string =>
    `  - dataset: ${dataset}\n    slug: ${slug}${rel ? `\n    rel: ${rel}` : ''}`;
  const run = (source: string, dir: string, dataset: 'task' | 'kb' = 'task', name = 't') =>
    checkFrontmatterLinks({ dataset, name, source, dataDir: dir });

  it('passes links whose targets exist (any dataset, any rel)', () => {
    const dir = tmp.make({
      ...validDataTree(),
      'reference/ref.yaml': 'name: ref\ndescription: d\ntype: local-repo\npath: /x\nowner: me\n',
    });
    const source = entry([
      link('kb', 'demo', 'related'),
      link('task', 'do-it', 'child'),
      link('skill', 'my-skill', 'depends-on'),
      link('reference', 'ref'),
    ]);
    expect(run(source, dir)).toEqual([]);
  });

  it('warns links/relation-target on the line of the links: key, once per missing target', () => {
    const dir = tmp.make(validDataTree());
    const source = entry(
      [link('kb', 'demo'), link('feature', 'gone', 'child'), link('reference', 'nope')],
      'tags: [a]\n',
    );
    const findings = run(source, dir);
    expect(findings).toEqual([
      {
        severity: 'warning',
        rule: 'links/relation-target',
        file: 'task/t/main.md',
        line: 7,
        message: 'relation target feature/gone does not exist',
      },
      {
        severity: 'warning',
        rule: 'links/relation-target',
        file: 'task/t/main.md',
        line: 7,
        message: 'relation target reference/nope does not exist',
      },
    ]);
    // the key line really is the `links:` line of the file
    expect(source.split('\n')[6]).toBe('links:');
  });

  it('errors links/relation-self for a link to the entry itself, and does not also warn', () => {
    const dir = tmp.make();
    const findings = run(entry([link('task', 't', 'related'), link('task', 't', 'child')]), dir);
    expect(findings).toEqual([
      {
        severity: 'error',
        rule: 'links/relation-self',
        file: 'task/t/main.md',
        line: 6,
        message: 'an entry cannot link to itself',
      },
    ]);
    // same slug in another dataset is a different target
    expect(run(entry([link('kb', 't')]), tmp.make(validKbBundle('t')))).toEqual([]);
  });

  it('skips malformed items, a missing or non-array links key, and unparseable frontmatter', () => {
    const dir = tmp.make();
    const malformed = entry([
      '  - dataset: nope\n    slug: x',
      '  - dataset: kb\n    slug: Bad Slug',
      '  - dataset: kb\n    slug: x\n    rel: parent',
      '  - plain string',
    ]);
    expect(run(malformed, dir)).toEqual([]);
    expect(run('---\ntype: Task\nname: t\n---\n', dir)).toEqual([]);
    expect(run('---\ntype: Task\nlinks: nope\n---\n', dir)).toEqual([]);
    expect(run('---\ntype: [oops\nlinks:\n---\n', dir)).toEqual([]);
    expect(run('# no frontmatter\n', dir)).toEqual([]);
  });

  it('is part of checkLinks for every okf main.md (and not for concepts or skills)', async () => {
    const dir = tmp.make({
      ...validDataTree(),
      'task/rel/main.md': entry([link('kb', 'gone'), link('task', 'rel')]),
      'kb/demo/concepts/two.md':
        '---\ntype: Concept\nlinks:\n  - dataset: kb\n    slug: gone\n---\n',
    });
    const { findings } = await checkLinks(dir);
    expect(findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      'links/relation-self task/rel/main.md',
      'links/relation-target task/rel/main.md',
    ]);
    expect(byRule(findings, 'links/relation-self')[0]?.severity).toBe('error');
    expect(byRule(findings, 'links/relation-target')[0]?.severity).toBe('warning');
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

describe('rewriteRenderedHtml: broken target marking (with dataDir)', () => {
  const kbCtx = { dataset: 'kb', slug: 'demo', fromRelPath: 'main.md' } as const;
  const tag = (attrs: string) => `<p><a ${attrs}>x</a></p>`;
  const setup = () =>
    tmp.make({
      ...validKbBundle('demo'),
      'feature/exists/main.md':
        '---\ntype: Feature\nname: exists\ndescription: d\nstate: pending\n---\n',
      'skill/s/SKILL.md': '---\nname: s\ndescription: d\n---\n',
      'skill/s/references/a.md': '# A\n',
    });

  it('leaves everything alone without dataDir (existing behaviour)', () => {
    expect(rewriteRenderedHtml(tag('href="ctxman:feature/gone"'), kbCtx)).toBe(
      tag('href="/feature/gone"'),
    );
    expect(rewriteRenderedHtml(tag('href="/concepts/nope.md"'), kbCtx)).toBe(
      tag('href="/kb/demo/doc/concepts/nope"'),
    );
  });

  it('marks a ctxman: link to a missing entry and keeps the rewritten href', () => {
    const dataDir = setup();
    expect(rewriteRenderedHtml(tag('href="ctxman:feature/gone#a"'), { ...kbCtx, dataDir })).toBe(
      tag('href="/feature/gone#a" class="cx-link--broken" title="Missing: feature/gone"'),
    );
    expect(rewriteRenderedHtml(tag('href="ctxman:feature/exists"'), { ...kbCtx, dataDir })).toBe(
      tag('href="/feature/exists"'),
    );
    expect(
      rewriteRenderedHtml(tag('href="ctxman:reference/nope"'), { ...kbCtx, dataDir }),
    ).toContain('title="Missing: reference/nope"');
  });

  it('marks a malformed ctxman: link and leaves its href unchanged', () => {
    const dataDir = setup();
    for (const href of ['ctxman:nope/x', 'ctxman:kb/Bad_Slug', 'ctxman:kb']) {
      expect(rewriteRenderedHtml(tag(`href="${href}"`), { ...kbCtx, dataDir }), href).toBe(
        tag(`href="${href}" class="cx-link--broken" title="Invalid ctxman: link"`),
      );
    }
  });

  it('marks a missing bundle file (rewritten to its route) but not an existing one', () => {
    const dataDir = setup();
    expect(rewriteRenderedHtml(tag('href="/concepts/nope.md#h"'), { ...kbCtx, dataDir })).toBe(
      tag(
        'href="/kb/demo/doc/concepts/nope#h" class="cx-link--broken" title="Missing file: concepts/nope.md"',
      ),
    );
    expect(rewriteRenderedHtml(tag('href="/concepts/one.md"'), { ...kbCtx, dataDir })).toBe(
      tag('href="/kb/demo/doc/concepts/one"'),
    );
    // resolved against the file being rendered, and non-md targets are checked too
    const sub = { ...kbCtx, fromRelPath: 'concepts/one.md', dataDir };
    expect(rewriteRenderedHtml(tag('href="../main.md"'), sub)).toBe(tag('href="/kb/demo"'));
    expect(rewriteRenderedHtml(tag('href="missing.json"'), sub)).toBe(
      tag(
        'href="missing.json" class="cx-link--broken" title="Missing file: concepts/missing.json"',
      ),
    );
  });

  it('marks a bundle target that leaves the bundle', () => {
    const dataDir = setup();
    expect(rewriteRenderedHtml(tag('href="../../escape.md"'), { ...kbCtx, dataDir })).toBe(
      tag('href="../../escape.md" class="cx-link--broken" title="Points outside the bundle"'),
    );
  });

  it('checks skill bundle targets without rewriting them', () => {
    const dataDir = setup();
    const skill = { dataset: 'skill', slug: 's', fromRelPath: 'SKILL.md', dataDir } as const;
    expect(rewriteRenderedHtml(tag('href="references/a.md"'), skill)).toBe(
      tag('href="references/a.md"'),
    );
    expect(rewriteRenderedHtml(tag('href="references/b.md"'), skill)).toBe(
      tag('href="references/b.md" class="cx-link--broken" title="Missing file: references/b.md"'),
    );
  });

  it('does not check bundle targets for datasets without a bundle directory (context notes, recipes)', () => {
    const dataDir = setup();
    for (const dataset of ['context', 'recipe'] as const) {
      const ctx = { dataset, slug: 'c', fromRelPath: '', dataDir };
      expect(rewriteRenderedHtml(tag('href="some/where.md"'), ctx)).toBe(
        tag('href="some/where.md"'),
      );
      expect(rewriteRenderedHtml(tag('href="ctxman:kb/gone"'), ctx)).toContain('cx-link--broken');
      expect(rewriteRenderedHtml(tag('href="ctxman:kb/demo"'), ctx)).toBe(tag('href="/kb/demo"'));
    }
  });

  it('merges into an existing class, replaces an existing title, keeps other attributes', () => {
    const dataDir = setup();
    const ctx = { ...kbCtx, dataDir };
    expect(
      rewriteRenderedHtml('<a class="btn primary" href="ctxman:kb/gone" title="Old">x</a>', ctx),
    ).toBe('<a class="btn primary cx-link--broken" href="/kb/gone" title="Missing: kb/gone">x</a>');
    expect(rewriteRenderedHtml("<a href='ctxman:kb/gone' class='k'>x</a>", ctx)).toBe(
      '<a href="/kb/gone" class="k cx-link--broken" title="Missing: kb/gone">x</a>',
    );
    // already marked: not added twice
    expect(rewriteRenderedHtml('<a href="ctxman:kb/gone" class="cx-link--broken">x</a>', ctx)).toBe(
      '<a href="/kb/gone" class="cx-link--broken" title="Missing: kb/gone">x</a>',
    );
  });

  it('never marks external links, anchors or tags without an href', () => {
    const dataDir = setup();
    const ctx = { ...kbCtx, dataDir };
    expect(rewriteRenderedHtml(tag('href="#top"'), ctx)).toBe(tag('href="#top"'));
    expect(rewriteRenderedHtml(tag('href="mailto:a@b.c"'), ctx)).toBe(tag('href="mailto:a@b.c"'));
    expect(rewriteRenderedHtml(tag('href="https://example.com/x.md"'), ctx)).not.toContain(
      'cx-link--broken',
    );
    expect(rewriteRenderedHtml('<a name="x">x</a>', ctx)).toBe('<a name="x">x</a>');
  });
});
