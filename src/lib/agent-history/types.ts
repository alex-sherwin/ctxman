// PURE (no fs; browser-safe): the contract of the agent history import (concepts/agent-history.md). Agent session
// histories and plan files that Claude Code, Codex and GitHub Copilot (CLI and VS Code) keep in their well-known
// locations are listed, previewed and imported into an okf bundle as markdown concept files. These types cross the
// `/api/agent-sessions` and `/api/agent-plans` routes; the NODE readers live beside this file, the dialogs in the
// EntryTools island.

/** The agents ctxman reads history from, in the order the UI lists them. */
export const AGENT_IDS = ['claude-code', 'codex', 'copilot'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const AGENT_LABELS: Readonly<Record<AgentId, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
};

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

/**
 * Where one session or plan was found. One agent can have several: Codex keeps archived sessions apart, Copilot has
 * a CLI and the VS Code chat (stable and Insiders builds).
 */
export const AGENT_SOURCES = [
  'claude-code',
  'codex',
  'codex-archived',
  'copilot-cli',
  'vscode',
  'vscode-insiders',
] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const AGENT_SOURCE_AGENT: Readonly<Record<AgentSource, AgentId>> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  'codex-archived': 'codex',
  'copilot-cli': 'copilot',
  vscode: 'copilot',
  'vscode-insiders': 'copilot',
};

/** Short badge text of a source ("CLI", "VS Code"); '' when the agent label says it all. */
export const AGENT_SOURCE_LABELS: Readonly<Record<AgentSource, string>> = {
  'claude-code': '',
  codex: '',
  'codex-archived': 'archived',
  'copilot-cli': 'CLI',
  vscode: 'VS Code',
  'vscode-insiders': 'VS Code Insiders',
};

export function isAgentSource(value: unknown): value is AgentSource {
  return typeof value === 'string' && (AGENT_SOURCES as readonly string[]).includes(value);
}

/**
 * The id of one session or plan in the API: `<source>:<id>`. The `id` part is the agent's own id (a uuid, a file
 * stem; a Codex plan is `<thread>.<turn>`). A request only ever names a key, never a path: the server finds the file
 * by listing its source again.
 */
export const AGENT_KEY_PATTERN = /^([a-z][a-z-]*):([A-Za-z0-9][A-Za-z0-9._-]{0,159})$/;

export function agentKey(source: AgentSource, id: string): string {
  return `${source}:${id}`;
}

/** `{source, id}` of a well-formed key with a known source, else null. */
export function parseAgentKey(key: string): { source: AgentSource; id: string } | null {
  const match = AGENT_KEY_PATTERN.exec(key);
  if (match === null) return null;
  const [, source, id] = match;
  return isAgentSource(source) && id !== undefined ? { source, id } : null;
}

/** One searched location and whether it exists (the empty state says where ctxman looked). */
export interface AgentSourceStatus {
  source: AgentSource;
  agent: AgentId;
  /** Display path, the home directory shortened to `~`. */
  path: string;
  exists: boolean;
}

// ---------------------------------------------------------------- sessions

export interface AgentSessionSummary {
  key: string;
  agent: AgentId;
  source: AgentSource;
  /** The agent's session id. */
  id: string;
  /** The agent's own title (Claude `ai-title`, Codex thread name, VS Code custom title) else the first prompt, one line. */
  title: string;
  /** The first prompt the user typed, one line, at most 300 characters; absent when none was found. */
  firstPrompt?: string;
  /** Working directory / workspace folder of the session. */
  cwd?: string;
  gitBranch?: string;
  model?: string;
  /** ISO date-time of the first event, when known. */
  startedAt?: string;
  /**
   * ISO date-time of the last event found (Claude: the tail of the file; Codex, Copilot: the last line; VS Code: the
   * last message date), never later than `modifiedAt`. The list is sorted by `lastActivityAt ?? modifiedAt`, newest
   * first: an agent may touch a file long after its last event.
   */
  lastActivityAt?: string;
  /** ISO date-time: the file's mtime. */
  modifiedAt: string;
  /** File size in bytes. */
  bytes: number;
}

/** `GET /api/agent-sessions?agent=&q=&offset=&limit=` */
export interface AgentSessionList {
  /** Most recent activity first; sessions without any user prompt (a command is not one) are left out. */
  items: AgentSessionSummary[];
  /** The `offset` of the next page (the number of items returned so far), null when this was the last. */
  next: number | null;
  sources: AgentSourceStatus[];
}

/** One block of a message. Tool calls are one-line summaries (`Bash` + its command), tool output is never kept. */
export type TranscriptBlock =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; summary: string };

export interface TranscriptMessage {
  /**
   * `user` = a prompt; `assistant` = one turn of the agent; `command` = a slash command or shell escape the user ran
   * (`/model`, `! pwd`): shown in the flow, never a prompt (not counted, never the title or the first prompt).
   */
  role: 'user' | 'assistant' | 'command';
  /** ISO date-time, when known. */
  timestamp?: string;
  blocks: TranscriptBlock[];
}

/** A session normalized across agents: user prompts, commands and the assistant turns between them. */
export interface AgentTranscript {
  summary: AgentSessionSummary;
  messages: TranscriptMessage[];
}

/** Options of the generated session markdown (the preview and the import use the same). */
export interface SessionMarkdownOptions {
  /** One-line summaries of the tool calls (default true). */
  tools: boolean;
  /** The assistant's thinking / reasoning summaries, when the history has them in clear text (default false). */
  thinking: boolean;
}

/** `GET /api/agent-sessions/<key>?tools=1|0&thinking=1|0` */
export interface AgentSessionDetail {
  summary: AgentSessionSummary;
  /** Number of user prompts. */
  prompts: number;
  /** The file an import writes (frontmatter + body). */
  markdown: string;
  /** The body rendered like a doc page renders it (what the preview shows). */
  html: string;
  /** True when long messages or later prompts were cut to keep the file small. */
  truncated: boolean;
  /** Suggested bundle path, e.g. `sessions/2026-10-21-claude-code-fix-login.md`. */
  defaultPath: string;
}

/** `POST /api/agent-sessions/import` */
export interface AgentSessionImportBody {
  key: string;
  dataset: string;
  slug: string;
  /** Bundle-relative `.md` path (the Add file rules). */
  path: string;
  /** Overrides the session title (frontmatter `title` and the H1). */
  title?: string;
  tools?: boolean;
  thinking?: boolean;
}

// ---------------------------------------------------------------- plans

export interface AgentPlanSummary {
  key: string;
  agent: AgentId;
  source: AgentSource;
  id: string;
  /** The plan's first heading, else the thread / session title, else the file name. */
  title: string;
  /** The first lines of text after the title, one line, at most 200 characters. */
  excerpt: string;
  /** Display path of the plan file, `~`-shortened. */
  path: string;
  /** Working directory of the session that wrote the plan, when known. */
  cwd?: string;
  /** Codex: the thread name; Copilot CLI: the session summary. */
  thread?: string;
  /** ISO mtime (the list is sorted by it, newest first). */
  modifiedAt: string;
  bytes: number;
}

/** `GET /api/agent-plans?agent=&q=` (q matches title, path, thread and the whole text; every token must match). */
export interface AgentPlanList {
  items: AgentPlanSummary[];
  sources: AgentSourceStatus[];
}

/** `GET /api/agent-plans/<key>` */
export interface AgentPlanDetail {
  summary: AgentPlanSummary;
  /** The file an import writes (frontmatter + body). */
  markdown: string;
  html: string;
  /** Suggested bundle path, e.g. `plans/fix-login-flow.md`. */
  defaultPath: string;
}

/** `POST /api/agent-plans/import` */
export interface AgentPlanImportBody {
  key: string;
  dataset: string;
  slug: string;
  path: string;
  title?: string;
}

/** 201 of both imports (the shape `POST /api/doc/...` answers). */
export interface AgentImported {
  path: string;
  url: string;
  lastModified: string;
  warnings: unknown[];
}
