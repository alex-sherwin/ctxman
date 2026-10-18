// NODE: list the files of an okf bundle / skill directory and read them safely by relative path.
// All returned paths are bundle-relative and posix ('concepts/search.md'), whatever the OS.
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { datasetDef, isValidName } from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';

export interface BundleFile {
  /** Bundle-relative posix path. */
  path: string;
  size: number;
  /** ISO mtime. */
  mtime: string;
  kind: 'markdown' | 'text' | 'binary';
  role?: 'entry' | 'log';
}

/** Largest file readBundleText will return. */
export const MAX_TEXT_BYTES = 512 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.csv',
  '.tsv',
  '.xml',
  '.svg',
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rb',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cpp',
  '.lock',
  '.env',
  '.log',
]);
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.ico',
  '.bmp',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.tar',
  '.7z',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.mp4',
  '.mov',
  '.wasm',
]);

/** Absolute path of `relPath` inside `rootAbs`, or null when it is absolute, contains NUL, or escapes the root. */
export function safeJoin(rootAbs: string, relPath: string): string | null {
  if (relPath.includes('\0')) return null;
  if (
    path.isAbsolute(relPath) ||
    path.win32.isAbsolute(relPath) ||
    path.posix.isAbsolute(relPath)
  ) {
    return null;
  }
  // Reject any path that climbs above the root at some point, even if it would re-enter later
  // ('../<root-name>/x'): callers never need that and it keeps the rule easy to reason about.
  let depth = 0;
  for (const segment of relPath.split(/[\\/]+/)) {
    if (segment === '..') depth--;
    else if (segment !== '' && segment !== '.') depth++;
    if (depth < 0) return null;
  }
  const root = path.resolve(rootAbs);
  const joined = path.resolve(root, relPath);
  const rel = path.relative(root, joined);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return joined;
}

/** Every regular file under `rootAbs` as a sorted list of posix relative paths; dot-entries are skipped. */
export async function walkFiles(rootAbs: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(path.join(absDir, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      } else if (entry.isSymbolicLink()) {
        // Follow symlinked files only (symlinked dirs could loop).
        try {
          if ((await stat(path.join(absDir, entry.name))).isFile()) out.push(rel);
        } catch {
          // dangling link: ignore
        }
      }
    }
  }
  await walk(rootAbs, '');
  return out.sort();
}

async function classify(abs: string, rel: string): Promise<BundleFile['kind']> {
  const ext = path.posix.extname(rel).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  // Unknown or no extension: sniff the first bytes for NUL.
  let handle;
  try {
    handle = await open(abs, 'r');
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, 512, 0);
    return buf.subarray(0, bytesRead).includes(0) ? 'binary' : 'text';
  } catch {
    return 'binary';
  } finally {
    await handle?.close();
  }
}

function roleOf(dataset: OkfDatasetId | 'skill', rel: string): BundleFile['role'] {
  if (rel === datasetDef(dataset).entryFile) return 'entry';
  if (path.posix.basename(rel) === 'log.md') return 'log';
  return undefined;
}

const SPECIAL_ORDER: Record<string, number> = { entry: 0 };

/**
 * Tree order: the entry (index.md | SKILL.md), root log.md; then everything else with directories
 * before files at every level, names compared case-insensitively.
 */
function compareFiles(a: BundleFile, b: BundleFile): number {
  const sa = a.path === 'log.md' ? 1 : (SPECIAL_ORDER[a.role ?? ''] ?? 2);
  const sb = b.path === 'log.md' ? 1 : (SPECIAL_ORDER[b.role ?? ''] ?? 2);
  if (sa !== sb) return sa - sb;
  const pa = a.path.split('/');
  const pb = b.path.split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const segA = pa[i] ?? '';
    const segB = pb[i] ?? '';
    if (segA === segB) continue;
    const dirA = i < pa.length - 1;
    const dirB = i < pb.length - 1;
    if (dirA !== dirB) return dirA ? -1 : 1;
    const la = segA.toLowerCase();
    const lb = segB.toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return segA < segB ? -1 : 1;
  }
  return pa.length - pb.length;
}

/** All files of a bundle / skill directory (see compareFiles for the order). [] when it does not exist. */
export async function listBundleFiles(
  dataset: OkfDatasetId | 'skill',
  slug: string,
  dataDir: string = resolveDataDir(),
): Promise<BundleFile[]> {
  if (!isValidName(slug)) return [];
  const root = path.join(datasetDir(dataset, dataDir), slug);
  const rels = await walkFiles(root);
  const files: BundleFile[] = [];
  for (const rel of rels) {
    const abs = path.join(root, ...rel.split('/'));
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    const file: BundleFile = {
      path: rel,
      size: st.size,
      mtime: st.mtime.toISOString(),
      kind: await classify(abs, rel),
    };
    const role = roleOf(dataset, rel);
    if (role) file.role = role;
    files.push(file);
  }
  return files.sort(compareFiles);
}

export type ResolvedBundleFile =
  | {
      ok: true;
      /** Absolute path of the bundle root: data/<dataset>/<slug>. */
      root: string;
      /** `root` + the relative path, as written (symlinks NOT resolved). */
      abs: string;
      /** The file after symlink resolution; always inside the realpath of `root`. Write here. */
      realAbs: string;
      size: number;
      mtime: Date;
      /** st_mode of `realAbs`. */
      mode: number;
    }
  | { ok: false; reason: 'bad-path' | 'no-entry' | 'not-found' | 'outside' };

/**
 * Locates an EXISTING regular file of data/<dataset>/<slug>/ by bundle-relative path: safeJoin, the entry dir
 * must exist (`no-entry`; also for an invalid slug), the realpath of the file must stay inside the realpath of
 * the entry dir (`outside`, e.g. a symlink out of the bundle), and it must be a regular file (`not-found`
 * otherwise, also ENOENT / EISDIR / the entry dir itself).
 */
export async function resolveBundleFile(
  dataset: OkfDatasetId | 'skill',
  slug: string,
  relPath: string,
  dataDir: string = resolveDataDir(),
): Promise<ResolvedBundleFile> {
  if (!isValidName(slug)) return { ok: false, reason: 'no-entry' };
  const root = path.join(datasetDir(dataset, dataDir), slug);
  const abs = safeJoin(root, relPath);
  if (abs === null) return { ok: false, reason: 'bad-path' };

  let realRoot: string;
  try {
    realRoot = await realpath(root);
    if (!(await stat(realRoot)).isDirectory()) return { ok: false, reason: 'no-entry' };
  } catch {
    return { ok: false, reason: 'no-entry' };
  }

  try {
    const realAbs = await realpath(abs);
    const rel = path.relative(realRoot, realAbs);
    if (rel === '') return { ok: false, reason: 'not-found' };
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      return { ok: false, reason: 'outside' };
    }
    const st = await stat(realAbs);
    if (!st.isFile()) return { ok: false, reason: 'not-found' };
    return { ok: true, root, abs, realAbs, size: st.size, mtime: st.mtime, mode: st.mode };
  } catch {
    return { ok: false, reason: 'not-found' };
  }
}

/**
 * Text content of one file inside a bundle. null when the path is unsafe (absolute, NUL, '..' escape,
 * symlink out of the bundle), missing, not a regular file, larger than 512 KB, or binary (contains NUL).
 */
export async function readBundleText(
  dataset: OkfDatasetId | 'skill',
  slug: string,
  relPath: string,
  dataDir: string = resolveDataDir(),
): Promise<string | null> {
  const file = await resolveBundleFile(dataset, slug, relPath, dataDir);
  if (!file.ok || file.size > MAX_TEXT_BYTES) return null;
  try {
    const buf = await readFile(file.realAbs);
    if (buf.includes(0)) return null;
    return buf.toString('utf8');
  } catch {
    return null;
  }
}
