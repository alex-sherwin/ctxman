// NODE (node:fs read-only; satteri through inert.ts and src/lib/markdown.ts): the agent session listing and detail
// (concepts/agent-history.md, plans/AGENT_HISTORY_SPEC.md §2). The listing stats every source (cheap), sorts by mtime
// and parses only what the requested page needs: a summary reads a bounded part of each file and is cached by
// (path, mtime, size). A detail resolves its key by listing that source again (a request never names a path) and
// parses the whole file.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown } from '../markdown.ts';
import { parseClaudeSession } from './claude.ts';
import { parseCodexSession, parseCodexSessionIndex } from './codex.ts';
import { parseCopilotSession, parseCopilotWorkspace } from './copilot-cli.ts';
import { AgentHistoryError } from './errors.ts';
import { readHead, readHeadTail, readSmallText, readWholeText, readZstdHead } from './files.ts';
import { INERT } from './inert.ts';
import { DEFAULT_SESSION_OPTIONS, sessionDefaultPath, sessionMarkdown } from './markdown.ts';
import type { GeneratedSession } from './markdown.ts';
import { assignDefined, clipLine, isRecord, jsonLines } from './parse-util.ts';
import type { ParsedSession } from './parse-util.ts';
import { agentRoots, displayPath } from './roots.ts';
import type { AgentRoots } from './roots.ts';
import {
  byMtimeDesc,
  SESSION_SOURCES,
  sessionCandidates,
  sessionDir,
  sourcesOf,
  sourceStatuses,
} from './sources.ts';
import type { SessionCandidate } from './sources.ts';
import { AGENT_SOURCE_AGENT, parseAgentKey } from './types.ts';
import type {
  AgentId,
  AgentSessionDetail,
  AgentSessionList,
  AgentSessionSummary,
  SessionMarkdownOptions,
} from './types.ts';
import {
  parseVscodeSession,
  replayVscodeLog,
  scanVscodeHead,
  vscodeWorkspaceFolder,
} from './vscode.ts';

const KB = 1024;
const MB = 1024 * KB;
/** Bounded reads of a summary (spec §2). */
const CLAUDE_HEAD = 128 * KB;
const CLAUDE_TAIL = 128 * KB;
const CODEX_HEAD = 256 * KB;
const COPILOT_HEAD = 128 * KB;
const VSCODE_WHOLE = 8 * MB;
const VSCODE_HEAD = 2 * MB;
/** A detail refuses bigger files (413 too-large). */
export const SESSION_MAX_BYTES = 256 * MB;

export const SESSION_LIMIT_DEFAULT = 50;
export const SESSION_LIMIT_MAX = 200;
export const FIRST_PROMPT_MAX = 300;
/** A title made from the first prompt; an agent's own title may be longer, up to TITLE_MAX. */
const PROMPT_TITLE_MAX = 120;
const TITLE_MAX = 200;

/** The parse of one file plus where it came from. */
interface Parsed {
  candidate: SessionCandidate;
  session: ParsedSession;
}

// ---------------------------------------------------------------- reading one file

/** Codex `session_index.jsonl` thread names, read once per (mtime, size). */
let codexIndex: { abs: string; mtimeMs: number; size: number; names: Map<string, string> } | null =
  null;

async function codexTitles(roots: AgentRoots): Promise<Map<string, string>> {
  const abs = path.join(roots.codex, 'session_index.jsonl');
  try {
    const st = await stat(abs);
    if (
      codexIndex !== null &&
      codexIndex.abs === abs &&
      codexIndex.mtimeMs === st.mtimeMs &&
      codexIndex.size === st.size
    ) {
      return codexIndex.names;
    }
    const text = await readHead(abs, st.size, 32 * MB);
    // Thread names changed: summaries that carry the old ones are recomputed.
    if (codexIndex !== null) forgetSummariesUnder(roots.codex);
    codexIndex = { abs, mtimeMs: st.mtimeMs, size: st.size, names: parseCodexSessionIndex(text) };
    return codexIndex.names;
  } catch {
    return new Map();
  }
}

/** Parses `candidate`: its bounded head (`whole: false`, a listing) or the whole file (a detail). */
async function parseCandidate(
  roots: AgentRoots,
  candidate: SessionCandidate,
  whole: boolean,
): Promise<ParsedSession> {
  const { abs, size } = candidate;
  switch (candidate.format) {
    case 'claude':
      return parseClaudeSession(
        whole
          ? await readWholeText(abs, false)
          : await readHeadTail(abs, size, CLAUDE_HEAD, CLAUDE_TAIL),
      );
    case 'codex':
    case 'codex-zst': {
      const zstd = candidate.format === 'codex-zst';
      const text = whole
        ? await readWholeText(abs, zstd)
        : zstd
          ? await readZstdHead(abs, CODEX_HEAD)
          : await readHead(abs, size, CODEX_HEAD);
      const titles = await codexTitles(roots);
      const parsed = parseCodexSession(text, titles);
      if (parsed.title === undefined) {
        const byFile = titles.get(candidate.id);
        if (byFile !== undefined) parsed.title = byFile;
      }
      return parsed;
    }
    case 'copilot': {
      const workspace = parseCopilotWorkspace(
        candidate.sidecar === undefined ? undefined : await readSmallText(candidate.sidecar),
      );
      const text = whole
        ? await readWholeText(abs, false)
        : await readHead(abs, size, COPILOT_HEAD);
      return parseCopilotSession(text, workspace);
    }
    case 'vscode-json':
    case 'vscode-jsonl': {
      const folder = vscodeWorkspaceFolder(
        candidate.sidecar === undefined ? undefined : await readSmallText(candidate.sidecar),
      );
      if (!whole && size > VSCODE_WHOLE) {
        const head = await readHead(abs, size, VSCODE_HEAD);
        if (candidate.format === 'vscode-jsonl') {
          const state = replayVscodeLog(head);
          if (state !== null) return parseVscodeSession(state, folder);
        }
        return scanVscodeHead(head, folder);
      }
      const text = await readWholeText(abs, false);
      let state: Record<string, unknown> | null = null;
      if (candidate.format === 'vscode-jsonl') state = replayVscodeLog(text);
      else {
        try {
          const data: unknown = JSON.parse(text);
          state = isRecord(data) ? data : null;
        } catch {
          // a torn write: the first (complete) line of a log-shaped file, or nothing
          state = jsonLines(text).find(isRecord) ?? null;
        }
      }
      return state === null ? { messages: [], prompts: 0 } : parseVscodeSession(state, folder);
    }
  }
}

function summaryOf(candidate: SessionCandidate, session: ParsedSession): AgentSessionSummary {
  const agentTitle = session.title === undefined ? undefined : clipLine(session.title, TITLE_MAX);
  const promptLine =
    session.firstPrompt === undefined ? undefined : clipLine(session.firstPrompt, FIRST_PROMPT_MAX);
  const title =
    agentTitle !== undefined && agentTitle !== ''
      ? agentTitle
      : promptLine === undefined || promptLine === ''
        ? `Session ${candidate.id}`
        : clipLine(promptLine, PROMPT_TITLE_MAX);
  return assignDefined<AgentSessionSummary>(
    {
      key: candidate.key,
      agent: AGENT_SOURCE_AGENT[candidate.source],
      source: candidate.source,
      id: candidate.id,
      title,
      modifiedAt: new Date(candidate.mtimeMs).toISOString(),
      bytes: candidate.size,
    },
    {
      firstPrompt: promptLine === '' ? undefined : promptLine,
      cwd: session.cwd,
      gitBranch: session.gitBranch,
      model: session.model,
      startedAt: session.startedAt,
    },
  );
}

// ---------------------------------------------------------------- listing

const CACHE_MAX = 4000;
/** abs -> the summary of that file version (null: no prompt, a subagent, or unreadable). */
const summaries = new Map<
  string,
  { mtimeMs: number; size: number; summary: AgentSessionSummary | null }
>();

function forgetSummariesUnder(dir: string): void {
  const prefix = dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`;
  for (const abs of summaries.keys()) if (abs.startsWith(prefix)) summaries.delete(abs);
}

/** Empties the summary cache (tests). */
export function clearSessionCache(): void {
  summaries.clear();
  codexIndex = null;
}

async function cachedSummary(
  roots: AgentRoots,
  candidate: SessionCandidate,
): Promise<AgentSessionSummary | null> {
  const hit = summaries.get(candidate.abs);
  if (hit !== undefined && hit.mtimeMs === candidate.mtimeMs && hit.size === candidate.size) {
    // The key can change for the same file only if its id did, which the path fixes; reuse as is.
    return hit.summary;
  }
  let summary: AgentSessionSummary | null = null;
  try {
    const session = await parseCandidate(roots, candidate, false);
    if (session.prompts > 0 && session.subagent !== true) {
      summary = summaryOf(candidate, session);
    }
  } catch {
    summary = null;
  }
  if (summaries.size >= CACHE_MAX) {
    const oldest = summaries.keys().next().value;
    if (oldest !== undefined) summaries.delete(oldest);
  }
  summaries.delete(candidate.abs);
  summaries.set(candidate.abs, { mtimeMs: candidate.mtimeMs, size: candidate.size, summary });
  return summary;
}

/** Every whitespace token of `q` occurs (case-insensitive) in `haystack`. */
export function matchesQuery(tokens: readonly string[], haystack: string): boolean {
  const hay = haystack.toLowerCase();
  return tokens.every((token) => hay.includes(token));
}

export const queryTokens = (q: string | undefined): string[] =>
  (q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '');

export interface SessionListQuery {
  agent?: AgentId;
  q?: string;
  offset?: number;
  limit?: number;
}

/** Summaries are computed this many at a time (in parallel) while a page fills. */
const BATCH = 16;

export async function listAgentSessions(
  query: SessionListQuery = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentSessionList> {
  const roots = agentRoots(env);
  const sources = sourcesOf(SESSION_SOURCES, query.agent);
  const limit = Math.min(
    SESSION_LIMIT_MAX,
    Math.max(1, Math.floor(query.limit ?? SESSION_LIMIT_DEFAULT)),
  );
  const offset = Math.max(0, Math.floor(query.offset ?? 0));
  const tokens = queryTokens(query.q);

  const [statuses, lists] = await Promise.all([
    sourceStatuses(roots, sources, sessionDir),
    Promise.all(sources.map((source) => sessionCandidates(roots, source))),
  ]);
  const candidates = lists.flat().sort(byMtimeDesc);

  const items: AgentSessionSummary[] = [];
  let index = offset;
  while (index < candidates.length && items.length < limit) {
    const batch = candidates.slice(
      index,
      index + Math.min(BATCH, Math.max(4, limit - items.length)),
    );
    const results = await Promise.all(batch.map((candidate) => cachedSummary(roots, candidate)));
    for (const summary of results) {
      index += 1;
      if (summary === null) continue;
      if (
        tokens.length > 0 &&
        !matchesQuery(
          tokens,
          [summary.title, summary.firstPrompt, summary.cwd, summary.gitBranch].join('\n'),
        )
      ) {
        continue;
      }
      items.push(summary);
      if (items.length >= limit) break;
    }
  }
  return { items, next: index < candidates.length ? index : null, sources: statuses };
}

// ---------------------------------------------------------------- detail

/** The candidate a key names, found by listing its source again (never a path from the request). */
async function resolveKey(roots: AgentRoots, key: string): Promise<SessionCandidate> {
  const parsed = parseAgentKey(key);
  if (parsed === null) {
    throw new AgentHistoryError('bad-key', `"${key}" is not a session key (<source>:<id>)`);
  }
  const found = (await sessionCandidates(roots, parsed.source)).find(
    (candidate) => candidate.id === parsed.id,
  );
  if (found === undefined) throw new AgentHistoryError('not-found', `session ${key} was not found`);
  if (found.size > SESSION_MAX_BYTES) {
    throw new AgentHistoryError(
      'too-large',
      `session ${key} is ${Math.round(found.size / MB)} MB; the limit is ${SESSION_MAX_BYTES / MB} MB`,
    );
  }
  return found;
}

export interface ReadSession extends Parsed {
  roots: AgentRoots;
  summary: AgentSessionSummary;
}

/** The whole session a key names. Throws AgentHistoryError bad-key / not-found / too-large. */
export async function readAgentSession(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadSession> {
  const roots = agentRoots(env);
  const candidate = await resolveKey(roots, key);
  const session = await parseCandidate(roots, candidate, true);
  return { roots, candidate, session, summary: summaryOf(candidate, session) };
}

/** The import file of a read session (the preview shows exactly this). */
export function sessionFile(
  read: ReadSession,
  options: SessionMarkdownOptions,
  title: string,
  now: Date,
): GeneratedSession {
  const input = {
    summary: read.summary,
    messages: read.session.messages,
    prompts: read.session.prompts,
    sourcePath: displayPath(read.candidate.abs, read.roots.home),
    home: read.roots.home,
    ...(read.session.endedAt === undefined ? {} : { endedAt: read.session.endedAt }),
  };
  return sessionMarkdown(input, options, { title, now, inert: INERT });
}

/** `GET /api/agent-sessions/<key>`: summary, the import file and its rendered body. */
export async function agentSessionDetail(
  key: string,
  options: SessionMarkdownOptions = DEFAULT_SESSION_OPTIONS,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<AgentSessionDetail> {
  const read = await readAgentSession(key, env);
  const file = sessionFile(read, options, read.summary.title, now);
  return {
    summary: read.summary,
    prompts: read.session.prompts,
    markdown: file.markdown,
    html: await renderMarkdown(file.body),
    truncated: file.truncated,
    defaultPath: sessionDefaultPath(read.summary),
  };
}
