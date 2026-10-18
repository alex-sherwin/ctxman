// NODE (fs): are the committed JSON Schemas in schemas/ in step with the arktype models? Scripts and tests
// only (it pulls arktype through json-schema.ts); never imported by pages, API routes or islands.
// Finding.file is REPO-relative here ('schemas/<ds>.schema.json'), unlike the data checks.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveSchemasDir } from './data-dir.ts';
import { sortFindings } from './findings.ts';
import type { Finding } from './findings.ts';
import { jsonSchemaText } from './json-schema.ts';
import { SCHEMA_DATASETS, schemaFileName } from './schema-comment.ts';

/** 1-based line of the first difference between two texts. */
function firstDifferingLine(actual: string, expected: string): number {
  const a = actual.split('\n');
  const e = expected.split('\n');
  const length = Math.max(a.length, e.length);
  for (let i = 0; i < length; i++) {
    if (a[i] !== e[i]) return i + 1;
  }
  return 1;
}

/**
 * Rules: `schemas/missing` (error: a schema file is absent), `schemas/drift` (error: the text differs from a
 * fresh generation), `schemas/stray` (warning: any other *.json in the directory).
 */
export async function checkSchemaFiles(
  schemasDir: string = resolveSchemasDir(),
): Promise<{ findings: Finding[]; filesChecked: number }> {
  const findings: Finding[] = [];
  const expected = new Set<string>();
  let filesChecked = 0;

  for (const ds of SCHEMA_DATASETS) {
    const name = schemaFileName(ds);
    expected.add(name);
    const file = `schemas/${name}`;
    let actual: string;
    try {
      actual = await readFile(path.join(schemasDir, name), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      findings.push({
        severity: 'error',
        rule: 'schemas/missing',
        file,
        message: 'schema file does not exist; run pnpm run gen:schemas',
      });
      continue;
    }
    filesChecked++;
    const wanted = jsonSchemaText(ds);
    if (actual !== wanted) {
      const line = firstDifferingLine(actual, wanted);
      findings.push({
        severity: 'error',
        rule: 'schemas/drift',
        file,
        line,
        message: `out of date at line ${line}; run pnpm run gen:schemas`,
      });
    }
  }

  let names: string[] = [];
  try {
    names = await readdir(schemasDir);
  } catch {
    // a missing directory is already reported as three `schemas/missing` errors
  }
  for (const name of names.filter((n) => n.endsWith('.json') && !expected.has(n))) {
    findings.push({
      severity: 'warning',
      rule: 'schemas/stray',
      file: `schemas/${name}`,
      message: 'not a generated schema; only <dataset>.schema.json files belong in schemas/',
    });
  }

  return { findings: sortFindings(findings), filesChecked };
}
