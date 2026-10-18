// Runs the OKF, links and collections checks in-process and prints one combined report.
// Usage: node scripts/check-all.ts [--json]
import process from 'node:process';
import { checkCollections } from '../src/lib/collections-check.ts';
import { formatReport } from '../src/lib/findings.ts';
import { checkLinks } from '../src/lib/links.ts';
import { checkOkf } from '../src/lib/okf.ts';
import { buildReport, parseCheckFlags, resolveDataDirOrExit, writeJson, writeLine } from './cli.ts';

const flags = parseCheckFlags('check-all', 'All');
if ('exit' in flags) {
  process.exitCode = flags.exit;
} else {
  const dataDir = resolveDataDirOrExit('check-all');
  if (dataDir === undefined) process.exit(process.exitCode ?? 2);
  const [okf, links, collections] = await Promise.all([
    checkOkf(dataDir),
    checkLinks(dataDir),
    checkCollections(dataDir),
  ]).then((results) => results.map(buildReport));
  const reports = { okf, links, collections } as const;
  const errors = okf.errors + links.errors + collections.errors;
  const warnings = okf.warnings + links.warnings + collections.warnings;

  if (flags.json) {
    writeJson({ ok: errors === 0, checks: reports });
  } else {
    writeLine(formatReport('OKF', okf));
    writeLine(formatReport('Links', links));
    writeLine(formatReport('Collections', collections));
    writeLine(
      errors === 0 && warnings === 0
        ? 'All checks: OK'
        : `All checks: ${errors} errors, ${warnings} warnings`,
    );
  }
  process.exitCode = errors === 0 ? 0 : 1;
}
