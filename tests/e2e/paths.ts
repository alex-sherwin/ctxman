import path from 'node:path';

/** Repo root = cwd (playwright and npm scripts run from the repo root). */
export const SOURCE_DATA_DIR = path.resolve('data');
export const E2E_DATA_DIR = path.resolve('.tmp', 'e2e-data');
export const E2E_PORT = 4322;

/** Fake IDE ("code") used by api-ide.spec.ts: prepare-data.ts writes it, the dev server runs it via CTXMAN_IDE_COMMAND. */
export const E2E_IDE_DIR = path.resolve('.tmp', 'e2e-ide');
export const E2E_IDE_COMMAND = path.join(E2E_IDE_DIR, 'fake-code');
/** JSON-lines file: one `process.argv.slice(2)` array per fake-code run (CTXMAN_IDE_RECORD). */
export const E2E_IDE_RECORD = path.join(E2E_IDE_DIR, 'calls.jsonl');

/**
 * Inflate-into-a-directory fixtures (plans/INFLATE_V2_SPEC.md §14.2). prepare-data.ts creates a local git repository
 * under E2E_GIT_DIR; the web server reaches it through git's own `url.<file URL>.insteadOf=<E2E_GIT_URI>` (GIT_CONFIG_*
 * env in playwright.config.ts), so reference entries keep a valid https git URI and `clone` needs no network.
 */
export const E2E_GIT_DIR = path.resolve('.tmp', 'e2e-git');
export const E2E_GIT_FIXTURE = path.join(E2E_GIT_DIR, 'fixture-repo');
export const E2E_GIT_URI = 'https://e2e.invalid/ctxman/fixture-repo.git';
/** A plain folder (no git) for `local-repo` references. */
export const E2E_LOCAL_FIXTURE = path.join(E2E_GIT_DIR, 'local-folder');
/** Milliseconds the e2e web server sleeps before each Inflate run step (CTXMAN_INFLATE_STEP_DELAY_MS). */
export const E2E_INFLATE_STEP_DELAY_MS = 300;
