import { pathToFileURL } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import {
  E2E_DATA_DIR,
  E2E_GIT_FIXTURE,
  E2E_GIT_URI,
  E2E_IDE_COMMAND,
  E2E_IDE_RECORD,
  E2E_INFLATE_STEP_DELAY_MS,
  E2E_PORT,
} from './tests/e2e/paths.ts';

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
    env: {
      CTXMAN_DATA_DIR: E2E_DATA_DIR,
      // YAML modelines written during the run point at this server (api-reference.spec.ts asserts the line).
      CTXMAN_SERVER_ORIGIN: `http://127.0.0.1:${E2E_PORT}`,
      ASTRO_TELEMETRY_DISABLED: '1',
      // api-ide.spec.ts: the fake `code` written by prepare-data.ts and the file it records its argv to.
      CTXMAN_IDE_COMMAND: E2E_IDE_COMMAND,
      CTXMAN_IDE_RECORD: E2E_IDE_RECORD,
      // Inflate working-directory runs: the https reference URI E2E_GIT_URI is served by the local fixture
      // repository through git's insteadOf rewrite (no network), and every run step sleeps a little so a
      // cancel can land mid-run (INFLATE_V2_SPEC D10, D16).
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(E2E_GIT_FIXTURE).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: E2E_GIT_URI,
      CTXMAN_INFLATE_STEP_DELAY_MS: String(E2E_INFLATE_STEP_DELAY_MS),
    },
  },
});
