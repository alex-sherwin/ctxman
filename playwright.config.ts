import { defineConfig, devices } from '@playwright/test';
import { E2E_DATA_DIR, E2E_PORT } from './tests/e2e/paths.ts';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --ignore-lock: Astro 7 auto-backgrounds `astro dev` when it detects an AI agent and keeps one
    // tracked server per project via .astro/dev.json; --ignore-lock forces a foreground, untracked
    // server so Playwright owns its lifecycle and a user's own `pnpm run dev` on 4321 is unaffected.
    command: `node tests/e2e/prepare-data.ts && pnpm exec astro dev --port ${E2E_PORT} --ignore-lock`,
    url: `http://127.0.0.1:${E2E_PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { CTXMAN_DATA_DIR: E2E_DATA_DIR, ASTRO_TELEMETRY_DISABLED: '1' },
  },
});
