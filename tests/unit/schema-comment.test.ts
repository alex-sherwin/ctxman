import { describe, expect, it } from 'vitest';
import {
  SCHEMA_DATASETS,
  fixSchemaComment,
  isSchemaDatasetId,
  schemaCommentLine,
  schemaCommentStatus,
  schemaFileName,
  withSchemaComment,
} from '../../src/lib/schema-comment.ts';
import { DATASET_IDS } from '../../src/datasets/registry.ts';
import { parseYaml } from '../../src/lib/yaml.ts';

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

describe('schemaCommentLine / schemaFileName / withSchemaComment', () => {
  it('has the exact yaml-language-server text per dataset', () => {
    expect(schemaCommentLine('reference')).toBe(
      '# yaml-language-server: $schema=../../schemas/reference.schema.json',
    );
    expect(schemaCommentLine('context')).toBe(
      '# yaml-language-server: $schema=../../schemas/context.schema.json',
    );
    expect(schemaCommentLine('recipe')).toBe(
      '# yaml-language-server: $schema=../../schemas/recipe.schema.json',
    );
    expect(schemaFileName('recipe')).toBe('recipe.schema.json');
  });

  it('prepends the line and a newline, leaving the body untouched', () => {
    const body = 'name: x\ndescription: d\n';
    expect(withSchemaComment('context', body)).toBe(`${schemaCommentLine('context')}\n${body}`);
    expect(withSchemaComment('context', '')).toBe(`${schemaCommentLine('context')}\n`);
  });

  it('is a YAML comment: parsing ignores it', () => {
    const text = withSchemaComment('reference', 'name: x\nowner: me\n');
    expect(parseYaml(text)).toEqual({ name: 'x', owner: 'me' });
    expect(parseYaml(withSchemaComment('context', ''))).toBeUndefined();
  });
});

describe('schemaCommentStatus', () => {
  const line = schemaCommentLine('context');

  it('ok: the exact line first, also with BOM, CRLF, or nothing after it', () => {
    expect(schemaCommentStatus('context', `${line}\nname: x\n`)).toBe('ok');
    expect(schemaCommentStatus('context', `${line}\r\nname: x\r\n`)).toBe('ok');
    expect(schemaCommentStatus('context', `﻿${line}\nname: x\n`)).toBe('ok');
    expect(schemaCommentStatus('context', `﻿${line}\r\n`)).toBe('ok');
    expect(schemaCommentStatus('context', line)).toBe('ok');
  });

  it('wrong: any other yaml-language-server comment on line 1', () => {
    expect(schemaCommentStatus('context', `${schemaCommentLine('recipe')}\nname: x\n`)).toBe(
      'wrong',
    );
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
    `${schemaCommentLine('recipe')}\nname: x\n`,
    `﻿${schemaCommentLine('recipe')}\nname: x\n`,
    `${schemaCommentLine('context')}\nname: x\n`,
    `${schemaCommentLine('context')}\r\nname: x\r\n`,
  ];

  it('is idempotent for every sample and dataset, and the result is always ok', () => {
    for (const ds of SCHEMA_DATASETS) {
      for (const sample of samples) {
        const once = fixSchemaComment(ds, sample);
        expect(fixSchemaComment(ds, once), JSON.stringify(sample)).toBe(once);
        expect(schemaCommentStatus(ds, once), JSON.stringify(sample)).toBe('ok');
      }
    }
  });

  it('leaves an ok file byte-for-byte unchanged (BOM and CRLF included)', () => {
    const line = schemaCommentLine('context');
    for (const text of [`${line}\nname: x\n`, `﻿${line}\r\nname: x\r\n`, line]) {
      expect(fixSchemaComment('context', text)).toBe(text);
    }
  });

  it('missing: prepends the line, keeping the rest byte-for-byte', () => {
    const line = schemaCommentLine('reference');
    expect(fixSchemaComment('reference', 'name: x\n')).toBe(`${line}\nname: x\n`);
    expect(fixSchemaComment('reference', '# note\nname: x\n')).toBe(`${line}\n# note\nname: x\n`);
    expect(fixSchemaComment('reference', 'name: x')).toBe(`${line}\nname: x`);
    expect(fixSchemaComment('reference', '')).toBe(`${line}\n`);
  });

  it('missing: a CRLF file gets CRLF after the inserted line; a BOM is dropped', () => {
    const line = schemaCommentLine('reference');
    expect(fixSchemaComment('reference', 'name: x\r\ndescription: d\r\n')).toBe(
      `${line}\r\nname: x\r\ndescription: d\r\n`,
    );
    expect(fixSchemaComment('reference', '﻿name: x\n')).toBe(`${line}\nname: x\n`);
    expect(fixSchemaComment('reference', '﻿name: x\r\n')).toBe(`${line}\r\nname: x\r\n`);
  });

  it('wrong: replaces only the first line and keeps its line ending', () => {
    const line = schemaCommentLine('recipe');
    expect(fixSchemaComment('recipe', `${schemaCommentLine('context')}\nname: x\n`)).toBe(
      `${line}\nname: x\n`,
    );
    expect(fixSchemaComment('recipe', '# yaml-language-server: $schema=a\r\nname: x\r\n')).toBe(
      `${line}\r\nname: x\r\n`,
    );
    expect(fixSchemaComment('recipe', '# yaml-language-server: $schema=a')).toBe(line);
  });

  it('never duplicates the comment', () => {
    const fixed = fixSchemaComment('context', 'name: x\n');
    expect(fixed.match(/yaml-language-server/g)).toHaveLength(1);
  });
});
