// NODE (no fs calls): where the coding agents keep their session histories and plan files (concepts/agent-history.md,
// plans/AGENT_HISTORY_SPEC.md §1). Everything derives from one home directory: `CTXMAN_AGENT_HOME` when set (tests and
// e2e isolate from the real home with it, and then EVERY other override below is ignored), else `os.homedir()`.
// Read env inside functions only; nothing here touches the disk.
import os from 'node:os';
import path from 'node:path';
import type { AgentSource } from './types.ts';

export const AGENT_HOME_ENV = 'CTXMAN_AGENT_HOME';

export type VscodeSource = Extract<AgentSource, 'vscode' | 'vscode-insiders'>;

export interface VscodeRoot {
  source: VscodeSource;
  /** The `User` directory of that VS Code build (holds `workspaceStorage/` and `globalStorage/`). */
  user: string;
}

export interface AgentRoots {
  /** The home directory every path derives from (the one `~` stands for in display paths). */
  home: string;
  /** Claude Code's config dir: `CLAUDE_CONFIG_DIR`, else `<home>/.claude`. */
  claude: string;
  /** Codex's home: `CODEX_HOME`, else `<home>/.codex`. */
  codex: string;
  /** GitHub Copilot CLI: `<home>/.copilot`. */
  copilot: string;
  /** VS Code (stable, then Insiders) user dirs. */
  vscode: readonly VscodeRoot[];
}

const VSCODE_APPS: readonly { source: VscodeSource; app: string }[] = [
  { source: 'vscode', app: 'Code' },
  { source: 'vscode-insiders', app: 'Code - Insiders' },
];

/** A non-blank env value, resolved against the cwd; undefined when unset or blank. */
function envPath(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  return raw === undefined || raw.trim() === '' ? undefined : path.resolve(process.cwd(), raw);
}

/** The agent history locations for this environment (pure function of `env`, `platform` and the OS home dir). */
export function agentRoots(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): AgentRoots {
  const pinned = envPath(env, AGENT_HOME_ENV);
  const home = pinned ?? os.homedir();
  // With CTXMAN_AGENT_HOME set nothing else of the environment counts: a test home is complete on its own.
  const override = (name: string): string | undefined =>
    pinned === undefined ? envPath(env, name) : undefined;
  const configBase =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : platform === 'win32'
        ? (override('APPDATA') ?? path.join(home, 'AppData', 'Roaming'))
        : (override('XDG_CONFIG_HOME') ?? path.join(home, '.config'));
  return {
    home,
    claude: override('CLAUDE_CONFIG_DIR') ?? path.join(home, '.claude'),
    codex: override('CODEX_HOME') ?? path.join(home, '.codex'),
    copilot: path.join(home, '.copilot'),
    vscode: VSCODE_APPS.map(({ source, app }) => ({
      source,
      user: path.join(configBase, app, 'User'),
    })),
  };
}

/** `abs` for display: the home directory shortened to `~`, forward slashes on every OS. */
export function displayPath(abs: string, home: string): string {
  const rel = path.relative(home, abs);
  const inside =
    rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  const shown = inside ? (rel === '' ? '~' : `~/${rel}`) : abs;
  return shown.replaceAll('\\', '/');
}
