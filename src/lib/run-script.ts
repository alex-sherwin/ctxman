// SERVER: run an allowlisted ctxman script as a child process (PLAN §E.20, UI_SPEC §0.5).
// Cross-platform by construction: `process.execPath` + the script path as argv, `shell: false`,
// `windowsHide: true`. Only names from scripts-allowlist.ts can be run; arguments are built here from
// a validated body, never taken verbatim from the request. No astro:* imports (unit-testable).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { entryUrl, isDatasetId, isValidName, NAME_MAX_LENGTH } from '../datasets/registry.ts';
import type { DatasetId } from '../datasets/registry.ts';
import { stripAnsi } from './ansi.ts';
import type { Issue } from './context-io.ts';
import { resolveDataDir } from './data-dir.ts';
import { entryFileRelPath } from './freshness.ts';
import { getScript } from './scripts-allowlist.ts';
import type { ScriptName } from './scripts-allowlist.ts';

export interface ScriptResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Present iff the script is `add` and it exited 0. `url` = the entry page, e.g. '/task/fix-login'. */
  created?: { dataset: DatasetId; slug: string; path: string; url: string };
}

export const DEFAULT_TIMEOUT_MS = 60_000;
/** Per-stream cap; longer output is cut and marked with `[truncated]`. */
export const MAX_OUTPUT_BYTES = 1024 * 1024;
const TRUNCATED_MARK = '\n[truncated]';
/** After the timeout's polite kill, wait this long before SIGKILL. */
const KILL_GRACE_MS = 1_000;

export const EXIT_TIMEOUT = 124;
export const EXIT_SPAWN_FAILED = 127;

// ---------------------------------------------------------------- request body -> argv

type Built =
  | { ok: true; args: string[]; created?: ScriptResult['created'] }
  | { ok: false; issues: Issue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `--flag value`; values starting with '-' use `--flag=value` (node:util parseArgs rejects `--flag -x`). */
function flag(name: string, value: string): string[] {
  return value.startsWith('-') ? [`--${name}=${value}`] : [`--${name}`, value];
}

/**
 * Validate the request body of POST /api/scripts/:name and turn it into CLI args.
 * check*: body must be absent or `{}` -> `[]`. add: `{ dataset, name, description, title? }` ->
 * `[dataset, name, '--description', d, ('--title', t)]` plus `created` (to return only when the run exits 0).
 */
export function buildArgs(name: ScriptName, body: unknown): Built {
  const def = getScript(name);
  if (def === undefined)
    return { ok: false, issues: [{ path: '', message: `unknown script "${name}"` }] };

  if (def.kind === 'check') {
    if (body === undefined) return { ok: true, args: [] };
    if (!isPlainObject(body)) {
      return { ok: false, issues: [{ path: '', message: 'body must be an empty object {}' }] };
    }
    const issues = Object.keys(body).map((key) => ({ path: key, message: 'unexpected property' }));
    return issues.length === 0 ? { ok: true, args: [] } : { ok: false, issues };
  }

  if (!isPlainObject(body)) {
    return {
      ok: false,
      issues: [
        { path: '', message: 'body must be an object { dataset, name, description, title? }' },
      ],
    };
  }
  const issues: Issue[] = [];
  for (const key of Object.keys(body)) {
    if (!['dataset', 'name', 'description', 'title'].includes(key)) {
      issues.push({ path: key, message: 'unexpected property' });
    }
  }

  const { dataset, name: entryName, description, title } = body;
  if (!isDatasetId(dataset)) {
    issues.push({ path: 'dataset', message: 'must be one of the dataset ids' });
  }
  if (typeof entryName !== 'string' || !isValidName(entryName)) {
    issues.push({
      path: 'name',
      message: `must be kebab-case: a-z, 0-9, single hyphens, no leading/trailing hyphen, 1-${NAME_MAX_LENGTH} characters`,
    });
  }
  if (typeof description !== 'string' || description.trim() === '') {
    issues.push({ path: 'description', message: 'must be a non-empty string' });
  }
  if (title !== undefined && title !== null && typeof title !== 'string') {
    issues.push({ path: 'title', message: 'must be a string' });
  }
  if (
    issues.length > 0 ||
    !isDatasetId(dataset) ||
    typeof entryName !== 'string' ||
    typeof description !== 'string'
  ) {
    return { ok: false, issues };
  }

  const args: string[] = [dataset, entryName, ...flag('description', description.trim())];
  if (typeof title === 'string' && title.trim() !== '') args.push(...flag('title', title.trim()));
  return {
    ok: true,
    args,
    created: {
      dataset,
      slug: entryName,
      path: entryFileRelPath(dataset, entryName),
      url: entryUrl(dataset, entryName),
    },
  };
}

// ---------------------------------------------------------------- spawning

export interface RunOptions {
  /** Kill the process after this long (default 60_000). */
  timeoutMs?: number;
  /** Working directory (default process.cwd(): the repo root, where `pnpm run dev|start` runs). */
  cwd?: string;
  /** Extra environment on top of process.env (tests use it for CTXMAN_DATA_DIR). */
  env?: NodeJS.ProcessEnv;
}

class Capture {
  text = '';
  private bytes = 0;
  private truncated = false;

  push(chunk: string): void {
    if (this.truncated) return;
    const size = Buffer.byteLength(chunk);
    if (this.bytes + size <= MAX_OUTPUT_BYTES) {
      this.text += chunk;
      this.bytes += size;
      return;
    }
    // Cut at the byte budget (Buffer slicing may split a multi-byte char; decode drops the stub).
    const room = MAX_OUTPUT_BYTES - this.bytes;
    this.text += Buffer.from(chunk).subarray(0, room).toString('utf8').replace(/�+$/u, '');
    this.truncated = true;
  }

  result(): string {
    return this.truncated ? `${this.text}${TRUNCATED_MARK}` : this.text;
  }
}

/**
 * Low-level: run `node <absScriptPath> ...args` and collect the result. NOT allowlisted: callers
 * must only pass a path they trust (`runScript` resolves it from the allowlist; tests pass fixtures).
 * Never rejects: a spawn failure is `code: 127`, a timeout is `code: 124`.
 */
export function runNodeFile(
  absScriptPath: string,
  args: readonly string[],
  opts: RunOptions = {},
): Promise<ScriptResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = opts.cwd ?? process.cwd();
  // Scripts must act on the same data dir as the server: pin it to an absolute path.
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  env.CTXMAN_DATA_DIR = resolveDataDir(env);

  const startedAt = performance.now();
  return new Promise<ScriptResult>((resolve) => {
    const out = new Capture();
    const err = new Capture();
    let timedOut = false;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];

    const finish = (code: number, extraStderr = ''): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      resolve({
        code,
        stdout: stripAnsi(out.result()),
        stderr: stripAnsi(err.result() + extraStderr),
        durationMs: Math.round(performance.now() - startedAt),
      });
    };
    const finishTimedOut = (): void => {
      const seconds = Number((timeoutMs / 1000).toFixed(1));
      finish(EXIT_TIMEOUT, `\n[ctxman] timed out after ${seconds}s`);
    };

    let child;
    try {
      child = spawn(process.execPath, [absScriptPath, ...args], {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      finish(EXIT_SPAWN_FAILED, `[ctxman] could not start node: ${errorMessage(error)}`);
      return;
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => out.push(chunk));
    child.stderr.on('data', (chunk: string) => err.push(chunk));
    child.on('error', (error) => {
      finish(EXIT_SPAWN_FAILED, `[ctxman] could not start node: ${errorMessage(error)}`);
    });
    child.on('close', (code, signal) => {
      if (timedOut) return finishTimedOut();
      const signalNumber = signal === null ? 0 : (os.constants.signals[signal] ?? 0);
      finish(code ?? (signalNumber > 0 ? 128 + signalNumber : 1));
    });

    // Timeout: polite kill, SIGKILL after a grace period, and resolve regardless of whether the
    // stdio pipes ever close (a grandchild could hold them open).
    timers.push(
      setTimeout(() => {
        timedOut = true;
        child.kill();
        timers.push(
          setTimeout(() => {
            child.kill('SIGKILL');
            timers.push(setTimeout(finishTimedOut, KILL_GRACE_MS));
          }, KILL_GRACE_MS),
        );
      }, timeoutMs),
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run an allowlisted script (`scripts-allowlist.ts`) with already-built args (see `buildArgs`).
 * Result: `{ code, stdout, stderr, durationMs }`, ANSI stripped, each stream capped at 1 MiB.
 */
export async function runScript(
  name: ScriptName,
  args: readonly string[],
  opts: RunOptions = {},
): Promise<ScriptResult> {
  const def = getScript(name);
  if (def === undefined) throw new Error(`script "${name}" is not allowlisted`);
  const cwd = opts.cwd ?? process.cwd();
  return runNodeFile(path.resolve(cwd, def.file), args, { ...opts, cwd });
}

/**
 * Validate `body`, run the script, attach `created` when `add` exits 0. The API route's whole job.
 * `{ ok: false }` = invalid body (400); a non-zero exit is still `{ ok: true }` (HTTP 200).
 */
export async function executeScript(
  name: ScriptName,
  body: unknown,
  opts: RunOptions = {},
): Promise<{ ok: true; result: ScriptResult } | { ok: false; issues: Issue[] }> {
  const built = buildArgs(name, body);
  if (!built.ok) return built;
  const result = await runScript(name, built.args, opts);
  if (built.created !== undefined && result.code === 0) result.created = built.created;
  return { ok: true, result };
}
