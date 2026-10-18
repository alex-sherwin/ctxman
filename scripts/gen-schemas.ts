// Generates schemas/<dataset>.schema.json (reference, context, recipe) from the arktype models in
// src/datasets/schemas.ts. Writes a file only when its text changed (keeps mtimes). Deterministic.
// Usage: node scripts/gen-schemas.ts [--json]
// Exit 0 ok, 2 usage error.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { resolveSchemasDir } from '../src/lib/data-dir.ts';
import { allSchemaTexts } from '../src/lib/json-schema.ts';
import { SCHEMA_DATASETS, schemaFileName } from '../src/lib/schema-comment.ts';
import { EXIT_OK, EXIT_USAGE, writeError, writeJson, writeLine } from './cli.ts';

const USAGE = `Usage: node scripts/gen-schemas.ts [--json]
  Writes schemas/<dataset>.schema.json for ${SCHEMA_DATASETS.join(', ')} from src/datasets/schemas.ts.
  Only files whose text changed are rewritten. Exit 0 ok, 2 usage error.`;

async function main(): Promise<number> {
  let json: boolean;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: false,
      strict: true,
    });
    if (values.help) {
      writeLine(USAGE);
      return EXIT_OK;
    }
    json = values.json === true;
  } catch (error) {
    writeError(`gen-schemas: ${(error as Error).message}`);
    writeError(USAGE);
    return EXIT_USAGE;
  }

  const dir = resolveSchemasDir();
  await mkdir(dir, { recursive: true });
  const texts = allSchemaTexts();
  const wrote: string[] = [];
  const unchanged: string[] = [];
  for (const ds of SCHEMA_DATASETS) {
    const rel = `schemas/${schemaFileName(ds)}`;
    const abs = path.join(dir, schemaFileName(ds));
    let current: string | undefined;
    try {
      current = await readFile(abs, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (current === texts[ds]) {
      unchanged.push(rel);
    } else {
      await writeFile(abs, texts[ds], 'utf8');
      wrote.push(rel);
    }
  }

  if (json) writeJson({ ok: true, wrote, unchanged });
  else {
    for (const rel of wrote) writeLine(`wrote ${rel}`);
    for (const rel of unchanged) writeLine(`unchanged ${rel}`);
  }
  return EXIT_OK;
}

process.exitCode = await main();
