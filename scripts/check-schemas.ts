// Are the committed JSON Schemas (schemas/*.schema.json) in step with the arktype models? Repo-level check,
// independent of the data directory. Rules: schemas/missing, schemas/drift (errors), schemas/stray (warning).
// Usage: node scripts/check-schemas.ts [--json]
// Exit 0 = no errors, 1 = errors found, 2 = usage error.
import process from 'node:process';
import { exitCode, formatReport } from '../src/lib/findings.ts';
import { checkSchemaFiles } from '../src/lib/schema-check.ts';
import { buildReport, parseCheckFlags, writeJson, writeLine } from './cli.ts';

const flags = parseCheckFlags('check-schemas', 'Schemas');
if ('exit' in flags) {
  process.exitCode = flags.exit;
} else {
  const report = buildReport(await checkSchemaFiles());
  if (flags.json) writeJson(report);
  else writeLine(formatReport('Schemas', report));
  process.exitCode = exitCode(report);
}
