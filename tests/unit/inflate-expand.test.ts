import { describe, expect, it } from 'vitest';
import type { LinkableDatasetId } from '../../src/datasets/registry.ts';
import { parseRecipe } from '../../src/lib/inflate/recipe.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { SEED_RECIPE_YAML } from './fixtures/seed-recipe.ts';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import { summarize } from '../../src/lib/entry-summary.ts';
import { applyOrder, expandRecipe, itemMetaFromSummary } from '../../src/lib/inflate/expand.ts';
import type {
  ContextLookup,
  ExpandLookup,
  ItemLookup,
  ItemMeta,
  ItemSegment,
} from '../../src/lib/inflate/expand.ts';

// ---------------------------------------------------------------- fixtures

function recipe(input: Record<string, unknown> = {}): RecipeData {
  const r = parseRecipe({ name: 'r', description: 'd', ...input });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.recipe;
}

const meta = (
  dataset: LinkableDatasetId,
  slug: string,
  extra: Partial<ItemMeta> = {},
): ItemMeta => ({
  dataset,
  slug,
  title: `Title ${slug}`,
  description: `About ${slug}`,
  tags: [],
  stale: false,
  ...extra,
});

const ready = (m: ItemMeta): ItemLookup => ({ status: 'ready', meta: m });
const readyCtx = (
  name: string,
  links: { dataset: LinkableDatasetId; slug: string; notes?: string }[],
): ContextLookup => ({
  status: 'ready',
  context: { name, description: `${name} description`, links },
});

function lookupOf(
  contexts: Record<string, ContextLookup>,
  items: Record<string, ItemLookup>,
): ExpandLookup {
  return {
    context: (slug) => contexts[slug] ?? { status: 'missing' },
    item: (dataset, slug) => items[`${dataset}/${slug}`] ?? { status: 'missing' },
  };
}

/** Items kb/a kb/b task/t skill/s + references, ready; contexts c1 (a, b) and c2 (b, t). */
function world(): ExpandLookup {
  return lookupOf(
    {
      c1: readyCtx('c1', [
        { dataset: 'kb', slug: 'a', notes: 'From c1 about a.' },
        { dataset: 'kb', slug: 'b', notes: 'c1 on b' },
      ]),
      c2: readyCtx('c2', [
        { dataset: 'kb', slug: 'b', notes: 'c2 on b' },
        { dataset: 'task', slug: 't' },
      ]),
    },
    {
      'kb/a': ready(meta('kb', 'a')),
      'kb/b': ready(meta('kb', 'b')),
      'task/t': ready(meta('task', 't', { state: 'pending' })),
      'skill/s': ready(meta('skill', 's')),
      'reference/lr': ready(meta('reference', 'lr', { refType: 'local-repo' })),
      'reference/rr': ready(meta('reference', 'rr', { refType: 'remote-repo' })),
      'reference/rs': ready(meta('reference', 'rs', { refType: 'remote-skill', uriKind: 'git' })),
    },
  );
}

const keysOf = (plan: ReturnType<typeof expandRecipe>): string[] => plan.segments.map((s) => s.key);
const itemOf = (plan: ReturnType<typeof expandRecipe>, key: string): ItemSegment => {
  const s = plan.segments.find((x) => x.key === key);
  if (s === undefined || s.type !== 'item') throw new Error(`no item segment ${key}`);
  return s;
};

// ---------------------------------------------------------------- applyOrder

describe('applyOrder (spec 5.2)', () => {
  it('empty order keeps the default order', () => {
    expect(applyOrder(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c']);
  });
  it('inserts a missing key after its nearest preceding default key', () => {
    expect(applyOrder(['a', 'b', 'c', 'd'], ['c', 'a'])).toEqual(['c', 'd', 'a', 'b']);
  });
  it('drops unknown keys and duplicates (first kept)', () => {
    expect(applyOrder(['a', 'b'], ['x', 'b', 'a'])).toEqual(['b', 'a']);
    expect(applyOrder(['a', 'b', 'c'], ['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });
  it('a key without a kept predecessor goes first', () => {
    expect(applyOrder(['a', 'b', 'c'], ['c'])).toEqual(['a', 'b', 'c']);
  });
  it('handles an empty default order', () => {
    expect(applyOrder([], ['a', 'b'])).toEqual([]);
    expect(applyOrder([], [])).toEqual([]);
  });
  it('does not mutate its inputs', () => {
    const d = ['a', 'b'];
    const o = ['b'];
    applyOrder(d, o);
    expect(d).toEqual(['a', 'b']);
    expect(o).toEqual(['b']);
  });
});

// ---------------------------------------------------------------- itemMetaFromSummary

describe('itemMetaFromSummary (spec 5.4)', () => {
  const NOW = Date.parse('2026-10-17T12:00:00Z');

  it('maps title (falls back to name), description, tags, stale and optional fields', () => {
    const s = summarize(
      'task',
      't',
      {
        name: 't',
        title: 'The T',
        description: 'desc',
        tags: ['x'],
        state: 'pending',
        stale_after: '2026-01-01',
      },
      new Date(0),
      NOW,
    );
    expect(itemMetaFromSummary(s)).toEqual({
      dataset: 'task',
      slug: 't',
      title: 'The T',
      description: 'desc',
      tags: ['x'],
      stale: true,
      state: 'pending',
      staleAfter: '2026-01-01',
    });
    const plain = summarize('kb', 'k', { name: 'k', description: 'd' }, new Date(0), NOW);
    const m = itemMetaFromSummary(plain);
    expect(m.title).toBe('k');
    expect(Object.keys(m).sort()).toEqual([
      'dataset',
      'description',
      'slug',
      'stale',
      'tags',
      'title',
    ]);
  });

  it('carries refType and uriKind for references', () => {
    const s = summarize(
      'reference',
      'rs',
      { name: 'rs', description: 'd', type: 'remote-skill', uri: 'https://h.test/s.tgz' },
      new Date(0),
      NOW,
    );
    expect(itemMetaFromSummary(s)).toMatchObject({ refType: 'remote-skill', uriKind: 'archive' });
  });
});

// ---------------------------------------------------------------- expandRecipe

describe('expandRecipe: contexts and the item registry', () => {
  it('grouped default order: context intro, its items, then the next context', () => {
    const plan = expandRecipe(recipe({ contexts: ['c1', 'c2'] }), world());
    expect(keysOf(plan)).toEqual(['ctx:c1', 'kb/a', 'kb/b', 'ctx:c2', 'task/t']);
    expect(plan.segments.map((s) => s.group)).toEqual([null, 'ctx:c1', 'ctx:c1', null, 'ctx:c2']);
    expect(plan.contexts).toEqual([
      { slug: 'c1', status: 'ready' },
      { slug: 'c2', status: 'ready' },
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.pending).toBe(false);
  });

  it('an item in two contexts becomes ONE segment under the first, with both notes in context order', () => {
    const plan = expandRecipe(recipe({ contexts: ['c1', 'c2'] }), world());
    expect(keysOf(plan).filter((k) => k === 'kb/b')).toHaveLength(1);
    const b = itemOf(plan, 'kb/b');
    expect(b.via).toEqual(['c1', 'c2']);
    expect(b.group).toBe('ctx:c1');
    expect(b.notes).toEqual([
      { context: 'c1', notes: 'c1 on b' },
      { context: 'c2', notes: 'c2 on b' },
    ]);
    expect(b.adhoc).toBe(false);
    // second context's intro lists the cross reference
    const c2 = plan.segments.find((s) => s.key === 'ctx:c2');
    expect(c2?.type === 'context-intro' && c2.crossRefs).toEqual(['kb/b']);
    const c1 = plan.segments.find((s) => s.key === 'ctx:c1');
    expect(c1?.type === 'context-intro' && c1.crossRefs).toEqual([]);
  });

  it('context order follows recipe.contexts and blank notes are dropped', () => {
    const lookup = lookupOf(
      {
        c1: readyCtx('c1', [{ dataset: 'kb', slug: 'a', notes: '  \n' }]),
        c2: readyCtx('c2', [{ dataset: 'kb', slug: 'a', notes: 'N' }]),
      },
      { 'kb/a': ready(meta('kb', 'a')) },
    );
    const plan = expandRecipe(recipe({ contexts: ['c2', 'c1'] }), lookup);
    expect(keysOf(plan)).toEqual(['ctx:c2', 'kb/a', 'ctx:c1']);
    expect(itemOf(plan, 'kb/a').via).toEqual(['c2', 'c1']);
    expect(itemOf(plan, 'kb/a').notes).toEqual([{ context: 'c2', notes: 'N' }]);
  });

  it('an ad hoc item that a context also links is one segment with adhoc: true', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1'],
        items: [
          { dataset: 'kb', slug: 'a' },
          { dataset: 'skill', slug: 's' },
        ],
      }),
      world(),
    );
    expect(keysOf(plan)).toEqual(['ctx:c1', 'kb/a', 'kb/b', 'sec:extra', 'skill/s']);
    expect(itemOf(plan, 'kb/a')).toMatchObject({ adhoc: true, via: ['c1'], group: 'ctx:c1' });
    expect(itemOf(plan, 'skill/s')).toMatchObject({ adhoc: true, via: [], group: 'sec:extra' });
    const extra = plan.segments.find((s) => s.key === 'sec:extra');
    expect(extra).toMatchObject({ type: 'section-intro', title: 'Additional items', group: null });
  });

  it('no sec:extra when every ad hoc item is linked by a context', () => {
    const plan = expandRecipe(
      recipe({ contexts: ['c1'], items: [{ dataset: 'kb', slug: 'a' }] }),
      world(),
    );
    expect(keysOf(plan)).toEqual(['ctx:c1', 'kb/a', 'kb/b']);
  });

  it('markdown blocks come last by default, in array order', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1'],
        markdown: [
          { id: 'b1', body: 'one' },
          { id: 'b2', body: 'two' },
        ],
      }),
      world(),
    );
    expect(keysOf(plan)).toEqual(['ctx:c1', 'kb/a', 'kb/b', 'md:b1', 'md:b2']);
    expect(plan.segments.at(-1)).toMatchObject({
      type: 'markdown',
      id: 'b2',
      body: 'two',
      status: 'included',
      group: 'ctx:c1',
    });
  });

  it('flat layout: registry order, no intros, every group null, no cross references', () => {
    const plan = expandRecipe(
      recipe({
        layout: 'flat',
        contexts: ['c1', 'c2'],
        items: [{ dataset: 'skill', slug: 's' }],
        markdown: [{ id: 'b1', body: 'x' }],
        order: ['ctx:c1', 'sec:extra', 'md:b1'],
      }),
      world(),
    );
    // intro keys of a user order are ignored in the flat layout
    expect(keysOf(plan)).toEqual(['kb/a', 'kb/b', 'task/t', 'skill/s', 'md:b1']);
    expect(plan.segments.every((s) => s.group === null)).toBe(true);
    expect(
      plan.segments.some((s) => s.type === 'context-intro' || s.type === 'section-intro'),
    ).toBe(false);
  });
});

describe('expandRecipe: order', () => {
  it('a user order is applied; unknown keys are ignored', () => {
    const plan = expandRecipe(
      recipe({ contexts: ['c1'], order: ['kb/b', 'ctx:c1', 'kb/zzz', 'md:b9'] }),
      world(),
    );
    expect(keysOf(plan)).toEqual(['kb/b', 'ctx:c1', 'kb/a']);
    // kb/b now precedes every intro: no group; kb/a follows ctx:c1
    expect(itemOf(plan, 'kb/b').group).toBeNull();
    expect(itemOf(plan, 'kb/a').group).toBe('ctx:c1');
  });

  it('a link added to a context later is placed right after its predecessor', () => {
    const lookup = lookupOf(
      {
        c1: readyCtx('c1', [
          { dataset: 'kb', slug: 'a' },
          { dataset: 'kb', slug: 'new' },
          { dataset: 'kb', slug: 'b' },
        ]),
      },
      {
        'kb/a': ready(meta('kb', 'a')),
        'kb/new': ready(meta('kb', 'new')),
        'kb/b': ready(meta('kb', 'b')),
      },
    );
    // saved order predates kb/new
    const plan = expandRecipe(
      recipe({ contexts: ['c1'], order: ['kb/b', 'kb/a', 'ctx:c1'] }),
      lookup,
    );
    expect(keysOf(plan)).toEqual(['kb/b', 'kb/a', 'kb/new', 'ctx:c1']);
  });

  it('crossRefs: items of this context that sit in another section', () => {
    const plan = expandRecipe(
      recipe({ contexts: ['c1', 'c2'], order: ['ctx:c2', 'kb/a', 'kb/b', 'task/t', 'ctx:c1'] }),
      world(),
    );
    expect(keysOf(plan)).toEqual(['ctx:c2', 'kb/a', 'kb/b', 'task/t', 'ctx:c1']);
    const c1 = plan.segments.find((s) => s.key === 'ctx:c1');
    const c2 = plan.segments.find((s) => s.key === 'ctx:c2');
    expect(c1?.type === 'context-intro' && c1.crossRefs).toEqual(['kb/a', 'kb/b']);
    expect(c2?.type === 'context-intro' && c2.crossRefs).toEqual([]);
  });

  it('excluded items are not cross references', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1', 'c2'],
        overrides: [{ key: 'kb/b', exclude: true }],
      }),
      world(),
    );
    const c2 = plan.segments.find((s) => s.key === 'ctx:c2');
    expect(c2?.type === 'context-intro' && c2.crossRefs).toEqual([]);
  });
});

describe('expandRecipe: warnings and loading', () => {
  it('missing and invalid contexts warn and are skipped', () => {
    const lookup = lookupOf(
      {
        c1: readyCtx('c1', [{ dataset: 'kb', slug: 'a' }]),
        bad: { status: 'invalid', message: 'links: nope' },
      },
      { 'kb/a': ready(meta('kb', 'a')) },
    );
    const plan = expandRecipe(recipe({ contexts: ['gone', 'c1', 'bad'] }), lookup);
    expect(keysOf(plan)).toEqual(['ctx:c1', 'kb/a']);
    expect(plan.contexts).toEqual([
      { slug: 'gone', status: 'missing' },
      { slug: 'c1', status: 'ready' },
      { slug: 'bad', status: 'invalid' },
    ]);
    expect(plan.warnings).toEqual([
      { code: 'context-missing', message: 'context "gone" does not exist', key: 'ctx:gone' },
      { code: 'context-invalid', message: 'context "bad" is invalid: links: nope', key: 'ctx:bad' },
    ]);
  });

  it('missing item: status missing + warning naming where it is linked from', () => {
    const lookup = lookupOf({ c1: readyCtx('c1', [{ dataset: 'kb', slug: 'gone' }]) }, {});
    const plan = expandRecipe(
      recipe({ contexts: ['c1'], items: [{ dataset: 'task', slug: 'adhoc-gone' }] }),
      lookup,
    );
    expect(itemOf(plan, 'kb/gone')).toMatchObject({
      status: 'missing',
      kind: null,
      meta: null,
      mode: null,
      modeSource: null,
      options: {},
      material: null,
      materialSource: null,
      materialOptions: {},
      title: 'gone',
    });
    expect(plan.warnings.map((w) => [w.code, w.message, w.key])).toEqual([
      ['item-missing', 'kb/gone does not exist (linked from c1)', 'kb/gone'],
      ['item-missing', 'task/adhoc-gone does not exist (linked from ad hoc)', 'task/adhoc-gone'],
    ]);
    expect(itemOf(plan, 'kb/gone').warnings).toHaveLength(1);
  });

  it('invalid item and unknown reference type', () => {
    const lookup = lookupOf(
      {},
      {
        'kb/bad': { status: 'invalid', message: 'description: Required' },
        'reference/untyped': ready(meta('reference', 'untyped')),
      },
    );
    const plan = expandRecipe(
      recipe({
        items: [
          { dataset: 'kb', slug: 'bad' },
          { dataset: 'reference', slug: 'untyped' },
        ],
      }),
      lookup,
    );
    expect(itemOf(plan, 'kb/bad').status).toBe('invalid');
    expect(itemOf(plan, 'reference/untyped')).toMatchObject({
      status: 'invalid',
      kind: null,
      material: null,
      materialSource: null,
      materialOptions: {},
    });
    expect(plan.warnings.map((w) => w.message)).toEqual([
      'kb/bad could not be read: description: Required',
      'reference/untyped could not be read: unknown reference type',
    ]);
  });

  it('loading lookups set pending and status loading, without warnings', () => {
    const lookup: ExpandLookup = {
      context: (slug) => (slug === 'c1' ? { status: 'loading' } : { status: 'missing' }),
      item: () => ({ status: 'loading' }),
    };
    const loadingCtx = expandRecipe(recipe({ contexts: ['c1'] }), lookup);
    expect(loadingCtx.pending).toBe(true);
    expect(loadingCtx.contexts).toEqual([{ slug: 'c1', status: 'loading' }]);
    expect(loadingCtx.warnings).toEqual([]);
    expect(loadingCtx.segments).toEqual([]);

    const loadingItem = expandRecipe(recipe({ items: [{ dataset: 'kb', slug: 'a' }] }), lookup);
    expect(loadingItem.pending).toBe(true);
    expect(itemOf(loadingItem, 'kb/a').status).toBe('loading');
    expect(loadingItem.warnings).toEqual([]);
  });

  it('a stale override is listed and warned about (in recipe.overrides order, after segment warnings)', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1'],
        overrides: [
          { key: 'kb/a', exclude: true },
          { key: 'task/nope', exclude: true },
          { key: 'skill/also-nope', mode: 'pointer' },
        ],
      }),
      world(),
    );
    expect(plan.staleOverrides).toEqual(['task/nope', 'skill/also-nope']);
    expect(plan.warnings).toEqual([
      {
        code: 'override-stale',
        message: 'override for task/nope matches no item in this recipe',
        key: 'task/nope',
      },
      {
        code: 'override-stale',
        message: 'override for skill/also-nope matches no item in this recipe',
        key: 'skill/also-nope',
      },
    ]);
  });

  it('plan.warnings order: contexts, default modes, segments, stale overrides', () => {
    const lookup = lookupOf(
      {
        c1: readyCtx('c1', [
          { dataset: 'kb', slug: 'gone' },
          { dataset: 'task', slug: 't' },
        ]),
      },
      {
        'task/t': ready(meta('task', 't')),
      },
    );
    // the schema rejects these modes, so the recipe is built by hand
    const handmade: RecipeData = {
      ...recipe({ contexts: ['nope', 'c1'] }),
      overrides: [
        { key: 'bug/x', exclude: true },
        { key: 'task/t', mode: 'install' },
      ],
      defaults: { task: { mode: 'clone' } },
    };
    const again = expandRecipe(handmade, lookup);
    expect(again.warnings.map((w) => w.code)).toEqual([
      'context-missing',
      'mode-invalid',
      'item-missing',
      'mode-invalid',
      'override-stale',
    ]);
  });
});

describe('expandRecipe: modes and options', () => {
  const kb = (extra: Partial<RecipeData> = {}): RecipeData => ({
    ...recipe({ contexts: ['c1'] }),
    ...extra,
  });

  it('built-in default per kind and target', () => {
    const items = [
      { dataset: 'skill', slug: 's' },
      { dataset: 'reference', slug: 'lr' },
      { dataset: 'reference', slug: 'rr' },
      { dataset: 'reference', slug: 'rs' },
    ];
    const cc = expandRecipe(recipe({ contexts: ['c1', 'c2'], items }), world());
    const modes = (p: typeof cc) =>
      p.segments.filter((s) => s.type === 'item').map((s) => `${s.key}=${s.mode}`);
    expect(modes(cc)).toEqual([
      'kb/a=inline-main',
      'kb/b=inline-main',
      'task/t=summary',
      'skill/s=install',
      'reference/lr=describe',
      'reference/rr=describe',
      'reference/rs=install',
    ]);
    const generic = expandRecipe(recipe({ target: 'generic', contexts: ['c1'], items }), world());
    expect(itemOf(generic, 'skill/s').mode).toBe('pointer');
    expect(itemOf(generic, 'reference/rs').mode).toBe('describe');
    expect(itemOf(cc, 'kb/a')).toMatchObject({
      kind: 'kb',
      modeSource: 'default',
      status: 'included',
    });
    expect(itemOf(cc, 'reference/rs').kind).toBe('remote-skill');
  });

  it('precedence: built-in < recipe default < override', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1', 'c2'],
        defaults: { kb: { mode: 'summary' }, task: { mode: 'pointer' } },
        overrides: [{ key: 'kb/b', mode: 'inline-bundle' }],
      }),
      world(),
    );
    expect(itemOf(plan, 'kb/a')).toMatchObject({ mode: 'summary', modeSource: 'recipe' });
    expect(itemOf(plan, 'kb/b')).toMatchObject({ mode: 'inline-bundle', modeSource: 'override' });
    expect(itemOf(plan, 'task/t')).toMatchObject({ mode: 'pointer', modeSource: 'recipe' });
  });

  it('options: mode options only, override over recipe default over built-in', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1'],
        defaults: { kb: { options: { shiftHeadings: false, includeFrontmatter: true } } },
        overrides: [
          {
            key: 'kb/b',
            options: { includeFrontmatter: false, includeLog: true },
            mode: 'inline-bundle',
          },
        ],
      }),
      world(),
    );
    expect(itemOf(plan, 'kb/a').options).toEqual({
      includeFrontmatter: true,
      shiftHeadings: false,
      rewriteLinks: true,
    });
    expect(itemOf(plan, 'kb/b').options).toEqual({
      includeFrontmatter: false,
      includeLog: true,
      shiftHeadings: false,
      rewriteLinks: true,
    });
  });

  it('{name} in cloneDir resolves to the reference slug', () => {
    const plan = expandRecipe(
      recipe({
        items: [{ dataset: 'reference', slug: 'rr' }],
        overrides: [{ key: 'reference/rr', mode: 'clone', options: { sparse: true } }],
      }),
      world(),
    );
    expect(itemOf(plan, 'reference/rr').options).toEqual({
      cloneDir: '.ctxman/refs/rr',
      shallow: true,
      sparse: true,
    });
  });

  it('an invalid recipe default mode warns once per kind and falls back to the built-in default', () => {
    const handmade = kb({ defaults: { kb: { mode: 'install' } } });
    const plan = expandRecipe(handmade, world());
    expect(itemOf(plan, 'kb/a')).toMatchObject({ mode: 'inline-main', modeSource: 'default' });
    expect(itemOf(plan, 'kb/b')).toMatchObject({ mode: 'inline-main', modeSource: 'default' });
    expect(plan.warnings).toEqual([
      {
        code: 'mode-invalid',
        message:
          'default mode "install" does not apply to Knowledge Base items; using "inline-main"',
        key: 'defaults.kb',
      },
    ]);
  });

  it('an invalid override mode warns on the segment and falls back to the valid recipe default', () => {
    const handmade = kb({
      defaults: { kb: { mode: 'summary' } },
      overrides: [{ key: 'kb/a', mode: 'clone' }],
    });
    const plan = expandRecipe(handmade, world());
    expect(itemOf(plan, 'kb/a')).toMatchObject({ mode: 'summary', modeSource: 'recipe' });
    expect(itemOf(plan, 'kb/a').warnings).toEqual([
      {
        code: 'mode-invalid',
        message: 'mode "clone" does not apply to kb/a (Knowledge Base); using "summary"',
        key: 'kb/a',
      },
    ]);
    // without a recipe default the fallback is the built-in default
    const plain = expandRecipe(kb({ overrides: [{ key: 'kb/a', mode: 'clone' }] }), world());
    expect(itemOf(plain, 'kb/a').warnings[0]?.message).toBe(
      'mode "clone" does not apply to kb/a (Knowledge Base); using "inline-main"',
    );
    expect(plain.warnings).toHaveLength(1);
  });

  it('exclude: status excluded, mode and options still resolved', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1'],
        overrides: [
          { key: 'kb/a', exclude: true },
          { key: 'kb/b', exclude: false },
        ],
      }),
      world(),
    );
    expect(itemOf(plan, 'kb/a')).toMatchObject({ status: 'excluded', mode: 'inline-main' });
    expect(itemOf(plan, 'kb/b').status).toBe('included');
  });
});

describe('expandRecipe: materials (plans/INFLATE_V2_SPEC.md §5)', () => {
  const hand = (extra: Partial<RecipeData> = {}): RecipeData => ({
    ...recipe({ contexts: ['c1', 'c2'] }),
    ...extra,
  });
  const allItems = [
    { dataset: 'skill', slug: 's' },
    { dataset: 'reference', slug: 'lr' },
    { dataset: 'reference', slug: 'rr' },
    { dataset: 'reference', slug: 'rs' },
  ];

  it('built-in default per kind (all targets), source default, options only for the material', () => {
    for (const target of ['claude-code', 'codex', 'generic']) {
      const plan = expandRecipe(
        recipe({ target, contexts: ['c1', 'c2'], items: allItems }),
        world(),
      );
      const got = plan.segments
        .filter((x): x is ItemSegment => x.type === 'item')
        .map((x) => `${x.key}=${x.material}/${x.materialSource}`);
      expect(got, target).toEqual([
        'kb/a=symlink/default',
        'kb/b=symlink/default',
        'task/t=symlink/default',
        'skill/s=copy/default',
        'reference/lr=none/default',
        'reference/rr=none/default',
        'reference/rs=install/default',
      ]);
      expect(itemOf(plan, 'kb/a').materialOptions).toEqual({});
      expect(itemOf(plan, 'reference/rr').materialOptions).toEqual({});
      expect(itemOf(plan, 'reference/rs').materialOptions).toEqual({ branch: '' });
    }
  });

  it('precedence: built-in < recipe default < override', () => {
    const plan = expandRecipe(
      recipe({
        contexts: ['c1', 'c2'],
        defaults: { kb: { material: 'copy' }, task: { material: 'none' } },
        overrides: [{ key: 'kb/b', material: 'none' }],
      }),
      world(),
    );
    expect(itemOf(plan, 'kb/a')).toMatchObject({ material: 'copy', materialSource: 'recipe' });
    expect(itemOf(plan, 'kb/b')).toMatchObject({ material: 'none', materialSource: 'override' });
    expect(itemOf(plan, 'task/t')).toMatchObject({ material: 'none', materialSource: 'recipe' });
    expect(plan.warnings).toEqual([]);
  });

  it('a recipe default equal to the built-in one still counts as recipe', () => {
    const plan = expandRecipe(
      recipe({ contexts: ['c1'], defaults: { kb: { material: 'symlink' } } }),
      world(),
    );
    expect(itemOf(plan, 'kb/a')).toMatchObject({ material: 'symlink', materialSource: 'recipe' });
  });

  it('material options: override over recipe default over built-in, only the material options', () => {
    const plan = expandRecipe(
      recipe({
        items: [
          { dataset: 'reference', slug: 'rr' },
          { dataset: 'reference', slug: 'rs' },
        ],
        defaults: {
          'remote-repo': { material: 'clone', materialOptions: { cloneDepth: 10, branch: 'dev' } },
          'remote-skill': { materialOptions: { branch: 'main', cloneDepth: 5 } },
        },
        overrides: [{ key: 'reference/rr', materialOptions: { cloneDepth: 0, subpathOnly: true } }],
      }),
      world(),
    );
    expect(itemOf(plan, 'reference/rr')).toMatchObject({
      material: 'clone',
      materialSource: 'recipe',
      materialOptions: { cloneDepth: 0, branch: 'dev', subpathOnly: true },
    });
    // remote-skill install only has `branch`
    expect(itemOf(plan, 'reference/rs').materialOptions).toEqual({ branch: 'main' });
    // material none carries no options even when some are configured
    const none = expandRecipe(
      recipe({
        items: [{ dataset: 'reference', slug: 'rr' }],
        overrides: [{ key: 'reference/rr', material: 'none', materialOptions: { branch: 'x' } }],
      }),
      world(),
    );
    expect(itemOf(none, 'reference/rr').materialOptions).toEqual({});
  });

  it('an invalid recipe default material warns once per kind and falls back to the built-in default', () => {
    // the schema rejects this, so the recipe is built by hand
    const plan = expandRecipe(hand({ defaults: { kb: { material: 'clone' } } }), world());
    expect(itemOf(plan, 'kb/a')).toMatchObject({ material: 'symlink', materialSource: 'default' });
    expect(itemOf(plan, 'kb/b')).toMatchObject({ material: 'symlink', materialSource: 'default' });
    expect(plan.warnings).toEqual([
      {
        code: 'material-invalid',
        message: 'default material "clone" does not apply to Knowledge Base items; using "symlink"',
        key: 'defaults.kb',
      },
    ]);
  });

  it('an invalid override material warns on the segment and falls back to the valid recipe default', () => {
    const plan = expandRecipe(
      hand({
        defaults: { kb: { material: 'copy' } },
        overrides: [{ key: 'kb/a', material: 'clone' }],
      }),
      world(),
    );
    expect(itemOf(plan, 'kb/a')).toMatchObject({ material: 'copy', materialSource: 'recipe' });
    expect(itemOf(plan, 'kb/a').warnings).toEqual([
      {
        code: 'material-invalid',
        message: 'material "clone" does not apply to kb/a (Knowledge Base); using "copy"',
        key: 'kb/a',
      },
    ]);
    const plain = expandRecipe(
      hand({ overrides: [{ key: 'kb/a', material: 'install' }] }),
      world(),
    );
    expect(itemOf(plain, 'kb/a').warnings[0]?.message).toBe(
      'material "install" does not apply to kb/a (Knowledge Base); using "symlink"',
    );
    expect(plain.warnings).toHaveLength(1);
  });

  it('a reference override material is validated against the real reference type', () => {
    const plan = expandRecipe(
      hand({
        contexts: [],
        items: [
          { dataset: 'reference', slug: 'lr' },
          { dataset: 'reference', slug: 'rr' },
        ],
        // the schema allows clone on any reference key; the type decides
        overrides: [
          { key: 'reference/lr', material: 'clone' },
          { key: 'reference/rr', material: 'clone' },
        ],
      }),
      world(),
    );
    expect(itemOf(plan, 'reference/lr')).toMatchObject({ material: 'none' });
    expect(itemOf(plan, 'reference/lr').warnings[0]?.message).toBe(
      'material "clone" does not apply to reference/lr (Local repo); using "none"',
    );
    expect(itemOf(plan, 'reference/rr')).toMatchObject({
      material: 'clone',
      materialSource: 'override',
    });
  });

  it('mode and material are independent: warnings of both are on the segment, mode first', () => {
    const plan = expandRecipe(
      hand({ contexts: ['c1'], overrides: [{ key: 'kb/a', mode: 'clone', material: 'clone' }] }),
      world(),
    );
    expect(itemOf(plan, 'kb/a').warnings.map((w) => w.message)).toEqual([
      'mode "clone" does not apply to kb/a (Knowledge Base); using "inline-main"',
      'material "clone" does not apply to kb/a (Knowledge Base); using "symlink"',
    ]);
  });

  it('plan.warnings order: contexts, default modes, default materials, segments, primary, stale', () => {
    const lookup = lookupOf(
      {
        c1: readyCtx('c1', [
          { dataset: 'task', slug: 't' },
          { dataset: 'kb', slug: 'gone' },
        ]),
      },
      { 'task/t': ready(meta('task', 't')) },
    );
    const handmade: RecipeData = {
      ...recipe({ contexts: ['nope', 'c1'] }),
      output: { contextFile: 'LLM_CONTEXT.md', primary: 'reference/rr' },
      overrides: [
        { key: 'bug/x', exclude: true },
        { key: 'task/t', material: 'clone' },
      ],
      defaults: { task: { mode: 'clone', material: 'clone' } },
    };
    const plan = expandRecipe(handmade, lookup);
    expect(plan.warnings.map((w) => w.code)).toEqual([
      'context-missing',
      'mode-invalid',
      'material-invalid',
      'material-invalid',
      'item-missing',
      'primary-invalid',
      'override-stale',
    ]);
  });
});

describe('expandRecipe: primary (plans/INFLATE_V2_SPEC.md §5)', () => {
  const withPrimary = (
    primary: string | undefined,
    extra: Record<string, unknown> = {},
  ): RecipeData =>
    recipe({
      items: allReferenceItems,
      ...extra,
      output: primary === undefined ? {} : { primary },
    });
  const allReferenceItems = [
    { dataset: 'reference', slug: 'lr' },
    { dataset: 'reference', slug: 'rr' },
    { dataset: 'reference', slug: 'rs' },
  ];
  const clone = [{ key: 'reference/rr', material: 'clone' }];

  it('null when output.primary is unset (also without output)', () => {
    expect(expandRecipe(recipe({ items: allReferenceItems }), world()).primary).toBeNull();
    expect(expandRecipe(withPrimary(undefined), world()).primary).toBeNull();
  });

  it('ok: remote-repo with clone, local-repo with symlink', () => {
    const remote = expandRecipe(withPrimary('reference/rr', { overrides: clone }), world());
    expect(remote.primary).toEqual({ key: 'reference/rr', status: 'ok' });
    expect(remote.warnings).toEqual([]);
    const local = expandRecipe(
      withPrimary('reference/lr', { overrides: [{ key: 'reference/lr', material: 'symlink' }] }),
      world(),
    );
    expect(local.primary).toEqual({ key: 'reference/lr', status: 'ok' });
    // a recipe default counts too
    const viaDefault = expandRecipe(
      withPrimary('reference/rr', { defaults: { 'remote-repo': { material: 'clone' } } }),
      world(),
    );
    expect(viaDefault.primary?.status).toBe('ok');
  });

  it('invalid: not an item of the recipe, missing item', () => {
    const notInRecipe = expandRecipe(withPrimary('reference/other', { overrides: clone }), world());
    expect(notInRecipe.primary).toEqual({
      key: 'reference/other',
      status: 'invalid',
      message: 'primary reference/other is not an included item of this recipe',
    });
    expect(notInRecipe.warnings).toEqual([
      {
        code: 'primary-invalid',
        message: 'primary reference/other is not an included item of this recipe',
        key: 'reference/other',
      },
    ]);
    // a listed item whose entry is missing is not included either
    const missing = expandRecipe(
      recipe({
        items: [{ dataset: 'reference', slug: 'ghost' }],
        output: { primary: 'reference/ghost' },
      }),
      world(),
    );
    expect(missing.primary?.message).toBe(
      'primary reference/ghost is not an included item of this recipe',
    );
    expect(missing.warnings.map((w) => w.code)).toEqual(['item-missing', 'primary-invalid']);
  });

  it('invalid: excluded', () => {
    const plan = expandRecipe(
      withPrimary('reference/rr', {
        overrides: [{ key: 'reference/rr', material: 'clone', exclude: true }],
      }),
      world(),
    );
    expect(plan.primary).toMatchObject({
      status: 'invalid',
      message: 'primary reference/rr is not an included item of this recipe',
    });
  });

  it('invalid: wrong kind (remote-skill, okf, skill)', () => {
    for (const key of ['reference/rs', 'kb/a', 'skill/s']) {
      const [dataset, slug] = key.split('/') as [LinkableDatasetId, string];
      // the schema only allows reference/<slug>, so kb/a and skill/s are set by hand
      const handmade: RecipeData = {
        ...recipe({ items: [{ dataset, slug }] }),
        output: { contextFile: 'LLM_CONTEXT.md', primary: key },
      };
      expect(expandRecipe(handmade, world()).primary, key).toEqual({
        key,
        status: 'invalid',
        message: `primary ${key} must be a remote-repo or local-repo reference`,
      });
    }
  });

  it('invalid: material none (the default) or the wrong material for the kind', () => {
    const noMaterial = expandRecipe(withPrimary('reference/rr'), world());
    expect(noMaterial.primary).toEqual({
      key: 'reference/rr',
      status: 'invalid',
      message: 'primary reference/rr needs material clone (remote-repo) or symlink (local-repo)',
    });
    const localNone = expandRecipe(withPrimary('reference/lr'), world());
    expect(localNone.primary?.status).toBe('invalid');
    const explicitNone = expandRecipe(
      withPrimary('reference/rr', { overrides: [{ key: 'reference/rr', material: 'none' }] }),
      world(),
    );
    expect(explicitNone.primary?.status).toBe('invalid');
    // symlink on a remote-repo is not a valid material at all: the segment falls back to none
    const handmade: RecipeData = {
      ...withPrimary('reference/rr'),
      overrides: [{ key: 'reference/rr', material: 'symlink' }],
    };
    const wrong = expandRecipe(handmade, world());
    expect(wrong.primary?.message).toBe(
      'primary reference/rr needs material clone (remote-repo) or symlink (local-repo)',
    );
    expect(wrong.warnings.map((w) => w.code)).toEqual(['material-invalid', 'primary-invalid']);
  });

  it('provisional ok while the item or a context is loading, without a warning', () => {
    const loadingItems: ExpandLookup = {
      context: () => ({ status: 'missing' }),
      item: () => ({ status: 'loading' }),
    };
    const item = expandRecipe(withPrimary('reference/rr'), loadingItems);
    expect(item.pending).toBe(true);
    expect(item.primary).toEqual({ key: 'reference/rr', status: 'ok' });
    expect(item.warnings).toEqual([]);

    const loadingContext: ExpandLookup = {
      context: () => ({ status: 'loading' }),
      item: () => ({ status: 'missing' }),
    };
    const ctx = expandRecipe(
      recipe({ contexts: ['c1'], output: { primary: 'reference/rr' } }),
      loadingContext,
    );
    expect(ctx.primary).toEqual({ key: 'reference/rr', status: 'ok' });
    expect(ctx.warnings).toEqual([]);

    // once nothing loads any more the verdict is real
    const settled = expandRecipe(
      recipe({ contexts: ['c1'], output: { primary: 'reference/rr' } }),
      lookupOf({ c1: readyCtx('c1', []) }, {}),
    );
    expect(settled.primary?.status).toBe('invalid');
  });

  it('a primary reached through a context link works', () => {
    const lookup = lookupOf(
      { c1: readyCtx('c1', [{ dataset: 'reference', slug: 'rr' }]) },
      { 'reference/rr': ready(meta('reference', 'rr', { refType: 'remote-repo' })) },
    );
    const plan = expandRecipe(
      recipe({
        contexts: ['c1'],
        overrides: [{ key: 'reference/rr', material: 'clone' }],
        output: { primary: 'reference/rr' },
      }),
      lookup,
    );
    expect(plan.primary).toEqual({ key: 'reference/rr', status: 'ok' });
  });
});

describe('expandRecipe: the seed recipe (plans/INFLATE_V2_SPEC.md §13)', () => {
  it('astro-docs is a cloned primary; kb and the skill are symlinked / copied; the bug is excluded', () => {
    const lookup = lookupOf(
      {
        'ctxman-dev': readyCtx('ctxman-dev', [
          { dataset: 'kb', slug: 'ctxman' },
          { dataset: 'bug', slug: 'stale-badge-timezone' },
          { dataset: 'reference', slug: 'astro-docs' },
        ]),
      },
      {
        'kb/ctxman': ready(meta('kb', 'ctxman')),
        'bug/stale-badge-timezone': ready(meta('bug', 'stale-badge-timezone')),
        'skill/ctxman-add-entry': ready(meta('skill', 'ctxman-add-entry')),
        'reference/astro-docs': ready(
          meta('reference', 'astro-docs', { refType: 'remote-repo', uriKind: 'git' }),
        ),
      },
    );
    const parsed = parseRecipe(parseYaml(SEED_RECIPE_YAML), 'ctxman-dev-brief');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const plan = expandRecipe(parsed.recipe, lookup);
    expect(plan.warnings).toEqual([]);
    expect(plan.primary).toEqual({ key: 'reference/astro-docs', status: 'ok' });
    expect(itemOf(plan, 'reference/astro-docs')).toMatchObject({
      mode: 'clone',
      material: 'clone',
      materialSource: 'override',
      materialOptions: { cloneDepth: 1, branch: '', subpathOnly: true },
    });
    expect(itemOf(plan, 'kb/ctxman')).toMatchObject({
      material: 'symlink',
      materialSource: 'default',
    });
    expect(itemOf(plan, 'skill/ctxman-add-entry')).toMatchObject({ material: 'copy' });
    expect(itemOf(plan, 'bug/stale-badge-timezone').status).toBe('excluded');
  });
});
