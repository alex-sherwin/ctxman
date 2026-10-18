// NODE (fs; child processes and `fetch` are injected): executes the steps of a material plan inside a working
// directory (plans/INFLATE_V2_SPEC.md §7). Every precondition is re-checked at run time; only paths recorded
// in the previous `.ctxman-inflate.json` are ever replaced or removed; symlinks are unlinked, never followed.
// Process spawning is injected (`ProcRunner`, implemented by src/lib/proc.ts) so unit tests can use real git or a fake.
import { createHash } from 'node:crypto';
import { createWriteStream, lstatSync } from 'node:fs';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { safeJoin } from '../bundles.ts';
import type { ProcResult, ProcRunner } from '../proc.ts';
import { STAGE_DIR } from './catalog.ts';
import type { InflateTarget } from './catalog.ts';
import type { InflateWarning } from './expand.ts';
import type {
  InflateDirManifest,
  ManifestEntry,
  MaterialStep,
  MaterialView,
  StepResult,
  StepUpdate,
} from './material-plan.ts';
import { isInsideOrEqual, serializeDirManifest } from './output-dir.ts';

export {
  blockingFor,
  checkOutputDir,
  dirManifestSchema,
  inspectOutputDir,
  parseDirManifest,
  serializeDirManifest,
} from './output-dir.ts';
export type { Blocking, DirCheck, DirCheckOptions, DirInspection } from './output-dir.ts';

export interface ExecuteContext {
  /** Absolute, validated `<W>`. */
  dir: string;
  jobId: string;
  recipe: string;
  target: InflateTarget;
  contextFile: string;
  previous: InflateDirManifest | null;
  materials: Record<string, MaterialView>;
  signal: AbortSignal;
  onProgress(update: StepUpdate): void;
  proc: ProcRunner;
  fetch?: typeof fetch;
  now(): Date;
  /** writeContext: the document for the ACTUAL outcomes (failed items rendered as not materialized). */
  renderContext(materials: Record<string, MaterialView>): string;
  /** Test hook (CTXMAN_INFLATE_STEP_DELAY_MS): sleep before each step that runs. */
  stepDelayMs?: number;
}

export interface ExecuteOutcome {
  results: StepResult[];
  manifest: InflateDirManifest | null;
  /** Run-time warnings (e.g. `context-file-edited`); the job store appends them to the job. */
  warnings: InflateWarning[];
}

/** Limits (INFLATE_V2_SPEC §7.2). */
export const GIT_TIMEOUT_MS = 15 * 60_000;
export const EXTRACT_TIMEOUT_MS = 5 * 60_000;
export const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
export const DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;
const TAIL_LINES = 20;
const MIB = 1024 * 1024;
/** Names never copied into the working directory. */
const COPY_SKIP_NAMES: ReadonlySet<string> = new Set(['.git', 'node_modules', '.DS_Store']);

// ---------------------------------------------------------------- tools

const TOOL_CACHE_MS = 60_000;
const toolCache = new WeakMap<
  ProcRunner,
  { at: number; value: { git: boolean; tar: boolean; unzip: boolean } }
>();

/** `git --version`, `tar --version`, `unzip -v` (exit 0 = present); cached per runner for 60 s. */
export async function probeTools(
  proc: ProcRunner,
): Promise<{ git: boolean; tar: boolean; unzip: boolean }> {
  const cached = toolCache.get(proc);
  if (cached !== undefined && Date.now() - cached.at < TOOL_CACHE_MS) return cached.value;
  const present = async (cmd: string, args: string[]): Promise<boolean> =>
    (await proc(cmd, args, { timeoutMs: 10_000 })).code === 0;
  const [git, tar, unzip] = await Promise.all([
    present('git', ['--version']),
    present('tar', ['--version']),
    present('unzip', ['-v']),
  ]);
  const value = { git, tar, unzip };
  toolCache.set(proc, { at: Date.now(), value });
  return value;
}

// ---------------------------------------------------------------- small helpers

export const sha256Of = (text: string | Buffer): string =>
  createHash('sha256')
    .update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text)
    .digest('hex');

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | null)?.code;
const firstLine = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0] ?? text;
};

async function lstatOrNull(abs: string) {
  try {
    return await lstat(abs);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

async function statOrNull(abs: string) {
  try {
    return await stat(abs);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

/** `unlink`; a win32 directory symlink / junction answers EPERM / EISDIR and needs `rmdir`. */
async function unlinkLink(abs: string): Promise<void> {
  try {
    await unlink(abs);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EPERM' || code === 'EISDIR') await rmdir(abs);
    else throw error;
  }
}

const rmTree = (abs: string): Promise<void> =>
  rm(abs, { recursive: true, force: true, maxRetries: 3 });

async function writeAtomic(abs: string, text: string): Promise<void> {
  const tmp = `${abs}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** Env of every git invocation: never prompt, English output, SSH fails instead of asking. */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    LC_ALL: 'C',
    GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
  };
}

/** The most telling line of a failed process: `fatal:` / `error:` first, else the last line. */
function failureLine(result: ProcResult, what: string): string {
  if (result.spawnError !== undefined) {
    return result.spawnError === 'ENOENT'
      ? `${what.split(' ')[0] ?? what} is not installed`
      : `could not start ${what}: ${result.spawnError}`;
  }
  if (result.timedOut) return `${what} timed out`;
  const named = [...result.tail]
    .reverse()
    .find((line) => /^(fatal|error):/i.test(line) || /^tar:|^unzip:/i.test(line));
  const line = named ?? result.tail[result.tail.length - 1];
  return line === undefined ? `${what} failed (exit ${result.code})` : `${what} failed: ${line}`;
}

// ---------------------------------------------------------------- step outcomes

type Action = NonNullable<StepResult['action']>;
type Outcome =
  | { status: 'failed'; message: string }
  | { status: 'cancelled'; message?: string }
  | { status: 'skipped'; message: string; action?: 'kept' }
  | { status: 'done'; action: Action; message?: string; entry?: ManifestEntry };

const failed = (message: string): Outcome => ({ status: 'failed', message });
const kept = (message: string): Outcome => ({ status: 'skipped', message, action: 'kept' });
const done = (
  action: Action,
  extra: { message?: string; entry?: ManifestEntry } = {},
): Outcome => ({
  status: 'done',
  action,
  ...extra,
});
const cancelled = (): Outcome => ({ status: 'cancelled', message: 'the run was cancelled' });

interface Runtime {
  ctx: ExecuteContext;
  /** realpath(<W>) once ensureDir passed. */
  realDir: string | null;
  /** Lines of the step in progress. */
  log(line: string): void;
  recorded(rel: string): ManifestEntry | undefined;
  warnings: InflateWarning[];
  results: StepResult[];
  steps: readonly MaterialStep[];
  manifest: InflateDirManifest | null;
}

/**
 * The parent of `abs` must resolve (through the deepest existing ancestor) inside `realpath(<W>)`; returns a
 * failure message or null. Called before any write below `<W>` so a symlinked folder cannot redirect it.
 */
async function parentEscapes(rt: Runtime, abs: string): Promise<string | null> {
  const real = rt.realDir ?? (rt.realDir = await realpath(rt.ctx.dir));
  let current = path.dirname(abs);
  for (;;) {
    try {
      const resolved = await realpath(current);
      return isInsideOrEqual(real, resolved) ? null : 'path leaves the working directory';
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return firstLine(error);
      const parent = path.dirname(current);
      if (parent === current || !isInsideOrEqual(rt.ctx.dir, current)) {
        return 'path leaves the working directory';
      }
      current = parent;
    }
  }
}

/** Resolves a step path inside `<W>` and guards its parent; creates the parent when `mkdirParent`. */
async function target(
  rt: Runtime,
  rel: string,
  mkdirParent: boolean,
): Promise<{ abs: string } | { fail: Outcome }> {
  const abs = safeJoin(rt.ctx.dir, rel);
  if (abs === null) return { fail: failed('unsafe path') };
  const escape = await parentEscapes(rt, abs);
  if (escape !== null) return { fail: failed(escape) };
  if (mkdirParent) await mkdir(path.dirname(abs), { recursive: true });
  return { abs };
}

// ---------------------------------------------------------------- removal of recorded paths

type RemoveResult = { kind: 'gone' } | { kind: 'removed' } | { kind: 'kept'; message: string };

/**
 * Removes the path `rec` describes, but only while it still is what ctxman created: symlink stays a symlink
 * (unlinked), copies / skills stay real directories, clones stay clean (no local changes, nothing unpushed),
 * files keep the recorded sha256. Anything else is kept.
 */
async function removeRecorded(rt: Runtime, abs: string, rec: ManifestEntry): Promise<RemoveResult> {
  const st = await lstatOrNull(abs);
  if (st === null) return { kind: 'gone' };
  const mismatch: RemoveResult = {
    kind: 'kept',
    message: `kept ${rec.path}: no longer what ctxman created`,
  };
  switch (rec.type) {
    case 'symlink':
      if (!st.isSymbolicLink()) return mismatch;
      await unlinkLink(abs);
      return { kind: 'removed' };
    case 'copy':
    case 'skill':
      if (!st.isDirectory()) return mismatch;
      await rmTree(abs);
      return { kind: 'removed' };
    case 'clone': {
      if (!st.isDirectory() || (await lstatOrNull(path.join(abs, '.git'))) === null)
        return mismatch;
      const status = await rt.ctx.proc('git', ['-C', abs, 'status', '--porcelain', '--branch'], {
        env: gitEnv(),
        signal: rt.ctx.signal,
        timeoutMs: 60_000,
      });
      if (status.code !== 0) {
        return { kind: 'kept', message: `kept ${rec.path}: could not check its git status` };
      }
      const lines = status.stdout.split('\n').filter((l) => l.trim() !== '');
      if (lines.length > 1 || (lines[0] ?? '').includes('[ahead')) {
        return {
          kind: 'kept',
          message: `kept ${rec.path}: it has local changes or unpushed commits`,
        };
      }
      await rmTree(abs);
      return { kind: 'removed' };
    }
    case 'file': {
      if (!st.isFile()) return mismatch;
      if (sha256Of(await readFile(abs)) !== rec.sha256) {
        return { kind: 'kept', message: `kept ${rec.path}: edited since ctxman wrote it` };
      }
      await unlink(abs);
      return { kind: 'removed' };
    }
  }
}

async function runRemove(rt: Runtime, step: MaterialStep & { kind: 'remove' }): Promise<Outcome> {
  const abs = safeJoin(rt.ctx.dir, step.path);
  if (abs === null) return failed('unsafe path');
  const escape = await parentEscapes(rt, abs);
  if (escape !== null) return failed(escape);
  const result = await removeRecorded(rt, abs, step.entry);
  if (result.kind === 'gone') return done('unchanged', { message: 'already gone' });
  if (result.kind === 'kept') return kept(result.message);
  return done('removed');
}

// ---------------------------------------------------------------- symlink / copy

async function runSymlink(rt: Runtime, step: MaterialStep & { kind: 'symlink' }): Promise<Outcome> {
  const key = step.key ?? '';
  const sourceStat = await statOrNull(step.target);
  if (sourceStat === null) return failed(`source ${step.target} does not exist`);
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  const link = where.abs;
  const entry: ManifestEntry = { path: step.path, type: 'symlink', key, target: step.target };
  const make = (): Promise<void> =>
    symlink(step.target, link, process.platform === 'win32' ? 'junction' : 'dir');

  const st = await lstatOrNull(link);
  if (st === null) {
    await make();
    return done('created', { entry });
  }
  if (st.isSymbolicLink()) {
    const [have, want] = await Promise.all([
      realpath(link).catch(() => null),
      realpath(step.target).catch(() => null),
    ]);
    if (have !== null && have === want) return done('unchanged', { entry });
  }
  const rec = rt.recorded(step.path);
  if (rec === undefined) return failed(`${step.path} exists and was not created by ctxman`);
  const removed = await removeRecorded(rt, link, rec);
  if (removed.kind === 'kept') return failed(removed.message);
  await make();
  return done('replaced', { entry });
}

/** Copies `from` to a temp sibling of `abs`, then swaps it in (a recorded old copy is removed first). */
async function installCopy(
  rt: Runtime,
  rel: string,
  abs: string,
  from: string,
  copyOptions: { dereference: boolean; skipSymlinks: boolean },
  entry: ManifestEntry,
): Promise<Outcome> {
  const temp = `${abs}.ctxman-${rt.ctx.jobId.slice(0, 8)}`;
  let skippedLinks = 0;
  await rmTree(temp);
  try {
    await cp(from, temp, {
      recursive: true,
      dereference: copyOptions.dereference,
      force: true,
      errorOnExist: false,
      filter: (source) => {
        if (COPY_SKIP_NAMES.has(path.basename(source))) return false;
        if (
          copyOptions.skipSymlinks &&
          lstatSync(source, { throwIfNoEntry: false })?.isSymbolicLink()
        ) {
          skippedLinks++;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    await rmTree(temp);
    return failed(`copy failed: ${firstLine(error)}`);
  }
  if (skippedLinks > 0) rt.log(`skipped ${skippedLinks} symlinks`);
  if ((await lstatOrNull(temp)) === null) return failed(`nothing to copy from ${from}`);

  const st = await lstatOrNull(abs);
  if (st === null) {
    await rename(temp, abs);
    return done('created', { entry });
  }
  const rec = rt.recorded(rel);
  if (rec === undefined) {
    await rmTree(temp);
    return failed(`${rel} exists and was not created by ctxman`);
  }
  const removed = await removeRecorded(rt, abs, rec);
  if (removed.kind === 'kept') {
    await rmTree(temp);
    return failed(removed.message);
  }
  await rename(temp, abs);
  return done('replaced', { entry });
}

async function runCopy(rt: Runtime, step: MaterialStep & { kind: 'copyDir' }): Promise<Outcome> {
  const sourceStat = await statOrNull(step.from);
  if (sourceStat === null || !sourceStat.isDirectory()) {
    return failed(`source ${step.from} does not exist`);
  }
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  return installCopy(
    rt,
    step.path,
    where.abs,
    step.from,
    { dereference: true, skipSymlinks: false },
    { path: step.path, type: 'copy', key: step.key ?? '', source: step.from },
  );
}

// ---------------------------------------------------------------- git

async function git(
  rt: Runtime,
  args: readonly string[],
  opts: { progress?: boolean; timeoutMs?: number } = {},
): Promise<ProcResult> {
  return rt.ctx.proc('git', args, {
    cwd: rt.ctx.dir,
    env: gitEnv(),
    signal: rt.ctx.signal,
    timeoutMs: opts.timeoutMs ?? GIT_TIMEOUT_MS,
    ...(opts.progress === true ? { onLine: rt.log } : {}),
  });
}

async function originOf(rt: Runtime, abs: string): Promise<string | null> {
  const result = await git(rt, ['-C', abs, 'config', '--get', 'remote.origin.url'], {
    timeoutMs: 60_000,
  });
  const url = result.stdout.trim();
  return result.code === 0 && url !== '' ? url : null;
}

/** `git clone` into `abs` (missing or an empty directory); a clone this step started is removed on failure. */
async function cloneInto(
  rt: Runtime,
  abs: string,
  spec: { uri: string; depth: number; branch: string | null; sparse: string | null },
): Promise<Outcome | null> {
  const existed = (await lstatOrNull(abs)) !== null;
  const args = ['clone'];
  if (spec.depth > 0) args.push('--depth', String(spec.depth));
  if (spec.branch !== null) args.push('--branch', spec.branch);
  if (spec.sparse !== null) args.push('--filter=blob:none', '--sparse');
  args.push('--progress', '--', spec.uri, abs);
  const clone = await git(rt, args, { progress: true });
  const abort = async (): Promise<Outcome> => {
    if (!existed) await rmTree(abs);
    return cancelled();
  };
  if (clone.aborted) return abort();
  if (clone.code !== 0) {
    if (!existed) await rmTree(abs);
    return failed(failureLine(clone, 'git clone'));
  }
  if (spec.sparse !== null) {
    const sparse = await git(rt, ['-C', abs, 'sparse-checkout', 'set', '--', spec.sparse], {
      progress: true,
    });
    if (sparse.aborted) return abort();
    if (sparse.code !== 0) {
      if (!existed) await rmTree(abs);
      return failed(failureLine(sparse, 'git sparse-checkout'));
    }
  }
  return null;
}

type CloneStep = MaterialStep & { kind: 'gitClone' };
type UpdateStep = MaterialStep & { kind: 'gitUpdate' };

function cloneEntry(step: {
  path: string;
  key?: string;
  uri: string;
  depth: number;
  branch: string | null;
  sparse: string | null;
}): ManifestEntry {
  return {
    path: step.path,
    type: 'clone',
    key: step.key ?? '',
    uri: step.uri,
    branch: step.branch,
    depth: step.depth,
    sparse: step.sparse,
  };
}

async function updateClone(
  rt: Runtime,
  step: CloneStep | UpdateStep,
  abs: string,
): Promise<Outcome> {
  const origin = await originOf(rt, abs);
  if (origin === null) return failed(`${step.path} has no origin remote`);
  if (origin !== step.uri) return failed(`${step.path} is a clone of ${origin}, not ${step.uri}`);

  if (step.branch !== null) {
    const head = await git(rt, ['-C', abs, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      timeoutMs: 60_000,
    });
    const have = head.stdout.trim();
    if (head.code === 0 && have !== step.branch) {
      return kept(
        `on ${have === 'HEAD' ? 'a detached HEAD' : `branch ${have}`}, recipe wants ${step.branch}; left as is`,
      );
    }
  }

  const rec = rt.recorded(step.path);
  if (rec?.type === 'clone' && rec.sparse !== step.sparse) {
    const change =
      step.sparse === null
        ? await git(rt, ['-C', abs, 'sparse-checkout', 'disable'], { progress: true })
        : await git(rt, ['-C', abs, 'sparse-checkout', 'set', '--', step.sparse], {
            progress: true,
          });
    if (change.aborted) return cancelled();
    if (change.code !== 0) return failed(failureLine(change, 'git sparse-checkout'));
  }

  const before = await git(rt, ['-C', abs, 'rev-parse', 'HEAD'], { timeoutMs: 60_000 });
  const pull = await git(rt, ['-C', abs, 'pull', '--ff-only', '--progress'], { progress: true });
  if (pull.aborted) return cancelled();
  if (pull.code !== 0) return failed(failureLine(pull, 'git pull'));
  const after = await git(rt, ['-C', abs, 'rev-parse', 'HEAD'], { timeoutMs: 60_000 });
  const entry = cloneEntry(step);
  return before.stdout.trim() !== '' && before.stdout.trim() === after.stdout.trim()
    ? done('unchanged', { entry })
    : done('updated', { entry });
}

async function runGitClone(rt: Runtime, step: CloneStep): Promise<Outcome> {
  if (step.uri.startsWith('-')) return failed('invalid git URI');
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  const abs = where.abs;

  if (step.stage) {
    if (!step.path.startsWith(`${STAGE_DIR}/`)) return failed('unsafe path');
    await rmTree(abs);
    const failure = await cloneInto(rt, abs, step);
    return failure ?? done('created');
  }

  const entry = cloneEntry(step);
  const st = await lstatOrNull(abs);
  if (st === null) {
    return (await cloneInto(rt, abs, step)) ?? done('created', { entry });
  }
  if (st.isDirectory()) {
    if ((await lstatOrNull(path.join(abs, '.git'))) !== null) {
      const origin = await originOf(rt, abs);
      if (origin === step.uri) return updateClone(rt, step, abs);
      return failed(
        origin === null
          ? `${step.path} exists and is not a clone of ${step.uri}`
          : `${step.path} is a clone of ${origin}, not ${step.uri}`,
      );
    }
    if ((await readdir(abs)).length === 0) {
      return (await cloneInto(rt, abs, step)) ?? done('created', { entry });
    }
  }
  return failed(`${step.path} exists and is not a clone of ${step.uri}`);
}

async function runGitUpdate(rt: Runtime, step: UpdateStep): Promise<Outcome> {
  if (step.uri.startsWith('-')) return failed('invalid git URI');
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  const abs = where.abs;
  const st = await lstatOrNull(abs);
  if (st === null) {
    return (await cloneInto(rt, abs, step)) ?? done('created', { entry: cloneEntry(step) });
  }
  if (!st.isDirectory() || (await lstatOrNull(path.join(abs, '.git'))) === null) {
    return failed(`${step.path} exists and is not a clone of ${step.uri}`);
  }
  return updateClone(rt, step, abs);
}

// ---------------------------------------------------------------- download / extract / place skill

async function runDownload(
  rt: Runtime,
  step: MaterialStep & { kind: 'download' },
): Promise<Outcome> {
  let url: URL;
  try {
    url = new URL(step.uri);
  } catch {
    return failed('invalid download URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return failed('invalid download URL');
  if (!step.path.startsWith(`${STAGE_DIR}/`)) return failed('unsafe path');
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  const abs = where.abs;

  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const signal = AbortSignal.any([rt.ctx.signal, timeout]);
  const classify = async (error: unknown): Promise<Outcome> => {
    await rm(abs, { force: true });
    if (rt.ctx.signal.aborted) return cancelled();
    if (timeout.aborted) return failed('download timed out');
    return failed(firstLine(error));
  };

  const doFetch = rt.ctx.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(step.uri, { redirect: 'follow', signal });
  } catch (error) {
    return classify(error);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return failed(`HTTP ${response.status}`);
  }
  if (response.body === null) return failed('empty response');
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > DOWNLOAD_MAX_BYTES) {
    await response.body.cancel().catch(() => undefined);
    return failed('download larger than 256 MB');
  }

  let bytes = 0;
  let nextMark = MIB;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > DOWNLOAD_MAX_BYTES) {
        callback(new Error('download larger than 256 MB'));
        return;
      }
      while (bytes >= nextMark) {
        rt.log(`${Math.floor(nextMark / MIB)} MB`);
        nextMark += MIB;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as WebReadableStream),
      counter,
      createWriteStream(abs),
      { signal },
    );
  } catch (error) {
    return classify(error);
  }
  return done('created');
}

async function runExtract(rt: Runtime, step: MaterialStep & { kind: 'extract' }): Promise<Outcome> {
  if (!step.path.startsWith(`${STAGE_DIR}/`)) return failed('unsafe path');
  const archive = safeJoin(rt.ctx.dir, step.archive);
  if (archive === null) return failed('unsafe path');
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  const out = where.abs;
  if ((await statOrNull(archive)) === null) return failed(`${step.archive} does not exist`);
  await rmTree(out);
  await mkdir(out, { recursive: true });

  const run = (cmd: string, args: string[]): Promise<ProcResult> =>
    rt.ctx.proc(cmd, args, {
      cwd: rt.ctx.dir,
      signal: rt.ctx.signal,
      timeoutMs: EXTRACT_TIMEOUT_MS,
      onLine: rt.log,
    });
  const flag = step.format === 'zip' ? '-xf' : '-xzf';
  let result = await run('tar', [flag, archive, '-C', out]);
  if (result.aborted) return cancelled();
  if (result.code !== 0 && step.format === 'zip') {
    result = await run('unzip', ['-q', '-o', archive, '-d', out]);
    if (result.aborted) return cancelled();
  }
  if (result.code !== 0) {
    return failed(`could not extract ${step.archive}: install tar (bsdtar) or unzip`);
  }
  return done('created');
}

/** Names of the visible subdirectories of `abs` (no dot entries, no `__MACOSX`). */
async function visibleDirs(abs: string): Promise<{ dirs: string[] } | null> {
  let names;
  try {
    names = await readdir(abs, { withFileTypes: true });
  } catch {
    return null;
  }
  return {
    dirs: names
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '__MACOSX')
      .map((e) => e.name),
  };
}

const hasSkillMd = async (dir: string): Promise<boolean> =>
  (await statOrNull(path.join(dir, 'SKILL.md')))?.isFile() === true;

/** Finds the skill folder inside a staged clone / extracted archive (spec D4). */
async function locateSkill(stageAbs: string, subpath: string | null): Promise<string | null> {
  const sub = (subpath ?? '').trim().replace(/^\/+|\/+$/g, '');
  const candidate = sub === '' ? stageAbs : safeJoin(stageAbs, sub);
  if (candidate !== null) {
    if (await hasSkillMd(candidate)) return candidate;
    const inner = await visibleDirs(candidate);
    if (inner !== null && inner.dirs.length === 1) {
      const only = path.join(candidate, inner.dirs[0] ?? '');
      if (await hasSkillMd(only)) return only;
    }
  }
  if (sub !== '') {
    const top = await visibleDirs(stageAbs);
    if (top !== null && top.dirs.length === 1) {
      const wrapped = safeJoin(path.join(stageAbs, top.dirs[0] ?? ''), sub);
      if (wrapped !== null && (await hasSkillMd(wrapped))) return wrapped;
    }
  }
  return null;
}

async function runPlaceSkill(
  rt: Runtime,
  step: MaterialStep & { kind: 'placeSkill' },
): Promise<Outcome> {
  const stageAbs = safeJoin(rt.ctx.dir, step.stage);
  if (stageAbs === null || !step.stage.startsWith(`${STAGE_DIR}/`)) return failed('unsafe path');
  const source = await locateSkill(stageAbs, step.subpath);
  if (source === null) {
    return failed(
      `no SKILL.md found in ${step.uri}${step.subpath === null ? '' : ` (subpath ${step.subpath})`}`,
    );
  }
  const where = await target(rt, step.path, true);
  if ('fail' in where) return where.fail;
  return installCopy(
    rt,
    step.path,
    where.abs,
    source,
    { dereference: false, skipSymlinks: true },
    { path: step.path, type: 'skill', key: step.key ?? '', uri: step.uri, subpath: step.subpath },
  );
}

// ---------------------------------------------------------------- files

type FileEntry = Extract<ManifestEntry, { type: 'file' }>;

const fileEntry = (rel: string, role: FileEntry['role'], text: string): FileEntry => ({
  path: rel,
  type: 'file',
  role,
  sha256: sha256Of(text),
});

async function readIfFile(
  abs: string,
): Promise<{ st: 'absent' } | { st: 'other' } | { st: 'file'; sha: string }> {
  const info = await lstatOrNull(abs);
  if (info === null) return { st: 'absent' };
  if (!info.isFile()) return { st: 'other' };
  return { st: 'file', sha: sha256Of(await readFile(abs)) };
}

/** The materials map with `state` taken from the item's terminal step (`okf:` `skill:` `link:` `clone:`). */
function materialsFromResults(rt: Runtime): Record<string, MaterialView> {
  const byId = new Map(rt.results.map((r) => [r.id, r]));
  const out: Record<string, MaterialView> = {};
  for (const [key, view] of Object.entries(rt.ctx.materials)) {
    const terminal = rt.steps.find((s) => s.key === key && /^(okf|skill|link|clone):/.test(s.id));
    const result = terminal === undefined ? undefined : byId.get(terminal.id);
    if (result === undefined) {
      out[key] = view;
      continue;
    }
    const ok =
      result.status === 'ok' ||
      result.status === 'unchanged' ||
      (result.status === 'skipped' && result.action === 'kept');
    if (ok) {
      out[key] = { ...view, state: 'ok' };
      continue;
    }
    let reason = result.message ?? 'not placed';
    if (result.status === 'cancelled') reason = 'the run was cancelled';
    else if (result.status === 'skipped') {
      const cause = rt.steps
        .filter((s) => s.key === key)
        .map((s) => byId.get(s.id))
        .find((r) => r?.status === 'failed');
      if (cause?.message) reason = cause.message;
    }
    out[key] = { ...view, state: 'failed', reason };
  }
  return out;
}

async function runWriteContext(rt: Runtime, step: MaterialStep): Promise<Outcome> {
  const where = await target(rt, step.path, false);
  if ('fail' in where) return where.fail;
  const abs = where.abs;
  const text = rt.ctx.renderContext(materialsFromResults(rt));
  const entry = fileEntry(step.path, 'context', text);
  const rec = rt.recorded(step.path);
  const current = await readIfFile(abs);
  if (current.st === 'other') return failed(`${step.path} exists and was not written by ctxman`);
  if (current.st === 'file') {
    if (current.sha === entry.sha256) return done('unchanged', { entry });
    if (rec?.type !== 'file') return failed(`${step.path} exists and was not written by ctxman`);
    if (current.sha !== rec.sha256) {
      const message = `local edits to ${step.path} were replaced`;
      rt.log(message);
      rt.warnings.push({ code: 'context-file-edited', message });
      await writeAtomic(abs, text);
      return done('written', { entry, message });
    }
  }
  await writeAtomic(abs, text);
  return done('written', { entry });
}

async function runWriteFile(
  rt: Runtime,
  step: MaterialStep & { kind: 'writeFile' },
): Promise<Outcome> {
  const where = await target(rt, step.path, false);
  if ('fail' in where) return where.fail;
  const abs = where.abs;
  const entry = fileEntry(step.path, step.role, step.content);
  const rec = rt.recorded(step.path);
  const current = await readIfFile(abs);
  if (current.st === 'absent') {
    await writeAtomic(abs, step.content);
    return done('written', { entry });
  }
  if (current.st === 'other') return kept(`kept the existing ${step.path}`);
  if (current.sha === entry.sha256) return done('unchanged', { entry });
  if (rec?.type === 'file' && rec.sha256 === current.sha) {
    await writeAtomic(abs, step.content);
    return done('written', { entry });
  }
  return kept(
    rec?.type === 'file'
      ? `kept ${step.path}: edited since ctxman wrote it`
      : `kept the existing ${step.path}`,
  );
}

async function runCleanupStage(rt: Runtime, step: MaterialStep): Promise<Outcome> {
  if (step.path !== STAGE_DIR) return failed('unsafe path');
  const abs = safeJoin(rt.ctx.dir, STAGE_DIR);
  if (abs === null) return failed('unsafe path');
  const info = await lstatOrNull(abs).catch(() => null);
  if (info === null) return done('unchanged');
  if (!info.isDirectory()) return failed(`${STAGE_DIR} is not a directory`);
  await rmTree(abs);
  return done('removed');
}

function buildManifest(rt: Runtime): InflateDirManifest {
  const entries = new Map<string, ManifestEntry>();
  for (const entry of rt.ctx.previous?.entries ?? []) entries.set(entry.path, entry);
  const stepById = new Map(rt.steps.map((s) => [s.id, s]));
  for (const result of rt.results) {
    const step = stepById.get(result.id);
    if (result.entry !== undefined) entries.set(result.entry.path, result.entry);
    if (step?.kind === 'remove' && (result.status === 'ok' || result.status === 'unchanged')) {
      entries.delete(step.path);
    }
  }
  return {
    format: 'ctxman-inflate',
    version: 1,
    recipe: rt.ctx.recipe,
    target: rt.ctx.target,
    contextFile: rt.ctx.contextFile,
    generatedAt: rt.ctx.now().toISOString(),
    jobId: rt.ctx.jobId,
    entries: [...entries.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

async function runWriteManifest(rt: Runtime, step: MaterialStep): Promise<Outcome> {
  const dirResult = rt.results.find((r) => r.id === 'dir');
  if (dirResult !== undefined && dirResult.status !== 'ok' && dirResult.status !== 'unchanged') {
    return { status: 'skipped', message: 'skipped: the directory is not available' };
  }
  const where = await target(rt, step.path, false);
  if ('fail' in where) return where.fail;
  const manifest = buildManifest(rt);
  await writeAtomic(where.abs, serializeDirManifest(manifest));
  rt.manifest = manifest;
  return done('written');
}

async function runEnsureDir(rt: Runtime): Promise<Outcome> {
  const info = await statOrNull(rt.ctx.dir);
  if (info !== null && !info.isDirectory())
    return failed(`${rt.ctx.dir} exists and is not a directory`);
  await mkdir(rt.ctx.dir, { recursive: true });
  rt.realDir = await realpath(rt.ctx.dir);
  return done(info === null ? 'created' : 'unchanged');
}

// ---------------------------------------------------------------- the loop

async function runStep(rt: Runtime, step: MaterialStep): Promise<Outcome> {
  switch (step.kind) {
    case 'ensureDir':
      return runEnsureDir(rt);
    case 'remove':
      return runRemove(rt, step);
    case 'symlink':
      return runSymlink(rt, step);
    case 'copyDir':
      return runCopy(rt, step);
    case 'gitClone':
      return runGitClone(rt, step);
    case 'gitUpdate':
      return runGitUpdate(rt, step);
    case 'download':
      return runDownload(rt, step);
    case 'extract':
      return runExtract(rt, step);
    case 'placeSkill':
      return runPlaceSkill(rt, step);
    case 'cleanupStage':
      return runCleanupStage(rt, step);
    case 'writeContext':
      return runWriteContext(rt, step);
    case 'writeFile':
      return runWriteFile(rt, step);
    case 'writeManifest':
      return runWriteManifest(rt, step);
  }
}

function toResult(
  step: MaterialStep,
  outcome: Outcome,
  durationMs: number,
  tail: string[],
): StepResult {
  const base = { id: step.id, durationMs, tail: tail.slice(-TAIL_LINES) };
  switch (outcome.status) {
    case 'failed':
      return { ...base, status: 'failed', action: null, message: outcome.message };
    case 'cancelled':
      return { ...base, status: 'cancelled', action: null, message: outcome.message ?? null };
    case 'skipped':
      return {
        ...base,
        status: 'skipped',
        action: outcome.action ?? null,
        message: outcome.message,
      };
    case 'done':
      return {
        ...base,
        status: outcome.action === 'unchanged' ? 'unchanged' : 'ok',
        action: outcome.action,
        message: outcome.message ?? null,
        ...(outcome.entry === undefined ? {} : { entry: outcome.entry }),
      };
  }
}

/**
 * Runs the steps in order (INFLATE_V2_SPEC §7.2). Never throws: every problem is a step result. A cancelled
 * signal turns later non-`always` steps `cancelled`; a failed `fatal` step skips them; a step whose `after`
 * dependency did not end ok / unchanged is skipped. The manifest is written by the `writeManifest` step.
 */
export async function executeSteps(
  steps: readonly MaterialStep[],
  ctx: ExecuteContext,
): Promise<ExecuteOutcome> {
  const rt: Runtime = {
    ctx,
    realDir: null,
    log: () => undefined,
    recorded: (rel) => ctx.previous?.entries.find((e) => e.path === rel),
    warnings: [],
    results: [],
    steps,
    manifest: null,
  };
  const statusById = new Map<string, StepResult['status']>();
  let fatalFailed: string | null = null;

  for (const step of steps) {
    const tail: string[] = [];
    const emit = (result: StepResult): void => {
      rt.results.push(result);
      statusById.set(step.id, result.status);
      ctx.onProgress({ id: step.id, status: result.status, result });
    };
    const skipWith = (status: 'cancelled' | 'skipped', message: string): void =>
      emit(toResult(step, { status, message }, 0, []));

    if (ctx.signal.aborted && step.always !== true) {
      skipWith('cancelled', 'the run was cancelled');
      continue;
    }
    if (fatalFailed !== null && step.always !== true) {
      skipWith('skipped', `skipped: ${fatalFailed} failed`);
      continue;
    }
    const blocker = step.after.find((dep) => {
      const status = statusById.get(dep);
      return status !== 'ok' && status !== 'unchanged';
    });
    if (blocker !== undefined) {
      skipWith('skipped', `skipped: ${blocker} did not succeed`);
      continue;
    }

    ctx.onProgress({ id: step.id, status: 'running' });
    rt.log = (line: string): void => {
      tail.push(line);
      if (tail.length > TAIL_LINES) tail.shift();
      ctx.onProgress({ id: step.id, status: 'running', line });
    };
    const started = performance.now();
    if (ctx.stepDelayMs !== undefined && ctx.stepDelayMs > 0) {
      await sleep(ctx.stepDelayMs, ctx.signal);
    }
    let outcome: Outcome;
    if (ctx.signal.aborted && step.always !== true) {
      outcome = cancelled();
    } else {
      try {
        outcome = await runStep(rt, step);
      } catch (error) {
        outcome = failed(firstLine(error));
      }
    }
    const result = toResult(step, outcome, Math.round(performance.now() - started), tail);
    emit(result);
    if (step.fatal === true && result.status === 'failed') fatalFailed = step.id;
  }

  return { results: rt.results, manifest: rt.manifest, warnings: rt.warnings };
}
