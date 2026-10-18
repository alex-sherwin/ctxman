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
      `\`kb/demo\` · Knowledge Base · tags: demo · \`${D}/kb/demo/main.md\``,
      '',
      '> **From context `ctx`:** Read this.',
      '',
      `See [one](${D}/kb/demo/concepts/one.md) and [ctxman](${D}/kb/demo/main.md).`,
      '',
      `More in this bundle (under \`${D}/kb/demo\`): \`concepts/one.md\`.`,
      '',
      '### do-it',
      '',
      `\`task/do-it\` · Task · state: In progress · \`${D}/task/do-it/main.md\``,
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
    const { D } = world({ 'kb/broken/main.md': '---\ntype: Knowledge Base\nname: broken\n---\n' });
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
        `\`kb/demo\` · Knowledge Base · tags: demo · \`${D}/kb/demo/main.md\``,
        '',
        '```yaml',
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
        `See [one](${D}/kb/demo/concepts/one.md) and [ctxman](${D}/kb/demo/main.md).`,
        '',
        `More in this bundle (under \`${D}/kb/demo\`): \`concepts/one.md\`.`,
        '',
      ].join('\n'),
    );
  });

  it('inline-main honours shiftHeadings / rewriteLinks off', async () => {
    const { D } = world({
      'kb/plain/main.md':
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
        `\`kb/demo\` · Knowledge Base · tags: demo · \`${D}/kb/demo/main.md\``,
        '',
        '```yaml',
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
        `See [one](${D}/kb/demo/concepts/one.md) and [ctxman](${D}/kb/demo/main.md).`,
        '',
        '### One',
        '',
        `\`concepts/one.md\` · \`${D}/kb/demo/concepts/one.md\``,
        '',
        `Back to [main](${D}/kb/demo/main.md#demo). A claim.[^spec] Another.[^note]`,
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
        `* **Create**: Created [Demo](${D}/kb/demo/main.md).`,
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
        '---\nokf_version: "0.2"\n---\n# Demo\n\n* [Zed](/concepts/zed.md)\n* [One](/concepts/one.md)\n* [Main](/main.md)\n* [Gone](/concepts/gone.md)\n',
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
      'task/old/main.md':
        '---\ntype: Task\nname: old\ndescription: An old task.\nstate: pending\ntags: [a, b]\nstale_after: 2020-01-01\n---\n',
    });
    const { markdown } = await render(
      D,
      recipe({ layout: 'flat', items: [{ dataset: 'task', slug: 'old' }] }),
    );
    expect(body(markdown)).toBe(
      `## old\n\n\`task/old\` · Task · state: Pending · stale since 2020-01-01 · tags: a, b · \`${D}/task/old/main.md\`\n\nAn old task.\n`,
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
    const abs = `${D}/kb/demo/main.md`;
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
      `## Demo\n\n\`kb/demo\` · Knowledge Base · A demo knowledge base entry. Read \`${D}/kb/demo/main.md\` if relevant.\n\n> **From context \`ctx\`:** Read this.\n`,
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
      `See [one](<${D}/kb/demo/concepts/one.md>) and [ctxman](<${D}/kb/demo/main.md>).`,
    );
    // inline code is not shell: the path is shown as is
    expect(markdown).toContain(`\`${D}/kb/demo/main.md\``);
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
      source: `${D}/kb/demo/main.md`,
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
      'kb/big/main.md': '---\ntype: Knowledge Base\nname: big\ndescription: Big.\n---\n\n# Big\n',
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
      'kb/demo': { title: 'Demo', abs: expect.stringMatching(/kb[\\/]demo[\\/]main\.md$/) },
    });
  });
});

// ---------------------------------------------------------------- working directory (plans/INFLATE_V2_SPEC.md §9)

const WD = '/Users/me/ctxman-inflate/ctxman-dev-brief';

interface DirWorld {
  D: string;
  repo: string;
}

/** The seed-like tree plus a local repo, a missing local repo, and one remote shape of every kind. */
function dirWorld(): DirWorld {
  const repo = tmp.make({
    'README.md': '',
    'src/index.ts': '',
    'src/util.ts': '',
    'docs/a.md': '',
  });
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
    }),
  );
  return { D, repo };
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

describe('renderPlan with output: golden document (the spec §9.6 seed example)', () => {
  const expected = (D: string): string =>
    [
      '# ctxman-dev-brief',
      '',
      '> Prepared by ctxman for a Claude Code session.',
      `> This directory is the working root (\`${WD}\`). Relative paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
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
      '  astro-docs/                     git clone, sparse · primary · The Astro documentation source, English content. Consul…',
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
      '  okf-authoring/                  copy · Author and review OKF v0.2 knowledge bundles (kb, rca,…',
      '  ctxman-add-entry/               copy · Create a new ctxman dataset entry with the add scripts.',
      '```',
      '',
      '## Primary repository',
      '',
      '**astro-docs** · `repos/astro-docs` · `reference/astro-docs` · owner: not me',
      '',
      'The Astro documentation source, English content. Consult it for content collections, loaders, routing and configuration.',
      '',
      '- Source: git clone of `https://github.com/withastro/docs.git`, shallow (depth 1), sparse checkout of `src/content/docs/en`',
      '- Start in: `repos/astro-docs/src/content/docs/en`',
      '',
      'Work in `repos/astro-docs` unless the task says otherwise.',
      '',
      '## Skills',
      '',
      'Installed in `.claude/skills/`, where Claude Code discovers them.',
      '',
      '- `.claude/skills/okf-authoring/` · **okf-authoring** · copy of `skill/okf-authoring` — Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).',
      '- `.claude/skills/ctxman-add-entry/` · **ctxman-add-entry** · copy of `skill/ctxman-add-entry` — Create a new ctxman dataset entry with the add scripts.',
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
      '`kb/ctxman` · Knowledge Base · tags: ctxman, architecture, docs · `kb/ctxman/main.md`',
      '',
      '> **From context `ctxman-dev`:** Start here.',
      '',
      `See [datasets](kb/ctxman/concepts/datasets.md), the [idea](idea/context-inflate/main.md) and the [docs](${D}/reference/astro-docs.yaml).`,
      '',
      '#### Datasets',
      '',
      '`concepts/datasets.md` · `kb/ctxman/concepts/datasets.md`',
      '',
      'Back to [main](kb/ctxman/main.md).',
      '',
      '### astro-content-layer',
      '',
      '`kb/astro-content-layer` · Knowledge Base · `kb/astro-content-layer/main.md`',
      '',
      '### astro-dev-full-reload-on-save',
      '',
      '`rca/astro-dev-full-reload-on-save` · Root Cause Analysis · `rca/astro-dev-full-reload-on-save/main.md`',
      '',
      '### context-inflate',
      '',
      '`idea/context-inflate` · Idea · state: Pending · `idea/context-inflate/main.md`',
      '',
      'A tool that turns selected contexts plus user instructions into one document.',
      '',
      '### write-agents-md',
      '',
      '`task/write-agents-md` · Task · state: Pending · `task/write-agents-md/main.md`',
      '',
      'Write and maintain the agent guide at the repository root.',
      '',
      '### context-forge',
      '',
      '`feature/context-forge` · Feature · state: In progress · `feature/context-forge/main.md`',
      '',
      'A UI at /forge to discover entries across datasets and build contexts.',
      '',
      '### ctxman-v1',
      '',
      '`project/ctxman-v1` · Project · state: In progress · `project/ctxman-v1/main.md`',
      '',
      'Deliver the first complete version of ctxman with ten datasets.',
      '',
      '### okf-authoring',
      '',
      '`skill/okf-authoring` · Skill · `.claude/skills/okf-authoring`',
      '',
      'Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).',
      '',
      'Installed at `.claude/skills/okf-authoring/`.',
      '',
      '### astro-docs',
      '',
      '`reference/astro-docs` · Remote repo · owner: not me · tags: astro, docs · `repos/astro-docs`',
      '',
      '> **From context `ctxman-dev`:** Upstream Astro docs.',
      '',
      'The Astro documentation source, English content. Consult it for content collections, loaders, routing and configuration.',
      '',
      'Cloned at `repos/astro-docs` (the primary repository).',
      '',
      'Relevant path `repos/astro-docs/src/content/docs/en`.',
      '',
      '## Additional items',
      '',
      '### ctxman-add-entry',
      '',
      '`skill/ctxman-add-entry` · Skill · `.claude/skills/ctxman-add-entry`',
      '',
      'Create a new ctxman dataset entry with the add scripts.',
      '',
      'Installed at `.claude/skills/ctxman-add-entry/`.',
      '',
    ].join('\n');

  it('matches the spec example: relative paths, map, primary, skills, then the composition', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, seedRecipe());
    expect(result.markdown).toBe(expected(w.D));
    // the only absolute path of a ctxman data file left is the unmounted ctxman: link
    expect(result.markdown.split(w.D).length - 1).toBe(1);
  });

  it('manifest: output, material and dest per item', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, seedRecipe());
    const m = result.manifest;
    expect(m.output).toEqual({
      dir: WD,
      contextFile: 'LLM_CONTEXT.md',
      primary: 'reference/astro-docs',
    });
    const seg = (key: string) => m.segments.find((s) => s.key === key);
    expect(seg('kb/ctxman')).toMatchObject({ material: 'symlink', dest: 'kb/ctxman' });
    expect(seg('skill/okf-authoring')).toMatchObject({
      material: 'copy',
      dest: '.claude/skills/okf-authoring',
    });
    expect(seg('reference/astro-docs')).toMatchObject({
      material: 'clone',
      dest: 'repos/astro-docs',
      // `source` stays the absolute entry file
      source: expect.stringMatching(/astro-docs\.yaml$/),
    });
    expect(seg('bug/stale-badge-timezone')?.material).toBeUndefined();
    expect(seg('md:b1')?.dest).toBeUndefined();
    expect(seg('ctx:ctxman-dev')?.material).toBeUndefined();
    expect(m.counts).toEqual({ included: 10, excluded: 1, missing: 0 });
  });
});

describe('renderPlan without output stays the v1 document', () => {
  it('has absolute paths, the v1 header and neither sections nor manifest output', async () => {
    const w = dirWorld();
    const r = seedRecipe();
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
    expect(md).not.toContain('## Primary repository');
    expect(md).not.toContain('## Skills');
    expect(md).not.toContain('this directory');
    expect(md).toContain(`${w.D}${path.sep}kb${path.sep}ctxman${path.sep}main.md`);
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

  it('is the same function of (plan, content) as before: with and without output differ only by the directory features', async () => {
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
      `> This directory is the working root (\`${WD}\`). Relative paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
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
      `> This directory is the working root (\`${WD}\`). Relative paths below are relative to it; absolute paths point outside it. Read the referenced files and run the listed commands only when the task needs them.`,
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
  it('groups repos, okf datasets in registry order and the skills dir; local, remote and installed notes', async () => {
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
        ],
        [
          { key: 'reference/lr', material: 'symlink' },
          {
            key: 'reference/rr',
            material: 'clone',
            materialOptions: { branch: 'main', subpathOnly: true },
          },
          { key: 'kb/ctxman', material: 'copy' },
        ],
        { output: { dir: WD, primary: 'reference/rr' } },
      ),
    );
    const map = section(result.markdown, 'Working directory map');
    expect(map).toBe(
      [
        '## Working directory map',
        '',
        '```text',
        'LLM_CONTEXT.md      this file',
        'CLAUDE.md           loads this file',
        '.gitignore          ignores the machine-specific paths below',
        'repos/',
        '  lr/               symlink · Desc lr.',
        '  rr/               git clone, sparse, branch main · primary · Desc rr.',
        'kb/',
        '  ctxman/           copy · What ctxman is, how it is built, and how to work with i…',
        'task/',
        '  write-agents-md/  symlink · Write and maintain the agent guide at the repository ro…',
        '.claude/skills/',
        '  bar/              installed · Desc rs-git.',
        '  foo/              copy · A local skill.',
        '```',
      ].join('\n'),
    );
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
      [`kb/${long}/main.md`]: `---\ntype: Knowledge Base\nname: ${long}\ndescription: Long.\n---\n\n# Long\n`,
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

describe('renderPlan with output: primary repository', () => {
  it('full history, branch and no subpath: no "Start in" line', async () => {
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
        '**rr-plain** · `repos/rr-plain` · `reference/rr-plain` · owner: not me',
        '',
        'Desc rr-plain.',
        '',
        '- Source: git clone of `https://github.com/o/plain.git`, full history, branch `v2`',
        '',
        'Work in `repos/rr-plain` unless the task says otherwise.',
      ].join('\n'),
    );
    expect(result.markdown).not.toContain('## Repositories');
  });

  it('a symlinked local repository: source is the symlink target, start in the subpath', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lr'], [{ key: 'reference/lr', material: 'symlink' }], {
        output: { dir: WD, primary: 'reference/lr' },
      }),
    );
    const primary = section(result.markdown, 'Primary repository');
    expect(primary).toContain(`- Source: symlink to \`${w.repo}\`\n- Start in: \`repos/lr/src\`\n`);
    expect(primary).toContain('**lr** · `repos/lr` · `reference/lr` · owner: me');
  });

  it('is omitted when its step failed; the repository is then listed under Repositories', async () => {
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
      '- **rr** · not placed (git clone failed): `git@github.com:o/r.git` · relevant path `docs` · `reference/rr` · owner: me — Desc rr.',
    );
    expect(result.markdown).not.toContain('(the primary repository)');
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
      '- **rr** · `repos/rr` (git clone of `git@github.com:o/r.git`) · relevant path `repos/rr/docs` · `reference/rr` · owner: me — Desc rr.',
    );
    expect(section(result.markdown, 'rr')).toContain(
      'Cloned at `repos/rr`.\n\nRelevant path `repos/rr/docs`.',
    );
    expect(section(result.markdown, 'rr')).not.toContain('primary');
  });
});

describe('renderPlan with output: repositories', () => {
  it('lists placed, mention-only and demoted repositories in segment order', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/rr', 'reference/rr-plain', 'reference/lr', 'reference/lr-gone'],
        [
          { key: 'reference/rr', material: 'clone' },
          { key: 'reference/lr', material: 'symlink' },
          { key: 'reference/lr-gone', material: 'symlink' },
        ],
      ),
    );
    expect(section(result.markdown, 'Repositories')).toBe(
      [
        '## Repositories',
        '',
        '- **rr** · `repos/rr` (git clone of `git@github.com:o/r.git`) · relevant path `repos/rr/docs` · `reference/rr` · owner: me — Desc rr.',
        '- **rr-plain** · not cloned: `https://github.com/o/plain.git` · `reference/rr-plain` · owner: not me — Desc rr-plain.',
        `- **lr** · \`repos/lr\` (symlink to \`${w.repo}\`) · relevant path \`repos/lr/src\` · \`reference/lr\` · owner: me — Desc lr.`,
        `- **lr-gone** · not linked: \`${path.join(w.repo, 'missing')}\` · \`reference/lr-gone\` · owner: me — Desc lr-gone.`,
      ].join('\n'),
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

describe('renderPlan with output: skills', () => {
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
      { fail: { 'skill/foo': 'copy failed' } },
    );
    expect(section(result.markdown, 'Skills')).toBe(
      [
        '## Skills',
        '',
        'Installed in `.claude/skills/`, where Claude Code discovers them.',
        '',
        '- `.claude/skills/bar/` · **rs-git** · from `https://github.com/o/skills.git` (`skills/bar`) — Desc rs-git.',
        '',
        'Not installed:',
        '',
        `- **foo** · \`skill/foo\` · not installed (copy failed): \`${w.D}${path.sep}skill${path.sep}foo${path.sep}SKILL.md\` — A local skill.`,
        `- **okf-authoring** · \`skill/okf-authoring\` · \`${w.D}${path.sep}skill${path.sep}okf-authoring${path.sep}SKILL.md\` — Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project).`,
        '- **rs-tgz** · `reference/rs-tgz` · `https://h.test/skill.tar.gz` — Desc rs-tgz.',
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

describe('renderPlan with output: item segments', () => {
  it('okf pointer, summary and the eager clause use relative paths; unmounted ones stay absolute', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['kb/ctxman', 'kb/astro-content-layer', 'task/write-agents-md', 'idea/context-inflate'],
        [
          { key: 'kb/ctxman', mode: 'pointer', options: { eager: true } },
          { key: 'kb/astro-content-layer', mode: 'pointer' },
          { key: 'task/write-agents-md', mode: 'summary' },
          { key: 'idea/context-inflate', mode: 'summary', material: 'none' },
        ],
      ),
    );
    const md = result.markdown;
    expect(md).toContain(
      '`kb/ctxman` · Knowledge Base · What ctxman is, how it is built, and how to work with its datasets, context forge, search and checks. Read it before starting: @kb/ctxman/main.md',
    );
    expect(md).toContain(
      '`kb/astro-content-layer` · Knowledge Base · How Astro 7 content collections, loaders and schemas work. Read `kb/astro-content-layer/main.md` if relevant.',
    );
    expect(md).toContain(
      '`task/write-agents-md` · Task · state: Pending · `task/write-agents-md/main.md`',
    );
    // material none: the ctxman data path, absolute as in v1
    expect(md).toContain(
      `\`idea/context-inflate\` · Idea · state: Pending · \`${path.join(w.D, 'idea', 'context-inflate', 'main.md')}\``,
    );
  });

  it('inline-bundle: concept paths, the "More"/"Other files" lists and ctxman: links become relative', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman', 'idea/context-inflate'], [{ key: 'kb/ctxman', mode: 'inline-bundle' }]),
    );
    expect(result.markdown).toContain(
      'See [datasets](kb/ctxman/concepts/datasets.md), the [idea](idea/context-inflate/main.md) and the [docs]',
    );
    expect(result.markdown).toContain('`concepts/datasets.md` · `kb/ctxman/concepts/datasets.md`');
    expect(result.markdown).toContain('Back to [main](kb/ctxman/main.md).');
  });

  it('inline-main lists the other concepts under the relative bundle path', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman'], [{ key: 'kb/ctxman', mode: 'inline-main' }]),
    );
    expect(result.markdown).toContain(
      'More in this bundle (under `kb/ctxman`): `concepts/datasets.md`.',
    );
  });

  it('skills: install says where it is installed; inline and pointer use the installed path', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['skill/foo', 'skill/okf-authoring', 'skill/ctxman-add-entry'],
        [
          { key: 'skill/foo', mode: 'inline' },
          { key: 'skill/okf-authoring', mode: 'pointer' },
          { key: 'skill/ctxman-add-entry', mode: 'install' },
        ],
      ),
    );
    const md = result.markdown;
    expect(md).toContain('`skill/foo` · Skill · `.claude/skills/foo/SKILL.md`');
    expect(md).toContain('See [steps](.claude/skills/foo/references/steps.md).');
    expect(md).toContain('Files in this skill (under `.claude/skills/foo`):');
    expect(md).toContain('- `references/steps.md` — `.claude/skills/foo/references/steps.md`');
    expect(md).toContain(
      'Author and review OKF v0.2 knowledge bundles (kb, rca, idea, task, bug, feature, project). Read `.claude/skills/okf-authoring/SKILL.md` and follow it when the task matches.',
    );
    expect(md).toContain(
      '`skill/ctxman-add-entry` · Skill · `.claude/skills/ctxman-add-entry`\n\nCreate a new ctxman dataset entry with the add scripts.\n\nInstalled at `.claude/skills/ctxman-add-entry/`.',
    );
    expect(md).not.toContain('cp -R');
  });

  it('skill with material none keeps the v1 install block, run from "this directory"', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['skill/foo'], [{ key: 'skill/foo', material: 'none', mode: 'install' }]),
    );
    expect(result.markdown).toContain(
      `Install this skill into the project (run from this directory):\n\n\`\`\`sh\nmkdir -p .claude/skills\ncp -R ${path.join(w.D, 'skill', 'foo')} .claude/skills/foo\n\`\`\``,
    );
    expect(result.markdown).not.toContain('the project root');
  });

  it('local repository: linked, with the tree titled by the relative path', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/lr'], [{ key: 'reference/lr', material: 'symlink', mode: 'tree' }]),
    );
    expect(section(result.markdown, 'lr')).toBe(
      [
        '## lr',
        '',
        '`reference/lr` · Local repo · owner: me · `repos/lr`',
        '',
        'Desc lr.',
        '',
        `Linked at \`repos/lr\` → \`${w.repo}\`.`,
        '',
        'Top-level entries of `repos/lr/src` (2 of 2):',
        '',
        '```text',
        'index.ts',
        'util.ts',
        '```',
      ].join('\n'),
    );
  });

  it('local repository without a placement keeps the v1 text with absolute paths', async () => {
    const w = dirWorld();
    const { result } = await renderDir(w, flatDir(['reference/lr']));
    expect(section(result.markdown, 'lr')).toContain(
      `Read the code at \`${path.join(w.repo, 'src')}\` (inside the repository \`${w.repo}\`) when the task needs it.`,
    );
    expect(result.markdown).not.toContain('Linked at');
  });

  it('remote repository mention-only: v1 text; clone mode says "run from this directory"', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/rr', 'reference/rr-plain'], [{ key: 'reference/rr', mode: 'clone' }]),
    );
    expect(section(result.markdown, 'rr')).toContain(
      'Clone it into the project (run from this directory; keep `.ctxman/` out of version control):',
    );
    expect(section(result.markdown, 'rr-plain')).toContain(
      'Git repository `https://github.com/o/plain.git`. Clone it only if the task needs its contents.',
    );
  });

  it('remote skill: installed at the dest from the URI, in every mode', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(
        ['reference/rs-git', 'reference/rs-tgz'],
        [{ key: 'reference/rs-tgz', mode: 'describe' }],
      ),
    );
    expect(section(result.markdown, 'rs-git')).toBe(
      [
        '## rs-git',
        '',
        '`reference/rs-git` · Remote skill · git · owner: me · `.claude/skills/bar`',
        '',
        'Desc rs-git.',
        '',
        'Installed at `.claude/skills/bar/` from `https://github.com/o/skills.git`.',
      ].join('\n'),
    );
    expect(section(result.markdown, 'rs-tgz')).toContain(
      'Installed at `.claude/skills/rs-tgz/` from `https://h.test/skill.tar.gz`.',
    );
  });

  it('remote skill without a placement keeps the v1 install block, run from "this directory"', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['reference/rs-tgz'], [{ key: 'reference/rs-tgz', material: 'none' }]),
    );
    expect(section(result.markdown, 'rs-tgz')).toContain(
      'Install this skill into `.claude/skills/rs-tgz/` (run from this directory):',
    );
  });

  it('a failed item renders as material none and says why', async () => {
    const w = dirWorld();
    const { result } = await renderDir(
      w,
      flatDir(['kb/ctxman'], [{ key: 'kb/ctxman', mode: 'inline-main' }]),
      { fail: { 'kb/ctxman': 'source /x does not exist' } },
    );
    const md = result.markdown;
    // absolute again (not mounted), reason at the end of the segment
    expect(md).toContain(`\`${path.join(w.D, 'kb', 'ctxman', 'main.md')}\``);
    expect(md).toContain('Not placed in this directory: source /x does not exist.');
    expect(md).toContain(`(under \`${path.join(w.D, 'kb', 'ctxman')}\`)`);
    expect(section(result.markdown, 'Working directory map')).not.toContain('ctxman/');
  });
});
