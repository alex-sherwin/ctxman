import path from 'node:path';

/** Repo root = cwd (playwright and npm scripts run from the repo root). */
export const SOURCE_DATA_DIR = path.resolve('data');
export const E2E_DATA_DIR = path.resolve('.tmp', 'e2e-data');
export const E2E_PORT = 4322;
