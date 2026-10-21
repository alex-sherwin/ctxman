// PURE (no fs; browser-safe): VS Code chat sessions (GitHub Copilot chat, `<user>/workspaceStorage/<hash>/chatSessions/
// <uuid>.json[l]` and `<user>/globalStorage/emptyWindowChatSessions/`) to a ParsedSession (concepts/agent-history.md).
// A `.json` file is the session state `{sessionId, creationDate, lastMessageDate, customTitle?, requests: [{message:
// {text}, timestamp, modelId, response: [...]}]}`; a `.jsonl` file is a mutation log replayed into the same state, one
// line at a time (LineParser), leaving out the request keys nothing here reads (attachments, result metadata: most of
// the bytes of a big log).
// Response parts: markdown chunks (`{value}` without `kind`, concatenated), `thinking`, `toolInvocationSerialized`
// (one-line summary of its invocation message), `inlineReference` (shown as the referenced name in code); everything
// else is skipped. Title: `customTitle`, else the first prompt.
import {
  assignDefined,
  clipLine,
  isoTime,
  isRecord,
  parseJsonLine,
  str,
  text,
  TOOL_SUMMARY_MAX,
  transcriptBuilder,
} from './parse-util.ts';
import type { JsonRecord, LineParser, ParsedSession, SessionParseOptions } from './parse-util.ts';
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
 * Request keys a replay leaves out: what parseVscodeSession never reads, and most of the bytes of a big log (the
 * attached files of `variableData`, the `result` metadata).
 */
const PRUNED_REQUEST_KEYS = new Set([
  'variableData',
  'result',
  'editedFileEvents',
  'contentReferences',
  'codeCitations',
  'followups',
]);

function pruneRequest(request: unknown): unknown {
  if (!isRecord(request)) return request;
  for (const key of PRUNED_REQUEST_KEYS) delete request[key];
  return request;
}

function pruneRequests(requests: unknown): unknown {
  if (Array.isArray(requests)) requests.forEach(pruneRequest);
  return requests;
}

/** A value about to be stored at `keys`, with the pruned request keys left out (it is a fresh parse: mutated). */
function pruneAt(keys: readonly Key[], value: unknown): unknown {
  if (keys.length === 0) {
    if (isRecord(value)) pruneRequests(value.requests);
    return value;
  }
  if (keys[0] !== 'requests') return value;
  if (keys.length === 1) return pruneRequests(value);
  if (keys.length === 2) return pruneRequest(value);
  return value;
}

/** Keys of a session file nothing here reads, at any depth: the pruned request keys and the chat input box. */
const STRIPPED_KEYS = new Set([...PRUNED_REQUEST_KEYS, 'inputState']);

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COLON = 0x3a;
const COMMA = 0x2c;
const NEWLINE = 0x0a;

const isSpace = (byte: number | undefined): boolean =>
  byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;

/** The index just past the JSON string whose `"` is at `start`, or -1 when it is not closed. */
function stringEnd(bytes: Uint8Array, start: number): number {
  let at = start + 1;
  for (;;) {
    const quote = bytes.indexOf(QUOTE, at);
    if (quote === -1) return -1;
    let slashes = 0;
    while (quote - 1 - slashes > start && bytes[quote - 1 - slashes] === BACKSLASH) slashes += 1;
    if (slashes % 2 === 0) return quote + 1;
    at = quote + 1;
  }
}

/** The index just past the JSON value that starts at `start` (whitespace skipped), or -1 when it is torn. */
function valueEnd(bytes: Uint8Array, start: number): number {
  let at = start;
  while (isSpace(bytes[at])) at += 1;
  const first = bytes[at];
  if (first === QUOTE) return stringEnd(bytes, at);
  if (first !== 0x7b && first !== 0x5b) {
    // a number, true, false or null: up to the next delimiter
    while (at < bytes.length && bytes[at] !== COMMA && bytes[at] !== 0x7d && bytes[at] !== 0x5d)
      at += 1;
    return at;
  }
  let depth = 0;
  for (let i = at; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === QUOTE) {
      const end = stringEnd(bytes, i);
      if (end === -1) return -1;
      i = end - 1;
    } else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
    } else if (byte === 0x7d || byte === 0x5d) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/** Whether `bytes[from, to)` spells one of `keys` (ASCII names). */
function isKey(bytes: Uint8Array, from: number, to: number, keys: readonly Uint8Array[]): boolean {
  return keys.some(
    (key) => key.length === to - from && key.every((byte, i) => bytes[from + i] === byte),
  );
}

/**
 * The UTF-8 JSON text with the members named in `keys` left out, at any depth, without parsing (or even decoding) it:
 * a VS Code session keeps the files attached to every request (`variableData`, megabytes per line) beside the prompt,
 * and turning them into strings and objects only to drop them would grow the heap by many times their size. Strings
 * are skipped whole, so a key name inside a string never matches; a torn text is returned as it is.
 */
export function stripJsonKeys(bytes: Uint8Array, keys: ReadonlySet<string>): Uint8Array {
  const names = [...keys].map((key) => ENCODER.encode(key));
  const pieces: Uint8Array[] = [];
  let copied = 0;
  let at = 0;
  for (;;) {
    const quote = bytes.indexOf(QUOTE, at);
    if (quote === -1) break;
    const end = stringEnd(bytes, quote);
    if (end === -1) return bytes;
    at = end;
    let colon = end;
    while (isSpace(bytes[colon])) colon += 1;
    if (bytes[colon] !== COLON || !isKey(bytes, quote + 1, end - 1, names)) continue;
    const valueStop = valueEnd(bytes, colon + 1);
    if (valueStop === -1) return bytes;
    // drop `"key": value` and one comma next to it: the preceding one (not yet copied), else the following one
    let from = quote;
    let to = valueStop;
    let before = from - 1;
    while (before >= copied && isSpace(bytes[before])) before -= 1;
    if (before >= copied && bytes[before] === COMMA) {
      from = before;
    } else {
      let after = to;
      while (isSpace(bytes[after])) after += 1;
      if (bytes[after] === COMMA) to = after + 1;
    }
    pieces.push(bytes.subarray(copied, from));
    copied = to;
    at = to;
  }
  if (copied === 0) return bytes;
  pieces.push(bytes.subarray(copied));
  const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    out.set(piece, offset);
    offset += piece.length;
  }
  return out;
}

/** Lines shorter than this are parsed as they are (stripping costs a scan; small lines hold nothing big). */
const STRIP_MIN = 64 * 1024;

/** A path at the start of an operation line: `{"kind":1,"k":["requests",0,"result"],…`. */
const OP_PATH = /^\s*\{\s*"kind"\s*:\s*[0-3]\s*,\s*"k"\s*:\s*(\[[^\]]{0,400}\])/;

/**
 * One mutation log line (UTF-8) as the text to parse, or null to skip it unparsed: an operation on a pruned request
 * key or on the chat input box (its path is read from the line's start), else the line with the stripped keys left
 * out (lines of STRIP_MIN bytes and more; smaller ones as they are).
 */
export function vscodeLogLine(line: Uint8Array): string | null {
  if (line.length < STRIP_MIN) return DECODER.decode(line);
  const path = OP_PATH.exec(DECODER.decode(line.subarray(0, 512)))?.[1];
  if (path !== undefined) {
    try {
      const keys: unknown = JSON.parse(path);
      if (isPath(keys) && (prunedPath(keys) || keys[0] === 'inputState')) return null;
    } catch {
      // not a plain path: parse the line
    }
  }
  return DECODER.decode(stripJsonKeys(line, STRIPPED_KEYS));
}

/** A whole `.json` session (UTF-8) as its state: the stripped keys left out (see stripJsonKeys); null when torn. */
export function vscodeJsonState(bytes: Uint8Array): JsonRecord | null {
  const text = DECODER.decode(
    bytes.length < STRIP_MIN ? bytes : stripJsonKeys(bytes, STRIPPED_KEYS),
  );
  try {
    const data: unknown = JSON.parse(text);
    return isRecord(data) ? data : null;
  } catch {
    // a torn write: the first (complete) line of a log-shaped file, or nothing
    const newline = text.indexOf('\n');
    const first = parseJsonLine(newline === -1 ? '' : text.slice(0, newline));
    return isRecord(first) ? first : null;
  }
}

/** An operation under a pruned request key (`['requests', n, 'variableData', …]`): skipped. */
const prunedPath = (keys: readonly Key[]): boolean =>
  keys.length >= 3 &&
  keys[0] === 'requests' &&
  typeof keys[2] === 'string' &&
  PRUNED_REQUEST_KEYS.has(keys[2]);

/**
 * The VS Code chat mutation log line parser: `{kind: 0, v}` = the whole state; `{kind: 1, k, v}` = set at path `k`;
 * `{kind: 2, k, v, i?}` = at the array at `k`, truncate to `i` when given, then append the items of `v`;
 * `{kind: 3, k}` = delete at `k`. Unknown or malformed operations are skipped; so are the pruned request keys. The
 * result is null without a state.
 */
export function vscodeLogReplayer(): LineParser<JsonRecord | null> {
  let state: JsonRecord | null = null;
  return {
    line(op) {
      if (!isRecord(op)) return;
      if (op.kind === 0) {
        state = isRecord(op.v) ? (pruneAt([], op.v) as JsonRecord) : null;
        return;
      }
      if (state === null || !isPath(op.k) || op.k.length === 0 || prunedPath(op.k)) return;
      const keys = op.k;
      const last = keys.at(-1) as Key;
      if (op.kind === 1) {
        const parent = parentFor(state, keys);
        if (parent !== null) parent[last] = pruneAt(keys, op.v);
      } else if (op.kind === 2) {
        let target = container(state, keys);
        if (!Array.isArray(target)) {
          const parent = parentFor(state, keys);
          if (parent === null) return;
          target = [];
          parent[last] = target;
        }
        const list = target as unknown[];
        if (typeof op.i === 'number' && op.i >= 0) list.length = Math.min(list.length, op.i);
        if (Array.isArray(op.v)) {
          const items = keys.length === 1 && keys[0] === 'requests' ? pruneRequests(op.v) : op.v;
          list.push(...(items as unknown[]));
        }
      } else if (op.kind === 3) {
        const parent = container(state, keys.slice(0, -1));
        if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1);
        else if (isRecord(parent)) delete parent[last as string];
      }
    },
    finish() {
      return state;
    },
  };
}

/**
 * Replays a whole (or bounded) VS Code chat mutation log (see vscodeLogReplayer), text or UTF-8 bytes; big lines go
 * through vscodeLogLine.
 */
export function replayVscodeLog(source: string | Uint8Array): JsonRecord | null {
  const bytes = typeof source === 'string' ? ENCODER.encode(source) : source;
  const replayer = vscodeLogReplayer();
  let start = 0;
  while (start <= bytes.length) {
    const end = bytes.indexOf(NEWLINE, start);
    const line = vscodeLogLine(bytes.subarray(start, end === -1 ? bytes.length : end));
    const value = line === null ? undefined : parseJsonLine(line);
    if (value !== undefined) replayer.line(value);
    if (end === -1) break;
    start = end + 1;
  }
  return replayer.finish();
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
export function parseVscodeSession(
  state: JsonRecord,
  folder?: string,
  options: SessionParseOptions = {},
): ParsedSession {
  const keep = options.transcript !== false;
  const builder = transcriptBuilder(keep);
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
    if (keep) builder.assistant(responseBlocks(request.response), timestamp);
  }
  return assignDefined<ParsedSession>(
    { messages: builder.messages, prompts: builder.prompts },
    {
      title: text(state.customTitle),
      firstPrompt: builder.firstPrompt,
      cwd: folder,
      model,
      startedAt: isoTime(state.creationDate),
      endedAt: latestIso(isoTime(state.lastMessageDate), endedAt),
    },
  );
}

/** The later of two ISO date-times (either may be missing). */
function latestIso(a: string | undefined, b: string | undefined): string | undefined {
  if (a === undefined || b === undefined) return a ?? b;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * The latest epoch-millisecond `lastMessageDate` / `timestamp` value in a piece of a chat session file (the tail of a
 * session too big to parse; a log sets `lastMessageDate` with `"k":["lastMessageDate"],"v":…`), as an ISO
 * date-time; undefined when there is none.
 */
export function lastVscodeActivity(source: string): string | undefined {
  let latest = -Infinity;
  const pattern =
    /"(?:lastMessageDate|timestamp)"\s*:\s*(\d{10,16})\b|"k"\s*:\s*\[\s*"lastMessageDate"\s*\]\s*,\s*"v"\s*:\s*(\d{10,16})\b/g;
  for (const match of source.matchAll(pattern)) {
    const value = Number(match[1] ?? match[2]);
    if (value > latest) latest = value;
  }
  return Number.isFinite(latest) ? isoTime(latest) : undefined;
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
