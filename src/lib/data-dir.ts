// Resolves the absolute data directory. Pure node:path — safe for content.config.ts, scripts,
// Vitest, and SSR runtime. Relative values resolve against process.cwd() (npm scripts run at repo root).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DatasetId } from '../datasets/registry.ts';

export const DATA_DIR_ENV = 'CTXMAN_DATA_DIR';

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env[DATA_DIR_ENV];
  return path.resolve(process.cwd(), raw !== undefined && raw !== '' ? raw : 'data');
}

/** Absolute path of data/<dataset>. */
export function datasetDir(dataset: DatasetId, dataDir: string = resolveDataDir()): string {
  return path.join(dataDir, dataset);
}

/**
 * Directory as a file: URL with trailing slash. Pass THIS (not a string) to the astro glob loader
 * `base` option: a Windows path string like C:\x would be parsed as a URL scheme by `new URL()`.
 */
export function dirUrl(absDir: string): URL {
  const url = pathToFileURL(absDir);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
