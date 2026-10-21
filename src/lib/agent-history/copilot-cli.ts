// PURE (no fs; browser-safe): GitHub Copilot CLI sessions (`<copilot>/session-state/<uuid>/events.jsonl` + the
// `workspace.yaml` beside it; legacy `<copilot>/session-state/<uuid>.jsonl`) to a ParsedSession
// (concepts/agent-history.md), fed one JSON line at a time (LineParser). Events are `{type, data, id, timestamp, parentId}`: `session.start` (start time,
// context cwd/branch), `user.message`, `assistant.message` (content + toolRequests), `assistant.reasoning`,
// `tool.execution_start` (only for calls no assistant message announced). Events of a subagent (`parentToolCallId`)
// are left out. Title: the workspace `summary`, else the first prompt.
import { parse } from 'yaml';
import {
  assignDefined,
  isoTime,
  isRecord,
  parseJsonLines,
  str,
  text,
  toolSummary,
  transcriptBuilder,
} from './parse-util.ts';
import type { JsonRecord, LineParser, ParsedSession, SessionParseOptions } from './parse-util.ts';
import type { TranscriptBlock } from './types.ts';

export interface CopilotWorkspace {
  cwd?: string;
  branch?: string;
  summary?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** `workspace.yaml` of a session dir; {} when it does not parse. */
export function parseCopilotWorkspace(source: string | undefined): CopilotWorkspace {
  if (source === undefined) return {};
  let data: unknown;
  try {
    data = parse(source);
  } catch {
    return {};
  }
  if (!isRecord(data)) return {};
  const time = (value: unknown): string | undefined =>
    value instanceof Date ? value.toISOString() : isoTime(value);
  return assignDefined<CopilotWorkspace>(
    {},
    {
      cwd: text(data.cwd),
      branch: text(data.branch),
      summary: text(data.summary),
      createdAt: time(data.created_at),
      updatedAt: time(data.updated_at),
    },
  );
}

const subagentEvent = (data: JsonRecord): boolean => text(data.parentToolCallId) !== undefined;

/** The `events.jsonl` line parser; `workspace` = the session's workspace.yaml. */
export function copilotSessionParser(
  workspace: CopilotWorkspace = {},
  options: SessionParseOptions = {},
): LineParser<ParsedSession> {
  const builder = transcriptBuilder(options.transcript !== false);
  const announced = new Set<string>();
  let cwd = workspace.cwd;
  let gitBranch = workspace.branch;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  return {
    line(line) {
      if (!isRecord(line)) return;
      const data = isRecord(line.data) ? line.data : {};
      const timestamp = isoTime(line.timestamp);
      if (timestamp !== undefined) {
        startedAt ??= timestamp;
        endedAt = timestamp;
      }
      switch (line.type) {
        case 'session.start': {
          startedAt = isoTime(data.startTime) ?? startedAt;
          const context = isRecord(data.context) ? data.context : {};
          cwd ??= text(context.cwd);
          gitBranch ??= text(context.branch);
          break;
        }
        case 'session.model_change':
          model ??= text(data.newModel);
          break;
        case 'user.message': {
          const value = str(data.content);
          if (value !== undefined && value.trim() !== '') builder.prompt(value.trim(), timestamp);
          break;
        }
        case 'assistant.message': {
          if (subagentEvent(data)) break;
          const blocks: TranscriptBlock[] = [];
          const value = text(data.content);
          if (value !== undefined) blocks.push({ kind: 'text', text: value });
          if (Array.isArray(data.toolRequests)) {
            for (const request of data.toolRequests) {
              if (!isRecord(request)) continue;
              const name = str(request.name) ?? 'tool';
              const id = text(request.toolCallId);
              if (id !== undefined) announced.add(id);
              blocks.push({ kind: 'tool', name, summary: toolSummary(name, request.arguments) });
            }
          }
          builder.assistant(blocks, timestamp);
          break;
        }
        case 'assistant.reasoning': {
          if (subagentEvent(data)) break;
          const value = text(data.content);
          if (value !== undefined)
            builder.assistant([{ kind: 'thinking', text: value }], timestamp);
          break;
        }
        case 'tool.execution_start': {
          if (subagentEvent(data)) break;
          const id = text(data.toolCallId);
          if (id !== undefined && announced.has(id)) break;
          const name = str(data.toolName) ?? 'tool';
          builder.assistant(
            [{ kind: 'tool', name, summary: toolSummary(name, data.arguments) }],
            timestamp,
          );
          break;
        }
        default:
          break;
      }
    },
    finish() {
      return assignDefined<ParsedSession>(
        { messages: builder.messages, prompts: builder.prompts },
        {
          title: workspace.summary,
          firstPrompt: builder.firstPrompt,
          cwd,
          gitBranch,
          model,
          startedAt: startedAt ?? workspace.createdAt,
          endedAt: endedAt ?? workspace.updatedAt,
        },
      );
    },
  };
}

/** A whole (or bounded) `events.jsonl` text. */
export function parseCopilotSession(
  events: string,
  workspace: CopilotWorkspace = {},
  options: SessionParseOptions = {},
): ParsedSession {
  return parseJsonLines(copilotSessionParser(workspace, options), events);
}
