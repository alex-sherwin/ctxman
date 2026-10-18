// Vitest setup: pin CTXMAN_DATA_DIR to an EMPTY temp dir so a test that forgets to pass its own directory sees
// an empty corpus, never the repo's tests/data. Tests that want realistic data copy it (fixtures/corpus.ts).
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

let guardDir: string | undefined;
let savedDataDir: string | undefined;
let savedOrigin: string | undefined;

beforeAll(() => {
  savedDataDir = process.env.CTXMAN_DATA_DIR;
  savedOrigin = process.env.CTXMAN_SERVER_ORIGIN;
  guardDir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-vitest-'));
  process.env.CTXMAN_DATA_DIR = guardDir;
  process.env.CTXMAN_SERVER_ORIGIN = 'http://127.0.0.1:4321';
});

afterAll(() => {
  if (guardDir !== undefined) rmSync(guardDir, { recursive: true, force: true });
  if (savedDataDir === undefined) delete process.env.CTXMAN_DATA_DIR;
  else process.env.CTXMAN_DATA_DIR = savedDataDir;
  if (savedOrigin === undefined) delete process.env.CTXMAN_SERVER_ORIGIN;
  else process.env.CTXMAN_SERVER_ORIGIN = savedOrigin;
});
