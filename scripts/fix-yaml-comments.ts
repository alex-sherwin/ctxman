// Inserts / repairs the yaml-language-server schema comment on line 1 of every reference, context and recipe
// YAML file: `# yaml-language-server: $schema=<server origin>/api/schemas/<dataset>`. Idempotent; writes only the
// files that change. This is also the one-off migration for pre-existing data files.
// Usage: node scripts/fix-yaml-comments.ts [--json]
// Targets CTXMAN_DATA_DIR (required); the origin is CTXMAN_SERVER_ORIGIN (default http://127.0.0.1:4321). Exit 0 ok, 2 usage error.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import {
  DataDirError,
  datasetDir,
  resolveDataDir,
  resolveServerOrigin,
} from '../src/lib/data-dir.ts';
import { fixSchemaComment, SCHEMA_DATASETS } from '../src/lib/schema-comment.ts';
import { EXIT_OK, EXIT_USAGE, writeError, writeJson, writeLine } from './cli.ts';

const USAGE = `Usage: node scripts/fix-yaml-comments.ts [--json]
  Makes line 1 of every {${SCHEMA_DATASETS.join(',')}}/*.yaml the yaml-language-server schema comment.
  Targets CTXMAN_DATA_DIR (default ./data). Exit 0 ok, 2 usage error.`;

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
    writeError(`fix-yaml-comments: ${(error as Error).message}`);
    writeError(USAGE);
    return EXIT_USAGE;
  }

  let dataDir: string;
  try {
    dataDir = resolveDataDir();
  } catch (error) {
    if (!(error instanceof DataDirError)) throw error;
    writeError(`fix-yaml-comments: ${error.message}`);
    return EXIT_USAGE;
  }
  const origin = resolveServerOrigin();
  const fixed: string[] = [];
  for (const ds of SCHEMA_DATASETS) {
    const dir = datasetDir(ds, dataDir);
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.yaml') && !n.startsWith('.')).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      const source = await readFile(abs, 'utf8');
      const next = fixSchemaComment(ds, source, origin);
      if (next === source) continue;
      await writeFile(abs, next, 'utf8');
      fixed.push(`${ds}/${name}`);
    }
  }

  if (json) writeJson({ ok: true, fixed });
  else {
    for (const file of fixed) writeLine(`fixed ${file}`);
    writeLine(`${fixed.length} files fixed`);
  }
  return EXIT_OK;
}

process.exitCode = await main();
