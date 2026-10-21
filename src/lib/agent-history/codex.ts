// PURE (no fs; browser-safe): Codex rollout files (`<codex>/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl[.zst]`, the
// decompressed text) to a ParsedSession, plus the `session_index.jsonl` thread names (concepts/agent-history.md).
// Lines are `{timestamp, type, payload}`: `session_meta` (id, cwd, git branch; a subagent thread names its parent),
// `turn_context` (model), `response_item` (messages, reasoning summaries, tool calls) and `event_msg`. The exact typed
// prompt is an `event_msg` (`user_message`, or an `item_completed` UserMessage item in newer builds); when a file has
// those, the `response_item` user copies are ignored so nothing counts twice. Injected context (environment, AGENTS.md
// instructions, permissions, any text that is one `<tag>…</tag>` wrapper) is never a prompt. Older files without the
// `payload` wrapper are read too.
import {
  assignDefined,
  isoTime,
  isRecord,
  jsonLines,
  oneLine,
  parseArguments,
  str,
  text,
  toolSummary,
  transcriptBuilder,
} from './parse-util.ts';
import type { JsonRecord, ParsedSession } from './parse-util.ts';
import type { TranscriptBlock } from './types.ts';

/** The trailing uuid of a rollout file name (`rollout-2026-10-21T16-13-00-<uuid>.jsonl[.zst]`), else null. */
export function codexIdFromFileName(name: string): string | null {
  return (
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl(?:\.zst)?$/i.exec(
      name,
    )?.[1] ?? null
  );
}

/** `session_index.jsonl` (`{id, thread_name, updated_at}` per line) to id -> thread name; the latest line per id wins. */
export function parseCodexSessionIndex(source: string): Map<string, string> {
  const latest = new Map<string, { name: string; at: number; order: number }>();
  let order = 0;
  for (const line of jsonLines(source)) {
    order += 1;
    if (!isRecord(line)) continue;
    const id = text(line.id);
    const name = text(line.thread_name);
    if (id === undefined || name === undefined) continue;
    const parsed = Date.parse(str(line.updated_at) ?? '');
    const at = Number.isNaN(parsed) ? -Infinity : parsed;
    const seen = latest.get(id);
    if (seen === undefined || at > seen.at || (at === seen.at && order > seen.order)) {
      latest.set(id, { name: oneLine(name), at, order });
    }
  }
  return new Map([...latest].map(([id, { name }]) => [id, name]));
}

const INJECTED_PREFIXES = [
  '<environment_context',
  '<user_instructions',
  '<permissions',
  '<collaboration_mode',
  '# AGENTS.md instructions',
];

/** Context Codex injects as a user message: not something the user typed. */
export function isInjectedContext(value: string): boolean {
  const trimmed = value.trim();
  if (INJECTED_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) return true;
  const tag = /^<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>/.exec(trimmed)?.[1];
  return tag !== undefined && trimmed.endsWith(`</${tag}>`);
}

/** The typed text of content parts (`input_text` / `text`; images as a placeholder), injected parts left out. */
function promptFromParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  const out: string[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    const value = str(part.text);
    if (value !== undefined && (part.type === 'input_text' || part.type === 'text')) {
      if (value.trim() !== '' && !isInjectedContext(value)) out.push(value.trim());
    } else if (
      part.type === 'input_image' ||
      part.type === 'local_image' ||
      part.type === 'image' ||
      part.type === 'path'
    ) {
      out.push('_(image)_');
    }
  }
  // Only images (no typed text) is still a prompt; an injected-only message is not.
  return out.length === 0 ? null : out.join('\n\n');
}

function textOfParts(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  const out = parts
    .filter(isRecord)
    .map((part) => str(part.text) ?? '')
    .filter((value) => value.trim() !== '');
  return out.length === 0 ? undefined : out.join('\n\n');
}

/** Assistant-side blocks of one `response_item` payload. */
function itemBlocks(payload: JsonRecord): TranscriptBlock[] {
  switch (payload.type) {
    case 'message': {
      if (payload.role !== 'assistant') return [];
      const value = textOfParts(payload.content);
      return value === undefined ? [] : [{ kind: 'text', text: value }];
    }
    case 'agent_message': {
      const value = textOfParts(payload.content);
      if (value === undefined) return [];
      const author = text(payload.author);
      const recipient = text(payload.recipient);
      // A message between agents of a multi-agent run: one line, like a tool call.
      if (author !== undefined || recipient !== undefined) {
        return [
          {
            kind: 'tool',
            name: 'agent message',
            summary: toolSummary(
              'agent message',
              `${author ?? '?'} → ${recipient ?? '?'}: ${value}`,
            ),
          },
        ];
      }
      return [{ kind: 'text', text: value }];
    }
    case 'reasoning': {
      const summary = textOfParts(payload.summary);
      return summary === undefined ? [] : [{ kind: 'thinking', text: summary }];
    }
    case 'function_call': {
      const name = str(payload.name) ?? 'tool';
      return [
        { kind: 'tool', name, summary: toolSummary(name, parseArguments(payload.arguments)) },
      ];
    }
    case 'custom_tool_call': {
      const name = str(payload.name) ?? 'tool';
      return [{ kind: 'tool', name, summary: toolSummary(name, parseArguments(payload.input)) }];
    }
    case 'local_shell_call': {
      const action = isRecord(payload.action) ? payload.action : {};
      return [{ kind: 'tool', name: 'shell', summary: toolSummary('shell', action) }];
    }
    default:
      return [];
  }
}

const RESPONSE_ITEM_TYPES = new Set([
  'message',
  'agent_message',
  'reasoning',
  'function_call',
  'custom_tool_call',
  'local_shell_call',
]);

/** A subagent thread: its meta names a parent thread or a subagent source. */
function isSubagentMeta(meta: JsonRecord): boolean {
  if (text(meta.parent_thread_id) !== undefined) return true;
  if (isRecord(meta.source) && 'subagent' in meta.source) return true;
  const threadSource = str(meta.thread_source);
  return threadSource === 'subagent' || threadSource === 'guardian_review';
}

type Entry =
  | { kind: 'prompt'; exact: boolean; text: string; timestamp?: string }
  | { kind: 'blocks'; blocks: TranscriptBlock[]; timestamp?: string };

/** `titles`: the session index (thread names by session id). */
export function parseCodexSession(
  source: string,
  titles: ReadonlyMap<string, string> = new Map(),
): ParsedSession & { id?: string } {
  const entries: Entry[] = [];
  let meta: JsonRecord | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of jsonLines(source)) {
    if (!isRecord(line)) continue;
    let type = str(line.type);
    let payload = isRecord(line.payload) ? line.payload : undefined;
    // Older rollouts: a bare meta first line and bare response items without the wrapper.
    if (payload === undefined) {
      if (type === undefined && text(line.id) !== undefined && meta === undefined) {
        type = 'session_meta';
        payload = line;
      } else if (type !== undefined && RESPONSE_ITEM_TYPES.has(type)) {
        payload = line;
        type = 'response_item';
      } else {
        continue;
      }
    }
    const timestamp = isoTime(line.timestamp) ?? isoTime(payload.timestamp);
    if (timestamp !== undefined && type !== 'session_meta') {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    switch (type) {
      case 'session_meta':
        if (meta === undefined) {
          meta = payload;
          startedAt ??= isoTime(payload.timestamp) ?? timestamp;
        }
        break;
      case 'turn_context':
        model ??= text(payload.model);
        break;
      case 'event_msg': {
        let prompt: string | null = null;
        if (payload.type === 'user_message') {
          const value = str(payload.message);
          prompt =
            value === undefined || value.trim() === '' || isInjectedContext(value)
              ? null
              : value.trim();
        } else if (
          payload.type === 'item_completed' &&
          isRecord(payload.item) &&
          payload.item.type === 'UserMessage'
        ) {
          prompt = promptFromParts(payload.item.content);
        }
        if (prompt !== null) entries.push({ kind: 'prompt', exact: true, text: prompt, timestamp });
        break;
      }
      case 'response_item': {
        if (payload.type === 'message' && payload.role === 'user') {
          const prompt = promptFromParts(payload.content);
          if (prompt !== null)
            entries.push({ kind: 'prompt', exact: false, text: prompt, timestamp });
        } else {
          const blocks = itemBlocks(payload);
          if (blocks.length > 0) entries.push({ kind: 'blocks', blocks, timestamp });
        }
        break;
      }
      default:
        break;
    }
  }

  const exact = entries.some((entry) => entry.kind === 'prompt' && entry.exact);
  const builder = transcriptBuilder();
  for (const entry of entries) {
    if (entry.kind === 'prompt') {
      if (entry.exact === exact) builder.prompt(entry.text, entry.timestamp);
    } else {
      builder.assistant(entry.blocks, entry.timestamp);
    }
  }
  const id = meta === undefined ? undefined : text(meta.id);
  const git = meta !== undefined && isRecord(meta.git) ? meta.git : {};
  return assignDefined<ParsedSession & { id?: string }>(
    { messages: builder.messages, prompts: builder.prompts },
    {
      id,
      title: id === undefined ? undefined : titles.get(id),
      firstPrompt: builder.firstPrompt,
      cwd: meta === undefined ? undefined : text(meta.cwd),
      gitBranch: text(git.branch),
      model,
      startedAt,
      endedAt,
      subagent: meta !== undefined && isSubagentMeta(meta) ? true : undefined,
    },
  );
}
