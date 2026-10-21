// NODE (node:fs read-only; satteri through inert.ts and src/lib/markdown.ts): the agent session listing and detail
// (concepts/agent-history.md, plans/AGENT_HISTORY_SPEC.md §2). The listing stats every source (cheap), then computes
// summaries in mtime order until the page is settled (a summary reads a bounded part of each file and is cached by
// (path, mtime, size)) and sorts by the last activity. A detail resolves its key by listing that source again (a
// request never names a path) and streams the whole file through the parser one line at a time, so the raw text,
// every parsed line and the transcript are never in memory together.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { renderMarkdown } from '../markdown.ts';
import { claudeSessionParser, parseClaudeSession } from './claude.ts';
import { codexSessionIndexParser, codexSessionParser, parseCodexSession } from './codex.ts';
import { copilotSessionParser, parseCopilotSession, parseCopilotWorkspace } from './copilot-cli.ts';
import { AgentHistoryError } from './errors.ts';
import {
  byteLineStream,
  jsonLineStream,
  lineStream,
  readHead,
  readHeadTail,
  readSmallText,
  readTail,
  readWholeBytes,
  readWholeText,
  readZstdHeadTail,
} from './files.ts';
import { INERT } from './inert.ts';
import { DEFAULT_SESSION_OPTIONS, sessionDefaultPath, sessionMarkdown } from './markdown.ts';
import type { GeneratedSession } from './markdown.ts';
import {
  assignDefined,
  clipLine,
  eachJsonLine,
  isListable,
  ownOptional,
  ownString,
  parseJsonLine,
} from './parse-util.ts';
import type { LineParser, ParsedSession } from './parse-util.ts';
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
  lastVscodeActivity,
  parseVscodeSession,
  replayVscodeLog,
  scanVscodeHead,
  vscodeJsonState,
  vscodeLogLine,
  vscodeLogReplayer,
  vscodeWorkspaceFolder,
} from './vscode.ts';

const KB = 1024;
const MB = 1024 * KB;
/** Bounded reads of a summary (spec §2): the head (first prompt, title, cwd) and the tail (the last activity). */
const CLAUDE_HEAD = 128 * KB;
const CLAUDE_TAIL = 128 * KB;
const CODEX_HEAD = 256 * KB;
const CODEX_TAIL = 64 * KB;
const COPILOT_HEAD = 128 * KB;
const COPILOT_TAIL = 64 * KB;
const VSCODE_WHOLE = 8 * MB;
const VSCODE_HEAD = 2 * MB;
const VSCODE_TAIL = 64 * KB;
/** A detail refuses bigger files (413 too-large). */
export const SESSION_MAX_BYTES = 256 * MB;
/** A VS Code `.json` session is one JSON document, parsed whole: its detail refuses bigger files (413 too-large). */
export const VSCODE_JSON_MAX_BYTES = 64 * MB;

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

/** The Codex thread names by session id (`<codex>/session_index.jsonl`, streamed; cached by mtime and size). */
export async function codexTitles(roots: AgentRoots): Promise<Map<string, string>> {
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
    const names = await streamLines(codexSessionIndexParser(), abs, false);
    // Thread names changed: summaries that carry the old ones are recomputed.
    if (codexIndex !== null) forgetSummariesUnder(roots.codex);
    codexIndex = { abs, mtimeMs: st.mtimeMs, size: st.size, names };
    return codexIndex.names;
  } catch {
    return new Map();
  }
}

/** Streams every JSON line of a file through `parser` (one line in memory at a time). */
async function streamLines<T>(parser: LineParser<T>, abs: string, zstd: boolean): Promise<T> {
  for await (const value of jsonLineStream(abs, zstd)) parser.line(value);
  return parser.finish();
}

/** A listing summary keeps no transcript. */
const SUMMARY = { transcript: false } as const;

/**
 * The summary parse of a Claude Code session: its first CLAUDE_HEAD bytes, then on until the first prompt (a pasted
 * image or log can make the first prompt one line of megabytes, and a session can open with commands), then its last
 * CLAUDE_TAIL bytes (the last activity, the latest title). Lines are streamed: nothing of the middle is kept.
 */
async function claudeSummaryParse(candidate: SessionCandidate): Promise<ParsedSession> {
  const { abs, size } = candidate;
  if (size <= CLAUDE_HEAD + CLAUDE_TAIL) {
    return parseClaudeSession(await readWholeText(abs), SUMMARY);
  }
  const parser = claudeSessionParser(SUMMARY);
  let read = 0;
  for await (const line of lineStream(abs, false, size - CLAUDE_TAIL)) {
    read += line.length + 1;
    const value = parseJsonLine(line);
    if (value !== undefined) parser.line(value);
    if (read >= CLAUDE_HEAD && parser.prompts > 0) break;
  }
  for (const value of eachJsonLine(await readTail(abs, size, CLAUDE_TAIL))) parser.line(value);
  return parser.finish();
}

/** The bounded parse of a listing: the head (and tail) of `candidate`, never the whole of a big file. */
async function parseSummary(
  roots: AgentRoots,
  candidate: SessionCandidate,
): Promise<ParsedSession> {
  const { abs, size } = candidate;
  switch (candidate.format) {
    case 'claude':
      return claudeSummaryParse(candidate);
    case 'codex':
    case 'codex-zst': {
      const text =
        candidate.format === 'codex-zst'
          ? await readZstdHeadTail(abs, CODEX_HEAD, CODEX_TAIL)
          : await readHeadTail(abs, size, CODEX_HEAD, CODEX_TAIL);
      const titles = await codexTitles(roots);
      return withCodexTitle(candidate, parseCodexSession(text, titles, SUMMARY), roots, titles);
    }
    case 'copilot':
      return parseCopilotSession(
        await readHeadTail(abs, size, COPILOT_HEAD, COPILOT_TAIL),
        parseCopilotWorkspace(await sidecarText(candidate)),
        SUMMARY,
      );
    case 'vscode-json':
    case 'vscode-jsonl': {
      const folder = vscodeWorkspaceFolder(await sidecarText(candidate));
      if (size <= VSCODE_WHOLE) {
        const bytes = await readWholeBytes(abs);
        const state =
          candidate.format === 'vscode-jsonl' ? replayVscodeLog(bytes) : vscodeJsonState(bytes);
        return state === null
          ? { messages: [], prompts: 0 }
          : parseVscodeSession(state, folder, SUMMARY);
      }
      // Too big to parse for a listing: the head for the title and first prompt, the tail for the last activity.
      const head = await readHead(abs, size, VSCODE_HEAD);
      const state = candidate.format === 'vscode-jsonl' ? replayVscodeLog(head) : null;
      const session =
        state === null ? scanVscodeHead(head, folder) : parseVscodeSession(state, folder, SUMMARY);
      const last = lastVscodeActivity(await readTail(abs, size, VSCODE_TAIL));
      if (last !== undefined && (session.endedAt === undefined || last > session.endedAt)) {
        session.endedAt = last;
      }
      return session;
    }
  }
}

/** The whole file of `candidate`, streamed line by line (a VS Code `.json` is one document, parsed whole). */
async function parseWhole(roots: AgentRoots, candidate: SessionCandidate): Promise<ParsedSession> {
  const { abs } = candidate;
  switch (candidate.format) {
    case 'claude':
      return streamLines(claudeSessionParser(), abs, false);
    case 'codex':
    case 'codex-zst': {
      const titles = await codexTitles(roots);
      const parsed = await streamLines(
        codexSessionParser(titles),
        abs,
        candidate.format === 'codex-zst',
      );
      return withCodexTitle(candidate, parsed, roots, titles);
    }
    case 'copilot':
      return streamLines(
        copilotSessionParser(parseCopilotWorkspace(await sidecarText(candidate))),
        abs,
        false,
      );
    case 'vscode-jsonl': {
      const folder = vscodeWorkspaceFolder(await sidecarText(candidate));
      const replayer = vscodeLogReplayer();
      for await (const raw of byteLineStream(abs)) {
        const line = vscodeLogLine(raw);
        const value = line === null ? undefined : parseJsonLine(line);
        if (value !== undefined) replayer.line(value);
      }
      const state = replayer.finish();
      return state === null ? { messages: [], prompts: 0 } : parseVscodeSession(state, folder);
    }
    case 'vscode-json': {
      const folder = vscodeWorkspaceFolder(await sidecarText(candidate));
      const state = vscodeJsonState(await readWholeBytes(abs));
      return state === null ? { messages: [], prompts: 0 } : parseVscodeSession(state, folder);
    }
  }
}

const sidecarText = async (candidate: SessionCandidate): Promise<string | undefined> =>
  candidate.sidecar === undefined ? undefined : readSmallText(candidate.sidecar);

/** A Codex parse without a thread name of its own takes the session index name of its file id. */
async function withCodexTitle(
  candidate: SessionCandidate,
  parsed: ParsedSession,
  roots: AgentRoots,
  known?: ReadonlyMap<string, string>,
): Promise<ParsedSession> {
  if (parsed.title === undefined) {
    const titles = known ?? (await codexTitles(roots));
    const byFile = titles.get(candidate.id);
    if (byFile !== undefined) parsed.title = byFile;
  }
  return parsed;
}

/** The last activity of a parse: its last event, never later than the file's mtime. */
function lastActivity(candidate: SessionCandidate, session: ParsedSession): string | undefined {
  if (session.endedAt === undefined) return undefined;
  const at = Date.parse(session.endedAt);
  if (Number.isNaN(at)) return undefined;
  return at >= candidate.mtimeMs ? new Date(candidate.mtimeMs).toISOString() : session.endedAt;
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
  // Summaries are cached: their strings must not be slices of the (possibly megabytes of) text they were parsed from.
  return assignDefined<AgentSessionSummary>(
    {
      key: candidate.key,
      agent: AGENT_SOURCE_AGENT[candidate.source],
      source: candidate.source,
      id: candidate.id,
      title: ownString(title),
      modifiedAt: new Date(candidate.mtimeMs).toISOString(),
      bytes: candidate.size,
    },
    {
      firstPrompt: promptLine === '' ? undefined : ownOptional(promptLine),
      cwd: ownOptional(session.cwd),
      gitBranch: ownOptional(session.gitBranch),
      model: ownOptional(session.model),
      startedAt: ownOptional(session.startedAt),
      lastActivityAt: ownOptional(lastActivity(candidate, session)),
    },
  );
}

// ---------------------------------------------------------------- listing

const CACHE_MAX = 4000;
/** abs -> the summary of that file version (null: no prompt, a subagent, or unreadable). Small: never a transcript. */
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

const cachedHit = (candidate: SessionCandidate) => {
  const hit = summaries.get(candidate.abs);
  return hit !== undefined && hit.mtimeMs === candidate.mtimeMs && hit.size === candidate.size
    ? hit
    : undefined;
};

/** The listing summary of `candidate` (cached by path, mtime and size); null when it is not listed (isListable). */
async function cachedSummary(
  roots: AgentRoots,
  candidate: SessionCandidate,
): Promise<AgentSessionSummary | null> {
  // The key can change for the same file only if its id did, which the path fixes; reuse as is.
  const hit = cachedHit(candidate);
  if (hit !== undefined) return hit.summary;
  let summary: AgentSessionSummary | null = null;
  try {
    const session = await parseSummary(roots, candidate);
    if (isListable(session)) summary = summaryOf(candidate, session);
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
  /** The number of items already returned (the `next` of the previous page). */
  offset?: number;
  limit?: number;
}

/** When a session last saw activity (ms): its last event, else its mtime. The list is sorted by it. */
export const activityMs = (summary: AgentSessionSummary): number =>
  Date.parse(summary.lastActivityAt ?? summary.modifiedAt);

/** Most recent activity first; equal times by key, so every order is stable. */
export const byActivityDesc = (a: AgentSessionSummary, b: AgentSessionSummary): number =>
  activityMs(b) - activityMs(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** At most this many summaries are computed in parallel... */
const BATCH = 4;
/** ...and, for files not in the cache, at most about this many bytes read at once (VS Code summaries read whole files). */
const BATCH_BYTES = 8 * MB;

/** What computing the summary of `candidate` reads at most (bytes): the bound of its format. */
function summaryCost(candidate: SessionCandidate): number {
  if (cachedHit(candidate) !== undefined) return 0;
  switch (candidate.format) {
    case 'claude':
      return Math.min(candidate.size, CLAUDE_HEAD + CLAUDE_TAIL);
    case 'codex':
    case 'codex-zst':
      return Math.min(candidate.size, CODEX_HEAD + CODEX_TAIL);
    case 'copilot':
      return Math.min(candidate.size, COPILOT_HEAD + COPILOT_TAIL);
    case 'vscode-json':
    case 'vscode-jsonl':
      return candidate.size <= VSCODE_WHOLE ? candidate.size : VSCODE_HEAD + VSCODE_TAIL;
  }
}

/** The candidates from `index` that are summarized together: at most BATCH, about BATCH_BYTES read (at least one). */
function nextBatch(candidates: readonly SessionCandidate[], index: number): SessionCandidate[] {
  const batch: SessionCandidate[] = [];
  let bytes = 0;
  for (let i = index; i < candidates.length && batch.length < BATCH; i++) {
    const candidate = candidates[i] as SessionCandidate;
    const cost = summaryCost(candidate);
    if (batch.length > 0 && bytes + cost > BATCH_BYTES) break;
    batch.push(candidate);
    bytes += cost;
  }
  return batch;
}

/**
 * One page of the sessions, most recent activity first. The candidates are stat-ed only, then summarized in mtime
 * order: a session's last activity is never later than its mtime, so once `offset + limit + 1` listed sessions are
 * known and the next candidate's mtime is older than the last of them, no unread session can move into the page.
 * `next` = `offset + limit` when another session follows (offset = the number of items already returned).
 */
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
  // one more than the page: whether another page follows
  const want = offset + limit + 1;

  const [statuses, lists] = await Promise.all([
    sourceStatuses(roots, sources, sessionDir),
    Promise.all(sources.map((source) => sessionCandidates(roots, source))),
  ]);
  const candidates = lists.flat().sort(byMtimeDesc);

  const found: AgentSessionSummary[] = [];
  let index = 0;
  while (index < candidates.length) {
    if (found.length >= want) {
      found.sort(byActivityDesc);
      const settled = found[want - 1] as AgentSessionSummary;
      if ((candidates[index] as SessionCandidate).mtimeMs < activityMs(settled)) break;
    }
    const batch = nextBatch(candidates, index);
    const results = await Promise.all(batch.map((candidate) => cachedSummary(roots, candidate)));
    index += batch.length;
    for (const summary of results) {
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
      found.push(summary);
    }
  }
  found.sort(byActivityDesc);
  return {
    items: found.slice(offset, offset + limit),
    next: found.length > offset + limit ? offset + limit : null,
    sources: statuses,
  };
}

// ---------------------------------------------------------------- detail

/**
 * The candidate a key names, found by listing its source again (never a path from the request). A session the list
 * leaves out (no prompt, a subagent thread) is not found either.
 */
async function resolveKey(roots: AgentRoots, key: string): Promise<SessionCandidate> {
  const parsed = parseAgentKey(key);
  if (parsed === null) {
    throw new AgentHistoryError('bad-key', `"${key}" is not a session key (<source>:<id>)`);
  }
  const found = (await sessionCandidates(roots, parsed.source)).find(
    (candidate) => candidate.id === parsed.id,
  );
  if (found === undefined) throw new AgentHistoryError('not-found', `session ${key} was not found`);
  const max = found.format === 'vscode-json' ? VSCODE_JSON_MAX_BYTES : SESSION_MAX_BYTES;
  if (found.size > max) {
    throw new AgentHistoryError(
      'too-large',
      `session ${key} is ${Math.round(found.size / MB)} MB; the limit is ${max / MB} MB`,
    );
  }
  if ((await cachedSummary(roots, found)) === null) throw notListed(key);
  return found;
}

const notListed = (key: string): AgentHistoryError =>
  new AgentHistoryError(
    'not-found',
    `session ${key} was not found (no prompt, or a subagent thread)`,
  );

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
  const session = await parseWhole(roots, candidate);
  if (!isListable(session)) throw notListed(key);
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
    // Not memoized (a preview can be megabytes of html; the memo is for doc pages) and not highlighted (Shiki keeps
    // the memory a big render grew it to): the imported file's doc page highlights it.
    html: await renderMarkdown(file.body, { memo: false, highlight: false }),
    truncated: file.truncated,
    defaultPath: sessionDefaultPath(read.summary),
  };
}
