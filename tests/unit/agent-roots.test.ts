import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentRoots, displayPath } from '../../src/lib/agent-history/roots.ts';
import {
  agentKey,
  AGENT_SOURCE_AGENT,
  AGENT_SOURCES,
  parseAgentKey,
} from '../../src/lib/agent-history/types.ts';

describe('agentRoots', () => {
  it('derives every location from CTXMAN_AGENT_HOME and ignores the other overrides then', () => {
    const home = path.resolve('/tmp/fake-home');
    const roots = agentRoots(
      {
        CTXMAN_AGENT_HOME: home,
        CLAUDE_CONFIG_DIR: '/elsewhere/claude',
        CODEX_HOME: '/elsewhere/codex',
        XDG_CONFIG_HOME: '/elsewhere/xdg',
        APPDATA: '/elsewhere/appdata',
      },
      'linux',
    );
    expect(roots.home).toBe(home);
    expect(roots.claude).toBe(path.join(home, '.claude'));
    expect(roots.codex).toBe(path.join(home, '.codex'));
    expect(roots.copilot).toBe(path.join(home, '.copilot'));
    expect(roots.vscode).toEqual([
      { source: 'vscode', user: path.join(home, '.config', 'Code', 'User') },
      { source: 'vscode-insiders', user: path.join(home, '.config', 'Code - Insiders', 'User') },
    ]);
  });

  it('honours CLAUDE_CONFIG_DIR, CODEX_HOME and XDG_CONFIG_HOME without CTXMAN_AGENT_HOME', () => {
    const roots = agentRoots(
      { CLAUDE_CONFIG_DIR: '/c/claude', CODEX_HOME: 'rel/codex', XDG_CONFIG_HOME: '/x' },
      'linux',
    );
    expect(roots.home).toBe(os.homedir());
    expect(roots.claude).toBe(path.resolve('/c/claude'));
    expect(roots.codex).toBe(path.resolve(process.cwd(), 'rel/codex'));
    expect(roots.vscode[0]?.user).toBe(path.join(path.resolve('/x'), 'Code', 'User'));
  });

  it('uses the platform VS Code locations', () => {
    const home = path.resolve('/h');
    expect(agentRoots({ CTXMAN_AGENT_HOME: home }, 'darwin').vscode[1]?.user).toBe(
      path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User'),
    );
    expect(agentRoots({ CTXMAN_AGENT_HOME: home }, 'win32').vscode[0]?.user).toBe(
      path.join(home, 'AppData', 'Roaming', 'Code', 'User'),
    );
    expect(agentRoots({ APPDATA: '/appdata' }, 'win32').vscode[0]?.user).toBe(
      path.join(path.resolve('/appdata'), 'Code', 'User'),
    );
  });

  it('treats a blank CTXMAN_AGENT_HOME as unset and resolves a relative one against the cwd', () => {
    expect(agentRoots({ CTXMAN_AGENT_HOME: '  ' }, 'linux').home).toBe(os.homedir());
    expect(agentRoots({ CTXMAN_AGENT_HOME: 'fake' }, 'linux').home).toBe(path.resolve('fake'));
  });
});

describe('displayPath', () => {
  const home = path.resolve('/Users/me');
  it('shortens the home dir to ~ with forward slashes', () => {
    expect(displayPath(path.join(home, '.claude', 'projects'), home)).toBe('~/.claude/projects');
    expect(displayPath(home, home)).toBe('~');
  });
  it('keeps other paths, also a sibling that only shares the prefix', () => {
    expect(displayPath(path.resolve('/opt/x'), home)).toBe(
      path.resolve('/opt/x').replaceAll('\\', '/'),
    );
    expect(displayPath(path.resolve('/Users/me2/x'), home)).toBe(
      path.resolve('/Users/me2/x').replaceAll('\\', '/'),
    );
  });
});

describe('agent keys', () => {
  it('round-trips every source and refuses unknown sources and odd ids', () => {
    for (const source of AGENT_SOURCES) {
      expect(parseAgentKey(agentKey(source, 'abc-1.2_3'))).toEqual({ source, id: 'abc-1.2_3' });
      expect(AGENT_SOURCE_AGENT[source]).toBeDefined();
    }
    for (const bad of [
      'nope:abc',
      'claude-code:',
      'claude-code:../x',
      'claude-code:a/b',
      'claude-code',
    ]) {
      expect(parseAgentKey(bad), bad).toBeNull();
    }
  });
});
