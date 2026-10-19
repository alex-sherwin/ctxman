import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { snippetSchema } from '../../src/datasets/schemas.ts';
import type { SnippetData } from '../../src/datasets/schemas.ts';
import { assertValid } from '../../src/datasets/validate.ts';
import { withSchemaComment } from '../../src/lib/schema-comment.ts';
import {
  parseSnippet,
  sameSnippet,
  serializeSnippet,
  snippetToYamlObject,
} from '../../src/lib/snippet-yaml.ts';
import { parseYaml } from '../../src/lib/yaml.ts';
import { cleanupCorpus, copyCorpus } from './fixtures/corpus.ts';

const ORIGIN = 'http://127.0.0.1:4321';

afterEach(() => cleanupCorpus());

const parse = (input: unknown): SnippetData => assertValid(snippetSchema, input);

const tagged = parse({
  name: 'finish-checklist',
  description: 'The checks to run before saying a piece of work is done.',
  tags: ['workflow'],
  markdown: '## Before you finish\n\n1. Run the checks.\n',
});
const plain = parse({ name: 'one-liner', description: 'd', markdown: 'Be brief.' });

describe('serializeSnippet', () => {
  it('writes name, description, tags (only when non-empty) and markdown last', () => {
    expect(Object.keys(snippetToYamlObject(tagged))).toEqual([
      'name',
      'description',
      'tags',
      'markdown',
    ]);
    expect(plain.tags).toEqual([]);
    expect(Object.keys(snippetToYamlObject(plain))).toEqual(['name', 'description', 'markdown']);
  });

  it('writes multi-line markdown as a literal block scalar', () => {
    expect(serializeSnippet(tagged)).toBe(
      [
        'name: finish-checklist',
        'description: The checks to run before saying a piece of work is done.',
        'tags:',
        '  - workflow',
        'markdown: |',
        '  ## Before you finish',
        '',
        '  1. Run the checks.',
        '',
      ].join('\n'),
    );
    expect(serializeSnippet(plain)).toBe('name: one-liner\ndescription: d\nmarkdown: Be brief.\n');
  });

  it('is byte-identical to the seed files (after the schema comment)', () => {
    const corpus = copyCorpus();
    for (const slug of ['conventional-commits', 'finish-checklist']) {
      const source = readFileSync(path.join(corpus, 'snippet', `${slug}.yaml`), 'utf8');
      const parsed = parseSnippet(parseYaml(source), slug);
      expect(parsed.ok, slug).toBe(true);
      if (!parsed.ok) continue;
      expect(withSchemaComment('snippet', serializeSnippet(parsed.snippet), ORIGIN)).toBe(source);
    }
  });

  it('round-trips through parseYaml + parseSnippet, markdown kept exactly', () => {
    const tricky = parse({
      name: 'tricky',
      description: 'Has: a colon',
      markdown: '  indented first line\n\n```sh\necho "#not a comment"\n```\n\n\n',
    });
    const again = parseSnippet(parseYaml(serializeSnippet(tricky)), 'tricky');
    expect(again.ok && again.snippet).toEqual(tricky);
  });
});

describe('sameSnippet', () => {
  it('compares the serialized documents; null equals only null', () => {
    expect(sameSnippet(tagged, parse({ ...tagged }))).toBe(true);
    expect(sameSnippet(tagged, parse({ ...tagged, markdown: 'other' }))).toBe(false);
    expect(sameSnippet(plain, parse({ ...plain, tags: [] }))).toBe(true);
    expect(sameSnippet(null, null)).toBe(true);
    expect(sameSnippet(tagged, null)).toBe(false);
  });
});

describe('parseSnippet', () => {
  it('requires a non-blank markdown and description and rejects unknown keys', () => {
    const blank = parseSnippet({ name: 'x', description: 'd', markdown: '  \n' });
    expect(blank).toMatchObject({ ok: false, code: 'invalid' });
    expect(!blank.ok && blank.issues.map((i) => i.path)).toEqual(['markdown']);
    expect(parseSnippet({ name: 'x', description: 'd' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(parseSnippet({ name: 'x', description: '', markdown: 'm' })).toMatchObject({
      ok: false,
    });
    const extra = parseSnippet({ name: 'x', description: 'd', markdown: 'm', info: 'no' });
    expect(!extra.ok && extra.issues.map((i) => i.path)).toEqual(['info']);
    expect(parseSnippet({ name: 'Bad Name', description: 'd', markdown: 'm' }).ok).toBe(false);
  });

  it('checks the name against the expected one (snippet names cannot change)', () => {
    expect(parseSnippet({ name: 'x', description: 'd', markdown: 'm' }, 'x').ok).toBe(true);
    const renamed = parseSnippet({ name: 'y', description: 'd', markdown: 'm' }, 'x');
    expect(renamed).toMatchObject({ ok: false, code: 'name-mismatch' });
    expect(!renamed.ok && renamed.issues[0]?.message).toContain('cannot be changed');
  });
});
