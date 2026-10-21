// Vitest setup: pin CTXMAN_DATA_DIR to an EMPTY temp dir so a test that forgets to pass its own directory sees
// an empty corpus, never the repo's tests/data. Tests that want realistic data copy it (fixtures/corpus.ts).
// CTXMAN_AGENT_HOME is pinned to an empty temp dir too, so no test ever reads the real agent histories in the home
// directory (tests that want sessions build one with tests/fixtures/agent-home.ts).
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

let guardDir: string | undefined;
let agentHome: string | undefined;
let savedDataDir: string | undefined;
let savedOrigin: string | undefined;
let savedAgentHome: string | undefined;

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

beforeAll(() => {
  savedDataDir = process.env.CTXMAN_DATA_DIR;
  savedOrigin = process.env.CTXMAN_SERVER_ORIGIN;
  savedAgentHome = process.env.CTXMAN_AGENT_HOME;
  guardDir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-vitest-'));
  agentHome = mkdtempSync(path.join(os.tmpdir(), 'ctxman-vitest-agent-home-'));
  process.env.CTXMAN_DATA_DIR = guardDir;
  process.env.CTXMAN_SERVER_ORIGIN = 'http://127.0.0.1:4321';
  process.env.CTXMAN_AGENT_HOME = agentHome;
});

afterAll(() => {
  for (const dir of [guardDir, agentHome]) {
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
  restore('CTXMAN_DATA_DIR', savedDataDir);
  restore('CTXMAN_SERVER_ORIGIN', savedOrigin);
  restore('CTXMAN_AGENT_HOME', savedAgentHome);
});
