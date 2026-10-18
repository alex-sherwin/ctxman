import { afterEach, describe, expect, it } from 'vitest';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import { createFsSources } from '../../src/lib/inflate/fs-sources.ts';
import { conceptFiles, gatherContent } from '../../src/lib/inflate/pipeline.ts';
import type { BundleFileRef } from '../../src/lib/inflate/pipeline.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';
import { SEED_NOW, prepare, seedRecipe, seedTree } from './fixtures/inflate-seed.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

/** The seed tree plus a bundle whose index links its concepts in a non-alphabetical order. */
function world(): string {
  return tmp.make(
    seedTree({
      'kb/ordered/index.md': [
        '---',
        'okf_version: "0.2"',
        'type: Knowledge Base',
        'name: ordered',
        'description: A bundle with three concepts.',
        '---',
        '',
        '# ordered',
        '',
        '## Concepts',
        '',
        '- [zeta](/concepts/zeta.md)',
        '- [alpha](/concepts/alpha.md)',
        '',
      ].join('\n'),
      'kb/ordered/concepts/alpha.md': '---\ntype: Concept\n---\n\n# Alpha\n',
      'kb/ordered/concepts/zeta.md': '---\ntype: Concept\n---\n\n# Zeta\n',
      'kb/ordered/concepts/mid.md': '---\ntype: Concept\n---\n\n# Mid\n',
      'kb/ordered/log.md': '## 2026-10-18\n\n- created\n',
      'kb/ordered/assets/logo.png': 'not really a png',
    }),
  );
}

/** A flat recipe over ad hoc items; `dir` makes them placed, `modes` overrides the okf mode. */
function recipeOf(
  items: string[],
  opts: { dir?: string | null; overrides?: Record<string, unknown>[] } = {},
): RecipeData {
  return seedRecipe({
    layout: 'flat',
    contexts: [],
    markdown: [],
    order: [],
    output: opts.dir === null ? undefined : { dir: opts.dir ?? '/work/w' },
    items: items.map((key) => {
      const [dataset, slug] = key.split('/');
      return { dataset, slug };
    }),
    overrides: opts.overrides ?? [],
  });
}

describe('gatherContent: okf summary (plans/INFLATE_V3_PLAN.md §6)', () => {
  it('a PLACED okf item in summary mode lists its files and the concept order, and reads nothing else', async () => {
    const dataDir = world();
    const { plan, content } = await prepare(dataDir, recipeOf(['kb/ordered']));
    const seg = plan.segments.find((s) => s.key === 'kb/ordered');
    expect(seg).toMatchObject({ type: 'item', mode: 'summary', placed: true });
    const item = content.items['kb/ordered'];
    // index.md links zeta before alpha; the unlinked mid.md follows in tree order
    expect(item?.concepts).toEqual(['concepts/zeta.md', 'concepts/alpha.md', 'concepts/mid.md']);
    expect(item?.files?.map((f) => f.rel).sort()).toEqual([
      'assets/logo.png',
      'concepts/alpha.md',
      'concepts/mid.md',
      'concepts/zeta.md',
      'index.md',
      'log.md',
    ]);
    expect(item?.files?.find((f) => f.rel === 'assets/logo.png')?.kind).toBe('binary');
    // nothing is inlined: no texts, no warnings
    expect(item?.texts).toBeUndefined();
    expect(content.warnings).toEqual([]);
    expect(item?.rootAbs).toMatch(/kb[\\/]ordered$/);
    expect(item?.entryAbs).toMatch(/kb[\\/]ordered[\\/]index\.md$/);
  });

  it('not placed (no directory, or material none) a summary gathers nothing, as before', async () => {
    const dataDir = world();
    const asSummary = [{ key: 'kb/ordered', mode: 'summary' }];
    const noDir = await prepare(
      dataDir,
      recipeOf(['kb/ordered'], { dir: null, overrides: asSummary }),
    );
    expect(noDir.content.items['kb/ordered']?.files).toBeUndefined();
    expect(noDir.content.items['kb/ordered']?.concepts).toBeUndefined();
    const none = await prepare(
      dataDir,
      recipeOf(['kb/ordered'], {
        overrides: [{ key: 'kb/ordered', mode: 'summary', material: 'none' }],
      }),
    );
    expect(none.plan.segments.find((s) => s.key === 'kb/ordered')).toMatchObject({
      mode: 'summary',
      placed: false,
    });
    expect(none.content.items['kb/ordered']?.files).toBeUndefined();
    expect(none.content.items['kb/ordered']?.concepts).toBeUndefined();
  });

  it('pointer gathers nothing; the inline modes still read the text (v2 behaviour)', async () => {
    const dataDir = world();
    const pointer = await prepare(
      dataDir,
      recipeOf(['kb/ordered'], { overrides: [{ key: 'kb/ordered', mode: 'pointer' }] }),
    );
    expect(pointer.content.items['kb/ordered']?.files).toBeUndefined();
    const inline = await prepare(
      dataDir,
      recipeOf(['kb/ordered'], { overrides: [{ key: 'kb/ordered', mode: 'inline-bundle' }] }),
    );
    const item = inline.content.items['kb/ordered'];
    expect(item?.concepts).toEqual(['concepts/zeta.md', 'concepts/alpha.md', 'concepts/mid.md']);
    expect(Object.keys(item?.texts ?? {})).toEqual([
      'index.md',
      'concepts/zeta.md',
      'concepts/alpha.md',
      'concepts/mid.md',
    ]);
  });

  it('a placed summary of an entry without a readable index.md still lists its files without a warning', async () => {
    const dataDir = tmp.make(
      seedTree({
        'kb/odd/index.md': '---\ntype: Knowledge Base\nname: odd\ndescription: Odd.\n---\n',
        'kb/odd/concepts/b.md': '---\ntype: Concept\n---\n\n# B\n',
        'kb/odd/concepts/a.md': '---\ntype: Concept\n---\n\n# A\n',
      }),
    );
    const { content } = await prepare(dataDir, recipeOf(['kb/odd']));
    expect(content.items['kb/odd']?.concepts).toEqual(['concepts/a.md', 'concepts/b.md']);
    expect(content.warnings).toEqual([]);
  });

  it('gatherContent uses only the sources it is given', async () => {
    const dataDir = world();
    const sources = createFsSources({
      dataDir,
      nowMs: Date.parse(SEED_NOW),
      homeDir: '/home/test',
    });
    const reads: string[] = [];
    const spy = {
      ...sources,
      readText: (...args: Parameters<typeof sources.readText>) => {
        reads.push(args[2]);
        return sources.readText(...args);
      },
    };
    const { plan } = await prepare(dataDir, recipeOf(['kb/ordered']));
    await gatherContent(plan, spy);
    // only the entry is read, to order the concepts
    expect(reads).toEqual(['index.md']);
  });
});

describe('conceptFiles', () => {
  const files = (...rels: string[]): BundleFileRef[] =>
    rels.map((rel) => ({ rel, abs: `/b/${rel}`, kind: 'markdown' }));

  it('index links first, the rest in tree order; index.md, nested index.md and log.md never', () => {
    const list = files(
      'index.md',
      'log.md',
      'concepts/a.md',
      'concepts/b.md',
      'concepts/index.md',
      'concepts/c.md',
    );
    expect(conceptFiles(list, '# t\n\n- [c](/concepts/c.md)\n- [b](./concepts/b.md)\n')).toEqual([
      'concepts/c.md',
      'concepts/b.md',
      'concepts/a.md',
    ]);
    expect(conceptFiles(list, null)).toEqual(['concepts/a.md', 'concepts/b.md', 'concepts/c.md']);
  });
});
