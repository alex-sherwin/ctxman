// NODE: the two primitives every ctxman file write shares (ROUND3 spec §D.6): an atomic text write and an
// in-process per-file lock. The doc editor, the frontmatter PATCH, the concept/entry creators and the context
// writer all go through them, so two requests that touch the same file never interleave their read-modify-write.
import { randomUUID } from 'node:crypto';
import { chmod, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes `text` (UTF-8) to `abs` atomically: a hidden (dot-prefixed) temp file in the same directory is written
 * with `wx`, optionally chmod'ed to `mode & 0o777`, then renamed over the target. The temp name starts with a dot so
 * globs, `walkFiles` and freshness ignore it, and it sits next to the REAL file (pass a realpath to keep a symlinked
 * file a symlink: the link target is replaced). The temp file is removed when anything fails.
 */
export async function writeFileAtomic(abs: string, text: string, mode?: number): Promise<void> {
  const tmp = path.join(
    path.dirname(abs),
    `.${path.basename(abs)}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`,
  );
  try {
    await writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' });
    if (mode !== undefined) await chmod(tmp, mode & 0o777);
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

/** Per resolved path: the settled tail of the chain of operations queued on it. */
const TAILS = new Map<string, Promise<void>>();

/**
 * Runs `fn` after every earlier `withFileLock` call on the same path has finished (in call order) and returns its
 * result. Callers WAIT, they are never rejected for contention; a failing `fn` rejects only its own caller. The lock
 * lives in this process only (one dev server), keyed by the resolved path.
 */
export function withFileLock<T>(abs: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(abs);
  const previous = TAILS.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  TAILS.set(key, tail);
  void tail.then(() => {
    if (TAILS.get(key) === tail) TAILS.delete(key);
  });
  return run;
}
