// The e2e `test`: a worker-scoped built server (server.ts) and `baseURL` pointing at it, so `page`, `request` and
// `playwright.request.newContext({ baseURL })` all talk to this worker's own server and data dir.
import { test as base, expect } from '@playwright/test';
import { startWorkerServer } from './server.ts';
import type { WorkerServer } from './server.ts';

export { expect };

export const test = base.extend<Record<never, never>, { server: WorkerServer }>({
  server: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their first argument
    async ({}, use, workerInfo) => {
      const server = await startWorkerServer(workerInfo.parallelIndex);
      try {
        await use(server);
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker', auto: true, timeout: 30_000 },
  ],
  baseURL: async ({ server }, use) => {
    await use(server.url);
  },
});
