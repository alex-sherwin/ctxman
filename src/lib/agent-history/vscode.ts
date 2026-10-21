// PURE (no fs; browser-safe): VS Code chat sessions (GitHub Copilot chat, `<user>/workspaceStorage/<hash>/chatSessions/
// <uuid>.json[l]` and `<user>/globalStorage/emptyWindowChatSessions/`) to a ParsedSession (concepts/agent-history.md).
// A `.json` file is the session state `{sessionId, creationDate, lastMessageDate, customTitle?, requests: [{message:
// {text}, timestamp, modelId, response: [...]}]}`; a `.jsonl` file is a mutation log replayed into the same state.
// Response parts: markdown chunks (`{value}` without `kind`, concatenated), `thinking`, `toolInvocationSerialized`
// (one-line summary of its invocation message), `inlineReference` (shown as the referenced name in code); everything
// else is skipped. Title: `customTitle`, else the first prompt.
import {
  assignDefined,
  clipLine,
  isoTime,
  isRecord,
  jsonLines,
  str,
  text,
  TOOL_SUMMARY_MAX,
  transcriptBuilder,
} from './parse-util.ts';
import type { JsonRecord, ParsedSession } from './parse-util.ts';
import type { TranscriptBlock } from './types.ts';

type Key = string | number;

function container(root: JsonRecord, keys: readonly Key[]): unknown {
  let node: unknown = root;
  for (const key of keys) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<Key, unknown>)[key];
  }
  return node;
}

/** The parent object/array of the value at `keys`, created on the way (objects; arrays for numeric keys). */
function parentFor(root: JsonRecord, keys: readonly Key[]): Record<Key, unknown> | null {
  let node: Record<Key, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as Key;
    let next = node[key];
    if (next === null || typeof next !== 'object') {
      next = typeof keys[i + 1] === 'number' ? [] : {};
      node[key] = next;
    }
    node = next as Record<Key, unknown>;
  }
  return node;
}

const isPath = (value: unknown): value is Key[] =>
  Array.isArray(value) &&
  value.every((key) => typeof key === 'string' || (typeof key === 'number' && key >= 0));

/**
 * Replays a VS Code chat mutation log: `{kind: 0, v}` = the whole state; `{kind: 1, k, v}` = set at path `k`;
 * `{kind: 2, k, v, i?}` = at the array at `k`, truncate to `i` when given, then append the items of `v`;
 * `{kind: 3, k}` = delete at `k`. Unknown or malformed operations are skipped. null without a state.
 */
export function replayVscodeLog(source: string): JsonRecord | null {
  let state: JsonRecord | null = null;
  for (const op of jsonLines(source)) {
    if (!isRecord(op)) continue;
    if (op.kind === 0) {
      state = isRecord(op.v) ? op.v : null;
      continue;
    }
    if (state === null || !isPath(op.k) || op.k.length === 0) continue;
    const keys = op.k;
    const last = keys.at(-1) as Key;
    if (op.kind === 1) {
      const parent = parentFor(state, keys);
      if (parent !== null) parent[last] = op.v;
    } else if (op.kind === 2) {
      let target = container(state, keys);
      if (!Array.isArray(target)) {
        const parent = parentFor(state, keys);
        if (parent === null) continue;
        target = [];
        parent[last] = target;
      }
      const list = target as unknown[];
      if (typeof op.i === 'number' && op.i >= 0) list.length = Math.min(list.length, op.i);
      if (Array.isArray(op.v)) list.push(...(op.v as unknown[]));
    } else if (op.kind === 3) {
      const parent = container(state, keys.slice(0, -1));
      if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
      else if (isRecord(parent)) delete parent[last as string];
    }
  }
  return state;
}

/** `workspace.json` of a workspace storage dir: its folder as a path (`file://`) or the decoded URI (remote). */
export function vscodeWorkspaceFolder(source: string | undefined): string | undefined {
  if (source === undefined) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (!isRecord(data)) return undefined;
  const uri = text(data.folder) ?? text(data.workspace);
  return uri === undefined ? undefined : uriToDisplay(uri);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A `file://` URI as a local path (a Windows drive letter loses its leading slash); any other URI decoded. */
export function uriToDisplay(uri: string): string {
  if (!uri.toLowerCase().startsWith('file://')) return decode(uri);
  const rest = decode(uri.slice('file://'.length).replace(/^[^/]*(?=\/)/, ''));
  return /^\/[A-Za-z]:/.test(rest) ? rest.slice(1) : rest;
}

const basename = (value: string): string =>
  value
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() ?? value;

/** Markdown links of an invocation message as plain text: the label, else the target's file name. */
function plainMessage(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_, label: string, target: string) => {
    if (label.trim() !== '') return label;
    const withoutFragment = target.replace(/#.*$/, '');
    return basename(uriToDisplay(withoutFragment));
  });
}

function inlineReferenceName(part: JsonRecord): string | undefined {
  const ref = isRecord(part.inlineReference) ? part.inlineReference : {};
  const location = isRecord(ref.location) ? ref.location : {};
  const uri = isRecord(location.uri) ? location.uri : isRecord(ref.uri) ? ref.uri : {};
  const named = text(part.name) ?? text(ref.name);
  if (named !== undefined) return named;
  const file = text(ref.fsPath) ?? text(ref.path) ?? text(uri.fsPath) ?? text(uri.path);
  return file === undefined ? undefined : basename(file);
}

const codeSpan = (value: string): string => {
  const ticks = '`'.repeat(Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${value}${pad}${ticks}`;
};

function thinkingText(value: unknown): string | undefined {
  if (typeof value === 'string') return text(value);
  if (Array.isArray(value)) {
    return text(value.filter((part): part is string => typeof part === 'string').join(''));
  }
  return undefined;
}

/** The assistant blocks of one request's `response` parts. */
function responseBlocks(parts: unknown): TranscriptBlock[] {
  if (!Array.isArray(parts)) return [];
  const blocks: TranscriptBlock[] = [];
  let markdown = '';
  let thinking = '';
  let thinkingId: unknown;
  const flushMarkdown = (): void => {
    if (markdown.trim() !== '') blocks.push({ kind: 'text', text: markdown });
    markdown = '';
  };
  const flushThinking = (): void => {
    if (thinking.trim() !== '') blocks.push({ kind: 'thinking', text: thinking });
    thinking = '';
  };
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const kind = str(part.kind);
    if (kind === undefined && typeof part.value === 'string') {
      flushThinking();
      markdown += part.value;
    } else if (kind === 'inlineReference') {
      const name = inlineReferenceName(part);
      if (name !== undefined) {
        flushThinking();
        markdown += codeSpan(name);
      }
    } else if (kind === 'thinking') {
      const value = thinkingText(part.value);
      if (value !== undefined) {
        flushMarkdown();
        // Chunks of one thought share its id; a new id is a new thought.
        if (part.id !== thinkingId) flushThinking();
        thinkingId = part.id;
        thinking += value;
      }
    } else if (kind === 'toolInvocationSerialized') {
      if (part.fromSubAgent === true) continue;
      flushMarkdown();
      flushThinking();
      const message = isRecord(part.invocationMessage)
        ? str(part.invocationMessage.value)
        : str(part.invocationMessage);
      const name = str(part.toolId) ?? 'tool';
      blocks.push({
        kind: 'tool',
        name,
        summary: clipLine(plainMessage(message ?? ''), TOOL_SUMMARY_MAX),
      });
    }
  }
  flushMarkdown();
  flushThinking();
  return blocks;
}

/** The session id of a state (`sessionId`), when present. */
export const vscodeSessionId = (state: JsonRecord): string | undefined => text(state.sessionId);

/** A parsed (or replayed) chat session state; `folder` = the workspace folder from workspace.json. */
export function parseVscodeSession(state: JsonRecord, folder?: string): ParsedSession {
  const builder = transcriptBuilder();
  let model: string | undefined;
  let endedAt: string | undefined;
  const requests = Array.isArray(state.requests) ? state.requests : [];
  for (const request of requests) {
    if (!isRecord(request)) continue;
    const timestamp = isoTime(request.timestamp);
    if (timestamp !== undefined) endedAt = timestamp;
    model ??= text(request.modelId);
    const message = isRecord(request.message) ? request.message : {};
    const prompt = str(message.text);
    if (prompt !== undefined && prompt.trim() !== '') builder.prompt(prompt.trim(), timestamp);
    builder.assistant(responseBlocks(request.response), timestamp);
  }
  return assignDefined<ParsedSession>(
    { messages: builder.messages, prompts: builder.prompts },
    {
      title: text(state.customTitle),
      firstPrompt: builder.firstPrompt,
      cwd: folder,
      model,
      startedAt: isoTime(state.creationDate),
      endedAt: isoTime(state.lastMessageDate) ?? endedAt,
    },
  );
}

/** JSON string literal at the start of `source` (`"…"` with escapes), decoded; undefined when malformed. */
function jsonStringAt(source: string, start: number): string | undefined {
  const match = /^"(?:[^"\\]|\\.)*"/.exec(source.slice(start, start + 100_000));
  if (match === null) return undefined;
  try {
    return JSON.parse(match[0]) as string;
  } catch {
    return undefined;
  }
}

/**
 * Best-effort summary of a chat session too big to parse (its head only, which is not valid JSON): the custom
 * title, the creation date and the first request text found by pattern.
 */
export function scanVscodeHead(head: string, folder?: string): ParsedSession {
  const titles = [...head.matchAll(/"customTitle"\s*:\s*/g)];
  const lastTitle = titles.at(-1);
  const title =
    lastTitle === undefined
      ? undefined
      : jsonStringAt(head, (lastTitle.index ?? 0) + lastTitle[0].length);
  const created = /"creationDate"\s*:\s*(\d+)/.exec(head)?.[1];
  const messageAt = head.search(/"message"\s*:\s*\{/);
  const textMatch = messageAt === -1 ? null : /"text"\s*:\s*(?=")/.exec(head.slice(messageAt));
  const prompt =
    textMatch === null
      ? undefined
      : jsonStringAt(head, messageAt + textMatch.index + textMatch[0].length);
  const model = /"modelId"\s*:\s*"([^"\\]{1,200})"/.exec(head)?.[1];
  const builder = transcriptBuilder();
  if (prompt !== undefined && prompt.trim() !== '') builder.prompt(prompt.trim());
  return assignDefined<ParsedSession>(
    { messages: builder.messages, prompts: builder.prompts },
    {
      title: title === undefined ? undefined : text(title),
      firstPrompt: builder.firstPrompt,
      cwd: folder,
      model,
      startedAt: created === undefined ? undefined : isoTime(Number(created)),
    },
  );
}
