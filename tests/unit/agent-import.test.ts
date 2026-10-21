// Importing agent sessions and plans into a real bundle (a copy of the corpus): the file, the index.md / log.md
// bookkeeping, the errors, that `pnpm run check` stays clean, and that imported text never reaches search.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkCollections } from '../../src/lib/collections-check.ts';
import { AgentHistoryError } from '../../src/lib/agent-history/errors.ts';
import { importAgentPlan, importAgentSession } from '../../src/lib/agent-history/import.ts';
import { agentPlanDetail } from '../../src/lib/agent-history/plans.ts';
import { agentSessionDetail, clearSessionCache } from '../../src/lib/agent-history/sessions.ts';
import { DocIoError } from '../../src/lib/doc-io.ts';
import { buildSearchIndex } from '../../src/lib/entries.ts';
import { invalidateEntryIndex } from '../../src/lib/entry-index.ts';
import { checkLinks } from '../../src/lib/links.ts';
import { callTool } from '../../src/lib/mcp/tools.ts';
import { checkOkf } from '../../src/lib/okf.ts';
import {
  AGENT_HOME_NEWEST_SESSION,
  AGENT_HOME_PLAN_WORD,
  AGENT_HOME_PLANS,
  AGENT_HOME_SESSION_WORD,
  AGENT_HOME_SESSIONS,
  buildAgentHome,
} from '../fixtures/agent-home.ts';
import { cleanupCorpus, copyCorpus } from './fixtures/corpus.ts';

const NOW = new Date('2026-10-21T12:00:00Z');
let home: string;
let env: NodeJS.ProcessEnv;
let dataDir: string;
let savedDataDir: string | undefined;

beforeAll(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'ctxman-agent-import-'));
  buildAgentHome(home, { now: NOW });
  env = { CTXMAN_AGENT_HOME: home };
  clearSessionCache();
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

beforeEach(() => {
  savedDataDir = process.env.CTXMAN_DATA_DIR;
  dataDir = copyCorpus();
  process.env.CTXMAN_DATA_DIR = dataDir;
  invalidateEntryIndex();
});
afterEach(() => {
  if (savedDataDir === undefined) delete process.env.CTXMAN_DATA_DIR;
  else process.env.CTXMAN_DATA_DIR = savedDataDir;
  invalidateEntryIndex();
  cleanupCorpus();
});

const options = (): { dataDir: string; env: NodeJS.ProcessEnv; now: Date } => ({
  dataDir,
  env,
  now: NOW,
});
const read = (...rel: string[]): string => readFileSync(path.join(dataDir, ...rel), 'utf8');
const sessionBody = (extra: Record<string, unknown> = {}) => ({
  key: AGENT_HOME_NEWEST_SESSION.key,
  dataset: 'kb',
  slug: 'ctxman',
  path: 'sessions/login.md',
  tools: true,
  thinking: false,
  ...extra,
});

async function failure(promise: Promise<unknown>): Promise<AgentHistoryError | DocIoError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AgentHistoryError || error instanceof DocIoError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

describe('importAgentSession', () => {
  it('writes exactly the previewed file, lists it in index.md and log.md and adds no findings', async () => {
    const indexBefore = read('kb', 'ctxman', 'index.md');
    const imported = await importAgentSession(sessionBody(), options());
    expect(imported).toMatchObject({
      path: 'sessions/login.md',
      url: '/kb/ctxman/doc/sessions/login',
      warnings: [],
    });
    expect(Number.isNaN(Date.parse(imported.lastModified))).toBe(false);
    const detail = await agentSessionDetail(
      AGENT_HOME_NEWEST_SESSION.key,
      { tools: true, thinking: false },
      env,
      NOW,
    );
    expect(read('kb', 'ctxman', 'sessions', 'login.md')).toBe(detail.markdown);

    const index = read('kb', 'ctxman', 'index.md');
    expect(index).not.toBe(indexBefore);
    // the title only: the entry index.md is searchable, the session's cwd, dates and counts stay out of it
    expect(index).toContain(
      `* [${AGENT_HOME_NEWEST_SESSION.title}](/sessions/login.md) - ${AGENT_HOME_NEWEST_SESSION.title}`,
    );
    expect(index).not.toContain('Claude Code session in');
    expect(read('kb', 'ctxman', 'log.md')).toContain(
      `* **Create**: Created [${AGENT_HOME_NEWEST_SESSION.title}](/sessions/login.md).`,
    );

    const okf = await checkOkf(dataDir);
    const links = await checkLinks(dataDir);
    const collections = await checkCollections(dataDir);
    expect([...okf.findings, ...links.findings, ...collections.findings]).toEqual([]);
  });

  it('honours the title override and the options; never overwrites', async () => {
    await importAgentSession(
      sessionBody({ title: '  My   title ', tools: false, thinking: true }),
      options(),
    );
    const file = read('kb', 'ctxman', 'sessions', 'login.md');
    expect(file).toContain('title: My title\n');
    expect(file).toContain('\n# My title\n');
    expect(file).toContain('> **Thinking:**');
    expect(file).not.toContain('`Bash`');
    expect(read('kb', 'ctxman', 'index.md')).toContain('* [My title](/sessions/login.md)');
    const again = await failure(importAgentSession(sessionBody(), options()));
    expect(again).toBeInstanceOf(DocIoError);
    expect(again.code).toBe('exists');
  });

  it('derives a valid title from a long first prompt', async () => {
    const vscode = AGENT_HOME_SESSIONS.find(
      (s) => s.key.startsWith('vscode:') && s.title.endsWith('?'),
    );
    const imported = await importAgentSession(
      sessionBody({ key: vscode?.key, path: 'sessions/ci.md' }),
      options(),
    );
    expect(imported.warnings).toEqual([]);
    expect(read('kb', 'ctxman', 'sessions', 'ci.md')).toContain(`title: ${vscode?.title}\n`);
  });

  it('validates the body before anything else', async () => {
    const codes = async (body: unknown): Promise<string> =>
      (await failure(importAgentSession(body, options()))).code;
    expect(await codes('nope')).toBe('invalid');
    expect(await codes(sessionBody({ extra: 1 }))).toBe('invalid');
    expect(await codes(sessionBody({ tools: 'yes' }))).toBe('invalid');
    expect(await codes({ dataset: 'kb', slug: 'ctxman', path: 'a.md' })).toBe('invalid');
    expect(await codes(sessionBody({ title: '   ' }))).toBe('invalid');
    expect(await codes(sessionBody({ title: 'x'.repeat(201) }))).toBe('invalid');
    expect(await codes(sessionBody({ key: 'no-colon' }))).toBe('bad-key');
    // the target is checked before the session is read
    expect(await codes(sessionBody({ key: 'claude-code:missing', dataset: 'context' }))).toBe(
      'bad-dataset',
    );
    expect(await codes(sessionBody({ key: 'claude-code:missing', slug: 'Bad' }))).toBe('bad-slug');
    expect(await codes(sessionBody({ key: 'claude-code:missing', path: 'index.md' }))).toBe(
      'bad-path',
    );
    expect(await codes(sessionBody({ key: 'claude-code:missing', path: '../x.md' }))).toBe(
      'bad-path',
    );
    expect(await codes(sessionBody({ key: 'claude-code:missing', path: 'x.txt' }))).toBe(
      'bad-path',
    );
    expect(await codes(sessionBody({ key: 'claude-code:missing' }))).toBe('not-found');
    const entry = await failure(
      importAgentSession(sessionBody({ slug: 'no-such-entry' }), options()),
    );
    expect(entry).toBeInstanceOf(DocIoError);
    expect(entry.code).toBe('not-found');
    const invalid = await failure(importAgentSession(sessionBody({ extra: 1 }), options()));
    expect(invalid.issues).toEqual([{ path: 'extra', message: 'Unrecognized key "extra"' }]);
  });
});

describe('importAgentPlan', () => {
  it('writes the plan into a bundle without a log.md and adds no findings', async () => {
    const plan = AGENT_HOME_PLANS[0];
    const imported = await importAgentPlan(
      { key: plan?.key, dataset: 'project', slug: 'ctxman-v1', path: 'plans/rollout.md' },
      options(),
    );
    expect(imported).toMatchObject({
      path: 'plans/rollout.md',
      url: '/project/ctxman-v1/doc/plans/rollout',
      warnings: [],
    });
    const detail = await agentPlanDetail(plan?.key ?? '', env, NOW);
    expect(read('project', 'ctxman-v1', 'plans', 'rollout.md')).toBe(detail.markdown);
    expect(read('project', 'ctxman-v1', 'index.md')).toContain(
      `* [${plan?.title}](/plans/rollout.md) - ${plan?.title}`,
    );
    const links = await checkLinks(dataDir);
    const okf = await checkOkf(dataDir);
    expect([...okf.findings, ...links.findings]).toEqual([]);
    expect(
      (
        await failure(
          importAgentPlan(
            { key: plan?.key, dataset: 'kb', slug: 'ctxman', path: 'p.md', tools: true },
            options(),
          ),
        )
      ).code,
    ).toBe('invalid');
    expect(
      (
        await failure(
          importAgentPlan(
            { key: 'codex:nope', dataset: 'kb', slug: 'ctxman', path: 'p.md' },
            options(),
          ),
        )
      ).code,
    ).toBe('not-found');
  });
});

describe('imported files stay out of search (index: false)', () => {
  it('neither the search index nor the MCP search tool find imported text; the bundle entry still is found', async () => {
    await importAgentSession(sessionBody(), options());
    await importAgentPlan(
      { key: AGENT_HOME_PLANS[0]?.key, dataset: 'kb', slug: 'ctxman', path: 'plans/rollout.md' },
      options(),
    );
    invalidateEntryIndex();
    const { docs } = await buildSearchIndex(dataDir);
    const paths = docs.filter((d) => d.dataset === 'kb' && d.slug === 'ctxman').map((d) => d.path);
    expect(paths).toContain(null); // the entry itself
    expect(paths).not.toContain('sessions/login.md');
    expect(paths).not.toContain('plans/rollout.md');
    for (const word of [AGENT_HOME_SESSION_WORD, AGENT_HOME_PLAN_WORD]) {
      expect(
        docs.some((d) => JSON.stringify(d).toLowerCase().includes(word)),
        word,
      ).toBe(false);
    }
    const ctx = { dataDir, nowMs: NOW.getTime(), serverOrigin: 'http://127.0.0.1:4321' };
    const search = async (query: string): Promise<number> =>
      ((await callTool('search', { query }, ctx)).structuredContent as { count: number }).count;
    expect(await search(AGENT_HOME_SESSION_WORD)).toBe(0);
    expect(await search(AGENT_HOME_PLAN_WORD)).toBe(0);
    expect(await search('#agent-session')).toBe(0);
    expect(await search('ctxman')).toBeGreaterThan(0);
  });
});
