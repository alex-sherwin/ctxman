// NODE: entry paths and filesystem-based freshness (mtime; no git dependency).
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { datasetDef } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';

/** Absolute path of an entry: the directory for okf/skill datasets, `<slug>.yaml` for data datasets. */
export function entryAbsPath(
  dataset: DatasetId,
  slug: string,
  dataDir: string = resolveDataDir(),
): string {
  const base = datasetDir(dataset, dataDir);
  return datasetDef(dataset).kind === 'data'
    ? path.join(base, `${slug}.yaml`)
    : path.join(base, slug);
}

/** Data-dir-relative posix path of the entry's own file: 'kb/foo/index.md' | 'skill/foo/SKILL.md' | 'reference/foo.yaml'. */
export function entryFileRelPath(dataset: DatasetId, slug: string): string {
  const def = datasetDef(dataset);
  return def.kind === 'data' ? `${dataset}/${slug}.yaml` : `${dataset}/${slug}/${def.entryFile}`;
}

const EPOCH_MS = 0;

/**
 * File: its mtime. Directory: the newest mtime of any file below it (recursive; names starting with '.'
 * are skipped at every level), falling back to the directory's own mtime when it holds no files.
 * Missing path: the epoch (`new Date(0)`).
 */
export async function lastModifiedOf(absPath: string): Promise<Date> {
  let st;
  try {
    st = await stat(absPath);
  } catch {
    return new Date(EPOCH_MS);
  }
  if (!st.isDirectory()) return st.mtime;
  const newest = await newestFileMtime(absPath);
  return new Date(newest ?? st.mtimeMs);
}

async function newestFileMtime(absDir: string): Promise<number | null> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(absDir, entry.name);
    let candidate: number | null = null;
    if (entry.isDirectory()) {
      candidate = await newestFileMtime(abs);
    } else {
      try {
        const st = await stat(abs);
        if (st.isFile()) candidate = st.mtimeMs;
      } catch {
        // dangling symlink or removed mid-walk: ignore
      }
    }
    if (candidate !== null && (newest === null || candidate > newest)) newest = candidate;
  }
  return newest;
}
