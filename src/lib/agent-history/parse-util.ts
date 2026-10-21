// PURE (no fs; browser-safe): helpers every agent history parser shares (concepts/agent-history.md): JSON lines read
// defensively, one-line text, ISO times, the one-line tool call summaries and the transcript builder that merges the
// consecutive assistant lines of one turn. The per-agent parsers (claude.ts, codex.ts, copilot-cli.ts, vscode.ts) take
// text in and give a ParsedSession out; reading files is sessions.ts / sources.ts.
import type { TranscriptBlock, TranscriptMessage } from './types.ts';

/** What a parser found in one session file (or the bounded part of it a listing reads). */
export interface ParsedSession {
  /** The agent's own title (ai-title, thread name, custom title, summary), when the history has one. */
  title?: string;
  /** The first prompt, as typed (whitespace kept). */
  firstPrompt?: string;
  cwd?: string;
  gitBranch?: string;
  model?: string;
  /** ISO date-time of the first event. */
  startedAt?: string;
  /** ISO date-time of the last event. */
  endedAt?: string;
  /** User prompts and the assistant turns between them, in order. */
  messages: TranscriptMessage[];
  /** Number of user prompts in `messages`. */
  prompts: number;
  /** A subagent / sidechain thread (never listed). */
  subagent?: boolean;
}

export type JsonRecord = Record<string, unknown>;

export const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** A non-blank string, else undefined. */
export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

/** Every line of `source` that parses as JSON (blank and broken lines are skipped, never fatal). */
export function jsonLines(source: string): unknown[] {
  const out: unknown[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // a torn or foreign line: skipped
    }
  }
  return out;
}

/** Whitespace runs collapsed to one space, trimmed. */
export const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** `value` cut to `max` characters with an ellipsis (never splits a surrogate pair). */
export function clip(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max
    ? value
    : `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`;
}

/** One line of at most `max` characters. */
export const clipLine = (value: string, max: number): string => clip(oneLine(value), max);

/** ISO date-time of an ISO string or epoch milliseconds; undefined when it does not parse. */
export function isoTime(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? undefined : date.toISOString();
}

/** Length of a tool summary line. */
export const TOOL_SUMMARY_MAX = 160;

/** Tool names (any agent) whose input names a file, a search, a URL, a query or a task. */
const COMMAND_TOOLS = new Set(['bash', 'shell', 'exec_command', 'local_shell', 'run_in_terminal']);
const FILE_TOOLS = new Set([
  'read',
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'view',
  'create',
  'str_replace_editor',
]);
const SEARCH_TOOLS = new Set(['grep', 'glob']);
const URL_TOOLS = new Set(['webfetch', 'web_fetch']);
const QUERY_TOOLS = new Set(['websearch', 'web_search']);
const TASK_TOOLS = new Set(['task', 'agent']);

/** A command given as a string or an argv array. */
function commandOf(value: unknown): string | undefined {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value) && value.every((part) => typeof part === 'string')) {
    const joined = value.join(' ');
    return text(joined);
  }
  return undefined;
}

/** Compact JSON of a tool input ('' when it cannot be serialized). */
function compactJson(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * One line (whitespace collapsed, at most 160 characters) that says what a tool call did: the command of a shell
 * tool, the file of a read/edit/write tool, the pattern (+ ` in <path>`) of a search, the URL, the query or the
 * task description; any other input as compact JSON. A string input is used as it is.
 */
export function toolSummary(name: string, input: unknown): string {
  const key = name.toLowerCase();
  const record = isRecord(input) ? input : undefined;
  let summary: string | undefined;
  if (record !== undefined) {
    if (COMMAND_TOOLS.has(key)) summary = commandOf(record.command) ?? commandOf(record.cmd);
    else if (FILE_TOOLS.has(key))
      summary = text(record.file_path) ?? text(record.notebook_path) ?? text(record.path);
    else if (SEARCH_TOOLS.has(key)) {
      const pattern = text(record.pattern);
      const where = text(record.path);
      if (pattern !== undefined) summary = where === undefined ? pattern : `${pattern} in ${where}`;
    } else if (URL_TOOLS.has(key)) summary = text(record.url);
    else if (QUERY_TOOLS.has(key)) summary = text(record.query);
    else if (TASK_TOOLS.has(key)) summary = text(record.description);
  }
  return clipLine(summary ?? compactJson(input), TOOL_SUMMARY_MAX);
}

/** Parses a JSON string argument (Codex `function_call.arguments`); the string itself when it is not JSON. */
export function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}

/** Builds the normalized transcript: prompts open a new user message, assistant blocks join the open turn. */
export interface TranscriptBuilder {
  prompt(text: string, timestamp?: string): void;
  assistant(blocks: readonly TranscriptBlock[], timestamp?: string): void;
  readonly messages: TranscriptMessage[];
  readonly prompts: number;
  readonly firstPrompt: string | undefined;
}

export function transcriptBuilder(): TranscriptBuilder {
  const messages: TranscriptMessage[] = [];
  let prompts = 0;
  let firstPrompt: string | undefined;
  return {
    prompt(value, timestamp) {
      const message: TranscriptMessage = { role: 'user', blocks: [{ kind: 'text', text: value }] };
      if (timestamp !== undefined) message.timestamp = timestamp;
      messages.push(message);
      prompts += 1;
      firstPrompt ??= value;
    },
    assistant(blocks, timestamp) {
      if (blocks.length === 0) return;
      const last = messages.at(-1);
      if (last?.role === 'assistant') {
        last.blocks.push(...blocks);
        return;
      }
      const message: TranscriptMessage = { role: 'assistant', blocks: [...blocks] };
      if (timestamp !== undefined) message.timestamp = timestamp;
      messages.push(message);
    },
    get messages() {
      return messages;
    },
    get prompts() {
      return prompts;
    },
    get firstPrompt() {
      return firstPrompt;
    },
  };
}

/** Copies the defined values of `fields` onto `target` (optional keys stay absent instead of `undefined`). */
export function assignDefined<T extends object>(target: T, fields: Partial<T>): T {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  }
  return target;
}
