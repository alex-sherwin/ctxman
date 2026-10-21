// PURE (no fs; browser-safe): Claude Code session history (`<claude>/projects/<encoded-cwd>/<uuid>.jsonl`) to a
// ParsedSession (concepts/agent-history.md). Lines are `{type, uuid, timestamp, sessionId, cwd, gitBranch, isSidechain,
// isMeta?, message}`; anything else (mode, attachment, api-request, file-history, ...) is skipped. A user line is a prompt
// only when it carries typed text: tool results, meta lines, sidechains, task notifications and local command output
// are not. Slash commands show as `/name args`. Consecutive assistant lines (one content block each) are one turn.
// Title: the last `custom-title` (set by the user), else the last `ai-title`, else a `summary` line, else the first prompt.
import {
  assignDefined,
  isoTime,
  isRecord,
  jsonLines,
  str,
  text,
  toolSummary,
  transcriptBuilder,
} from './parse-util.ts';
import type { JsonRecord, ParsedSession } from './parse-util.ts';
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

/**
 * The typed text of a user prompt: `/name args` for a slash command, `! cmd` for a shell escape, the wrappers of
 * local command output and injected reminders removed, `Caveat: ` lines and interruption markers dropped. null when
 * nothing typed is left.
 */
export function claudePromptText(raw: string): string | null {
  const command = tagContent(raw, 'command-name');
  if (command !== undefined) {
    const name = command.trim();
    const args = (tagContent(raw, 'command-args') ?? '').trim();
    const slash = name.startsWith('/') ? name : `/${name}`;
    return name === '' ? null : args === '' ? slash : `${slash} ${args}`;
  }
  const shell = tagContent(raw, 'bash-input');
  if (shell !== undefined) return shell.trim() === '' ? null : `! ${shell.trim()}`;
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
  return cleaned === '' ? null : cleaned;
}

/** The prompt of one `user` line, or null when it is not one (tool results only, an image-less empty message). */
function promptOf(content: unknown): string | null {
  if (typeof content === 'string') return claudePromptText(content);
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text') {
      const cleaned = claudePromptText(str(block.text) ?? '');
      if (cleaned !== null) parts.push(cleaned);
    } else if (block.type === 'image') {
      parts.push('_(image)_');
    }
  }
  return parts.length === 0 ? null : parts.join('\n\n');
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

export function parseClaudeSession(source: string): ParsedSession {
  const builder = transcriptBuilder();
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let summaryTitle: string | undefined;
  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let model: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of jsonLines(source)) {
    if (!isRecord(line)) continue;
    switch (line.type) {
      case 'custom-title':
        customTitle = text(line.customTitle) ?? customTitle;
        continue;
      case 'ai-title':
        aiTitle = text(line.aiTitle) ?? aiTitle;
        continue;
      case 'summary':
        summaryTitle ??= text(line.summary);
        continue;
      case 'user':
      case 'assistant':
        break;
      default:
        continue;
    }
    if (line.isSidechain === true || line.isMeta === true) continue;
    const timestamp = isoTime(line.timestamp);
    if (timestamp !== undefined) {
      startedAt ??= timestamp;
      endedAt = timestamp;
    }
    cwd ??= text(line.cwd);
    gitBranch ??= text(line.gitBranch);
    const message = isRecord(line.message) ? line.message : {};
    if (line.type === 'user') {
      if (!fromHuman(line)) continue;
      const prompt = promptOf(message.content);
      if (prompt !== null) builder.prompt(prompt, timestamp);
    } else {
      const lineModel = text(message.model);
      if (lineModel !== undefined && lineModel !== '<synthetic>') model ??= lineModel;
      builder.assistant(assistantBlocks(message.content), timestamp);
    }
  }

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
}
