// NODE (node:fs for the status check): resolves the absolute data directory and the server origin. The data
// directory is REQUIRED (`CTXMAN_DATA_DIR`, optionally from a `.env` file that node loads through
// `--env-file-if-exists=.env`); there is no default. Relative values resolve against process.cwd().
// Call `resolveDataDir()` inside functions, never at module top level of a module that pages import at build time.
import { statSync } from 'node:fs';
import path from 'node:path';
import type { DatasetId } from '../datasets/registry.ts';
import { DEFAULT_SERVER_ORIGIN } from './schema-comment.ts';

export const DATA_DIR_ENV = 'CTXMAN_DATA_DIR';
export const SERVER_ORIGIN_ENV = 'CTXMAN_SERVER_ORIGIN';
export { DEFAULT_SERVER_ORIGIN };

export type DataDirErrorCode = 'unset' | 'missing' | 'not-directory';

export class DataDirError extends Error {
  code: DataDirErrorCode;
  dir?: string;
  constructor(code: DataDirErrorCode, message: string, dir?: string) {
    super(message);
    this.name = 'DataDirError';
    this.code = code;
    if (dir !== undefined) this.dir = dir;
  }
}

const UNSET_MESSAGE =
  'CTXMAN_DATA_DIR is not set. Point it at the directory that holds your ctxman data (kb/, task/, reference/ ...), e.g. CTXMAN_DATA_DIR=/Users/you/ctxman-data, or put that line in a .env file at the repo root.';

/** Absolute data dir from the environment; throws DataDirError('unset') when the variable is absent or blank. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[DATA_DIR_ENV];
  if (raw === undefined || raw.trim() === '') throw new DataDirError('unset', UNSET_MESSAGE);
  return path.resolve(process.cwd(), raw);
}

export type DataDirStatus =
  | { ok: true; dir: string }
  | { ok: false; code: DataDirErrorCode; message: string; dir?: string };

/** Sync, stat-based: is the data dir configured, present and a directory? */
export function dataDirStatus(env: NodeJS.ProcessEnv = process.env): DataDirStatus {
  let dir: string;
  try {
    dir = resolveDataDir(env);
  } catch (error) {
    if (error instanceof DataDirError)
      return { ok: false, code: error.code, message: error.message };
    throw error;
  }
  try {
    if (!statSync(dir).isDirectory()) {
      return {
        ok: false,
        code: 'not-directory',
        message: `CTXMAN_DATA_DIR points at ${dir}, which is not a directory.`,
        dir,
      };
    }
  } catch {
    return {
      ok: false,
      code: 'missing',
      message: `CTXMAN_DATA_DIR points at ${dir}, which does not exist.`,
      dir,
    };
  }
  return { ok: true, dir };
}

/** Absolute path of <dataDir>/<dataset>. */
export function datasetDir(dataset: DatasetId, dataDir: string = resolveDataDir()): string {
  return path.join(dataDir, dataset);
}

/** Absolute path of the committed JSON Schemas (`schemas/` at the repo root; resolved against the cwd). */
export function resolveSchemasDir(cwd: string = process.cwd()): string {
  return path.resolve(cwd, 'schemas');
}

/** `CTXMAN_SERVER_ORIGIN` without a trailing slash, else DEFAULT_SERVER_ORIGIN (also when it is not an http(s) URL). */
export function resolveServerOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[SERVER_ORIGIN_ENV]?.trim();
  if (raw === undefined || raw === '') return DEFAULT_SERVER_ORIGIN;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_SERVER_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_SERVER_ORIGIN;
  }
}
