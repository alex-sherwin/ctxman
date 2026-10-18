// SERVER: generic child-process runner for the Inflate executor (plans/INFLATE_V2_SPEC.md §7.6). Spawns
// `cmd` with an argv array (`shell: false`, `windowsHide: true`, stdin ignored), streams output lines to
// `onLine`, keeps stdout (capped) and the last lines of stdout+stderr, and supports a timeout and an
// AbortSignal (SIGTERM, then SIGKILL after a grace period). Never rejects. No astro:* imports.
// `run-script.ts` is NOT reused: it is specific to ctxman's node scripts (execPath, data-dir env, no line callback).
import { spawn } from 'node:child_process';

export interface ProcOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Called per output line (stdout + stderr, split on /\r\n|\r|\n/, trailing spaces trimmed, empty dropped). */
  onLine?: (line: string) => void;
}

export interface ProcResult {
  /** Exit code; 127 spawn failure; 124 timeout; 130 aborted. */
  code: number;
  /** stdout only, capped at 64 KiB. */
  stdout: string;
  /** Last 20 lines of stdout + stderr, each cut to 300 characters. */
  tail: string[];
  durationMs: number;
  aborted: boolean;
  timedOut: boolean;
  /** Node error code of a spawn failure, e.g. 'ENOENT'. */
  spawnError?: string;
}

export type ProcRunner = (
  cmd: string,
  args: readonly string[],
  opts?: ProcOptions,
) => Promise<ProcResult>;

export const EXIT_SPAWN_FAILED = 127;
export const EXIT_TIMED_OUT = 124;
export const EXIT_ABORTED = 130;
export const STDOUT_CAP_BYTES = 64 * 1024;
export const TAIL_LINES = 20;
export const TAIL_LINE_CHARS = 300;
/** After SIGTERM, wait this long before SIGKILL. */
const KILL_GRACE_MS = 2_000;
/** After SIGKILL, resolve regardless of whether the stdio pipes ever close (a grandchild could hold them). */
const FORCE_RESOLVE_MS = 3_000;

const LINE_BREAK = /\r\n|\r|\n/;

/** Splits a stream into lines across chunk boundaries (git progress separates lines with a bare `\r`). */
class LineSplitter {
  private rest = '';
  private readonly emit: (line: string) => void;

  constructor(emit: (line: string) => void) {
    this.emit = emit;
  }

  push(chunk: string): void {
    const parts = (this.rest + chunk).split(LINE_BREAK);
    this.rest = parts.pop() ?? '';
    for (const part of parts) this.emit(part);
  }

  flush(): void {
    if (this.rest !== '') this.emit(this.rest);
    this.rest = '';
  }
}

export const spawnCapture: ProcRunner = (cmd, args, opts = {}) => {
  const startedAt = performance.now();
  const durationMs = (): number => Math.round(performance.now() - startedAt);
  const failed = (code: number, spawnError: string | undefined, extra: Partial<ProcResult> = {}) =>
    Promise.resolve<ProcResult>({
      code,
      stdout: '',
      tail: [],
      durationMs: durationMs(),
      aborted: false,
      timedOut: false,
      ...(spawnError === undefined ? {} : { spawnError }),
      ...extra,
    });

  if (opts.signal?.aborted === true) {
    return failed(EXIT_ABORTED, undefined, { aborted: true });
  }

  return new Promise<ProcResult>((resolve) => {
    const tail: string[] = [];
    let stdout = '';
    let stdoutBytes = 0;
    let aborted = false;
    let timedOut = false;
    let settled = false;
    let spawnError: string | undefined;
    const timers: NodeJS.Timeout[] = [];

    const onLine = (raw: string): void => {
      const line = raw.replace(/\s+$/, '');
      if (line === '') return;
      const cut = line.length > TAIL_LINE_CHARS ? line.slice(0, TAIL_LINE_CHARS) : line;
      tail.push(cut);
      if (tail.length > TAIL_LINES) tail.shift();
      try {
        opts.onLine?.(cut);
      } catch {
        // a throwing observer must not break the process capture
      }
    };
    const outLines = new LineSplitter(onLine);
    const errLines = new LineSplitter(onLine);

    const finish = (exitCode: number | null, signalName: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      outLines.flush();
      errLines.flush();
      const code = aborted
        ? EXIT_ABORTED
        : timedOut
          ? EXIT_TIMED_OUT
          : spawnError !== undefined
            ? EXIT_SPAWN_FAILED
            : (exitCode ?? (signalName === null ? 1 : 128));
      resolve({
        code,
        stdout,
        tail,
        durationMs: durationMs(),
        aborted,
        timedOut,
        ...(spawnError === undefined ? {} : { spawnError }),
      });
    };

    let child;
    try {
      child = spawn(cmd, [...args], {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnError = (error as NodeJS.ErrnoException | null)?.code ?? 'SPAWN_FAILED';
      finish(null, null);
      return;
    }

    /** Polite kill, SIGKILL after the grace period, resolve regardless a little later. */
    const terminate = (): void => {
      child.kill();
      timers.push(
        setTimeout(() => {
          child.kill('SIGKILL');
          timers.push(setTimeout(() => finish(null, 'SIGKILL'), FORCE_RESOLVE_MS));
        }, KILL_GRACE_MS),
      );
    };
    function onAbort(): void {
      if (settled || aborted || timedOut) return;
      aborted = true;
      terminate();
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdoutBytes < STDOUT_CAP_BYTES) {
        const room = STDOUT_CAP_BYTES - stdoutBytes;
        const size = Buffer.byteLength(chunk);
        stdout +=
          size <= room
            ? chunk
            : Buffer.from(chunk).subarray(0, room).toString('utf8').replace(/�+$/u, '');
        stdoutBytes += Math.min(size, room);
      }
      outLines.push(chunk);
    });
    child.stderr.on('data', (chunk: string) => errLines.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      // 'error' before the process exists (ENOENT, EACCES): there is no 'close'. After a kill() that
      // failed it is also emitted, but then 'close' follows and `settled` guards the second call.
      if (child.pid === undefined) {
        spawnError = error.code ?? 'SPAWN_FAILED';
        finish(null, null);
      }
    });
    child.on('close', (exitCode, signalName) => finish(exitCode, signalName));

    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timers.push(
        setTimeout(() => {
          if (settled || aborted) return;
          timedOut = true;
          terminate();
        }, opts.timeoutMs),
      );
    }
  });
};
