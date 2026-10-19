// SERVER (node:child_process, node:fs; no astro:*): "Open in IDE" for POST /api/ide/open (ROUND2_BACKEND_SPEC §B).
// Opens an entry directory as the workspace root of a VS Code window with one file open: argv is always
// `[<entry dir>, <file>]`, NEVER a file alone (it would land in the last active window) and never `-r`/`-n`.
// Only paths below the data dir are ever passed; the request never chooses the executable.
// One more target (INFLATE_V2_SPEC §10.5): a directory that ctxman inflated (it holds a valid
// `.ctxman-inflate.json`), opened as a workspace on its own: argv `[<dir>]`.
import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { datasetDef, isOkfDatasetId, isValidName } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import { resolveBundleFile } from './bundles.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { checkOutputDir, inspectOutputDir } from './inflate/output-dir.ts';
import type { DirCheckOptions } from './inflate/output-dir.ts';

/** Environment variable naming the IDE command: a name looked up in PATH, or a path (relative to the cwd). */
export const IDE_COMMAND_ENV = 'CTXMAN_IDE_COMMAND';

export interface IdeTarget {
  /** Absolute dir = workspace root. */
  root: string;
  /** Absolute file inside `root`, opened in the window; absent = just the folder. */
  file?: string;
}

export type IdeResolution = { ok: true; command: string } | { ok: false; tried: string[] };

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Case-insensitive env lookup ('Path' on Windows); an exact match wins. */
function envGet(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const exact = env[key];
  if (exact !== undefined) return exact;
  const lower = key.toLowerCase();
  for (const [name, value] of Object.entries(env)) {
    if (name.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** A regular file; on posix also executable. */
function isUsable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `name` in every PATH directory (win32: with the PATHEXT extensions). `tried` collects each candidate. */
function searchPath(
  name: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  cwd: string,
  tried: string[],
): string | undefined {
  const win = platform === 'win32';
  const dirs = (envGet(env, 'PATH') ?? '')
    .split(win ? ';' : ':')
    .map((dir) => (win ? dir.replace(/^"(.*)"$/, '$1') : dir).trim())
    .filter((dir) => dir !== '');
  let names = [name];
  if (win) {
    const exts = (envGet(env, 'PATHEXT') ?? DEFAULT_PATHEXT).split(';').filter((e) => e !== '');
    const lower = name.toLowerCase();
    if (!exts.some((ext) => lower.endsWith(ext.toLowerCase()))) {
      names = exts.map((ext) => `${name}${ext}`);
    }
  }
  for (const dir of dirs) {
    for (const candidate of names) {
      const full = path.resolve(cwd, dir, candidate);
      tried.push(full);
      if (isUsable(full, platform)) return full;
    }
  }
  return undefined;
}

/**
 * CTXMAN_IDE_COMMAND set (non-blank): a value containing '/' or '\\' is a path (resolved against `cwd`),
 * otherwise a name searched in PATH. Explicit config never falls back. Unset: 'code' in PATH, then
 * `platformFallbacks`. PATH: env key matched case-insensitively ('Path' on Windows), split on ';' (win32) or
 * ':'; win32 tries the name as-is if it already ends with a PATHEXT extension, else name + each PATHEXT entry
 * (default '.COM;.EXE;.BAT;.CMD'). A candidate counts when statSync(...).isFile() and (posix)
 * accessSync(p, X_OK) succeeds.
 */
export function resolveIdeCommand(
  opts: {
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    cwd?: string;
    fallbacks?: readonly string[];
  } = {},
): IdeResolution {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const cwd = opts.cwd ?? process.cwd();
  const tried: string[] = [];

  const configured = env[IDE_COMMAND_ENV]?.trim();
  if (configured !== undefined && configured !== '') {
    if (configured.includes('/') || configured.includes('\\')) {
      const full = path.resolve(cwd, configured);
      tried.push(full);
      return isUsable(full, platform) ? { ok: true, command: full } : { ok: false, tried };
    }
    const found = searchPath(configured, env, platform, cwd, tried);
    return found !== undefined ? { ok: true, command: found } : { ok: false, tried };
  }

  const found = searchPath('code', env, platform, cwd, tried);
  if (found !== undefined) return { ok: true, command: found };
  for (const fallback of opts.fallbacks ?? platformFallbacks(platform, env)) {
    tried.push(fallback);
    if (isUsable(fallback, platform)) return { ok: true, command: fallback };
  }
  return { ok: false, tried };
}

/** Defaults used when CTXMAN_IDE_COMMAND is unset and PATH has no `code`. */
export function platformFallbacks(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  switch (platform) {
    case 'darwin':
      return [
        '/usr/local/bin/code',
        '/opt/homebrew/bin/code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ];
    case 'linux':
      return ['/usr/bin/code', '/snap/bin/code'];
    case 'win32': {
      const out: string[] = [];
      const local = envGet(env, 'LOCALAPPDATA');
      if (local)
        out.push(path.win32.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'));
      const programFiles = envGet(env, 'ProgramFiles');
      if (programFiles)
        out.push(path.win32.join(programFiles, 'Microsoft VS Code', 'bin', 'code.cmd'));
      return out;
    }
    default:
      return [];
  }
}

type TargetResult =
  | { ok: true; target: IdeTarget }
  | { ok: false; error: 'not-found' | 'bad-path'; message: string };

/**
 * okf / skill: root = data/<ds>/<slug> (must be a dir), file = `relPath` (bundle-relative, any existing regular
 * file, resolved with resolveBundleFile) or the entry file (index.md / SKILL.md) when relPath is undefined.
 * snippet: root = the snippet folder (data/snippet), file = <slug>.yaml in it. reference / context / recipe: root =
 * the data dir, file = <ds>/<slug>.yaml. A yaml file must exist, and relPath must be undefined for them.
 */
export async function ideTargetFor(
  dataset: DatasetId,
  slug: string,
  relPath: string | undefined,
  dataDir: string = resolveDataDir(),
): Promise<TargetResult> {
  if (!isValidName(slug)) {
    return { ok: false, error: 'bad-path', message: `"${slug}" is not a valid entry name` };
  }

  if (isOkfDatasetId(dataset) || dataset === 'skill') {
    const rel = relPath ?? datasetDef(dataset).entryFile;
    const file = await resolveBundleFile(dataset, slug, rel, dataDir);
    if (file.ok) return { ok: true, target: { root: file.root, file: file.abs } };
    switch (file.reason) {
      case 'bad-path':
      case 'outside':
        return {
          ok: false,
          error: 'bad-path',
          message: `"${rel}" is not inside ${dataset}/${slug}`,
        };
      case 'no-entry':
        return {
          ok: false,
          error: 'not-found',
          message: `${dataset} entry "${slug}" does not exist`,
        };
      case 'not-found':
        return {
          ok: false,
          error: 'not-found',
          message: `${rel} does not exist in ${dataset}/${slug}`,
        };
    }
  }

  if (relPath !== undefined) {
    return {
      ok: false,
      error: 'bad-path',
      message: `path only applies to okf and skill entries, not ${dataset}`,
    };
  }
  const file = path.join(datasetDir(dataset, dataDir), `${slug}.yaml`);
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
  } catch {
    return { ok: false, error: 'not-found', message: `${dataset} entry "${slug}" does not exist` };
  }
  return { ok: true, target: { root: dataset === 'snippet' ? path.dirname(file) : dataDir, file } };
}

export interface IdeInvocation {
  /** What spawn() runs. */
  file: string;
  args: string[];
  windowsVerbatimArguments?: true;
  /** Reported to the client: [command, root, file] ([command, root] for a folder alone). */
  display: string[];
}

/**
 * An inflated working directory (INFLATE_V2_SPEC §10.5): `dirInput` (absolute or `~/…`) passes the same safety
 * checks as an Inflate output directory (`checkOutputDir`) and holds a readable `.ctxman-inflate.json`, so only
 * directories ctxman itself populated can be opened this way. The target is the folder alone (no file).
 */
export async function ideTargetForDir(
  dirInput: string,
  opts: DirCheckOptions = {},
): Promise<TargetResult> {
  const check = checkOutputDir(dirInput, opts);
  if (!check.ok) return { ok: false, error: 'bad-path', message: check.message };
  const inspected = await inspectOutputDir(check.abs);
  if (inspected.kind !== 'dir' || inspected.manifestStatus !== 'ok') {
    return { ok: false, error: 'not-found', message: 'not an inflated directory' };
  }
  return { ok: true, target: { root: check.abs } };
}

/**
 * posix, or win32 with a non-.cmd/.bat command: { file: command, args: [root, file] } (a target without a
 * file: args [root]). win32 + .cmd/.bat: { file: env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${[command, root, file]
 *   .map((a) => `"${a}"`).join(' ')}"`], windowsVerbatimArguments: true }; throws Error('unsupported character')
 * when any of the three contains '"', '%', CR or LF (cmd.exe would reinterpret them).
 * (Node refuses to spawn a .cmd/.bat with `shell: false` since the CVE-2024-27980 fix, hence cmd.exe.)
 */
export function buildIdeInvocation(
  command: string,
  target: IdeTarget,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): IdeInvocation {
  const display =
    target.file === undefined ? [command, target.root] : [command, target.root, target.file];
  if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) {
    if (display.some((arg) => /["%\r\n]/.test(arg))) {
      throw new Error('unsupported character (one of " % CR LF) in the IDE command or a path');
    }
    const line = `"${display.map((arg) => `"${arg}"`).join(' ')}"`;
    return {
      file: env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', line],
      windowsVerbatimArguments: true,
      display,
    };
  }
  return { file: command, args: display.slice(1), display };
}

/**
 * spawn(inv.file, inv.args, { shell: false, detached: true, stdio: 'ignore', windowsHide: true, cwd,
 * windowsVerbatimArguments }); resolves on 'spawn' (then child.unref()), rejects on 'error' (ENOENT, EACCES).
 */
export function launchIde(inv: IdeInvocation, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(inv.file, inv.args, {
      shell: false,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd,
      ...(inv.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    let settled = false;
    // Keep an 'error' listener for the child's whole life: an unhandled one would crash the server.
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('spawn', () => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve();
    });
  });
}
