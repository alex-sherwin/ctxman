// One-off migration: the entry of an okf bundle moves from `main.md` into the bundle-root `index.md`.
// Usage: node scripts/migrate-index.ts [--dry-run] [--json]
// Targets CTXMAN_DATA_DIR (required). Idempotent: bundles without main.md are skipped.
// Exit 0 ok (also when nothing to do), 1 a bundle could not be migrated, 2 usage error.
import process from 'node:process';
import { parseArgs } from 'node:util';
import { migrateDataDir } from '../src/lib/migrate-index.ts';
import {
  EXIT_FINDINGS,
  EXIT_OK,
  EXIT_USAGE,
  resolveDataDirOrExit,
  writeError,
  writeJson,
  writeLine,
} from './cli.ts';

const USAGE = `Usage: node scripts/migrate-index.ts [--dry-run] [--json]

  Moves the entry of every okf bundle from main.md into the bundle-root index.md (okf_version first, then the
  main.md frontmatter and body, then the old navigation sections) and rewrites links to main.md to index.md.

  --dry-run    print the plan, change nothing
  --json       print one JSON document instead of text
  -h, --help   show this help

Targets CTXMAN_DATA_DIR (required). Exit 0 ok, 1 a bundle failed, 2 usage error.`;

async function main(): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: {
        'dry-run': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (error) {
    writeError(`migrate-index: ${(error as Error).message}`);
    writeError(USAGE);
    return EXIT_USAGE;
  }
  if (values.help) {
    writeLine(USAGE);
    return EXIT_OK;
  }
  const dataDir = resolveDataDirOrExit('migrate-index');
  if (dataDir === undefined) return EXIT_USAGE;

  const report = await migrateDataDir(dataDir, { dryRun: values['dry-run'] === true });
  if (values.json) {
    writeJson(report);
  } else {
    for (const b of report.bundles) {
      if (b.status === 'skipped') continue;
      const links = b.rewrites.reduce((n, r) => n + r.count, 0);
      const note = b.status === 'failed' ? `FAILED: ${b.error}` : `${links} link(s) rewritten`;
      writeLine(`${b.status.padEnd(13)} ${b.dataset}/${b.slug}  ${note}`);
    }
    writeLine(
      `${report.dryRun ? 'Would migrate' : 'Migrated'} ${report.migrated} bundle(s), skipped ${report.skipped}, failed ${report.failed}; ${report.rewrites} link(s) rewritten.`,
    );
  }
  return report.failed > 0 ? EXIT_FINDINGS : EXIT_OK;
}

process.exitCode = await main();
