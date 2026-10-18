// One built ctxman server per Playwright worker: a fresh copy of tests/data, a private fake IDE command, its own port.
// Readiness is the adapter's "Server listening on" line (an event, no polling); a server that exits first fails fast.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, copyFileSync, cpSync, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  E2E_BASE_PORT,
  E2E_GIT_FIXTURE,
  E2E_GIT_URI,
  E2E_SERVER_ORIGIN,
  FAKE_CODE_SOURCE,
  SERVER_ENTRY,
  SOURCE_DATA_DIR,
  workerPaths,
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
      // Kept until the Wave 2 specs opt in per run through the step-delay header (B1 removes it).
      CTXMAN_INFLATE_STEP_DELAY_MS: '300',
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
      reject(
        new Error(
          `e2e server w${index} (port ${port}) exited with ${code} before listening; see ${p.log}`,
        ),
      ),
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
