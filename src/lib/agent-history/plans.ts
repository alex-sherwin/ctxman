// NODE (node:fs read-only; satteri through inert.ts and src/lib/markdown.ts): the plan files coding agents write
// (concepts/agent-history.md, plans/AGENT_HISTORY_SPEC.md §4): Claude Code `<claude>/plans/*.md`, Codex
// `<codex>/plans/<thread>/<turn>/*.md`, Copilot CLI `<copilot>/session-state/<uuid>/plan.md` and, best effort, the
// VS Code Copilot memory files named `*plan*`. Listed newest first (at most 500); the text of each is read (at most
// 1 MB, cached by path, mtime and size) so a search matches the whole plan.
import path from 'node:path';
import { renderMarkdown } from '../markdown.ts';
import { parseCopilotWorkspace } from './copilot-cli.ts';
import { AgentHistoryError } from './errors.ts';
import { readHead, readSmallText } from './files.ts';
import { INERT } from './inert.ts';
import {
  firstHeading,
  planDefaultPath,
  planExcerpt,
  planMarkdown,
  stripFrontmatter,
} from './markdown.ts';
import type { GeneratedFile } from './markdown.ts';
import { assignDefined, clipLine } from './parse-util.ts';
import { agentRoots, displayPath } from './roots.ts';
import type { AgentRoots } from './roots.ts';
import { codexTitles, matchesQuery, queryTokens } from './sessions.ts';
import {
  byMtimeDesc,
  PLAN_SOURCES,
  planCandidates,
  planDir,
  sourcesOf,
  sourceStatuses,
} from './sources.ts';
import type { PlanCandidate } from './sources.ts';
import { AGENT_SOURCE_AGENT, parseAgentKey } from './types.ts';
import type { AgentId, AgentPlanDetail, AgentPlanList, AgentPlanSummary } from './types.ts';
import { vscodeWorkspaceFolder } from './vscode.ts';

const MB = 1024 * 1024;
export const PLAN_LIST_MAX = 500;
/** A plan's text is read up to this size (listing and search); a detail refuses bigger files. */
export const PLAN_MAX_BYTES = 1 * MB;
const TITLE_MAX = 200;

interface PlanText {
  mtimeMs: number;
  size: number;
  text: string;
}

const texts = new Map<string, PlanText>();
const TEXT_CACHE_MAX = 600;
/** The cached plan texts stay under about this many characters in all (the oldest are dropped first). */
const TEXT_CACHE_CHARS = 16 * MB;
let cachedChars = 0;

/** Empties the plan text cache (tests). */
export function clearPlanCache(): void {
  texts.clear();
  cachedChars = 0;
}

function forgetText(abs: string): void {
  const old = texts.get(abs);
  if (old === undefined) return;
  cachedChars -= old.text.length;
  texts.delete(abs);
}

async function planText(candidate: PlanCandidate): Promise<string> {
  const hit = texts.get(candidate.abs);
  if (hit !== undefined && hit.mtimeMs === candidate.mtimeMs && hit.size === candidate.size) {
    return hit.text;
  }
  let text = '';
  try {
    text = await readHead(candidate.abs, candidate.size, PLAN_MAX_BYTES);
  } catch {
    text = '';
  }
  forgetText(candidate.abs);
  while (
    texts.size > 0 &&
    (texts.size >= TEXT_CACHE_MAX || cachedChars + text.length > TEXT_CACHE_CHARS)
  ) {
    const oldest = texts.keys().next().value;
    if (oldest === undefined) break;
    forgetText(oldest);
  }
  texts.set(candidate.abs, { mtimeMs: candidate.mtimeMs, size: candidate.size, text });
  cachedChars += text.length;
  return text;
}

/** Where a plan was written: the Copilot workspace (cwd + summary) or the VS Code workspace folder. */
async function planContext(
  candidate: PlanCandidate,
  threads: ReadonlyMap<string, string>,
): Promise<{ cwd?: string; thread?: string }> {
  if (candidate.source === 'codex') {
    const thread = candidate.threadId === undefined ? undefined : threads.get(candidate.threadId);
    return thread === undefined ? {} : { thread };
  }
  if (candidate.sidecar === undefined) return {};
  const sidecar = await readSmallText(candidate.sidecar);
  if (candidate.source === 'copilot-cli') {
    const workspace = parseCopilotWorkspace(sidecar);
    return assignDefined<{ cwd?: string; thread?: string }>(
      {},
      { cwd: workspace.cwd, thread: workspace.summary },
    );
  }
  const folder = vscodeWorkspaceFolder(sidecar);
  return folder === undefined ? {} : { cwd: folder };
}

const fileTitle = (abs: string): string => path.basename(abs).replace(/\.md$/i, '');

function summaryOf(
  roots: AgentRoots,
  candidate: PlanCandidate,
  text: string,
  context: { cwd?: string; thread?: string },
): AgentPlanSummary {
  const heading = firstHeading(stripFrontmatter(text));
  const title = clipLine(heading?.text ?? context.thread ?? fileTitle(candidate.abs), TITLE_MAX);
  return assignDefined<AgentPlanSummary>(
    {
      key: candidate.key,
      agent: AGENT_SOURCE_AGENT[candidate.source],
      source: candidate.source,
      id: candidate.id,
      title: title === '' ? fileTitle(candidate.abs) : title,
      excerpt: planExcerpt(text),
      path: displayPath(candidate.abs, roots.home),
      modifiedAt: new Date(candidate.mtimeMs).toISOString(),
      bytes: candidate.size,
    },
    { cwd: context.cwd, thread: context.thread },
  );
}

export interface PlanListQuery {
  agent?: AgentId;
  q?: string;
}

async function allPlanCandidates(
  roots: AgentRoots,
  agent: AgentId | undefined,
): Promise<PlanCandidate[]> {
  const sources = sourcesOf(PLAN_SOURCES, agent);
  const lists = await Promise.all(sources.map((source) => planCandidates(roots, source)));
  return lists.flat().sort(byMtimeDesc).slice(0, PLAN_LIST_MAX);
}

export async function listAgentPlans(
  query: PlanListQuery = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentPlanList> {
  const roots = agentRoots(env);
  const sources = sourcesOf(PLAN_SOURCES, query.agent);
  const [statuses, candidates, threads] = await Promise.all([
    sourceStatuses(roots, sources, planDir),
    allPlanCandidates(roots, query.agent),
    codexTitles(roots),
  ]);
  const tokens = queryTokens(query.q);
  const items = await Promise.all(
    candidates.map(async (candidate) => {
      const [text, context] = await Promise.all([
        planText(candidate),
        planContext(candidate, threads),
      ]);
      const summary = summaryOf(roots, candidate, text, context);
      const haystack = [summary.title, summary.path, summary.thread, text].join('\n');
      return tokens.length === 0 || matchesQuery(tokens, haystack) ? summary : null;
    }),
  );
  return { items: items.filter((item) => item !== null), sources: statuses };
}

export interface ReadPlan {
  roots: AgentRoots;
  candidate: PlanCandidate;
  summary: AgentPlanSummary;
  text: string;
}

/** The plan a key names, found by listing its source again. Throws AgentHistoryError bad-key / not-found / too-large. */
export async function readAgentPlan(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ReadPlan> {
  const parsed = parseAgentKey(key);
  if (parsed === null) {
    throw new AgentHistoryError('bad-key', `"${key}" is not a plan key (<source>:<id>)`);
  }
  const roots = agentRoots(env);
  const candidate = (await planCandidates(roots, parsed.source)).find(
    (item) => item.id === parsed.id,
  );
  if (candidate === undefined)
    throw new AgentHistoryError('not-found', `plan ${key} was not found`);
  if (candidate.size > PLAN_MAX_BYTES) {
    throw new AgentHistoryError(
      'too-large',
      `plan ${key} is larger than ${PLAN_MAX_BYTES / MB} MB`,
    );
  }
  const [text, threads] = await Promise.all([planText(candidate), codexTitles(roots)]);
  const context = await planContext(candidate, threads);
  return { roots, candidate, summary: summaryOf(roots, candidate, text, context), text };
}

/** The import file of a read plan (the preview shows exactly this). */
export function planFile(read: ReadPlan, title: string, now: Date): GeneratedFile {
  return planMarkdown(
    { summary: read.summary, text: read.text, sourcePath: read.summary.path },
    { title, now, inert: INERT },
  );
}

/** `GET /api/agent-plans/<key>` */
export async function agentPlanDetail(
  key: string,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<AgentPlanDetail> {
  const read = await readAgentPlan(key, env);
  const file = planFile(read, read.summary.title, now);
  return {
    summary: read.summary,
    markdown: file.markdown,
    // Not memoized (a plan can be a megabyte; the memo is for doc pages) and not highlighted, like a session preview.
    html: await renderMarkdown(file.body, { memo: false, highlight: false }),
    defaultPath: planDefaultPath(read.summary.title),
  };
}
