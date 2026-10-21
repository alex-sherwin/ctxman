// The generated import files: inert text (inert.ts, satteri), the session / plan markdown (markdown.ts) and that a
// generated file passes the bundle validators without findings.
import { describe, expect, it } from 'vitest';
import { markdownToMdast } from 'satteri';
import {
  checkerSafeLinks,
  inertBlock,
  inertDocument,
  INERT,
  isAllowedUrl,
} from '../../src/lib/agent-history/inert.ts';
import {
  BODY_MAX_BYTES,
  firstHeading,
  hasH1,
  indexLineText,
  planDefaultPath,
  planExcerpt,
  planMarkdown,
  sessionDefaultPath,
  sessionMarkdown,
  slugify,
  stripFrontmatter,
  TEXT_BLOCK_MAX,
  truncateBlock,
} from '../../src/lib/agent-history/markdown.ts';
import type {
  AgentPlanSummary,
  AgentSessionSummary,
  TranscriptMessage,
} from '../../src/lib/agent-history/types.ts';
import { validateDoc } from '../../src/lib/doc-io.ts';
import { extractLinks } from '../../src/lib/links.ts';
import { renderMarkdown } from '../../src/lib/markdown.ts';
import { splitFrontmatter } from '../../src/lib/okf.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { trackTemp, validKbBundle } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();

interface MdNode {
  type: string;
  children?: MdNode[];
}
const countType = (node: MdNode, type: string): number =>
  (node.type === type ? 1 : 0) + (node.children ?? []).reduce((n, c) => n + countType(c, type), 0);
const htmlNodes = (md: string): number =>
  countType(
    markdownToMdast(md, { features: { gfm: true, frontmatter: false } }) as unknown as MdNode,
    'html',
  );

describe('inertBlock', () => {
  it('escapes raw HTML outside code and keeps code, inline code and http autolinks', async () => {
    const out = inertBlock(
      'Hi <script>alert(1)</script> `a<b>` <https://x.dev> \\<i>\n\n```js\nif (a < b) {}\n```\n\n<div>\n<b>x</b>\n</div>',
    );
    expect(out).toContain('&lt;script>alert(1)&lt;/script>');
    expect(out).toContain('`a<b>`');
    expect(out).toContain('<https://x.dev>');
    expect(out).toContain('\\<i>');
    expect(out).toContain('if (a < b) {}');
    expect(out).toContain('&lt;div>');
    expect(htmlNodes(out)).toBe(0);
    const html = await renderMarkdown(out);
    expect(html).not.toMatch(/<script|<div>|<b>/);
    expect(html).toContain('<a href="https://x.dev">');
  });

  it('closes a fence a list item opened before raw HTML that follows it', () => {
    const out = inertBlock('- ```js\n  <script>\n  ```\n<script>alert(2)</script>');
    expect(out).toContain('&lt;script>alert(2)');
    expect(htmlNodes(out)).toBe(0);
  });

  it('neutralizes links and images the bundle checker would validate, keeps http(s), mailto and #fragments', () => {
    const out = inertBlock(
      '[guide](docs/guide.md) [c](ctxman:kb/x) [js](javascript:alert(1)) ![img](a.png) [f](file:///etc/passwd) ' +
        '[ok](https://x.dev/a "T <b>") [m](mailto:a@b.c) [top](#top) ![ext](https://x.dev/i.png) <javascript:alert(1)> <ctxman:kb/x>',
    );
    expect(out).toContain('guide (`docs/guide.md`)');
    expect(out).toContain('c (`ctxman:kb/x`)');
    expect(out).toContain('js (`javascript:alert(1)`)');
    expect(out).toContain('img (`a.png`)');
    expect(out).toContain('f (`file:///etc/passwd`)');
    expect(out).toContain('[ok](https://x.dev/a "T &lt;b>")');
    expect(out).toContain('[m](mailto:a@b.c)');
    expect(out).toContain('[top](#top)');
    expect(out).toContain('![ext](https://x.dev/i.png)');
    expect(out).toContain('&lt;javascript:alert(1)>');
    expect(out).toContain('&lt;ctxman:kb/x>');
  });

  it('escapes a reference definition with a bundle destination, keeps an http one', () => {
    const out = inertBlock('[a]: ./x.md\n[b]: https://b.dev\n\nsee [a] and [b]');
    expect(out).toMatch(/^\\\[a\]: \.\/x\.md/);
    expect(out).toContain('[b]: https://b.dev');
    expect(extractLinks(out).filter((l) => !isAllowedUrl(l.href))).toEqual([]);
  });

  it('shifts ATX headings (capped at 6, never in code) and turns setext headings into ATX', () => {
    expect(inertBlock('# One\n\n##### Five\n\n```\n# not a heading\n```\n\nTwo\n---', 3)).toBe(
      '#### One\n\n###### Five\n\n```\n# not a heading\n```\n\n##### Two',
    );
    expect(inertBlock('# Kept\n\nSetext\n===', 0)).toBe('# Kept\n\nSetext\n===');
  });

  it('closes an unclosed top-level fence so it cannot swallow what follows', () => {
    expect(inertBlock('text\n\n~~~~py\nprint(1)\n')).toBe('text\n\n~~~~py\nprint(1)\n~~~~');
    expect(inertBlock('```\nclosed\n```')).toBe('```\nclosed\n```');
  });

  it('is stable: a second pass changes nothing', () => {
    const once = inertBlock(
      '[x](./y.md) <b>x</b> [ok](<https://x.dev/a b>) ![i](https://x.dev/a.png "t")',
    );
    expect(inertBlock(once)).toBe(once);
  });
});

describe('checkerSafeLinks and inertDocument', () => {
  it('neutralizes links the checker still reads inside indented code', () => {
    const doc = inertDocument('Para.\n\n    indented [x](./y.md)\n');
    expect(doc).toContain('x (`./y.md`)');
    expect(checkerSafeLinks(doc)).toBe(doc);
  });

  it('handles nested links in rounds', () => {
    const out = checkerSafeLinks('[![b](i.png)](p.md)');
    expect(extractLinks(out).filter((l) => !/^(https?:|#)/.test(l.href))).toEqual([]);
  });
});

describe('helpers', () => {
  it('truncateBlock cuts at the limit without splitting a surrogate pair', () => {
    expect(truncateBlock('abc', 5)).toEqual({ text: 'abc', cut: 0 });
    expect(truncateBlock('abcdef', 4)).toEqual({ text: 'abcd', cut: 2 });
    expect(truncateBlock('abc😀', 4)).toEqual({ text: 'abc', cut: 2 });
  });

  it('slugify', () => {
    expect(slugify('Fix the Login — Redirect!', 48, 'x')).toBe('fix-the-login-redirect');
    expect(slugify('Ünïcödé café', 48, 'x')).toBe('unicode-cafe');
    expect(slugify('a'.repeat(30) + ' ' + 'b'.repeat(30), 32, 'x')).toBe('a'.repeat(30) + '-b');
    expect(slugify('a'.repeat(31) + ' b', 32, 'x')).toBe('a'.repeat(31));
    expect(slugify('!!!', 10, 'fallback')).toBe('fallback');
  });

  it('indexLineText keeps index.md / log.md lines free of HTML and, for descriptions, link syntax', () => {
    expect(indexLineText('A <b>\nB', { brackets: false })).toBe('A &lt;b> B');
    expect(indexLineText('[x](y.md)', { brackets: true })).toBe('\\[x\\](y.md)');
  });

  it('plan helpers: frontmatter, first heading, H1, excerpt', () => {
    expect(stripFrontmatter('---\na: 1\n---\n# T\n')).toBe('# T\n');
    expect(stripFrontmatter('# No fm\n')).toBe('# No fm\n');
    expect(firstHeading('```\n# no\n```\n\n## Real one ##\n')).toEqual({
      level: 2,
      text: 'Real one',
      line: 4,
    });
    expect(hasH1('## two\n')).toBe(false);
    expect(hasH1('Title\n===\n')).toBe(true);
    expect(hasH1('# One\n')).toBe(true);
    expect(
      planExcerpt(
        '# T\n\n- **First** step with [a link](x.md)\n\n```\ncode\n```\n\n| t |\n\nMore <b>text</b>.',
      ),
    ).toBe('First step with a link More text.');
  });
});

const summary: AgentSessionSummary = {
  key: 'claude-code:abc',
  agent: 'claude-code',
  source: 'claude-code',
  id: 'abc',
  title: 'Fix the login redirect',
  cwd: '/Users/me/repos/app',
  gitBranch: 'main',
  model: 'claude-opus-5-5',
  startedAt: '2026-10-21T16:13:00.000Z',
  modifiedAt: '2026-10-21T18:02:11.000Z',
  bytes: 10,
};
const now = new Date('2026-10-21T19:00:00.500Z');

const messages: TranscriptMessage[] = [
  {
    role: 'user',
    timestamp: '2026-10-21T16:13:00.000Z',
    blocks: [
      {
        kind: 'text',
        text: 'Why? See [guide](docs/guide.md)\n\n# Heading in prompt\n\n<script>x</script>',
      },
    ],
  },
  {
    role: 'assistant',
    blocks: [
      { kind: 'thinking', text: 'Hmm.\n\nSecond line' },
      { kind: 'tool', name: 'Bash', summary: 'git status | grep `x`' },
      { kind: 'tool', name: 'Read', summary: 'src/lib/auth.ts' },
      { kind: 'text', text: 'Because.' },
    ],
  },
  { role: 'user', blocks: [{ kind: 'text', text: 'Thanks' }] },
  { role: 'assistant', blocks: [{ kind: 'tool', name: 'Bash', summary: 'ls' }] },
];

const input = {
  summary,
  messages,
  prompts: 2,
  endedAt: '2026-10-21T18:02:11.000Z',
  sourcePath: '~/.claude/projects/-Users-me-repos-app/abc.jsonl',
  home: '/Users/me',
};

describe('sessionMarkdown', () => {
  it('writes the frontmatter of spec §3 (dates quoted, index: false) and the prompt / response structure', () => {
    const file = sessionMarkdown(
      input,
      { tools: true, thinking: false },
      { title: summary.title, now, inert: INERT },
    );
    const split = splitFrontmatter(file.markdown);
    expect(split).not.toBeNull();
    const data = parseYaml(split?.raw ?? '') as Record<string, unknown>;
    expect(data).toEqual({
      type: 'agent-session',
      title: 'Fix the login redirect',
      description: 'Claude Code session in ~/repos/app, 2026-10-21, 2 prompts',
      tags: ['agent-session', 'claude-code'],
      index: false,
      agent: 'claude-code',
      source: 'claude-code',
      session_id: 'abc',
      cwd: '/Users/me/repos/app',
      git_branch: 'main',
      model: 'claude-opus-5-5',
      started: '2026-10-21T16:13:00Z',
      ended: '2026-10-21T18:02:11Z',
      prompts: 2,
      source_path: '~/.claude/projects/-Users-me-repos-app/abc.jsonl',
      imported: '2026-10-21T19:00:00Z',
    });
    expect(Object.keys(data).slice(0, 5)).toEqual([
      'type',
      'title',
      'description',
      'tags',
      'index',
    ]);
    expect(file.markdown).toContain('tags: [agent-session, claude-code]\nindex: false\n');
    expect(file.body).toContain(
      '# Fix the login redirect\n\n| Agent | Claude Code |\n| ----- | ----- |\n| Directory | `/Users/me/repos/app` |',
    );
    expect(file.body).toContain(
      '## Prompt 1 · 2026-10-21 16:13\n\nWhy? See guide (`docs/guide.md`)\n\n#### Heading in prompt\n\n&lt;script>x&lt;/script>',
    );
    expect(file.body).toContain(
      '### Response\n\n- `Bash` `` git status | grep `x` ``\n- `Read` `src/lib/auth.ts`\n\nBecause.',
    );
    expect(file.body).not.toContain('Thinking');
    expect(file.body).toContain('## Prompt 2\n\nThanks\n\n### Response\n\n- `Bash` `ls`');
    expect(file.truncated).toBe(false);
  });

  it('options: thinking as a blockquote, tools off drops an empty response heading', () => {
    const file = sessionMarkdown(
      input,
      { tools: false, thinking: true },
      { title: 'Other', now, inert: INERT },
    );
    expect(file.body).toContain('> **Thinking:** Hmm.\n>\n> Second line');
    expect(file.body).not.toContain('`Bash`');
    expect(file.body).toContain('## Prompt 2\n\nThanks\n');
    expect(file.body.trimEnd().endsWith('Thanks')).toBe(true);
    expect(file.title).toBe('Other');
  });

  it('cuts long blocks and leaves out the prompts after 1.5 MB', () => {
    const big = 'x'.repeat(TEXT_BLOCK_MAX + 5);
    const many: TranscriptMessage[] = [];
    for (let i = 0; i < 60; i++) {
      many.push({ role: 'user', blocks: [{ kind: 'text', text: `p${i}` }] });
      many.push({ role: 'assistant', blocks: [{ kind: 'text', text: big }] });
    }
    const file = sessionMarkdown(
      { ...input, messages: many, prompts: 60 },
      { tools: true, thinking: false },
      { title: 't', now, inert: INERT },
    );
    expect(file.truncated).toBe(true);
    expect(file.body).toContain('… [truncated 5 characters]');
    expect(file.body).toMatch(/_… \d+ more prompts left out to keep this file small\._/);
    expect(new TextEncoder().encode(file.body).length).toBeLessThan(
      BODY_MAX_BYTES + TEXT_BLOCK_MAX * 2,
    );
  });

  it('suggests sessions/<date>-<agent>-<slug>.md', () => {
    expect(sessionDefaultPath(summary)).toBe(
      'sessions/2026-10-21-claude-code-fix-the-login-redirect.md',
    );
    const { startedAt: _drop, ...noStart } = summary;
    expect(sessionDefaultPath({ ...noStart, title: 'x'.repeat(80) })).toBe(
      `sessions/2026-10-21-claude-code-${'x'.repeat(48)}.md`,
    );
  });

  it('passes the okf validators of a bundle without any finding', () => {
    const dir = tmp.make(validKbBundle('demo'));
    const file = sessionMarkdown(
      input,
      { tools: true, thinking: true },
      { title: summary.title, now, inert: INERT },
    );
    expect(validateDoc('kb', 'demo', 'sessions/x.md', file.markdown, dir)).toEqual([]);
    expect(htmlNodes(file.body)).toBe(0);
  });
});

describe('planMarkdown', () => {
  const plan: AgentPlanSummary = {
    key: 'claude-code:p',
    agent: 'claude-code',
    source: 'claude-code',
    id: 'p',
    title: 'Ship it',
    excerpt: '',
    path: '~/.claude/plans/p.md',
    thread: 'The thread',
    modifiedAt: '2026-10-20T10:00:00.000Z',
    bytes: 1,
  };

  it('strips the plan frontmatter, adds an H1 when missing, makes the text inert, does not shift headings', () => {
    const file = planMarkdown(
      {
        summary: plan,
        text: '---\nx: 1\n---\n## Steps\n\n1. [a](./a.md) <b>b</b>\n',
        sourcePath: plan.path,
      },
      { title: 'Ship it', now, inert: INERT },
    );
    const data = parseYaml(splitFrontmatter(file.markdown)?.raw ?? '') as Record<string, unknown>;
    expect(data).toEqual({
      type: 'plan',
      title: 'Ship it',
      description: 'Claude Code plan, 2026-10-20, The thread',
      tags: ['plan', 'claude-code'],
      index: false,
      agent: 'claude-code',
      source: 'claude-code',
      plan_id: 'p',
      thread: 'The thread',
      source_path: '~/.claude/plans/p.md',
      imported: '2026-10-21T19:00:00Z',
    });
    expect(file.body).toBe('# Ship it\n\n## Steps\n\n1. a (`./a.md`) &lt;b>b&lt;/b>\n');
    const dir = tmp.make(validKbBundle('demo'));
    expect(validateDoc('kb', 'demo', 'plans/ship-it.md', file.markdown, dir)).toEqual([]);
  });

  it('keeps an existing H1 and suggests plans/<slug>.md', () => {
    const file = planMarkdown(
      { summary: plan, text: '# Own title\n\nBody', sourcePath: plan.path },
      { title: 'Other', now, inert: INERT },
    );
    expect(file.body).toBe('# Own title\n\nBody\n');
    expect(planDefaultPath('Plan: Fix the Webhook!')).toBe('plans/plan-fix-the-webhook.md');
    expect(planDefaultPath('***')).toBe('plans/plan.md');
  });
});
