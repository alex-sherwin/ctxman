// NODE (fs): the working directory of an Inflate run (plans/INFLATE_V2_SPEC.md §7.1, §7.3): the pure-string
// safety rules (`checkOutputDir`), the filesystem inspection (`inspectOutputDir`), the blocking conditions
// (`blockingFor`) and the `.ctxman-inflate.json` manifest reader. `material-exec.ts` re-exports these names.
import { realpathSync } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { safeJoin } from '../bundles.ts';
import { resolveDataDir } from '../data-dir.ts';
import { DIR_MANIFEST_FILE, INFLATE_TARGETS } from './catalog.ts';
import type { BlockingCode, InflateDirManifest, ManifestEntry } from './material-plan.ts';

export interface DirCheckOptions {
  dataDir?: string;
  repoRoot?: string;
  homeDir?: string;
}

export type DirCheck = { ok: true; abs: string; input: string } | { ok: false; message: string };

const IGNORED_ENTRIES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** `rel === ''` or not climbing out of `base`. */
export function isInsideOrEqual(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** `base` resolved lexically and, when it exists, through symlinks (the real path of a checked directory). */
function baseForms(base: string, real: boolean): string[] {
  const lexical = path.resolve(base);
  if (!real) return [lexical];
  try {
    const resolved = realpathSync(lexical);
    return resolved === lexical ? [lexical] : [lexical, resolved];
  } catch {
    return [lexical];
  }
}

/**
 * Rules 5-7 of `checkOutputDir`, also applied to the real path of a symlinked directory (`real`: the data
 * directory and the repository are compared in their lexical and symlink-resolved forms).
 */
function placementViolation(abs: string, opts: DirCheckOptions, real = false): string | null {
  const segments = abs.split(/[\\/]+/);
  if (segments.some((s) => s.toLowerCase() === 'node_modules' || s.toLowerCase() === '.git')) {
    return 'dir must not be inside node_modules or .git';
  }
  const overlaps = (bases: string[]): boolean =>
    bases.some((base) => isInsideOrEqual(base, abs) || isInsideOrEqual(abs, base));
  if (overlaps(baseForms(opts.dataDir ?? resolveDataDir(), real))) {
    return 'dir must not contain or be inside the data directory';
  }
  if (overlaps(baseForms(opts.repoRoot ?? process.cwd(), real))) {
    return 'dir must not contain or be inside the ctxman repository';
  }
  return null;
}

/**
 * Validates the working directory string (no fs access). In order, first failure wins: required; length and NUL;
 * `~` expansion (`~`, `~/x`, `~\x`; `~user` refused); absolute; not a filesystem root, not the home directory;
 * no `node_modules` / `.git` segment; not inside or containing the data directory or the ctxman repository.
 */
export function checkOutputDir(raw: unknown, opts: DirCheckOptions = {}): DirCheck {
  const fail = (message: string): DirCheck => ({ ok: false, message });
  if (typeof raw !== 'string' || raw.trim() === '') return fail('dir is required');
  const input = raw.trim();
  if (input.length > 1024 || input.includes('\0')) return fail('dir is not valid');

  const home = opts.homeDir ?? os.homedir();
  let expanded = input;
  if (input === '~') expanded = home;
  else if (input.startsWith('~/') || input.startsWith('~\\')) {
    expanded = path.join(home, input.slice(2).replaceAll('\\', path.sep));
  } else if (input.startsWith('~')) {
    return fail('dir must be absolute or start with ~/');
  }
  if (!path.isAbsolute(expanded)) return fail('dir must be absolute or start with ~/');

  const abs = path.resolve(expanded);
  if (path.parse(abs).root === abs) return fail('dir must not be a filesystem root');
  if (abs === path.resolve(home)) return fail('dir must not be your home directory');
  const violation = placementViolation(abs, opts);
  if (violation !== null) return fail(violation);
  return { ok: true, abs, input };
}

// ---------------------------------------------------------------- manifest file

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const entryPathSchema = z.string().min(1).max(1024);

const manifestEntrySchema = z.discriminatedUnion('type', [
  z.strictObject({
    path: entryPathSchema,
    type: z.literal('symlink'),
    key: z.string(),
    target: z.string(),
  }),
  z.strictObject({
    path: entryPathSchema,
    type: z.literal('copy'),
    key: z.string(),
    source: z.string(),
  }),
  z.strictObject({
    path: entryPathSchema,
    type: z.literal('clone'),
    key: z.string(),
    uri: z.string(),
    branch: z.string().nullable(),
    depth: z.number().int().min(0),
    sparse: z.string().nullable(),
  }),
  z.strictObject({
    path: entryPathSchema,
    type: z.literal('skill'),
    key: z.string(),
    uri: z.string(),
    subpath: z.string().nullable(),
  }),
  z.strictObject({
    path: entryPathSchema,
    type: z.literal('file'),
    role: z.enum(['context', 'agents-md', 'claude-md', 'gitignore']),
    sha256: sha256Schema,
  }),
]);

/** `.ctxman-inflate.json` (INFLATE_V2_SPEC §7.3); strict, key order = `InflateDirManifest`. */
export const dirManifestSchema = z.strictObject({
  format: z.literal('ctxman-inflate'),
  version: z.literal(1),
  recipe: z.string(),
  target: z.enum(INFLATE_TARGETS),
  contextFile: z.string(),
  generatedAt: z.string(),
  jobId: z.string(),
  entries: z.array(manifestEntrySchema),
});

export type ManifestParse =
  | { status: 'ok'; manifest: InflateDirManifest }
  | { status: 'invalid'; message: string }
  | { status: 'unknown-version'; message: string };

/** A manifest entry path is posix, relative, non-empty, climbs nowhere and never names a `.git` segment. */
export function isSafeEntryPath(dirAbs: string, rel: string): boolean {
  if (rel === '' || rel === '.' || rel === DIR_MANIFEST_FILE) return false;
  if (rel.includes('\\')) return false;
  if (
    rel.split('/').some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git')
  ) {
    return false;
  }
  return safeJoin(dirAbs, rel) !== null;
}

/** Parses the text of `.ctxman-inflate.json`; every entry path must pass `isSafeEntryPath(dirAbs, …)`. */
export function parseDirManifest(text: string, dirAbs: string): ManifestParse {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { status: 'invalid', message: error instanceof Error ? error.message : String(error) };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { status: 'invalid', message: 'not a JSON object' };
  }
  const head = data as { format?: unknown; version?: unknown };
  if (typeof head.format === 'string' && head.format !== 'ctxman-inflate') {
    return { status: 'unknown-version', message: `unknown format "${head.format}"` };
  }
  if (head.format === 'ctxman-inflate' && head.version !== 1) {
    return { status: 'unknown-version', message: `unknown version ${String(head.version)}` };
  }
  const parsed = dirManifestSchema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: 'invalid',
      message:
        first === undefined ? 'invalid manifest' : `${first.path.join('.')}: ${first.message}`,
    };
  }
  const manifest = parsed.data as InflateDirManifest;
  const seen = new Set<string>();
  for (const entry of manifest.entries) {
    if (!isSafeEntryPath(dirAbs, entry.path)) {
      return { status: 'invalid', message: `unsafe entry path "${entry.path}"` };
    }
    if (seen.has(entry.path))
      return { status: 'invalid', message: `duplicate entry "${entry.path}"` };
    seen.add(entry.path);
  }
  return { status: 'ok', manifest };
}

/** `JSON.stringify(manifest, null, 2) + '\n'` (keys in `InflateDirManifest` order). */
export function serializeDirManifest(manifest: InflateDirManifest): string {
  const ordered: InflateDirManifest = {
    format: manifest.format,
    version: manifest.version,
    recipe: manifest.recipe,
    target: manifest.target,
    contextFile: manifest.contextFile,
    generatedAt: manifest.generatedAt,
    jobId: manifest.jobId,
    entries: manifest.entries.map(orderedEntry),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

function orderedEntry(e: ManifestEntry): ManifestEntry {
  switch (e.type) {
    case 'symlink':
      return { path: e.path, type: e.type, key: e.key, target: e.target };
    case 'copy':
      return { path: e.path, type: e.type, key: e.key, source: e.source };
    case 'clone':
      return {
        path: e.path,
        type: e.type,
        key: e.key,
        uri: e.uri,
        branch: e.branch,
        depth: e.depth,
        sparse: e.sparse,
      };
    case 'skill':
      return { path: e.path, type: e.type, key: e.key, uri: e.uri, subpath: e.subpath };
    case 'file':
      return { path: e.path, type: e.type, role: e.role, sha256: e.sha256 };
  }
}

// ---------------------------------------------------------------- inspection

export interface DirInspection {
  exists: boolean;
  kind: 'dir' | 'file' | 'other' | null;
  /** Resolved real path (symlinks followed); for a missing dir the existing ancestor's real path + the tail. */
  realAbs: string | null;
  /** Top-level names except .DS_Store, Thumbs.db, desktop.ini. */
  entries: string[];
  manifest: InflateDirManifest | null;
  manifestStatus: 'none' | 'ok' | 'invalid' | 'unknown-version';
}

/**
 * `realpath` of `abs`; when it does not exist, the realpath of its deepest existing ancestor joined with the
 * missing tail (so a symlinked ancestor cannot hide the final location).
 */
async function projectedRealPath(abs: string): Promise<string | null> {
  const tail: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(await realpath(current), ...tail);
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;
      const parent = path.dirname(current);
      if (parent === current) return null;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | null)?.code;

/**
 * lstat, realpath, readdir and the manifest of a candidate working directory. Never throws: an unreadable
 * directory reads as `exists` with no entries. A symlink to a directory is `dir`.
 */
export async function inspectOutputDir(abs: string): Promise<DirInspection> {
  const none: DirInspection = {
    exists: false,
    kind: null,
    realAbs: null,
    entries: [],
    manifest: null,
    manifestStatus: 'none',
  };
  let st;
  try {
    st = await lstat(abs);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ...none, realAbs: await projectedRealPath(abs) };
    }
    return { ...none, exists: true, kind: 'other' };
  }
  const realAbs = await projectedRealPath(abs);
  let kind: DirInspection['kind'] = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'other';
  if (st.isSymbolicLink()) {
    try {
      const target = await lstat(realAbs ?? abs);
      kind = target.isDirectory() ? 'dir' : target.isFile() ? 'file' : 'other';
    } catch {
      kind = 'other';
    }
  }
  if (kind !== 'dir') return { ...none, exists: true, kind, realAbs };

  let names: string[] = [];
  try {
    names = await readdir(abs);
  } catch {
    names = [];
  }
  const entries = names.filter((n) => !IGNORED_ENTRIES.has(n));
  let manifest: InflateDirManifest | null = null;
  let manifestStatus: DirInspection['manifestStatus'] = 'none';
  if (names.includes(DIR_MANIFEST_FILE)) {
    try {
      const parsed = parseDirManifest(
        await readFile(path.join(abs, DIR_MANIFEST_FILE), 'utf8'),
        abs,
      );
      manifestStatus = parsed.status;
      if (parsed.status === 'ok') manifest = parsed.manifest;
    } catch {
      manifestStatus = 'invalid';
    }
  }
  return { exists: true, kind: 'dir', realAbs, entries, manifest, manifestStatus };
}

export interface Blocking {
  code: BlockingCode;
  message: string;
}

/**
 * Conditions that stop a run (INFLATE_V2_SPEC §7.1): the dir check failed or its real path breaks rules 5-7
 * (`bad-dir`); a file at the path (`dir-not-directory`); an unreadable manifest without `allowNonEmpty`
 * (`manifest-invalid`); a non-empty directory ctxman did not create without `allowNonEmpty` (`dir-not-empty`).
 */
export function blockingFor(
  check: DirCheck,
  insp: DirInspection | null,
  allowNonEmpty: boolean,
  opts: DirCheckOptions = {},
): Blocking[] {
  if (!check.ok) return [{ code: 'bad-dir', message: check.message }];
  if (insp === null) return [];
  const out: Blocking[] = [];
  if (insp.realAbs !== null && insp.realAbs !== check.abs) {
    const violation = placementViolation(insp.realAbs, opts, true);
    if (violation !== null)
      out.push({ code: 'bad-dir', message: `${violation} (${insp.realAbs})` });
  }
  if (!insp.exists) return out;
  if (insp.kind === 'file' || insp.kind === 'other') {
    out.push({
      code: 'dir-not-directory',
      message: `${check.abs} exists and is not a directory`,
    });
    return out;
  }
  if (
    (insp.manifestStatus === 'invalid' || insp.manifestStatus === 'unknown-version') &&
    !allowNonEmpty
  ) {
    out.push({
      code: 'manifest-invalid',
      message: `${check.abs}/${DIR_MANIFEST_FILE} cannot be read; allow a non-empty directory to run anyway (nothing will be removed)`,
    });
  } else if (insp.manifestStatus === 'none' && insp.entries.length > 0 && !allowNonEmpty) {
    out.push({
      code: 'dir-not-empty',
      message: `${check.abs} is not empty and was not created by ctxman; allow a non-empty directory to use it`,
    });
  }
  return out;
}
