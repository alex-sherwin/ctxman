// Runs scripts/<script> with Node (type stripping) against a temp data dir, async so a describe.concurrent can overlap the process starts.
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function spawnScript(
  script: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [path.join(repoRoot, 'scripts', script), ...args],
      { cwd, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof e.code === 'number' ? e.code : null,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
    };
  }
}

/** Runs scripts/<script> in the repo root with `CTXMAN_DATA_DIR=dataDir` ('' = set but empty). */
export function runCli(script: string, dataDir: string, ...args: string[]): Promise<Run> {
  return spawnScript(script, args, repoRoot, {
    ...process.env,
    CTXMAN_DATA_DIR: dataDir,
    NO_COLOR: '1',
  });
}

/** Runs a script with another working directory (the schemas dir is cwd-relative). */
export function runCliIn(cwd: string, script: string, ...args: string[]): Promise<Run> {
  return spawnScript(script, args, cwd, { ...process.env, NO_COLOR: '1' });
}
