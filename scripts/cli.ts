// Shared helpers for the ctxman CLIs (scripts/*.ts). Node 24 built-ins only; no shell, no colors.
import process from 'node:process';
import { parseArgs } from 'node:util';
import { exitCode, formatReport, toReport } from '../src/lib/findings.ts';
import type { Finding, Report } from '../src/lib/findings.ts';
import { resolveDataDir } from '../src/lib/data-dir.ts';

/** Exit codes shared by every CLI: 0 ok, 1 findings or refusal, 2 usage error. */
export const EXIT_OK = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_USAGE = 2;

export interface CheckResult {
  findings: Finding[];
  filesChecked: number;
}
export type CheckFn = (dataDir: string) => Promise<CheckResult>;

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeLine(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeError(text: string): void {
  process.stderr.write(`${text}\n`);
}

export function buildReport(result: CheckResult): Report {
  return toReport(result.findings, result.filesChecked);
}

/** Parses `[--json] [--help]` for the check CLIs. Returns an exit code when the process should stop. */
export function parseCheckFlags(
  script: string,
  title: string,
): { json: boolean } | { exit: number } {
  const usage = `Usage: node scripts/${script}.ts [--json]\n  ${title} check of the data directory (CTXMAN_DATA_DIR or ./data).\n  Exit 0 = no errors, 1 = errors found, 2 = usage error.`;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: false,
      strict: true,
    });
    if (values.help) {
      writeLine(usage);
      return { exit: EXIT_OK };
    }
    return { json: values.json === true };
  } catch (error) {
    writeError(`${script}: ${(error as Error).message}`);
    writeError(usage);
    return { exit: EXIT_USAGE };
  }
}

/** Entry point of check-okf / check-links / check-collections. */
export async function runCheckCli(script: string, title: string, check: CheckFn): Promise<void> {
  const flags = parseCheckFlags(script, title);
  if ('exit' in flags) {
    process.exitCode = flags.exit;
    return;
  }
  const report = buildReport(await check(resolveDataDir()));
  if (flags.json) writeJson(report);
  else writeLine(formatReport(title, report));
  process.exitCode = exitCode(report);
}
