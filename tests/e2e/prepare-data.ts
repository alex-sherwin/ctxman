// Copies ./data to .tmp/e2e-data (fresh each run) so e2e tests can write without touching real data.
// Run by playwright.config.ts webServer.command before `astro dev`. Cross-platform (node:fs only).
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { E2E_DATA_DIR, SOURCE_DATA_DIR } from './paths.ts';

rmSync(E2E_DATA_DIR, { recursive: true, force: true });
mkdirSync(E2E_DATA_DIR, { recursive: true });
if (existsSync(SOURCE_DATA_DIR)) cpSync(SOURCE_DATA_DIR, E2E_DATA_DIR, { recursive: true });
console.log(`[e2e] data copied to ${E2E_DATA_DIR}`);
