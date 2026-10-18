// Realistic data for unit tests: a COPY of the committed corpus (tests/data) in a fresh OS temp dir. The copy
// is the only way a unit test may touch tests/data; never read or write it directly.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const copies: string[] = [];

/** Copies tests/data into a new temp dir and returns it. Remove it with `cleanupCorpus()` (call from afterEach). */
export function copyCorpus(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-corpus-'));
  copies.push(dir);
  cpSync(path.resolve('tests', 'data'), dir, { recursive: true });
  return dir;
}

/** Removes every directory `copyCorpus()` created so far. */
export function cleanupCorpus(): void {
  for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
}
