import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_CHARS,
  contextToSearchDoc,
  extractHeadings,
  markdownToText,
  okfDocToSearchDoc,
  recipeToSearchDoc,
  referenceToSearchDoc,
  skillToSearchDoc,
} from '../../src/lib/search-index.ts';
import {
  contextSchema,
  recipeSchema,
  referenceSchema,
  skillSchema,
} from '../../src/datasets/schemas.ts';
import { assertValid } from '../../src/datasets/validate.ts';

describe('markdownToText', () => {
  it('drops frontmatter (LF, CRLF, BOM) but keeps a later --- rule out of the way', () => {
    expect(markdownToText('---\ntype: Task\nname: x\n---\nHello world')).toBe('Hello world');
    expect(markdownToText('---\r\ntype: Task\r\n---\r\nBody\r\nline')).toBe('Body line');
    expect(markdownToText('﻿---\na: 1\n---\nBody')).toBe('Body');
    expect(markdownToText('---\n---\nBody')).toBe('Body');
    // not frontmatter: no closing fence
    expect(markdownToText('---\nstill text')).toBe('still text');
  });

  it('removes heading markers, blockquote, list and task markers', () => {
    const md =
      '# Title\n\n## Sub ##\n\n> quoted\n\n- one\n* two\n+ three\n1. first\n2) second\n- [x] done\n- [ ] todo';
    expect(markdownToText(md)).toBe('Title Sub quoted one two three first second done todo');
  });

  it('keeps link and image text, drops urls and titles', () => {
    expect(markdownToText('See [the docs](https://example.com/a?b=1 "Title") now')).toBe(
      'See the docs now',
    );
    expect(markdownToText('![alt text](img.png) after')).toBe('alt text after');
    expect(markdownToText('[ref link][id] and [collapsed][]')).toBe('ref link and collapsed');
    expect(markdownToText('[id]: https://example.com "Title"\ntext')).toBe('text');
    expect(markdownToText('[link to page](/concepts/datasets.md#heading)')).toBe('link to page');
    expect(markdownToText('[ctx](ctxman:feature/context-forge)')).toBe('ctx');
    expect(markdownToText('Go to <https://example.com/x> ok')).toBe(
      'Go to https://example.com/x ok',
    );
  });

  it('removes emphasis markers and strikethrough but keeps snake_case', () => {
    expect(markdownToText('**bold** *italic* ***both*** ~~gone~~ __strong__ _em_')).toBe(
      'bold italic both gone strong em',
    );
    expect(markdownToText('use my_var_name and CONST_VALUE here')).toBe(
      'use my_var_name and CONST_VALUE here',
    );
  });

  it('removes HTML tags and comments, decodes common entities', () => {
    expect(markdownToText('<div class="x">Hello <b>world</b></div>')).toBe('Hello world');
    expect(markdownToText('a <!-- hidden --> b')).toBe('a b');
    expect(markdownToText('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
    expect(markdownToText('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
  });

  it('keeps inline code content verbatim, without backticks', () => {
    expect(markdownToText('call `Array<string>` and `a_b_c` then `**x**`')).toBe(
      'call Array<string> and a_b_c then **x**',
    );
    expect(markdownToText('use ``a ` b`` ok')).toBe('use a ` b ok');
  });

  it('keeps fenced code content, drops the fence lines', () => {
    const md =
      'Before\n\n```ts\nconst x = <div>1</div>; // # not a heading\n```\n\nAfter\n\n~~~\nplain tilde code\n~~~';
    expect(markdownToText(md)).toBe(
      'Before const x = <div>1</div>; // # not a heading After plain tilde code',
    );
  });

  it('only closes a fence with a marker at least as long, so shorter fences stay content', () => {
    const md = '````md\n```\ninner\n```\n````\nafter';
    expect(markdownToText(md)).toBe('``` inner ``` after');
  });

  it('drops table separators and pipes but keeps cell text', () => {
    const md = '| Name | Kind |\n| --- | :---: |\n| kb | okf |\n\n---\n\ntext';
    expect(markdownToText(md)).toBe('Name Kind kb okf text');
    expect(markdownToText('a | b | c')).toBe('a b c');
  });

  it('drops horizontal rules and setext underlines', () => {
    expect(markdownToText('Heading\n=======\n\ntext\n\n***\n\n___\nmore')).toBe(
      'Heading text more',
    );
  });

  it('drops footnote references, keeps footnote definition text', () => {
    expect(markdownToText('Claim[^1] here.\n\n[^1]: The source says so.')).toBe(
      'Claim here. The source says so.',
    );
  });

  it('unescapes markdown escapes', () => {
    expect(markdownToText('price \\*not bold\\* and \\[x\\]')).toBe('price *not bold* and [x]');
  });

  it('collapses whitespace and trims', () => {
    expect(markdownToText('  a \t b \n\n\n c   ')).toBe('a b c');
    expect(markdownToText('')).toBe('');
    expect(markdownToText('---\nx: 1\n---\n')).toBe('');
  });

  it(`caps the result at ${MAX_BODY_CHARS} characters`, () => {
    const out = markdownToText('word '.repeat(10_000));
    expect(out.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(out.length).toBeGreaterThan(MAX_BODY_CHARS - 10);
  });

  it('does not cut a surrogate pair in half when truncating', () => {
    const out = markdownToText('😀'.repeat(MAX_BODY_CHARS));
    expect(out.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
    expect(out.codePointAt(out.length - 2)).toBe(0x1f600);
  });
});

describe('extractHeadings', () => {
  it('returns ATX headings of levels 1-4 in order', () => {
    const md = '# One\n\ntext\n\n## Two\n### Three\n#### Four\n##### Five\n###### Six';
    expect(extractHeadings(md)).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('ignores headings in fenced code and in frontmatter', () => {
    const md =
      '---\n# yaml comment\ntype: X\n---\n# Real\n\n```sh\n# a comment, not a heading\n```\n\n~~~\n## nope\n~~~\n\n## After';
    expect(extractHeadings(md)).toEqual(['Real', 'After']);
  });

  it('strips inline markup and closing hashes', () => {
    expect(extractHeadings('## The `code` and **bold** [link](x.md) ##')).toEqual([
      'The code and bold link',
    ]);
  });

  it('requires a space after the hashes and skips empty headings', () => {
    expect(extractHeadings('#nospace\n#\n##   \n# ok')).toEqual(['ok']);
  });

  it('is empty for no headings', () => {
    expect(extractHeadings('just text')).toEqual([]);
    expect(extractHeadings('')).toEqual([]);
  });
});

describe('okfDocToSearchDoc', () => {
  const body = '# Context Forge\n\nBuild contexts with **links**.\n\n## Workflow\n\nPick items.';

  it('builds the entry doc for main.md', () => {
    const doc = okfDocToSearchDoc({
      dataset: 'feature',
      slug: 'context-forge',
      relPath: 'main.md',
      data: {
        type: 'Feature',
        name: 'context-forge',
        title: 'Context Forge',
        description: 'Link things together',
        tags: ['forge', 'ui'],
        state: 'in-progress',
      },
      body,
      entryTitle: 'Context Forge',
    });
    expect(doc).toEqual({
      id: 'feature/context-forge',
      dataset: 'feature',
      slug: 'context-forge',
      path: null,
      title: 'Context Forge',
      name: 'context-forge',
      description: 'Link things together',
      tags: ['forge', 'ui'],
      headings: ['Context Forge', 'Workflow'],
      body: 'Context Forge Build contexts with links. Workflow Pick items.',
      state: 'in-progress',
      url: '/feature/context-forge',
    });
  });

  it('builds a sub-doc with path, doc url and no state', () => {
    const doc = okfDocToSearchDoc({
      dataset: 'kb',
      slug: 'ctxman',
      relPath: 'concepts/search.md',
      data: { type: 'Concept', description: 'Search', state: 'ignored', tags: ['x'] },
      body: '# Search\n\nFuse.',
      entryTitle: 'ctxman',
    });
    expect(doc).toMatchObject({
      id: 'kb/ctxman/concepts/search',
      dataset: 'kb',
      slug: 'ctxman',
      path: 'concepts/search.md',
      name: 'ctxman',
      title: 'Search',
      description: 'Search',
      tags: ['x'],
      url: '/kb/ctxman/doc/concepts/search',
    });
    expect(doc.state).toBeUndefined();
    expect(Object.keys(doc)).not.toContain('state');
  });

  it('builds ids/urls for reserved files (index.md, log.md)', () => {
    const index = okfDocToSearchDoc({
      dataset: 'rca',
      slug: 'x',
      relPath: 'index.md',
      data: {},
      body: '# Index\n',
      entryTitle: 'X',
    });
    expect(index).toMatchObject({ id: 'rca/x/index', path: 'index.md', url: '/rca/x/doc/index' });
    const log = okfDocToSearchDoc({
      dataset: 'rca',
      slug: 'x',
      relPath: 'log.md',
      data: {},
      body: '## 2026-10-17\n\n- did things',
      entryTitle: 'X',
    });
    expect(log).toMatchObject({ id: 'rca/x/log', url: '/rca/x/doc/log', title: 'log' });
  });

  it('picks the title: frontmatter title, then first # heading, then name / entryTitle / basename', () => {
    const make = (relPath: string, data: Record<string, unknown>, text: string) =>
      okfDocToSearchDoc({
        dataset: 'kb',
        slug: 's',
        relPath,
        data,
        body: text,
        entryTitle: 'Entry T',
      }).title;
    expect(make('main.md', { title: 'FM', name: 'n' }, '# H1')).toBe('FM');
    expect(make('main.md', { name: 'n' }, 'intro\n\n# H1\n')).toBe('H1');
    expect(make('main.md', { name: 'n' }, '## only h2')).toBe('n');
    expect(make('main.md', {}, 'no heading')).toBe('Entry T');
    expect(make('concepts/deep-dive.md', { name: 'ignored' }, 'no heading')).toBe('deep-dive');
    expect(make('concepts/x.md', { title: '  ' }, '# Fallback')).toBe('Fallback');
    expect(make('main.md', {}, '```\n# in code\n```')).toBe('Entry T');
  });

  it('uses safe defaults for missing or malformed data', () => {
    const doc = okfDocToSearchDoc({
      dataset: 'idea',
      slug: 'i',
      relPath: 'main.md',
      data: { tags: ['ok', 7], description: 5 },
      body: '',
      entryTitle: '',
    });
    expect(doc.tags).toEqual(['ok']);
    expect(doc.description).toBe('');
    expect(doc.headings).toEqual([]);
    expect(doc.body).toBe('');
    expect(doc.title).toBe('i');
  });

  it('puts only plain text in body (no frontmatter, links or fences)', () => {
    const doc = okfDocToSearchDoc({
      dataset: 'kb',
      slug: 's',
      relPath: 'concepts/a.md',
      data: {},
      body: '---\ntype: Concept\n---\nSee [b](./b.md) and `c`.\n\n```\ncode line\n```',
      entryTitle: 's',
    });
    expect(doc.body).toBe('See b and c. code line');
  });
});

describe('skillToSearchDoc', () => {
  it('indexes SKILL.md', () => {
    const data = assertValid(skillSchema, {
      name: 'okf-authoring',
      description: 'Author OKF bundles',
    });
    const doc = skillToSearchDoc(
      'okf-authoring',
      data,
      '# OKF authoring\n\n## Steps\n\nWrite `main.md`.',
    );
    expect(doc).toEqual({
      id: 'skill/okf-authoring',
      dataset: 'skill',
      slug: 'okf-authoring',
      path: null,
      title: 'OKF authoring',
      name: 'okf-authoring',
      description: 'Author OKF bundles',
      tags: [],
      headings: ['OKF authoring', 'Steps'],
      body: 'OKF authoring Steps Write main.md.',
      url: '/skill/okf-authoring',
    });
  });

  it('falls back to the skill name for the title', () => {
    const data = assertValid(skillSchema, { name: 'plain', description: 'd' });
    expect(skillToSearchDoc('plain', data, 'no heading').title).toBe('plain');
  });
});

describe('referenceToSearchDoc', () => {
  it('flattens a remote repo', () => {
    const data = assertValid(referenceSchema, {
      name: 'astro-docs',
      description: 'Astro docs',
      type: 'remote-repo',
      uri: 'https://github.com/withastro/docs.git',
      subpath: 'src/content/docs/en',
      owner: 'not-me',
      tags: ['docs'],
    });
    expect(referenceToSearchDoc('astro-docs', data)).toEqual({
      id: 'reference/astro-docs',
      dataset: 'reference',
      slug: 'astro-docs',
      path: null,
      title: 'astro-docs',
      name: 'astro-docs',
      description: 'Astro docs',
      tags: ['docs'],
      headings: [],
      body: 'Remote repo · https://github.com/withastro/docs.git · src/content/docs/en · owner: not me',
      url: '/reference/astro-docs',
    });
  });

  it('flattens a local repo using its path and skips an absent subpath', () => {
    const data = assertValid(referenceSchema, {
      name: 'ctxman-repo',
      description: 'This repo',
      type: 'local-repo',
      path: '~/repos/ctxman',
      owner: 'me',
    });
    expect(referenceToSearchDoc('ctxman-repo', data).body).toBe(
      'Local repo · ~/repos/ctxman · owner: me',
    );
  });

  it('flattens a remote skill with a null or empty subpath', () => {
    const base = {
      name: 'skills',
      description: 'd',
      type: 'remote-skill',
      uri: 'https://github.com/anthropics/skills.git',
      owner: 'not-me',
    };
    const nullSub = assertValid(referenceSchema, { ...base, subpath: null });
    const emptySub = assertValid(referenceSchema, { ...base, subpath: '' });
    const expected =
      'Remote skill · git · https://github.com/anthropics/skills.git · owner: not me';
    expect(referenceToSearchDoc('skills', nullSub).body).toBe(expected);
    expect(referenceToSearchDoc('skills', emptySub).body).toBe(expected);
    const withSub = assertValid(referenceSchema, { ...base, subpath: 'skills/skill-creator' });
    expect(referenceToSearchDoc('skills', withSub).body).toContain('skills/skill-creator');
  });

  it('flags a remote skill tarball as archive', () => {
    const data = assertValid(referenceSchema, {
      name: 'ksa-modding',
      description: 'd',
      type: 'remote-skill',
      uri: 'https://h.test/ksa-modding-latest.tar.gz',
      owner: 'me',
    });
    expect(referenceToSearchDoc('ksa-modding', data).body).toBe(
      'Remote skill · archive · https://h.test/ksa-modding-latest.tar.gz · owner: me',
    );
  });
});

describe('contextToSearchDoc', () => {
  it('flattens description, one line per link, and link notes as text', () => {
    const data = assertValid(contextSchema, {
      name: 'ctxman-dev',
      description: 'Everything for developing ctxman',
      tags: ['dev'],
      links: [
        {
          dataset: 'kb',
          slug: 'ctxman',
          notes: 'Start with the **overview**.\n\n- datasets\n- search\n',
        },
        { dataset: 'task', slug: 'write-agents-md' },
        { dataset: 'skill', slug: 'okf-authoring', notes: 'Use `main.md` rules.' },
      ],
    });
    expect(contextToSearchDoc('ctxman-dev', data)).toEqual({
      id: 'context/ctxman-dev',
      dataset: 'context',
      slug: 'ctxman-dev',
      path: null,
      title: 'ctxman-dev',
      name: 'ctxman-dev',
      description: 'Everything for developing ctxman',
      tags: ['dev'],
      headings: [],
      body: [
        'Everything for developing ctxman',
        'kb/ctxman Start with the overview. datasets search',
        'task/write-agents-md',
        'skill/okf-authoring Use main.md rules.',
      ].join('\n'),
      url: '/context/ctxman-dev',
    });
  });

  it('handles a context with no links', () => {
    const data = assertValid(contextSchema, { name: 'empty', description: 'Nothing yet' });
    expect(contextToSearchDoc('empty', data)).toMatchObject({
      body: 'Nothing yet',
      tags: [],
      id: 'context/empty',
    });
  });
});

describe('recipeToSearchDoc', () => {
  it('flattens description, target and layout, contexts, ad hoc items, preamble and blocks', () => {
    const data = assertValid(recipeSchema, {
      name: 'ctxman-dev-brief',
      description: 'Session brief for ctxman',
      tags: ['ctxman'],
      target: 'codex',
      layout: 'flat',
      preamble: 'Use **pnpm** only.\n',
      contexts: ['ctxman-dev', 'okf-authoring'],
      items: [{ dataset: 'skill', slug: 'ctxman-add-entry' }],
      markdown: [{ id: 'b1', body: '## Ground rules\n\n- keep `AGENTS.md` current\n' }],
    });
    expect(recipeToSearchDoc('ctxman-dev-brief', data)).toEqual({
      id: 'recipe/ctxman-dev-brief',
      dataset: 'recipe',
      slug: 'ctxman-dev-brief',
      path: null,
      title: 'ctxman-dev-brief',
      name: 'ctxman-dev-brief',
      description: 'Session brief for ctxman',
      tags: ['ctxman'],
      headings: [],
      body: [
        'Session brief for ctxman',
        'target: Codex · layout: flat',
        'contexts: ctxman-dev, okf-authoring',
        'skill/ctxman-add-entry',
        'Use pnpm only.',
        'Ground rules keep AGENTS.md current',
      ].join('\n'),
      url: '/recipe/ctxman-dev-brief',
    });
  });

  it('handles a bare recipe and truncates the body', () => {
    const bare = recipeToSearchDoc(
      'bare',
      assertValid(recipeSchema, { name: 'bare', description: 'Nothing' }),
    );
    expect(bare.body).toBe('Nothing\ntarget: Claude Code · layout: grouped');
    expect(bare.tags).toEqual([]);
    const long = assertValid(recipeSchema, {
      name: 'long',
      description: 'd',
      markdown: [{ id: 'b1', body: 'x'.repeat(MAX_BODY_CHARS * 2) }],
    });
    expect(recipeToSearchDoc('long', long).body.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });
});
