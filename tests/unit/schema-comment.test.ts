import { describe, expect, it } from 'vitest';
import {
  SCHEMA_DATASETS,
  fixSchemaComment,
  isSchemaDatasetId,
  schemaCommentLine,
  schemaCommentStatus,
  schemaFileName,
  schemaUrl,
  withSchemaComment,
} from '../../src/lib/schema-comment.ts';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import { parseYaml } from '../../src/lib/yaml.ts';

const ORIGIN = 'http://127.0.0.1:4321';
const lineFor = (ds: 'reference' | 'context' | 'recipe'): string => schemaCommentLine(ds, ORIGIN);

describe('SCHEMA_DATASETS / isSchemaDatasetId', () => {
  it('are the three yaml datasets, all real dataset ids', () => {
    expect(SCHEMA_DATASETS).toEqual(['reference', 'context', 'recipe']);
    for (const ds of SCHEMA_DATASETS) expect(DATASET_IDS).toContain(ds);
  });

  it('accepts exactly those ids', () => {
    for (const ds of SCHEMA_DATASETS) expect(isSchemaDatasetId(ds)).toBe(true);
    for (const bad of ['kb', 'skill', 'Reference', '', undefined, null, 3, {}]) {
      expect(isSchemaDatasetId(bad)).toBe(false);
    }
  });
});

describe('schemaCommentLine / schemaUrl / schemaFileName / withSchemaComment', () => {
  it('has the exact yaml-language-server text per dataset', () => {
    expect(lineFor('reference')).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/reference',
    );
    expect(lineFor('context')).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/context',
    );
    expect(lineFor('recipe')).toBe(
      '# yaml-language-server: $schema=http://127.0.0.1:4321/api/schemas/recipe',
    );
    expect(schemaUrl('recipe', 'http://localhost:9')).toBe('http://localhost:9/api/schemas/recipe');
    expect(schemaFileName('recipe')).toBe('recipe.schema.json');
  });

  it('prepends the line and a newline, leaving the body untouched', () => {
    const body = 'name: x\ndescription: d\n';
    expect(withSchemaComment('context', body, ORIGIN)).toBe(`${lineFor('context')}\n${body}`);
    expect(withSchemaComment('context', '', ORIGIN)).toBe(`${lineFor('context')}\n`);
  });

  it('is a YAML comment: parsing ignores it', () => {
    const text = withSchemaComment('reference', 'name: x\nowner: me\n', ORIGIN);
    expect(parseYaml(text)).toEqual({ name: 'x', owner: 'me' });
    expect(parseYaml(withSchemaComment('context', '', ORIGIN))).toBeUndefined();
  });
});

describe('schemaCommentStatus', () => {
  const line = lineFor('context');

  it('ok: the exact line first, also with BOM, CRLF, or nothing after it', () => {
    expect(schemaCommentStatus('context', `${line}\nname: x\n`)).toBe('ok');
    expect(schemaCommentStatus('context', `${line}\r\nname: x\r\n`)).toBe('ok');
    expect(schemaCommentStatus('context', `﻿${line}\nname: x\n`)).toBe('ok');
    expect(schemaCommentStatus('context', `﻿${line}\r\n`)).toBe('ok');
    expect(schemaCommentStatus('context', line)).toBe('ok');
  });

  it('ok: any loopback origin and port, an optional .schema.json suffix', () => {
    const ok = [
      'http://127.0.0.1:4321/api/schemas/context',
      'http://localhost:4322/api/schemas/context',
      'https://localhost/api/schemas/context',
      'http://[::1]:8080/api/schemas/context',
      'http://127.0.0.1:4321/api/schemas/context.schema.json',
    ];
    for (const url of ok) {
      expect(
        schemaCommentStatus('context', `# yaml-language-server: $schema=${url}\nname: x\n`),
      ).toBe('ok');
    }
  });

  it('wrong: other host, other dataset, query string, old relative path', () => {
    const wrong = [
      'http://example.com/api/schemas/context',
      'http://127.0.0.1.evil.test/api/schemas/context',
      'http://127.0.0.1:4321/api/schemas/recipe',
      'http://127.0.0.1:4321/api/schemas/context?x=1',
      '../../schemas/context.schema.json',
    ];
    for (const url of wrong) {
      expect(
        schemaCommentStatus('context', `# yaml-language-server: $schema=${url}\nname: x\n`),
      ).toBe('wrong');
    }
  });

  it('wrong: any other yaml-language-server comment on line 1', () => {
    expect(schemaCommentStatus('context', `${lineFor('recipe')}\nname: x\n`)).toBe('wrong');
    expect(schemaCommentStatus('context', '# yaml-language-server: $schema=./x.json\n')).toBe(
      'wrong',
    );
    expect(schemaCommentStatus('context', `${line} \nname: x\n`)).toBe('wrong');
    expect(schemaCommentStatus('context', '# yaml-language-server:\nname: x\n')).toBe('wrong');
  });

  it('missing: no such comment on line 1 (it is not searched further down)', () => {
    expect(schemaCommentStatus('context', '')).toBe('missing');
    expect(schemaCommentStatus('context', 'name: x\n')).toBe('missing');
    expect(schemaCommentStatus('context', '# some other comment\nname: x\n')).toBe('missing');
    expect(schemaCommentStatus('context', '\nname: x\n')).toBe('missing');
    expect(schemaCommentStatus('context', `name: x\n${line}\n`)).toBe('missing');
    expect(schemaCommentStatus('context', ` ${line}\n`)).toBe('missing');
  });
});

describe('fixSchemaComment', () => {
  const fix = (ds: 'reference' | 'context' | 'recipe', text: string): string =>
    fixSchemaComment(ds, text, ORIGIN);
  const samples = [
    '',
    'name: x\n',
    'name: x',
    '\nname: x\n',
    '# other comment\nname: x\n',
    'name: x\r\ndescription: d\r\n',
    '﻿name: x\n',
    '﻿name: x\r\n',
    '# yaml-language-server: $schema=./x.json\nname: x\n',
    '# yaml-language-server: $schema=./x.json\r\nname: x\r\n',
    '# yaml-language-server: $schema=./x.json',
    `${lineFor('recipe')}\nname: x\n`,
    `﻿${lineFor('recipe')}\nname: x\n`,
    `${lineFor('context')}\nname: x\n`,
    `${lineFor('context')}\r\nname: x\r\n`,
  ];

  it('is idempotent for every sample and dataset, and the result is always ok', () => {
    for (const ds of SCHEMA_DATASETS) {
      for (const sample of samples) {
        const once = fixSchemaComment(ds, sample, ORIGIN);
        expect(fixSchemaComment(ds, once, ORIGIN), JSON.stringify(sample)).toBe(once);
        expect(schemaCommentStatus(ds, once), JSON.stringify(sample)).toBe('ok');
      }
    }
  });

  it('leaves an ok file byte-for-byte unchanged (BOM and CRLF included)', () => {
    const line = lineFor('context');
    for (const text of [`${line}\nname: x\n`, `﻿${line}\r\nname: x\r\n`, line]) {
      expect(fix('context', text)).toBe(text);
    }
  });

  it('missing: prepends the line, keeping the rest byte-for-byte', () => {
    const line = lineFor('reference');
    expect(fix('reference', 'name: x\n')).toBe(`${line}\nname: x\n`);
    expect(fix('reference', '# note\nname: x\n')).toBe(`${line}\n# note\nname: x\n`);
    expect(fix('reference', 'name: x')).toBe(`${line}\nname: x`);
    expect(fix('reference', '')).toBe(`${line}\n`);
  });

  it('missing: a CRLF file gets CRLF after the inserted line; a BOM is dropped', () => {
    const line = lineFor('reference');
    expect(fix('reference', 'name: x\r\ndescription: d\r\n')).toBe(
      `${line}\r\nname: x\r\ndescription: d\r\n`,
    );
    expect(fix('reference', '﻿name: x\n')).toBe(`${line}\nname: x\n`);
    expect(fix('reference', '﻿name: x\r\n')).toBe(`${line}\r\nname: x\r\n`);
  });

  it('wrong: replaces only the first line and keeps its line ending', () => {
    const line = lineFor('recipe');
    expect(fix('recipe', `${lineFor('context')}\nname: x\n`)).toBe(`${line}\nname: x\n`);
    expect(fix('recipe', '# yaml-language-server: $schema=a\r\nname: x\r\n')).toBe(
      `${line}\r\nname: x\r\n`,
    );
    expect(fix('recipe', '# yaml-language-server: $schema=a')).toBe(line);
  });

  it('never duplicates the comment', () => {
    const fixed = fix('context', 'name: x\n');
    expect(fixed.match(/yaml-language-server/g)).toHaveLength(1);
  });
});
