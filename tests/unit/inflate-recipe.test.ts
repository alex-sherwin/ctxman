import { describe, expect, it } from 'vitest';
import { recipeSchema } from '../../src/datasets/schemas.ts';
import type { RecipeData } from '../../src/datasets/schemas.ts';
import {
  normalizeText,
  parseRecipe,
  recipeToYamlObject,
  sameRecipe,
  serializeRecipe,
} from '../../src/lib/inflate/recipe.ts';
import { parseYaml } from '../../src/lib/yaml.ts';

const base = { name: 'r', description: 'd' };

function parse(input: Record<string, unknown>): RecipeData {
  const result = parseRecipe({ ...base, ...input });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.recipe;
}

/** `[path, message]` pairs of every issue for an invalid recipe. */
function issues(input: Record<string, unknown>): [string, string][] {
  const result = parseRecipe({ ...base, ...input });
  if (result.ok) throw new Error('expected an invalid recipe');
  return result.issues.map((i) => [i.path, i.message]);
}

describe('recipeSchema defaults', () => {
  it('fills every default', () => {
    expect(recipeSchema.parse(base)).toEqual({
      name: 'r',
      description: 'd',
      tags: [],
      target: 'claude-code',
      layout: 'grouped',
      contexts: [],
      items: [],
      markdown: [],
      overrides: [],
      order: [],
      defaults: {},
    });
  });

  it('is strict: unknown keys are rejected at every level', () => {
    expect(recipeSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(
      recipeSchema.safeParse({ ...base, items: [{ dataset: 'kb', slug: 'a', x: 1 }] }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...base, overrides: [{ key: 'kb/a', options: { nope: true } }] })
        .success,
    ).toBe(false);
  });

  it('rejects bad names, blank descriptions, unknown targets and layouts', () => {
    expect(parseRecipe({ ...base, name: 'Not Kebab' }).ok).toBe(false);
    expect(parseRecipe({ ...base, description: '  ' }).ok).toBe(false);
    expect(parseRecipe({ ...base, target: 'vim' }).ok).toBe(false);
    expect(parseRecipe({ ...base, layout: 'tree' }).ok).toBe(false);
  });

  it('items may only name linkable datasets', () => {
    expect(parseRecipe({ ...base, items: [{ dataset: 'context', slug: 'a' }] }).ok).toBe(false);
    expect(parseRecipe({ ...base, items: [{ dataset: 'recipe', slug: 'a' }] }).ok).toBe(false);
    expect(parseRecipe({ ...base, items: [{ dataset: 'reference', slug: 'a' }] }).ok).toBe(true);
  });

  it('option values: treeLimit 1..500 integer, cloneDir a safe relative dir', () => {
    const opt = (options: Record<string, unknown>) =>
      parseRecipe({ ...base, defaults: { 'remote-repo': { options } } }).ok;
    expect(opt({ treeLimit: 500 })).toBe(true);
    expect(opt({ treeLimit: 0 })).toBe(false);
    expect(opt({ treeLimit: 501 })).toBe(false);
    expect(opt({ treeLimit: 1.5 })).toBe(false);
    expect(opt({ cloneDir: '.ctxman/refs/{name}' })).toBe(true);
    expect(opt({ cloneDir: '../x' })).toBe(false);
    expect(opt({ cloneDir: '/abs' })).toBe(false);
    expect(opt({ cloneDir: '' })).toBe(false);
  });
});

describe('recipeSchema superRefine (spec 3.2 table)', () => {
  it('duplicate context', () => {
    expect(issues({ contexts: ['a', 'b', 'a'] })).toEqual([['contexts.2', 'duplicate context a']]);
  });

  it('duplicate item', () => {
    expect(
      issues({
        items: [
          { dataset: 'kb', slug: 'a' },
          { dataset: 'task', slug: 'a' },
          { dataset: 'kb', slug: 'a' },
        ],
      }),
    ).toEqual([['items.2', 'duplicate item kb/a']]);
  });

  it('duplicate markdown block id', () => {
    expect(
      issues({
        markdown: [
          { id: 'b1', body: '' },
          { id: 'b1', body: 'x' },
        ],
      }),
    ).toEqual([['markdown.1.id', 'duplicate markdown block id b1']]);
  });

  it('duplicate override key', () => {
    expect(
      issues({
        overrides: [
          { key: 'kb/a', exclude: true },
          { key: 'kb/a', mode: 'summary' },
        ],
      }),
    ).toEqual([['overrides.1.key', 'duplicate override kb/a']]);
  });

  it('duplicate order key', () => {
    expect(issues({ order: ['kb/a', 'md:b1', 'kb/a'] })).toEqual([
      ['order.2', 'duplicate order key kb/a'],
    ]);
  });

  it('defaults: a mode must apply to the kind', () => {
    expect(issues({ defaults: { kb: { mode: 'install' } } })).toEqual([
      ['defaults.kb.mode', 'mode "install" does not apply to Knowledge Base items'],
    ]);
    expect(issues({ defaults: { 'local-repo': { mode: 'clone' } } })).toEqual([
      ['defaults.local-repo.mode', 'mode "clone" does not apply to Local repo items'],
    ]);
    expect(parseRecipe({ ...base, defaults: { skill: { mode: 'pointer' } } }).ok).toBe(true);
    expect(parseRecipe({ ...base, defaults: { 'remote-skill': { mode: 'describe' } } }).ok).toBe(
      true,
    );
  });

  it('defaults: an unknown kind is rejected (partialRecord)', () => {
    const result = recipeSchema.safeParse({
      ...base,
      defaults: { reference: { mode: 'describe' } },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
    expect(recipeSchema.safeParse({ ...base, defaults: {} }).success).toBe(true);
    expect(
      recipeSchema.safeParse({ ...base, defaults: { kb: {}, task: { mode: 'pointer' } } }).success,
    ).toBe(true);
  });

  it('overrides: a mode must apply to the key dataset', () => {
    expect(issues({ overrides: [{ key: 'kb/a', mode: 'install' }] })).toEqual([
      ['overrides.0.mode', 'mode "install" does not apply to kb/a'],
    ]);
    expect(issues({ overrides: [{ key: 'skill/a', mode: 'summary' }] })).toEqual([
      ['overrides.0.mode', 'mode "summary" does not apply to skill/a'],
    ]);
    expect(parseRecipe({ ...base, overrides: [{ key: 'skill/a', mode: 'install' }] }).ok).toBe(
      true,
    );
    expect(parseRecipe({ ...base, overrides: [{ key: 'kb/a', mode: 'inline-bundle' }] }).ok).toBe(
      true,
    );
  });

  it('overrides: a reference key accepts any reference mode, nothing else', () => {
    for (const mode of ['describe', 'tree', 'clone', 'install']) {
      expect(parseRecipe({ ...base, overrides: [{ key: 'reference/r', mode }] }).ok, mode).toBe(
        true,
      );
    }
    expect(issues({ overrides: [{ key: 'reference/r', mode: 'summary' }] })).toEqual([
      ['overrides.0.mode', 'mode "summary" does not apply to reference/r'],
    ]);
  });

  it('override keys and order keys must match their patterns', () => {
    expect(parseRecipe({ ...base, overrides: [{ key: 'context/x' }] }).ok).toBe(false);
    expect(parseRecipe({ ...base, overrides: [{ key: 'kb' }] }).ok).toBe(false);
    expect(parseRecipe({ ...base, order: ['nope'] }).ok).toBe(false);
    expect(parseRecipe({ ...base, order: ['sec:extra', 'md:b1', 'ctx:c', 'kb/a'] }).ok).toBe(true);
  });

  it('markdown block ids are kebab-case', () => {
    expect(parseRecipe({ ...base, markdown: [{ id: 'B1', body: '' }] }).ok).toBe(false);
    expect(parseRecipe({ ...base, markdown: [{ id: 'b1', body: '' }] }).ok).toBe(true);
  });
});

describe('parseRecipe', () => {
  it('returns issue paths and "Required" for missing fields', () => {
    const r = parseRecipe({});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid');
      expect(r.issues).toContainEqual({ path: 'name', message: 'Required' });
      expect(r.issues).toContainEqual({ path: 'description', message: 'Required' });
    }
  });

  it('name-mismatch only when an expected name is given', () => {
    expect(parseRecipe(base).ok).toBe(true);
    expect(parseRecipe(base, 'r').ok).toBe(true);
    expect(parseRecipe(base, 'other')).toEqual({
      ok: false,
      code: 'name-mismatch',
      issues: [
        { path: 'name', message: 'name must equal "other" (recipe names cannot be changed)' },
      ],
    });
  });

  it('invalid input of any type is an invalid result, not a throw', () => {
    for (const bad of [null, undefined, 'x', 3, []]) {
      expect(parseRecipe(bad)).toMatchObject({ ok: false, code: 'invalid' });
    }
  });
});

describe('normalizeText', () => {
  it('CRLF -> LF, trailing whitespace trimmed, one final newline, blank -> empty', () => {
    expect(normalizeText('a\r\nb\r\n\r\n')).toBe('a\nb\n');
    expect(normalizeText('a')).toBe('a\n');
    expect(normalizeText('  \n\n')).toBe('');
    expect(normalizeText('')).toBe('');
    expect(normalizeText('  lead\nx   ')).toBe('  lead\nx\n');
  });
});

describe('recipeToYamlObject / serializeRecipe', () => {
  const full = parse({
    tags: ['x', 'y'],
    target: 'codex',
    layout: 'flat',
    preamble: 'Pre.\r\n\r\n',
    contexts: ['c1', 'c2'],
    items: [{ dataset: 'kb', slug: 'a' }],
    markdown: [{ id: 'b1', body: 'Body\n\n\n' }],
    overrides: [
      {
        key: 'kb/a',
        exclude: true,
        options: { sparse: true, includeLog: true, shiftHeadings: undefined },
        mode: 'inline-bundle',
      },
    ],
    order: ['md:b1', 'ctx:c1'],
    defaults: {
      task: { options: { eager: true }, mode: 'pointer' },
      kb: { mode: 'summary' },
    },
  });

  it('uses the fixed key order', () => {
    expect(Object.keys(recipeToYamlObject(full))).toEqual([
      'name',
      'description',
      'tags',
      'target',
      'layout',
      'preamble',
      'contexts',
      'items',
      'markdown',
      'overrides',
      'order',
      'defaults',
    ]);
    expect(recipeToYamlObject(full).preamble).toBe('Pre.\n');
    expect(recipeToYamlObject(full).markdown).toEqual([{ id: 'b1', body: 'Body\n' }]);
  });

  it('orders override keys (key, mode, options, exclude) and options by OPTION_IDS', () => {
    const [override] = recipeToYamlObject(full).overrides as Record<string, unknown>[];
    expect(Object.keys(override ?? {})).toEqual(['key', 'mode', 'options', 'exclude']);
    expect(Object.keys((override?.options as object) ?? {})).toEqual(['includeLog', 'sparse']);
  });

  it('orders defaults by ITEM_KINDS, each { mode, options }', () => {
    const defaults = recipeToYamlObject(full).defaults as Record<string, Record<string, unknown>>;
    expect(Object.keys(defaults)).toEqual(['kb', 'task']);
    expect(Object.keys(defaults.task ?? {})).toEqual(['mode', 'options']);
  });

  it('omits empty optional parts but always writes contexts and items', () => {
    const minimal = recipeToYamlObject(parse({}));
    expect(Object.keys(minimal)).toEqual([
      'name',
      'description',
      'target',
      'layout',
      'contexts',
      'items',
    ]);
    expect(serializeRecipe(parse({}))).toBe(
      'name: r\ndescription: d\ntarget: claude-code\nlayout: grouped\ncontexts: []\nitems: []\n',
    );
  });

  it('drops no-op overrides and empty default kinds', () => {
    const r = parse({
      preamble: '  \n',
      overrides: [
        { key: 'kb/a' },
        { key: 'kb/b', options: {} },
        { key: 'kb/c', exclude: false },
        { key: 'kb/d', exclude: true },
        { key: 'kb/e', options: { treeLimit: 10 } },
      ],
      defaults: { kb: {}, task: { options: {} }, bug: { mode: 'pointer' } },
    });
    const out = recipeToYamlObject(r);
    expect(out.preamble).toBeUndefined();
    expect(out.overrides).toEqual([
      { key: 'kb/d', exclude: true },
      { key: 'kb/e', options: { treeLimit: 10 } },
    ]);
    expect(out.defaults).toEqual({ bug: { mode: 'pointer' } });
    expect(recipeToYamlObject(parse({ defaults: { kb: {} } })).defaults).toBeUndefined();
  });

  it('writes the preamble and markdown bodies as literal blocks', () => {
    const text = serializeRecipe(
      parse({ preamble: 'Line 1\n\nLine 2', markdown: [{ id: 'b1', body: '# H\n\n- a: b # c' }] }),
    );
    expect(text).toContain('preamble: |\n  Line 1\n\n  Line 2\n');
    expect(text).toContain('markdown:\n  - id: b1\n    body: |\n      # H\n\n      - a: b # c\n');
  });

  it('round-trips: serializeRecipe(parse(serializeRecipe(r))) is stable', () => {
    const once = serializeRecipe(full);
    const reparsed = parseRecipe(parseYaml(once), 'r');
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(serializeRecipe(reparsed.recipe)).toBe(once);
      expect(sameRecipe(full, reparsed.recipe)).toBe(true);
    }
  });
});

describe('sameRecipe', () => {
  it('null === null only', () => {
    expect(sameRecipe(null, null)).toBe(true);
    expect(sameRecipe(parse({}), null)).toBe(false);
    expect(sameRecipe(null, parse({}))).toBe(false);
  });

  it('ignores CRLF, trailing whitespace, no-op overrides and key order of options', () => {
    const a = parse({
      preamble: 'one\ntwo\n',
      markdown: [{ id: 'b1', body: 'x\n' }],
      overrides: [
        { key: 'kb/a', options: { sparse: true, includeLog: true }, mode: 'inline-bundle' },
      ],
    });
    const b = parse({
      preamble: 'one\r\ntwo   \r\n\r\n',
      markdown: [{ id: 'b1', body: 'x  \n\n' }],
      overrides: [
        { key: 'kb/zzz' },
        { key: 'kb/a', mode: 'inline-bundle', options: { includeLog: true, sparse: true } },
      ],
    });
    expect(sameRecipe(a, { ...b, overrides: b.overrides.slice(1) })).toBe(true);
    // a no-op override alone does not count as a difference either
    expect(sameRecipe(parse({}), parse({ overrides: [{ key: 'kb/zzz' }] }))).toBe(true);
  });

  it('detects real differences', () => {
    const a = parse({ preamble: 'one' });
    expect(sameRecipe(a, parse({ preamble: 'two' }))).toBe(false);
    expect(sameRecipe(a, parse({ preamble: 'one', description: 'other' }))).toBe(false);
    expect(sameRecipe(parse({ contexts: ['a', 'b'] }), parse({ contexts: ['b', 'a'] }))).toBe(
      false,
    );
    expect(sameRecipe(parse({}), parse({ target: 'codex' }))).toBe(false);
    expect(sameRecipe(parse({}), parse({ order: ['md:b1'] }))).toBe(false);
  });
});
