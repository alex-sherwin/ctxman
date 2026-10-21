// Listing, paging, filtering and details of agent sessions and plans against the shared fake home
// (tests/fixtures/agent-home.ts), plus the route parameter helpers and the API error mapping.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentHistoryError } from '../../src/lib/agent-history/errors.ts';
import {
  byteLineStream,
  jsonLineStream,
  lineStream,
  readHeadTail,
  readZstdHeadTail,
} from '../../src/lib/agent-history/files.ts';
import {
  agentPlanDetail,
  clearPlanCache,
  listAgentPlans,
  PLAN_MAX_BYTES,
} from '../../src/lib/agent-history/plans.ts';
import {
  keyParam,
  planListParams,
  sessionListParams,
  sessionOptionsParams,
} from '../../src/lib/agent-history/query.ts';
import {
  agentSessionDetail,
  clearSessionCache,
  listAgentSessions,
} from '../../src/lib/agent-history/sessions.ts';
import { DocIoError } from '../../src/lib/doc-io.ts';
import { agentErrorResponse } from '../../src/lib/http.ts';
import {
  AGENT_HOME_NEWEST_SESSION,
  AGENT_HOME_PLAN_WORD,
  AGENT_HOME_PLANS,
  AGENT_HOME_SESSIONS,
  AGENT_HOME_STALE_SESSION,
  AGENT_HOME_UNLISTED_KEYS,
  buildAgentHome,
} from '../fixtures/agent-home.ts';
import type { AgentRoots } from '../../src/lib/agent-history/roots.ts';

let home: string;
let roots: AgentRoots;
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-home-'));
  ({ roots } = buildAgentHome(home, { now: new Date('2026-10-21T12:00:00Z') }));
  env = { CTXMAN_AGENT_HOME: home };
  clearSessionCache();
  clearPlanCache();
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

async function failure(promise: Promise<unknown>): Promise<AgentHistoryError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AgentHistoryError) return error;
    throw error;
  }
  throw new Error('expected an AgentHistoryError');
}

describe('listAgentSessions', () => {
  it('lists every format by last activity, leaving out prompt-less and command-only sessions, subagents and agent-* files', async () => {
    const list = await listAgentSessions({}, env);
    expect(list.items.map((i) => [i.key, i.title])).toEqual(
      AGENT_HOME_SESSIONS.map((s) => [s.key, s.title]),
    );
    expect(list.items.map((i) => i.cwd)).toEqual(AGENT_HOME_SESSIONS.map((s) => s.cwd));
    expect(list.next).toBeNull();
    for (const key of AGENT_HOME_UNLISTED_KEYS)
      expect(list.items.map((i) => i.key)).not.toContain(key);
    const newest = list.items[0];
    expect(newest).toMatchObject({
      agent: 'claude-code',
      source: 'claude-code',
      gitBranch: 'main',
      model: 'claude-opus-5-5',
      modifiedAt: '2026-10-21T11:59:00.000Z',
      // the last event (an assistant line 43 minutes before now), not the mtime
      lastActivityAt: '2026-10-21T11:17:00.000Z',
    });
    expect(newest?.firstPrompt).toBe(
      'Why does the login redirect twice? See [guide](docs/guide.md) first. <script>alert(1)</script>',
    );
    expect(list.sources.map((s) => [s.source, s.exists])).toEqual([
      ['claude-code', true],
      ['codex', true],
      ['codex-archived', true],
      ['copilot-cli', true],
      ['vscode', true],
      ['vscode-insiders', false],
    ]);
    expect(list.sources[0]?.path).toBe('~/.claude/projects');
  });

  it('pages with offset / limit and next (offset = the items returned so far)', async () => {
    const first = await listAgentSessions({ limit: 3 }, env);
    expect(first.items.map((i) => i.key)).toEqual(
      AGENT_HOME_SESSIONS.slice(0, 3).map((s) => s.key),
    );
    expect(first.next).toBe(3);
    const second = await listAgentSessions({ offset: 3, limit: 3 }, env);
    expect(second.items.map((i) => i.key)).toEqual(
      AGENT_HOME_SESSIONS.slice(3, 6).map((s) => s.key),
    );
    expect(second.next).toBe(6);
    const rest = await listAgentSessions({ offset: 6, limit: 200 }, env);
    expect(rest.items.map((i) => i.key)).toEqual(AGENT_HOME_SESSIONS.slice(6).map((s) => s.key));
    expect(rest.next).toBeNull();
    // exactly a page left: no next
    const last = await listAgentSessions({ offset: AGENT_HOME_SESSIONS.length - 2, limit: 2 }, env);
    expect(last.items).toHaveLength(2);
    expect(last.next).toBeNull();
    expect((await listAgentSessions({ offset: 99 }, env)).items).toEqual([]);
  });

  it('sorts by the last event, not the mtime: a file touched days after its last event sorts below later sessions', async () => {
    const list = await listAgentSessions({}, env);
    const stale = list.items.find((i) => i.key === AGENT_HOME_STALE_SESSION.key);
    // its mtime is the newest of all ...
    expect(stale?.modifiedAt).toBe('2026-10-21T11:59:30.000Z');
    expect(Math.max(...list.items.map((i) => Date.parse(i.modifiedAt)))).toBe(
      Date.parse('2026-10-21T11:59:30.000Z'),
    );
    // ... its last event three days old: it is last
    expect(stale?.lastActivityAt).toBe('2026-10-18T12:00:00.000Z');
    expect(list.items.at(-1)?.key).toBe(AGENT_HOME_STALE_SESSION.key);
    const times = list.items.map((i) => Date.parse(i.lastActivityAt ?? i.modifiedAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    for (const item of list.items) {
      expect(Date.parse(item.lastActivityAt ?? '')).toBeLessThanOrEqual(
        Date.parse(item.modifiedAt),
      );
    }
    // the first page of one is the session with the latest event, although another file is newer
    expect((await listAgentSessions({ limit: 1 }, env)).items.map((i) => i.key)).toEqual([
      AGENT_HOME_NEWEST_SESSION.key,
    ]);
    // filtered to Claude: the stale session is still last
    expect(
      (await listAgentSessions({ agent: 'claude-code' }, env)).items.map((i) => i.key),
    ).toEqual(AGENT_HOME_SESSIONS.filter((s) => s.agent === 'claude-code').map((s) => s.key));
  });

  it('a last event later than the mtime (a skewed clock) counts as the mtime', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-skew-'));
    try {
      const { roots: r } = buildAgentHome(dir, { now: new Date('2026-10-21T12:00:00Z') });
      const file = path.join(
        r.claude,
        'projects',
        '-skew',
        'c1a0de00-0000-4000-8000-0000000000aa.jsonl',
      );
      mkdirSync(path.dirname(file), { recursive: true });
      const user = {
        type: 'user',
        timestamp: '2026-10-22T09:00:00Z',
        message: { content: 'From the future' },
      };
      writeFileSync(file, `${JSON.stringify(user)}\n`);
      const mtime = new Date('2026-10-21T11:30:00Z');
      utimesSync(file, mtime, mtime);
      const item = (await listAgentSessions({}, { CTXMAN_AGENT_HOME: dir })).items.find(
        (i) => i.title === 'From the future',
      );
      expect(item?.lastActivityAt).toBe('2026-10-21T11:30:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('filters by agent and by every token of q (title, prompt, cwd, branch)', async () => {
    const copilot = await listAgentSessions({ agent: 'copilot' }, env);
    expect(copilot.items.map((i) => i.source)).toEqual(['copilot-cli', 'vscode', 'vscode']);
    expect(copilot.sources.map((s) => s.source)).toEqual([
      'copilot-cli',
      'vscode',
      'vscode-insiders',
    ]);
    expect((await listAgentSessions({ agent: 'codex' }, env)).items.map((i) => i.key)).toEqual(
      AGENT_HOME_SESSIONS.filter((s) => s.agent === 'codex').map((s) => s.key),
    );
    expect((await listAgentSessions({ q: 'ZEBRA redirect' }, env)).items.map((i) => i.key)).toEqual(
      [AGENT_HOME_NEWEST_SESSION.key],
    );
    expect((await listAgentSessions({ q: 'repos/payments fix/webhook' }, env)).items).toHaveLength(
      1,
    );
    expect((await listAgentSessions({ q: 'zebra nothing-else' }, env)).items).toEqual([]);
  });

  it('recomputes a summary when the file changes (cache keyed by mtime and size)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-cache-'));
    try {
      const { roots: r } = buildAgentHome(dir, { now: new Date('2026-10-21T12:00:00Z') });
      const e = { CTXMAN_AGENT_HOME: dir };
      const file = path.join(
        r.claude,
        'projects',
        '-Users-me-repos-app',
        'c1a0de00-0000-4000-8000-000000000001.jsonl',
      );
      expect((await listAgentSessions({ limit: 1 }, e)).items[0]?.title).toBe(
        AGENT_HOME_NEWEST_SESSION.title,
      );
      const user = {
        type: 'user',
        timestamp: '2026-10-21T12:20:00Z',
        message: { content: 'Changed ask' },
      };
      writeFileSync(file, `${JSON.stringify(user)}\n`);
      const later = new Date('2026-10-21T12:30:00Z');
      utimesSync(file, later, later);
      expect((await listAgentSessions({ limit: 1 }, e)).items[0]?.title).toBe('Changed ask');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an empty home lists nothing and says where it looked', async () => {
    const list = await listAgentSessions({});
    expect(list.items).toEqual([]);
    expect(list.next).toBeNull();
    expect(list.sources.every((s) => !s.exists && s.path.startsWith('~/'))).toBe(true);
  });
});

describe('agentSessionDetail', () => {
  it('builds the import file of the newest session with the default options', async () => {
    const detail = await agentSessionDetail(
      AGENT_HOME_NEWEST_SESSION.key,
      undefined,
      env,
      new Date('2026-10-21T12:00:00Z'),
    );
    expect(detail.prompts).toBe(1);
    expect(detail.truncated).toBe(false);
    expect(detail.defaultPath).toBe(
      'sessions/2026-10-21-claude-code-untangle-the-zebra-login-redirect.md',
    );
    expect(detail.markdown).toContain('title: Untangle the zebra login redirect\n');
    expect(detail.markdown).toContain('index: false\n');
    expect(detail.markdown).toContain('- `Bash` `git status`\n- `Read` `src/lib/auth.ts`');
    expect(detail.markdown).toContain('guide (`docs/guide.md`)');
    expect(detail.markdown).toContain('&lt;script>alert(1)&lt;/script>');
    // a slash command and a shell escape are commands in the flow, not prompts; the shell output is dropped
    expect(detail.markdown).toContain(
      '\n\n- Command: `/compact keep the auth notes`\n- Command: `! git log -1`\n\n### Response\n\nCompacted; the auth notes are kept.\n',
    );
    expect(detail.markdown).not.toContain('## Prompt 2');
    expect(detail.markdown).not.toContain('abc123');
    expect(detail.markdown).toContain('prompts: 1\n');
    expect(detail.markdown).not.toContain('Thinking');
    expect(detail.markdown).not.toContain('sidechain');
    expect(detail.html).toContain('<h1');
    expect(detail.html).not.toContain('<script');
    expect(detail.html).not.toContain('---');
  });

  it('honours tools and thinking', async () => {
    const detail = await agentSessionDetail(
      AGENT_HOME_NEWEST_SESSION.key,
      { tools: false, thinking: true },
      env,
    );
    expect(detail.markdown).toContain('> **Thinking:** The redirect guard probably runs twice.');
    expect(detail.markdown).not.toContain('`Bash`');
  });

  it('reads every listed format, the zstd one included', async () => {
    for (const session of AGENT_HOME_SESSIONS) {
      const detail = await agentSessionDetail(session.key, { tools: true, thinking: true }, env);
      expect(detail.prompts, session.key).toBe(session.prompts);
      expect(detail.summary.title, session.key).toBe(session.title);
    }
    const zst = await agentSessionDetail(AGENT_HOME_SESSIONS[1]?.key ?? '', undefined, env);
    expect(zst.markdown).toContain(
      '- `agent message` `/root → /root/worker: check the eviction policy`',
    );
    expect(zst.markdown).not.toContain('AGENTS.md instructions');
  });

  it('a session the list hides (no prompt, commands only, a subagent thread) is not found', async () => {
    for (const key of AGENT_HOME_UNLISTED_KEYS) {
      expect((await failure(agentSessionDetail(key, undefined, env))).code, key).toBe('not-found');
    }
  });

  it('a slash command first message is neither the title nor the first prompt', async () => {
    const older = AGENT_HOME_SESSIONS.find((s) => s.title === 'Add rate limiting to the API');
    const list = await listAgentSessions({ q: 'rate limiting' }, env);
    expect(list.items[0]?.firstPrompt).toBe('Add a token bucket limiter to /api/*');
    const detail = await agentSessionDetail(older?.key ?? '', undefined, env);
    expect(detail.prompts).toBe(2);
    expect(detail.markdown).toMatch(/\| Source \|[^\n]*\n\n- Command: `\/model`\n\n## Prompt 1 · /);
  });

  it('refuses bad keys and unknown sessions', async () => {
    expect((await failure(agentSessionDetail('nope', undefined, env))).code).toBe('bad-key');
    expect((await failure(agentSessionDetail('martian:abc', undefined, env))).code).toBe('bad-key');
    expect((await failure(agentSessionDetail('claude-code:missing', undefined, env))).code).toBe(
      'not-found',
    );
    // A key never names a path: a source's id is matched against what a listing finds.
    expect((await failure(agentSessionDetail('claude-code:a..b', undefined, env))).code).toBe(
      'not-found',
    );
    expect((await failure(agentSessionDetail('claude-code:..', undefined, env))).code).toBe(
      'bad-key',
    );
  });
});

describe('plans', () => {
  it('lists every plan source newest first, with thread and cwd where known', async () => {
    const list = await listAgentPlans({}, env);
    expect(list.items.map((p) => [p.key, p.title])).toEqual(
      AGENT_HOME_PLANS.map((p) => [p.key, p.title]),
    );
    expect(list.items[1]?.thread).toBe('Fix flaky payment webhook test');
    expect(list.items[2]).toMatchObject({
      thread: 'Tidy the README badges',
      cwd: '/Users/me/repos/docs',
    });
    expect(list.items[3]?.cwd).toBe('/Users/me/repos/web');
    expect(list.items[0]?.excerpt).toBe(
      `Turn the ${AGENT_HOME_PLAN_WORD} flag on for 5% of users, then everyone. Add the flag Watch the dashboard and alerts`,
    );
    expect(list.items[0]?.path).toBe('~/.claude/plans/zesty-rollout.md');
    expect(list.sources.map((s) => s.source)).toEqual([
      'claude-code',
      'codex',
      'copilot-cli',
      'vscode',
      'vscode-insiders',
    ]);
  });

  it('searches the whole text and filters by agent', async () => {
    expect(
      (await listAgentPlans({ q: AGENT_HOME_PLAN_WORD.toUpperCase() }, env)).items.map(
        (p) => p.key,
      ),
    ).toEqual([AGENT_HOME_PLANS[0]?.key]);
    expect((await listAgentPlans({ q: 'retry timer' }, env)).items.map((p) => p.source)).toEqual([
      'codex',
    ]);
    expect((await listAgentPlans({ q: 'payment webhook' }, env)).items).toHaveLength(1);
    expect((await listAgentPlans({ agent: 'copilot' }, env)).items.map((p) => p.source)).toEqual([
      'copilot-cli',
      'vscode',
    ]);
  });

  it('builds the import file; refuses bad, unknown and too large plans', async () => {
    const detail = await agentPlanDetail(
      AGENT_HOME_PLANS[0]?.key ?? '',
      env,
      new Date('2026-10-21T12:00:00Z'),
    );
    expect(detail.defaultPath).toBe('plans/rollout-plan-for-the-new-feature-flag.md');
    expect(detail.markdown).toContain('type: plan\n');
    expect(detail.markdown).toContain('dashboard (`./dash.md`) and &lt;b>alerts&lt;/b>');
    expect(detail.html).not.toContain('<b>');
    const otter = await agentPlanDetail('claude-code:quiet-otter', env);
    expect(otter.markdown).not.toContain('ignored frontmatter');
    expect(otter.markdown).toContain('\n# Migrate the settings page\n');
    expect((await failure(agentPlanDetail('bad', env))).code).toBe('bad-key');
    expect((await failure(agentPlanDetail('claude-code:missing', env))).code).toBe('not-found');
    writeFileSync(
      path.join(roots.claude, 'plans', 'huge.md'),
      `# Huge\n\n${'x'.repeat(PLAN_MAX_BYTES)}\n`,
    );
    expect((await failure(agentPlanDetail('claude-code:huge', env))).code).toBe('too-large');
  });
});

describe('bounded reads', () => {
  it('readHeadTail keeps complete lines of the head and the tail only', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-read-'));
    try {
      const file = path.join(dir, 'x.jsonl');
      const content =
        Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, '0')}`).join('\n') +
        '\n';
      writeFileSync(file, content);
      const text = await readHeadTail(file, content.length, 30, 30);
      expect(text.split('\n')).toEqual([
        'line-000',
        'line-001',
        'line-002',
        'line-097',
        'line-098',
        'line-099',
        '',
      ]);
      expect(await readHeadTail(file, content.length, 10_000, 10)).toBe(content);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('readZstdHeadTail keeps the decompressed head and tail, cut to complete lines', async () => {
    const zst = path.join(roots.codex, 'sessions', '2026', '10', '20');
    const name = (await import('node:fs')).readdirSync(zst).find((f) => f.endsWith('.zst')) ?? '';
    const whole = await readZstdHeadTail(path.join(zst, name), 1_000_000, 1_000_000);
    const lines = whole.trimEnd().split('\n');
    expect(lines.length).toBeGreaterThan(4);
    const cut = await readZstdHeadTail(path.join(zst, name), 900, 400);
    const [head, ...rest] = cut.split('\n');
    expect(head).toBe(lines[0]);
    expect(rest.filter((l) => l !== '').at(-1)).toBe(lines.at(-1));
    expect(cut.length).toBeLessThan(whole.length);
    for (const line of cut.split('\n').filter((l) => l !== '')) expect(lines).toContain(line);
  });
});

describe('streamed reads', () => {
  it('jsonLineStream yields the JSON lines (zstd too), lineStream stops at an offset, byteLineStream joins long lines', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-stream-'));
    try {
      const file = path.join(dir, 'x.jsonl');
      const long = 'y'.repeat(200_000);
      writeFileSync(file, `{"a":1}\n\nnot json\n{"b":"${long}"}\r\n{"c":3}`);
      const values: unknown[] = [];
      for await (const value of jsonLineStream(file, false)) values.push(value);
      expect(values).toEqual([{ a: 1 }, { b: long }, { c: 3 }]);
      const zst = path.join(dir, 'x.jsonl.zst');
      writeFileSync(zst, zstdCompressSync(Buffer.from('{"z":1}\n{"z":2}\n')));
      const zvalues: unknown[] = [];
      for await (const value of jsonLineStream(zst, true)) zvalues.push(value);
      expect(zvalues).toEqual([{ z: 1 }, { z: 2 }]);
      const head: string[] = [];
      for await (const line of lineStream(file, false, 12)) head.push(line);
      expect(head).toEqual(['{"a":1}', '', 'not']); // 12 bytes
      const bytes: number[] = [];
      for await (const line of byteLineStream(file)) bytes.push(line.length);
      expect(bytes).toEqual([7, 0, 8, long.length + 9, 7]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a Claude summary reads on past the head until the first prompt (commands and a huge first line before it)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-deep-'));
    try {
      const { roots: r } = buildAgentHome(dir, { now: new Date('2026-10-21T12:00:00Z') });
      const file = path.join(
        r.claude,
        'projects',
        '-deep',
        'c1a0de00-0000-4000-8000-0000000000bb.jsonl',
      );
      mkdirSync(path.dirname(file), { recursive: true });
      const line = (content: unknown, minute: number) =>
        JSON.stringify({
          type: 'user',
          timestamp: `2026-10-21T11:${String(minute).padStart(2, '0')}:00Z`,
          cwd: '/deep',
          message: { role: 'user', content },
        });
      const pasted = 'z'.repeat(300 * 1024);
      const lines = [
        line('/add-dir ~/x', 1),
        line(`Look at this log first:\n${pasted}`, 2),
        ...Array.from({ length: 60 }, (_, i) =>
          JSON.stringify({
            type: 'assistant',
            timestamp: '2026-10-21T11:03:00Z',
            message: { content: [{ type: 'text', text: `${i} ${'w'.repeat(4000)}` }] },
          }),
        ),
        line('Second ask', 4),
      ];
      writeFileSync(file, `${lines.join('\n')}\n`);
      const mtime = new Date('2026-10-21T11:50:00Z');
      utimesSync(file, mtime, mtime);
      const item = (await listAgentSessions({ q: 'deep' }, { CTXMAN_AGENT_HOME: dir })).items[0];
      expect(item?.firstPrompt?.startsWith('Look at this log first: zzz')).toBe(true);
      expect(item?.lastActivityAt).toBe('2026-10-21T11:04:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('route parameters', () => {
  it('session list params: agent, q, offset, limit (clamped)', () => {
    expect(sessionListParams(new URLSearchParams(''))).toEqual({
      ok: true,
      value: { offset: 0, limit: 50 },
    });
    expect(
      sessionListParams(new URLSearchParams('agent=codex&q=%20a%20b%20&offset=5&limit=999')),
    ).toEqual({
      ok: true,
      value: { agent: 'codex', q: 'a b', offset: 5, limit: 200 },
    });
    expect(sessionListParams(new URLSearchParams('limit=0&offset=-3'))).toEqual({
      ok: true,
      value: { offset: 0, limit: 1 },
    });
    expect(sessionListParams(new URLSearchParams('agent=nope'))).toMatchObject({
      ok: false,
      error: 'bad-agent',
    });
    expect(planListParams(new URLSearchParams('agent=claude-code&q='))).toEqual({
      ok: true,
      value: { agent: 'claude-code' },
    });
  });

  it('detail options default to tools on, thinking off', () => {
    expect(sessionOptionsParams(new URLSearchParams(''))).toEqual({ tools: true, thinking: false });
    expect(sessionOptionsParams(new URLSearchParams('tools=0&thinking=1'))).toEqual({
      tools: false,
      thinking: true,
    });
  });

  it('keyParam accepts the encoded and the decoded form', () => {
    expect(keyParam('claude-code%3Aabc')).toBe('claude-code:abc');
    expect(keyParam('claude-code:abc')).toBe('claude-code:abc');
    expect(keyParam('codex%3At.u')).toBe('codex:t.u');
    expect(keyParam('%E0%A4%A')).toBe('%E0%A4%A');
    expect(keyParam(undefined)).toBe('');
  });

  it('maps agent history errors to API answers', async () => {
    const status = async (error: unknown): Promise<[number, string]> => {
      const res = agentErrorResponse(error);
      return [res.status, ((await res.json()) as { error: string }).error];
    };
    expect(await status(new AgentHistoryError('bad-key', 'x'))).toEqual([400, 'bad-key']);
    expect(await status(new AgentHistoryError('bad-agent', 'x'))).toEqual([400, 'bad-agent']);
    expect(
      await status(new AgentHistoryError('invalid', 'x', [{ path: 'key', message: 'Required' }])),
    ).toEqual([400, 'invalid']);
    expect(await status(new AgentHistoryError('not-found', 'x'))).toEqual([404, 'not-found']);
    expect(await status(new AgentHistoryError('too-large', 'x'))).toEqual([413, 'too-large']);
    expect(await status(new DocIoError('exists', 'x'))).toEqual([409, 'exists']);
    expect(await status(new DocIoError('bad-path', 'x'))).toEqual([400, 'bad-path']);
    const spy = console.error;
    console.error = () => {};
    try {
      expect(await status(new Error('boom'))).toEqual([500, 'internal']);
    } finally {
      console.error = spy;
    }
  });
});
