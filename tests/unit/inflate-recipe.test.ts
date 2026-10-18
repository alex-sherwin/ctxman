import { describe, expect, it } from 'vitest';
import { recipeSchema, runOverridesSchema } from '../../src/datasets/schemas.ts';
import type { InflateRunOverridesInput, RecipeData } from '../../src/datasets/schemas.ts';
import {
  applyRunOverrides,
  normalizeText,
  parseRecipe,
  parseRunRequest,
  recipeToYamlObject,
  runOverrideCount,
  sameRecipe,
  serializeRecipe,
} from '../../src/lib/inflate/recipe.ts';
import { withSchemaComment } from '../../src/lib/schema-comment.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { SEED_RECIPE_YAML } from './fixtures/seed-recipe.ts';
import { assertValid, validate } from '../../src/datasets/validate.ts';
import { dataOf, issuesOf } from './fixtures/validation.ts';

const ORIGIN = 'http://127.0.0.1:4321';

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
    expect(assertValid(recipeSchema, base)).toEqual({
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
    expect(validate(recipeSchema, { ...base, extra: 1 }).success).toBe(false);
    expect(
      validate(recipeSchema, { ...base, items: [{ dataset: 'kb', slug: 'a', x: 1 }] }).success,
    ).toBe(false);
    expect(
      validate(recipeSchema, { ...base, overrides: [{ key: 'kb/a', options: { nope: true } }] })
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
    const result = validate(recipeSchema, {
      ...base,
      defaults: { reference: { mode: 'describe' } },
    });
    expect(result.success).toBe(false);
    expect(issuesOf(result)[0]?.kind).toBe('unknown-key');
    expect(validate(recipeSchema, { ...base, defaults: {} }).success).toBe(true);
    expect(
      validate(recipeSchema, { ...base, defaults: { kb: {}, task: { mode: 'pointer' } } }).success,
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

describe('recipeSchema: output and material (plans/INFLATE_V2_SPEC.md §4.1)', () => {
  it('output is optional; contextFile defaults to LLM_CONTEXT.md inside it', () => {
    expect(assertValid(recipeSchema, base).output).toBeUndefined();
    expect(assertValid(recipeSchema, { ...base, output: {} }).output).toEqual({
      contextFile: 'LLM_CONTEXT.md',
    });
    expect(
      assertValid(recipeSchema, {
        ...base,
        output: {
          dir: '  ~/ctxman-inflate/r  ',
          contextFile: 'CONTEXT.md',
          primary: 'reference/app',
          allowNonEmpty: true,
          stubs: { gitignore: false },
        },
      }).output,
    ).toEqual({
      dir: '~/ctxman-inflate/r',
      contextFile: 'CONTEXT.md',
      primary: 'reference/app',
      allowNonEmpty: true,
      stubs: { gitignore: false },
    });
  });

  it('output is strict and validated', () => {
    expect(issues({ output: { dir: '' } })).toEqual([['output.dir', expect.any(String)]]);
    expect(issues({ output: { dir: '   ' } })).toEqual([['output.dir', expect.any(String)]]);
    expect(issues({ output: { dir: 'x'.repeat(1025) } })).toEqual([
      ['output.dir', expect.any(String)],
    ]);
    expect(parseRecipe({ ...base, output: { dir: 'x'.repeat(1024) } }).ok).toBe(true);
    expect(issues({ output: { contextFile: 'a/b.md' } })).toEqual([
      [
        'output.contextFile',
        'must be a file name ending in .md (letters, digits, . _ -; no folders) (was "a/b.md")',
      ],
    ]);
    expect(parseRecipe({ ...base, output: { contextFile: 'notes.txt' } }).ok).toBe(false);
    expect(issues({ output: { primary: 'kb/x' } })).toEqual([
      ['output.primary', 'must be reference/<slug> (was "kb/x")'],
    ]);
    expect(parseRecipe({ ...base, output: { primary: 'reference/Bad' } }).ok).toBe(false);
    expect(parseRecipe({ ...base, output: { extra: 1 } }).ok).toBe(false);
    expect(parseRecipe({ ...base, output: { stubs: { claudeMd: 'yes' } } }).ok).toBe(false);
    expect(parseRecipe({ ...base, output: { stubs: { other: true } } }).ok).toBe(false);
    expect(parseRecipe({ ...base, output: { allowNonEmpty: 1 } }).ok).toBe(false);
    // reachability of the primary is a check warning, not a schema rule
    expect(parseRecipe({ ...base, output: { primary: 'reference/not-in-recipe' } }).ok).toBe(true);
  });

  it('materialOptions: cloneDepth 0..100000 integer, branch a safe git ref, subpathOnly boolean', () => {
    const o = (materialOptions: unknown) => [
      { key: 'reference/r', material: 'clone', materialOptions },
    ];
    expect(
      parseRecipe({ ...base, overrides: o({ cloneDepth: 0, branch: '', subpathOnly: true }) }).ok,
    ).toBe(true);
    expect(
      parseRecipe({ ...base, overrides: o({ cloneDepth: 100000, branch: 'release/1.2' }) }).ok,
    ).toBe(true);
    for (const bad of [
      { cloneDepth: -1 },
      { cloneDepth: 100001 },
      { cloneDepth: 1.5 },
      { cloneDepth: '1' },
      { branch: '-x' },
      { branch: 'a..b' },
      { branch: 'a b' },
      { branch: 'x'.repeat(201) },
      { subpathOnly: 'yes' },
      { other: true },
    ]) {
      expect(parseRecipe({ ...base, overrides: o(bad) }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(issues({ overrides: o({ branch: '-x' }) })).toEqual([
      [
        'overrides.0.materialOptions.branch',
        'must be a branch or tag name (letters, digits, . _ - /; no "..", no leading "-") (was "-x")',
      ],
    ]);
    expect(
      parseRecipe({ ...base, defaults: { 'remote-repo': { materialOptions: { cloneDepth: 10 } } } })
        .ok,
    ).toBe(true);
  });

  it('defaults: a material must apply to the kind', () => {
    expect(issues({ defaults: { kb: { material: 'clone' } } })).toEqual([
      ['defaults.kb.material', 'material "clone" does not apply to Knowledge Base items'],
    ]);
    expect(issues({ defaults: { 'local-repo': { material: 'clone' } } })).toEqual([
      ['defaults.local-repo.material', 'material "clone" does not apply to Local repo items'],
    ]);
    expect(issues({ defaults: { skill: { material: 'clone' } } })).toEqual([
      ['defaults.skill.material', 'material "clone" does not apply to Skill items'],
    ]);
    expect(issues({ defaults: { 'remote-repo': { material: 'copy' } } })).toEqual([
      ['defaults.remote-repo.material', 'material "copy" does not apply to Remote repo items'],
    ]);
    // v3: a skill may be symlinked, a local repository copied
    expect(parseRecipe({ ...base, defaults: { skill: { material: 'symlink' } } }).ok).toBe(true);
    expect(parseRecipe({ ...base, defaults: { 'local-repo': { material: 'copy' } } }).ok).toBe(
      true,
    );
    expect(parseRecipe({ ...base, defaults: { kb: { material: 'copy' } } }).ok).toBe(true);
    expect(parseRecipe({ ...base, defaults: { skill: { material: 'none' } } }).ok).toBe(true);
    expect(parseRecipe({ ...base, defaults: { 'remote-repo': { material: 'clone' } } }).ok).toBe(
      true,
    );
    expect(parseRecipe({ ...base, defaults: { kb: { material: 'bogus' } } }).ok).toBe(false);
  });

  it('overrides: a material must apply to the key dataset', () => {
    expect(issues({ overrides: [{ key: 'kb/a', material: 'clone' }] })).toEqual([
      ['overrides.0.material', 'material "clone" does not apply to kb/a'],
    ]);
    expect(issues({ overrides: [{ key: 'skill/a', material: 'clone' }] })).toEqual([
      ['overrides.0.material', 'material "clone" does not apply to skill/a'],
    ]);
    expect(parseRecipe({ ...base, overrides: [{ key: 'skill/a', material: 'copy' }] }).ok).toBe(
      true,
    );
    expect(parseRecipe({ ...base, overrides: [{ key: 'skill/a', material: 'symlink' }] }).ok).toBe(
      true,
    );
    expect(parseRecipe({ ...base, overrides: [{ key: 'kb/a', material: 'copy' }] }).ok).toBe(true);
    expect(parseRecipe({ ...base, overrides: [{ key: 'kb/a', material: 'none' }] }).ok).toBe(true);
  });

  it('overrides: edit is a boolean and only applies to reference/<slug> keys', () => {
    expect(parseRecipe({ ...base, overrides: [{ key: 'reference/r', edit: true }] }).ok).toBe(true);
    expect(parseRecipe({ ...base, overrides: [{ key: 'reference/r', edit: false }] }).ok).toBe(
      true,
    );
    expect(issues({ overrides: [{ key: 'kb/a', edit: true }] })).toEqual([
      ['overrides.0.edit', 'edit applies to repositories only (a reference/<slug> key)'],
    ]);
    expect(issues({ overrides: [{ key: 'skill/a', edit: false }] }).map(([p]) => p)).toEqual([
      'overrides.0.edit',
    ]);
    // not a boolean: a structural issue (the narrow does not run)
    expect(parseRecipe({ ...base, overrides: [{ key: 'reference/r', edit: 'yes' }] }).ok).toBe(
      false,
    );
    // an override that only says edit is not stale or empty for the schema
    expect(parse({ overrides: [{ key: 'reference/r', edit: true }] }).overrides).toEqual([
      { key: 'reference/r', edit: true },
    ]);
  });

  it('overrides: a reference key accepts none, symlink, copy, clone, install; nothing else', () => {
    for (const material of ['none', 'symlink', 'copy', 'clone', 'install']) {
      expect(
        parseRecipe({ ...base, overrides: [{ key: 'reference/r', material }] }).ok,
        material,
      ).toBe(true);
    }
    expect(parseRecipe({ ...base, overrides: [{ key: 'reference/r', material: 'x' }] }).ok).toBe(
      false,
    );
    // mode and material are validated independently
    expect(
      issues({ overrides: [{ key: 'kb/a', mode: 'install', material: 'clone' }] }).map(([p]) => p),
    ).toEqual(['overrides.0.mode', 'overrides.0.material']);
  });
});

describe('serializeRecipe: output and material (plans/INFLATE_V2_SPEC.md §4.2)', () => {
  const demo = parse({
    name: 'demo',
    description: 'd',
    output: {
      dir: '~/ctxman-inflate/demo',
      contextFile: 'CONTEXT.md',
      primary: 'reference/app',
      allowNonEmpty: true,
      stubs: { gitignore: false },
    },
    overrides: [
      {
        key: 'reference/app',
        exclude: true,
        edit: true,
        materialOptions: { branch: 'trunk', cloneDepth: 0, subpathOnly: undefined },
        material: 'clone',
        options: { sparse: true },
        mode: 'describe',
      },
    ],
    defaults: {
      kb: { materialOptions: {}, material: 'copy', mode: 'summary' },
    },
  });

  it('writes the exact YAML of the spec example', () => {
    expect(serializeRecipe(demo)).toBe(`name: demo
description: d
target: claude-code
layout: grouped
output:
  dir: ~/ctxman-inflate/demo
  contextFile: CONTEXT.md
  primary: reference/app
  allowNonEmpty: true
  stubs:
    gitignore: false
contexts: []
items: []
overrides:
  - key: reference/app
    mode: describe
    options:
      sparse: true
    material: clone
    materialOptions:
      cloneDepth: 0
      branch: trunk
    edit: true
    exclude: true
defaults:
  kb:
    mode: summary
    material: copy
`);
  });

  it('puts output between layout and preamble; override keys key, mode, options, material, materialOptions, edit, exclude', () => {
    const doc = recipeToYamlObject(parse({ preamble: 'p', output: { dir: '/x' } }));
    expect(Object.keys(doc)).toEqual([
      'name',
      'description',
      'target',
      'layout',
      'output',
      'preamble',
      'contexts',
      'items',
    ]);
    const [override] = recipeToYamlObject(demo).overrides as Record<string, unknown>[];
    expect(Object.keys(override ?? {})).toEqual([
      'key',
      'mode',
      'options',
      'material',
      'materialOptions',
      'edit',
      'exclude',
    ]);
    const defaults = recipeToYamlObject(demo).defaults as Record<string, Record<string, unknown>>;
    expect(Object.keys(defaults.kb ?? {})).toEqual(['mode', 'material']);
  });

  it('output omissions: default contextFile, allowNonEmpty false, empty stubs, empty output', () => {
    const out = (output: Record<string, unknown>) => recipeToYamlObject(parse({ output })).output;
    expect(out({ dir: '/x', contextFile: 'LLM_CONTEXT.md' })).toEqual({ dir: '/x' });
    expect(out({ dir: '/x', allowNonEmpty: false })).toEqual({ dir: '/x' });
    expect(out({ dir: '/x', stubs: {} })).toEqual({ dir: '/x' });
    expect(out({ dir: '/x', stubs: { gitignore: undefined } })).toEqual({ dir: '/x' });
    expect(out({ stubs: { claudeMd: true, agentsMd: false } })).toEqual({
      stubs: { agentsMd: false, claudeMd: true },
    });
    expect(out({})).toBeUndefined();
    expect(recipeToYamlObject(parse({ output: {} }))).not.toHaveProperty('output');
    expect(out({ contextFile: 'LLM_CONTEXT.md', stubs: {} })).toBeUndefined();
  });

  it('keeps an override or default that only has a material or material options', () => {
    const r = parse({
      overrides: [
        { key: 'kb/a', material: 'none' },
        { key: 'reference/b', materialOptions: { cloneDepth: 10 } },
        { key: 'kb/c', materialOptions: {} },
      ],
      defaults: {
        'remote-repo': { materialOptions: { branch: 'dev' } },
        skill: { materialOptions: {} },
      },
    });
    const out = recipeToYamlObject(r);
    expect(out.overrides).toEqual([
      { key: 'kb/a', material: 'none' },
      { key: 'reference/b', materialOptions: { cloneDepth: 10 } },
    ]);
    expect(out.defaults).toEqual({ 'remote-repo': { materialOptions: { branch: 'dev' } } });
  });

  it('edit (plans/INFLATE_V3_PLAN.md §4): written right after materialOptions, true and false, alone is kept', () => {
    const r = parse({
      overrides: [
        { key: 'reference/a', edit: false },
        { key: 'reference/b', exclude: true, edit: true, material: 'symlink' },
        { key: 'reference/c' },
      ],
    });
    const out = recipeToYamlObject(r);
    expect(out.overrides).toEqual([
      { key: 'reference/a', edit: false },
      { key: 'reference/b', material: 'symlink', edit: true, exclude: true },
    ]);
    expect(Object.keys((out.overrides as Record<string, unknown>[])[1] ?? {})).toEqual([
      'key',
      'material',
      'edit',
      'exclude',
    ]);
    // it round-trips and sameRecipe sees it
    const reparsed = parseRecipe(parseYaml(serializeRecipe(r)), 'r');
    expect(reparsed.ok && serializeRecipe(reparsed.recipe)).toBe(serializeRecipe(r));
    expect(
      sameRecipe(
        parse({ overrides: [{ key: 'reference/a' }] }),
        parse({ overrides: [{ key: 'reference/a', edit: true }] }),
      ),
    ).toBe(false);
    expect(
      sameRecipe(
        parse({ overrides: [{ key: 'reference/a', edit: false }] }),
        parse({ overrides: [{ key: 'reference/a', edit: true }] }),
      ),
    ).toBe(false);
  });

  it('round-trips and sameRecipe sees output and material changes', () => {
    const once = serializeRecipe(demo);
    const reparsed = parseRecipe(parseYaml(once), 'demo');
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(serializeRecipe(reparsed.recipe)).toBe(once);
    expect(sameRecipe(demo, reparsed.recipe)).toBe(true);
    expect(sameRecipe(demo, { ...demo, output: { ...demo.output, contextFile: 'X.md' } })).toBe(
      false,
    );
    expect(sameRecipe(parse({}), parse({ output: { dir: '/x' } }))).toBe(false);
    expect(sameRecipe(parse({}), parse({ output: {} }))).toBe(true);
    expect(
      sameRecipe(
        parse({ overrides: [{ key: 'kb/a' }] }),
        parse({ overrides: [{ key: 'kb/a', material: 'copy' }] }),
      ),
    ).toBe(false);
  });
});

describe('applyRunOverrides (plans/INFLATE_V2_SPEC.md §4.3)', () => {
  const run = (given: InflateRunOverridesInput = {}) => assertValid(runOverridesSchema, given);
  const withOutput = parse({
    output: { dir: '~/ctxman-inflate/r', primary: 'reference/app', stubs: { gitignore: false } },
    overrides: [
      {
        key: 'reference/app',
        mode: 'clone',
        options: { sparse: true },
        material: 'clone',
        materialOptions: { cloneDepth: 10, branch: 'dev' },
      },
      { key: 'kb/a', exclude: true },
    ],
  });

  it('an empty run is a copy equal to the recipe; without output none appears', () => {
    expect(applyRunOverrides(withOutput, run())).toEqual(withOutput);
    expect(applyRunOverrides(withOutput, run())).not.toBe(withOutput);
    const bare = parse({});
    const out = applyRunOverrides(bare, run());
    expect(out).toEqual(bare);
    expect(out).not.toHaveProperty('output');
  });

  it('dir, contextFile and allowNonEmpty replace; the rest of output stays', () => {
    const out = applyRunOverrides(
      withOutput,
      run({ dir: '/tmp/w', contextFile: 'CONTEXT.md', allowNonEmpty: true }),
    );
    expect(out.output).toEqual({
      dir: '/tmp/w',
      contextFile: 'CONTEXT.md',
      primary: 'reference/app',
      allowNonEmpty: true,
      stubs: { gitignore: false },
    });
  });

  it('output is created from a recipe without one, with the default context file', () => {
    expect(applyRunOverrides(parse({}), run({ dir: '/tmp/w' })).output).toEqual({
      contextFile: 'LLM_CONTEXT.md',
      dir: '/tmp/w',
    });
    expect(applyRunOverrides(parse({}), run({ primary: 'reference/x' })).output).toEqual({
      contextFile: 'LLM_CONTEXT.md',
      primary: 'reference/x',
    });
    expect(applyRunOverrides(parse({}), run({ primary: null })).output).toEqual({
      contextFile: 'LLM_CONTEXT.md',
    });
    expect(applyRunOverrides(parse({}), run({ allowNonEmpty: false })).output).toEqual({
      contextFile: 'LLM_CONTEXT.md',
      allowNonEmpty: false,
    });
  });

  it('primary: a string sets it, null deletes it', () => {
    expect(applyRunOverrides(withOutput, run({ primary: 'reference/other' })).output?.primary).toBe(
      'reference/other',
    );
    const cleared = applyRunOverrides(withOutput, run({ primary: null })).output;
    expect(cleared).not.toHaveProperty('primary');
    expect(cleared?.dir).toBe('~/ctxman-inflate/r');
  });

  it('item material replaces; materialOptions merge; mode, options and exclude are kept', () => {
    const out = applyRunOverrides(
      withOutput,
      run({
        items: {
          'reference/app': {
            material: 'none',
            materialOptions: { cloneDepth: 0, subpathOnly: true },
          },
        },
      }),
    );
    expect(out.overrides).toEqual([
      {
        key: 'reference/app',
        mode: 'clone',
        options: { sparse: true },
        material: 'none',
        materialOptions: { cloneDepth: 0, branch: 'dev', subpathOnly: true },
      },
      { key: 'kb/a', exclude: true },
    ]);
  });

  it('item edit replaces the recipe override edit (also false); the rest is kept', () => {
    const out = applyRunOverrides(
      withOutput,
      run({ items: { 'reference/app': { edit: false }, 'reference/lib': { edit: true } } }),
    );
    expect(out.overrides).toEqual([
      {
        key: 'reference/app',
        mode: 'clone',
        options: { sparse: true },
        material: 'clone',
        materialOptions: { cloneDepth: 10, branch: 'dev' },
        edit: false,
      },
      { key: 'kb/a', exclude: true },
      { key: 'reference/lib', edit: true },
    ]);
    // material and edit together
    const both = applyRunOverrides(
      withOutput,
      run({ items: { 'reference/app': { material: 'symlink', edit: true } } }),
    );
    expect(both.overrides[0]).toMatchObject({ material: 'symlink', edit: true });
    expect(validate(recipeSchema, out).success).toBe(true);
  });

  it('an item without a recipe override gets one appended; only given fields are set', () => {
    const out = applyRunOverrides(
      withOutput,
      run({
        items: {
          'kb/b': { material: 'copy' },
          'reference/lib': { materialOptions: { branch: 'x' } },
        },
      }),
    );
    expect(out.overrides.slice(2)).toEqual([
      { key: 'kb/b', material: 'copy' },
      { key: 'reference/lib', materialOptions: { branch: 'x' } },
    ]);
    // an item entry that says nothing appends nothing
    expect(applyRunOverrides(withOutput, run({ items: { 'kb/z': {} } })).overrides).toEqual(
      withOutput.overrides,
    );
  });

  it('never mutates the recipe or the run', () => {
    const recipeBefore = structuredClone(withOutput);
    const given = run({
      dir: '/tmp/w',
      primary: null,
      items: {
        'reference/app': { material: 'none', materialOptions: { cloneDepth: 0 } },
        'kb/new': { material: 'copy' },
      },
    });
    const runBefore = structuredClone(given);
    applyRunOverrides(withOutput, given);
    expect(withOutput).toEqual(recipeBefore);
    expect(given).toEqual(runBefore);
  });

  it('the result still parses as a recipe (valid material per key)', () => {
    const out = applyRunOverrides(
      withOutput,
      run({
        dir: '/tmp/w',
        items: { 'reference/app': { material: 'symlink' }, 'skill/s': { material: 'copy' } },
      }),
    );
    expect(validate(recipeSchema, out).success).toBe(true);
  });
});

describe('runOverrideCount', () => {
  const count = (given: InflateRunOverridesInput) =>
    runOverrideCount(assertValid(runOverridesSchema, given));

  it('counts dir, contextFile, primary (also null), allowNonEmpty and items with a material, options or edit', () => {
    expect(count({})).toBe(0);
    expect(count({ dir: '/x' })).toBe(1);
    expect(count({ dir: '/x', contextFile: 'C.md' })).toBe(2);
    expect(count({ primary: null })).toBe(1);
    expect(count({ primary: 'reference/x' })).toBe(1);
    expect(count({ allowNonEmpty: false })).toBe(1);
    expect(count({ dir: '/x', contextFile: 'C.md', primary: null, allowNonEmpty: true })).toBe(4);
    expect(
      count({
        items: {
          'kb/a': { material: 'copy' },
          'reference/b': { materialOptions: { branch: 'x' } },
          'kb/c': {},
        },
      }),
    ).toBe(2);
    expect(
      count({
        dir: '/x',
        items: { 'kb/a': { material: 'none', materialOptions: { cloneDepth: 1 } } },
      }),
    ).toBe(2);
    // edit counts once per item, also false
    expect(
      count({ items: { 'reference/a': { edit: false }, 'reference/b': { edit: true } } }),
    ).toBe(2);
    expect(count({ items: { 'reference/a': { material: 'symlink', edit: true } } })).toBe(1);
  });
});

describe('runOverridesSchema', () => {
  it('defaults items to {} and is strict', () => {
    expect(assertValid(runOverridesSchema, {})).toEqual({ items: {} });
    expect(validate(runOverridesSchema, { other: 1 }).success).toBe(false);
    expect(validate(runOverridesSchema, { items: { 'kb/a': { mode: 'summary' } } }).success).toBe(
      false,
    );
    expect(validate(runOverridesSchema, { items: { nope: { material: 'copy' } } }).success).toBe(
      false,
    );
    expect(validate(runOverridesSchema, { items: { 'context/x': {} } }).success).toBe(false);
    expect(validate(runOverridesSchema, { items: { 'kb/a': { material: 'bogus' } } }).success).toBe(
      false,
    );
    expect(validate(runOverridesSchema, { dir: '' }).success).toBe(false);
    expect(validate(runOverridesSchema, { contextFile: 'x/y.md' }).success).toBe(false);
    expect(validate(runOverridesSchema, { primary: 'kb/x' }).success).toBe(false);
    expect(validate(runOverridesSchema, { primary: null }).success).toBe(true);
    expect(dataOf(validate(runOverridesSchema, { dir: ' /x ' }))?.dir).toBe('/x');
  });

  it('edit: a boolean on reference/<slug> keys only', () => {
    expect(validate(runOverridesSchema, { items: { 'reference/a': { edit: true } } }).success).toBe(
      true,
    );
    expect(
      validate(runOverridesSchema, { items: { 'reference/a': { edit: false, material: 'copy' } } })
        .success,
    ).toBe(true);
    expect(validate(runOverridesSchema, { items: { 'reference/a': { edit: 1 } } }).success).toBe(
      false,
    );
    const result = validate(runOverridesSchema, { items: { 'kb/a': { edit: true } } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((i) => i.path.join('.'))).toEqual(['items.kb/a.edit']);
    }
  });
});

describe('parseRunRequest', () => {
  const recipeBody = { name: 'r', description: 'd' };

  it('accepts { recipe } and { recipe, overrides }', () => {
    const bare = parseRunRequest({ recipe: recipeBody });
    expect(bare.ok).toBe(true);
    if (bare.ok) {
      expect(bare.recipe.name).toBe('r');
      expect(bare.recipe.layout).toBe('grouped');
      expect(bare.overrides).toEqual({ items: {} });
    }
    const given = parseRunRequest({
      recipe: recipeBody,
      overrides: { dir: '/tmp/w', items: { 'kb/a': { material: 'copy' } } },
    });
    expect(given.ok && given.overrides).toEqual({
      dir: '/tmp/w',
      items: { 'kb/a': { material: 'copy' } },
    });
  });

  it('accepts the edit run override and rejects it on a non-reference key', () => {
    const given = parseRunRequest({
      recipe: recipeBody,
      overrides: { items: { 'reference/app': { edit: true } } },
    });
    expect(given.ok && given.overrides).toEqual({ items: { 'reference/app': { edit: true } } });
    const bad = parseRunRequest({
      recipe: recipeBody,
      overrides: { items: { 'kb/a': { edit: true } } },
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.map((i) => i.path)).toEqual(['overrides.items.kb/a.edit']);
    const recipeBad = parseRunRequest({
      recipe: { ...recipeBody, overrides: [{ key: 'kb/a', edit: true }] },
    });
    expect(recipeBad.ok).toBe(false);
    if (!recipeBad.ok) {
      expect(recipeBad.issues.map((i) => i.path)).toEqual(['recipe.overrides.0.edit']);
    }
  });

  it('rejects anything but a plain object with keys recipe / overrides', () => {
    const message = 'request body must be { recipe, overrides? }';
    for (const body of [null, undefined, 'x', 3, [], [{ recipe: recipeBody }]]) {
      expect(parseRunRequest(body), JSON.stringify(body)).toEqual({
        ok: false,
        issues: [{ path: '', message }],
      });
    }
    expect(parseRunRequest({ recipe: recipeBody, extra: 1 })).toEqual({
      ok: false,
      issues: [{ path: '', message }],
    });
  });

  it('prefixes recipe issues with recipe. (recipe for a root issue) and override issues with overrides.', () => {
    // a narrow rule (here: material applicability) only runs when the rest of the recipe is valid
    const narrow = parseRunRequest({
      recipe: { name: 'ok', description: 'd', overrides: [{ key: 'kb/a', material: 'clone' }] },
    });
    expect(narrow.ok).toBe(false);
    if (!narrow.ok) {
      expect(narrow.issues.map((i) => i.path)).toEqual(['recipe.overrides.0.material']);
    }
    const bad = parseRunRequest({
      recipe: { name: 'Bad Name', description: 'd' },
      overrides: { items: { 'kb/a': { material: 'bogus' } }, dir: '' },
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const paths = bad.issues.map((i) => i.path);
    expect(paths).toContain('recipe.name');
    expect(paths.some((p) => p === 'overrides.dir')).toBe(true);
    expect(paths.some((p) => p.startsWith('overrides.items.'))).toBe(true);
    expect(paths.every((p) => p.startsWith('recipe.') || p.startsWith('overrides.'))).toBe(true);

    const root = parseRunRequest({ recipe: 5 });
    expect(root.ok).toBe(false);
    if (!root.ok) expect(root.issues.map((i) => i.path)).toEqual(['recipe']);
    const missing = parseRunRequest({});
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues.map((i) => i.path)).toEqual(['recipe']);

    const badOverrides = parseRunRequest({ recipe: recipeBody, overrides: 'x' });
    expect(badOverrides.ok).toBe(false);
    if (!badOverrides.ok) expect(badOverrides.issues.map((i) => i.path)).toEqual(['overrides']);
  });
});

describe('the seed recipe (plans/INFLATE_V2_SPEC.md §13)', () => {
  it('parses, carries output and the clone material, and is in canonical serializer form', () => {
    const parsed = parseRecipe(parseYaml(SEED_RECIPE_YAML), 'ctxman-dev-brief');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.recipe.output).toEqual({
      dir: '~/ctxman-inflate/ctxman-dev-brief',
      contextFile: 'LLM_CONTEXT.md',
      primary: 'reference/astro-docs',
    });
    expect(parsed.recipe.overrides.find((o) => o.key === 'reference/astro-docs')).toEqual({
      key: 'reference/astro-docs',
      mode: 'clone',
      options: { sparse: true },
      material: 'clone',
      materialOptions: { subpathOnly: true },
    });
    expect(withSchemaComment('recipe', serializeRecipe(parsed.recipe), ORIGIN)).toBe(
      SEED_RECIPE_YAML,
    );
  });
});
