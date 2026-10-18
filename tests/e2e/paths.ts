// Paths and ports of the e2e harness. Node + Playwright only. Every worker has its own dir under E2E_ROOT; the
// constants below resolve to the CURRENT worker's dir (TEST_PARALLEL_INDEX, set by Playwright before test files load;
// 0 in the runner process, where they are never used).
import path from 'node:path';

export const SOURCE_DATA_DIR = path.resolve('tests', 'data');
/** Override with E2E_ROOT / E2E_BASE_PORT to run two suites side by side (e.g. two agents on different specs). */
export const E2E_ROOT = path.resolve(process.env.E2E_ROOT ?? path.join('.tmp', 'e2e'));
export const E2E_BASE_PORT = Number(process.env.E2E_BASE_PORT ?? 4400);
export const SERVER_ENTRY = path.resolve('dist', 'server', 'entry.mjs');
export const ASTRO_BIN = path.resolve('node_modules', 'astro', 'bin', 'astro.mjs');
export const FAKE_CODE_SOURCE = path.resolve('tests', 'e2e', 'fixtures', 'fake-code.mjs');
/** The origin written into YAML modelines by every e2e server (a constant string, not the port a worker listens on). */
export const E2E_SERVER_ORIGIN = 'http://127.0.0.1:4322';

export interface WorkerPaths {
  root: string;
  data: string;
  ideDir: string;
  ideCommand: string;
  ideRecord: string;
  log: string;
}

export function workerPaths(index: number): WorkerPaths {
  const root = path.join(E2E_ROOT, `w${index}`);
  const ideDir = path.join(root, 'ide');
  return {
    root,
    data: path.join(root, 'data'),
    ideDir,
    ideCommand: path.join(ideDir, 'fake-code'),
    ideRecord: path.join(ideDir, 'calls.jsonl'),
    log: path.join(root, 'server.log'),
  };
}

const current = workerPaths(Number(process.env.TEST_PARALLEL_INDEX ?? '0'));
/** The current worker's data copy (what its server reads and writes). */
export const E2E_DATA_DIR = current.data;
/** Fake IDE ("code"): copied per worker by server.ts; the server runs it via CTXMAN_IDE_COMMAND. */
export const E2E_IDE_COMMAND = current.ideCommand;
/** JSON-lines file: one `process.argv.slice(2)` array per fake-code run (CTXMAN_IDE_RECORD). */
export const E2E_IDE_RECORD = current.ideRecord;

/** Inflate fixtures, shared and read-only (globalSetup creates them once). See plans/INFLATE_V2_SPEC.md §14.2. */
export const E2E_GIT_DIR = path.join(E2E_ROOT, 'git');
export const E2E_GIT_FIXTURE = path.join(E2E_GIT_DIR, 'fixture-repo');
export const E2E_GIT_URI = 'https://e2e.invalid/ctxman/fixture-repo.git';
export const E2E_LOCAL_FIXTURE = path.join(E2E_GIT_DIR, 'local-folder');
/** Request header: the step delay (ms) of ONE Inflate run; honoured because the e2e servers set CTXMAN_TEST_HOOKS=1. */
export const STEP_DELAY_HEADER = 'x-ctxman-step-delay-ms';
