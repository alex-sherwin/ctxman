// NODE (node:fs, read-only): the candidate files of every agent history source (concepts/agent-history.md): readdir
// + stat only, nothing is parsed. Symlinked dirs and files are never followed (Dirent types only), and every id must
// match AGENT_KEY_PATTERN, so a key always maps back to exactly the file a listing found. Per source and id the
// newest file wins.
import type { Dirent } from 'node:fs';
import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { codexIdFromFileName } from './codex.ts';
import { displayPath } from './roots.ts';
import type { AgentRoots } from './roots.ts';
import { AGENT_KEY_PATTERN, AGENT_SOURCE_AGENT, agentKey } from './types.ts';
import type { AgentId, AgentSource, AgentSourceStatus } from './types.ts';

export type SessionFormat =
  | 'claude'
  | 'codex'
  | 'codex-zst'
  | 'copilot'
  | 'vscode-json'
  | 'vscode-jsonl';

export interface Candidate {
  source: AgentSource;
  id: string;
  key: string;
  /** Absolute path of the file. */
  abs: string;
  mtimeMs: number;
  size: number;
}

export interface SessionCandidate extends Candidate {
  format: SessionFormat;
  /** Copilot CLI: the session's workspace.yaml; VS Code: the workspace storage's workspace.json. */
  sidecar?: string;
}

export interface PlanCandidate extends Candidate {
  /** Codex: the thread id (its name comes from the session index). */
  threadId?: string;
  /** Copilot CLI: the session's workspace.yaml; VS Code: the workspace storage's workspace.json. */
  sidecar?: string;
}

/** Sources in the order the API lists them. */
export const SESSION_SOURCES: readonly AgentSource[] = [
  'claude-code',
  'codex',
  'codex-archived',
  'copilot-cli',
  'vscode',
  'vscode-insiders',
];

export const PLAN_SOURCES: readonly AgentSource[] = [
  'claude-code',
  'codex',
  'copilot-cli',
  'vscode',
  'vscode-insiders',
];

/** The sources of `agent` (all of them when undefined), keeping the given order. */
export function sourcesOf(all: readonly AgentSource[], agent?: AgentId): AgentSource[] {
  return all.filter((source) => agent === undefined || AGENT_SOURCE_AGENT[source] === agent);
}

const validId = (id: string): boolean => AGENT_KEY_PATTERN.test(`x:${id}`);

async function entries(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** lstat of a regular file (a symlink is not one), or null. */
async function fileStat(abs: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const st = await lstat(abs);
    return st.isFile() ? { mtimeMs: st.mtimeMs, size: st.size } : null;
  } catch {
    return null;
  }
}

interface Found<T> {
  id: string;
  abs: string;
  extra: T;
}

async function withStats<T extends object>(
  source: AgentSource,
  found: readonly Found<T>[],
): Promise<(Candidate & T)[]> {
  const stats = await Promise.all(found.map((item) => fileStat(item.abs)));
  const newest = new Map<string, Candidate & T>();
  found.forEach((item, index) => {
    const st = stats[index];
    if (st === null || st === undefined || !validId(item.id)) return;
    const candidate = {
      ...item.extra,
      source,
      id: item.id,
      key: agentKey(source, item.id),
      abs: item.abs,
      mtimeMs: st.mtimeMs,
      size: st.size,
    };
    const seen = newest.get(item.id);
    if (seen === undefined || candidate.mtimeMs > seen.mtimeMs) newest.set(item.id, candidate);
  });
  return [...newest.values()];
}

// ---------------------------------------------------------------- session locations

/** The directory a source's sessions live in (what the empty state shows). */
export function sessionDir(roots: AgentRoots, source: AgentSource): string {
  switch (source) {
    case 'claude-code':
      return path.join(roots.claude, 'projects');
    case 'codex':
      return path.join(roots.codex, 'sessions');
    case 'codex-archived':
      return path.join(roots.codex, 'archived_sessions');
    case 'copilot-cli':
      return path.join(roots.copilot, 'session-state');
    case 'vscode':
    case 'vscode-insiders':
      return path.join(vscodeUser(roots, source), 'workspaceStorage');
  }
}

export function planDir(roots: AgentRoots, source: AgentSource): string {
  switch (source) {
    case 'claude-code':
      return path.join(roots.claude, 'plans');
    case 'codex':
    case 'codex-archived':
      return path.join(roots.codex, 'plans');
    case 'copilot-cli':
      return path.join(roots.copilot, 'session-state');
    case 'vscode':
    case 'vscode-insiders':
      return path.join(vscodeUser(roots, source), 'workspaceStorage');
  }
}

function vscodeUser(roots: AgentRoots, source: 'vscode' | 'vscode-insiders'): string {
  return roots.vscode.find((root) => root.source === source)?.user ?? roots.home;
}

/** Where each source was looked for, and whether it exists. */
export async function sourceStatuses(
  roots: AgentRoots,
  sources: readonly AgentSource[],
  dirOf: (roots: AgentRoots, source: AgentSource) => string,
): Promise<AgentSourceStatus[]> {
  return Promise.all(
    sources.map(async (source) => {
      const dir = dirOf(roots, source);
      return {
        source,
        agent: AGENT_SOURCE_AGENT[source],
        path: displayPath(dir, roots.home),
        exists: await exists(dir),
      };
    }),
  );
}

const stemOf = (name: string, ext: string): string => name.slice(0, -ext.length);

async function claudeSessions(roots: AgentRoots): Promise<SessionCandidate[]> {
  const projects = sessionDir(roots, 'claude-code');
  const found: Found<{ format: SessionFormat }>[] = [];
  for (const project of await entries(projects)) {
    if (!project.isDirectory()) continue;
    const dir = path.join(projects, project.name);
    for (const file of await entries(dir)) {
      // Top level only: `agent-*.jsonl` and sub-dirs are subagent transcripts.
      if (!file.isFile() || !file.name.endsWith('.jsonl') || file.name.startsWith('agent-')) {
        continue;
      }
      found.push({
        id: stemOf(file.name, '.jsonl'),
        abs: path.join(dir, file.name),
        extra: { format: 'claude' },
      });
    }
  }
  return withStats('claude-code', found);
}

const codexFound = (dir: string, file: Dirent): Found<{ format: SessionFormat }> | null => {
  if (!file.isFile()) return null;
  const id = codexIdFromFileName(file.name);
  if (id === null || !file.name.startsWith('rollout-')) return null;
  return {
    id,
    abs: path.join(dir, file.name),
    extra: { format: file.name.endsWith('.zst') ? 'codex-zst' : 'codex' },
  };
};

async function codexSessions(roots: AgentRoots): Promise<SessionCandidate[]> {
  const root = sessionDir(roots, 'codex');
  const found: Found<{ format: SessionFormat }>[] = [];
  const digits = (entry: Dirent): boolean => entry.isDirectory() && /^\d+$/.test(entry.name);
  for (const year of (await entries(root)).filter(digits)) {
    const yearDir = path.join(root, year.name);
    for (const month of (await entries(yearDir)).filter(digits)) {
      const monthDir = path.join(yearDir, month.name);
      for (const day of (await entries(monthDir)).filter(digits)) {
        const dayDir = path.join(monthDir, day.name);
        for (const file of await entries(dayDir)) {
          const item = codexFound(dayDir, file);
          if (item !== null) found.push(item);
        }
      }
    }
  }
  return withStats('codex', found);
}

async function codexArchived(roots: AgentRoots): Promise<SessionCandidate[]> {
  const dir = sessionDir(roots, 'codex-archived');
  const found = (await entries(dir))
    .map((file) => codexFound(dir, file))
    .filter((item) => item !== null);
  return withStats('codex-archived', found);
}

async function copilotSessions(roots: AgentRoots): Promise<SessionCandidate[]> {
  const root = sessionDir(roots, 'copilot-cli');
  const found: Found<{ format: SessionFormat; sidecar?: string }>[] = [];
  for (const entry of await entries(root)) {
    if (entry.isDirectory()) {
      const dir = path.join(root, entry.name);
      found.push({
        id: entry.name,
        abs: path.join(dir, 'events.jsonl'),
        extra: { format: 'copilot', sidecar: path.join(dir, 'workspace.yaml') },
      });
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      // Legacy layout: one `<uuid>.jsonl` per session, no workspace.yaml.
      found.push({
        id: stemOf(entry.name, '.jsonl'),
        abs: path.join(root, entry.name),
        extra: { format: 'copilot' },
      });
    }
  }
  return withStats('copilot-cli', found);
}

function vscodeFiles(
  dir: string,
  files: readonly Dirent[],
  sidecar: string | undefined,
): Found<{ format: SessionFormat; sidecar?: string }>[] {
  const out: Found<{ format: SessionFormat; sidecar?: string }>[] = [];
  for (const file of files) {
    if (!file.isFile()) continue;
    const ext = file.name.endsWith('.jsonl')
      ? '.jsonl'
      : file.name.endsWith('.json')
        ? '.json'
        : '';
    if (ext === '') continue;
    out.push({
      id: stemOf(file.name, ext),
      abs: path.join(dir, file.name),
      extra: {
        format: ext === '.jsonl' ? 'vscode-jsonl' : 'vscode-json',
        ...(sidecar === undefined ? {} : { sidecar }),
      },
    });
  }
  return out;
}

async function vscodeSessions(
  roots: AgentRoots,
  source: 'vscode' | 'vscode-insiders',
): Promise<SessionCandidate[]> {
  const user = vscodeUser(roots, source);
  const storage = path.join(user, 'workspaceStorage');
  const found: Found<{ format: SessionFormat; sidecar?: string }>[] = [];
  for (const hash of await entries(storage)) {
    if (!hash.isDirectory()) continue;
    const dir = path.join(storage, hash.name, 'chatSessions');
    found.push(
      ...vscodeFiles(dir, await entries(dir), path.join(storage, hash.name, 'workspace.json')),
    );
  }
  const empty = path.join(user, 'globalStorage', 'emptyWindowChatSessions');
  found.push(...vscodeFiles(empty, await entries(empty), undefined));
  return withStats(source, found);
}

/** Every session file of `source`, unsorted. */
export async function sessionCandidates(
  roots: AgentRoots,
  source: AgentSource,
): Promise<SessionCandidate[]> {
  switch (source) {
    case 'claude-code':
      return claudeSessions(roots);
    case 'codex':
      return codexSessions(roots);
    case 'codex-archived':
      return codexArchived(roots);
    case 'copilot-cli':
      return copilotSessions(roots);
    case 'vscode':
    case 'vscode-insiders':
      return vscodeSessions(roots, source);
  }
}

// ---------------------------------------------------------------- plan locations

/** A path segment as a key part: characters outside `[A-Za-z0-9_-]` become `-`. */
const keySegment = (segment: string): string => segment.replace(/[^A-Za-z0-9_-]/g, '-');

async function claudePlans(roots: AgentRoots): Promise<PlanCandidate[]> {
  const dir = planDir(roots, 'claude-code');
  const found: Found<object>[] = (await entries(dir))
    .filter((file) => file.isFile() && file.name.endsWith('.md'))
    .map((file) => ({
      id: keySegment(stemOf(file.name, '.md')),
      abs: path.join(dir, file.name),
      extra: {},
    }));
  return withStats('claude-code', found);
}

async function codexPlans(roots: AgentRoots): Promise<PlanCandidate[]> {
  const root = planDir(roots, 'codex');
  const found: Found<{ threadId: string }>[] = [];
  for (const thread of await entries(root)) {
    if (!thread.isDirectory()) continue;
    const threadDir = path.join(root, thread.name);
    for (const turn of await entries(threadDir)) {
      if (!turn.isDirectory()) continue;
      const turnDir = path.join(threadDir, turn.name);
      for (const file of await entries(turnDir)) {
        if (!file.isFile() || !file.name.endsWith('.md')) continue;
        const stem = stemOf(file.name, '.md');
        const id = [thread.name, turn.name, ...(file.name === 'PLAN.md' ? [] : [stem])]
          .map(keySegment)
          .join('.');
        found.push({ id, abs: path.join(turnDir, file.name), extra: { threadId: thread.name } });
      }
    }
  }
  return withStats('codex', found);
}

async function copilotPlans(roots: AgentRoots): Promise<PlanCandidate[]> {
  const root = planDir(roots, 'copilot-cli');
  const found: Found<{ sidecar: string }>[] = (await entries(root))
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      abs: path.join(root, entry.name, 'plan.md'),
      extra: { sidecar: path.join(root, entry.name, 'workspace.yaml') },
    }));
  return withStats('copilot-cli', found);
}

/** Markdown files named `*plan*` below `dir`, at most `depth` folders deep (Dirent types: no symlinks). */
async function planFilesBelow(dir: string, depth: number, prefix: string[]): Promise<string[][]> {
  const out: string[][] = [];
  for (const entry of await entries(dir)) {
    if (entry.isDirectory() && depth > 0) {
      out.push(
        ...(await planFilesBelow(path.join(dir, entry.name), depth - 1, [...prefix, entry.name])),
      );
    } else if (entry.isFile() && /plan/i.test(entry.name) && entry.name.endsWith('.md')) {
      out.push([...prefix, entry.name]);
    }
  }
  return out;
}

async function vscodePlans(
  roots: AgentRoots,
  source: 'vscode' | 'vscode-insiders',
): Promise<PlanCandidate[]> {
  const storage = path.join(vscodeUser(roots, source), 'workspaceStorage');
  const found: Found<{ sidecar: string }>[] = [];
  for (const hash of await entries(storage)) {
    if (!hash.isDirectory()) continue;
    const memories = path.join(
      storage,
      hash.name,
      'GitHub.copilot-chat',
      'memory-tool',
      'memories',
    );
    for (const segments of await planFilesBelow(memories, 4, [])) {
      const last = segments.length - 1;
      const parts = segments.map((segment, i) => (i === last ? stemOf(segment, '.md') : segment));
      found.push({
        id: [hash.name, ...parts].map(keySegment).join('.'),
        abs: path.join(memories, ...segments),
        extra: { sidecar: path.join(storage, hash.name, 'workspace.json') },
      });
    }
  }
  return withStats(source, found);
}

export async function planCandidates(
  roots: AgentRoots,
  source: AgentSource,
): Promise<PlanCandidate[]> {
  switch (source) {
    case 'claude-code':
      return claudePlans(roots);
    case 'codex':
      return codexPlans(roots);
    case 'copilot-cli':
      return copilotPlans(roots);
    case 'vscode':
    case 'vscode-insiders':
      return vscodePlans(roots, source);
    case 'codex-archived':
      return [];
  }
}

/** Newest first; equal mtimes by key, so every order is stable. */
export const byMtimeDesc = (a: Candidate, b: Candidate): number =>
  b.mtimeMs - a.mtimeMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
