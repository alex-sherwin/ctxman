// Test fixture shared by unit tests and the e2e servers: a fake home directory holding the session histories and plan
// files of every agent format ctxman imports (concepts/agent-history.md). Every path derives from `agentRoots` with
// CTXMAN_AGENT_HOME pointed at the directory, every file gets an explicit, distinct mtime (`utimesSync`), so every
// order is deterministic. The exported lists say what a listing must return, most recent activity first: sessions
// sort by their last event (never later than the file mtime), plans by mtime. One Claude session was touched long
// after its last event (its mtime is the newest of all) and must sort last.
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { agentRoots } from '../../src/lib/agent-history/roots.ts';
import type { AgentRoots } from '../../src/lib/agent-history/roots.ts';
import type { AgentId, AgentSource } from '../../src/lib/agent-history/types.ts';

// ---------------------------------------------------------------- ids

const CLAUDE_NEWEST = 'c1a0de00-0000-4000-8000-000000000001';
const CLAUDE_OLDER = 'c1a0de00-0000-4000-8000-000000000002';
const CLAUDE_NO_PROMPT = 'c1a0de00-0000-4000-8000-000000000003';
const CLAUDE_STALE = 'c1a0de00-0000-4000-8000-000000000004';
const CLAUDE_COMMANDS_ONLY = 'c1a0de00-0000-4000-8000-000000000005';
const CODEX_JSONL = '0c0de000-0000-4000-8000-00000000000a';
const CODEX_ZST = '0c0de000-0000-4000-8000-00000000000b';
const CODEX_ARCHIVED = '0c0de000-0000-4000-8000-00000000000c';
const CODEX_SUBAGENT = '0c0de000-0000-4000-8000-00000000000d';
const CODEX_PLAN_TURN = '0c0de000-0000-4000-8000-0000000000f1';
const COPILOT = 'c0b11070-0000-4000-8000-000000000001';
const VSCODE_JSON = '5c0de000-0000-4000-8000-000000000001';
const VSCODE_JSONL = '5c0de000-0000-4000-8000-000000000002';
const VSCODE_HASH_LOCAL = 'aaaa1111aaaa1111aaaa1111aaaa1111';
const VSCODE_HASH_REMOTE = 'bbbb2222bbbb2222bbbb2222bbbb2222';

export interface FixtureSession {
  key: string;
  title: string;
  agent: AgentId;
  source: AgentSource;
  /** User prompts in the whole file. */
  prompts: number;
  /** Working directory the summary reports. */
  cwd?: string;
}

/** The sessions a listing returns, newest first (sessions without a prompt and subagent threads are left out). */
export const AGENT_HOME_SESSIONS: readonly FixtureSession[] = [
  {
    // one prompt: its `/compact keep the auth notes` and `! git log -1` are commands, not prompts
    key: `claude-code:${CLAUDE_NEWEST}`,
    title: 'Untangle the zebra login redirect',
    agent: 'claude-code',
    source: 'claude-code',
    prompts: 1,
    cwd: '/Users/me/repos/app',
  },
  {
    key: `codex:${CODEX_ZST}`,
    title: 'Tune the cache eviction',
    agent: 'codex',
    source: 'codex',
    prompts: 1,
    cwd: '/Users/me/repos/cache',
  },
  {
    key: `copilot-cli:${COPILOT}`,
    title: 'Tidy the README badges',
    agent: 'copilot',
    source: 'copilot-cli',
    prompts: 1,
    cwd: '/Users/me/repos/docs',
  },
  {
    key: `vscode:${VSCODE_JSONL}`,
    title: 'Refactor the date picker',
    agent: 'copilot',
    source: 'vscode',
    prompts: 2,
    cwd: 'vscode-remote://ssh-remote+box/home/me/proj',
  },
  {
    key: `codex:${CODEX_JSONL}`,
    title: 'Fix flaky payment webhook test',
    agent: 'codex',
    source: 'codex',
    prompts: 2,
    cwd: '/Users/me/repos/payments',
  },
  {
    key: `vscode:${VSCODE_JSON}`,
    title: 'Why is the build slow on CI?',
    agent: 'copilot',
    source: 'vscode',
    prompts: 1,
    cwd: '/Users/me/repos/web',
  },
  {
    key: `claude-code:${CLAUDE_OLDER}`,
    title: 'Add rate limiting to the API',
    agent: 'claude-code',
    source: 'claude-code',
    prompts: 2,
    cwd: '/Users/me/repos/api',
  },
  {
    key: `codex-archived:${CODEX_ARCHIVED}`,
    title: 'Explain the archived migration plan',
    agent: 'codex',
    source: 'codex-archived',
    prompts: 1,
    cwd: '/Users/me/repos/legacy',
  },
  {
    // the NEWEST file (touched after the fact) whose last event is three days old: sorted last
    key: `claude-code:${CLAUDE_STALE}`,
    title: 'Revisit the walrus feature flags',
    agent: 'claude-code',
    source: 'claude-code',
    prompts: 1,
    cwd: '/Users/me/repos/flags',
  },
];

/** The session whose file mtime is the newest of all although its last event is three days old (sorted last). */
export const AGENT_HOME_STALE_SESSION = AGENT_HOME_SESSIONS.at(-1) as FixtureSession;

/** The newest session: distinctive title, a `<script>` and a relative link in its first prompt, tool calls, thinking. */
export const AGENT_HOME_NEWEST_SESSION = AGENT_HOME_SESSIONS[0] as FixtureSession;

/**
 * Session files that exist but are never listed (and whose detail is a 404): no user prompt (Claude), commands only
 * (Claude: a slash command and a shell escape are not prompts), a subagent thread (Codex).
 */
export const AGENT_HOME_UNLISTED_KEYS: readonly string[] = [
  `claude-code:${CLAUDE_NO_PROMPT}`,
  `claude-code:${CLAUDE_COMMANDS_ONLY}`,
  `codex:${CODEX_SUBAGENT}`,
];

export interface FixturePlan {
  key: string;
  title: string;
  agent: AgentId;
  source: AgentSource;
}

/** The plans a listing returns, newest first. */
export const AGENT_HOME_PLANS: readonly FixturePlan[] = [
  {
    key: 'claude-code:zesty-rollout',
    title: 'Rollout plan for the new feature flag',
    agent: 'claude-code',
    source: 'claude-code',
  },
  {
    key: `codex:${CODEX_JSONL}.${CODEX_PLAN_TURN}`,
    title: 'Plan: fix the payment webhook',
    agent: 'codex',
    source: 'codex',
  },
  {
    key: `copilot-cli:${COPILOT}`,
    title: 'README cleanup plan',
    agent: 'copilot',
    source: 'copilot-cli',
  },
  {
    key: `vscode:${VSCODE_HASH_LOCAL}.repo.release-plan`,
    title: 'Release plan',
    agent: 'copilot',
    source: 'vscode',
  },
  {
    key: 'claude-code:quiet-otter',
    title: 'Migrate the settings page',
    agent: 'claude-code',
    source: 'claude-code',
  },
];

/** A word only the body of the newest session contains, in a response (not its title or prompts): search tests. */
export const AGENT_HOME_SESSION_WORD = 'quokka';

/** A word only the text of the newest Claude plan contains, not its title (search tests). */
export const AGENT_HOME_PLAN_WORD = 'flamingo';

// ---------------------------------------------------------------- builders

const lines = (items: readonly unknown[]): string =>
  `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;

function write(abs: string, content: string | Buffer, mtime: Date): void {
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  utimesSync(abs, mtime, mtime);
}

export interface AgentHomeOptions {
  /** The newest file is one minute before this (default: now). */
  now?: Date;
  /** Platform whose VS Code location is used (default: this one). */
  platform?: NodeJS.Platform;
}

/**
 * Writes the fake home into `dir` (created when missing) and returns its roots: `agentRoots({CTXMAN_AGENT_HOME: dir},
 * platform)`, the same paths the server derives when it runs with CTXMAN_AGENT_HOME=dir.
 */
export function buildAgentHome(
  dir: string,
  options: AgentHomeOptions = {},
): { roots: AgentRoots; now: Date } {
  const now = new Date(Math.floor((options.now ?? new Date()).getTime() / 1000) * 1000);
  const roots = agentRoots({ CTXMAN_AGENT_HOME: dir }, options.platform ?? process.platform);
  const minutes = (n: number): Date => new Date(now.getTime() - n * 60_000);
  const iso = (n: number): string => minutes(n).toISOString();
  mkdirSync(dir, { recursive: true });

  // ------------------------------------------------ Claude Code
  const project = (cwd: string): string =>
    path.join(roots.claude, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  const claudeLine = (id: string, cwd: string, branch: string) => {
    let n = 0;
    return (
      type: 'user' | 'assistant',
      at: number,
      message: unknown,
      extra: Record<string, unknown> = {},
    ) => ({
      type,
      uuid: `${id.slice(0, 8)}-${(n += 1)}`,
      parentUuid: null,
      timestamp: iso(at),
      sessionId: id,
      cwd,
      gitBranch: branch,
      version: '2.5.0',
      isSidechain: false,
      userType: 'external',
      message,
      ...extra,
    });
  };
  {
    const at = claudeLine(CLAUDE_NEWEST, '/Users/me/repos/app', 'main');
    const model = 'claude-opus-5-5';
    write(
      path.join(project('/Users/me/repos/app'), `${CLAUDE_NEWEST}.jsonl`),
      lines([
        { type: 'mode', mode: 'default', sessionId: CLAUDE_NEWEST },
        { type: 'ai-title', aiTitle: 'Login redirect', sessionId: CLAUDE_NEWEST },
        at('user', 50, {
          role: 'user',
          content:
            'Why does the login redirect twice? See [guide](docs/guide.md) first.\n\n<script>alert(1)</script>',
        }),
        at('assistant', 49, {
          model,
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'The redirect guard probably runs twice.' }],
        }),
        at('assistant', 49, {
          model,
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { command: 'git status', description: 'Status' },
            },
          ],
        }),
        at(
          'user',
          48,
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'clean' }] },
          {
            toolUseResult: { stdout: 'clean' },
          },
        ),
        at('assistant', 48, {
          model,
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/lib/auth.ts' } },
          ],
        }),
        at('user', 47, {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't2', content: '…' }],
        }),
        at('assistant', 47, {
          model,
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: `The redirect comes from \`middleware.ts\`.\n\n# Cause\n\nThe guard runs twice (the ${AGENT_HOME_SESSION_WORD} check).`,
            },
          ],
        }),
        at(
          'user',
          46,
          {
            role: 'user',
            content:
              '<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>',
          },
          { isMeta: true },
        ),
        at('user', 45, {
          role: 'user',
          content:
            '<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the auth notes</command-args>',
        }),
        at('user', 45, {
          role: 'user',
          content: '<local-command-stdout>Compacted.</local-command-stdout>',
        }),
        at('user', 44, { role: 'user', content: '<bash-input>git log -1</bash-input>' }),
        at('user', 44, {
          role: 'user',
          content:
            '<bash-stdout>commit abc123 (HEAD -> main)</bash-stdout><bash-stderr></bash-stderr>',
        }),
        at('user', 44, { role: 'user', content: 'A sidechain prompt' }, { isSidechain: true }),
        at(
          'user',
          44,
          {
            role: 'user',
            content: '<task-notification><summary>Agent done</summary></task-notification>',
          },
          { origin: { kind: 'task-notification' } },
        ),
        at('assistant', 43, {
          model,
          role: 'assistant',
          content: [{ type: 'text', text: 'Compacted; the auth notes are kept.' }],
        }),
        { type: 'ai-title', aiTitle: AGENT_HOME_SESSIONS[0]?.title, sessionId: CLAUDE_NEWEST },
      ]),
      minutes(1),
    );
  }
  {
    const at = claudeLine(CLAUDE_OLDER, '/Users/me/repos/api', 'feature/limits');
    const model = 'claude-sonnet-5-5';
    write(
      path.join(project('/Users/me/repos/api'), `${CLAUDE_OLDER}.jsonl`),
      lines([
        { type: 'summary', summary: 'Rate limiting', leafUuid: 'x' },
        at('user', 401, {
          role: 'user',
          content:
            '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>',
        }),
        at('user', 401, {
          role: 'user',
          content: '<local-command-stdout>Set model to sonnet</local-command-stdout>',
        }),
        at('user', 400, {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<system-reminder>Injected reminder.</system-reminder>\nAdd a token bucket limiter to /api/*\nCaveat: this line is a wrapper',
            },
          ],
        }),
        at('assistant', 399, {
          model,
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'g1',
              name: 'Grep',
              input: { pattern: 'rateLimit', path: 'src' },
            },
          ],
        }),
        at('assistant', 399, {
          model,
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'e1',
              name: 'Edit',
              input: { file_path: 'src/limit.ts', old_string: 'a', new_string: 'b' },
            },
          ],
        }),
        at('assistant', 398, {
          model,
          role: 'assistant',
          content: [{ type: 'text', text: 'Added the <b>limiter</b>; see ![chart](chart.png).' }],
        }),
        at('user', 397, {
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the error screenshot' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        }),
        at('assistant', 396, {
          model,
          role: 'assistant',
          content: [{ type: 'text', text: 'Fixed.' }],
        }),
        { type: 'ai-title', aiTitle: AGENT_HOME_SESSIONS[6]?.title, sessionId: CLAUDE_OLDER },
      ]),
      minutes(8),
    );
  }
  {
    const at = claudeLine(CLAUDE_NO_PROMPT, '/Users/me/repos/app', 'main');
    write(
      path.join(project('/Users/me/repos/app'), `${CLAUDE_NO_PROMPT}.jsonl`),
      lines([
        at('user', 300, { role: 'user', content: 'meta only' }, { isMeta: true }),
        at('assistant', 299, {
          model: 'claude-opus-5-5',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello.' }],
        }),
        at('user', 298, {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }],
        }),
      ]),
      minutes(5),
    );
    // Commands only (a typed slash command, a shell escape and its output): no prompt, never listed.
    const cmd = claudeLine(CLAUDE_COMMANDS_ONLY, '/Users/me/repos/app', 'main');
    write(
      path.join(project('/Users/me/repos/app'), `${CLAUDE_COMMANDS_ONLY}.jsonl`),
      lines([
        cmd('user', 290, { role: 'user', content: '/add-dir ~/repos/shared' }),
        cmd('user', 289, { role: 'user', content: '<bash-input>pwd</bash-input>' }),
        cmd('user', 289, {
          role: 'user',
          content: '<bash-stdout>/Users/me/repos/app</bash-stdout>',
        }),
        cmd('assistant', 288, {
          model: 'claude-opus-5-5',
          role: 'assistant',
          content: [{ type: 'text', text: 'Added the directory.' }],
        }),
      ]),
      minutes(13),
    );
    // A subagent transcript beside the sessions and one in a session sub-dir: never listed.
    write(
      path.join(project('/Users/me/repos/app'), 'agent-a1b2c3.jsonl'),
      lines([at('user', 297, { role: 'user', content: 'subagent task' })]),
      minutes(11),
    );
    write(
      path.join(project('/Users/me/repos/app'), CLAUDE_NEWEST, 'subagents', 'agent-x.jsonl'),
      lines([at('user', 297, { role: 'user', content: 'nested subagent task' })]),
      minutes(12),
    );
  }

  {
    // Touched long after its last event (three days ago): the newest mtime of all, sorted last by activity.
    const days = 3 * 24 * 60;
    const at = claudeLine(CLAUDE_STALE, '/Users/me/repos/flags', 'main');
    write(
      path.join(project('/Users/me/repos/flags'), `${CLAUDE_STALE}.jsonl`),
      lines([
        at('user', days + 5, { role: 'user', content: 'Which feature flags are stale?' }),
        at('assistant', days, {
          model: 'claude-opus-5-5',
          role: 'assistant',
          content: [{ type: 'text', text: 'Three flags are stale.' }],
        }),
        { type: 'ai-title', aiTitle: AGENT_HOME_STALE_SESSION.title, sessionId: CLAUDE_STALE },
      ]),
      new Date(now.getTime() - 30_000),
    );
  }

  // ------------------------------------------------ Codex
  const codexDay = path.join(roots.codex, 'sessions', '2026', '10', '20');
  const rollout = (id: string, stamp: string): string => `rollout-${stamp}-${id}.jsonl`;
  const meta = (id: string, cwd: string, at: number, extra: Record<string, unknown> = {}) => ({
    timestamp: iso(at),
    type: 'session_meta',
    payload: {
      id,
      timestamp: iso(at),
      cwd,
      originator: 'codex-tui',
      cli_version: '0.150.0',
      thread_source: 'user',
      source: 'cli',
      ...extra,
    },
  });
  const item = (at: number, payload: Record<string, unknown>) => ({
    timestamp: iso(at),
    type: 'response_item',
    payload,
  });
  const event = (at: number, payload: Record<string, unknown>) => ({
    timestamp: iso(at),
    type: 'event_msg',
    payload,
  });
  const userItem = (at: number, text: string) =>
    item(at, { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
  write(
    path.join(codexDay, rollout(CODEX_JSONL, '2026-10-20T09-00-00')),
    lines([
      meta(CODEX_JSONL, '/Users/me/repos/payments', 200, {
        git: { branch: 'fix/webhook', commit_hash: 'abc' },
      }),
      {
        timestamp: iso(200),
        type: 'turn_context',
        payload: { model: 'gpt-5.5-codex', cwd: '/Users/me/repos/payments' },
      },
      item(200, {
        type: 'message',
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: '<permissions instructions>sandboxed</permissions instructions>',
          },
        ],
      }),
      userItem(
        200,
        '<environment_context>\n  <cwd>/Users/me/repos/payments</cwd>\n</environment_context>',
      ),
      userItem(199, 'The webhook test is flaky, find out why'),
      event(199, {
        type: 'user_message',
        message: 'The webhook test is flaky, find out why',
        images: [],
      }),
      item(198, {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: '**Checking the test** for timing issues' }],
        encrypted_content: 'zzz',
      }),
      item(198, {
        type: 'function_call',
        name: 'shell',
        arguments: JSON.stringify({ command: ['bash', '-lc', 'pnpm test webhook'] }),
        call_id: 'c1',
      }),
      item(197, { type: 'function_call_output', call_id: 'c1', output: 'FAIL' }),
      item(197, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'The test races the retry timer.' }],
      }),
      userItem(196, 'Fix it'),
      event(196, { type: 'user_message', message: 'Fix it', images: [] }),
      item(195, {
        type: 'local_shell_call',
        action: { type: 'exec', command: ['git', 'diff'] },
        status: 'completed',
      }),
      item(195, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Fixed by awaiting the timer.' }],
      }),
    ]),
    minutes(6),
  );
  write(
    path.join(codexDay, `${rollout(CODEX_ZST, '2026-10-20T10-00-00')}.zst`),
    zstdCompressSync(
      Buffer.from(
        lines([
          meta(CODEX_ZST, '/Users/me/repos/cache', 60, {
            git: { branch: 'main' },
            source: 'vscode',
            originator: 'Codex Desktop',
          }),
          { timestamp: iso(60), type: 'turn_context', payload: { model: 'gpt-5.5' } },
          userItem(60, '# AGENTS.md instructions for /Users/me/repos/cache\n\nBe brief.'),
          userItem(60, 'Why are cache hits so low?'),
          event(60, {
            type: 'item_completed',
            thread_id: CODEX_ZST,
            turn_id: 't1',
            item: {
              type: 'UserMessage',
              id: 'u1',
              content: [{ type: 'text', text: 'Why are cache hits so low?', text_elements: [] }],
            },
          }),
          item(59, {
            type: 'custom_tool_call',
            name: 'exec',
            input: "const r = await sh('rg evict src')",
            call_id: 'x1',
          }),
          item(59, {
            type: 'agent_message',
            author: '/root',
            recipient: '/root/worker',
            content: [{ type: 'input_text', text: 'check the eviction policy' }],
          }),
          item(58, {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Eviction runs on every request.' }],
          }),
        ]),
      ),
    ),
    minutes(2),
  );
  write(
    path.join(codexDay, rollout(CODEX_SUBAGENT, '2026-10-20T09-30-00')),
    lines([
      meta(CODEX_SUBAGENT, '/Users/me/repos/payments', 190, {
        parent_thread_id: CODEX_JSONL,
        thread_source: 'subagent',
        source: { subagent: { other: 'x' } },
      }),
      userItem(190, 'Subagent task: read the logs'),
    ]),
    minutes(9),
  );
  write(
    path.join(roots.codex, 'archived_sessions', rollout(CODEX_ARCHIVED, '2026-10-10T08-00-00')),
    lines([
      meta(CODEX_ARCHIVED, '/Users/me/repos/legacy', 1000),
      userItem(1000, 'Explain the archived migration plan'),
      item(999, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'It moves the tables in two steps.' }],
      }),
    ]),
    minutes(10),
  );
  write(
    path.join(roots.codex, 'session_index.jsonl'),
    lines([
      { id: CODEX_JSONL, thread_name: 'Old name of the webhook thread', updated_at: iso(190) },
      { id: CODEX_ZST, thread_name: AGENT_HOME_SESSIONS[1]?.title, updated_at: iso(55) },
      { id: CODEX_JSONL, thread_name: AGENT_HOME_SESSIONS[4]?.title, updated_at: iso(150) },
    ]),
    minutes(30),
  );

  // ------------------------------------------------ GitHub Copilot CLI
  {
    const sessionDir = path.join(roots.copilot, 'session-state', COPILOT);
    let n = 0;
    const ev = (type: string, at: number, data: Record<string, unknown>) => ({
      type,
      data,
      id: `e${(n += 1)}`,
      timestamp: iso(at),
      parentId: null,
    });
    write(
      path.join(sessionDir, 'workspace.yaml'),
      `id: ${COPILOT}\ncwd: /Users/me/repos/docs\nbranch: docs\nsummary: ${AGENT_HOME_SESSIONS[2]?.title}\nsummary_count: 1\ncreated_at: ${iso(80)}\nupdated_at: ${iso(70)}\n`,
      minutes(20),
    );
    write(
      path.join(sessionDir, 'events.jsonl'),
      lines([
        ev('session.start', 80, {
          sessionId: COPILOT,
          startTime: iso(80),
          context: { cwd: '/Users/me/repos/docs', branch: 'docs' },
        }),
        ev('session.model_change', 80, { newModel: 'claude-sonnet-5' }),
        ev('user.message', 79, {
          content: 'Tidy the README badges',
          transformedContent: 'Tidy the README badges [ctx]',
          attachments: [],
        }),
        ev('assistant.reasoning', 79, {
          content: 'Look at the badge row first.',
          reasoningId: 'r1',
        }),
        ev('assistant.message', 78, {
          content: 'I will check the README.',
          messageId: 'm1',
          toolRequests: [
            { toolCallId: 'tc1', name: 'view', arguments: { path: 'README.md' }, type: 'function' },
          ],
        }),
        ev('tool.execution_start', 78, {
          toolCallId: 'tc1',
          toolName: 'view',
          arguments: { path: 'README.md' },
        }),
        ev('tool.execution_start', 77, {
          toolCallId: 'tc2',
          toolName: 'bash',
          arguments: { command: 'git log -1' },
        }),
        ev('assistant.message', 77, {
          content: 'subagent text',
          messageId: 'm2',
          parentToolCallId: 'tc9',
          toolRequests: [],
        }),
        ev('assistant.message', 76, {
          content: 'Badges are tidy now.',
          messageId: 'm3',
          toolRequests: [],
        }),
      ]),
      minutes(3),
    );
    write(
      path.join(sessionDir, 'plan.md'),
      `# ${AGENT_HOME_PLANS[2]?.title}\n\n1. Sort the badges\n2. Drop the stale ones\n`,
      minutes(23),
    );
  }

  // ------------------------------------------------ VS Code (GitHub Copilot chat)
  {
    const user = roots.vscode[0]?.user ?? path.join(dir, 'vscode');
    const storage = path.join(user, 'workspaceStorage');
    write(
      path.join(storage, VSCODE_HASH_LOCAL, 'workspace.json'),
      JSON.stringify({ folder: 'file:///Users/me/repos/web' }),
      minutes(60),
    );
    write(
      path.join(storage, VSCODE_HASH_LOCAL, 'chatSessions', `${VSCODE_JSON}.json`),
      JSON.stringify({
        version: 3,
        sessionId: VSCODE_JSON,
        creationDate: minutes(250).getTime(),
        lastMessageDate: minutes(240).getTime(),
        requests: [
          {
            requestId: 'r1',
            message: { text: AGENT_HOME_SESSIONS[5]?.title, parts: [] },
            timestamp: minutes(250).getTime(),
            modelId: 'copilot/gpt-5',
            response: [
              { value: 'Check the ', supportHtml: false },
              {
                kind: 'inlineReference',
                inlineReference: {
                  fsPath: '/Users/me/repos/web/ci.yml',
                  path: '/Users/me/repos/web/ci.yml',
                  scheme: 'file',
                },
              },
              { value: ' cache step.' },
              { kind: 'thinking', value: 'The cache key ', id: 'th1' },
              { kind: 'thinking', value: 'changes every run.', id: 'th1' },
              { kind: 'prepareToolInvocation', toolName: 'copilot_readFile' },
              {
                kind: 'toolInvocationSerialized',
                toolId: 'copilot_readFile',
                invocationMessage: { value: 'Reading [](file:///Users/me/repos/web/ci.yml#1-20)' },
                isComplete: true,
              },
              {
                kind: 'toolInvocationSerialized',
                toolId: 'run_in_terminal',
                invocationMessage: 'Running `npm ci`',
                fromSubAgent: true,
              },
              { value: 'Pin the key to the lockfile hash.' },
            ],
          },
        ],
      }),
      minutes(7),
    );
    write(
      path.join(
        storage,
        VSCODE_HASH_LOCAL,
        'GitHub.copilot-chat',
        'memory-tool',
        'memories',
        'repo',
        'release-plan.md',
      ),
      `# ${AGENT_HOME_PLANS[3]?.title}\n\nShip the web app on Friday after the CI fix.\n`,
      minutes(24),
    );
    write(
      path.join(storage, VSCODE_HASH_REMOTE, 'workspace.json'),
      JSON.stringify({ folder: 'vscode-remote://ssh-remote%2Bbox/home/me/proj' }),
      minutes(60),
    );
    write(
      path.join(storage, VSCODE_HASH_REMOTE, 'chatSessions', `${VSCODE_JSONL}.jsonl`),
      lines([
        {
          kind: 0,
          v: {
            version: 3,
            sessionId: VSCODE_JSONL,
            creationDate: minutes(90).getTime(),
            requests: [],
            inputState: { inputText: '' },
          },
        },
        {
          kind: 2,
          k: ['requests'],
          v: [
            {
              requestId: 'r1',
              message: { text: 'Refactor the date picker into a hook', parts: [] },
              timestamp: minutes(90).getTime(),
              modelId: 'copilot/claude-sonnet-5',
              response: [],
            },
          ],
        },
        {
          kind: 2,
          k: ['requests', 0, 'response'],
          v: [{ value: 'Start with the ' }, { value: 'draft' }],
        },
        { kind: 2, k: ['requests', 0, 'response'], i: 1, v: [{ value: '`DatePicker` props.' }] },
        { kind: 1, k: ['customTitle'], v: AGENT_HOME_SESSIONS[3]?.title },
        { kind: 1, k: ['requests', 0, 'result'], v: { timings: {} } },
        { kind: 3, k: ['inputState'] },
        {
          kind: 2,
          k: ['requests'],
          v: [
            {
              requestId: 'r2',
              message: { text: 'Add keyboard support', parts: [] },
              timestamp: minutes(85).getTime(),
              response: [{ value: 'Arrow keys now move the day.' }],
            },
          ],
        },
        'not json at all',
      ]).replace('"not json at all"', '{torn line'),
      minutes(4),
    );
  }

  // ------------------------------------------------ plans
  write(
    path.join(roots.claude, 'plans', 'zesty-rollout.md'),
    `# ${AGENT_HOME_PLANS[0]?.title}\n\nTurn the ${AGENT_HOME_PLAN_WORD} flag on for 5% of users, then everyone.\n\n## Steps\n\n1. Add the flag\n2. Watch the [dashboard](./dash.md) and <b>alerts</b>\n`,
    minutes(21),
  );
  write(
    path.join(roots.claude, 'plans', 'quiet-otter.md'),
    `---\ntitle: ignored frontmatter\n---\n\n# ${AGENT_HOME_PLANS[4]?.title}\n\nMove the settings page to the new form kit.\n`,
    minutes(25),
  );
  write(
    path.join(roots.codex, 'plans', CODEX_JSONL, CODEX_PLAN_TURN, 'PLAN.md'),
    `# ${AGENT_HOME_PLANS[1]?.title}\n\nAwait the retry timer in the webhook test.\n`,
    minutes(22),
  );

  return { roots, now };
}
