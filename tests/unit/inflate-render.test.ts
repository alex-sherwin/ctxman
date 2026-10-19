import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import { createFsSources } from '../../src/lib/inflate/fs-sources.ts';
import { shQuote } from '../../src/lib/inflate/markdown.ts';
import {
  inflateRecipe,
  gatherContent,
  lookupFrom,
  loadExpandInputs,
} from '../../src/lib/inflate/pipeline.ts';
import { expandRecipe } from '../../src/lib/inflate/expand.ts';
import { parseRecipe } from '../../src/lib/inflate/recipe.ts';
import { planMaterialization } from '../../src/lib/inflate/material-plan.ts';
import type { MaterialPlan, MaterialView } from '../../src/lib/inflate/material-plan.ts';
import { LARGE_OUTPUT_BYTES, renderPlan } from '../../src/lib/inflate/render.ts';
import type { InflateResult, RenderOutput } from '../../src/lib/inflate/render.ts';
import { trackTemp, validDataTree, writeTree } from './fixtures/data-fixtures.ts';
import { prepare, referenceYaml, seedRecipe, seedTree } from './fixtures/inflate-seed.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

const GENERATED_AT = '2026-10-17T12:00:00.000Z';
const q = shQuote;

function recipe(input: Record<string, unknown> = {}): RecipeData {
  const r = parseRecipe({ name: 'demo-brief', description: 'Demo.', ...input });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.recipe;
}

async function render(dataDir: string, r: RecipeData): Promise<InflateResult> {
  return inflateRecipe(
    r,
    createFsSources({ dataDir, nowMs: Date.parse(GENERATED_AT), homeDir: '/home/test' }),
    new Date(GENERATED_AT),
  );
}

/** The document without its header (the `# name` title paragraph and the block of `>` lines). */
function body(markdown: string): string {
  return markdown.split('\n\n').slice(2).join('\n\n');
}

const REPO_FILES = {
  'README.md': '',
  'alpha.txt': '',
  'Zeta.txt': '',
  'src/index.ts': '',
  'node_modules/dep/index.js': '',
  '.hidden': '',
};

interface World {
  D: string;
  repo: string;
}

/** validDataTree + a non-markdown file, a second kb, and one reference of every shape. */
function world(extra: Record<string, string> = {}): World {
  const repo = tmp.make(REPO_FILES);
  const ref = (
    name: string,
    fields: string,
    description = `Desc ${name}.`,
  ): Record<string, string> => ({
    [`reference/${name}.yaml`]: `name: ${name}\ndescription: ${description}\n${fields}`,
  });
  const D = tmp.make({
    ...validDataTree(),
    'kb/demo/assets/data.csv': 'a,b\n',
    ...ref('lr', `type: local-repo\npath: ${repo}\nowner: me\n`),
    ...ref('lr-sub', `type: local-repo\npath: ${repo}\nsubpath: src\nowner: not-me\n`),
    ...ref('lr-gone', `type: local-repo\npath: ${path.join(repo, 'missing')}\nowner: me\n`),
    ...ref('lr-home', 'type: local-repo\npath: ~/code/thing\nowner: me\n'),
    ...ref('lf', `type: local-folder\npath: ${repo}\nowner: me\n`),
    ...ref('lf-sub', `type: local-folder\npath: ${repo}\nsubpath: src\nowner: not-me\n`),
    ...ref(
      'rr',
      'type: remote-repo\nuri: https://github.com/o/r.git\nsubpath: docs\nowner: not-me\n',
    ),
    ...ref('rr-plain', 'type: remote-repo\nuri: git@github.com:o/r.git\nowner: me\n'),
    ...ref('rs-git', 'type: remote-skill\nuri: https://github.com/o/skills.git\nowner: me\n'),
    ...ref(
      'rs-git-sub',
      'type: remote-skill\nuri: https://github.com/o/skills.git\nsubpath: skills/foo\nowner: me\n',
    ),
    ...ref('rs-tar', 'type: remote-skill\nuri: https://h.test/skill.tar.gz\nowner: me\n'),
    ...ref(
      'rs-tar-sub',
      'type: remote-skill\nuri: https://h.test/skill.tgz\nsubpath: pkg/skill\nowner: me\n',
    ),
    ...ref('rs-zip', 'type: remote-skill\nuri: https://h.test/skill.zip\nowner: me\n'),
    ...extra,
  });
  return { D, repo };
}

const goldenRecipe = (extra: Record<string, unknown> = {}): RecipeData =>
  recipe({
    preamble: 'Follow the repo rules.\n',
    contexts: ['ctx'],
    items: [{ dataset: 'skill', slug: 'my-skill' }],
    ...extra,
  });

// ---------------------------------------------------------------- golden output (spec 6.4)

describe('renderPlan golden document', () => {
  const expectedGrouped = (D: string): string =>
    [
      '# demo-brief',
      '',
      '> Prepared by ctxman for a Claude Code session.',
      '> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.',
      '> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.',
      '',
      'Follow the repo rules.',
      '',
      '## Context: ctx',
      '',
      'A context.',
      '',
      '### Demo',
      '',
      `\`kb/demo\` · Knowledge Base · tags: demo · \`${D}/kb/demo/index.md\``,
      '',
      '> **From context `ctx`:** Read this.',
      '',
      'A demo knowledge base entry.',
      '',
      `See [one](${D}/kb/demo/concepts/one.md) and [ctxman](${D}/kb/demo/index.md).`,
      '',
      `More in this bundle (under \`${D}/kb/demo\`): \`concepts/one.md\`.`,
      '',
      '### do-it',
      '',
      `\`task/do-it\` · Task · state: In progress · \`${D}/task/do-it/index.md\``,
      '',
      'Do the thing.',
      '',
      '## Additional items',
      '',
      '### my-skill',
      '',
      `\`skill/my-skill\` · Skill · \`${D}/skill/my-skill\``,
      '',
      'A skill.',
      '',
      'Install this skill into the project (run from the project root):',
      '',
      '```sh',
      'mkdir -p .claude/skills',
      `cp -R ${q(`${D}/skill/my-skill`)} .claude/skills/my-skill`,
      '```',
      '',
    ].join('\n');

  it('grouped, claude-code: matches the spec example exactly', async () => {
    const { D } = world();
    const { markdown } = await render(D, goldenRecipe());
    expect(markdown).toBe(expectedGrouped(D));
  });

  it('flat: no context or additional-items sections, items at ##', async () => {
    const { D } = world();
    const { markdown } = await render(D, goldenRecipe({ layout: 'flat' }));
    expect(markdown).not.toContain('## Context');
    expect(markdown).not.toContain('## Additional items');
    expect(markdown).toContain('\n\n## Demo\n');
    expect(markdown).toContain('\n\n## do-it\n');
    expect(markdown).toContain('\n\n## my-skill\n');
    expect(markdown).not.toContain('### ');
    expect(markdown).toContain(`\n\n## Demo\n\n\`kb/demo\``);
  });

  it('codex: header line 3 and the install block use .agents/skills / AGENTS.md', async () => {
    const { D } = world();
    const { markdown } = await render(D, goldenRecipe({ target: 'codex' }));
    expect(markdown.split('\n').slice(0, 5)).toEqual([
      '# demo-brief',
      '',
      '> Prepared by ctxman for a Codex session.',
      '> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.',
      '> Skills go in `.agents/skills/<name>/`; project-wide instructions belong in `AGENTS.md`.',
    ]);
    expect(markdown).toContain(
      `\`\`\`sh\nmkdir -p .agents/skills\ncp -R ${q(`${D}/skill/my-skill`)} .agents/skills/my-skill\n\`\`\`\n`,
    );
  });

  it('generic: two quote lines; the skill defaults to a pointer', async () => {
    const { D } = world();
    const { markdown } = await render(D, goldenRecipe({ target: 'generic' }));
    expect(markdown.split('\n').slice(0, 5)).toEqual([
      '# demo-brief',
      '',
      '> Prepared by ctxman for an AI coding agent.',
      '> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.',
      '',
    ]);
    expect(markdown).toContain(
      `\`skill/my-skill\` · Skill · A skill. Read \`${D}/skill/my-skill/SKILL.md\` and follow it when the task matches.\n`,
    );
    expect(markdown).not.toContain('Install this skill');
  });
});

// ---------------------------------------------------------------- document structure

describe('renderPlan structure', () => {
  it('omits a blank preamble and puts a non-blank one verbatim after the header', async () => {
    const { D } = world();
    const none = await render(D, recipe({ preamble: '  \n' }));
    expect(none.markdown).toBe(
      [
        '# demo-brief',
        '',
        '> Prepared by ctxman for a Claude Code session.',
        '> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.',
        '> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.',
        '',
      ].join('\n'),
    );
    const some = await render(D, recipe({ preamble: '\n\nLine 1\n\n- a\n\n' }));
    expect(body(some.markdown)).toBe('Line 1\n\n- a\n');
  });

  it('markdown blocks render verbatim (trimmed); blank blocks are not rendered and have 0 bytes', async () => {
    const { D } = world();
    const r = recipe({
      markdown: [
        { id: 'b1', body: '## Rules\n\n- é one\n\n\n' },
        { id: 'b2', body: '  \n' },
      ],
    });
    const { markdown, manifest } = await render(D, r);
    expect(body(markdown)).toBe('## Rules\n\n- é one\n');
    expect(manifest.segments.map((s) => [s.key, s.type, s.bytes])).toEqual([
      ['md:b1', 'markdown', Buffer.byteLength('## Rules\n\n- é one')],
      ['md:b2', 'markdown', 0],
    ]);
  });

  it('segment order follows recipe.order; items before any intro sit at ##', async () => {
    const { D } = world();
    const { markdown } = await render(
      D,
      recipe({
        contexts: ['ctx'],
        markdown: [{ id: 'b1', body: 'MD BLOCK' }],
        order: ['md:b1', 'task/do-it', 'ctx:ctx', 'kb/demo'],
      }),
    );
    const heads = markdown.split('\n').filter((l) => /^#{2,3} /.test(l));
    expect(heads).toEqual(['## do-it', '## Context: ctx', '### Demo']);
    expect(markdown.indexOf('MD BLOCK')).toBeLessThan(markdown.indexOf('## do-it'));
  });

  it('context-intro lists items that sit in another section', async () => {
    const { D } = world({
      'context/second.yaml':
        'name: second\ndescription: Second context.\nlinks:\n  - dataset: kb\n    slug: demo\n',
    });
    const { markdown } = await render(D, recipe({ contexts: ['ctx', 'second'] }));
    expect(markdown).toContain(
      '## Context: second\n\nSecond context.\n\nAlso relevant here, included in another section: **Demo** (`kb/demo`).\n',
    );
    // the item itself is rendered once, under the first context
    expect(markdown.match(/\n### Demo\n/g)).toHaveLength(1);
  });

  it('guidance from two contexts is merged into one blockquote with a bare > separator', async () => {
    const { D } = world({
      'context/second.yaml':
        'name: second\ndescription: s\nlinks:\n  - dataset: kb\n    slug: demo\n    notes: |\n      Second view.\n\n      More lines.\n',
    });
    const { markdown } = await render(D, recipe({ contexts: ['ctx', 'second'] }));
    expect(markdown).toContain(
      '> **From context `ctx`:** Read this.\n>\n> **From context `second`:** Second view.\n>\n> More lines.\n',
    );
  });

  it('excluded, missing and invalid items are not rendered; the manifest counts them', async () => {
    const { D } = world({ 'kb/broken/index.md': '---\ntype: Knowledge Base\nname: broken\n---\n' });
    const { markdown, manifest } = await render(
      D,
      recipe({
        contexts: ['ctx'],
        items: [
          { dataset: 'kb', slug: 'gone' },
          { dataset: 'kb', slug: 'broken' },
        ],
        overrides: [{ key: 'task/do-it', exclude: true }],
      }),
    );
    expect(markdown).not.toContain('do-it');
    expect(markdown).not.toContain('kb/gone');
    expect(manifest.counts).toEqual({ included: 1, excluded: 1, missing: 2 });
    const statuses = Object.fromEntries(manifest.segments.map((s) => [s.key, s.status]));
    expect(statuses).toMatchObject({
      'kb/demo': 'included',
      'task/do-it': 'excluded',
      'kb/gone': 'missing',
      'kb/broken': 'invalid',
    });
    expect(manifest.segments.find((s) => s.key === 'kb/gone')?.bytes).toBe(0);
    expect(manifest.warnings.map((w) => w.code).sort()).toEqual(['item-invalid', 'item-missing']);
    expect(manifest.warnings.find((w) => w.code === 'item-missing')?.message).toBe(
      'kb/gone does not exist (linked from ad hoc)',
    );
  });
});

// ---------------------------------------------------------------- okf modes

describe('okf modes', () => {
  const flat = (r: Record<string, unknown>): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'kb', slug: 'demo' }], ...r });
  const withMode = (mode: string, options?: Record<string, unknown>) =>
    flat({ overrides: [{ key: 'kb/demo', mode, ...(options === undefined ? {} : { options }) }] });

  it('inline-main with frontmatter: yaml block first, then the body, then the concept list', async () => {
    const { D } = world();
    const { markdown } = await render(D, withMode('inline-main', { includeFrontmatter: true }));
    expect(body(markdown)).toBe(
      [
        '## Demo',
        '',
        `\`kb/demo\` · Knowledge Base · tags: demo · \`${D}/kb/demo/index.md\``,
        '',
        '```yaml',
        'okf_version: "0.2"',
        'type: Knowledge Base',
        'name: demo',
        'title: Demo',
        'description: A demo knowledge base entry.',
        'tags: [demo]',
        'stale_after: 2099-01-01',
        'generated:',
        '  by: process:test',
        '  at: 2026-10-17T00:00:00Z',
        '```',
        '',
        `See [one](${D}/kb/demo/concepts/one.md) and [ctxman](${D}/kb/demo/index.md).`,
        '',
        `More in this bundle (under \`${D}/kb/demo\`): \`concepts/one.md\`.`,
        '',
      ].join('\n'),
    );
  });

  it('inline-main honours shiftHeadings / rewriteLinks off', async () => {
    const { D } = world({
      'kb/plain/index.md':
        '---\ntype: Knowledge Base\nname: plain\ndescription: Plain.\n---\n\n# Plain\n\nIntro [x](/concepts/a.md).\n\n## Section\n\ntext\n',
      'kb/plain/concepts/a.md': '---\ntype: Concept\n---\n\n# A\n',
    });
    const r = recipe({
      layout: 'flat',
      items: [{ dataset: 'kb', slug: 'plain' }],
      overrides: [{ key: 'kb/plain', options: { shiftHeadings: false, rewriteLinks: false } }],
    });
    const off = (await render(D, r)).markdown;
    expect(off).toContain('Intro [x](/concepts/a.md).\n\n## Section\n\ntext\n');
    const on = (
      await render(D, recipe({ layout: 'flat', items: [{ dataset: 'kb', slug: 'plain' }] }))
    ).markdown;
    expect(on).toContain(`Intro [x](${D}/kb/plain/concepts/a.md).\n\n### Section\n\ntext\n`);
  });

  it('inline-bundle with frontmatter and update log, plus the list of other files', async () => {
    const { D } = world();
    const { markdown } = await render(
      D,
      withMode('inline-bundle', { includeFrontmatter: true, includeLog: true }),
    );
    expect(body(markdown)).toBe(
      [
        '## Demo',
        '',
        `\`kb/demo\` · Knowledge Base · tags: demo · \`${D}/kb/demo/index.md\``,
        '',
        '```yaml',
        'okf_version: "0.2"',
        'type: Knowledge Base',
        'name: demo',
        'title: Demo',
        'description: A demo knowledge base entry.',
        'tags: [demo]',
        'stale_after: 2099-01-01',
        'generated:',
        '  by: process:test',
        '  at: 2026-10-17T00:00:00Z',
        '```',
        '',
        `See [one](${D}/kb/demo/concepts/one.md) and [ctxman](${D}/kb/demo/index.md).`,
        '',
        '### One',
        '',
        `\`concepts/one.md\` · \`${D}/kb/demo/concepts/one.md\``,
        '',
        `Back to [entry](${D}/kb/demo/index.md#demo). A claim.[^spec] Another.[^note]`,
        '',
        '[^note]: A note.',
        '',
        '### Update log',
        '',
        `\`log.md\` · \`${D}/kb/demo/log.md\``,
        '',
        '#### 2026-10-18',
        '* **Update**: Edited.',
        '',
        '#### 2026-10-17',
        `* **Create**: Created [Demo](${D}/kb/demo/index.md).`,
        '',
        'Other files in this bundle:',
        '',
        `- \`assets/data.csv\` — \`${D}/kb/demo/assets/data.csv\``,
        '',
      ].join('\n'),
    );
  });

  it('inline-bundle without includeLog skips the log; concepts follow index order then tree order', async () => {
    const { D } = world({
      'kb/demo/index.md':
        '---\nokf_version: "0.2"\ntype: Knowledge Base\nname: demo\ntitle: Demo\ndescription: A demo knowledge base entry.\n---\n\n# Demo\n\n* [Zed](/concepts/zed.md)\n* [One](/concepts/one.md)\n* [Entry](/index.md)\n* [Gone](/concepts/gone.md)\n',
      'kb/demo/concepts/zed.md':
        '---\ntype: Concept\ntitle: The Zed\n---\n\n# Zed heading\n\nz body\n',
      'kb/demo/concepts/alpha.md': '---\ntype: Concept\n---\n\nalpha body, no heading\n',
      'kb/demo/concepts/nested/index.md': 'nested index\n',
      'kb/demo/concepts/nested/deep.md':
        '---\ntype: Concept\n---\n\n# Deep\n\n## Sub\n\ndeep body\n',
    });
    const { markdown } = await render(D, withMode('inline-bundle'));
    const heads = markdown.split('\n').filter((l) => /^#{2,6} /.test(l));
    // titles: frontmatter title, first H1, else file name; zed + one by index order, then tree order
    // (directories before files); a body H1 that differs from the title is kept and shifted
    expect(heads).toEqual([
      '## Demo',
      '### The Zed',
      '#### Zed heading',
      '### One',
      '### Deep',
      '#### Sub',
      '### alpha',
    ]);
    expect(markdown).not.toContain('Update log');
    expect(markdown).not.toContain('nested index');
    expect(markdown).toContain('z body');
  });

  it('summary: meta line (state, tags, stale) and the description', async () => {
    const { D } = world({
      'task/old/index.md':
        '---\ntype: Task\nname: old\ndescription: An old task.\nstate: pending\ntags: [a, b]\nstale_after: 2020-01-01\n---\n',
    });
    const { markdown } = await render(
      D,
      recipe({ layout: 'flat', items: [{ dataset: 'task', slug: 'old' }] }),
    );
    expect(body(markdown)).toBe(
      `## old\n\n\`task/old\` · Task · state: Pending · stale since 2020-01-01 · tags: a, b · \`${D}/task/old/index.md\`\n\nAn old task.\n`,
    );
  });

  it.each([
    ['claude-code', (abs: string) => `Read it before starting: @${abs}`],
    ['codex', (abs: string) => `Read \`${abs}\` before starting.`],
    ['generic', (abs: string) => `Read \`${abs}\` before starting.`],
  ] as const)('pointer: eager clause for %s', async (target, clause) => {
    const { D } = world();
    const eager = await render(
      D,
      flat({ target, overrides: [{ key: 'kb/demo', mode: 'pointer', options: { eager: true } }] }),
    );
    const abs = `${D}/kb/demo/index.md`;
    expect(body(eager.markdown)).toBe(
      `## Demo\n\n\`kb/demo\` · Knowledge Base · A demo knowledge base entry. ${clause(abs)}\n`,
    );
    const lazy = await render(
      D,
      flat({ target, overrides: [{ key: 'kb/demo', mode: 'pointer' }] }),
    );
    expect(body(lazy.markdown)).toBe(
      `## Demo\n\n\`kb/demo\` · Knowledge Base · A demo knowledge base entry. Read \`${abs}\` if relevant.\n`,
    );
  });

  it('pointer keeps the context guidance below the pointer line', async () => {
    const { D } = world();
    const { markdown } = await render(
      D,
      recipe({ contexts: ['ctx'], layout: 'flat', defaults: { kb: { mode: 'pointer' } } }),
    );
    expect(markdown).toContain(
      `## Demo\n\n\`kb/demo\` · Knowledge Base · A demo knowledge base entry. Read \`${D}/kb/demo/index.md\` if relevant.\n\n> **From context \`ctx\`:** Read this.\n`,
    );
  });

  it('warns file-unreadable for a concept that is too large and keeps rendering the rest', async () => {
    const { D } = world({
      'kb/demo/concepts/huge.md': `---\ntype: Concept\n---\n${'x'.repeat(600 * 1024)}`,
    });
    const { markdown, manifest } = await render(D, withMode('inline-bundle'));
    expect(markdown).toContain('### One');
    expect(markdown).not.toContain('### huge');
    expect(manifest.warnings).toEqual([
      {
        code: 'file-unreadable',
        message:
          'kb/demo: concepts/huge.md could not be read (missing, binary or larger than 512 KB)',
        key: 'kb/demo',
      },
    ]);
    expect(manifest.segments.find((s) => s.key === 'kb/demo')?.warnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- brief quality (ROUND3 §H)

describe('brief quality (ROUND3 §H)', () => {
  const okf = (name: string, description: string, bodyText: string, type = 'Knowledge Base') =>
    `---\ntype: ${type}\nname: ${name}\ndescription: ${description}\n${
      type === 'Knowledge Base' ? '' : 'state: pending\n'
    }---\n\n${bodyText}`;
  const flat = (r: Record<string, unknown>): RecipeData => recipe({ layout: 'flat', ...r });
  const one = (key: string, mode?: string, options?: Record<string, unknown>) =>
    flat({
      items: [{ dataset: key.split('/')[0], slug: key.split('/')[1] }],
      ...(mode === undefined && options === undefined
        ? {}
        : {
            overrides: [
              {
                key,
                ...(mode === undefined ? {} : { mode }),
                ...(options === undefined ? {} : { options }),
              },
            ],
          }),
    });

  describe('defaults and the description', () => {
    it('every okf kind is inline-main by default: a task brings its body, headed by its description', async () => {
      const { D } = world({
        'task/work/index.md': okf(
          'work',
          'Do the work.',
          '# Work\n\n## Steps\n\n1. one\n2. two\n',
          'Task',
        ),
      });
      const { markdown, manifest } = await render(D, one('task/work'));
      expect(body(markdown)).toBe(
        [
          '## work',
          '',
          `\`task/work\` · Task · state: Pending · \`${D}/task/work/index.md\``,
          '',
          'Do the work.',
          '',
          '### Steps',
          '',
          '1. one',
          '2. two',
          '',
        ].join('\n'),
      );
      expect(manifest.segments.find((s) => s.key === 'task/work')).toMatchObject({
        mode: 'inline-main',
        modeLabel: 'Inline entry',
      });
    });

    it('prints the description first (inline-main and inline-bundle) when the body does not say it', async () => {
      const { D } = world({
        'kb/plain/index.md': okf('plain', 'Alpha beta gamma.', '# Plain\n\nSomething else.\n'),
      });
      for (const mode of ['inline-main', 'inline-bundle']) {
        const { markdown } = await render(D, one('kb/plain', mode));
        expect(body(markdown), mode).toBe(
          [
            '## plain',
            '',
            `\`kb/plain\` · Knowledge Base · \`${D}/kb/plain/index.md\``,
            '',
            'Alpha beta gamma.',
            '',
            'Something else.',
            '',
          ].join('\n'),
        );
      }
    });

    it('does not repeat a description the body already contains (case and whitespace ignored)', async () => {
      const { D } = world({
        'kb/plain/index.md': okf(
          'plain',
          'Alpha beta gamma.',
          '# Plain\n\nIntro: ALPHA   beta\ngamma. More.\n',
        ),
      });
      const { markdown } = await render(D, one('kb/plain'));
      expect(markdown).toContain('\n\nIntro: ALPHA   beta\ngamma. More.\n');
      expect(markdown.toLowerCase().split('alpha').length - 1).toBe(1);
    });

    it('with includeFrontmatter the yaml block carries the description: no extra paragraph', async () => {
      const { D } = world({
        'kb/plain/index.md': okf('plain', 'Alpha beta gamma.', '# Plain\n\nSomething else.\n'),
      });
      const { markdown } = await render(
        D,
        one('kb/plain', 'inline-main', { includeFrontmatter: true }),
      );
      expect(markdown.split('Alpha beta gamma.').length - 1).toBe(1);
      expect(markdown).toContain('description: Alpha beta gamma.');
    });

    it('prints the description after the context guidance, before the body', async () => {
      const { D } = world();
      const { markdown } = await render(D, goldenRecipe());
      const at = (text: string) => markdown.indexOf(text);
      expect(at('> **From context `ctx`:** Read this.')).toBeLessThan(
        at('A demo knowledge base entry.'),
      );
      expect(at('A demo knowledge base entry.')).toBeLessThan(at('See ['));
    });

    it('summary and pointer modes are unchanged (the description is already their text)', async () => {
      const { D } = world();
      const summary = await render(D, one('kb/demo', 'summary'));
      expect(summary.markdown.split('A demo knowledge base entry.').length - 1).toBe(1);
      const pointer = await render(D, one('kb/demo', 'pointer'));
      expect(pointer.markdown.split('A demo knowledge base entry.').length - 1).toBe(1);
    });
  });

  describe('empty sections', () => {
    it('drops template headings with nothing under them, in index.md and concepts', async () => {
      const { D } = world({
        'bug/crash/index.md': okf(
          'crash',
          'It crashes.',
          [
            '# Crash',
            '',
            '## Steps',
            '',
            '1. open it',
            '',
            '## Expected',
            '',
            '## Actual',
            '',
            '### Details',
            '',
            '## Notes',
            '',
          ].join('\n'),
          'Bug',
        ),
        'bug/crash/concepts/extra.md': '---\ntype: Concept\n---\n\n# Extra\n\n## Empty\n',
      });
      const { markdown } = await render(D, one('bug/crash', 'inline-bundle'));
      expect(body(markdown)).toBe(
        [
          '## crash',
          '',
          `\`bug/crash\` · Bug · state: Pending · \`${D}/bug/crash/index.md\``,
          '',
          'It crashes.',
          '',
          '### Steps',
          '',
          '1. open it',
          '',
          '### Extra',
          '',
          `\`concepts/extra.md\` · \`${D}/bug/crash/concepts/extra.md\``,
          '',
        ].join('\n'),
      );
    });

    it('keeps headings inside code fences and headings that have content', async () => {
      const { D } = world({
        'kb/plain/index.md': okf(
          'plain',
          'Plain.',
          '# Plain\n\n## Example\n\n```md\n## Not a heading\n```\n\n## Gone\n',
        ),
      });
      const { markdown } = await render(D, one('kb/plain'));
      expect(markdown).toContain('### Example\n\n```md\n## Not a heading\n```\n');
      expect(markdown).not.toContain('Gone');
    });
  });

  describe('markdown blocks', () => {
    const blocks = [
      { id: 'big', body: '# Big rules\n\ntext\n\n## Sub\n\nmore' },
      { id: 'deep', body: '#### Deep only\n\ntext' },
      { id: 'plain', body: 'No heading here.' },
    ];

    it('nest under their group: ### inside a context, ## when ungrouped', async () => {
      const { D } = world();
      const { markdown } = await render(
        D,
        recipe({
          contexts: ['ctx'],
          markdown: blocks,
          order: ['md:big', 'ctx:ctx', 'md:deep', 'md:plain', 'kb/demo'],
        }),
      );
      const heads = markdown.split('\n').filter((l) => /^#{1,6} /.test(l));
      expect(heads).toEqual([
        '# demo-brief',
        '## Big rules',
        '### Sub',
        '## Context: ctx',
        '#### Deep only',
        '### Demo',
        '### do-it',
      ]);
      expect(markdown).toContain('\n\nNo heading here.\n');
    });

    it('a heading above the group level moves to it: # becomes ### inside a group', async () => {
      const { D } = world();
      const { markdown } = await render(
        D,
        recipe({
          contexts: ['ctx'],
          markdown: [blocks[0] ?? { id: 'big', body: '' }],
          order: ['ctx:ctx', 'md:big', 'kb/demo'],
        }),
      );
      expect(markdown).toContain('## Context: ctx');
      expect(markdown).toContain('\n\n### Big rules\n\ntext\n\n#### Sub\n\nmore\n');
    });

    it('flat layout: blocks sit at ##', async () => {
      const { D } = world();
      const { markdown } = await render(
        D,
        flat({ contexts: ['ctx'], markdown: [blocks[0] ?? { id: 'big', body: '' }] }),
      );
      expect(markdown).toContain('\n\n## Big rules\n\ntext\n\n### Sub\n\nmore\n');
    });

    it('manifest title is the first heading text, else "Markdown <id>"', async () => {
      const { D } = world();
      const { manifest } = await render(D, recipe({ markdown: blocks }));
      expect(manifest.segments.map((s) => [s.key, s.title])).toEqual([
        ['md:big', 'Big rules'],
        ['md:deep', 'Deep only'],
        ['md:plain', 'Markdown plain'],
      ]);
    });
  });

  describe('unresolved links', () => {
    const links = [
      'See [ok](/concepts/one.md), [also ok](ctxman:kb/demo) and [web](https://example.test/x.md).',
      'Broken: [gone](ctxman:kb/gone), [nofile](/concepts/missing.md), [out](../../etc/passwd), [bad](ctxman:nope).',
      'Again [gone](ctxman:kb/gone) twice.',
    ].join('\n\n');
    const linked = () =>
      world({
        'kb/linked/index.md': okf('linked', 'Has links.', `# Linked\n\n${links}\n`),
        'kb/linked/concepts/one.md': '---\ntype: Concept\n---\n\n# One\n\n[nope](./nope.md)\n',
      });

    it('warns once per distinct link with the exact message, filed under the item', async () => {
      const { D } = linked();
      const { markdown, manifest } = await render(D, one('kb/linked'));
      const expected = [
        'kb/linked/index.md: link "ctxman:kb/gone" does not resolve (no such entry)',
        'kb/linked/index.md: link "/concepts/missing.md" does not resolve (no such file in the bundle)',
        'kb/linked/index.md: link "../../etc/passwd" does not resolve (points outside the bundle)',
        'kb/linked/index.md: link "ctxman:nope" does not resolve (malformed ctxman: link)',
      ];
      expect(manifest.warnings.map((w) => [w.code, w.key, w.message])).toEqual(
        expected.map((message) => ['unresolved-link', 'kb/linked', message]),
      );
      expect(
        manifest.segments.find((s) => s.key === 'kb/linked')?.warnings.map((w) => w.message),
      ).toEqual(expected);
      // destinations stay as written; resolved ones became paths
      expect(markdown).toContain('[gone](ctxman:kb/gone)');
      expect(markdown).toContain('[nofile](/concepts/missing.md)');
      expect(markdown).toContain(`[ok](${D}/kb/linked/concepts/one.md)`);
    });

    it('names the file of the link in inline-bundle, concept files included', async () => {
      const { D } = linked();
      const { manifest } = await render(D, one('kb/linked', 'inline-bundle'));
      const messages = manifest.warnings.map((w) => w.message);
      expect(messages).toContain(
        'kb/linked/concepts/one.md: link "./nope.md" does not resolve (no such file in the bundle)',
      );
      expect(messages).toHaveLength(5);
    });

    it('reports nothing when every link resolves, in summary mode, or with rewriteLinks off', async () => {
      const { D } = linked();
      const clean = world();
      expect((await render(clean.D, one('kb/demo'))).manifest.warnings).toEqual([]);
      expect((await render(D, one('kb/linked', 'summary'))).manifest.warnings).toEqual([]);
      expect(
        (await render(D, one('kb/linked', 'inline-main', { rewriteLinks: false }))).manifest
          .warnings,
      ).toEqual([]);
    });

    it('also reports links of an inlined skill', async () => {
      const { D } = world({
        'skill/my-skill/SKILL.md':
          '---\nname: my-skill\ndescription: A skill.\n---\n\n# my-skill\n\nSee [gone](ctxman:kb/gone).\n',
      });
      const { manifest } = await render(D, one('skill/my-skill', 'inline'));
      expect(manifest.warnings.map((w) => [w.code, w.key, w.message])).toEqual([
        [
          'unresolved-link',
          'skill/my-skill',
          'skill/my-skill/SKILL.md: link "ctxman:kb/gone" does not resolve (no such entry)',
        ],
      ]);
    });
  });
});

// ---------------------------------------------------------------- skill modes

describe('skill modes', () => {
  const flat = (r: Record<string, unknown>): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'skill', slug: 'my-skill' }], ...r });

  it('install: copy by default, symlink with the option', async () => {
    const { D } = world();
    const copy = await render(D, flat({}));
    expect(body(copy.markdown)).toBe(
      [
        '## my-skill',
        '',
        `\`skill/my-skill\` · Skill · \`${D}/skill/my-skill\``,
        '',
        'A skill.',
        '',
        'Install this skill into the project (run from the project root):',
        '',
        '```sh',
        'mkdir -p .claude/skills',
        `cp -R ${q(`${D}/skill/my-skill`)} .claude/skills/my-skill`,
        '```',
        '',
      ].join('\n'),
    );
    const link = await render(
      D,
      flat({ overrides: [{ key: 'skill/my-skill', options: { symlink: true } }] }),
    );
    expect(link.markdown).toContain(`ln -s ${q(`${D}/skill/my-skill`)} .claude/skills/my-skill\n`);
    expect(link.markdown).not.toContain('cp -R');
  });

  it('shell-quotes paths with spaces and wraps such link destinations in <…>', async () => {
    const parent = tmp.make();
    const D = path.join(parent, 'my data');
    writeTree(D, validDataTree());
    const { markdown } = await render(D, goldenRecipe());
    expect(markdown).toContain(`cp -R '${D}/skill/my-skill' .claude/skills/my-skill\n`);
    expect(markdown).toContain(
      `See [one](<${D}/kb/demo/concepts/one.md>) and [ctxman](<${D}/kb/demo/index.md>).`,
    );
    // inline code is not shell: the path is shown as is
    expect(markdown).toContain(`\`${D}/kb/demo/index.md\``);
  });

  it('inline: frontmatter, body with absolute links, and the other files of the skill', async () => {
    const { D } = world();
    const { markdown } = await render(
      D,
      flat({
        overrides: [
          { key: 'skill/my-skill', mode: 'inline', options: { includeFrontmatter: true } },
        ],
      }),
    );
    expect(body(markdown)).toBe(
      [
        '## my-skill',
        '',
        `\`skill/my-skill\` · Skill · \`${D}/skill/my-skill/SKILL.md\``,
        '',
        '```yaml',
        'name: my-skill',
        'description: A skill.',
        '```',
        '',
        // the body heading differs from the item title (the skill name), so it is kept and shifted
        '### My skill',
        '',
        `See [checklist](${D}/skill/my-skill/references/checklist.md).`,
        '',
        `Files in this skill (under \`${D}/skill/my-skill\`):`,
        '',
        `- \`references/checklist.md\` — \`${D}/skill/my-skill/references/checklist.md\``,
        '',
      ].join('\n'),
    );
  });

  it('pointer: eager per target', async () => {
    const { D } = world();
    const abs = `${D}/skill/my-skill/SKILL.md`;
    const cc = await render(
      D,
      flat({ overrides: [{ key: 'skill/my-skill', mode: 'pointer', options: { eager: true } }] }),
    );
    expect(cc.markdown).toContain(
      `\`skill/my-skill\` · Skill · A skill. Read it before starting: @${abs}\n`,
    );
    const codex = await render(
      D,
      flat({
        target: 'codex',
        overrides: [{ key: 'skill/my-skill', mode: 'pointer', options: { eager: true } }],
      }),
    );
    expect(codex.markdown).toContain(`A skill. Read \`${abs}\` before starting.\n`);
  });
});

// ---------------------------------------------------------------- reference modes

describe('local-repo modes', () => {
  const only = (slug: string, r: Record<string, unknown> = {}): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'reference', slug }], ...r });

  it('describe: description, read hint and the owner in the meta line', async () => {
    const { D, repo } = world();
    const { markdown } = await render(D, only('lr'));
    expect(body(markdown)).toBe(
      [
        '## lr',
        '',
        `\`reference/lr\` · Local repo · owner: me · \`${repo}\``,
        '',
        'Desc lr.',
        '',
        `Read the code at \`${repo}\` when the task needs it.`,
        '',
      ].join('\n'),
    );
  });

  it('describe with a subpath names the repository root', async () => {
    const { D, repo } = world();
    const { markdown } = await render(D, only('lr-sub'));
    expect(markdown).toContain(`owner: not me · \`${repo}\``);
    expect(markdown).toContain(
      `Read the code at \`${path.join(repo, 'src')}\` (inside the repository \`${repo}\`) when the task needs it.\n`,
    );
  });

  it('tree: top-level entries (dirs first, case-insensitive, dot files and node_modules skipped)', async () => {
    const { D, repo } = world();
    const { markdown } = await render(
      D,
      only('lr', { overrides: [{ key: 'reference/lr', mode: 'tree' }] }),
    );
    expect(markdown).toContain(
      `Top-level entries of \`${repo}\` (4 of 4):\n\n\`\`\`text\nsrc/\nalpha.txt\nREADME.md\nZeta.txt\n\`\`\`\n`,
    );
  });

  it('tree: treeLimit caps the listing', async () => {
    const { D, repo } = world();
    const { markdown } = await render(
      D,
      only('lr', { overrides: [{ key: 'reference/lr', mode: 'tree', options: { treeLimit: 2 } }] }),
    );
    expect(markdown).toContain(
      `Top-level entries of \`${repo}\` (2 of 4):\n\n\`\`\`text\nsrc/\nalpha.txt\n\`\`\`\n`,
    );
    expect(markdown).not.toContain('Zeta.txt');
  });

  it('a missing path: sentence + path-missing warning, no listing (describe and tree)', async () => {
    const { D, repo } = world();
    const missing = path.join(repo, 'missing');
    for (const mode of ['describe', 'tree']) {
      const { markdown, manifest } = await render(
        D,
        only('lr-gone', { overrides: [{ key: 'reference/lr-gone', mode }] }),
      );
      expect(markdown).toContain(`The path \`${missing}\` does not exist on this machine.\n`);
      expect(markdown).not.toContain('Top-level entries');
      expect(manifest.warnings).toEqual([
        {
          code: 'path-missing',
          message: `reference/lr-gone: path ${missing} does not exist`,
          key: 'reference/lr-gone',
        },
      ]);
    }
  });

  it('expands ~ with the injected home directory', async () => {
    const { D } = world();
    const { markdown } = await render(D, only('lr-home'));
    expect(markdown).toContain(`\`${path.join('/home/test', 'code', 'thing')}\``);
  });
});

describe('local-folder modes', () => {
  const only = (slug: string, r: Record<string, unknown> = {}): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'reference', slug }], ...r });

  it('describe: a folder of files, not code in a repository', async () => {
    const { D, repo } = world();
    const { markdown } = await render(D, only('lf'));
    expect(body(markdown)).toBe(
      [
        '## lf',
        '',
        `\`reference/lf\` · Local folder · owner: me · \`${repo}\``,
        '',
        'Desc lf.',
        '',
        `Read the files at \`${repo}\` when the task needs it.`,
        '',
      ].join('\n'),
    );
    const sub = await render(D, only('lf-sub'));
    expect(sub.markdown).toContain(
      `Read the files at \`${path.join(repo, 'src')}\` (inside the folder \`${repo}\`) when the task needs it.\n`,
    );
  });

  it('tree: the same listing as a local repository', async () => {
    const { D, repo } = world();
    const { markdown } = await render(
      D,
      only('lf', { overrides: [{ key: 'reference/lf', mode: 'tree' }] }),
    );
    expect(markdown).toContain(
      `Top-level entries of \`${repo}\` (4 of 4):\n\n\`\`\`text\nsrc/\nalpha.txt\nREADME.md\nZeta.txt\n\`\`\`\n`,
    );
  });
});

describe('reference info', () => {
  const INFO_REF = {
    'reference/rr-info.yaml': [
      'name: rr-info',
      'description: Desc rr-info.',
      'type: remote-repo',
      'uri: https://github.com/o/info.git',
      'owner: me',
      'info: |',
      '  # Overview',
      '',
      '  See [the demo](ctxman:kb/demo), [docs](docs/a.md) and [gone](ctxman:kb/nope).',
      '',
      '  ## Build',
      '',
      '  Run `make`.',
      '',
    ].join('\n'),
  };
  const only = (r: Record<string, unknown> = {}): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'reference', slug: 'rr-info' }], ...r });

  it('is inlined after the description: headings nested under the item, ctxman: links resolved', async () => {
    const { D } = world(INFO_REF);
    const { markdown, manifest } = await render(D, only());
    expect(body(markdown)).toBe(
      [
        '## rr-info',
        '',
        '`reference/rr-info` · Remote repo · owner: me · `https://github.com/o/info.git`',
        '',
        'Desc rr-info.',
        '',
        '### Overview',
        '',
        `See [the demo](${D}/kb/demo/index.md), [docs](docs/a.md) and [gone](ctxman:kb/nope).`,
        '',
        '#### Build',
        '',
        'Run `make`.',
        '',
        'Git repository `https://github.com/o/info.git`. Clone it only if the task needs its contents.',
        '',
      ].join('\n'),
    );
    // only the ctxman: link that does not resolve is reported; other links of a reference stay as written
    expect(manifest.warnings).toEqual([
      {
        code: 'unresolved-link',
        key: 'reference/rr-info',
        message: 'reference/rr-info info: link "ctxman:kb/nope" does not resolve (no such entry)',
      },
    ]);
  });

  it('is printed in every mode, also with the clone commands; nested deeper in the grouped layout', async () => {
    const { D } = world(INFO_REF);
    const cloned = await render(
      D,
      only({ overrides: [{ key: 'reference/rr-info', mode: 'clone' }] }),
    );
    expect(cloned.markdown).toMatch(
      /Desc rr-info\.\n\n### Overview\n[\s\S]*Run `make`\.\n\nClone it into the project/,
    );
    const grouped = await render(
      D,
      recipe({ layout: 'grouped', items: [{ dataset: 'reference', slug: 'rr-info' }] }),
    );
    expect(grouped.markdown).toContain('\n#### Overview\n');
    expect(grouped.markdown).toContain('\n##### Build\n');
  });

  it('a blank info adds nothing', async () => {
    const { D } = world({
      'reference/rr-info.yaml':
        'name: rr-info\ndescription: Desc rr-info.\ntype: remote-repo\nuri: https://github.com/o/info.git\nowner: me\ninfo: "  "\n',
    });
    const { markdown } = await render(D, only());
    expect(body(markdown)).toBe(
      [
        '## rr-info',
        '',
        '`reference/rr-info` · Remote repo · owner: me · `https://github.com/o/info.git`',
        '',
        'Desc rr-info.',
        '',
        'Git repository `https://github.com/o/info.git`. Clone it only if the task needs its contents.',
        '',
      ].join('\n'),
    );
  });
});

describe('snippet items', () => {
  const RULES = {
    'snippet/rules.yaml': [
      'name: rules',
      'description: House rules.',
      'markdown: |',
      '  # rules',
      '',
      '  See [the demo](ctxman:kb/demo) and [gone](ctxman:kb/nope).',
      '',
      '  ## Commits',
      '',
      '  Use `feat:`.',
      '',
    ].join('\n'),
  };
  const only = (r: Record<string, unknown> = {}): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'snippet', slug: 'rules' }], ...r });

  it('inline: only the markdown under the heading (its own title dropped, headings nested, links resolved)', async () => {
    const { D } = world(RULES);
    const { markdown, manifest } = await render(D, only());
    expect(body(markdown)).toBe(
      [
        '## rules',
        '',
        `See [the demo](${D}/kb/demo/index.md) and [gone](ctxman:kb/nope).`,
        '',
        '### Commits',
        '',
        'Use `feat:`.',
        '',
      ].join('\n'),
    );
    expect(manifest.warnings).toEqual([
      {
        code: 'unresolved-link',
        key: 'snippet/rules',
        message: 'snippet/rules: link "ctxman:kb/nope" does not resolve (no such entry)',
      },
    ]);
  });

  it('shiftHeadings and rewriteLinks off keep the markdown as written', async () => {
    const { D } = world(RULES);
    const { markdown, manifest } = await render(
      D,
      only({
        overrides: [
          { key: 'snippet/rules', options: { shiftHeadings: false, rewriteLinks: false } },
        ],
      }),
    );
    expect(body(markdown)).toContain('See [the demo](ctxman:kb/demo)');
    expect(body(markdown)).toContain('\n## Commits\n');
    expect(manifest.warnings).toEqual([]);
  });

  it('a context link to a snippet puts its notes as guidance above the markdown', async () => {
    const { D } = world({
      ...RULES,
      'context/with-rules.yaml':
        'name: with-rules\ndescription: d\nlinks:\n  - dataset: snippet\n    slug: rules\n    notes: Always apply these.\n',
    });
    const { markdown } = await render(D, recipe({ layout: 'flat', contexts: ['with-rules'] }));
    const at = markdown.indexOf('## rules\n');
    expect(at).toBeGreaterThan(-1);
    expect(markdown.slice(at)).toMatch(
      /^## rules\n\n> \*\*From context `with-rules`:\*\* Always apply these\.\n\nSee \[the demo\]/,
    );
  });

  it('a missing or invalid snippet is reported like any other item', async () => {
    const { D } = world({ 'snippet/bad.yaml': 'name: bad\ndescription: d\n' });
    const missing = await render(D, recipe({ items: [{ dataset: 'snippet', slug: 'gone' }] }));
    expect(missing.manifest.warnings.map((w) => w.code)).toContain('item-missing');
    const invalid = await render(D, recipe({ items: [{ dataset: 'snippet', slug: 'bad' }] }));
    expect(invalid.manifest.warnings.map((w) => w.code)).toContain('item-invalid');
  });
});

describe('remote-repo modes', () => {
  const only = (slug: string, r: Record<string, unknown> = {}): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'reference', slug }], ...r });

  it('describe: URI and relevant subpath', async () => {
    const { D } = world();
    const { markdown } = await render(D, only('rr'));
    expect(body(markdown)).toBe(
      [
        '## rr',
        '',
        '`reference/rr` · Remote repo · owner: not me · `https://github.com/o/r.git`',
        '',
        'Desc rr.',
        '',
        'Git repository `https://github.com/o/r.git`, relevant path `docs`. Clone it only if the task needs its contents.',
        '',
      ].join('\n'),
    );
    const plain = await render(D, only('rr-plain'));
    expect(plain.markdown).toContain(
      'Git repository `git@github.com:o/r.git`. Clone it only if the task needs its contents.\n',
    );
  });

  it('clone: shallow by default, into the {name} directory, then read the subpath', async () => {
    const { D } = world();
    const { markdown } = await render(
      D,
      only('rr', { overrides: [{ key: 'reference/rr', mode: 'clone' }] }),
    );
    expect(body(markdown)).toBe(
      [
        '## rr',
        '',
        '`reference/rr` · Remote repo · owner: not me · `https://github.com/o/r.git`',
        '',
        'Desc rr.',
        '',
        'Clone it into the project (run from the project root; keep `.ctxman/` out of version control):',
        '',
        '```sh',
        'git clone --depth 1 https://github.com/o/r.git .ctxman/refs/rr',
        '```',
        '',
        'Then read `.ctxman/refs/rr/docs`.',
        '',
      ].join('\n'),
    );
  });

  it('clone: shallow off, custom cloneDir', async () => {
    const { D } = world();
    const { markdown } = await render(
      D,
      only('rr-plain', {
        overrides: [
          {
            key: 'reference/rr-plain',
            mode: 'clone',
            options: { shallow: false, cloneDir: 'vendor/{name}-src' },
          },
        ],
      }),
    );
    expect(markdown).toContain(
      '```sh\ngit clone git@github.com:o/r.git vendor/rr-plain-src\n```\n',
    );
    expect(markdown).not.toContain('Then read');
  });

  it('clone: sparse with a subpath uses a blobless sparse checkout', async () => {
    const { D } = world();
    const sparse = await render(
      D,
      only('rr', {
        overrides: [{ key: 'reference/rr', mode: 'clone', options: { sparse: true } }],
      }),
    );
    expect(sparse.markdown).toContain(
      '```sh\ngit clone --depth 1 --filter=blob:none --sparse https://github.com/o/r.git .ctxman/refs/rr\ngit -C .ctxman/refs/rr sparse-checkout set docs\n```\n',
    );
    const deep = await render(
      D,
      only('rr', {
        overrides: [
          { key: 'reference/rr', mode: 'clone', options: { sparse: true, shallow: false } },
        ],
      }),
    );
    expect(deep.markdown).toContain(
      'git clone --filter=blob:none --sparse https://github.com/o/r.git .ctxman/refs/rr\n',
    );
    // sparse without a subpath is a plain clone
    const noSub = await render(
      D,
      only('rr-plain', {
        overrides: [{ key: 'reference/rr-plain', mode: 'clone', options: { sparse: true } }],
      }),
    );
    expect(noSub.markdown).toContain(
      '```sh\ngit clone --depth 1 git@github.com:o/r.git .ctxman/refs/rr-plain\n```\n',
    );
  });
});

describe('remote-skill modes', () => {
  const only = (slug: string, r: Record<string, unknown> = {}): RecipeData =>
    recipe({ layout: 'flat', items: [{ dataset: 'reference', slug }], ...r });
  const lead = (n: string) =>
    `Install this skill into \`.claude/skills/${n}/\` (run from the project root):`;
  const ARCHIVE_NOTE =
    'The skill folder is the one that contains SKILL.md; if the archive wraps it in a top-level folder, copy that folder instead.';

  it('describe: git repository and archive wording, with the skill folder', async () => {
    const { D } = world();
    const git = await render(
      D,
      only('rs-git-sub', { overrides: [{ key: 'reference/rs-git-sub', mode: 'describe' }] }),
    );
    expect(body(git.markdown)).toBe(
      [
        '## rs-git-sub',
        '',
        '`reference/rs-git-sub` · Remote skill · git · owner: me · `https://github.com/o/skills.git`',
        '',
        'Desc rs-git-sub.',
        '',
        'Agent skill in the git repository `https://github.com/o/skills.git` (skill folder `skills/foo`). Install it only if the task needs it.',
        '',
      ].join('\n'),
    );
    const tar = await render(
      D,
      only('rs-tar', { overrides: [{ key: 'reference/rs-tar', mode: 'describe' }] }),
    );
    expect(tar.markdown).toContain('Remote skill · archive · owner: me');
    expect(tar.markdown).toContain(
      'Agent skill packaged as an archive at `https://h.test/skill.tar.gz`. Install it only if the task needs it.\n',
    );
  });

  it('install from a git repository (the default for claude-code), with and without a subpath', async () => {
    const { D } = world();
    const plain = await render(D, only('rs-git'));
    expect(body(plain.markdown)).toBe(
      [
        '## rs-git',
        '',
        '`reference/rs-git` · Remote skill · git · owner: me · `https://github.com/o/skills.git`',
        '',
        'Desc rs-git.',
        '',
        lead('rs-git'),
        '',
        '```sh',
        'mkdir -p .claude/skills',
        'git clone --depth 1 https://github.com/o/skills.git .claude/skills/rs-git',
        'rm -rf .claude/skills/rs-git/.git',
        '```',
        '',
      ].join('\n'),
    );
    const sub = await render(D, only('rs-git-sub'));
    expect(sub.markdown).toContain(
      [
        lead('rs-git-sub'),
        '',
        '```sh',
        'mkdir -p .claude/skills .ctxman/tmp',
        'git clone --depth 1 https://github.com/o/skills.git .ctxman/tmp/rs-git-sub',
        'cp -R .ctxman/tmp/rs-git-sub/skills/foo .claude/skills/rs-git-sub',
        'rm -rf .ctxman/tmp/rs-git-sub',
        '```',
        '',
      ].join('\n'),
    );
    expect(sub.markdown).not.toContain(ARCHIVE_NOTE);
  });

  it('install from a .tar.gz / .tgz archive, with and without a subpath', async () => {
    const { D } = world();
    const tar = await render(D, only('rs-tar'));
    expect(tar.markdown).toContain(
      [
        lead('rs-tar'),
        '',
        '```sh',
        'mkdir -p .claude/skills .ctxman/tmp/rs-tar',
        'curl -fsSL https://h.test/skill.tar.gz -o .ctxman/tmp/rs-tar.tgz',
        'tar -xzf .ctxman/tmp/rs-tar.tgz -C .ctxman/tmp/rs-tar',
        'cp -R .ctxman/tmp/rs-tar .claude/skills/rs-tar',
        'rm -rf .ctxman/tmp/rs-tar .ctxman/tmp/rs-tar.tgz',
        '```',
        '',
        ARCHIVE_NOTE,
        '',
      ].join('\n'),
    );
    const sub = await render(D, only('rs-tar-sub'));
    expect(sub.markdown).toContain(
      'curl -fsSL https://h.test/skill.tgz -o .ctxman/tmp/rs-tar-sub.tgz\n',
    );
    expect(sub.markdown).toContain(
      'cp -R .ctxman/tmp/rs-tar-sub/pkg/skill .claude/skills/rs-tar-sub\n',
    );
  });

  it('install from a .zip archive uses unzip', async () => {
    const { D } = world();
    const zip = await render(D, only('rs-zip', { target: 'codex' }));
    expect(zip.markdown).toContain(
      [
        'Install this skill into `.agents/skills/rs-zip/` (run from the project root):',
        '',
        '```sh',
        'mkdir -p .agents/skills .ctxman/tmp/rs-zip',
        'curl -fsSL https://h.test/skill.zip -o .ctxman/tmp/rs-zip.zip',
        'unzip -q .ctxman/tmp/rs-zip.zip -d .ctxman/tmp/rs-zip',
        'cp -R .ctxman/tmp/rs-zip .agents/skills/rs-zip',
        'rm -rf .ctxman/tmp/rs-zip .ctxman/tmp/rs-zip.zip',
        '```',
      ].join('\n'),
    );
    expect(zip.markdown).not.toContain('tar -xzf');
  });

  it('generic target defaults a remote skill to describe', async () => {
    const { D } = world();
    const { markdown } = await render(D, only('rs-git', { target: 'generic' }));
    expect(markdown).toContain('Agent skill in the git repository');
    expect(markdown).not.toContain('git clone');
  });
});

// ---------------------------------------------------------------- manifest

describe('manifest', () => {
  it('describes the document, contexts and every segment', async () => {
    const { D } = world();
    const r = goldenRecipe({
      overrides: [{ key: 'kb/demo', mode: 'summary' }],
      markdown: [{ id: 'b1', body: 'Hello é' }],
    });
    const { markdown, manifest } = await render(D, r);
    expect(manifest).toMatchObject({
      recipe: 'demo-brief',
      target: 'claude-code',
      layout: 'grouped',
      generatedAt: GENERATED_AT,
      bytes: Buffer.byteLength(markdown),
      counts: { included: 3, excluded: 0, missing: 0 },
      contexts: [{ slug: 'ctx', status: 'ready' }],
      warnings: [],
    });
    expect(manifest.segments.map((s) => [s.key, s.type, s.status, s.title])).toEqual([
      ['ctx:ctx', 'context-intro', 'included', 'ctx'],
      ['kb/demo', 'item', 'included', 'Demo'],
      ['task/do-it', 'item', 'included', 'do-it'],
      ['sec:extra', 'section-intro', 'included', 'Additional items'],
      ['skill/my-skill', 'item', 'included', 'my-skill'],
      ['md:b1', 'markdown', 'included', 'Markdown b1'],
    ]);
    const demo = manifest.segments.find((s) => s.key === 'kb/demo');
    expect(demo).toMatchObject({
      dataset: 'kb',
      slug: 'demo',
      kind: 'kb',
      mode: 'summary',
      modeLabel: 'Summary',
      options: {},
      via: ['ctx'],
      adhoc: false,
      source: `${D}/kb/demo/index.md`,
    });
    const skill = manifest.segments.find((s) => s.key === 'skill/my-skill');
    expect(skill).toMatchObject({
      via: [],
      adhoc: true,
      modeLabel: 'Install',
      source: `${D}/skill/my-skill/SKILL.md`,
    });
    // segment bytes are UTF-8 sizes of each rendered segment
    expect(manifest.segments.find((s) => s.key === 'md:b1')?.bytes).toBe(
      Buffer.byteLength('Hello é'),
    );
    expect(manifest.segments.find((s) => s.key === 'sec:extra')?.bytes).toBe(
      Buffer.byteLength('## Additional items'),
    );
    expect(manifest.segments.find((s) => s.key === 'ctx:ctx')?.bytes).toBe(
      Buffer.byteLength('## Context: ctx\n\nA context.'),
    );
  });

  it('collects and de-duplicates warnings of every stage', async () => {
    const { D } = world();
    const { manifest } = await render(
      D,
      recipe({
        contexts: ['ctx', 'gone'],
        items: [{ dataset: 'kb', slug: 'nope' }],
        overrides: [{ key: 'bug/not-here', exclude: true }],
      }),
    );
    expect(manifest.contexts).toEqual([
      { slug: 'ctx', status: 'ready' },
      { slug: 'gone', status: 'missing' },
    ]);
    expect(manifest.warnings.map((w) => w.code)).toEqual([
      'context-missing',
      'item-missing',
      'override-stale',
    ]);
  });

  it('large-output: warns above 512 KB but still produces the document', async () => {
    const big = Array.from({ length: 6 }, (_, i) => [
      `kb/big/concepts/c${i}.md`,
      `---\ntype: Concept\n---\n${'y'.repeat(100 * 1024)}\n`,
    ]);
    const { D } = world({
      'kb/big/index.md': '---\ntype: Knowledge Base\nname: big\ndescription: Big.\n---\n\n# Big\n',
      ...Object.fromEntries(big),
    });
    const { markdown, manifest } = await render(
      D,
      recipe({
        layout: 'flat',
        items: [{ dataset: 'kb', slug: 'big' }],
        overrides: [{ key: 'kb/big', mode: 'inline-bundle' }],
      }),
    );
    expect(manifest.bytes).toBeGreaterThan(LARGE_OUTPUT_BYTES);
    expect(markdown.length).toBeGreaterThan(LARGE_OUTPUT_BYTES);
    const warning = manifest.warnings.find((w) => w.code === 'large-output');
    expect(warning?.message).toMatch(
      /^the document is \d+ KB \(over 512 KB\); use summary or pointer modes for large items$/,
    );
    expect(manifest.warnings.filter((w) => w.code === 'large-output')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- pure renderPlan

describe('renderPlan (pure)', () => {
  it('renders from a plan and hand-built content without touching the filesystem', async () => {
    const sources = createFsSources({ dataDir: world().D });
    const r = goldenRecipe();
    const plan = expandRecipe(r, lookupFrom(await loadExpandInputs(r, sources)));
    const content = await gatherContent(plan, sources);
    const once = renderPlan(plan, content, { generatedAt: GENERATED_AT });
    const twice = renderPlan(plan, content, { generatedAt: GENERATED_AT });
    expect(twice).toEqual(once);
    expect(Object.keys(content.items).sort()).toEqual(['kb/demo', 'skill/my-skill', 'task/do-it']);
    expect(content.targets).toEqual({
      'kb/demo': { title: 'Demo', abs: expect.stringMatching(/kb[\\/]demo[\\/]index\.md$/) },
    });
  });
});

// ---------------------------------------------------------------- working directory (plans/INFLATE_V2_SPEC.md §9)

const WD = '/Users/me/ctxman-inflate/ctxman-dev-brief';

interface DirWorld {
  D: string;
  repo: string;
  folder: string;
}

/** The seed-like tree plus a local repo, a missing local repo, a local folder and one remote shape of every kind. */
function dirWorld(extra: Record<string, string> = {}): DirWorld {
  const repo = tmp.make({
    'README.md': '',
    'src/index.ts': '',
    'src/util.ts': '',
    'docs/a.md': '',
  });
  const folder = tmp.make({ 'notes.md': '', 'drafts/a.md': '' });
  const D = tmp.make(
    seedTree({
      'skill/foo/SKILL.md': `---\nname: foo\ndescription: A local skill.\n---\n\n# Foo\n\nSee [steps](references/steps.md).\n`,
      'skill/foo/references/steps.md': '# Steps\n\n- one\n',
      'reference/lr.yaml': referenceYaml(
        'lr',
        `type: local-repo\npath: ${repo}\nsubpath: src\nowner: me\n`,
      ),
      'reference/lr-gone.yaml': referenceYaml(
        'lr-gone',
        `type: local-repo\npath: ${path.join(repo, 'missing')}\nowner: me\n`,
      ),
      'reference/rr.yaml': referenceYaml(
        'rr',
        'type: remote-repo\nuri: git@github.com:o/r.git\nsubpath: docs\nowner: me\n',
      ),
      'reference/rr-plain.yaml': referenceYaml(
        'rr-plain',
        'type: remote-repo\nuri: https://github.com/o/plain.git\nowner: not-me\n',
      ),
      'reference/rs-git.yaml': referenceYaml(
        'rs-git',
        'type: remote-skill\nuri: https://github.com/o/skills.git\nsubpath: skills/bar\nowner: me\n',
      ),
      'reference/rs-tgz.yaml': referenceYaml(
        'rs-tgz',
        'type: remote-skill\nuri: https://h.test/skill.tar.gz\nowner: me\n',
      ),
      'reference/lf.yaml': referenceYaml(
        'lf',
        `type: local-folder\npath: ${folder}\nsubpath: drafts\nowner: not-me\n`,
      ),
      ...extra,
    }),
  );
  return { D, repo, folder };
}

interface DirRender {
  plan: MaterialPlan;
  output: RenderOutput;
  result: InflateResult;
}

/** expand → gather → plan → render for a working directory; `fail` marks views failed like a run would. */
async function renderDir(
  w: DirWorld,
  recipe: RecipeData,
  opts: { fail?: Record<string, string>; contextFile?: string } = {},
): Promise<DirRender> {
  const { plan, content } = await prepare(w.D, recipe);
  const mp = planMaterialization({
    plan,
    content,
    dir: WD,
    dirExists: false,
    previous: null,
    tools: { git: true, tar: true, unzip: true },
  });
  const materials: Record<string, MaterialView> = { ...mp.materials };
  for (const [key, reason] of Object.entries(opts.fail ?? {})) {
    const view = materials[key];
    if (view === undefined) throw new Error(`no view for ${key}`);
    materials[key] = { ...view, state: 'failed', reason };
  }
  const output: RenderOutput = {
    dir: WD,
    contextFile: opts.contextFile ?? recipe.output?.contextFile ?? 'LLM_CONTEXT.md',
    primary: mp.primary,
    target: recipe.target,
    materials,
    files: mp.files,
  };
  return {
    plan: mp,
    output,
    result: renderPlan(plan, content, { generatedAt: GENERATED_AT, output }),
  };
}

/** A flat recipe of ad hoc items with overrides. */
function flatDir(
  items: readonly string[],
  overrides: Record<string, unknown>[] = [],
  change: Record<string, unknown> = {},
): RecipeData {
  return seedRecipe({
    layout: 'flat',
    contexts: [],
    markdown: [],
    order: [],
    preamble: '',
    output: { dir: WD },
    items: items.map((key) => {
      const [dataset, slug] = key.split('/');
      return { dataset, slug };
    }),
    overrides,
    ...change,
  });
}

/** The section starting at heading `## name` up to the next `## ` heading. */
function section(markdown: string, name: string): string {
  const start = markdown.indexOf(`## ${name}\n`);
  if (start === -1) return '';
  const rest = markdown.slice(start + 3);
  const next = rest.search(/\n## /);
  return markdown.slice(start, next === -1 ? undefined : start + 3 + next).trimEnd();
}

// ---------------------------------------------------------------- working directory document (plans/INFLATE_V3_PLAN.md §7)

describe('renderPlan with output: golden document (the seed example)', () => {
  const expected = (D: string): string =>
    [
      '# ctxman-dev-brief',
      '',
      '> Prepared by ctxman for a Claude Code session.',
      `> This directory is the working root (\`${WD}\`). Links and paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
      '> Skills go in `.claude/skills/<name>/`; project-wide instructions belong in `CLAUDE.md`.',
      '> `CLAUDE.md` in this directory loads this file.',
      '',
      'You are working on ctxman.',
      '',
      'Use pnpm only.',
      '',
      '## Working directory map',
      '',
      '```text',
      'LLM_CONTEXT.md                    this file',
      'CLAUDE.md                         loads this file',
      '.gitignore                        ignores the machine-specific paths below',
      'repos/',
      '  astro-docs/                     git clone, sparse · primary · editable · The Astro documentation source, English content. Consul…',
      'kb/',
      '  ctxman/                         symlink · What ctxman is, how it is built, and how to work with i…',
      '  astro-content-layer/            symlink · How Astro 7 content collections, loaders and schemas wo…',
      'rca/',
      '  astro-dev-full-reload-on-save/  symlink · Saving a context in the forge reloaded the whole page,…',
      'idea/',
      '  context-inflate/                symlink · A tool that turns selected contexts plus user instructi…',
      'task/',
      '  write-agents-md/                symlink · Write and maintain the agent guide at the repository ro…',
      'feature/',
      '  context-forge/                  symlink · A UI at /forge to discover entries across datasets and…',
      'project/',
      '  ctxman-v1/                      symlink · Deliver the first complete version of ctxman with ten d…',
      '.claude/skills/',
      '  okf-authoring/                  symlink · Author and review OKF v0.2 knowledge bundles (kb, rca,…',
      '  ctxman-add-entry/               symlink · Create a new ctxman dataset entry with the add scripts.',
      '```',
      '',
      '## Placement',
      '',
      '- **symlink**: the original folder, live; edits change the source (your ctxman entry or local repository).',
      '- **git clone**: a checkout of the remote repository; the next inflate pulls (fast-forward only) and keeps local changes and unpushed commits.',
      '- **editable** repositories may be changed for this task; **read-only** ones are reference material: read them, do not change them.',
      '- Knowledge, work items and skills from ctxman are your own notes; `owner` says whether a repository or remote skill is yours.',
      '',
      '## Primary repository',
      '',
      '**astro-docs** · [`repos/astro-docs/`](repos/astro-docs/) · `reference/astro-docs` · owner: not me · editable',
      '',
      'The Astro documentation source, English content. Consult it for content collections, loaders, routing and configuration.',
      '',
      '- Source: git clone of `https://github.com/withastro/docs.git`, shallow (depth 1), sparse checkout of `src/content/docs/en`',
      '- Start in: [`repos/astro-docs/src/content/docs/en/`](repos/astro-docs/src/content/docs/en/)',
      '',
      'Work in [`repos/astro-docs/`](repos/astro-docs/) unless the task says otherwise.',
      '',
      '## Skills',
      '',
      'Installed in `.claude/skills/`, where Claude Code discovers them.',
      '',
      '- [`.claude/skills/okf-authoring/`](.claude/skills/okf-authoring/) · **okf-authoring** · symlink to the ctxman skill · owner: me — Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).',
      '- [`.claude/skills/ctxman-add-entry/`](.claude/skills/ctxman-add-entry/) · **ctxman-add-entry** · symlink to the ctxman skill · owner: me — Create a new ctxman dataset entry with the add scripts.',
      '',
      '## Ground rules',
      '',
      '- Keep AGENTS.md current.',
      '',
      '## Context: ctxman-dev',
      '',
      'Everything an agent needs to work on ctxman itself.',
      '',
      '### ctxman',
      '',
      '`kb/ctxman` · Knowledge Base · tags: ctxman, architecture, docs · [`kb/ctxman/index.md`](kb/ctxman/index.md) · symlink',
      '',
      '> **From context `ctxman-dev`:** Start here.',
      '',
      'What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.',
      '',
      `See [datasets](kb/ctxman/concepts/datasets.md), the [idea](idea/context-inflate/index.md) and the [docs](${D}/reference/astro-docs.yaml).`,
      '',
      '#### Datasets',
      '',
      '`concepts/datasets.md` · [`kb/ctxman/concepts/datasets.md`](kb/ctxman/concepts/datasets.md)',
      '',
      'Back to [entry](kb/ctxman/index.md).',
      '',
      '### astro-content-layer',
      '',
      '`kb/astro-content-layer` · Knowledge Base · [`kb/astro-content-layer/index.md`](kb/astro-content-layer/index.md) · symlink',
      '',
      'How Astro 7 content collections, loaders and schemas work.',
      '',
      '### astro-dev-full-reload-on-save',
      '',
      '`rca/astro-dev-full-reload-on-save` · Root Cause Analysis · [`rca/astro-dev-full-reload-on-save/index.md`](rca/astro-dev-full-reload-on-save/index.md) · symlink',
      '',
      'Saving a context in the forge reloaded the whole page, because the loader watched the file.',
      '',
      '### context-inflate',
      '',
      '`idea/context-inflate` · Idea · state: Pending · [`idea/context-inflate/index.md`](idea/context-inflate/index.md) · symlink',
      '',
      'A tool that turns selected contexts plus user instructions into one document.',
      '',
      '### write-agents-md',
      '',
      '`task/write-agents-md` · Task · state: Pending · [`task/write-agents-md/index.md`](task/write-agents-md/index.md) · symlink',
      '',
      'Write and maintain the agent guide at the repository root.',
      '',
      '### context-forge',
      '',
      '`feature/context-forge` · Feature · state: In progress · [`feature/context-forge/index.md`](feature/context-forge/index.md) · symlink',
      '',
      'A UI at /forge to discover entries across datasets and build contexts.',
      '',
      '### ctxman-v1',
      '',
      '`project/ctxman-v1` · Project · state: WIP · [`project/ctxman-v1/index.md`](project/ctxman-v1/index.md) · symlink',
      '',
      'Deliver the first complete version of ctxman with ten datasets.',
      '',
      '### okf-authoring',
      '',
      '`skill/okf-authoring` · Skill · [`.claude/skills/okf-authoring/SKILL.md`](.claude/skills/okf-authoring/SKILL.md) · symlink',
      '',
      'Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).',
      '',
      '### astro-docs',
      '',
      '`reference/astro-docs` · Remote repo · tags: astro, docs · [`repos/astro-docs/`](repos/astro-docs/) · git clone · primary · editable',
      '',
      '> **From context `ctxman-dev`:** Upstream Astro docs.',
      '',
      'Details: see Primary repository.',
      '',
      '## Additional items',
      '',
      '### ctxman-add-entry',
      '',
      '`skill/ctxman-add-entry` · Skill · [`.claude/skills/ctxman-add-entry/SKILL.md`](.claude/skills/ctxman-add-entry/SKILL.md) · symlink',
      '',
      'Create a new ctxman dataset entry with the add scripts.',
      '',
    ].join('\n');

  it('matches the seed example: relative links, map, legend, primary, skills, then the composition', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, seedRecipe());
    expect(result.markdown).toBe(expected(w.D));
    // the only absolute path of a ctxman data file left is the unmounted ctxman: link
    expect(result.markdown.split(w.D).length - 1).toBe(1);
  });

  it('is deterministic: same plan and content, same bytes, no timestamp', async () => {
    const w = dirWorld();
    const a = await renderDir(w, seedRecipe());
    const b = await renderDir(w, seedRecipe());
    expect(b.result.markdown).toBe(a.result.markdown);
    expect(a.result.markdown).not.toContain(GENERATED_AT);
  });

  it('manifest: output, material, dest and the placed mode label per item', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, seedRecipe());
    const m = result.manifest;
    expect(m.output).toEqual({
      dir: WD,
      contextFile: 'LLM_CONTEXT.md',
      primary: 'reference/astro-docs',
    });
    const seg = (key: string) => m.segments.find((s) => s.key === key);
    expect(seg('kb/ctxman')).toMatchObject({
      material: 'symlink',
      dest: 'kb/ctxman',
      mode: 'inline-bundle',
      modeLabel: 'Inline bundle',
    });
    expect(seg('task/write-agents-md')).toMatchObject({
      mode: 'summary',
      modeLabel: 'Summary + links',
    });
    expect(seg('skill/okf-authoring')).toMatchObject({
      material: 'symlink',
      dest: '.claude/skills/okf-authoring',
      mode: 'pointer',
      modeLabel: 'Link',
    });
    expect(seg('reference/astro-docs')).toMatchObject({
      material: 'clone',
      dest: 'repos/astro-docs',
      modeLabel: 'Describe',
      // `source` stays the absolute entry file
      source: expect.stringMatching(/astro-docs\.yaml$/),
    });
    expect(seg('bug/stale-badge-timezone')?.material).toBeUndefined();
    expect(seg('md:b1')?.dest).toBeUndefined();
    expect(seg('ctx:ctxman-dev')?.material).toBeUndefined();
    expect(m.counts).toEqual({ included: 10, excluded: 1, missing: 0 });
  });

  it('the mode label follows the rendered placement: not placed (material none) is "Summary" / "Pointer"', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['task/write-agents-md', 'skill/foo', 'idea/context-inflate'],
        [
          { key: 'task/write-agents-md', material: 'none', mode: 'summary' },
          { key: 'skill/foo', material: 'none', mode: 'pointer' },
          { key: 'idea/context-inflate', mode: 'pointer' },
        ],
      ),
    );
    const label = (key: string) => result.manifest.segments.find((s) => s.key === key)?.modeLabel;
    expect(label('task/write-agents-md')).toBe('Summary');
    expect(label('skill/foo')).toBe('Pointer');
    expect(label('idea/context-inflate')).toBe('Pointer');
  });
});

describe('renderPlan without output stays the v1 document', () => {
  it('has absolute paths in code spans, the v1 header and neither sections nor manifest output', async () => {
    const w = dirWorld();
    // no output directory: nothing is placed, so the modes are the document-only (v2) defaults
    const r = seedRecipe({ output: undefined });
    const result = await inflateRecipe(
      r,
      createFsSources({ dataDir: w.D, nowMs: Date.parse(GENERATED_AT), homeDir: '/home/test' }),
      new Date(GENERATED_AT),
    );
    const md = result.markdown;
    expect(md).toContain(
      '> Paths are absolute paths on this machine. Read the referenced files and run the listed commands only when the task needs them.',
    );
    expect(md).not.toContain('Working directory map');
    expect(md).not.toContain('## Placement');
    expect(md).not.toContain('## Primary repository');
    expect(md).not.toContain('## Skills');
    expect(md).not.toContain('this directory');
    // no path links (their text is a code span); the links inside the inlined bundle are the author's own
    expect(md).not.toContain('[`');
    expect(md).toContain(`${w.D}${path.sep}kb${path.sep}ctxman${path.sep}index.md`);
    expect(md).toContain('mkdir -p .claude/skills');
    expect(result.manifest.output).toBeUndefined();
    expect(
      result.manifest.segments.every((s) => s.material === undefined && s.dest === undefined),
    ).toBe(true);
    expect(Object.keys(result.manifest)).toEqual([
      'recipe',
      'target',
      'layout',
      'generatedAt',
      'bytes',
      'counts',
      'contexts',
      'segments',
      'warnings',
    ]);
  });

  it('a recipe WITH a directory rendered as the absolute document keeps code spans and the plain summary', async () => {
    const w = dirWorld();
    const result = await inflateRecipe(
      flatDir(['task/write-agents-md', 'skill/foo', 'reference/rr'], [], {
        output: { dir: WD, primary: 'reference/rr' },
      }),
      createFsSources({ dataDir: w.D, nowMs: Date.parse(GENERATED_AT), homeDir: '/home/test' }),
      new Date(GENERATED_AT),
    );
    const md = result.markdown;
    expect(md).not.toContain('## Placement');
    expect(md).not.toContain('Files:');
    expect(md).not.toContain('](');
    expect(md).toContain(
      `\`task/write-agents-md\` · Task · state: Pending · \`${path.join(w.D, 'task', 'write-agents-md', 'index.md')}\``,
    );
    expect(md).toContain(
      `\`skill/foo\` · Skill · A local skill. Read \`${path.join(w.D, 'skill', 'foo', 'SKILL.md')}\` and follow it when the task matches.`,
    );
    // v1 wording: describe, not the compact "Details" pointer
    expect(md).toContain('Clone it only if the task needs its contents.');
    expect(md).not.toContain('Details: see');
    expect(result.manifest.segments.find((s) => s.key === 'task/write-agents-md')?.modeLabel).toBe(
      'Summary',
    );
  });

  it('is the same function of (plan, content) as before: rendering twice gives the same result', async () => {
    const w = dirWorld();
    const { plan, content } = await prepare(w.D, seedRecipe());
    const v1 = renderPlan(plan, content, { generatedAt: GENERATED_AT });
    const again = renderPlan(plan, content, { generatedAt: GENERATED_AT });
    expect(again).toEqual(v1);
  });
});

describe('renderPlan with output: header', () => {
  it('codex: AGENTS.md line, codex skills dir; no CLAUDE.md line', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['skill/foo'], [], { target: 'codex' }));
    const head = result.markdown.split('\n\n## ')[0] ?? '';
    expect(head.split('\n')).toEqual([
      '# ctxman-dev-brief',
      '',
      '> Prepared by ctxman for a Codex session.',
      `> This directory is the working root (\`${WD}\`). Links and paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
      '> Skills go in `.agents/skills/<name>/`; project-wide instructions belong in `AGENTS.md`.',
      '> `AGENTS.md` in this directory points to this file.',
    ]);
    expect(section(result.markdown, 'Skills')).toContain(
      'Installed in `.agents/skills/`, where Codex discovers them.',
    );
  });

  it('generic: no skills line; no stub line when the stubs are off', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/foo'], [], {
        target: 'generic',
        output: { dir: WD, stubs: { agentsMd: false } },
      }),
    );
    expect((result.markdown.split('\n\n## ')[0] ?? '').split('\n')).toEqual([
      '# ctxman-dev-brief',
      '',
      '> Prepared by ctxman for an AI coding agent.',
      `> This directory is the working root (\`${WD}\`). Links and paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
    ]);
    expect(section(result.markdown, 'Skills')).toContain('Installed in `.agents/skills/`.');
  });

  it('a custom context file name is the "this file" row and the stub line target', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman'], [], { output: { dir: WD, contextFile: 'CONTEXT.md' } }),
    );
    expect(section(result.markdown, 'Working directory map')).toContain('CONTEXT.md  this file');
    expect(result.manifest.output).toMatchObject({ contextFile: 'CONTEXT.md' });
  });
});

describe('renderPlan with output: working directory map', () => {
  it('groups repos, okf datasets in registry order and the skills dir; the notes name the real placement', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        [
          'reference/rs-git',
          'task/write-agents-md',
          'kb/ctxman',
          'reference/lr',
          'reference/rr',
          'skill/foo',
          'reference/rs-tgz',
        ],
        [
          { key: 'reference/lr', edit: true },
          {
            key: 'reference/rr',
            material: 'clone',
            materialOptions: { branch: 'trunk', subpathOnly: true },
          },
          { key: 'kb/ctxman', material: 'copy' },
        ],
        { output: { dir: WD, primary: 'reference/rr' } },
      ),
    );
    expect(section(result.markdown, 'Working directory map')).toBe(
      [
        '## Working directory map',
        '',
        '```text',
        'LLM_CONTEXT.md      this file',
        'CLAUDE.md           loads this file',
        '.gitignore          ignores the machine-specific paths below',
        'repos/',
        '  lr/               symlink · editable · Desc lr.',
        '  rr/               git clone, sparse, branch trunk · primary · editable · Desc rr.',
        'kb/',
        '  ctxman/           copy · What ctxman is, how it is built, and how to work with i…',
        'task/',
        '  write-agents-md/  symlink · Write and maintain the agent guide at the repository ro…',
        '.claude/skills/',
        '  bar/              cloned · Desc rs-git.',
        '  foo/              symlink · A local skill.',
        '  rs-tgz/           downloaded · Desc rs-tgz.',
        '```',
      ].join('\n'),
    );
  });

  it('a copied local repository is a copy and never editable (not eligible)', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lr'], [{ key: 'reference/lr', material: 'copy', edit: true }]),
    );
    expect(section(result.markdown, 'Working directory map')).toMatch(/ {2}lr\/ +copy · Desc lr\./);
  });

  it('lists only what is placed: mention-only, demoted and failed items are not rows', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['kb/ctxman', 'kb/astro-content-layer', 'reference/lr-gone', 'reference/rr', 'skill/foo'],
        [
          { key: 'kb/astro-content-layer', material: 'none' },
          { key: 'reference/lr-gone', material: 'symlink' },
          // a remote repository is cloned by default since v3
          { key: 'reference/rr', material: 'none' },
        ],
      ),
      { fail: { 'kb/ctxman': 'symlink failed' } },
    );
    const map = section(result.markdown, 'Working directory map');
    expect(map).not.toContain('ctxman/');
    expect(map).not.toContain('astro-content-layer');
    expect(map).not.toContain('lr-gone');
    expect(map).not.toContain('rr/');
    expect(map).toContain('.claude/skills/\n  foo/');
  });

  it('keeps two spaces between a name longer than the column cap and its note', async () => {
    const long = 'a'.repeat(50);
    const D2 = tmp.make({
      ...seedTree(),
      [`kb/${long}/index.md`]: `---\ntype: Knowledge Base\nname: ${long}\ndescription: Long.\n---\n\n# Long\n`,
    });
    const { plan, content } = await prepare(D2, flatDir([`kb/${long}`]));
    const mp = planMaterialization({
      plan,
      content,
      dir: WD,
      dirExists: false,
      previous: null,
      tools: { git: true, tar: true, unzip: true },
    });
    const result = renderPlan(plan, content, {
      generatedAt: GENERATED_AT,
      output: {
        dir: WD,
        contextFile: 'LLM_CONTEXT.md',
        primary: null,
        target: 'claude-code',
        materials: mp.materials,
        files: mp.files,
      },
    });
    expect(section(result.markdown, 'Working directory map')).toContain(
      `  ${long}/  symlink · Long.`,
    );
  });
});

describe('renderPlan with output: Placement legend', () => {
  const SYMLINK =
    '- **symlink**: the original folder, live; edits change the source (your ctxman entry or local repository).';
  const COPY =
    '- **copy**: a snapshot taken when this directory was inflated; edits stay here and are replaced by the next inflate.';
  const CLONE =
    '- **git clone**: a checkout of the remote repository; the next inflate pulls (fast-forward only) and keeps local changes and unpushed commits.';
  const NOT_PLACED =
    '- **not placed**: outside this directory; open the absolute path, or fetch the URI only when the task needs it.';
  const EDITABLE =
    '- **editable** repositories may be changed for this task; **read-only** ones are reference material: read them, do not change them.';
  const OWNERS =
    '- Knowledge, work items and skills from ctxman are your own notes; `owner` says whether a repository or remote skill is yours.';
  const FETCHED = (words: string): string =>
    `- ${words} skill: fetched from its URI and copied in without history; replaced by the next inflate.`;

  const legend = async (
    items: string[],
    overrides: Record<string, unknown>[] = [],
    opts: { fail?: Record<string, string> } = {},
  ): Promise<string[]> => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(items, overrides), opts);
    const text = section(result.markdown, 'Placement');
    return text === '' ? [] : text.split('\n').slice(2);
  };

  it('sits between the map and the primary repository', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman', 'reference/rr'], [], { output: { dir: WD, primary: 'reference/rr' } }),
    );
    const heads = result.markdown.split('\n').filter((l) => l.startsWith('## '));
    expect(heads.slice(0, 3)).toEqual([
      '## Working directory map',
      '## Placement',
      '## Primary repository',
    ]);
  });

  it('a symlinked bundle: only the symlink row and the ownership line', async () => {
    expect(await legend(['kb/ctxman'])).toEqual([SYMLINK, OWNERS]);
  });

  it('lists every placement that occurs, in a fixed order, and nothing else', async () => {
    const lines = await legend(
      [
        'task/write-agents-md',
        'kb/ctxman',
        'reference/rr',
        'reference/rr-plain',
        'reference/lr',
        'reference/rs-git',
        'reference/rs-tgz',
      ],
      [
        { key: 'kb/ctxman', material: 'copy' },
        { key: 'reference/rr-plain', material: 'none' },
        { key: 'reference/lr', material: 'copy' },
      ],
    );
    expect(lines).toEqual([
      SYMLINK,
      COPY,
      CLONE,
      FETCHED('**downloaded** / **cloned**'),
      NOT_PLACED,
      EDITABLE,
      OWNERS,
    ]);
  });

  it('absent rows: no copy, no clone, no not-placed when nothing like it is placed', async () => {
    const lines = await legend(['task/write-agents-md']);
    expect(lines).not.toContain(COPY);
    expect(lines).not.toContain(CLONE);
    expect(lines).not.toContain(NOT_PLACED);
    expect(lines).not.toContain(EDITABLE);
  });

  it('names only the way the remote skills were fetched', async () => {
    expect(await legend(['reference/rs-tgz'])).toEqual([FETCHED('**downloaded**')]);
    expect(await legend(['reference/rs-git'])).toEqual([FETCHED('**cloned**')]);
  });

  it('the editable line follows the repositories (placed or not); the ownership line follows ctxman items', async () => {
    expect(await legend(['reference/rr'])).toEqual([CLONE, EDITABLE]);
    expect(await legend(['reference/rr'], [{ key: 'reference/rr', material: 'none' }])).toEqual([
      NOT_PLACED,
      EDITABLE,
    ]);
    expect(await legend(['skill/foo'])).toEqual([SYMLINK, OWNERS]);
  });

  it('a failed step makes the item "not placed"', async () => {
    const lines = await legend(['kb/ctxman'], [], { fail: { 'kb/ctxman': 'symlink failed' } });
    expect(lines).toEqual([NOT_PLACED, OWNERS]);
  });

  it('is omitted when nothing was included (only markdown blocks)', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir([], [], { markdown: [{ id: 'b1', body: '## Notes\n\nx\n' }] }),
    );
    expect(result.markdown).not.toContain('## Placement');
    expect(result.markdown).toContain('## Working directory map');
  });
});

describe('renderPlan with output: primary repository', () => {
  it('full history, branch and no subpath: no "Start in" line; editable by default', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/rr-plain'],
        [
          {
            key: 'reference/rr-plain',
            material: 'clone',
            materialOptions: { cloneDepth: 0, branch: 'v2' },
          },
        ],
        { output: { dir: WD, primary: 'reference/rr-plain' } },
      ),
    );
    expect(section(result.markdown, 'Primary repository')).toBe(
      [
        '## Primary repository',
        '',
        '**rr-plain** · [`repos/rr-plain/`](repos/rr-plain/) · `reference/rr-plain` · owner: not me · editable',
        '',
        'Desc rr-plain.',
        '',
        '- Source: git clone of `https://github.com/o/plain.git`, full history, branch `v2`',
        '',
        'Work in [`repos/rr-plain/`](repos/rr-plain/) unless the task says otherwise.',
      ].join('\n'),
    );
    expect(result.markdown).not.toContain('## Repositories');
  });

  it('read-only (edit: false): says so and closes with the read-only line', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/rr'], [{ key: 'reference/rr', edit: false }], {
        output: { dir: WD, primary: 'reference/rr' },
      }),
    );
    expect(section(result.markdown, 'Primary repository')).toBe(
      [
        '## Primary repository',
        '',
        '**rr** · [`repos/rr/`](repos/rr/) · `reference/rr` · owner: me · read-only',
        '',
        'Desc rr.',
        '',
        '- Source: git clone of `git@github.com:o/r.git`, shallow (depth 1)',
        '- Start in: [`repos/rr/docs/`](repos/rr/docs/)',
        '',
        'Read it to answer the task; it is read-only.',
      ].join('\n'),
    );
    expect(result.markdown).not.toContain('unless the task says otherwise');
    // the facts line and the map agree
    expect(section(result.markdown, 'rr')).toContain('git clone · primary · read-only');
    expect(section(result.markdown, 'Working directory map')).not.toContain('editable');
  });

  it('a symlinked local repository: source is the symlink target, start in the subpath', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lr'], [], { output: { dir: WD, primary: 'reference/lr' } }),
    );
    const primary = section(result.markdown, 'Primary repository');
    expect(primary).toContain(
      `- Source: symlink to \`${w.repo}\`\n- Start in: [\`repos/lr/src/\`](repos/lr/src/)\n`,
    );
    expect(primary).toContain(
      '**lr** · [`repos/lr/`](repos/lr/) · `reference/lr` · owner: me · editable',
    );
    expect(primary).toContain('Work in [`repos/lr/`](repos/lr/) unless the task says otherwise.');
  });

  it('is omitted when its step failed; the repository is then listed under Repositories as read-only', async () => {
    const w = dirWorld();
    const { result, output } = await renderDir(
      w,
      flatDir(['reference/rr'], [{ key: 'reference/rr', material: 'clone' }], {
        output: { dir: WD, primary: 'reference/rr' },
      }),
      { fail: { 'reference/rr': 'git clone failed' } },
    );
    expect(output.primary).toBe('reference/rr');
    expect(result.markdown).not.toContain('## Primary repository');
    expect(section(result.markdown, 'Repositories')).toContain(
      '- **rr** · not placed (git clone failed): `git@github.com:o/r.git` · relevant path `docs` · owner: me · read-only — Desc rr.',
    );
    expect(result.markdown).toContain('Not placed in this directory: git clone failed.');
  });

  it('no primary section without a primary; the repository is a normal list entry', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/rr'], [{ key: 'reference/rr', material: 'clone' }]),
    );
    expect(result.markdown).not.toContain('## Primary repository');
    expect(section(result.markdown, 'Repositories')).toContain(
      '- **rr** · [`repos/rr/`](repos/rr/) · git clone of `git@github.com:o/r.git` · relevant path [`repos/rr/docs/`](repos/rr/docs/) · owner: me · read-only — Desc rr.',
    );
    expect(section(result.markdown, 'rr')).toContain('git clone · read-only');
    expect(section(result.markdown, 'rr')).not.toContain('primary');
  });
});

describe('renderPlan with output: repositories', () => {
  it('placement phrase, relevant path, owner and editable|read-only per bullet; not placed ones link the absolute path', async () => {
    const copied = tmp.make({ 'README.md': '' });
    const w = dirWorld({
      'reference/lr-copy.yaml': referenceYaml(
        'lr-copy',
        `type: local-repo\npath: ${copied}\nowner: me\n`,
      ),
    });
    const missing = path.join(w.repo, 'missing');
    const { result } = await renderDir(
      w,
      flatDir(
        [
          'reference/rr',
          'reference/rr-plain',
          'reference/lr',
          'reference/lr-copy',
          'reference/lr-gone',
        ],
        [
          { key: 'reference/rr', material: 'clone' },
          { key: 'reference/rr-plain', material: 'none' },
          { key: 'reference/lr', material: 'symlink', edit: true },
          { key: 'reference/lr-copy', material: 'copy' },
          { key: 'reference/lr-gone', material: 'symlink' },
        ],
      ),
    );
    expect(section(result.markdown, 'Repositories')).toBe(
      [
        '## Repositories',
        '',
        '- **rr** · [`repos/rr/`](repos/rr/) · git clone of `git@github.com:o/r.git` · relevant path [`repos/rr/docs/`](repos/rr/docs/) · owner: me · read-only — Desc rr.',
        '- **rr-plain** · not cloned: `https://github.com/o/plain.git` · owner: not me · read-only — Desc rr-plain.',
        `- **lr** · [\`repos/lr/\`](repos/lr/) · symlink to \`${w.repo}\` · relevant path [\`repos/lr/src/\`](repos/lr/src/) · owner: me · editable — Desc lr.`,
        `- **lr-copy** · [\`repos/lr-copy/\`](repos/lr-copy/) · copy of \`${copied}\` · owner: me · read-only — Desc lr-copy.`,
        `- **lr-gone** · not placed: [\`${missing}/\`](${missing}/) · owner: me · read-only — Desc lr-gone.`,
      ].join('\n'),
    );
  });

  it('a not placed local repository can still be editable (edit override); a path with spaces uses the <…> destination', async () => {
    const spaced = tmp.make({ 'my repo/README.md': '' });
    const repoDir = path.join(spaced, 'my repo');
    const w = dirWorld({
      'reference/lr-space.yaml': referenceYaml(
        'lr-space',
        `type: local-repo\npath: ${repoDir}\nowner: not-me\n`,
      ),
    });
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/lr-space'],
        [{ key: 'reference/lr-space', material: 'none', edit: true }],
      ),
    );
    expect(section(result.markdown, 'Repositories')).toBe(
      [
        '## Repositories',
        '',
        `- **lr-space** · not placed: [\`${repoDir}/\`](<${repoDir}/>) · owner: not me · editable — Desc lr-space.`,
      ].join('\n'),
    );
    expect(section(result.markdown, 'lr-space')).toContain(
      `\`reference/lr-space\` · Local repo · not placed: [\`${repoDir}/\`](<${repoDir}/>) · editable`,
    );
  });

  it('is omitted without repositories', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['kb/ctxman']));
    expect(result.markdown).not.toContain('## Repositories');
    expect(result.markdown).not.toContain('## Skills');
    expect(result.markdown).not.toContain('## Primary repository');
  });
});

describe('renderPlan with output: local folders', () => {
  it('a folders/ group in the map, after repos/', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lf', 'reference/lr'], [{ key: 'reference/lf', edit: true }]),
    );
    expect(section(result.markdown, 'Working directory map')).toBe(
      [
        '## Working directory map',
        '',
        '```text',
        'LLM_CONTEXT.md  this file',
        'CLAUDE.md       loads this file',
        '.gitignore      ignores the machine-specific paths below',
        'repos/',
        '  lr/           symlink · Desc lr.',
        'folders/',
        '  lf/           symlink · editable · Desc lf.',
        '```',
      ].join('\n'),
    );
  });

  it('## Folders lists every local folder, placed or not; ## Repositories stays repositories only', async () => {
    const w = dirWorld();
    const placed = await renderDir(w, flatDir(['reference/lf', 'reference/lr']));
    expect(section(placed.result.markdown, 'Folders')).toBe(
      [
        '## Folders',
        '',
        `- **lf** · [\`folders/lf/\`](folders/lf/) · symlink to \`${w.folder}\` · relevant path [\`folders/lf/drafts/\`](folders/lf/drafts/) · owner: not me · read-only — Desc lf.`,
      ].join('\n'),
    );
    expect(section(placed.result.markdown, 'Repositories')).not.toContain('**lf**');
    const unplaced = await renderDir(
      w,
      flatDir(['reference/lf'], [{ key: 'reference/lf', material: 'none', edit: true }]),
    );
    expect(section(unplaced.result.markdown, 'Folders')).toBe(
      [
        '## Folders',
        '',
        `- **lf** · not placed: [\`${w.folder}/\`](${w.folder}/) · relevant path \`drafts\` · owner: not me · editable — Desc lf.`,
      ].join('\n'),
    );
    expect(unplaced.result.markdown).not.toContain('## Repositories');
  });

  it('the item is compact: facts line with placement and editable|read-only, then "Details: see Folders."', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['reference/lf']));
    expect(section(result.markdown, 'lf')).toBe(
      [
        '## lf',
        '',
        '`reference/lf` · Local folder · [`folders/lf/`](folders/lf/) · symlink · read-only',
        '',
        'Details: see Folders.',
      ].join('\n'),
    );
  });

  it('the Placement legend names folders in the symlink and editable lines', async () => {
    const w = dirWorld();
    const lines = async (items: string[]): Promise<string[]> => {
      const { result } = await renderDir(w, flatDir(items));
      return section(result.markdown, 'Placement').split('\n').slice(2);
    };
    expect(await lines(['reference/lf'])).toEqual([
      '- **symlink**: the original folder, live; edits change the source (your ctxman entry, local repository or local folder).',
      '- **editable** folders may be changed for this task; **read-only** ones are reference material: read them, do not change them.',
    ]);
    expect(await lines(['reference/lf', 'reference/lr'])).toContain(
      '- **editable** repositories and folders may be changed for this task; **read-only** ones are reference material: read them, do not change them.',
    );
  });

  it('a local folder named as the primary is not one (primary-invalid), and the document has no primary section', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lf'], [], { output: { dir: WD, primary: 'reference/lf' } }),
    );
    expect(result.markdown).not.toContain('## Primary repository');
    expect(result.manifest.warnings).toContainEqual({
      code: 'primary-invalid',
      message: 'primary reference/lf must be a remote-repo or local-repo reference',
      key: 'reference/lf',
    });
  });
});

describe('renderPlan with output: reference info', () => {
  it('a compact item carries its info between the facts line and Details; ctxman: links are relative when placed', async () => {
    const repo = tmp.make({ 'README.md': '' });
    const w = dirWorld({
      'reference/lr-info.yaml': referenceYaml(
        'lr-info',
        `type: local-repo\npath: ${repo}\nowner: me\ninfo: |\n  ## Notes\n\n  Read [the brief](ctxman:kb/ctxman) first.\n`,
      ),
    });
    const { result } = await renderDir(w, flatDir(['reference/lr-info', 'kb/ctxman']));
    expect(section(result.markdown, 'lr-info')).toBe(
      [
        '## lr-info',
        '',
        '`reference/lr-info` · Local repo · [`repos/lr-info/`](repos/lr-info/) · symlink · read-only',
        '',
        '### Notes',
        '',
        'Read [the brief](kb/ctxman/index.md) first.',
        '',
        'Details: see Repositories.',
      ].join('\n'),
    );
    // the Repositories section keeps its one-line bullets
    expect(section(result.markdown, 'Repositories')).not.toContain('Notes');
  });
});

describe('renderPlan with output: snippet items', () => {
  it('a snippet places nothing: its markdown is in the document, links relative to placed items', async () => {
    const w = dirWorld({
      'snippet/rules.yaml':
        'name: rules\ndescription: House rules.\nmarkdown: |\n  Read [the brief](ctxman:kb/ctxman) first.\n',
    });
    const { result, plan } = await renderDir(w, flatDir(['snippet/rules', 'kb/ctxman']));
    expect(section(result.markdown, 'rules')).toBe(
      ['## rules', '', 'Read [the brief](kb/ctxman/index.md) first.'].join('\n'),
    );
    expect(plan.files.some((f) => f.path.includes('snippet'))).toBe(false);
    expect(plan.materials['snippet/rules']).toMatchObject({ material: 'none' });
    expect(plan.steps.some((s) => s.id.includes('snippet'))).toBe(false);
    expect(result.markdown).not.toContain('snippet/rules/');
    // the snippet is not "not placed": the legend only explains the symlinked kb
    expect(section(result.markdown, 'Placement')).not.toContain('not placed');
  });
});

describe('renderPlan with output: skills', () => {
  it('placed skills: symlink to / copy of the ctxman skill, cloned / downloaded from the URI, with owner', async () => {
    const w = dirWorld({
      'reference/rs-zip.yaml': referenceYaml(
        'rs-zip',
        'type: remote-skill\nuri: https://h.test/skill.zip\nowner: not-me\n',
      ),
    });
    const { result } = await renderDir(
      w,
      flatDir(
        [
          'skill/foo',
          'skill/okf-authoring',
          'reference/rs-git',
          'reference/rs-tgz',
          'reference/rs-zip',
        ],
        [{ key: 'skill/okf-authoring', material: 'copy' }],
      ),
    );
    expect(section(result.markdown, 'Skills')).toBe(
      [
        '## Skills',
        '',
        'Installed in `.claude/skills/`, where Claude Code discovers them.',
        '',
        '- [`.claude/skills/foo/`](.claude/skills/foo/) · **foo** · symlink to the ctxman skill · owner: me — A local skill.',
        '- [`.claude/skills/okf-authoring/`](.claude/skills/okf-authoring/) · **okf-authoring** · copy of the ctxman skill · owner: me — Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).',
        '- [`.claude/skills/bar/`](.claude/skills/bar/) · **rs-git** · cloned from `https://github.com/o/skills.git` (`skills/bar`) · owner: me — Desc rs-git.',
        '- [`.claude/skills/rs-tgz/`](.claude/skills/rs-tgz/) · **rs-tgz** · downloaded from `https://h.test/skill.tar.gz` · owner: me — Desc rs-tgz.',
        '- [`.claude/skills/rs-zip/`](.claude/skills/rs-zip/) · **rs-zip** · downloaded from `https://h.test/skill.zip` · owner: not me — Desc rs-zip.',
      ].join('\n'),
    );
  });

  it('placed skills first, then "Not installed:" for mention-only and failed ones', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['skill/foo', 'skill/okf-authoring', 'reference/rs-git', 'reference/rs-tgz'],
        [
          { key: 'skill/okf-authoring', material: 'none' },
          { key: 'reference/rs-tgz', material: 'none' },
        ],
      ),
      { fail: { 'skill/foo': 'symlink failed' } },
    );
    const skill = (name: string): string => path.join(w.D, 'skill', name, 'SKILL.md');
    expect(section(result.markdown, 'Skills')).toBe(
      [
        '## Skills',
        '',
        'Installed in `.claude/skills/`, where Claude Code discovers them.',
        '',
        '- [`.claude/skills/bar/`](.claude/skills/bar/) · **rs-git** · cloned from `https://github.com/o/skills.git` (`skills/bar`) · owner: me — Desc rs-git.',
        '',
        'Not installed:',
        '',
        `- **foo** · not installed (symlink failed): [\`${skill('foo')}\`](${skill('foo')}) · owner: me — A local skill.`,
        `- **okf-authoring** · [\`${skill('okf-authoring')}\`](${skill('okf-authoring')}) · owner: me — Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).`,
        '- **rs-tgz** · `https://h.test/skill.tar.gz` · owner: me — Desc rs-tgz.',
      ].join('\n'),
    );
  });

  it('has only the intro and bullets when every skill is placed', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['skill/foo']));
    const skills = section(result.markdown, 'Skills');
    expect(skills).toContain('Installed in `.claude/skills/`');
    expect(skills).not.toContain('Not installed');
  });
});

describe('renderPlan with output: okf items', () => {
  const many = (): Record<string, string> => {
    const files: Record<string, string> = {
      'kb/big/index.md':
        '---\nokf_version: "0.2"\ntype: Knowledge Base\nname: big\ndescription: Lots of files.\n---\n\n# big\n',
    };
    for (let i = 1; i <= 25; i++) {
      const n = String(i).padStart(2, '0');
      files[`kb/big/concepts/c${n}.md`] =
        `---\ntype: Concept\ndescription: C ${n}.\n---\n\n# C ${n}\n`;
    }
    return files;
  };

  it('summary (placed default): facts line, description, then the Files list; nothing inlined', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['kb/ctxman']));
    expect(section(result.markdown, 'ctxman')).toBe(
      [
        '## ctxman',
        '',
        '`kb/ctxman` · Knowledge Base · tags: ctxman, architecture, docs · [`kb/ctxman/index.md`](kb/ctxman/index.md) · symlink',
        '',
        'What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks.',
        '',
        'Files: [`kb/ctxman/concepts/datasets.md`](kb/ctxman/concepts/datasets.md)',
      ].join('\n'),
    );
    expect(result.markdown).not.toContain('Back to');
    expect(result.markdown).not.toContain('See [datasets]');
  });

  it('summary lists at most 20 files, then "and N more in <folder link>"', async () => {
    const w = dirWorld(many());
    const { result } = await renderDir(w, flatDir(['kb/big']));
    const files = section(result.markdown, 'big')
      .split('\n')
      .find((l) => l.startsWith('Files: '));
    const shown = Array.from({ length: 20 }, (_, i) => {
      const p = `kb/big/concepts/c${String(i + 1).padStart(2, '0')}.md`;
      return `[\`${p}\`](${p})`;
    });
    expect(files).toBe(`Files: ${shown.join(', ')}, and 5 more in [\`kb/big/\`](kb/big/)`);
  });

  it('summary with exactly 20 files lists all of them and no "more"', async () => {
    const files = many();
    for (let i = 21; i <= 25; i++) delete files[`kb/big/concepts/c${i}.md`];
    const w = dirWorld(files);
    const { result } = await renderDir(w, flatDir(['kb/big']));
    const line = section(result.markdown, 'big')
      .split('\n')
      .find((l) => l.startsWith('Files: '));
    expect(line?.match(/\]\(/g)).toHaveLength(20);
    expect(line).not.toContain('more in');
  });

  it('summary follows the index order of the entry before the tree order', async () => {
    const w = dirWorld({
      'kb/ordered/index.md':
        '---\nokf_version: "0.2"\ntype: Knowledge Base\nname: ordered\ndescription: Ordered.\n---\n\n# ordered\n\n## Concepts\n\n- [Zed](/concepts/zed.md)\n- [Alpha](/concepts/alpha.md)\n',
      'kb/ordered/concepts/alpha.md': '---\ntype: Concept\n---\n\n# Alpha\n',
      'kb/ordered/concepts/zed.md': '---\ntype: Concept\n---\n\n# Zed\n',
      'kb/ordered/concepts/mid.md': '---\ntype: Concept\n---\n\n# Mid\n',
    });
    const { result } = await renderDir(w, flatDir(['kb/ordered']));
    expect(section(result.markdown, 'ordered')).toContain(
      'Files: [`kb/ordered/concepts/zed.md`](kb/ordered/concepts/zed.md), [`kb/ordered/concepts/alpha.md`](kb/ordered/concepts/alpha.md), [`kb/ordered/concepts/mid.md`](kb/ordered/concepts/mid.md)',
    );
  });

  it('summary of a bundle without concept files has no Files line', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['kb/astro-content-layer']));
    expect(section(result.markdown, 'astro-content-layer')).toBe(
      [
        '## astro-content-layer',
        '',
        '`kb/astro-content-layer` · Knowledge Base · [`kb/astro-content-layer/index.md`](kb/astro-content-layer/index.md) · symlink',
        '',
        'How Astro 7 content collections, loaders and schemas work.',
      ].join('\n'),
    );
  });

  it('a copied bundle says copy; the context notes sit between the facts line and the description', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      recipe({
        layout: 'flat',
        output: { dir: WD },
        contexts: ['ctxman-dev'],
        overrides: [{ key: 'task/write-agents-md', material: 'copy' }],
      }),
      { contextFile: 'LLM_CONTEXT.md' },
    );
    expect(result.markdown).toContain(
      '`task/write-agents-md` · Task · state: Pending · [`task/write-agents-md/index.md`](task/write-agents-md/index.md) · copy',
    );
    expect(section(result.markdown, 'ctxman')).toContain(
      '· symlink\n\n> **From context `ctxman-dev`:** Start here.\n\nWhat ctxman is',
    );
  });

  it('summary that is not placed (material none) is today\'s summary with "not placed" and an absolute link', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['idea/context-inflate'],
        [{ key: 'idea/context-inflate', material: 'none', mode: 'summary' }],
      ),
    );
    const abs = path.join(w.D, 'idea', 'context-inflate', 'index.md');
    expect(section(result.markdown, 'context-inflate')).toBe(
      [
        '## context-inflate',
        '',
        `\`idea/context-inflate\` · Idea · state: Pending · not placed: [\`${abs}\`](${abs})`,
        '',
        'A tool that turns selected contexts plus user instructions into one document.',
      ].join('\n'),
    );
  });

  it('pointer links the entry file; the eager clause keeps the bare @path; not placed points at the absolute path', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['kb/ctxman', 'kb/astro-content-layer', 'task/write-agents-md', 'idea/context-inflate'],
        [
          { key: 'kb/ctxman', mode: 'pointer', options: { eager: true } },
          { key: 'kb/astro-content-layer', mode: 'pointer' },
          { key: 'task/write-agents-md', mode: 'summary' },
          { key: 'idea/context-inflate', mode: 'pointer', material: 'none' },
        ],
      ),
    );
    const md = result.markdown;
    expect(md).toContain(
      '`kb/ctxman` · Knowledge Base · What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks. Read it before starting: @kb/ctxman/index.md',
    );
    expect(md).toContain(
      '`kb/astro-content-layer` · Knowledge Base · How Astro 7 content collections, loaders and schemas work. Read [`kb/astro-content-layer/index.md`](kb/astro-content-layer/index.md) if relevant.',
    );
    expect(md).toContain(
      '`task/write-agents-md` · Task · state: Pending · [`task/write-agents-md/index.md`](task/write-agents-md/index.md) · symlink',
    );
    const abs = path.join(w.D, 'idea', 'context-inflate', 'index.md');
    expect(md).toContain(
      `\`idea/context-inflate\` · Idea · A tool that turns selected contexts plus user instructions into one document. Read [\`${abs}\`](${abs}) if relevant.`,
    );
  });

  it('inline-bundle: concept paths, the "Other files" list and ctxman: links become relative links', async () => {
    const w = dirWorld({ 'kb/ctxman/assets/data.csv': 'a,b\n' });
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman', 'idea/context-inflate'], [{ key: 'kb/ctxman', mode: 'inline-bundle' }]),
    );
    expect(result.markdown).toContain(
      'See [datasets](kb/ctxman/concepts/datasets.md), the [idea](idea/context-inflate/index.md) and the [docs]',
    );
    expect(result.markdown).toContain(
      '`concepts/datasets.md` · [`kb/ctxman/concepts/datasets.md`](kb/ctxman/concepts/datasets.md)',
    );
    expect(result.markdown).toContain('Back to [entry](kb/ctxman/index.md).');
    expect(result.markdown).toContain(
      'Other files in this bundle:\n\n- `assets/data.csv` — [`kb/ctxman/assets/data.csv`](kb/ctxman/assets/data.csv)',
    );
  });

  it('inline-main lists the other concepts as links under the bundle folder link', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman'], [{ key: 'kb/ctxman', mode: 'inline-main' }]),
    );
    expect(result.markdown).toContain(
      'More in this bundle (under [`kb/ctxman/`](kb/ctxman/)): [`kb/ctxman/concepts/datasets.md`](kb/ctxman/concepts/datasets.md).',
    );
  });

  it('a failed item renders as not placed: absolute links and the reason at the end', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman'], [{ key: 'kb/ctxman', mode: 'inline-main' }]),
      { fail: { 'kb/ctxman': 'source /x does not exist' } },
    );
    const md = result.markdown;
    const index = path.join(w.D, 'kb', 'ctxman', 'index.md');
    const root = path.join(w.D, 'kb', 'ctxman');
    expect(md).toContain(`not placed: [\`${index}\`](${index})`);
    expect(md).toContain('Not placed in this directory: source /x does not exist.');
    expect(md).toContain(`(under [\`${root}/\`](${root}/))`);
    expect(section(result.markdown, 'Working directory map')).not.toContain('ctxman/');
  });

  it('unresolved links are reported in a working-directory render too (the description is printed first)', async () => {
    const w = dirWorld();
    mkdirSync(path.join(w.D, 'kb/broken'), { recursive: true });
    writeFileSync(
      path.join(w.D, 'kb/broken/index.md'),
      '---\ntype: Knowledge Base\nname: broken\ndescription: Has a dead link.\n---\n\n# Broken\n\nSee [gone](ctxman:kb/gone) and [ctxman](ctxman:kb/ctxman).\n',
    );
    const { result } = await renderDir(
      w,
      flatDir(['kb/broken'], [{ key: 'kb/broken', mode: 'inline-main' }]),
    );
    expect(section(result.markdown, 'broken')).toContain(
      'Has a dead link.\n\nSee [gone](ctxman:kb/gone) and [ctxman](',
    );
    expect(result.manifest.warnings).toEqual([
      {
        code: 'unresolved-link',
        key: 'kb/broken',
        message: 'kb/broken/index.md: link "ctxman:kb/gone" does not resolve (no such entry)',
      },
    ]);
  });

  it('the summary default adds no unresolved-link warnings (nothing is rewritten or inlined)', async () => {
    const w = dirWorld();
    mkdirSync(path.join(w.D, 'kb/broken'), { recursive: true });
    writeFileSync(
      path.join(w.D, 'kb/broken/index.md'),
      '---\ntype: Knowledge Base\nname: broken\ndescription: Has a dead link.\n---\n\nSee [gone](ctxman:kb/gone).\n',
    );
    const { result } = await renderDir(w, flatDir(['kb/broken']));
    expect(result.manifest.warnings).toEqual([]);
  });
});

describe('renderPlan with output: skill items', () => {
  it('pointer (placed default): the facts line links SKILL.md, then the description; no "Read" sentence', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['skill/okf-authoring']));
    expect(section(result.markdown, 'okf-authoring')).toBe(
      [
        '## okf-authoring',
        '',
        '`skill/okf-authoring` · Skill · [`.claude/skills/okf-authoring/SKILL.md`](.claude/skills/okf-authoring/SKILL.md) · symlink',
        '',
        'Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).',
      ].join('\n'),
    );
  });

  it('pointer with eager keeps the one line and the bare @path', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/okf-authoring'], [{ key: 'skill/okf-authoring', options: { eager: true } }]),
    );
    expect(section(result.markdown, 'okf-authoring')).toContain(
      '`skill/okf-authoring` · Skill · Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project). Read it before starting: @.claude/skills/okf-authoring/SKILL.md',
    );
  });

  it('inline: the body and a Files list of links under the installed folder', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/foo'], [{ key: 'skill/foo', mode: 'inline' }]),
    );
    const md = result.markdown;
    expect(md).toContain(
      '`skill/foo` · Skill · [`.claude/skills/foo/SKILL.md`](.claude/skills/foo/SKILL.md) · symlink',
    );
    expect(md).toContain('See [steps](.claude/skills/foo/references/steps.md).');
    expect(md).toContain(
      'Files in this skill (under [`.claude/skills/foo/`](.claude/skills/foo/)):',
    );
    expect(md).toContain(
      '- `references/steps.md` — [`.claude/skills/foo/references/steps.md`](.claude/skills/foo/references/steps.md)',
    );
  });

  it('a stored install mode falls back to the link while the skill is placed (no commands)', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/ctxman-add-entry'], [{ key: 'skill/ctxman-add-entry', mode: 'install' }]),
    );
    expect(section(result.markdown, 'ctxman-add-entry')).toContain(
      '`skill/ctxman-add-entry` · Skill · [`.claude/skills/ctxman-add-entry/SKILL.md`](.claude/skills/ctxman-add-entry/SKILL.md) · symlink',
    );
    expect(result.markdown).not.toContain('cp -R');
  });

  it('material none, mode pointer: one line with an absolute link', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/foo'], [{ key: 'skill/foo', material: 'none', mode: 'pointer' }]),
    );
    const abs = path.join(w.D, 'skill', 'foo', 'SKILL.md');
    expect(section(result.markdown, 'foo')).toBe(
      `## foo\n\n\`skill/foo\` · Skill · A local skill. Read [\`${abs}\`](${abs}) and follow it when the task matches.`,
    );
  });

  it('material none keeps the v1 install block, run from "this directory"', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/foo'], [{ key: 'skill/foo', material: 'none', mode: 'install' }]),
    );
    const abs = path.join(w.D, 'skill', 'foo', 'SKILL.md');
    expect(section(result.markdown, 'foo')).toBe(
      [
        '## foo',
        '',
        `\`skill/foo\` · Skill · not placed: [\`${abs}\`](${abs})`,
        '',
        'A local skill.',
        '',
        'Install this skill into the project (run from this directory):',
        '',
        '```sh',
        'mkdir -p .claude/skills',
        `cp -R ${path.join(w.D, 'skill', 'foo')} .claude/skills/foo`,
        '```',
      ].join('\n'),
    );
    expect(result.markdown).not.toContain('the project root');
  });
});

describe('renderPlan with output: repository items (compact)', () => {
  it('local repository: facts line with placement and editable|read-only, then Details; no description', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['reference/lr']));
    expect(section(result.markdown, 'lr')).toBe(
      [
        '## lr',
        '',
        '`reference/lr` · Local repo · [`repos/lr/`](repos/lr/) · symlink · read-only',
        '',
        'Details: see Repositories.',
      ].join('\n'),
    );
  });

  it('the primary points to its own section and carries the primary marker', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lr', 'reference/rr'], [], {
        output: { dir: WD, primary: 'reference/rr' },
      }),
    );
    expect(section(result.markdown, 'rr')).toBe(
      [
        '## rr',
        '',
        '`reference/rr` · Remote repo · [`repos/rr/`](repos/rr/) · git clone · primary · editable',
        '',
        'Details: see Primary repository.',
      ].join('\n'),
    );
  });

  it('local repository, tree: the tree stays here, titled with the folder link', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lr'], [{ key: 'reference/lr', mode: 'tree', edit: true }]),
    );
    expect(section(result.markdown, 'lr')).toBe(
      [
        '## lr',
        '',
        '`reference/lr` · Local repo · [`repos/lr/`](repos/lr/) · symlink · editable',
        '',
        'Details: see Repositories.',
        '',
        'Top-level entries of [`repos/lr/src/`](repos/lr/src/) (2 of 2):',
        '',
        '```text',
        'index.ts',
        'util.ts',
        '```',
      ].join('\n'),
    );
  });

  it('local repository that is not placed: absolute link, still compact; tree is printed with an absolute title; a missing path is said', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/lr', 'reference/lr-gone'],
        [
          { key: 'reference/lr', material: 'none', mode: 'tree' },
          { key: 'reference/lr-gone', material: 'none' },
        ],
      ),
    );
    const root = w.repo;
    const src = path.join(w.repo, 'src');
    expect(section(result.markdown, 'lr')).toBe(
      [
        '## lr',
        '',
        `\`reference/lr\` · Local repo · not placed: [\`${root}/\`](${root}/) · read-only`,
        '',
        'Details: see Repositories.',
        '',
        `Top-level entries of [\`${src}/\`](${src}/) (2 of 2):`,
        '',
        '```text',
        'index.ts',
        'util.ts',
        '```',
      ].join('\n'),
    );
    const missing = path.join(w.repo, 'missing');
    expect(section(result.markdown, 'lr-gone')).toContain(
      `The path \`${missing}\` does not exist on this machine.`,
    );
  });

  it('remote repository, placed: compact', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['reference/rr']));
    expect(section(result.markdown, 'rr')).toBe(
      [
        '## rr',
        '',
        '`reference/rr` · Remote repo · [`repos/rr/`](repos/rr/) · git clone · read-only',
        '',
        'Details: see Repositories.',
      ].join('\n'),
    );
  });

  it('remote repository, not placed: the URI, read-only, no commands in describe mode', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/rr-plain'], [{ key: 'reference/rr-plain', material: 'none' }]),
    );
    expect(section(result.markdown, 'rr-plain')).toBe(
      [
        '## rr-plain',
        '',
        '`reference/rr-plain` · Remote repo · not placed: `https://github.com/o/plain.git` · read-only',
        '',
        'Details: see Repositories.',
      ].join('\n'),
    );
  });

  it('remote repository, not placed, mode clone: the commands still print, run from this directory', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/rr'],
        [{ key: 'reference/rr', mode: 'clone', material: 'none', options: { sparse: true } }],
      ),
    );
    expect(section(result.markdown, 'rr')).toBe(
      [
        '## rr',
        '',
        '`reference/rr` · Remote repo · not placed: `git@github.com:o/r.git` · read-only',
        '',
        'Details: see Repositories.',
        '',
        'Clone it into the project (run from this directory; keep `.ctxman/` out of version control):',
        '',
        '```sh',
        'git clone --depth 1 --filter=blob:none --sparse git@github.com:o/r.git .ctxman/refs/rr',
        'git -C .ctxman/refs/rr sparse-checkout set docs',
        '```',
        '',
        'Then read `.ctxman/refs/rr/docs`.',
      ].join('\n'),
    );
  });

  it('a failed clone is read-only and says why at the end', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['reference/rr']), {
      fail: { 'reference/rr': 'git clone failed' },
    });
    expect(section(result.markdown, 'rr')).toBe(
      [
        '## rr',
        '',
        '`reference/rr` · Remote repo · not placed: `git@github.com:o/r.git` · read-only',
        '',
        'Details: see Repositories.',
        '',
        'Not placed in this directory: git clone failed.',
      ].join('\n'),
    );
  });

  it('keeps the context notes between the facts line and the details', async () => {
    const w = dirWorld({
      'context/repos.yaml':
        'name: repos\ndescription: Repos.\nlinks:\n  - dataset: reference\n    slug: lr\n    notes: |\n      Look at src first.\n',
    });
    const { result } = await renderDir(
      w,
      recipe({ layout: 'flat', contexts: ['repos'], output: { dir: WD } }),
    );
    expect(section(result.markdown, 'lr')).toBe(
      [
        '## lr',
        '',
        '`reference/lr` · Local repo · [`repos/lr/`](repos/lr/) · symlink · read-only',
        '',
        '> **From context `repos`:** Look at src first.',
        '',
        'Details: see Repositories.',
      ].join('\n'),
    );
  });
});

describe('renderPlan with output: remote skill items (compact)', () => {
  it('placed: the folder link and how it was fetched; Details point to Skills', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['reference/rs-git', 'reference/rs-tgz']));
    expect(section(result.markdown, 'rs-git')).toBe(
      [
        '## rs-git',
        '',
        '`reference/rs-git` · Remote skill · [`.claude/skills/bar/`](.claude/skills/bar/) · cloned',
        '',
        'Details: see Skills.',
      ].join('\n'),
    );
    expect(section(result.markdown, 'rs-tgz')).toContain(
      '`reference/rs-tgz` · Remote skill · [`.claude/skills/rs-tgz/`](.claude/skills/rs-tgz/) · downloaded',
    );
  });

  it('not placed, mode install: the commands still print, run from this directory', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/rs-tgz'], [{ key: 'reference/rs-tgz', material: 'none' }]),
    );
    const md = section(result.markdown, 'rs-tgz');
    expect(md).toContain(
      '`reference/rs-tgz` · Remote skill · not placed: `https://h.test/skill.tar.gz`\n\nDetails: see Skills.\n\nInstall this skill into `.claude/skills/rs-tgz/` (run from this directory):',
    );
    expect(md).toContain('curl -fsSL https://h.test/skill.tar.gz -o .ctxman/tmp/rs-tgz.tgz');
    expect(md).toContain('The skill folder is the one that contains SKILL.md');
  });

  it('not placed, mode describe: no commands', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/rs-git'],
        [{ key: 'reference/rs-git', material: 'none', mode: 'describe' }],
      ),
    );
    expect(section(result.markdown, 'rs-git')).toBe(
      [
        '## rs-git',
        '',
        '`reference/rs-git` · Remote skill · not placed: `https://github.com/o/skills.git`',
        '',
        'Details: see Skills.',
      ].join('\n'),
    );
  });
});

describe('renderPlan with output: items the planner demoted', () => {
  it('a destination collision leaves the second item not placed, whatever mode the expansion gave it', async () => {
    // skills/foo installs as .claude/skills/foo, the destination of the local skill foo (first wins)
    const w = dirWorld({
      'reference/rs-foo.yaml': referenceYaml(
        'rs-foo',
        'type: remote-skill\nuri: https://github.com/o/skills.git\nsubpath: skills/foo\nowner: not-me\n',
      ),
    });
    const { plan, result } = await renderDir(w, flatDir(['skill/foo', 'reference/rs-foo']));
    expect(plan.warnings.map((x) => x.code)).toEqual(['dest-collision']);
    expect(plan.materials['reference/rs-foo']).toMatchObject({ material: 'none', dest: null });
    expect(section(result.markdown, 'rs-foo')).toBe(
      [
        '## rs-foo',
        '',
        '`reference/rs-foo` · Remote skill · not placed: `https://github.com/o/skills.git`',
        '',
        'Details: see Skills.',
      ].join('\n'),
    );
    expect(section(result.markdown, 'Skills')).toContain(
      'Not installed:\n\n- **rs-foo** · `https://github.com/o/skills.git` (`skills/foo`) · owner: not me — Desc rs-foo.',
    );
    expect(section(result.markdown, 'Placement')).toContain('- **not placed**:');
    // the placed skill keeps its link
    expect(
      result.manifest.segments.find((x) => x.key === 'reference/rs-foo')?.dest,
    ).toBeUndefined();
    expect(result.manifest.segments.find((x) => x.key === 'skill/foo')?.dest).toBe(
      '.claude/skills/foo',
    );
  });

  it('a missing git leaves the repository not placed (and read-only), still in the Repositories list', async () => {
    const w = dirWorld();
    const { plan, content } = await prepare(w.D, flatDir(['reference/rr']));
    const mp = planMaterialization({
      plan,
      content,
      dir: WD,
      dirExists: false,
      previous: null,
      tools: { git: false, tar: true, unzip: true },
    });
    const result = renderPlan(plan, content, {
      generatedAt: GENERATED_AT,
      output: {
        dir: WD,
        contextFile: 'LLM_CONTEXT.md',
        primary: mp.primary,
        target: 'claude-code',
        materials: mp.materials,
        files: mp.files,
      },
    });
    expect(mp.warnings.map((x) => x.code)).toEqual(['tool-missing']);
    expect(section(result.markdown, 'Repositories')).toBe(
      '## Repositories\n\n- **rr** · not cloned: `git@github.com:o/r.git` · relevant path `docs` · owner: me · read-only — Desc rr.',
    );
    expect(section(result.markdown, 'rr')).toContain(
      'not placed: `git@github.com:o/r.git` · read-only',
    );
  });
});

describe('renderPlan with output: realistic working directory', () => {
  const work = (): string =>
    [
      'name: work',
      'description: Everything for the task.',
      'links:',
      '  - dataset: kb',
      '    slug: ctxman',
      '    notes: |',
      '      Start here.',
      '  - dataset: task',
      '    slug: write-agents-md',
      '  - dataset: skill',
      '    slug: foo',
      '  - dataset: reference',
      '    slug: rs-tgz',
      '  - dataset: reference',
      '    slug: rr',
      '    notes: |',
      '      The code to change.',
      '  - dataset: reference',
      '    slug: lr',
      '  - dataset: reference',
      '    slug: rr-plain',
      '',
    ].join('\n');

  it('mixes a symlinked bundle, a copied task, a symlinked skill, a downloaded skill, a cloned primary, a symlinked editable repository and a not placed repository', async () => {
    const w = dirWorld({ 'context/work.yaml': work() });
    const { result } = await renderDir(
      w,
      seedRecipe({
        name: 'work-brief',
        layout: 'grouped',
        preamble: 'Fix the agent guide.\n',
        contexts: ['work'],
        items: [],
        markdown: [],
        order: [],
        output: { dir: WD, primary: 'reference/rr' },
        overrides: [
          { key: 'task/write-agents-md', material: 'copy' },
          { key: 'reference/lr', edit: true },
          { key: 'reference/rr-plain', material: 'none' },
        ],
      }),
    );
    const md = result.markdown;
    // placement of every item, in the map
    expect(section(md, 'Working directory map')).toBe(
      [
        '## Working directory map',
        '',
        '```text',
        'LLM_CONTEXT.md      this file',
        'CLAUDE.md           loads this file',
        '.gitignore          ignores the machine-specific paths below',
        'repos/',
        '  rr/               git clone · primary · editable · Desc rr.',
        '  lr/               symlink · editable · Desc lr.',
        'kb/',
        '  ctxman/           symlink · What ctxman is, how it is built, and how to work with i…',
        'task/',
        '  write-agents-md/  copy · Write and maintain the agent guide at the repository ro…',
        '.claude/skills/',
        '  foo/              symlink · A local skill.',
        '  rs-tgz/           downloaded · Desc rs-tgz.',
        '```',
      ].join('\n'),
    );
    expect(section(md, 'Placement').split('\n').slice(2)).toHaveLength(7);
    // primary: cloned, editable, with its start path
    expect(section(md, 'Primary repository')).toContain(
      '**rr** · [`repos/rr/`](repos/rr/) · `reference/rr` · owner: me · editable',
    );
    expect(section(md, 'Primary repository')).toContain(
      'Work in [`repos/rr/`](repos/rr/) unless the task says otherwise.',
    );
    // other repositories: the editable symlink and the not placed remote
    expect(section(md, 'Repositories')).toBe(
      [
        '## Repositories',
        '',
        `- **lr** · [\`repos/lr/\`](repos/lr/) · symlink to \`${w.repo}\` · relevant path [\`repos/lr/src/\`](repos/lr/src/) · owner: me · editable — Desc lr.`,
        '- **rr-plain** · not cloned: `https://github.com/o/plain.git` · owner: not me · read-only — Desc rr-plain.',
      ].join('\n'),
    );
    // items inside their context group
    expect(md).toContain('## Context: work\n\nEverything for the task.\n\n### ctxman\n');
    expect(md).toContain(
      '`kb/ctxman` · Knowledge Base · tags: ctxman, architecture, docs · [`kb/ctxman/index.md`](kb/ctxman/index.md) · symlink\n\n> **From context `work`:** Start here.',
    );
    expect(md).toContain(
      'Files: [`kb/ctxman/concepts/datasets.md`](kb/ctxman/concepts/datasets.md)',
    );
    expect(md).toContain(
      '`task/write-agents-md` · Task · state: Pending · [`task/write-agents-md/index.md`](task/write-agents-md/index.md) · copy',
    );
    expect(md).toContain(
      '`skill/foo` · Skill · [`.claude/skills/foo/SKILL.md`](.claude/skills/foo/SKILL.md) · symlink',
    );
    expect(md).toContain(
      '`reference/rs-tgz` · Remote skill · [`.claude/skills/rs-tgz/`](.claude/skills/rs-tgz/) · downloaded\n\nDetails: see Skills.',
    );
    expect(md).toContain(
      '`reference/rr` · Remote repo · [`repos/rr/`](repos/rr/) · git clone · primary · editable\n\n> **From context `work`:** The code to change.\n\nDetails: see Primary repository.',
    );
    expect(md).toContain(
      '`reference/lr` · Local repo · [`repos/lr/`](repos/lr/) · symlink · editable\n\nDetails: see Repositories.',
    );
    expect(md).toContain(
      '`reference/rr-plain` · Remote repo · not placed: `https://github.com/o/plain.git` · read-only\n\nDetails: see Repositories.',
    );
    // nothing of the data directory leaks: every placed path is relative
    expect(md).not.toContain(w.D);
    expect(result.manifest.warnings).toEqual([]);
  });
});
