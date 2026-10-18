import { describe, expect, it } from 'vitest';
import {
  DATASET_SCHEMAS,
  contextSchema,
  recipeSchema,
  referenceSchema,
  runOverridesSchema,
  skillSchema,
} from '../../src/datasets/schemas.ts';
import { assertValid, validate } from '../../src/datasets/validate.ts';
import { dataOf, issuesOf } from './fixtures/validation.ts';

describe('validate()', () => {
  it('returns the schema OUTPUT with defaults applied and leaves the input untouched', () => {
    const input = { name: 'demo', description: 'd' };
    const result = validate(contextSchema, input);
    expect(result).toEqual({
      success: true,
      data: { name: 'demo', description: 'd', tags: [], links: [] },
    });
    expect(input).toEqual({ name: 'demo', description: 'd' });
  });

  it('classifies a missing key as "other" with code "required"', () => {
    const issues = issuesOf(validate(contextSchema, { name: 'demo' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['description'], code: 'required', kind: 'other' });
    expect(issues[0]!.message).toMatch(/\(was missing\)$/);
  });

  it('classifies an undeclared key of a strict object as "unknown-key" with the key as the path', () => {
    const issues = issuesOf(validate(contextSchema, { name: 'demo', description: 'd', extra: 1 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['extra'], kind: 'unknown-key' });
    const nested = issuesOf(
      validate(contextSchema, {
        name: 'demo',
        description: 'd',
        links: [{ dataset: 'kb', slug: 'x', nope: true }],
      }),
    );
    expect(nested[0]).toMatchObject({ path: ['links', 0, 'nope'], kind: 'unknown-key' });
  });

  it('classifies a narrow predicate (duplicates, applicability, uri rules) as "custom"', () => {
    const duplicate = issuesOf(
      validate(contextSchema, {
        name: 'demo',
        description: 'd',
        links: [
          { dataset: 'kb', slug: 'x' },
          { dataset: 'kb', slug: 'x' },
        ],
      }),
    );
    expect(duplicate).toEqual([
      {
        path: ['links', 1],
        message: 'duplicate link kb/x',
        code: 'predicate',
        kind: 'custom',
      },
    ]);
    const applies = issuesOf(
      validate(recipeSchema, {
        name: 'r',
        description: 'd',
        overrides: [{ key: 'kb/a', mode: 'install' }],
      }),
    );
    expect(applies[0]).toMatchObject({ path: ['overrides', 0, 'mode'], kind: 'custom' });
    const uri = issuesOf(
      validate(referenceSchema, {
        name: 'r',
        description: 'd',
        type: 'remote-repo',
        uri: 'nope',
        owner: 'me',
      }),
    );
    expect(uri[0]).toMatchObject({ path: ['uri'], kind: 'custom' });
    expect(uri[0]!.message).toContain('git URI');
  });

  it('classifies enumerations and shape problems as "other", whatever the number of values', () => {
    // 9 linkable datasets compile into a predicate; 2 owners stay a union: neither is custom
    const dataset = issuesOf(
      validate(contextSchema, {
        name: 'demo',
        description: 'd',
        links: [{ dataset: 'nope', slug: 'x' }],
      }),
    );
    expect(dataset[0]).toMatchObject({ path: ['links', 0, 'dataset'], kind: 'other' });
    const owner = issuesOf(
      validate(referenceSchema, {
        name: 'r',
        description: 'd',
        type: 'local-repo',
        path: '/x',
        owner: 'someone',
      }),
    );
    expect(owner[0]).toMatchObject({ path: ['owner'], kind: 'other' });
    const mode = issuesOf(
      validate(recipeSchema, {
        name: 'r',
        description: 'd',
        defaults: { kb: { mode: 'install' } },
      }),
    );
    expect(mode[0]).toMatchObject({ path: ['defaults', 'kb', 'mode'], kind: 'other' });
    expect(issuesOf(validate(skillSchema, { name: 'S', description: 'd' }))[0]).toMatchObject({
      path: ['name'],
      kind: 'other',
    });
  });

  it('does not run a narrow while the structure is invalid', () => {
    const issues = issuesOf(
      validate(contextSchema, {
        name: 'demo',
        links: [
          { dataset: 'kb', slug: 'x' },
          { dataset: 'kb', slug: 'x' },
        ],
      }),
    );
    expect(issues.map((i) => i.path.join('.'))).toEqual(['description']);
  });

  it('treats an explicitly undefined optional key as absent (zod-style)', () => {
    const result = validate(referenceSchema, {
      name: 'r',
      description: 'd',
      type: 'remote-repo',
      uri: 'git@h.test:o/r.git',
      owner: 'me',
      subpath: undefined,
    });
    expect(result.success).toBe(true);
    // a REQUIRED key that is undefined is reported as missing
    const missing = issuesOf(validate(contextSchema, { name: 'demo', description: undefined }));
    expect(missing[0]).toMatchObject({ path: ['description'], code: 'required' });
  });

  it('converts dates and reports an unparsable one as a predicate with the date wording', () => {
    const ok = validate(DATASET_SCHEMAS.kb, {
      type: 'Knowledge Base',
      name: 'd',
      description: 'd',
      stale_after: '2027-01-02',
    });
    expect((dataOf(ok) as { stale_after: unknown }).stale_after).toEqual(new Date('2027-01-02'));
    const bad = issuesOf(
      validate(DATASET_SCHEMAS.kb, {
        type: 'Knowledge Base',
        name: 'd',
        description: 'd',
        stale_after: 'nope',
      }),
    );
    expect(bad[0]!.path).toEqual(['stale_after']);
    expect(bad[0]!.message).toMatch(/must be a parsable date/);
  });

  it('applies morphs: run override dir is trimmed, a bad item key is rejected at the key', () => {
    expect(dataOf(validate(runOverridesSchema, { dir: ' /x ' }))?.dir).toBe('/x');
    const issues = issuesOf(validate(runOverridesSchema, { items: { nope: {} } }));
    expect(issues[0]).toMatchObject({ path: ['items', 'nope'], kind: 'custom' });
    expect(issues[0]!.message).toBe('must be <dataset>/<slug> of a linkable dataset');
  });

  it('a strict root rejects unknown keys', () => {
    expect(validate(skillSchema, { name: 'x', description: 'd' }).success).toBe(true);
    expect(
      issuesOf(validate(skillSchema, { name: 'x', description: 'd', title: 'x' }))[0],
    ).toMatchObject({
      path: ['title'],
      kind: 'unknown-key',
    });
  });
});

describe('assertValid()', () => {
  it('returns the data', () => {
    expect(assertValid(contextSchema, { name: 'a', description: 'd' }, 'context')).toMatchObject({
      name: 'a',
    });
  });

  it('throws "<what>: <path>: <message>" for the first issue', () => {
    expect(() => assertValid(contextSchema, { name: 'a' }, 'context a')).toThrow(
      /^context a: description: description must be a string \(was missing\)$/,
    );
    expect(() => assertValid(contextSchema, 5, 'context')).toThrow(/^context: /);
  });
});
