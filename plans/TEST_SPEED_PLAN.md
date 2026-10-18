# Test speed: event-driven, parallel e2e on built servers; a unit suite bounded by its real work

Status: ACTIVE build plan (2026-10-18). Written after Phase 7/8 of `plans/CORE_REFACTOR_PLAN.md` landed (commits `7c3620c`, `7535da6`). When finished, AGENTS.md wins over this file, like every other file in `plans/`. Raw measurements and probe scripts: `/private/tmp/claude-501/-Users-asherwin-repos-ctxman/d06a10ca-22d7-4c21-a090-051134ac32d9/scratchpad/test-speed/` (`NOTES.md`, `e2e-rows.json`, `parse.mjs`, `startprobe.mjs`, `graph.mjs`, `prodgraph.mjs`, `lintprobe/`).

## 0. Summary

**Owner expectation.** "The corpus of things this project does should run VERY FAST for both unit tests and playwright based integration tests. All playwright tests should be using the event system ... NEVER do silly things like setTimeout to wait ... full test suite in a few seconds."

**What is physically achievable (honest).** The unit suite can run in about 4 s, and the API-level e2e specs already take about 3 s. The full browser suite cannot. About 100 tests mount a 4-5 MB Monaco bundle in a brand-new browser context, and about 200 hydrate React islands in a fresh context. Each Playwright test gets its own context with an empty HTTP and code cache. That adds up to at least 60-90 CPU-seconds of browser work, which is at least 6-10 s even with perfect use of 14 cores. Add Chromium and Playwright startup and the realistic floor is about 20 s. **Target: full e2e in 35-45 s at the default worker count, stretch goal about 25 s. Full `test:all` in about 60-75 s, down from 7.1 min.**

**Why it is slow today (root causes, measured):**
1. **The e2e suite runs serially against `astro dev`** (`workers: 1`, `fullyParallel: false`, one Vite dev server). 396 s of test time on one core of a 14-core machine.
2. **Dev-mode page cost.** Every page load pulls unminified dev bundles: react-aria-components 2.2 MB, React dev 0.54 MB, Monaco 4.4 + 2.2 MB, plus 16-82 separately served source modules per island. In the built app the same islands are 230 KB (search) and 4.8 MB (Forge/Inflate, minified). The data backs this up: SSR-only smoke tests take 121 ms (median), island tests about 600 ms, Monaco tests 1.4-2.5 s.
3. **`CTXMAN_INFLATE_STEP_DELAY_MS=300` applies to every run.** Each Inflate run sleeps 300 ms before each of its ~9 steps, so every run test takes 2.8-7 s. Only two tests (busy/cancel and progress) need slow steps at all.
4. **Fixed sleeps and leftovers from the dev-reload era:** 10 sleep sites, 34 calls to no-op settle helpers, polls that make up for the content-layer lag (now gone), `routeWebSocket` HMR freezing, and dev-era 15-30 s timeouts.
5. **Unit suite:** one file, `scripts.test.ts`, runs 38 sequential `spawnSync` calls and takes 16.3 s. That alone is the suite's wall time (17.0 s). Without it the suite takes 5.1 s.

### 0.1 Baseline (measured)

| Measure | Value | Source |
| --- | --- | --- |
| e2e wall | **6.7 min (402 s)**, 348 tests, 1 worker | `test-all-final.log` (`348 passed (6.7m)`) |
| e2e sum of test durations | 396.3 s, so about 6 s outside tests (webServer start, `global-setup` with a fixed 2 s sleep, Monaco warm-up) | parsed from the log |
| e2e by group | Monaco-page specs (inflate, forge, doc-edit, md-popup, forms) 255.5 s · Inflate run specs 60.8 s · other UI 78.4 s · API specs 1.6 s | `e2e-rows.json` |
| e2e medians | smoke 121 ms · detail 602 ms · tools 610 ms · forge 1.9 s · inflate 1.9 s · md-popup 2.2 s · doc-edit 2.4 s | same |
| Built server | ready in **79 ms**; first `GET /` 207 ms, then 3-33 ms per page; whole prod smoke run 0.75 s | `startprobe.mjs`, `time node tests/prod-smoke.ts` |
| Build | `astro build` about 1.5-2 s | log (`Server built in 1.47s`) |
| Unit wall | **17.0 s** (`vitest run`, 83 files, 2109 tests); `scripts.test.ts` alone 16.4 s | `time pnpm exec vitest run` ×3 |
| Unit without `scripts.test.ts` | 5.09 s (forks) · 4.96 s (threads) · 4.48 s (`--no-isolate`, one test fails) | measured |
| Static checks | `astro sync` 0.49 s · `tsc` 0.64 s · `oxlint` 1.65 s · `oxfmt --check` 0.24 s · `check-all` 0.24 s · `check-schemas` 0.17 s | measured |
| `test:all` | about **7.1 min** in the log (the owner reports about 10 min on their runs) | log timestamps |

### 0.2 Target per change (estimates; e2e numbers are serial seconds unless marked wall)

| # | Change | Effect | Confidence |
| --- | --- | --- | --- |
| E1 | e2e against the **built server** (no Vite): one server per worker | UI hydration about 0.5 s down to about 0.12 s per load; Monaco mount about 1.5 s down to about 0.6 s; serial 344 s down to about 190 s; fixed cost −4 s (no 2 s sleep, no dep optimisation, no warm-up) | medium (bundle sizes measured, browser time estimated) |
| E2 | Inflate **step delay opt-in per run** (header test hook) | −45 s serial (api-inflate-run 24 s to about 2 s; inflate-run 37 s to about 14 s) | high |
| E3 | `fullyParallel: true`, workers = half the cores (7 here), isolated data dir per worker | wall ≈ serial / 5 (efficiency 0.7) | medium |
| E4 | doc-edit no longer `serial` (an entry per test) | removes a single 25-30 s group that would otherwise be the critical path | high |
| E5 | 10 sleeps replaced by events | −7 s serial, −2 s fixed | high |
| E6 | `expect.poll` / backoff waits replaced by `waitForResponse` / `waitForFunction` / web-first assertions | −5..10 s serial | low |
| E7 | `trace: 'on-first-retry'` instead of `'retain-on-failure'` (which records always) | −5..15 % per test | low (measure in T1) |
| **E net** | | **402 s down to about 35-45 s wall** (about 25 s at 10 workers) | medium |
| U1 | `scripts.test.ts` split into 4 files with async, concurrent CLI runs | unit wall 17 s down to about 5 s | high (5.09 s measured without the file) |
| U2 | new-entry-store test no longer waits 3 s; inflate-material-exec git describe split and concurrent; mcp-tools shares one corpus copy | unit wall about 5 s down to about 3.5-4 s | medium |
| A | `test:all` reordered (fail-fast static checks first), no second build | about 7.1 min down to about 60-75 s | medium |

### 0.3 Decisions

1. **E2E runs against the built server** (`dist/server/entry.mjs`). `astro dev` is no longer used by any test. The Phase 2 refactor removed every dev-only behaviour the specs relied on (no data watcher; `src` has no `import.meta.env` branch), and `test:prod` already proves the built server's origin check, saves and MCP.
2. **One server per Playwright worker** (worker-scoped fixture), not N `webServer` entries. Each worker gets a private data copy `.tmp/e2e/w<parallelIndex>/data`, a private fake IDE command and record file, and its own port `E2E_BASE_PORT + parallelIndex`. Playwright balances tests across workers dynamically, so no static partition needs maintaining. Shared mutable seed data stops being a cross-test problem, because workers never share a data dir.
3. **`fullyParallel: true`.** Files that really chain state keep `test.describe.configure({ mode: 'serial' })` (Playwright keeps a serial group in one worker). doc-edit gets an entry per test so it can be parallel.
4. **Event rules are binding and linted** (§2.5): no `waitForTimeout`, no `setTimeout`/`setInterval`/`timers/promises` anywhere under `tests/e2e`.
5. **The Inflate step delay becomes per-run** through a request header that only servers started with `CTXMAN_TEST_HOOKS=1` honour. The env default (`CTXMAN_INFLATE_STEP_DELAY_MS`) stays for manual use, but the e2e servers no longer set it.
6. The unit suite keeps its config (pool and isolate options measured within 0.1-0.6 s of each other). The fixes go into the tests.

## 1. Findings

**F1. Serial e2e on one dev server.** Evidence: `playwright.config.ts` has `workers: 1`, `fullyParallel: false` and one `webServer` running `astro dev`. The log shows `Running 348 tests using 1 worker`, and the test durations sum to 396 s of the 402 s wall. Fix: §2.1 (built server per worker, fully parallel).

**F2. Dev-mode page cost dominates per-test time.** Evidence: in `node_modules/.vite/deps`, `react-aria-components.js` is 2.2 MB, `client-*.js` (React dev) 0.54 MB, Monaco `editor.api-*.js` 4.4 MB and `toggleHighContrast-*.js` 2.2 MB, all unminified. The static import graph (`graph.mjs`) has 16 local modules for SearchWidget (on every page), 48 for EntryTools, 73 for Forge and 82 for Inflate, and dev serves each as its own request. Built graphs (`prodgraph.mjs`): SearchWidget 230 KB, EntryTools 424 KB, DocEditor 274 KB, Forge 4.8 MB, Inflate 4.9 MB, minified. Durations line up: smoke (SSR only, no island wait) median 121 ms; tools/detail (island wait) about 600 ms; Monaco pages 1.4-2.5 s. Fix: E1. Unverified: the real per-test gain in the browser. T1 measures it with the first full run on the new harness.

**F3. A global 300 ms step delay on every Inflate run.** Evidence: `playwright.config.ts` env sets `CTXMAN_INFLATE_STEP_DELAY_MS`, and `src/pages/api/inflate/run.ts` passes `stepDelayFromEnv()` to every run. In api-inflate-run every run test takes 2.8-3.6 s while plan and contract tests take 9-54 ms; inflate-run tests that run take 3.0-7.0 s. Only "busy and cancel › a second run while one is in progress is 409 busy…", "Run view › Cancel stops the run…" and "Run view › Run places the material with live progress…" need slow steps. Fix: §2.2 header hook; cancel tests use a long delay (the sleep is aborted by cancel, so it costs nothing); the progress test uses 300 ms; everything else 0.

**F4. Fixed sleeps (10 sites).** Every one is listed in Appendix A with its replacement. The biggest: doc-edit `waitForTimeout(2500)` (proves "no second reload", already covered by `tests/unit/doc-editor.test.ts` › "the page after a save (one reload, no settle reloads)"), `global-setup.ts` `waitForTimeout(2000)` plus a Monaco warm-up (only needed for Vite's first-connection reload), forge's 1000 ms route delay, and two 800 ms waits.

**F5. Dev-reload-era leftovers.** 26 `settleDevReload()` and 8 `settleAfter()` calls in 15 files (no-ops since Phase 2). Also: `routeWebSocket(/.*/)` ×2 in doc-edit (freezes Vite HMR, which the built server does not have); `expectPreviewShows` in doc-edit with a 12 s manual-reload fallback for the "settle reload"; the doc-edit `beforeAll` polling for HTTP 200 (glob loader lag); `createReference` in forms polling `/api/entries`; and two api-reference polls ("…shows up … within 5 s"). Reads come from disk on every request now, so each of these is a single assertion. Fix: Appendix A.

**F6. `expect.poll` and assertion backoff.** 47 `expect.poll` calls. Their default intervals are [100, 250, 500, 1000], so a condition that becomes true after 0.9 s is seen at about 1.85 s. Locator assertions retry at [0, 20, 50, 100, 100, 500…] (playwright-core `retryWithProgressAndBackoff`). Polls on disk state right after a save can instead await the save response (the server writes before it answers). Polls on DOM order become `page.waitForFunction` (checked every animation frame). Polls on focus become `expect(page.locator(':focus'))…`. Fix: §2.3 helpers, §2.4 rules.

**F7. Trace recording on every test.** `trace: 'retain-on-failure'` records DOM snapshots and screencast frames for every test and discards them on success. Fix: `'on-first-retry'` (retries are 0 locally, so nothing is recorded; CI retries once with a trace). To debug locally, run `pnpm exec playwright test <spec> --trace on`. The saving is unmeasured; T1 A/B-measures it.

**F8. Serial files.** `mode: 'serial'` is set at file level in api-doc, api-entry, api-ide, api-inflate-run, doc-edit, entry-tools, inflate-run and relations, and on one describe each in forms and list-filters. Under `fullyParallel` each is a single scheduling unit. doc-edit (21 tests, 44 s in dev, about 25-30 s built) would be the critical path, and its tests share one entry only for convenience. Fix: E4 (an entry per test, no serial). inflate-run stays serial: "a reload with job= shows the same run…" reuses `firstJobId` from an earlier test.

**F9. Shared files that break under parallel workers.** api-ide renames `E2E_IDE_COMMAND` to test the 501 path, and every IDE test appends to one `calls.jsonl`. api-reference asserts a modeline with `E2E_PORT`. Fix: the fake IDE command and record file move to the worker dir; the modeline origin becomes the constant `E2E_SERVER_ORIGIN` (`http://127.0.0.1:4322`, an origin string, not a listening port). The git fixture and the local folder are only read, so they stay shared (`.tmp/e2e/git`, created once in `globalSetup`).

**F10. Long timeouts tuned for dev.** 68 per-assertion timeouts of 10-60 s (Monaco first mount under the dev optimizer, dev reloads) and 7 `test.setTimeout(90_000)` in api-inflate-run. They only cost time on failure, but they make failures slow and hide regressions. Fix: per-assertion timeouts drop to the default, except a single 15 s cap on a first Monaco mount. `test.setTimeout(90_000)` goes once the runs are fast.

**F11. Unit: `scripts.test.ts` is the whole wall time.** Evidence: 16.3 s in the suite and 16.44 s alone. It makes 38 sequential `spawnSync(process.execPath, scripts/*.ts)` calls at about 0.18-0.2 s each (one CLI start measured at 0.16-0.19 s). One test, "add-entry.ts › exits 2 on usage errors and writes nothing", does 17 spawns in a loop (3.4 s). `vi.setConfig({ testTimeout: 60_000 })`. Fix: §2.6 U1.

**F12. Unit: one test waits 3 s for a timeout.** new-entry-store.test.ts › "a second press while sending is ignored" takes 3055 ms. Its stub lists no `fresh` task, so `waitForEntry` runs into `LISTED_TIMEOUT_MS = 3000` (`src/stores/new-entry.ts`). The "parked navigation" and `waitForEntry` are themselves dev-reload workarounds: Phase 2 removed the same pattern from `data-form.ts`. Fix: test-only first (U2a); the app simplification is Should (C3).

**F13. Unit: real git and corpus copies.** inflate-material-exec takes 4.56 s, of which the "git steps (real git, local file:// fixture)" describe is 3.45 s. mcp-tools takes 3.53 s with `copyCorpus()` in `beforeEach` for 32 tests. Fix: U2b/U2c (split the git describe into its own file and run its independent cases concurrently; read-only mcp-tools tests share one copy).

**F14. `test:all` does redundant or late work.** The order is typecheck, lint, fmt, test, check, build, prod, e2e: slow unit tests run before the 0.25 s formatter check, and the e2e runner then starts its own `astro dev` with dependency optimisation ("Re-optimizing dependencies because vite config has changed" appears at every start in the log). Fix: §2.7 (fail-fast order; the e2e global setup reuses a fresh `dist/`).

**F15. What does NOT matter (measured).** Vitest fixed cost (a trivial file runs in 0.62 s end to end, `getViteConfig` included), pool choice (forks vs threads −0.1 s), the static checks (≤ 1.7 s each), the build (about 2 s), and built-server startup (79 ms).

## 2. Target design

### 2.1 E2E harness (built server per worker)

**`playwright.config.ts`** (complete file):

```ts
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
```

**`tests/e2e/paths.ts`** (complete file; module-level constants are evaluated in the worker, where Playwright sets `TEST_PARALLEL_INDEX` before it loads any test file, as `workerProcessEntry.js` shows):

```ts
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
```

`E2E_PORT`, `E2E_IDE_DIR`, `E2E_INFLATE_STEP_DELAY_MS` and `E2E_DATA_DIR = .tmp/e2e-data` disappear. api-reference.spec.ts switches to `E2E_SERVER_ORIGIN`.

**`tests/e2e/server.ts`** (new):

```ts
// One built ctxman server per Playwright worker: a fresh copy of tests/data, a private fake IDE command, its own port.
// Readiness is the adapter's "Server listening on" line (an event, no polling); a server that exits first fails fast.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, cpSync, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  E2E_BASE_PORT, E2E_GIT_FIXTURE, E2E_GIT_URI, E2E_SERVER_ORIGIN, FAKE_CODE_SOURCE, SERVER_ENTRY,
  SOURCE_DATA_DIR, workerPaths,
} from './paths.ts';

export interface WorkerServer {
  url: string;
  stop(): Promise<void>;
}

export async function startWorkerServer(index: number): Promise<WorkerServer> {
  const p = workerPaths(index);
  rmSync(p.root, { recursive: true, force: true });
  cpSync(SOURCE_DATA_DIR, p.data, { recursive: true });
  mkdirSync(p.ideDir, { recursive: true });
  copyFileSync(FAKE_CODE_SOURCE, p.ideCommand);
  chmodSync(p.ideCommand, 0o755);
  const port = E2E_BASE_PORT + index;
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: process.cwd(), // the repo root: /api/scripts runs scripts/*.ts relative to it
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CTXMAN_DATA_DIR: p.data,
      CTXMAN_SERVER_ORIGIN: E2E_SERVER_ORIGIN,
      CTXMAN_IDE_COMMAND: p.ideCommand,
      CTXMAN_IDE_RECORD: p.ideRecord,
      CTXMAN_TEST_HOOKS: '1',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(E2E_GIT_FIXTURE).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: E2E_GIT_URI,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const log = createWriteStream(p.log);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  const killOnExit = (): void => void child.kill('SIGKILL');
  process.once('exit', killOnExit);
  await new Promise<void>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('Server listening on')) resolve();
    });
    child.once('exit', (code) =>
      reject(new Error(`e2e server w${index} (port ${port}) exited with ${code} before listening; see ${p.log}`)),
    );
  });
  const url = `http://127.0.0.1:${port}`;
  await (await fetch(`${url}/`)).text(); // warm the markdown renderer once (first GET / measured 207 ms, later 3-33 ms)
  return {
    url,
    async stop() {
      process.off('exit', killOnExit);
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    },
  };
}
```

**`tests/e2e/fixtures.ts`** (new; every spec imports `test`/`expect` from here; enforced by lint, §2.5):

```ts
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
```

**`tests/e2e/global-setup.ts`** (complete file; replaces the browser warm-up; `prepare-data.ts` is deleted, and its fake-code part moves to server.ts):

```ts
// Before any worker: (1) make sure dist/ is a build of the current sources (E2E_BUILD=auto|always|never, default
// auto: rebuild when any input is newer than dist/server/entry.mjs); (2) create the shared, read-only Inflate
// fixtures (a local git repo reached through git's insteadOf env, and a plain folder). Cross-platform, node:fs only.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ASTRO_BIN, E2E_GIT_DIR, E2E_GIT_FIXTURE, E2E_LOCAL_FIXTURE, E2E_ROOT, SERVER_ENTRY } from './paths.ts';

const BUILD_INPUTS = ['src', 'public', 'astro.config.ts', 'package.json', 'pnpm-lock.yaml', 'tsconfig.json'];

function newestMtime(p: string): number {
  if (!existsSync(p)) return 0;
  const st = statSync(p);
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = st.mtimeMs; // a deleted file bumps its parent dir
  for (const name of readdirSync(p)) newest = Math.max(newest, newestMtime(path.join(p, name)));
  return newest;
}

function ensureBuild(): void {
  const mode = process.env.E2E_BUILD ?? 'auto';
  const built = existsSync(SERVER_ENTRY) ? statSync(SERVER_ENTRY).mtimeMs : 0;
  const stale = built === 0 || Math.max(...BUILD_INPUTS.map(newestMtime)) > built;
  if (mode === 'never' || (mode === 'auto' && !stale)) {
    if (built === 0) throw new Error('dist/server/entry.mjs is missing: run pnpm run build');
    return;
  }
  const result = spawnSync(process.execPath, [ASTRO_BIN, 'build'], { stdio: 'inherit', shell: false });
  if (result.status !== 0) throw new Error(`astro build failed (${result.status})`);
}

function gitFixture(): void {
  rmSync(E2E_GIT_DIR, { recursive: true, force: true });
  mkdirSync(path.join(E2E_GIT_FIXTURE, 'docs'), { recursive: true });
  writeFileSync(path.join(E2E_GIT_FIXTURE, 'README.md'), '# fixture repo\n');
  writeFileSync(path.join(E2E_GIT_FIXTURE, 'docs', 'guide.md'), '# Guide\n');
  mkdirSync(E2E_LOCAL_FIXTURE, { recursive: true });
  writeFileSync(path.join(E2E_LOCAL_FIXTURE, 'README.md'), '# local folder\n');
  const steps = [
    ['init', '-q', '-b', 'trunk'],
    ['add', '-A'],
    ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-qm', 'fixture'],
  ];
  for (const args of steps) {
    const r = spawnSync('git', args, { cwd: E2E_GIT_FIXTURE, shell: false, encoding: 'utf8' });
    if (r.status !== 0) {
      // Without git the fixture has no .git: the inflate run specs skip their clone cases.
      rmSync(path.join(E2E_GIT_FIXTURE, '.git'), { recursive: true, force: true });
      console.warn(`[e2e] git ${args.join(' ')} failed (${r.error?.message ?? r.stderr})`);
      return;
    }
  }
}

export default function globalSetup(): void {
  ensureBuild();
  rmSync(E2E_ROOT, { recursive: true, force: true }); // per-worker dirs are recreated by server.ts
  gitFixture();
}
```

Cleaning `E2E_ROOT` before `gitFixture()` is intentional: it also removes the worker dirs of earlier runs.

**What changes for specs (T1 does the mechanical part):**
* `import { expect, test } from '@playwright/test'` becomes `import { expect, test } from './fixtures.ts'` in every `*.spec.ts`. Type imports (`import type { Page } …`) stay.
* `api-reference.spec.ts`: `E2E_PORT` becomes `E2E_SERVER_ORIGIN` in `MAGIC_COMMENT`.
* `E2E_DATA_DIR`, `dataPath()`, `E2E_IDE_RECORD` and `E2E_IDE_COMMAND` keep their names and point at the worker's own copy.
* Dev-only behaviour that disappears and needs no replacement: Vite's first-connection reload, dependency re-optimisation, HMR websockets, dev React warnings. `src` has no `import.meta.env` branch. Env lookups (`CTXMAN_*`, `GIT_CONFIG_*`) are read at runtime by the built server.

### 2.2 App-side test hook: per-run Inflate step delay

`src/lib/inflate/jobs.ts` (SERVER), added next to `stepDelayFromEnv`:

```ts
/** Request header: the step delay of ONE run (test hook). Honoured only when CTXMAN_TEST_HOOKS=1 (the e2e servers). */
export const STEP_DELAY_HEADER = 'x-ctxman-step-delay-ms';
export const TEST_HOOKS_ENV = 'CTXMAN_TEST_HOOKS';

/** The step delay of a run: the header (test hooks on), else CTXMAN_INFLATE_STEP_DELAY_MS, else 0. Same 0..5000 rule. */
export function stepDelayFor(headers: Headers, env: NodeJS.ProcessEnv = process.env): number {
  if (env[TEST_HOOKS_ENV] === '1') {
    const raw = headers.get(STEP_DELAY_HEADER)?.trim();
    if (raw !== undefined && /^\d{1,4}$/.test(raw) && Number(raw) <= STEP_DELAY_MAX_MS) return Number(raw);
  }
  return stepDelayFromEnv(env);
}
```

`src/pages/api/inflate/run.ts`: `stepDelayMs: stepDelayFromEnv()` becomes `stepDelayMs: stepDelayFor(request.headers)`. Unit tests (`tests/unit/inflate-jobs.test.ts`): the header is ignored without the env; honoured with it; invalid or > 5000 falls back to the env value; no header falls back to the env. Delays are aborted by cancel (`sleep(ms, signal)` in `material-exec.ts`), so a cancel test can use a long delay without waiting for it.

### 2.3 Helpers (`tests/e2e/helpers.ts`, added by T1; existing exports keep their names)

```ts
import { statSync, utimesSync } from 'node:fs';
import type { Response } from '@playwright/test';

/** The next response to `method` whose pathname starts with `pathPrefix`. Create it BEFORE the action that sends it. */
export function waitForApi(page: Page, method: string, pathPrefix: string): Promise<Response> {
  return page.waitForResponse(
    (r) => r.request().method() === method && new URL(r.url()).pathname.startsWith(pathPrefix),
  );
}

/** Runs `action` and returns the API response it caused (listener first: no race). The file is on disk once it resolves. */
export async function afterApi(
  page: Page, method: string, pathPrefix: string, action: () => Promise<void>,
): Promise<Response> {
  const response = waitForApi(page, method, pathPrefix);
  await action();
  return response;
}

/** Runs `action` (a save, a state change, a create) and resolves after the page has loaded again (it reloads itself). */
export async function afterReload(page: Page, action: () => Promise<void>): Promise<void> {
  const loaded = page.waitForEvent('load');
  await action();
  await loaded;
}

/** Moves a data file's mtime `ms` past its current one, so a conflict check sees a change without sleeping. */
export function bumpMtime(rel: string, ms = 2000): void {
  const file = dataPath(rel);
  const t = new Date(statSync(file).mtimeMs + ms);
  utimesSync(file, t, t);
}

/** A latch for `page.route`: hold a request until the test has seen the in-between state, then `open()`. */
export function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

/** Polls Node-side state that has no event (an Inflate job, the fake IDE record) every 25 ms; returns the last value. */
export async function pollUntil<T>(read: () => Promise<T> | T, done: (v: T) => boolean, timeout = 15_000): Promise<T> {
  let last!: T;
  await expect
    .poll(async () => done((last = await read())), { intervals: [25], timeout })
    .toBe(true);
  return last;
}

/** Waits (every animation frame, in the page) until the `attr` values of `selector` equal `expected`, in order. */
export async function expectOrder(page: Page, selector: string, attr: string, expected: string[]): Promise<void> {
  const read = (): Promise<string[]> =>
    page.$$eval(selector, (els, a) => els.map((e) => e.getAttribute(a) ?? ''), attr);
  try {
    await page.waitForFunction(
      ([sel, a, want]) =>
        JSON.stringify([...document.querySelectorAll(sel)].map((e) => e.getAttribute(a) ?? '')) === JSON.stringify(want),
      [selector, attr, expected] as const,
      { timeout: 5_000 },
    );
  } catch {
    expect(await read()).toEqual(expected); // readable failure
  }
}

/** Gives every Inflate run started from `page` a per-step delay (the server honours it under CTXMAN_TEST_HOOKS=1). */
export async function slowInflateSteps(page: Page, ms: number): Promise<void> {
  await page.route('**/api/inflate/run', (route) =>
    route.continue({ headers: { ...route.request().headers(), [STEP_DELAY_HEADER]: String(ms) } }),
  );
}
```

The comment on `nextPageLoad` becomes "the page reloads itself ~150 ms after a write". `settleDevReload` and `dev-reload.ts` are deleted in Wave 3 (C1), once Wave 2 has removed every call.

### 2.4 Rules for specs (binding; they go into AGENTS.md, §4)

1. **No fixed waits.** No `waitForTimeout`, `setTimeout`, `setInterval` or `timers/promises` in `tests/e2e/**`, including inside `page.evaluate`. Lint enforces it (§2.5).
2. **Action → request:** create `waitForApi(page, method, path)` / `page.waitForResponse(...)` BEFORE the action, await it after, assert its status, then read the data file once (the server writes before it answers). Do not `expect.poll` a data file after a UI save.
3. **Action → reload or navigation:** `afterReload(page, action)` / `nextPageLoad(page)` (listener first), `expect(page).toHaveURL(...)` or `page.waitForURL(...)`.
4. **DOM state:** web-first assertions (`toBeVisible`, `toHaveText([...])`, `toHaveAttribute`, `toHaveCount`, `toBeFocused`, `toHaveValue`, `toHaveCSS`). Focus: `expect(page.locator(':focus')).toHaveAttribute('aria-label', /^Insert /)`. Row order: `expectOrder(page, selector, 'data-key', keys)`. Never `expect.poll(() => locator.count())` or `expect.poll(() => page.evaluate(...))`.
5. **Page state that is not DOM** (localStorage drafts, globals): `page.waitForFunction(fn, arg)` (rAF polling inside the page).
6. **Node-side state with no event** (Inflate job status over the API, the fake IDE record file): `pollUntil(read, done)` (25 ms). It is the only polling primitive allowed.
7. **"The file changed on disk":** write it, then `bumpMtime(rel)`. Never sleep so the clock moves.
8. **"Nothing happens within T ms":** call `page.clock.install()` before `goto` and `await page.clock.runFor(T)` before asserting. Better still, move the invariant to a unit test with `vi.useFakeTimers()`.
9. **Loading or in-between states:** hold the request with `page.route(url, async (r) => { await g.wait; await r.continue(); })` + `gate()`, assert, `g.open()`.
10. **Slow or cancellable Inflate runs:** `slowInflateSteps(page, ms)` / `{ headers: { [STEP_DELAY_HEADER]: '250' } }` on the API call, only in the tests that need it. A step is `running` during its delay and cancel aborts the delay, so a cancel test never waits for it to run out; pick a delay longer than the UI poll (500 ms) when the browser must see a running step. Everything else runs at 0.
11. **Isolation:** each worker owns its server and data dir; tests in a file may run in different workers. Use `test.describe.configure({ mode: 'serial' })` only for a real chain (a later test reads what an earlier one produced) and say why in a comment. Module-level `uniqueName()` entries made in `beforeAll` must be removed in `afterAll` (under `fullyParallel` the hooks run around every test group). Never write seed entries; copy them first (`createRecipeCopy`).
12. **Timeouts:** the defaults (assertion 5 s, test 30 s). One exception: a first Monaco mount may take `{ timeout: 15_000 }`. No `test.setTimeout` increases.
13. **New specs** import `test`/`expect` from `./fixtures.ts` and start no servers of their own. No `routeWebSocket` to freeze HMR (there is none).

### 2.5 Lint guard (`.oxlintrc.json`, two overrides appended to `overrides`; verified on oxlint 1.88 in `lintprobe/`)

```jsonc
{
  // e2e: no fixed sleeps, and the per-worker `test` (AGENTS.md Testing rules).
  "files": ["tests/e2e/**/*.ts"],
  "rules": {
    "no-restricted-properties": [
      "error",
      { "property": "waitForTimeout", "message": "No fixed sleeps in e2e: wait for an event (waitForApi, afterReload, a web-first assertion). See AGENTS.md Testing rules." }
    ],
    "no-restricted-globals": [
      "error",
      {
        "globals": [
          { "name": "setTimeout", "message": "No timers in e2e (also not inside page.evaluate): wait for an event; page.clock for 'nothing happens'." },
          { "name": "setInterval", "message": "No timers in e2e: wait for an event or pollUntil()." }
        ],
        "checkGlobalObject": true
      }
    ],
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          { "name": "node:timers/promises", "message": "No timer sleeps in e2e." },
          { "name": "timers/promises", "message": "No timer sleeps in e2e." },
          { "name": "node:timers", "message": "No timers in e2e." },
          { "name": "@playwright/test", "importNames": ["test"], "message": "Import test from ./fixtures.ts (per-worker server and baseURL)." },
          { "name": "zod", "message": "ctxman validates with arktype (src/datasets/schemas.ts + validate.ts)" }
        ]
      }
    ]
  }
},
{
  // The fixture module itself extends Playwright's test.
  "files": ["tests/e2e/fixtures.ts"],
  "rules": {
    "no-restricted-imports": ["error", { "paths": [{ "name": "node:timers/promises", "message": "No timer sleeps in e2e." }] }]
  }
}
```

The probe confirms that `test.setTimeout(...)` and `import type { Page } from '@playwright/test'` are not flagged. `window.setTimeout` inside `page.evaluate` is flagged, and so is `node:timers/promises`. oxlint has no `no-restricted-syntax`; these three rules cover the cases. Optional (Nice): `eslint-plugin-playwright` through `jsPlugins` (`playwright/missing-playwright-await`, `no-wait-for-timeout`, `prefer-web-first-assertions`). It is a new devDependency, so it is recorded in AGENTS.md if added.

### 2.6 Unit suite

**`vitest.config.ts`: unchanged.** The pool comparison (5.09 / 4.96 / 4.48 s, the last with a failure) and the 0.62 s trivial run show the config is not the bottleneck. Do not set `isolate: false` (`schema-check.test.ts` fails without isolation).

**U1 `scripts.test.ts`** becomes four files sharing `tests/unit/fixtures/run-cli.ts`:

```ts
// tests/unit/fixtures/run-cli.ts: run scripts/<script> with Node (type stripping) against a temp data dir, async.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export interface Run { code: number | null; stdout: string; stderr: string }

export async function runCli(script: string, dataDir: string, ...args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(repoRoot, 'scripts', script), ...args], {
      cwd: repoRoot,
      env: { ...process.env, CTXMAN_DATA_DIR: dataDir, NO_COLOR: '1' },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: unknown; stdout?: string; stderr?: string };
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
```

* Files: `scripts-check.test.ts` ("CTXMAN_DATA_DIR is required", `check-all.ts`, "check-okf / check-links / check-collections"), `scripts-add-entry.test.ts` (`add-entry.ts`), `scripts-fix-yaml.test.ts` (`fix-yaml-comments.ts`), `scripts-schemas.test.ts` ("check-schemas.ts / gen-schemas.ts"). Every `describe` becomes `describe.concurrent`. Use the test-context `expect` (`async ({ expect }) => …`) in concurrent tests.
* **`tmp.cleanup()` moves from `afterEach` to `afterAll`.** `trackTemp().cleanup()` removes every tracked dir, so with concurrency it would delete other tests' temp dirs mid-run.
* "exits 2 on usage errors and writes nothing": `const results = await Promise.all(cases.map((args) => runCli('add-entry.ts', dir, ...args)))`, then assert each one in order.
* Drop `vi.setConfig({ testTimeout: 60_000 })` in favour of the default plus `{ timeout: 20_000 }` on the describes that spawn.
* Same 34 tests, same assertions. Target: no single file above 2 s; unit wall about 5 s.

**U2a** new-entry-store.test.ts › "a second press while sending is ignored": add `env.listed.task.push('fresh')` before `submitNewEntry()`, so `waitForEntry` resolves at once (or use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`). 3.05 s down to about 0.01 s.

**U2b** inflate-material-exec.test.ts: the "git steps (real git, local file:// fixture)" describe moves to `inflate-material-exec-git.test.ts`, with `describe.concurrent` on the cases that use their own temp repos. Shared helpers move to `tests/unit/fixtures/inflate-exec.ts` if both files need them. Target: neither file above 2 s.

**U2c** mcp-tools.test.ts: tests that only read share one `copyCorpus()` in `beforeAll` of a `describe('read-only tools')`; writing tests keep a copy per test. Target ≤ 2 s.

### 2.7 Commands (`package.json`)

```jsonc
"test:fast": "pnpm run fmt:check && pnpm run lint && pnpm run typecheck && pnpm run test",
"test:e2e": "playwright test",
"test:all": "pnpm run test:fast && pnpm run check && pnpm run build && pnpm run test:prod && pnpm run test:e2e",
```

`test:e2e` builds by itself when `dist/` is stale (globalSetup `ensureBuild`). Inside `test:all` the build is fresh, so nothing is built twice. `test:prod` stays: it is the framework-free check of the built server (0.75 s). No inline env vars are needed, which keeps the scripts cross-platform. Optional (Nice): `"test:e2e:api": "playwright test api"` for an inner loop of about 3 s.

## 3. Execution model (for the orchestrator)

* **Precondition:** no other agent edits `tests/e2e`, `tests/unit`, `src/lib/inflate/jobs.ts`, `src/pages/api/inflate/run.ts` or `package.json` meanwhile. Phase 7/8 are committed; the kit refactor (`e77d1b9`) touches only `src/ui`. Re-grep the sleep sites (Appendix A) before Wave 2, because spec text may have moved.
* Agents are **sonnet / high** and get this file plus AGENTS.md; agents do NOT commit; the orchestrator commits **one conventional commit per wave**. Never `git add -A`.
* **E2E runs during the waves:** only T1 runs the full suite (its acceptance), and it starts only after T4 reports done. In Wave 2 the orchestrator runs `pnpm run build` once first. Each agent then runs ONLY its own spec files, with a private port range and dir: `E2E_BUILD=never E2E_BASE_PORT=<45x0> E2E_ROOT=.tmp/e2e-<task> pnpm exec playwright test <its specs> --output test-results/<task>` (B1 4500, B2 4520, B3 4540, B4 4560). No agent runs `pnpm run test:e2e` in Wave 2 or 3.
* **ONE validation checkpoint, at the end** (haiku / xhigh): `pnpm run test`, then `pnpm run test:e2e` twice (the second run catches parallel flakiness), then `pnpm run test:all`. It reports wall times and must meet the budgets: unit ≤ 6 s, e2e ≤ 60 s at the default workers on the M4 Pro (target 35-45 s), `test:all` ≤ 90 s. Failures go back to the owning task's agent (SendMessage).

### Wave 1: harness, unit hot spots, Inflate hook (4 agents in parallel, disjoint files)

| Task | Pri / size | Files (exclusive) | Before → after | Acceptance |
| --- | --- | --- | --- | --- |
| **T1 E2E harness** | Must / L | `playwright.config.ts`; `tests/e2e/{paths,global-setup,helpers}.ts`; new `tests/e2e/{server,fixtures}.ts`; delete `tests/e2e/prepare-data.ts`; in EVERY `tests/e2e/*.spec.ts` only the `@playwright/test` value import line (→ `./fixtures.ts`); `api-reference.spec.ts` `E2E_PORT` → `E2E_SERVER_ORIGIN`; `fullyParallel` fallout (a `serial` mark plus a one-line reason, or a matching `afterAll` cleanup) in any spec | one `astro dev`, 1 worker → a built server per worker, fully parallel (§2.1, §2.3). Keep `CTXMAN_INFLATE_STEP_DELAY_MS: '300'` in `server.ts` env for now (B1 removes it), plus `CTXMAN_TEST_HOOKS: '1'`; keep the settle no-ops | `pnpm run typecheck && pnpm run lint && pnpm run fmt:check`; after T4 is done: `pnpm exec playwright test --output test-results/t1` green twice in a row. Report the wall time, the per-file totals (`.tmp/e2e-report.json`), and one A/B of `--trace retain-on-failure` vs the default (E7) |
| **T2 Unit CLI tests** | Must / S | `tests/unit/scripts.test.ts` (delete) → `scripts-{check,add-entry,fix-yaml,schemas}.test.ts`; new `tests/unit/fixtures/run-cli.ts`; `tests/unit/new-entry-store.test.ts` | U1 + U2a (§2.6) | `pnpm run test` green, same test count (+0), `time pnpm run test` ≤ 7 s; no file above 2 s in `--reporter=verbose` |
| **T3 Unit polish** | Should / S | `tests/unit/inflate-material-exec.test.ts` → + `inflate-material-exec-git.test.ts` (+ `tests/unit/fixtures/inflate-exec.ts` if needed); `tests/unit/mcp-tools.test.ts` | U2b + U2c | same test count; each of these files ≤ 2 s; unit wall ≤ 5 s together with T2 |
| **T4 Inflate step-delay hook** | Must / S | `src/lib/inflate/jobs.ts`, `src/pages/api/inflate/run.ts`, `tests/unit/inflate-jobs.test.ts` | §2.2 | `pnpm run typecheck && pnpm run lint && pnpm exec vitest run tests/unit/inflate-jobs.test.ts` green; report done to the orchestrator BEFORE T1's acceptance run |

Commit: `test: e2e on a built server per worker (fully parallel), concurrent CLI unit tests, per-run Inflate step delay hook`.

### Wave 2: specs follow the event rules (4 agents in parallel, partitioned by spec file)

Each task: apply its Appendix A rows; delete every `settleAfter`/`settleDevReload` call and import; turn polls into events (§2.4); drop dev-era per-assertion timeouts (rule 12); rewrite comments that mention the dev reload, glob loader, content layer or HMR. Do NOT edit `helpers.ts`, `fixtures.ts`, `server.ts` or `paths.ts` (if a helper is missing, define it locally and report it). Tests keep their titles unless a title describes removed behaviour; such renames are listed in the report.

| Task | Pri / size | Files (exclusive) | Main changes | Acceptance (own specs only, private ports, see above) |
| --- | --- | --- | --- | --- |
| **B1 Inflate runs** | Must / M | `tests/e2e/api-inflate-run.spec.ts`, `tests/e2e/inflate-run.spec.ts`, `tests/e2e/server.ts` (only remove the `CTXMAN_INFLATE_STEP_DELAY_MS` env line) | runs at 0 delay; the busy/cancel API test sends header `250` on its first run, `pollUntil` a non-`dir` step is running, then cancels; UI Cancel: `slowInflateSteps(page, 600)` (the run would last about 5 s; Cancel aborts the current sleep at once); UI live-progress: `slowInflateSteps(page, 300)`; `waitFor()` → `pollUntil`; remove the 7 `test.setTimeout(90_000)`; job-end waits keep `{ timeout: 15_000 }` at most | both files green; api-inflate-run ≤ 4 s, inflate-run ≤ 15 s serial (report) |
| **B2 Editors** | Must / M | `tests/e2e/doc-edit.spec.ts`, `tests/e2e/md-popup.spec.ts` | doc-edit: replace the file-level `beforeAll` entry with a test-scoped fixture (`test.extend<{ doc: { name, main, note, notePage } }>`) that creates a fresh entry per test (`POST /api/entry/kb` + write the concept file) and removes it afterwards; drop `mode: 'serial'`; delete `expectPreviewShows` (plain `toContainText`), the `beforeAll` poll for 200, both `routeWebSocket`; sleeps → Appendix A | both files green twice; doc-edit wall at 4 workers ≤ 10 s |
| **B3 Forge, Inflate, forms** | Must / M | `tests/e2e/forge.spec.ts`, `tests/e2e/inflate.spec.ts`, `tests/e2e/forms.spec.ts` | forge route delay → `gate()`; `savedKeys`/`savedContext`/`dataExists` polls after a UI save → `afterApi(...)` then one read; `linkKeys`/`segmentKeys` polls → `expectOrder`; `focusedLabel` polls → `:focus` assertions; forms `createReference` poll → one `/api/entries` assertion; forms parked-nav `waitForTimeout(800)` → Appendix A | the three files green |
| **B4 The rest** | Must / S-M | `tests/e2e/{search,detail,entry-tools,list-filters,relations,select,tools,smoke,recipe,shortcuts,api,api-doc,api-entry,api-ide,api-inflate,api-reference,api-schemas}.spec.ts` | search sleep → `page.clock`; api-reference polls → single asserts (title: "…shows up at once…"); api-ide record polls → `pollUntil`; select `expect.poll(transform)` → `toHaveCSS('transform', …)`; list-filters "dev reload" waits → `afterReload`; settle calls removed | these files green |

Commit: `test(e2e): event-driven waits everywhere; no sleeps, no settle helpers, no dev-era polls`.

### Wave 3: guard, docs, cleanup (3 agents in parallel)

| Task | Pri / size | Files (exclusive) | Change | Acceptance |
| --- | --- | --- | --- | --- |
| **C1 Lint guard + helper removal** | Must / S | `.oxlintrc.json`, `tests/e2e/dev-reload.ts` (delete), `tests/e2e/helpers.ts` (remove `settleDevReload`) | §2.5 | `pnpm run lint` 0 findings; `grep -rn "settleAfter\|settleDevReload\|waitForTimeout\|setTimeout(" tests/e2e` finds only `test.setTimeout` (if any) |
| **C2 Commands + docs** | Must / S | `package.json` (scripts only), `AGENTS.md`, `tests/data/kb/ctxman/concepts/{runtime-modes,editing,architecture}.md`, `tests/data/kb/ctxman/log.md` | §2.7 and §4 | `CTXMAN_DATA_DIR=tests/data pnpm run check` 0/0; `pnpm run fmt:check` |
| **C3 New-entry navigation simplification** | Should / S | `src/stores/new-entry.ts`, `src/stores/entries.ts` (`waitForEntry`, if unused afterwards), `tests/unit/new-entry-store.test.ts`, `tests/e2e/forms.spec.ts` (delete the "a fresh parked navigation…" test) | after a 201, `location.assign(url)` at once (disk-truth reads make the wait and the sessionStorage park obsolete, as Phase 2 did for `data-form.ts`); delete `NAV_KEY`, `resumeNavigation`, `LISTED_TIMEOUT_MS` and their unit tests | `pnpm run test` green; forms.spec green on private ports; C2 removes `waitForEntry` from the AGENTS.md "Shared editing layer" line (decided up front: it is deleted) |

Commit: `chore(test): lint guard against e2e sleeps; docs and commands for the parallel suite`. If C3 is done: `refactor(ui): new-entry navigates at once after a create` as a separate commit in the same wave (it is an app change).

**Final checkpoint** (see above). Then one `fix:` commit if needed.

## 4. AGENTS.md and docs (C2; exact text)

**Testing rules: replace the Prod smoke and E2E bullets with:**

```markdown
- Prod smoke (`tests/prod-smoke.ts`, `pnpm run test:prod` after `pnpm run build`): a framework-free check of the BUILT server (origin check, saves, schemas, `/mcp`); keep it green when touching origin checks, middleware, `astro.config.ts` or `/mcp`.
- E2E (`tests/e2e`): Playwright against the BUILT app, `fullyParallel`, workers = half the cores (`--workers N`). `globalSetup` rebuilds `dist/` when it is older than `src`/config (`E2E_BUILD=auto|always|never`) and creates the shared read-only git fixture (`.tmp/e2e/git`). The worker fixture (`tests/e2e/fixtures.ts` + `server.ts`) starts ONE `node dist/server/entry.mjs` per worker on `E2E_BASE_PORT` (4400) + worker index, with its own data copy `.tmp/e2e/w<N>/data`, fake IDE command and record (`.tmp/e2e/w<N>/ide/`), log `.tmp/e2e/w<N>/server.log`, `CTXMAN_SERVER_ORIGIN=http://127.0.0.1:4322` and `CTXMAN_TEST_HOOKS=1`. Specs import `test`/`expect` from `./fixtures.ts` (lint-enforced); `dataPath()`/`E2E_DATA_DIR` are the current worker's copy. Specs rely on seed entry names and counts (`kb/ctxman`, `context/ctxman-dev`, `recipe/ctxman-dev-brief`, `project/ctxman-v1` with 11 children, 4 seed tasks): do not rename or add to seeds without updating specs; `e2e-*` names are reserved for specs (a spec that adds children uses its own `e2e-*` project); never write a seed entry (copy it, e.g. `createRecipeCopy`). Tests of one file may run in different workers: use `mode: 'serial'` only for a real chain, and clean up in `afterAll` what `beforeAll` created. Inflate runs use a local git repo via git `insteadOf` (env `GIT_CONFIG_COUNT/KEY_0/VALUE_0`) and run with NO step delay; a test that needs a slow or cancellable run sends header `x-ctxman-step-delay-ms` (`slowInflateSteps(page, ms)`; honoured only under `CTXMAN_TEST_HOOKS=1`); every run goes into an OS temp dir, NEVER into `~/ctxman-inflate/ctxman-dev-brief`.
- **E2E waits are events, never time** (oxlint bans `waitForTimeout`, `setTimeout`, `setInterval` and `timers/promises` under `tests/e2e`): request → `waitForApi`/`afterApi`/`page.waitForResponse` created before the action, then read the file once; reload → `afterReload`/`nextPageLoad`; DOM → web-first assertions (`toBeVisible`, `toHaveText([...])`, `toHaveAttribute`, `:focus`), row order → `expectOrder`; page state → `page.waitForFunction`; Node-side state without an event (job status, IDE record) → `pollUntil` (25 ms) only; "file changed on disk" → `bumpMtime`; "nothing happens within T" → `page.clock.install()` + `runFor(T)` or a fake-timer unit test; loading states → `page.route` + `gate()`. Default timeouts (a first Monaco mount may take 15 s); no `test.setTimeout` increases.
- Running specs by hand: `pnpm exec playwright test <spec> --output test-results/<name>`; to run two suites side by side give each its own `E2E_BASE_PORT` and `E2E_ROOT`; debug with `--trace on` (traces are off unless a test is retried). Locate by `data-testid` (`grep -rn data-testid src`; registries in `plans/UI_SPEC.md` §L, `plans/ROUND2_UI_SPEC.md` §L, `plans/INFLATE*_SPEC.md`). Islands render only after mount: wait for their test ids (EntryTools: an enabled SSR button or `entry-status`). After an in-browser save wait for the reloaded page (`afterReload`). New interactive UI gets a test id.
```

**Commands table:**

* `test:e2e`: "Playwright on the BUILT app: builds when `dist/` is stale, one server per worker on :4400+N with its own copy of `tests/data` in `.tmp/e2e/w<N>`; run `pnpm run test:e2e:install` once (chromium)".
* New row `test:fast`: "fmt:check, lint, typecheck, test (the inner loop, about 8 s)".
* `test:all`: "test:fast, check (needs `CTXMAN_DATA_DIR`, e.g. `tests/data`), build, test:prod, test:e2e (about 1 min). **Run before finishing any change**".

**Repo map:** in the `tests/unit/ … tests/e2e/ …` line, replace `(Playwright: specs, global-setup, prepare-data, paths, helpers, dev-reload)` with `(Playwright: specs, fixtures + server (per-worker built server), global-setup, paths, helpers)`.

**Other AGENTS.md lines:** in "Shared editing layer", drop `waitForEntry` from the `src/stores/entries.ts` list (C3).

**`tests/data/kb/ctxman/concepts/runtime-modes.md`:** replace "The first browser connection after the server starts gets one Vite reload; the Playwright global setup absorbs it." with "The e2e suite runs the built server (one per Playwright worker), so dev-only behaviour (Vite's first-connection reload, HMR) never reaches a test."

**`editing.md`:** replace "The e2e helpers `settleAfter` and `settleDevReload` are deprecated no-ops." with "E2E specs wait for the reload as an event (`afterReload`)."

**`architecture.md`:** `tests/e2e/   playwright (one built server per worker, each on its own copy of tests/data)`.

**`log.md`:** a dated top line: "Tests: e2e runs on the built server, one per Playwright worker, fully parallel; event-only waits (lint-enforced); faster CLI unit tests".

## 5. Deferred (not in this plan; revisit with the measured numbers after the checkpoint)

* **Lazy Monaco in Forge and Inflate** (`LazyCodeEditor` instead of the kit-barrel `CodeEditor`). Saves the 4.8 MB parse for forge/inflate tests that never open an editor (estimate 0.2-0.4 s each, about 45 tests, 2-3 s wall). It is an app change that reverses an AGENTS.md rule (owner decision).
* **Faster app debounces under test hooks** (`RENDER_DEBOUNCE_MS` 400, `DIR_PLAN_DEBOUNCE_MS` 400, `JOB_POLL_MS` 500): `page.clock.runFor` or a `CTXMAN_TEST_HOOKS` meta switch. Worth it only if Inflate specs stay the long pole.
* **`reuseContext: true`**: Playwright marks it experimental and for component tests, and it clears the cache between tests anyway, so no warm-cache win.
* **Parallel static checks** in `test:fast` (a small Node runner): about 2 s.
* **Moving prod-smoke's unique checks (MCP initialize, create without restart) into an e2e spec** and dropping `test:prod`: 0.75 s; the owner asked for the smoke script.
* **Fewer e2e tests for logic the unit suite already owns** (forms YAML-tab matrix, routing loops): a content decision for the owner.
* **A duration budget check** (fail when a spec file exceeds N s in `.tmp/e2e-report.json`).
* **`prod-smoke.ts` readiness** via the "Server listening" line instead of the 250 ms fetch loop (it is not under `tests/e2e`, so the lint rule does not apply).

## Appendix A: every sleep, settle call and dev-era wait, with its replacement

Spec titles, not line numbers (lines move). "settle" = `await settleDevReload()` / `await settleAfter(browser, baseURL, async () => { … })`. Settle replacement: delete the call; for `settleAfter`, inline the callback body. Then delete the import.

| Spec | Where (describe › test or helper) | Today | Why it was there | Replacement |
| --- | --- | --- | --- | --- |
| global-setup.ts | `globalSetup` | `page.waitForTimeout(2000)` + `/inflate` Monaco warm-up | Vite first-connection reload and dependency optimisation | deleted (built server); new globalSetup §2.1 |
| doc-edit.spec.ts | edit mode › "Edit toggle loads the file; saving writes it, leaves edit and the reload shows the text" | `page.waitForTimeout(2500)`, then `expect(loads).toBe(0)` | prove no second (settle) reload | delete both lines: `tests/unit/doc-editor.test.ts` › "the page after a save (one reload, no settle reloads)" owns the invariant. If an e2e guard is wanted: `page.clock.install()` before `goto`, `page.clock.runFor(1_000)` after the reload, then `expect(loads).toBe(0)` |
| doc-edit.spec.ts | drafts › "a draft whose file changed on disk is restored with a warning; saving overwrites the disk text" | `setTimeout(50)` before `writeFileSync`; `page.routeWebSocket(/.*/)` | mtime must differ; freeze HMR | `writeFileSync(...)` then `bumpMtime(main)`; delete `routeWebSocket` |
| doc-edit.spec.ts | conflicts › `openFrozen` + `changeOnDisk` (both conflict tests) | `routeWebSocket(/.*/)`; `setTimeout(50)` | freeze HMR; mtime must differ | `openFrozen` → `openEditor`; `changeOnDisk` = `writeFileSync` + `bumpMtime(rel)` |
| doc-edit.spec.ts | `beforeAll` | `expect.poll(GET doc page → 200, 15 s)` + `settleDevReload(2000)`; `afterAll` settle | glob loader lag | gone with the per-test entry fixture (B2); creation is synchronous on disk |
| doc-edit.spec.ts | `expectPreviewShows` (2 callers) | 12 s `toContainText` + manual reload fallback + annotation | content layer / settle reload lag | `await expect(page.getByTestId('detail-content')).toContainText(text)` |
| doc-edit.spec.ts | entry links › "saving broken links succeeds…" comment | "preview renders from the content layer…" | dev era | comment only |
| forms.spec.ts | /new/&lt;okf&gt; › "a fresh parked navigation (a dev reload landed first) resumes; a stale one does not" | `page.waitForTimeout(800)` | prove the stale park does not navigate | the resume decision is synchronous in `initNewEntry` (`if (resumeNavigation()) return;`): once `new-name` is visible, assert `toHaveURL(/\/new\/task$/)` directly. If C3 runs: delete the test |
| forms.spec.ts | `afterEach`, `createReference`, 8 more settle calls (10 total) | settle; `expect.poll(/api/entries contains name)` | glob-loaded references | delete; `createReference`: one `GET /api/entries?dataset=reference` assertion (or none: the 201 means it is on disk) |
| search.spec.ts | "closing the widget within 300 ms of opening it does not reopen it" | `page.waitForTimeout(800)` | outlast `SEARCH_FALLBACK_MS` (300) | `await page.clock.install()` before `goto`; after the second Escape `await page.clock.runFor(1_000)`; then the two assertions. If the fake clock disturbs the island (verify), fall back to asserting that the open was handled: in `page.evaluate`, add a capture listener for `ctxman:search-open` that records `defaultPrevented` |
| forge.spec.ts | Discover tab counts › "a tab shows an ellipsis while its entries load" | route handler `setTimeout(1000)` then `continue()` | keep requests in flight | `const g = gate(); await page.route('**/api/entries**', async (r) => { await g.wait; await r.continue(); });` assert `[data-loading]` count, `g.open()`, assert the counts |
| forge.spec.ts | 2 tests writing an invalid idea (Discover › invalid entries) | settle ×2 | glob reload after fs write | delete |
| inflate.spec.ts | the invalid-idea test (Sources) | settle ×2 | same | delete |
| md-popup.spec.ts | context notes › "a change on disk behind the popup is a conflict; Overwrite keeps the other edits" | `setTimeout(50)` before the API PUT | mtime must differ | PUT, then ``bumpMtime(`context/${name}.yaml`)`` |
| md-popup.spec.ts | drafts › "a draft whose file changed on disk is restored with a warning" | `setTimeout(50)` before the API PUT | same | same |
| api-inflate-run.spec.ts | helper `waitFor(request, id, done)` | loop with `setTimeout(120)` | job polling | `pollUntil(() => getJob(request, id), done)` |
| api-inflate-run.spec.ts | 7 × `test.setTimeout(90_000)` | | 300 ms × steps per run | delete (runs at 0 delay) |
| api-inflate-run.spec.ts | busy and cancel › "a second run while one is in progress is 409 busy; cancelling…" | global 300 ms step delay | keep the run in progress | first run with `headers: { [STEP_DELAY_HEADER]: '250' }`; `pollUntil` a step other than `dir` is running; cancel (aborts that step's sleep; `always` steps such as the manifest still run) |
| api-inflate-run.spec.ts | `afterAll` | settle | | delete |
| inflate-run.spec.ts | Run view › "Run places the material with live progress, then offers the summary" | global delay; `expect.poll(count running, intervals [50])` | see a running step | `slowInflateSteps(page, 300)` first; `await expect(page.locator('[data-testid="inflate-job-step"][data-status="running"]').first()).toBeVisible()` |
| inflate-run.spec.ts | Run view › "Cancel stops the run; the directory keeps a valid manifest" | global delay; `expect.poll(... running non-dir step, intervals [50], 15 s)` | cancel mid-run | `slowInflateSteps(page, 600)`; `toBeVisible()` on the running non-dir step (the UI polls every 500 ms, so each 600 ms step is seen); click Cancel (aborts the sleep) |
| inflate-run.spec.ts | `beforeAll` / `afterAll` | settle ×2 | | delete |
| inflate-run.spec.ts | "Open in IDE…" and the IDE API tests | `expect.poll(recordedCalls().length, 5 s)` ×2 | detached fake-code writes after the 200 | `pollUntil(recordedCalls, (c) => c.length === before + 1)` |
| api-ide.spec.ts | `openAndRecord` | `expect.poll(recordedCalls().length, 3 s)` | same | `pollUntil` |
| api-reference.spec.ts | "a created reference shows up in /api/entries?dataset=reference within 5 s, and leaves it when deleted" | 2 × `expect.poll(slugs, intervals [100,200,300])` | glob loader lag | `expect(await slugs()).toContain(name)` / `.not.toContain(name)`; title "…shows up at once…" |
| api-reference.spec.ts, api-doc.spec.ts, api-entry.spec.ts | `afterAll` | settle ×1 each | | delete |
| entry-tools.spec.ts | `beforeAll`, `afterAll` (settleAfter ×2), 3 tests (settle ×3) | | | inline / delete |
| list-filters.spec.ts | state changes describe: `beforeAll`/`afterAll` (settleAfter ×2), one settle; "the page loads again (dev reload or the script's fallback)" `toHaveCount(0, { timeout: 15_000 })` | | dev reload | inline / delete; `await afterReload(page, () => select.selectOption('in-progress'))`, then default-timeout assertions; `savedStatus` stays (rAF `waitForFunction`) |
| detail.spec.ts | broken-links describe `beforeAll`/`afterAll` (settleAfter ×2) | | | inline |
| relations.spec.ts | `beforeAll`/`afterAll` (settleAfter ×2); header comment "(dev reload)" | | | inline; comment |
| forge.spec.ts | 20 `expect.poll` | | | after a UI save: `afterApi(page, 'PUT', '/api/context/', save)` then `expect(savedKeys(name))…` once; `linkKeys` → `expectOrder(page, '[data-testid="forge-link"]', 'data-key', keys)`; `focusedLabel` → `expect(page.locator(':focus')).toHaveAttribute('aria-label', …)`; `dataExists` after create/delete → `afterApi` POST/DELETE |
| inflate.spec.ts | 12 `expect.poll` (`segmentKeys`, `dataExists`, `datasets().size`) | | | `expectOrder(page, '[data-testid="inflate-segment"]', 'data-key', keys)`; `dataExists` → the PUT/DELETE response (already captured nearby); `datasets()` → a web-first assertion on the rendered rows |
| search.spec.ts | 6 `expect.poll(resultHrefs)`; `pressUntilOpen` `toPass` | | | `await expect(page.getByTestId('search-result').locator('a')).toHaveAttribute(...)` / `toHaveCount`; keep `toPass` for the key press until mount (event-like retry) or replace it with `await expect(page.getByTestId('search-button')).toBeEnabled()` if the island marks mount |
| select.spec.ts | 3 `expect.poll(transform)` | | CSS transition | `await expect(chevron).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)')` / `'none'` |
| all specs | 68 per-assertion timeouts 10-60 s | | Monaco under the dev optimizer, dev reloads | default; a first Monaco mount ≤ 15 s |

## Appendix B: e2e durations of the last full run (dev server, 1 worker)

Per file (tests, total, average): inflate 37 / 79.4 s / 2146 ms · forge 29 / 65.7 s / 2266 ms · doc-edit 21 / 44.1 s / 2098 ms · forms 29 / 41.6 s / 1435 ms · inflate-run 13 / 36.7 s / 2824 ms · md-popup 10 / 24.7 s / 2470 ms · api-inflate-run 17 / 24.1 s / 1416 ms · detail 21 / 12.9 s · search 10 / 12.4 s · smoke 34 / 11.7 s · relations 7 / 9.0 s · entry-tools 9 / 8.9 s · list-filters 11 / 8.3 s · tools 9 / 6.8 s · select 7 / 5.1 s · recipe 6 / 3.3 s · api-ide 8 / 0.6 s · api 16 / 0.6 s · api-inflate 13 / 0.2 s · api-entry 13 / 0.1 s · api-doc 14 / 0.1 s · api-reference 9 / 0.1 s · api-schemas 5 / 0.0 s. (shortcuts.spec.ts, 12 tests, landed after this run.)

Histogram: < 0.1 s 85 tests · 0.1-0.3 s 45 · 0.3-0.6 s 23 · 0.6-1 s 39 · 1-2 s 73 (110 s) · 2-5 s 78 (207 s) · > 5 s 5 (29 s).

Top 30 tests:

| s | Spec › test |
| --- | --- |
| 7.0 | inflate-run › Run view › Cancel stops the run; the directory keeps a valid manifest |
| 5.8 | inflate › Unsaved changes survive a reload › a reload restores the draft with a banner; Discard goes back to the saved recipe |
| 5.6 | inflate-run › Run view › a run override that stops placing an item removes only its link |
| 5.3 | forge › Unsaved changes survive a reload › a draft of a file that changed on disk is restored with the stale warning; Save clears it |
| 5.2 | forge › Unsaved changes survive a reload › a reload restores the draft with a banner; Discard goes back to the saved context |
| 4.8 | doc-edit › edit mode › Edit toggle loads the file; saving writes it, leaves edit and the reload shows the text (2.5 s sleep) |
| 4.8 | inflate-run › Run view › a second run changes nothing that is already in place |
| 4.7 | inflate-run › Run view › Run places the material with live progress, then offers the summary |
| 4.5 | forms › routing › /new/&lt;ds&gt; exists for every dataset and is a 404 for anything else |
| 4.2 | inflate › Unsaved changes survive a reload › a draft of a file that changed on disk is restored with the stale warning; Save clears it |
| 3.9 | md-popup › drafts survive a reload › a draft whose file changed on disk is restored with a warning |
| 3.6 | api-inflate-run › busy and cancel › a second run while one is in progress is 409 busy… |
| 3.4 | forge › add, annotate, save, reorder and reload a context |
| 3.4 | inflate › output directory › a repository row offers its material, clone options and Primary; they are saved |
| 3.3 | inflate-run › Run view › a reload with job= shows the same run; an unknown run says it is gone |
| 3.2 | doc-edit › drafts › a preview with a stored draft offers "Resume editing"; Cancel + Discard removes the offer |
| 3.2 | forge › Unsaved changes survive a reload › the in-app discard dialog still guards a context switch |
| 3.0 | api-inflate-run › run › removing an item removes only its symlink; the data entry and everything else stay |
| 3.0 | doc-edit › drafts › a draft whose file changed on disk is restored with a warning; saving overwrites the disk text |
| 3.0 | forge › YAML view diagnostics › a problem the JSON Schema covers is drawn by monaco-yaml and listed |
| 3.0 | inflate-run › Run view › a directory that is not empty blocks the run until it is allowed |
| 3.0 | inflate › composition edits › a markdown block inserted after an item is saved right after it |
| 3.0 | md-popup › drafts survive a reload › Cancel + Discard removes the draft |
| 2.9 | api-inflate-run › run › places every material, writes the relative context, stubs and manifest |
| 2.9 | api-inflate-run › run › the finished job stays readable; cancelling it is 409 not-running |
| 2.9 | api-inflate-run › run › a second identical run is idempotent: links kept, clone pulled, context and stubs unchanged |
| 2.9 | api-inflate-run › safety › allowNonEmpty uses the occupied directory and never touches the foreign files |
| 2.9 | api-inflate-run › safety › a path that already exists and is not ours fails that step only |
| 2.9 | doc-edit › drafts › a dirty editor reloads without a dialog and offers the draft back; Discard drops it |
| 2.8 | api-inflate-run › run › a clone with local changes is kept when its item is removed (and the step says why) |

Unit (`vitest --reporter=json`, current tree): scripts 16.3 s · inflate-material-exec 4.56 s · new-entry-store 3.57 s · mcp-tools 3.53 s · inflate-render 2.26 s · run-script 1.77 s · forge-store 1.39 s · inflate-dir-plan 1.35 s · inflate-material-plan 1.29 s · collections-check 1.24 s · inflate-store 1.23 s · mcp-http 1.07 s; all others < 1 s. Sum of file times 46 s over 13 workers.
