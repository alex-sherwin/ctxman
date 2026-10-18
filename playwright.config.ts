// E2E: every Playwright worker runs its OWN built server (dist/server/entry.mjs) against its OWN copy of tests/data
// (tests/e2e/fixtures.ts + server.ts). globalSetup builds when dist/ is stale and creates the shared, read-only git
// fixture. Nothing here starts `astro dev`.
import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const defaultWorkers = Math.max(2, Math.min(8, Math.floor(os.availableParallelism() / 2)));

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  workers: process.env.CI ? 2 : defaultWorkers, // override with --workers N
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['json', { outputFile: '.tmp/e2e-report.json' }]],
  timeout: 30_000,
  use: {
    // baseURL comes from the per-worker `server` fixture (tests/e2e/fixtures.ts).
    trace: 'on-first-retry', // debug locally with --trace on
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
