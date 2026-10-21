// The PURE parts of the Import session / Import plan dialogs (src/ui/agent): URL builders, labels, short display,
// relative and labelled local times, selection moves, the Load more merge, the import form rules, the row times and
// the plan meta strip.
import { describe, expect, it } from 'vitest';
import type { AgentPlanSummary, AgentSessionSummary } from '../../src/lib/agent-history/types.ts';
import { planListUrl, planUrl, sessionListUrl, sessionUrl } from '../../src/ui/agent/agent-api.ts';
import {
  AGENT_FILTERS,
  agentFilterOptions,
  agentSourceText,
  countText,
  effectiveKey,
  formatBytes,
  importFailureText,
  importPathState,
  importTitleProblem,
  keyDelta,
  localTimeTitle,
  mergeByKey,
  moveSelection,
  planMeta,
  planThreadLine,
  relativeTime,
  sessionTimeIso,
  shortCwd,
  shortPath,
  shortStamp,
  titleOverride,
} from '../../src/ui/agent/agent-helpers.ts';

const session = (over: Partial<AgentSessionSummary> = {}): AgentSessionSummary => ({
  key: 'claude-code:6b97321c-1a00-4cee-bbd5-aa97ce018644',
  agent: 'claude-code',
  source: 'claude-code',
  id: '6b97321c-1a00-4cee-bbd5-aa97ce018644',
  title: 'Fix the login redirect',
  modifiedAt: '2026-10-21T18:02:11.000Z',
  bytes: 2048,
  ...over,
});

const plan = (over: Partial<AgentPlanSummary> = {}): AgentPlanSummary => ({
  key: 'codex:t1.turn2',
  agent: 'codex',
  source: 'codex',
  id: 't1.turn2',
  title: 'Login flow plan',
  excerpt: 'Steps to fix the login flow',
  path: '~/.codex/plans/t1/turn2/PLAN.md',
  modifiedAt: '2026-10-20T08:00:00.000Z',
  bytes: 512,
  ...over,
});

describe('agent-api URLs', () => {
  it('sessionListUrl leaves out all, a blank q and offset 0; keeps limit', () => {
    expect(sessionListUrl({ agent: 'all', q: '  ', offset: 0, limit: 50 })).toBe(
      '/api/agent-sessions?limit=50',
    );
    expect(sessionListUrl({ agent: 'codex', q: ' login  bug ', offset: 50, limit: 50 })).toBe(
      '/api/agent-sessions?agent=codex&q=login++bug&offset=50&limit=50',
    );
  });

  it('a key is ONE encoded path segment', () => {
    expect(sessionUrl('claude-code:abc.def', { tools: true, thinking: false })).toBe(
      '/api/agent-sessions/claude-code%3Aabc.def?tools=1&thinking=0',
    );
    expect(sessionUrl('vscode:x', { tools: false, thinking: true })).toBe(
      '/api/agent-sessions/vscode%3Ax?tools=0&thinking=1',
    );
    expect(planUrl('codex:t1.turn2')).toBe('/api/agent-plans/codex%3At1.turn2');
    expect(planUrl('a/b:c')).toBe('/api/agent-plans/a%2Fb%3Ac');
  });

  it('planListUrl takes agent and q only', () => {
    expect(planListUrl({ agent: 'all', q: '' })).toBe('/api/agent-plans');
    expect(planListUrl({ agent: 'copilot', q: 'refactor' })).toBe(
      '/api/agent-plans?agent=copilot&q=refactor',
    );
  });
});

describe('agents and labels', () => {
  it('the chips are All then every agent, with test ids', () => {
    expect(AGENT_FILTERS).toEqual(['all', 'claude-code', 'codex', 'copilot']);
    expect(agentFilterOptions('session')).toEqual([
      { id: 'all', label: 'All', testId: 'session-agent-all' },
      { id: 'claude-code', label: 'Claude Code', testId: 'session-agent-claude-code' },
      { id: 'codex', label: 'Codex', testId: 'session-agent-codex' },
      { id: 'copilot', label: 'GitHub Copilot', testId: 'session-agent-copilot' },
    ]);
    expect(agentFilterOptions('plan')[0]?.testId).toBe('plan-agent-all');
  });

  it('agentSourceText adds the source only where it says more', () => {
    expect(agentSourceText('claude-code', 'claude-code')).toBe('Claude Code');
    expect(agentSourceText('codex', 'codex-archived')).toBe('Codex · archived');
    expect(agentSourceText('copilot', 'vscode-insiders')).toBe('GitHub Copilot · VS Code Insiders');
  });
});

describe('display', () => {
  it('shortCwd keeps the last two segments', () => {
    expect(shortCwd('~/repos/x')).toBe('repos/x');
    expect(shortCwd('/Users/me/repos/app')).toBe('repos/app');
    expect(shortCwd('C:\\work\\app\\web')).toBe('app/web');
    expect(shortCwd('~/app')).toBe('~/app');
    expect(shortCwd('/srv')).toBe('/srv');
    expect(shortCwd('~')).toBe('~');
    expect(shortCwd(' ')).toBe('');
    expect(shortCwd(undefined)).toBe('');
    expect(shortCwd('vscode-remote://ssh-remote+box/home/me/app')).toBe('me/app');
  });

  it('shortPath elides the middle of a long path, keeping the folder of the file (cut to 9)', () => {
    expect(shortPath('~/.claude/plans/fix-login.md')).toBe('~/.claude/plans/fix-login.md');
    expect(shortPath('~/.codex/plans/t1/turn2/PLAN.md')).toBe('~/.codex/…/turn2/PLAN.md');
    expect(
      shortPath(
        '~/.codex/plans/01a002dc-c6b7-74f0-a499-0509fca66eca/01a00315-aaaa-7bbb-8ccc-000000000001/PLAN.md',
      ),
    ).toBe('~/.codex/…/01a00315…/PLAN.md');
    expect(shortPath('/home/me/.copilot/session-state/u1/plan.md')).toBe('/home/me/…/u1/plan.md');
  });

  it('relativeTime needs a ticking clock', () => {
    const now = Date.parse('2026-10-21T20:00:00Z');
    expect(relativeTime('2026-10-21T18:00:00Z', now)).toBe('2 hours ago');
    expect(relativeTime('2026-10-21T18:00:00Z', 0)).toBe('');
    expect(relativeTime(undefined, now)).toBe('');
  });

  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(12.5 * 1024)).toBe('12.5 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(4.1 * 1024 * 1024)).toBe('4.1 MB');
    expect(formatBytes(-1)).toBe('');
  });
});

describe('selection', () => {
  const keys = ['a', 'b', 'c'];

  it('effectiveKey keeps a listed pick, else the first row', () => {
    expect(effectiveKey(keys, 'b')).toBe('b');
    expect(effectiveKey(keys, 'gone')).toBe('a');
    expect(effectiveKey(keys, null)).toBe('a');
    expect(effectiveKey([], 'a')).toBeNull();
  });

  it('moveSelection clamps at both ends', () => {
    expect(moveSelection(keys, 'a', 1)).toBe('b');
    expect(moveSelection(keys, 'c', 1)).toBe('c');
    expect(moveSelection(keys, 'a', -1)).toBe('a');
    expect(moveSelection(keys, 'b', 10)).toBe('c');
    expect(moveSelection(keys, 'c', -10)).toBe('a');
    expect(moveSelection(keys, null, 1)).toBe('a');
    expect(moveSelection(keys, 'gone', -1)).toBe('a');
    expect(moveSelection([], 'a', 1)).toBeNull();
  });

  it('countText: loading, searching, failed, counts with + for another page', () => {
    const base = { initial: false, busy: false, failed: false, count: 50, more: true };
    expect(countText(base, 'session', 'sessions')).toBe('50+ sessions');
    expect(countText({ ...base, more: false, count: 1 }, 'plan', 'plans')).toBe('1 plan');
    expect(countText({ ...base, more: false, count: 0 }, 'plan', 'plans')).toBe('0 plans');
    expect(countText({ ...base, initial: true }, 'plan', 'plans')).toBe('Loading…');
    expect(countText({ ...base, busy: true }, 'plan', 'plans')).toBe('Searching…');
    expect(countText({ ...base, failed: true, initial: true }, 'plan', 'plans')).toBe('');
  });

  it('keyDelta maps the search-field keys', () => {
    expect(keyDelta('ArrowDown')).toBe(1);
    expect(keyDelta('ArrowUp')).toBe(-1);
    expect(keyDelta('PageDown')).toBe(10);
    expect(keyDelta('PageUp')).toBe(-10);
    expect(keyDelta('Enter')).toBe(0);
    expect(keyDelta('a')).toBe(0);
  });

  it('mergeByKey appends the next page without duplicate keys', () => {
    const page1 = [{ key: 'a' }, { key: 'b' }];
    const page2 = [{ key: 'b' }, { key: 'c' }, { key: 'c' }, { key: 'd' }];
    expect(mergeByKey(page1, page2).map((x) => x.key)).toEqual(['a', 'b', 'c', 'd']);
    expect(mergeByKey([], page1)).toEqual(page1);
    expect(page1).toHaveLength(2); // not mutated
  });
});

describe('import form', () => {
  it('importPathState uses the Add file rules', () => {
    expect(importPathState('sessions/2026-10-21-claude-code-fix.md')).toEqual({
      path: 'sessions/2026-10-21-claude-code-fix.md',
      problem: null,
      ok: true,
    });
    expect(importPathState(' /plans/x ')).toEqual({ path: 'plans/x.md', problem: null, ok: true });
    expect(importPathState('')).toEqual({ path: '', problem: null, ok: false });
    expect(importPathState('plans/')).toMatchObject({ ok: false, problem: /file name/ });
    expect(importPathState('../x.md')).toMatchObject({ ok: false });
    expect(importPathState('index.md')).toMatchObject({ ok: false, problem: /reserved/ });
  });

  it('importTitleProblem: required, at most 200', () => {
    expect(importTitleProblem('Fix it')).toBeNull();
    expect(importTitleProblem('  ')).toBe('Required');
    expect(importTitleProblem('x'.repeat(201))).toMatch(/200/);
  });

  it('titleOverride is sent only when changed', () => {
    expect(titleOverride(' Fix it ', 'Fix it')).toBeUndefined();
    expect(titleOverride('', 'Fix it')).toBeUndefined();
    expect(titleOverride(' Better ', 'Fix it')).toBe('Better');
  });

  it('importFailureText: 409 asks for another path; issues; network', () => {
    expect(
      importFailureText(
        { ok: false, status: 409, error: 'exists', message: 'exists' },
        'plans/x.md',
      ),
    ).toBe('plans/x.md already exists in this bundle. Pick another path.');
    expect(
      importFailureText(
        {
          ok: false,
          status: 400,
          error: 'invalid',
          message: 'invalid',
          issues: [
            { path: 'path', message: 'bad' },
            { path: '', message: 'other' },
          ],
        },
        'x.md',
      ),
    ).toBe('path: bad; other');
    expect(
      importFailureText({ ok: false, status: 404, error: 'not-found', message: 'Gone' }, 'x.md'),
    ).toBe('Gone');
    expect(
      importFailureText({ ok: false, status: 0, error: 'network', message: 'offline' }, 'x.md'),
    ).toMatch(/offline/);
  });
});

describe('times and the plan meta strip', () => {
  it('local times say what they are; a Codex row shows MM-DD HH:mm', () => {
    const iso = '2026-10-21T16:13:00.000Z';
    const local = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    const hm = `${pad(local.getHours())}:${pad(local.getMinutes())}`;
    const md = `${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
    expect(localTimeTitle('Last activity', iso)).toBe(
      `Last activity ${local.getFullYear()}-${md} ${hm} (local time)`,
    );
    expect(localTimeTitle('Modified', undefined)).toBe('Modified');
    expect(shortStamp(iso)).toBe(`${md} ${hm}`);
    expect(shortStamp(undefined)).toBe('');
  });

  it('a session row shows its last activity, else its mtime', () => {
    expect(sessionTimeIso(session())).toBe('2026-10-21T18:02:11.000Z');
    expect(sessionTimeIso(session({ lastActivityAt: '2026-10-19T08:00:00.000Z' }))).toBe(
      '2026-10-19T08:00:00.000Z',
    );
  });

  it('planThreadLine: the thread when it is not the title too', () => {
    expect(planThreadLine(plan())).toBeNull();
    expect(planThreadLine(plan({ thread: 'Plan the MCP server' }))).toBe('Plan the MCP server');
    expect(planThreadLine(plan({ title: 'Same', thread: ' Same ' }))).toBeNull();
  });

  it('planMeta: one line of agent, file (grows), dir, thread and the local modified time', () => {
    expect(planMeta(plan()).map((m) => m.id)).toEqual(['agent', 'path', 'modified']);
    const items = planMeta(plan({ cwd: '~/repos/app', thread: 'Login' }));
    expect(items.map((m) => m.id)).toEqual(['agent', 'path', 'cwd', 'thread', 'modified']);
    expect(items.find((m) => m.id === 'path')?.grow).toBe(true);
    const modified = items.find((m) => m.id === 'modified');
    expect(modified?.value).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} local$/);
    expect(modified?.title).toMatch(/\(UTC\)$/);
  });
});
