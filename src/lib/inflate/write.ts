// NODE: validates and writes the generated markdown file (plans/INFLATE_SPEC.md §7.4). The server is
// local-only; the path rules keep the tool from clobbering data or tooling directories.
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveDataDir } from '../data-dir.ts';

export type OutputPathCheck = { ok: true; path: string } | { ok: false; message: string };

/**
 * Checks, in order (first failure wins): a non-empty string without NUL (max 1024 chars); absolute; ends in
 * `.md`; no `node_modules` / `.git` segment; not inside the data directory. Returns the normalized path.
 */
export function checkOutputPath(raw: unknown, opts: { dataDir?: string } = {}): OutputPathCheck {
  const fail = (message: string): OutputPathCheck => ({ ok: false, message });
  if (typeof raw !== 'string' || raw.trim() === '') return fail('path is required');
  const p = raw.trim();
  if (p.length > 1024 || p.includes('\0')) return fail('path is not valid');
  if (!path.isAbsolute(p)) return fail('path must be absolute');
  const abs = path.resolve(p);
  if (path.extname(abs).toLowerCase() !== '.md') return fail('path must end in .md');
  if (
    abs
      .split(path.sep)
      .some(
        (segment) => segment.toLowerCase() === 'node_modules' || segment.toLowerCase() === '.git',
      )
  ) {
    return fail('path must not be inside node_modules or .git');
  }
  const dataDir = path.resolve(opts.dataDir ?? resolveDataDir());
  const rel = path.relative(dataDir, abs);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    return fail('path must not be inside the data directory');
  }
  return { ok: true, path: abs };
}

/** Creates parent directories, then writes atomically (temp file in the same directory, then rename). */
export async function writeOutput(
  absPath: string,
  markdown: string,
): Promise<{ path: string; bytes: number }> {
  const abs = path.resolve(absPath);
  await mkdir(path.dirname(abs), { recursive: true });
  const existing = await stat(abs).catch(() => null);
  if (existing?.isDirectory()) throw new Error('a directory exists at that path');
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, markdown, 'utf8');
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
  return { path: abs, bytes: Buffer.byteLength(markdown) };
}
