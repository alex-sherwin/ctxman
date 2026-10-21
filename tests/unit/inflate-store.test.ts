import { cleanStores } from 'nanostores';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatasetId } from '../../src/datasets/registry.ts';
import { LINKABLE_DATASETS } from '../../src/datasets/registry.ts';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import type { EntrySummary } from '../../src/lib/entry-summary.ts';
import { parseRecipe } from '../../src/lib/inflate/recipe.ts';
import { $entries } from '../../src/stores/entries.ts';
import type { EntriesState } from '../../src/stores/entries.ts';
import {
  $adhoc,
  $baseline,
  $contextDocs,
  $dirty,
  $inflateUrl,
  $lastAddedBlock,
  $outputDir,
  $placementSummary,
  $plan,
  $recipeLoad,
  $referenceInfo,
  $render,
  $saveStatus,
  $segmentBytes,
  $working,
  $writeStatus,
  addItem,
  browserLookup,
  createRecipe,
  insertMarkdownAfter,
  loadRecipe,
  moveSegment,
  patchInflateUrl,
  pruneStale,
  removeItem,
  removeMarkdown,
  renderNow,
  reorderSegments,
  resetOrder,
  revert,
  save,
  setAllowNonEmpty,
  setContextFile,
  setDefaultDir,
  setDefaultMaterial,
  setDataset,
  setDefaultMode,
  setDescription,
  setEdit,
  setExcluded,
  setLayout,
  setMarkdownBody,
  setMaterial,
  setMaterialOption,
  setMode,
  setOption,
  setOutputDir,
  setPaths,
  setPreamble,
  setPrimary,
  setStub,
  setTarget,
  setView,
  toggleContext,
  writeOutput,
} from '../../src/stores/inflate.ts';
import { formatBytes, formatDuration, recipeNameProblem } from '../../src/ui/inflate/format.ts';

function summary(
  dataset: DatasetId,
  slug: string,
  extra: Partial<EntrySummary> = {},
): EntrySummary {
  return {
    dataset,
    slug,
    name: slug,
    description: `${slug} description`,
    tags: [],
    lastModified: '2026-01-01T00:00:00.000Z',
    stale: false,
    url: `/${dataset}/${slug}`,
    ...extra,
  };
}

const ready = (...entries: EntrySummary[]): EntriesState => ({ status: 'ready', entries });

const base: RecipeData = {
  name: 'demo',
  description: 'Demo recipe',
  tags: [],
  target: 'claude-code',
  layout: 'grouped',
  contexts: ['ctx-a'],
  items: [{ dataset: 'skill', slug: 'my-skill' }],
  markdown: [{ id: 'b1', body: 'hello' }],
  overrides: [],
  order: [],
  defaults: {},
};

/** Cached server data: context `ctx-a` links kb/one, task/two and the reference `refs-a`. */
function seedCaches(): void {
  const entries: Partial<Record<DatasetId, EntriesState>> = {};
  for (const ds of LINKABLE_DATASETS) entries[ds] = ready();
  entries.kb = ready(summary('kb', 'one', { title: 'One' }), summary('kb', 'extra'));
  entries.task = ready(summary('task', 'two', { state: 'pending' }));
  entries.skill = ready(summary('skill', 'my-skill'));
  entries.reference = ready(summary('reference', 'refs-a', { refType: 'remote-repo' }));
  $entries.set(entries);
  $contextDocs.set({
    'ctx-a': {
      status: 'ready',
      context: {
        name: 'ctx-a',
        description: 'Context A',
        links: [
          { dataset: 'kb', slug: 'one' },
          { dataset: 'task', slug: 'two', notes: 'Look here' },
          { dataset: 'reference', slug: 'refs-a' },
        ],
      },
    },
    'ctx-b': {
      status: 'ready',
      context: {
        name: 'ctx-b',
        description: 'Context B',
        links: [{ dataset: 'kb', slug: 'extra' }],
      },
    },
  });
}

function load(recipe: RecipeData = base): void {
  $baseline.set(structuredClone(recipe));
  $working.set(structuredClone(recipe));
}

const keys = (): string[] => ($plan.get()?.segments ?? []).map((s) => s.key);
const working = (): RecipeData => {
  const w = $working.get();
  if (w === null) throw new Error('no working recipe');
  return w;
};

beforeEach(() => {
  seedCaches();
  load();
  $saveStatus.set({ kind: 'idle' });
  $lastAddedBlock.set(null);
});

afterEach(() => {
  $baseline.set(null);
  $working.set(null);
  $contextDocs.set({});
  $entries.set({});
  $render.set({ status: 'idle', result: null });
  $writeStatus.set({ kind: 'idle' });
  $recipeLoad.set({ status: 'none' });
  vi.unstubAllGlobals();
});

describe('composition (browser expandRecipe over the caches)', () => {
  it('lists the grouped default order', () => {
    expect(keys()).toEqual([
      'ctx:ctx-a',
      'kb/one',
      'task/two',
      'reference/refs-a',
      'sec:extra',
      'skill/my-skill',
      'md:b1',
    ]);
    const task = $plan.get()?.segments.find((s) => s.key === 'task/two');
    expect(task?.type === 'item' && task.via).toEqual(['ctx-a']);
  });

  it('browserLookup: loading until the dataset cache exists, missing when absent, invalid on error', () => {
    const lookup = browserLookup({}, { kb: ready(summary('kb', 'one')) });
    expect(lookup.context('x')).toEqual({ status: 'loading' });
    expect(lookup.item('kb', 'one').status).toBe('ready');
    expect(lookup.item('kb', 'nope')).toEqual({ status: 'missing' });
    expect(lookup.item('task', 'x')).toEqual({ status: 'loading' });
    const failing = browserLookup({}, { kb: { status: 'error', entries: [], error: 'HTTP 500' } });
    expect(failing.item('kb', 'one').status).toBe('invalid');
    // a refetch keeps the previous rows: no flicker back to "loading"
    const refetch = browserLookup(
      {},
      { kb: { status: 'loading', entries: [summary('kb', 'one')] } },
    );
    expect(refetch.item('kb', 'one').status).toBe('ready');
  });

  it('a context that is still loading makes the plan pending', () => {
    $contextDocs.setKey('ctx-a', { status: 'loading' });
    expect($plan.get()?.pending).toBe(true);
  });
});

describe('editing actions', () => {
  it('starts clean, becomes dirty after an edit, and revert restores the baseline', () => {
    expect($dirty.get()).toBe(false);
    setDescription('Changed');
    expect($dirty.get()).toBe(true);
    revert();
    expect($dirty.get()).toBe(false);
    expect($working.get()).toEqual(base);
    expect($working.get()).not.toBe($baseline.get());
  });

  it('never mutates the previous working copy', () => {
    const before = working();
    const snapshot = JSON.stringify(before);
    setMode('kb/one', 'summary');
    setOption('kb/one', 'includeFrontmatter', true);
    moveSegment('kb/one', 1);
    insertMarkdownAfter(null);
    toggleContext('ctx-b', true);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('an edit clears a stale "saved" status', () => {
    $saveStatus.set({ kind: 'saved', at: 1 });
    setTarget('codex');
    expect($saveStatus.get().kind).toBe('idle');
    expect(working().target).toBe('codex');
    setLayout('flat');
    expect(working().layout).toBe('flat');
  });

  it("setPreamble('') removes the key so the recipe equals the baseline again", () => {
    setPreamble('Be careful.\n');
    expect($dirty.get()).toBe(true);
    expect(working().preamble).toBe('Be careful.\n');
    setPreamble('');
    expect(Object.hasOwn(working(), 'preamble')).toBe(false);
    expect($dirty.get()).toBe(false);
  });

  it('addItem appends once; removeItem drops it from items', () => {
    addItem('kb', 'extra');
    addItem('kb', 'extra');
    expect(working().items.map((i) => `${i.dataset}/${i.slug}`)).toEqual([
      'skill/my-skill',
      'kb/extra',
    ]);
    expect(keys()).toContain('kb/extra');
    removeItem('kb/extra');
    expect(working().items).toHaveLength(1);
    expect(keys()).not.toContain('kb/extra');
  });

  it('removeItem keeps a segment that a context still links, and its override', () => {
    addItem('kb', 'one'); // ad hoc AND linked by ctx-a
    setMode('kb/one', 'summary');
    removeItem('kb/one');
    expect(keys()).toContain('kb/one');
    expect(working().overrides.map((o) => o.key)).toEqual(['kb/one']);
  });

  it('toggleContext adds / removes a context and prunes order + overrides of its items', () => {
    toggleContext('ctx-b', true);
    toggleContext('ctx-b', true); // already on: no-op
    expect(working().contexts).toEqual(['ctx-a', 'ctx-b']);
    expect(keys()).toContain('kb/extra');
    setMode('kb/extra', 'summary');
    moveSegment('kb/extra', -1);
    expect(working().order).toContain('kb/extra');
    toggleContext('ctx-b', false);
    expect(working().contexts).toEqual(['ctx-a']);
    expect(working().overrides).toEqual([]);
    expect(working().order).not.toContain('kb/extra');
    expect(working().order).not.toContain('ctx:ctx-b');
  });

  it('prune is skipped while a lookup is still loading', () => {
    setMode('kb/one', 'summary');
    $contextDocs.setKey('ctx-a', { status: 'loading' });
    toggleContext('ctx-b', true);
    toggleContext('ctx-b', false);
    expect(working().overrides.map((o) => o.key)).toEqual(['kb/one']);
  });
});

describe('modes, options, defaults, exclude', () => {
  it('setMode stores an override and drops it when it equals what the plan would pick', () => {
    setMode('kb/one', 'inline-bundle');
    expect(working().overrides).toEqual([{ key: 'kb/one', mode: 'inline-bundle' }]);
    setMode('kb/one', 'inline-main'); // the built-in default of a kb entry
    expect(working().overrides).toEqual([]);
    expect($dirty.get()).toBe(false);
  });

  it('setMode compares against the recipe default, not the built-in one', () => {
    setDefaultMode('kb', 'summary');
    setMode('kb/one', 'inline-main');
    expect(working().overrides).toEqual([{ key: 'kb/one', mode: 'inline-main' }]);
    setMode('kb/one', 'summary');
    expect(working().overrides).toEqual([]);
  });

  it('setOption stores a value and drops it when it equals the base value', () => {
    setOption('kb/one', 'includeFrontmatter', true);
    expect(working().overrides).toEqual([{ key: 'kb/one', options: { includeFrontmatter: true } }]);
    setOption('kb/one', 'shiftHeadings', false);
    expect(working().overrides[0]?.options).toEqual({
      includeFrontmatter: true,
      shiftHeadings: false,
    });
    setOption('kb/one', 'includeFrontmatter', false); // equals the default
    setOption('kb/one', 'shiftHeadings', true);
    expect(working().overrides).toEqual([]);
  });

  it('setOption uses the recipe default as the base value', () => {
    setDefaultMode('kb', 'inline-main');
    const w = working();
    $working.set({ ...w, defaults: { kb: { options: { shiftHeadings: false } } } });
    setOption('kb/one', 'shiftHeadings', false);
    expect(working().overrides).toEqual([]);
    setOption('kb/one', 'shiftHeadings', true);
    expect(working().overrides).toEqual([{ key: 'kb/one', options: { shiftHeadings: true } }]);
  });

  it('a cloneDir equal to the resolved default is not kept', () => {
    // `refs-a` is a remote-repo: its `clone` mode is the one with the cloneDir option
    setMode('reference/refs-a', 'clone');
    setOption('reference/refs-a', 'cloneDir', '.ctxman/refs/other');
    expect(working().overrides[0]?.options?.cloneDir).toBe('.ctxman/refs/other');
    setOption('reference/refs-a', 'cloneDir', 'repos/refs-a');
    expect(working().overrides[0]?.options).toBeUndefined();
  });

  it('setDefaultMode sets and clears a per-kind default; the built-in mode is not stored', () => {
    setDefaultMode('kb', 'summary');
    expect(working().defaults).toEqual({ kb: { mode: 'summary' } });
    const seg = $plan.get()?.segments.find((s) => s.key === 'kb/one');
    expect(seg?.type === 'item' && seg.mode).toBe('summary');
    setDefaultMode('kb', null);
    expect(working().defaults).toEqual({});
    setDefaultMode('kb', 'inline-main'); // equals the built-in default
    expect(working().defaults).toEqual({});
    expect($dirty.get()).toBe(false);
  });

  it('setExcluded sets and removes the flag, and an empty override disappears', () => {
    setExcluded('task/two', true);
    expect(working().overrides).toEqual([{ key: 'task/two', exclude: true }]);
    const seg = $plan.get()?.segments.find((s) => s.key === 'task/two');
    expect(seg?.status).toBe('excluded');
    setExcluded('task/two', false);
    expect(working().overrides).toEqual([]);
    expect($dirty.get()).toBe(false);
  });

  it('editing an override keeps its material and material options (they are never lost)', () => {
    const w = working();
    $working.set({
      ...w,
      overrides: [
        {
          key: 'reference/refs-a',
          material: 'clone',
          materialOptions: { cloneDepth: 0, branch: 'dev' },
        },
      ],
    });
    setMode('reference/refs-a', 'clone');
    setOption('reference/refs-a', 'sparse', true);
    expect(working().overrides).toEqual([
      {
        key: 'reference/refs-a',
        mode: 'clone',
        options: { sparse: true },
        material: 'clone',
        materialOptions: { cloneDepth: 0, branch: 'dev' },
      },
    ]);
    setExcluded('reference/refs-a', true);
    setExcluded('reference/refs-a', false);
    setOption('reference/refs-a', 'sparse', false); // back to the base value
    setMode('reference/refs-a', 'describe'); // back to the built-in mode
    // nothing but the material is left, and an override that only has a material is kept
    expect(working().overrides).toEqual([
      {
        key: 'reference/refs-a',
        material: 'clone',
        materialOptions: { cloneDepth: 0, branch: 'dev' },
      },
    ]);
  });

  it('an override that only carries a material is not dropped; undefined material options are', () => {
    const w = working();
    $working.set({
      ...w,
      overrides: [{ key: 'kb/one', material: 'copy', materialOptions: { branch: undefined } }],
    });
    setExcluded('kb/one', true);
    setExcluded('kb/one', false);
    expect(working().overrides).toEqual([{ key: 'kb/one', material: 'copy' }]);
  });

  it('setDefaultMode keeps the material fields of the kind default', () => {
    const w = working();
    $working.set({
      ...w,
      defaults: {
        kb: { material: 'copy' },
        'remote-repo': { materialOptions: { cloneDepth: 10 } },
      },
    });
    setDefaultMode('kb', 'summary');
    expect(working().defaults.kb).toEqual({ mode: 'summary', material: 'copy' });
    setDefaultMode('kb', null);
    expect(working().defaults.kb).toEqual({ material: 'copy' });
    setDefaultMode('remote-repo', 'clone');
    setDefaultMode('remote-repo', null);
    expect(working().defaults['remote-repo']).toEqual({ materialOptions: { cloneDepth: 10 } });
  });

  it('an override keeps its position in the list when edited', () => {
    setMode('kb/one', 'summary');
    setMode('task/two', 'pointer');
    setOption('kb/one', 'eager', true); // kb/one is in summary: option not applicable, still stored
    expect(working().overrides.map((o) => o.key)).toEqual(['kb/one', 'task/two']);
  });
});

describe('output directory', () => {
  it('setOutputDir sets and clears the directory; an emptied output disappears', () => {
    setOutputDir('~/ctxman-inflate/demo');
    expect(working().output).toEqual({
      contextFile: 'AGENTS.md',
      dir: '~/ctxman-inflate/demo',
    });
    expect($dirty.get()).toBe(true);
    setOutputDir('  ');
    expect(Object.hasOwn(working(), 'output')).toBe(false);
    expect($dirty.get()).toBe(false);
    setOutputDir('/work');
    setOutputDir(null);
    expect(Object.hasOwn(working(), 'output')).toBe(false);
  });

  it('setDefaultDir uses the default directory of the recipe name', () => {
    setDefaultDir();
    expect(working().output?.dir).toBe('~/ctxman-inflate/demo');
  });

  it('setContextFile commits only valid names; the default name leaves nothing behind', () => {
    setContextFile('CONTEXT.md');
    expect(working().output?.contextFile).toBe('CONTEXT.md');
    setContextFile('a/b.md');
    setContextFile('notes.txt');
    setContextFile('');
    expect(working().output?.contextFile).toBe('CONTEXT.md');
    setContextFile('AGENTS.md');
    expect(Object.hasOwn(working(), 'output')).toBe(false);
    expect($dirty.get()).toBe(false);
  });

  it('setStub stores only what differs from the target defaults', () => {
    // claude-code: CLAUDE.md and .gitignore on, AGENTS.md off
    setStub('claudeMd', true); // already the default
    expect(Object.hasOwn(working(), 'output')).toBe(false);
    setStub('agentsMd', true);
    setStub('gitignore', false);
    expect(working().output?.stubs).toEqual({ agentsMd: true, gitignore: false });
    setStub('agentsMd', false); // back to the default: dropped
    expect(working().output?.stubs).toEqual({ gitignore: false });
    setStub('gitignore', true);
    expect(Object.hasOwn(working(), 'output')).toBe(false);
    expect($dirty.get()).toBe(false);
  });

  it('setAllowNonEmpty stores true only', () => {
    setAllowNonEmpty(true);
    expect(working().output?.allowNonEmpty).toBe(true);
    setAllowNonEmpty(false);
    expect(Object.hasOwn(working(), 'output')).toBe(false);
  });

  it('setPrimary holds one key: choosing another replaces it, null clears it', () => {
    setPrimary('reference/refs-a');
    expect(working().output?.primary).toBe('reference/refs-a');
    setPrimary('reference/other');
    expect(working().output?.primary).toBe('reference/other');
    setPrimary(null);
    expect(Object.hasOwn(working(), 'output')).toBe(false);
  });

  it('output edits keep the rest of the output and never mutate the previous copy', () => {
    setOutputDir('/work');
    setPrimary('reference/refs-a');
    const before = working();
    const snapshot = JSON.stringify(before);
    setContextFile('CONTEXT.md');
    setStub('agentsMd', true);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(working().output).toEqual({
      contextFile: 'CONTEXT.md',
      dir: '/work',
      primary: 'reference/refs-a',
      stubs: { agentsMd: true },
    });
  });
});

describe('materials', () => {
  it('setMaterial stores an override and drops it when it equals the built-in default', () => {
    // kb: symlink by default
    setMaterial('kb/one', 'copy');
    expect(working().overrides).toEqual([{ key: 'kb/one', material: 'copy' }]);
    const seg = $plan.get()?.segments.find((s) => s.key === 'kb/one');
    expect(seg?.type === 'item' && seg.material).toBe('copy');
    setMaterial('kb/one', 'symlink');
    expect(working().overrides).toEqual([]);
    expect($dirty.get()).toBe(false);
  });

  it('setMaterial compares against the recipe default and ignores a material the kind cannot have', () => {
    setDefaultMaterial('kb', 'copy');
    expect(working().defaults).toEqual({ kb: { material: 'copy' } });
    setMaterial('kb/one', 'copy');
    expect(working().overrides).toEqual([]);
    setMaterial('kb/one', 'symlink');
    expect(working().overrides).toEqual([{ key: 'kb/one', material: 'symlink' }]);
    setMaterial('kb/one', 'clone'); // not a kb material
    setMaterial('reference/refs-a', 'install'); // not a remote-repo material
    expect(working().overrides).toEqual([{ key: 'kb/one', material: 'symlink' }]);
  });

  it('setMaterial keeps the mode and the options of the override', () => {
    setMode('reference/refs-a', 'clone');
    setMaterial('reference/refs-a', 'none'); // differs from the built-in clone of a remote repo
    expect(working().overrides).toEqual([
      { key: 'reference/refs-a', mode: 'clone', material: 'none' },
    ]);
    setMaterial('reference/refs-a', 'clone'); // the built-in default of a remote repo
    expect(working().overrides).toEqual([{ key: 'reference/refs-a', mode: 'clone' }]);
  });

  it('setMaterialOption stores a value and drops it when it equals the base value', () => {
    // clone is the built-in material of a remote repo: only the options are stored
    setMaterialOption('reference/refs-a', 'cloneDepth', 1);
    setMaterialOption('reference/refs-a', 'branch', 'dev');
    setMaterialOption('reference/refs-a', 'newBranch', 'work');
    expect(working().overrides[0]).toEqual({
      key: 'reference/refs-a',
      materialOptions: { cloneDepth: 1, branch: 'dev', newBranch: 'work' },
    });
    setMaterialOption('reference/refs-a', 'cloneDepth', 0); // the built-in depth: full history
    setMaterialOption('reference/refs-a', 'branch', '');
    setMaterialOption('reference/refs-a', 'newBranch', '');
    expect(working().overrides).toEqual([]);
    const segment = $plan.get()?.segments.find((s) => s.key === 'reference/refs-a');
    expect(segment?.type === 'item' && segment.materialOptions).toEqual({
      cloneDepth: 0,
      branch: '',
      newBranch: '',
      subpathOnly: false,
    });
  });

  it('setMaterialOption uses the recipe default as the base value', () => {
    $working.set({
      ...working(),
      defaults: { 'remote-repo': { materialOptions: { cloneDepth: 10 } } },
    });
    setMaterial('reference/refs-a', 'clone');
    setMaterialOption('reference/refs-a', 'cloneDepth', 10);
    expect(working().overrides[0]?.materialOptions).toBeUndefined();
    setMaterialOption('reference/refs-a', 'cloneDepth', 1);
    expect(working().overrides[0]?.materialOptions).toEqual({ cloneDepth: 1 });
  });

  it('setDefaultMaterial sets and clears a per-kind default and keeps the mode fields', () => {
    setDefaultMode('kb', 'summary');
    setDefaultMaterial('kb', 'copy');
    expect(working().defaults.kb).toEqual({ mode: 'summary', material: 'copy' });
    setDefaultMaterial('kb', null);
    expect(working().defaults.kb).toEqual({ mode: 'summary' });
    setDefaultMaterial('kb', 'symlink'); // equals the built-in default
    expect(working().defaults.kb).toEqual({ mode: 'summary' });
    setDefaultMaterial('kb', 'clone'); // not a kb material
    expect(working().defaults.kb).toEqual({ mode: 'summary' });
  });

  it('a primary repository goes when its material can no longer be primary', () => {
    setMaterial('reference/refs-a', 'clone');
    setPrimary('reference/refs-a');
    setMaterial('reference/refs-a', 'none');
    expect(Object.hasOwn(working(), 'output')).toBe(false);
  });

  it('prune clears the primary together with its item', () => {
    setMaterial('reference/refs-a', 'clone');
    setPrimary('reference/refs-a');
    setOutputDir('/work');
    toggleContext('ctx-a', false); // refs-a was only linked by ctx-a
    expect(keys()).not.toContain('reference/refs-a');
    expect(working().output).toEqual({ contextFile: 'AGENTS.md', dir: '/work' });
    expect(working().overrides).toEqual([]);
  });

  it('a primary whose item stays in the recipe is kept', () => {
    addItem('reference', 'refs-a'); // ad hoc AND linked by ctx-a
    setMaterial('reference/refs-a', 'clone');
    setPrimary('reference/refs-a');
    removeItem('reference/refs-a');
    expect(working().output?.primary).toBe('reference/refs-a');
  });
});

describe('placement-aware modes (v3)', () => {
  it('setMode compares against the default of the placement: summary while placed, inline-main otherwise', () => {
    setOutputDir('/work'); // kb/one is symlinked by default, so it is placed
    setMode('kb/one', 'inline-main'); // the document-only default is not the placed one
    expect(working().overrides).toEqual([{ key: 'kb/one', mode: 'inline-main' }]);
    setMode('kb/one', 'summary'); // the placed default
    expect(working().overrides).toEqual([]);
    expect($dirty.get()).toBe(true); // the directory is still an edit

    setMaterial('kb/one', 'none'); // not placed any more: the document-only default applies
    setMode('kb/one', 'summary');
    expect(working().overrides).toEqual([{ key: 'kb/one', material: 'none', mode: 'summary' }]);
    setMode('kb/one', 'inline-main');
    expect(working().overrides).toEqual([{ key: 'kb/one', material: 'none' }]);
  });

  it("without a directory nothing is placed: today's defaults", () => {
    setMode('kb/one', 'summary');
    expect(working().overrides).toEqual([{ key: 'kb/one', mode: 'summary' }]);
    setMode('kb/one', 'inline-main');
    expect(working().overrides).toEqual([]);
  });

  it('a recipe default that the placement does not offer is not the base', () => {
    // skill `install` is in the family list but not in the placed one: the placed default is `pointer`
    setDefaultMode('skill', 'install');
    expect(working().defaults).toEqual({}); // the document-only default, nothing stored
    $working.set({ ...working(), defaults: { skill: { mode: 'install' } } });
    setOutputDir('/work');
    const seg = $plan.get()?.segments.find((s) => s.key === 'skill/my-skill');
    expect(seg?.type === 'item' && [seg.placed, seg.mode, seg.modeSource]).toEqual([
      true,
      'pointer',
      'default',
    ]);
    setMode('skill/my-skill', 'pointer');
    expect(working().overrides).toEqual([]);
    setMode('skill/my-skill', 'inline');
    expect(working().overrides).toEqual([{ key: 'skill/my-skill', mode: 'inline' }]);
  });

  it("setDefaultMode uses the placement of the kind's default material", () => {
    setOutputDir('/work');
    setDefaultMode('kb', 'summary'); // the placed default of an okf kind
    expect(working().defaults).toEqual({});
    setDefaultMode('kb', 'inline-main');
    expect(working().defaults).toEqual({ kb: { mode: 'inline-main' } });
    setDefaultMode('kb', null);

    setDefaultMaterial('kb', 'none'); // nothing placed for kb: back to the document-only default
    setDefaultMode('kb', 'summary');
    expect(working().defaults).toEqual({ kb: { material: 'none', mode: 'summary' } });
    setDefaultMode('kb', 'inline-main');
    expect(working().defaults).toEqual({ kb: { material: 'none' } });
  });

  it("setDefaultMode without a directory keeps today's default", () => {
    setDefaultMode('kb', 'summary');
    expect(working().defaults).toEqual({ kb: { mode: 'summary' } });
    setDefaultMode('kb', 'inline-main');
    expect(working().defaults).toEqual({});
  });
});

describe('Editable (v3)', () => {
  const sourceEntries = (): void => {
    $entries.set({
      ...$entries.get(),
      reference: ready(
        summary('reference', 'refs-a', { refType: 'remote-repo', owner: 'me' }),
        summary('reference', 'local-a', { refType: 'local-repo', owner: 'not-me' }),
        summary('reference', 'skill-git', { refType: 'remote-skill', uriKind: 'git' }),
        summary('reference', 'skill-zip', { refType: 'remote-skill', uriKind: 'archive' }),
      ),
    });
  };
  const edit = (key: string): boolean | null | undefined => {
    const seg = $plan.get()?.segments.find((s) => s.key === key);
    return seg?.type === 'item' ? seg.edit : undefined;
  };

  beforeEach(() => {
    sourceEntries();
    addItem('reference', 'local-a');
    setOutputDir('/work');
  });

  it('is off for a repository that is not the primary, on for the primary', () => {
    expect(edit('reference/refs-a')).toBe(false);
    expect(edit('reference/local-a')).toBe(false);
    setPrimary('reference/refs-a');
    expect(edit('reference/refs-a')).toBe(true);
    expect(edit('reference/local-a')).toBe(false);
    expect(edit('kb/one')).toBeNull(); // not a repository
  });

  it('setEdit stores a value that differs from the default and drops one that equals it', () => {
    setEdit('reference/refs-a', true);
    expect(working().overrides).toEqual([{ key: 'reference/refs-a', edit: true }]);
    expect(edit('reference/refs-a')).toBe(true);
    setEdit('reference/refs-a', false); // the default of a repository that is not the primary
    expect(working().overrides).toEqual([]);

    setPrimary('reference/refs-a');
    setEdit('reference/refs-a', false); // the primary may be read-only
    expect(working().overrides).toEqual([{ key: 'reference/refs-a', edit: false }]);
    expect(edit('reference/refs-a')).toBe(false);
    setEdit('reference/refs-a', true);
    expect(working().overrides).toEqual([]);
  });

  it('setEdit is refused for an item that cannot be edited', () => {
    setEdit('kb/one', true); // not a repository
    setEdit('reference/skill-git', true); // a skill
    setMaterial('reference/local-a', 'copy'); // a snapshot
    setEdit('reference/local-a', true);
    setMaterial('reference/refs-a', 'none'); // a remote repository that is not cloned
    setEdit('reference/refs-a', true);
    expect(working().overrides).toEqual([
      { key: 'reference/local-a', material: 'copy' },
      { key: 'reference/refs-a', material: 'none' },
    ]);
    setMaterial('reference/local-a', 'none'); // the original path of a local repository is editable
    setEdit('reference/local-a', true);
    expect(working().overrides).toContainEqual({
      key: 'reference/local-a',
      material: 'none',
      edit: true,
    });
  });

  it('the other override fields survive an edit flag and the other way round', () => {
    setEdit('reference/refs-a', true);
    setMaterialOption('reference/refs-a', 'cloneDepth', 1);
    setMode('reference/refs-a', 'clone');
    setExcluded('reference/refs-a', true);
    setExcluded('reference/refs-a', false);
    expect(working().overrides).toEqual([
      {
        key: 'reference/refs-a',
        mode: 'clone',
        materialOptions: { cloneDepth: 1 },
        edit: true,
      },
    ]);
    setEdit('reference/refs-a', false);
    expect(working().overrides[0]).not.toHaveProperty('edit');
    expect(working().overrides[0]?.materialOptions).toEqual({ cloneDepth: 1 });
  });

  it('an override that only says edit is kept, and the recipe it makes is valid', () => {
    setEdit('reference/local-a', true);
    expect(working().overrides).toEqual([{ key: 'reference/local-a', edit: true }]);
    expect($dirty.get()).toBe(true);
    expect(parseRecipe(working(), 'demo').ok).toBe(true);
  });

  it('moving the primary drops the edit flags that now equal the default', () => {
    setEdit('reference/refs-a', true); // explicit: editable although not the primary
    setPrimary('reference/refs-a'); // now the default says so too
    expect(working().overrides).toEqual([]);

    setEdit('reference/refs-a', false); // explicit read-only primary
    setPrimary(null); // no primary: the default is read-only again
    expect(working().overrides).toEqual([]);

    setEdit('reference/local-a', true);
    setPrimary('reference/refs-a');
    expect(working().overrides).toEqual([{ key: 'reference/local-a', edit: true }]); // still different
  });

  it('a material change that frees the primary drops an edit flag that became redundant', () => {
    setPrimary('reference/local-a');
    setEdit('reference/local-a', false);
    // a local repository at its original path is still editable, but it cannot be the primary any more:
    // the primary goes, and with it the default that `edit: false` differed from
    setMaterial('reference/local-a', 'none');
    expect(working().output?.primary).toBeUndefined();
    expect(working().overrides).toEqual([{ key: 'reference/local-a', material: 'none' }]);
  });

  it('an edit flag on an item that cannot be edited stays in the recipe (it applies again with the material)', () => {
    setEdit('reference/refs-a', true);
    setMaterial('reference/refs-a', 'none');
    expect(working().overrides).toEqual([
      { key: 'reference/refs-a', material: 'none', edit: true },
    ]);
    expect(edit('reference/refs-a')).toBeNull();
    setMaterial('reference/refs-a', 'clone');
    expect(working().overrides).toEqual([{ key: 'reference/refs-a', edit: true }]);
    expect(edit('reference/refs-a')).toBe(true);
  });

  it('$outputDir follows the directory of the working copy', () => {
    expect($outputDir.get()).toBe('/work');
    setOutputDir(null);
    expect($outputDir.get()).toBeNull();
    setOutputDir('  /elsewhere ');
    expect($outputDir.get()).toBe('/elsewhere');
  });

  it('$referenceInfo carries the owner and the URI kind of the cached references', () => {
    const info = $referenceInfo.get();
    expect(info.get('reference/refs-a')).toEqual({ owner: 'me' });
    expect(info.get('reference/local-a')).toEqual({ owner: 'not-me' });
    expect(info.get('reference/skill-git')).toEqual({ uriKind: 'git' });
    expect(info.get('reference/skill-zip')).toEqual({ uriKind: 'archive' });
    expect(info.get('kb/one')).toBeUndefined();
  });
});

describe('placement summary (v3)', () => {
  beforeEach(() => {
    $entries.set({
      ...$entries.get(),
      reference: ready(
        summary('reference', 'refs-a', { refType: 'remote-repo' }),
        summary('reference', 'local-a', { refType: 'local-repo' }),
        summary('reference', 'skill-git', { refType: 'remote-skill', uriKind: 'git' }),
        summary('reference', 'skill-zip', { refType: 'remote-skill', uriKind: 'archive' }),
      ),
    });
  });

  it('is null for a document-only recipe', () => {
    expect($placementSummary.get()).toBeNull();
  });

  it('counts the included items by placement', () => {
    setOutputDir('/work');
    // kb/one, task/two, skill/my-skill symlinked; refs-a cloned
    expect($placementSummary.get()).toEqual({
      dir: '/work',
      counts: { symlink: 3, worktree: 0, copy: 0, clone: 1, download: 0, none: 0 },
      primary: null,
      editable: [],
    });

    setMaterial('kb/one', 'copy');
    setMaterial('task/two', 'none');
    addItem('reference', 'skill-git');
    addItem('reference', 'skill-zip');
    addItem('reference', 'local-a');
    expect($placementSummary.get()?.counts).toEqual({
      symlink: 2, // my-skill, local-a
      worktree: 0,
      copy: 1,
      clone: 2, // refs-a, the git skill
      download: 1,
      none: 1,
    });
    setMaterial('reference/local-a', 'worktree');
    expect($placementSummary.get()?.counts).toMatchObject({ symlink: 1, worktree: 1 });
  });

  it('names the primary and the editable repositories', () => {
    setOutputDir('/work');
    addItem('reference', 'local-a');
    setPrimary('reference/refs-a');
    setEdit('reference/local-a', true);
    const summary = $placementSummary.get();
    expect(summary?.primary).toBe('refs-a');
    expect(summary?.editable).toEqual(['refs-a', 'local-a']);
    setEdit('reference/refs-a', false);
    expect($placementSummary.get()?.editable).toEqual(['local-a']);
  });

  it('a snippet is not counted: it has nothing to place', () => {
    $entries.set({ ...$entries.get(), snippet: ready(summary('snippet', 'rules')) });
    setOutputDir('/work');
    addItem('snippet', 'rules');
    expect($plan.get()?.segments.find((s) => s.key === 'snippet/rules')).toMatchObject({
      kind: 'snippet',
      mode: 'inline',
      material: 'none',
    });
    expect($placementSummary.get()?.counts).toEqual({
      symlink: 3,
      worktree: 0,
      copy: 0,
      clone: 1,
      download: 0,
      none: 0,
    });
  });

  it('leaves out excluded items', () => {
    setOutputDir('/work');
    setExcluded('task/two', true);
    expect($placementSummary.get()?.counts.symlink).toBe(2);
  });

  it('trims the directory', () => {
    setOutputDir('  /work ');
    expect($placementSummary.get()?.dir).toBe('/work');
  });
});

describe('view, job and paths in the URL', () => {
  let unbind: () => void = () => {};
  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/inflate', search: '?recipe=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    // Mounting the URL store registers the window listeners and reads `location`; do it before the test sets it.
    unbind = $inflateUrl.listen(() => {});
    $inflateUrl.set({
      recipe: 'demo',
      view: 'compose',
      dataset: 'kb',
      q: '',
      job: null,
      paths: 'relative',
    });
  });
  afterEach(() => unbind());

  const replaced = (): string[] =>
    (history.replaceState as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) =>
      String(c[2]),
    );
  const JOB = '0b9f3c1e-5a7d-4e21-9c0a-3f6d8b2a1e47';

  it('setView and setPaths replace the entry and omit defaults', () => {
    setView('preview');
    setPaths('absolute');
    setView('compose');
    setPaths('relative');
    expect(replaced()).toEqual([
      '/inflate?recipe=demo&view=preview',
      '/inflate?recipe=demo&view=preview&paths=absolute',
      '/inflate?recipe=demo&paths=absolute',
      '/inflate?recipe=demo',
    ]);
    expect(history.pushState).not.toHaveBeenCalled();
    expect($inflateUrl.get()).toMatchObject({ view: 'compose', paths: 'relative', job: null });
  });

  it('the job lives with view=run only', () => {
    patchInflateUrl({ view: 'run', job: JOB }, 'replace');
    expect($inflateUrl.get()).toMatchObject({ view: 'run', job: JOB });
    expect(replaced().at(-1)).toBe(`/inflate?recipe=demo&view=run&job=${JOB}`);
    setView('preview');
    expect($inflateUrl.get().job).toBeNull();
    expect(replaced().at(-1)).toBe('/inflate?recipe=demo&view=preview');
    patchInflateUrl({ job: JOB }, 'replace'); // not in the run view: ignored
    expect($inflateUrl.get().job).toBeNull();
  });

  it('push mode adds a history entry; an unchanged patch writes nothing', () => {
    patchInflateUrl({ view: 'run' }, 'push');
    expect(history.pushState).toHaveBeenCalledTimes(1);
    patchInflateUrl({ view: 'run' }, 'push');
    setView('run');
    expect(history.pushState).toHaveBeenCalledTimes(1);
    expect(history.replaceState).not.toHaveBeenCalled();
  });
});

describe('order and markdown', () => {
  it('moveSegment swaps with the neighbour and makes the whole order explicit', () => {
    moveSegment('task/two', -1);
    expect(working().order).toEqual(keys());
    expect(keys().slice(0, 4)).toEqual(['ctx:ctx-a', 'task/two', 'kb/one', 'reference/refs-a']);
    moveSegment('ctx:ctx-a', -1); // already first: no-op
    moveSegment('md:b1', 1); // already last: no-op
    expect(keys()[0]).toBe('ctx:ctx-a');
    expect(keys().at(-1)).toBe('md:b1');
  });

  it('reorderSegments (drag and drop) moves keys before / after a target and fixes the order', () => {
    reorderSegments(['task/two'], 'ctx:ctx-a', 'after');
    expect(keys().slice(0, 3)).toEqual(['ctx:ctx-a', 'task/two', 'kb/one']);
    expect(working().order).toEqual(keys());
    reorderSegments(['kb/one', 'md:b1'], 'ctx:ctx-a', 'before');
    expect(keys().slice(0, 3)).toEqual(['kb/one', 'md:b1', 'ctx:ctx-a']);
    expect(working().order).toEqual(keys());
  });

  it('reorderSegments leaves the recipe alone when the drop changes nothing', () => {
    reorderSegments(['kb/one'], 'ctx:ctx-a', 'after'); // already right after it
    reorderSegments(['kb/one'], 'kb/one', 'before'); // onto itself
    reorderSegments(['kb/one'], 'kb/ghost', 'before'); // unknown target
    expect(working().order).toEqual([]);
    expect($dirty.get()).toBe(false);
  });

  it('resetOrder clears the explicit order', () => {
    moveSegment('task/two', -1);
    resetOrder();
    expect(working().order).toEqual([]);
    expect(keys()[1]).toBe('kb/one');
  });

  it('insertMarkdownAfter adds the next block id right after a segment, or at the end', () => {
    insertMarkdownAfter('kb/one');
    expect(working().markdown.map((b) => b.id)).toEqual(['b1', 'b2']);
    const k = keys();
    expect(k[k.indexOf('kb/one') + 1]).toBe('md:b2');
    expect(working().order).toEqual(k);
    expect($lastAddedBlock.get()).toBe('b2');
    insertMarkdownAfter(null);
    expect(keys().at(-1)).toBe('md:b3');
  });

  it('setMarkdownBody edits one block; removeMarkdown drops it and its order key', () => {
    insertMarkdownAfter(null);
    setMarkdownBody('b2', 'typed');
    expect(working().markdown.find((b) => b.id === 'b2')?.body).toBe('typed');
    expect(working().markdown.find((b) => b.id === 'b1')?.body).toBe('hello');
    removeMarkdown('b2');
    expect(working().markdown.map((b) => b.id)).toEqual(['b1']);
    expect(working().order).not.toContain('md:b2');
  });

  it('pruneStale drops order keys and overrides that match nothing', () => {
    const w = working();
    $working.set({
      ...w,
      order: ['ctx:ctx-a', 'kb/ghost', 'kb/one'],
      overrides: [{ key: 'kb/ghost', mode: 'summary' }],
    });
    expect($plan.get()?.staleOverrides).toEqual(['kb/ghost']);
    pruneStale();
    expect(working().order).toEqual(['ctx:ctx-a', 'kb/one']);
    expect(working().overrides).toEqual([]);
    expect($plan.get()?.staleOverrides).toEqual([]);
  });
});

describe('server actions (fetch stubbed)', () => {
  const respond = (status: number, body?: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/inflate', search: '?recipe=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
  });

  it('save PUTs the working copy and adopts the response as the new baseline', async () => {
    setDescription('Saved text');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      url.startsWith('/api/entries')
        ? respond(200, { entries: [] }) // invalidateEntries('recipe') after the save
        : respond(200, { recipe: JSON.parse(String(init?.body)), lastModified: 'now' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await save();
    const puts = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.[0]).toBe('/api/recipe/demo');
    expect($saveStatus.get().kind).toBe('saved');
    expect($dirty.get()).toBe(false);
    expect($baseline.get()?.description).toBe('Saved text');
  });

  it('save reports the server message and issues', async () => {
    setDescription('x');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(400, {
          error: 'invalid',
          message: 'bad',
          issues: [{ path: 'order.0', message: 'no' }],
        }),
      ),
    );
    await save();
    expect($saveStatus.get()).toEqual({
      kind: 'error',
      message: 'bad',
      issues: [{ path: 'order.0', message: 'no' }],
    });
    expect($dirty.get()).toBe(true);
  });

  it('createRecipe maps 409 to a name error and posts the empty grouped recipe', async () => {
    const fetchMock = vi.fn(async () => respond(409, { error: 'exists', message: 'exists' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createRecipe({ name: 'demo', description: 'd', target: 'codex' });
    expect(result).toEqual({
      ok: false,
      field: 'name',
      message: 'A recipe with this name already exists.',
    });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'demo',
      description: 'd',
      target: 'codex',
      layout: 'grouped',
      contexts: [],
      items: [],
    });
  });

  it('loadRecipe: 404 is not-found, 200 adopts and starts a render', async () => {
    $baseline.set(null);
    $working.set(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(404, { error: 'not-found', message: 'no' })),
    );
    await loadRecipe('nope');
    expect($recipeLoad.get().status).toBe('not-found');

    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith('/api/recipe/')
        ? respond(200, { recipe: base, lastModified: 'now' })
        : respond(200, { markdown: '# demo\n', manifest: { bytes: 7, segments: [] } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await loadRecipe('demo');
    expect($recipeLoad.get().status).toBe('ready');
    expect($working.get()?.name).toBe('demo');
    await vi.waitFor(() => expect($render.get().status).toBe('ready'));
    expect($render.get().result?.markdown).toBe('# demo\n');
    // same recipe again: no second GET
    const calls = fetchMock.mock.calls.length;
    await loadRecipe('demo');
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('renderNow keeps the previous result on error and drops responses of older requests', async () => {
    const result = {
      markdown: '# one\n',
      manifest: { bytes: 6, segments: [{ key: 'kb/one', bytes: 4 }] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(200, result)),
    );
    await renderNow();
    expect($render.get().status).toBe('ready');
    expect($segmentBytes.get().get('kb/one')).toBe(4);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond(400, {
          error: 'invalid',
          message: 'recipe is invalid',
          issues: [{ path: 'name', message: 'x' }],
        }),
      ),
    );
    await renderNow();
    const failed = $render.get();
    expect(failed.status).toBe('error');
    expect(failed.message).toBe('recipe is invalid; name: x');
    expect(failed.result?.markdown).toBe('# one\n');

    let release: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockReturnValueOnce(slow)
      .mockResolvedValueOnce(
        respond(200, { markdown: '# newer\n', manifest: { bytes: 8, segments: [] } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const first = renderNow();
    await renderNow();
    release(respond(200, { markdown: '# older\n', manifest: { bytes: 8, segments: [] } }));
    await first;
    expect($render.get().result?.markdown).toBe('# newer\n');
  });

  it('writeOutput posts the working recipe and the path, and reports success and failure', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      respond(200, { path: '/tmp/x/brief.md', bytes: 42, manifest: {} }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await writeOutput('/tmp/x/brief.md');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).path).toBe('/tmp/x/brief.md');
    expect(JSON.parse(String(init.body)).recipe.name).toBe('demo');
    expect($writeStatus.get()).toEqual({ kind: 'written', path: '/tmp/x/brief.md', bytes: 42 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(400, { error: 'bad-path', message: 'path must be absolute' })),
    );
    await writeOutput('x.md');
    expect($writeStatus.get()).toEqual({ kind: 'error', message: 'path must be absolute' });
  });
});

describe('format helpers', () => {
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('formatDuration: ms, seconds with one decimal, minutes and seconds', () => {
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(3456)).toBe('3.5 s');
    expect(formatDuration(59_949)).toBe('59.9 s');
    expect(formatDuration(60_000)).toBe('1 min 0 s');
    expect(formatDuration(125_400)).toBe('2 min 5 s');
    expect(formatDuration(119_600)).toBe('2 min 0 s');
  });

  it('recipeNameProblem: entry-name rule, reserved "new", uniqueness', () => {
    expect(recipeNameProblem('')).toBe('Required');
    expect(recipeNameProblem('Bad Name')).toContain('lowercase');
    expect(recipeNameProblem('new')).toBe('"new" is reserved');
    expect(recipeNameProblem('taken', new Set(['taken']))).toBe(
      'A recipe with this name already exists',
    );
    expect(recipeNameProblem('fresh', new Set(['taken']))).toBeNull();
  });
});

describe('"Add items" tabs', () => {
  let unbind: () => void = () => {};
  beforeEach(() => {
    vi.stubGlobal('location', { pathname: '/inflate', search: '?recipe=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('fetch', () => new Promise<Response>(() => {})); // loads that were not seeded never answer
    const map: Partial<Record<DatasetId, EntriesState>> = {};
    for (const ds of LINKABLE_DATASETS) map[ds] = ready();
    map.kb = ready(
      summary('kb', 'k1', { lastModified: '2026-01-02T00:00:00.000Z' }),
      summary('kb', 'k2', { lastModified: '2026-01-01T00:00:00.000Z' }),
    );
    map.task = ready(
      summary('task', 't1', {
        lastModified: '2026-01-03T00:00:00.000Z',
        invalid: [{ path: 'state', message: 'bad state' }],
      }),
    );
    $entries.set(map);
    unbind = $adhoc.listen(() => {});
    $inflateUrl.set({
      recipe: 'demo',
      view: 'compose',
      dataset: 'kb',
      q: '',
      job: null,
      paths: 'relative',
    });
  });
  afterEach(() => {
    unbind();
    cleanStores($inflateUrl);
  });

  it('a dataset tab lists that dataset, filtered by q', () => {
    expect($adhoc.get().items.map((e) => e.slug)).toEqual(['k1', 'k2']);
    $inflateUrl.setKey('q', 'k2');
    const view = $adhoc.get();
    expect(view.items.map((e) => e.slug)).toEqual(['k2']);
    expect(view.matched).toBe(1);
    expect(view.total).toBe(2);
  });

  it('the All tab merges every linkable dataset (newest first) and filters across them', () => {
    $inflateUrl.setKey('dataset', 'all');
    let view = $adhoc.get();
    expect(view.status).toBe('ready');
    expect(view.items.map((e) => `${e.dataset}/${e.slug}`)).toEqual(['task/t1', 'kb/k1', 'kb/k2']);
    expect(view.total).toBe(3);
    expect(view.items[0]?.invalid).toEqual([{ path: 'state', message: 'bad state' }]);
    $inflateUrl.setKey('q', 'description');
    expect($adhoc.get().matched).toBe(3);
    $inflateUrl.setKey('q', 't1');
    view = $adhoc.get();
    expect(view.items.map((e) => e.slug)).toEqual(['t1']);
  });

  it('the All tab is loading until every dataset answered; a failed one is named', () => {
    $inflateUrl.setKey('dataset', 'all');
    $entries.setKey('bug', { status: 'loading', entries: [] });
    expect($adhoc.get().status).toBe('loading');
    expect($adhoc.get().items).toHaveLength(3);
    $entries.setKey('bug', { status: 'error', entries: [], error: 'HTTP 500' });
    expect($adhoc.get().status).toBe('error');
    expect($adhoc.get().error).toContain('bug');
  });

  it('setDataset(all) pushes dataset=all and keeps the other params; a dataset tab drops it again', () => {
    setDataset('all');
    expect($inflateUrl.get().dataset).toBe('all');
    const pushed = (
      history.pushState as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls.map((c) => String(c[2]));
    expect(pushed).toEqual(['/inflate?recipe=demo&dataset=all']);
    setDataset('kb'); // the default: not written
    expect(
      (history.pushState as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)?.[2],
    ).toBe('/inflate?recipe=demo');
  });
});

describe('drafts (localStorage) and the missing beforeunload prompt', () => {
  type Inflate = typeof import('../../src/stores/inflate.ts');
  const KEY = 'ctxman:draft:inflate:demo';
  const json = (status: number, body?: unknown): Response =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  let store: Map<string, string>;
  let listeners: string[];
  let inflate: Inflate;
  let putBodies: RecipeData[];
  let disk: { recipe: RecipeData; lastModified: string };

  /** A draft as draft-backup stores it. */
  const stored = (working: unknown, base: string, savedAt = Date.now()): string =>
    JSON.stringify({ text: JSON.stringify(working), base, savedAt });

  beforeEach(async () => {
    store = new Map();
    listeners = [];
    putBodies = [];
    disk = { recipe: structuredClone(base), lastModified: 'T1' };
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('location', { pathname: '/inflate', search: '?recipe=demo', hash: '' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    vi.stubGlobal('window', {
      addEventListener: (type: string) => void listeners.push(type),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('/api/entries')) return json(200, { entries: [] });
        if (url.startsWith('/api/context/'))
          return json(404, { error: 'not-found', message: 'no' });
        if (url.startsWith('/api/inflate/render')) {
          return json(200, { markdown: '# demo\n', manifest: { bytes: 7, segments: [] } });
        }
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body)) as RecipeData;
          putBodies.push(body);
          disk = { recipe: body, lastModified: 'T2' };
          return json(200, disk);
        }
        if (init?.method === 'DELETE') return new Response(null, { status: 204 });
        return json(200, disk);
      }),
    );
    vi.resetModules();
    inflate = await import('../../src/stores/inflate.ts');
  });

  afterEach(() => {
    inflate.$working.set(null); // stops the debounced render of the discarded module instance
    cleanStores(inflate.$inflateUrl);
  });

  /** Mount the URL store (as the island does) and wait for the recipe to load. */
  async function mount(): Promise<void> {
    inflate.$inflateUrl.listen(() => {});
    await vi.waitFor(() => expect(inflate.$recipeLoad.get().status).toBe('ready'));
  }

  it('registers no beforeunload listener (only popstate and keydown)', async () => {
    await mount();
    expect(listeners.sort()).toEqual(['keydown', 'popstate']);
  });

  it('saves the working copy on every change and clears it once the copy is clean again', async () => {
    await mount();
    expect(store.size).toBe(0);
    inflate.setDescription('Changed');
    const draft = JSON.parse(store.get(KEY) ?? 'null') as { text: string; base: string };
    expect(draft.base).toBe('T1');
    expect(JSON.parse(draft.text).description).toBe('Changed');
    inflate.setDescription(base.description);
    expect(store.has(KEY)).toBe(false);
  });

  it('restores a fresh draft after a reload: working copy, dirty, banner not stale', async () => {
    store.set(
      KEY,
      stored({ ...base, description: 'Edited before the reload', layout: 'flat' }, 'T1'),
    );
    await mount();
    expect(inflate.$working.get()?.description).toBe('Edited before the reload');
    expect(inflate.$working.get()?.layout).toBe('flat');
    expect(inflate.$baseline.get()?.description).toBe('Demo recipe');
    expect(inflate.$dirty.get()).toBe(true);
    expect(inflate.$draftRestored.get()).toEqual({ stale: false });
    expect(store.has(KEY)).toBe(true);
  });

  it('restores a draft whose file changed on disk with the stale warning, and keeps its base', async () => {
    store.set(KEY, stored({ ...base, description: 'Old edit' }, 'T0'));
    await mount();
    expect(inflate.$working.get()?.description).toBe('Old edit');
    expect(inflate.$draftRestored.get()).toEqual({ stale: true });
    inflate.setDescription('Old edit, continued');
    expect(JSON.parse(store.get(KEY) ?? '{}').base).toBe('T0');
  });

  it.each([
    ['not JSON', 'this is not json {'],
    ['a wrong shape', JSON.stringify({ name: 'demo', description: 'd', target: 'nope' })],
    ['another recipe name', JSON.stringify({ ...base, name: 'other' })],
    ['a copy equal to the saved recipe', JSON.stringify(base)],
  ])('drops a draft that is %s', async (_label, text) => {
    store.set(KEY, JSON.stringify({ text, base: 'T1', savedAt: Date.now() }));
    await mount();
    expect(inflate.$working.get()).toEqual(base);
    expect(inflate.$draftRestored.get()).toBeNull();
    expect(inflate.$dirty.get()).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it('drops a draft older than 14 days', async () => {
    store.set(KEY, stored({ ...base, description: 'Ancient' }, 'T1', Date.now() - 15 * 86_400_000));
    await mount();
    expect(inflate.$working.get()?.description).toBe('Demo recipe');
    expect(store.has(KEY)).toBe(false);
  });

  it('revert (the banner Discard) clears the draft and hides the banner', async () => {
    store.set(KEY, stored({ ...base, description: 'Edited' }, 'T1'));
    await mount();
    inflate.revert();
    expect(inflate.$working.get()).toEqual(base);
    expect(inflate.$draftRestored.get()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('save clears the draft and adopts the new lastModified as the base of later edits', async () => {
    store.set(KEY, stored({ ...base, description: 'Edited' }, 'T0'));
    await mount();
    await inflate.save();
    expect(putBodies).toHaveLength(1);
    expect(inflate.$baselineModified.get()).toBe('T2');
    expect(inflate.$draftRestored.get()).toBeNull();
    expect(inflate.$dirty.get()).toBe(false);
    expect(store.has(KEY)).toBe(false);
    inflate.setDescription('Next edit');
    expect(JSON.parse(store.get(KEY) ?? '{}').base).toBe('T2');
  });

  it('deleting the recipe clears its draft', async () => {
    store.set(KEY, stored({ ...base, description: 'Edited' }, 'T1'));
    await mount();
    await inflate.deleteRecipe();
    expect(store.has(KEY)).toBe(false);
    expect(inflate.$working.get()).toBeNull();
    expect(inflate.$draftRestored.get()).toBeNull();
  });

  it('a freshly created recipe never restores a draft of the same name', async () => {
    await mount();
    store.set(KEY, stored({ ...base, description: 'Left over' }, 'T1'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(201, { recipe: base, lastModified: 'T3' })),
    );
    const result = await inflate.createRecipe({
      name: 'demo',
      description: 'Demo recipe',
      target: 'claude-code',
    });
    expect(result.ok).toBe(true);
    expect(inflate.$working.get()).toEqual(base);
    expect(inflate.$draftRestored.get()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });
});
