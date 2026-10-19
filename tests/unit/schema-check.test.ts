import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { allSchemaTexts } from '../../src/lib/json-schema.ts';
import { SCHEMA_DATASETS, schemaFileName } from '../../src/lib/schema-comment.ts';
import { checkSchemaFiles } from '../../src/lib/schema-check.ts';
import { trackTemp } from './fixtures/data-fixtures.ts';

const tmp = trackTemp();
afterEach(() => tmp.cleanup());

/** A temp schemas dir holding the current generated files (plus any overrides, `null` = absent). */
function schemasDir(overrides: Partial<Record<string, string | null>> = {}): string {
  const files: Record<string, string> = {};
  for (const ds of SCHEMA_DATASETS) files[schemaFileName(ds)] = allSchemaTexts()[ds];
  for (const [name, content] of Object.entries(overrides)) {
    if (content === null || content === undefined) delete files[name];
    else files[name] = content;
  }
  const dir = tmp.make();
  mkdirSync(path.join(dir, 'schemas'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(dir, 'schemas', name), content);
  }
  return path.join(dir, 'schemas');
}

describe('checkSchemaFiles', () => {
  it('reports nothing when every file is current', async () => {
    expect(await checkSchemaFiles(schemasDir())).toEqual({ findings: [], filesChecked: 4 });
  });

  it('the committed schemas of this repo are current', async () => {
    const result = await checkSchemaFiles(fileURLToPath(new URL('../../schemas', import.meta.url)));
    expect(result).toEqual({ findings: [], filesChecked: 4 });
  });

  it('schemas/missing (error) for an absent file, repo-relative path', async () => {
    const result = await checkSchemaFiles(schemasDir({ 'context.schema.json': null }));
    expect(result.filesChecked).toBe(3);
    expect(result.findings).toEqual([
      {
        severity: 'error',
        rule: 'schemas/missing',
        file: 'schemas/context.schema.json',
        message: 'schema file does not exist; run pnpm run gen:schemas',
      },
    ]);
  });

  it('every file missing when the directory does not exist', async () => {
    const result = await checkSchemaFiles(path.join(tmp.make(), 'nope'));
    expect(result.filesChecked).toBe(0);
    expect(result.findings.map((f) => [f.rule, f.file])).toEqual([
      ['schemas/missing', 'schemas/context.schema.json'],
      ['schemas/missing', 'schemas/recipe.schema.json'],
      ['schemas/missing', 'schemas/reference.schema.json'],
      ['schemas/missing', 'schemas/snippet.schema.json'],
    ]);
  });

  it('schemas/drift (error) names the first differing line', async () => {
    const current = allSchemaTexts().recipe.split('\n');
    current[3] = '  "title": "edited",';
    const result = await checkSchemaFiles(schemasDir({ 'recipe.schema.json': current.join('\n') }));
    expect(result.findings).toEqual([
      {
        severity: 'error',
        rule: 'schemas/drift',
        file: 'schemas/recipe.schema.json',
        line: 4,
        message: 'out of date at line 4; run pnpm run gen:schemas',
      },
    ]);
  });

  it('drift also catches a truncated, extended or reformatted file', async () => {
    const text = allSchemaTexts().reference;
    const lines = text.split('\n').length;
    for (const edited of [text.slice(0, -2), `${text}\n`, `${text}x`, text.replace('{\n', '{')]) {
      const { findings } = await checkSchemaFiles(schemasDir({ 'reference.schema.json': edited }));
      expect(findings.map((f) => f.rule)).toEqual(['schemas/drift']);
      expect(findings[0]?.line).toBeGreaterThanOrEqual(1);
      expect(findings[0]?.line).toBeLessThanOrEqual(lines + 1);
    }
  });

  it('schemas/stray (warning) for any other .json file, other files ignored', async () => {
    const dir = schemasDir({ 'extra.json': '{}\n', 'notes.txt': 'x' });
    const result = await checkSchemaFiles(dir);
    expect(result.filesChecked).toBe(4);
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'warning',
        rule: 'schemas/stray',
        file: 'schemas/extra.json',
      }),
    ]);
  });

  it('does not modify the files it checks', async () => {
    const dir = schemasDir();
    const before = readFileSync(path.join(dir, 'recipe.schema.json'), 'utf8');
    await checkSchemaFiles(dir);
    expect(readFileSync(path.join(dir, 'recipe.schema.json'), 'utf8')).toBe(before);
  });
});
