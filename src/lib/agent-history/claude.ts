// PURE (no fs; browser-safe): Claude Code session history (`<claude>/projects/<encoded-cwd>/<uuid>.jsonl`) to a
// ParsedSession (concepts/agent-history.md), fed one JSON line at a time (LineParser). Lines are `{type, uuid,
// timestamp, sessionId, cwd, gitBranch, isSidechain, isMeta?, message}`; anything else (mode, attachment, api-request,
// file-history, ...) is skipped. A user line is a prompt only when it carries typed text: tool results, meta lines,
// sidechains, task notifications and local command output are not, and a slash command (`/name args`, from the
// `<command-name>` wrapper or typed as one line) or a shell escape (`! cmd`, the `<bash-input>` wrapper) is a COMMAND:
// kept in the flow, never a prompt. Shell output (`<bash-stdout>`) is dropped like any tool output. Consecutive
// assistant lines (one content block each) are one turn. Title: the last `custom-title` (set by the user), else the
// last `ai-title`, else a `summary` line, else the first prompt.
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

/** Wrappers Claude Code puts around local command output and injected context: dropped from prompts. */
const DROPPED_WRAPPERS = [
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'system-reminder',
  'bash-stdout',
  'bash-stderr',
  'task-notification',
];

const tagContent = (source: string, tag: string): string | undefined =>
  new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(source)?.[1];

/** What the user entered on one `user` line: a prompt, or a command (a slash command, a shell escape). */
export interface ClaudeUserInput {
  kind: 'prompt' | 'command';
  text: string;
}

/** A slash command typed as one line (`/model`, `/add-dir ~/x`; not a path such as `/Users/me/x`). */
const TYPED_SLASH_COMMAND = /^\/[A-Za-z][\w:-]*(?:[ \t].*)?$/;
/** A shell escape typed as one line (`! pwd`). */
const TYPED_SHELL_ESCAPE = /^![ \t]*\S.*$/;

/** Whether one line of typed text is a command rather than a prompt (a slash command or a shell escape). */
export function isTypedCommand(value: string): boolean {
  const line = value.trim();
  return !line.includes('\n') && (TYPED_SLASH_COMMAND.test(line) || TYPED_SHELL_ESCAPE.test(line));
}

/**
 * What the user entered: `{kind: 'command'}` for a slash command (`/name args`) or a shell escape (`! cmd`), else
 * `{kind: 'prompt'}` with the wrappers of local command output and injected reminders removed, `Caveat: ` lines and
 * interruption markers dropped. null when nothing typed is left.
 */
export function claudeUserInput(raw: string): ClaudeUserInput | null {
  const command = tagContent(raw, 'command-name');
  if (command !== undefined) {
    const name = command.trim();
    const args = (tagContent(raw, 'command-args') ?? '').trim();
    const slash = name.startsWith('/') ? name : `/${name}`;
    return name === '' ? null : { kind: 'command', text: args === '' ? slash : `${slash} ${args}` };
  }
  const shell = tagContent(raw, 'bash-input');
  if (shell !== undefined) {
    return shell.trim() === '' ? null : { kind: 'command', text: `! ${shell.trim()}` };
  }
  let cleaned = raw;
  for (const tag of DROPPED_WRAPPERS) {
    cleaned = cleaned.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'), '');
  }
  cleaned = cleaned
    .split('\n')
    .filter((line) => !/^\s*Caveat: /.test(line))
    .filter((line) => !/^\s*\[Request interrupted by user[^\]]*\]\s*$/.test(line))
    .join('\n')
    .trim();
  if (cleaned === '') return null;
  return { kind: isTypedCommand(cleaned) ? 'command' : 'prompt', text: cleaned };
}

/** The text of what the user entered (a prompt or a command), or null (see claudeUserInput). */
export function claudePromptText(raw: string): string | null {
  return claudeUserInput(raw)?.text ?? null;
}

/**
 * What one `user` line entered, or null when it is neither a prompt nor a command (tool results only, an empty
 * message). Several text blocks are one command only when every one is a command; an image makes it a prompt.
 */
function userInputOf(content: unknown): ClaudeUserInput | null {
  if (typeof content === 'string') return claudeUserInput(content);
  if (!Array.isArray(content)) return null;
  const parts: ClaudeUserInput[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text') {
      const input = claudeUserInput(str(block.text) ?? '');
      if (input !== null) parts.push(input);
    } else if (block.type === 'image') {
      parts.push({ kind: 'prompt', text: '_(image)_' });
    }
  }
  if (parts.length === 0) return null;
  return {
    kind: parts.every((part) => part.kind === 'command') ? 'command' : 'prompt',
    text: parts.map((part) => part.text).join('\n\n'),
  };
}

function assistantBlocks(content: unknown): TranscriptBlock[] {
  if (typeof content === 'string') return text(content) ? [{ kind: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: TranscriptBlock[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text') {
      const value = text(block.text);
      if (value !== undefined) blocks.push({ kind: 'text', text: value });
    } else if (block.type === 'thinking') {
      const value = text(block.thinking);
      if (value !== undefined) blocks.push({ kind: 'thinking', text: value });
    } else if (block.type === 'tool_use') {
      const name = str(block.name) ?? 'tool';
      blocks.push({ kind: 'tool', name, summary: toolSummary(name, block.input) });
    }
  }
  return blocks;
}

/** A prompt line from a human: no `origin`, or `origin.kind: 'human'` (task notifications and peers are not). */
const fromHuman = (line: JsonRecord): boolean =>
  !isRecord(line.origin) || line.origin.kind === undefined || line.origin.kind === 'human';

/** The Claude Code line parser (one JSON line at a time; see the header); `prompts` = the prompts so far. */
export function claudeSessionParser(
  options: SessionParseOptions = {},
): LineParser<ParsedSession> & { readonly prompts: number } {
  const builder = transcriptBuilder(options.transcript !== false);
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let summaryTitle: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  return {
    get prompts() {
      return builder.prompts;
    },
    line(line) {
      if (!isRecord(line)) return;
      switch (line.type) {
        case 'custom-title':
          customTitle = text(line.customTitle) ?? customTitle;
          return;
        case 'ai-title':
          aiTitle = text(line.aiTitle) ?? aiTitle;
          return;
        case 'summary':
          summaryTitle ??= text(line.summary);
          return;
        case 'user':
        case 'assistant':
          break;
        default:
          return;
      }
      if (line.isSidechain === true || line.isMeta === true) return;
      const timestamp = isoTime(line.timestamp);
      if (timestamp !== undefined) {
        startedAt ??= timestamp;
        endedAt = timestamp;
      }
      cwd ??= text(line.cwd);
      gitBranch ??= text(line.gitBranch);
      const message = isRecord(line.message) ? line.message : {};
      if (line.type === 'user') {
        if (!fromHuman(line)) return;
        const input = userInputOf(message.content);
        if (input?.kind === 'prompt') builder.prompt(input.text, timestamp);
        else if (input?.kind === 'command') builder.command(input.text, timestamp);
      } else {
        const lineModel = text(message.model);
        if (lineModel !== undefined && lineModel !== '<synthetic>') model ??= lineModel;
        builder.assistant(assistantBlocks(message.content), timestamp);
      }
    },
    finish() {
      return assignDefined<ParsedSession>(
        { messages: builder.messages, prompts: builder.prompts },
        {
          title: customTitle ?? aiTitle ?? summaryTitle,
          firstPrompt: builder.firstPrompt,
          cwd,
          gitBranch,
          model,
          startedAt,
          endedAt,
        },
      );
    },
  };
}

/** A whole (or bounded) Claude Code history text. */
export function parseClaudeSession(
  source: string,
  options: SessionParseOptions = {},
): ParsedSession {
  return parseJsonLines(claudeSessionParser(options), source);
}
