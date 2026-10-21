// PURE (no fs; browser-safe): the markdown files an agent history import writes (concepts/agent-history.md): a session
// as `type: agent-session` (frontmatter, an info table, `## Prompt N · <UTC time>` per prompt, `### Response` per
// assistant turn and a `- Command: \`/model\`` line per command the user ran) and a plan as `type: plan`. Imported text goes through an injected InertTransform (inert.ts: raw HTML
// escaped, bundle links neutralized, headings shifted) so this module stays parser-free. Sizes: every text block is cut
// at 40 000 characters, and once the body passes 1.5 MB the remaining prompts are left out with a closing note.
import { Document, isScalar, isSeq } from 'yaml';
import { inlineCode } from '../inflate/catalog.ts';
import { clipLine, oneLine } from './parse-util.ts';
import { AGENT_LABELS, AGENT_SOURCE_LABELS } from './types.ts';
import type {
  AgentId,
  AgentPlanSummary,
  AgentSessionSummary,
  AgentSource,
  SessionMarkdownOptions,
  TranscriptBlock,
  TranscriptMessage,
} from './types.ts';

/** How imported text is made inert (inert.ts#INERT); injected so this module needs no markdown parser. */
export interface InertTransform {
  /** One message or plan text; `shift` moves its ATX headings down. */
  block(text: string, shift: number): string;
  /** The assembled body, once more as a whole. */
  document(body: string): string;
}

export const TEXT_BLOCK_MAX = 40_000;
export const BODY_MAX_BYTES = 1.5 * 1024 * 1024;
/** Headings inside a message move down by this many levels (a prompt is `##`, a response `###`). */
export const MESSAGE_HEADING_SHIFT = 3;
export const SESSION_SLUG_MAX = 48;
export const PLAN_SLUG_MAX = 64;
export const DEFAULT_SESSION_OPTIONS: SessionMarkdownOptions = { tools: true, thinking: false };

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/** `text` cut at `max` characters with the `… [truncated N characters]` note; `cut` = whether it was. */
export function truncateBlock(text: string, max = TEXT_BLOCK_MAX): { text: string; cut: number } {
  if (text.length <= max) return { text, cut: 0 };
  let end = max;
  // Never split a surrogate pair.
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), cut: text.length - end };
}

const truncationNote = (cut: number): string => `… [truncated ${cut} characters]`;

/** A slug of `value` for a file name: lowercase ASCII letters, digits and single hyphens, at most `max`. */
export function slugify(value: string, max: number, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, max).replace(/-+$/, '');
  return cut === '' ? fallback : cut;
}

/** `YYYY-MM-DD` of an ISO date-time. */
const day = (iso: string): string => iso.slice(0, 10);
/** `YYYY-MM-DD HH:MM` (UTC) of an ISO date-time. */
const minute = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
/** An ISO date-time to the second, UTC: `2026-10-21T16:13:00Z`. */
const seconds = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 19)}Z`;
};

/** `sessions/<YYYY-MM-DD of startedAt|modifiedAt>-<agent>-<slug of title, max 48>.md` */
export function sessionDefaultPath(summary: AgentSessionSummary, title = summary.title): string {
  const date = day(summary.startedAt ?? summary.modifiedAt);
  return `sessions/${date}-${summary.agent}-${slugify(title, SESSION_SLUG_MAX, 'session')}.md`;
}

/** `plans/<slug of title, max 64>.md` */
export function planDefaultPath(title: string): string {
  return `plans/${slugify(title, PLAN_SLUG_MAX, 'plan')}.md`;
}

/** "Claude Code", "GitHub Copilot CLI", "Codex archived". */
export function sourceLabel(agent: AgentId, source: AgentSource): string {
  const badge = AGENT_SOURCE_LABELS[source];
  return badge === '' ? AGENT_LABELS[agent] : `${AGENT_LABELS[agent]} ${badge}`;
}

/** A display path with the home directory as `~` when it is under the given home (posix or Windows separators). */
function tildePath(value: string, home: string | undefined): string {
  if (home === undefined || home === '') return value;
  const normal = (s: string): string => s.replaceAll('\\', '/').replace(/\/+$/, '');
  const v = normal(value);
  const h = normal(home);
  return v === h ? '~' : v.startsWith(`${h}/`) ? `~${v.slice(h.length)}` : value;
}

/**
 * Frontmatter YAML for an import: keys in the given order, undefined values left out, `tags` as a flow list and the
 * keys in `dateKeys` double-quoted (ctxman reads YAML with the timestamp tag, which would turn them into Dates).
 */
function frontmatter(fields: Record<string, unknown>, dateKeys: readonly string[]): string {
  const data = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
  const doc = new Document(data);
  const tags = doc.get('tags', true);
  if (isSeq(tags)) tags.flow = true;
  for (const key of dateKeys) {
    const node = doc.get(key, true);
    if (isScalar(node)) node.type = 'QUOTE_DOUBLE';
  }
  const yaml = doc.toString({ blockQuote: 'literal', lineWidth: 0, flowCollectionPadding: false });
  return `---\n${yaml}---\n`;
}

/** A GFM table cell: pipes escaped (also inside code spans, where GFM reads `\|` as `|`), one line. */
const cell = (value: string): string => oneLine(value).replaceAll('|', '\\|');
const codeCell = (value: string): string => cell(inlineCode(oneLine(value)));

function table(rows: readonly (readonly [string, string])[]): string {
  const [head, ...rest] = rows;
  if (head === undefined) return '';
  const lines = [`| ${head[0]} | ${head[1]} |`, '| ----- | ----- |'];
  for (const [key, value] of rest) lines.push(`| ${key} | ${value} |`);
  return lines.join('\n');
}

/** One line of text for a heading (title): inert, single line. */
const headingText = (value: string, inert: InertTransform): string =>
  oneLine(inert.block(oneLine(value), 0));

/** A block of imported text: truncated, inert; `cut` counts the characters left out. */
function textBlock(
  value: string,
  shift: number,
  inert: InertTransform,
): { markdown: string; cut: boolean } {
  const { text, cut } = truncateBlock(value.trim());
  const markdown = inert.block(text, shift).trim();
  return cut === 0
    ? { markdown, cut: false }
    : { markdown: `${markdown}\n\n${truncationNote(cut)}`, cut: true };
}

/** A thinking block as a blockquote: `> **Thinking:** …`. */
function thinkingQuote(markdown: string): string {
  const lines = markdown.split('\n');
  const first = lines[0] ?? '';
  // A plain first line carries the label; a heading, list, quote, table or fence starts after it.
  const plain =
    first !== '' &&
    !/^\s*(?:#{1,6}(?:\s|$)|>|\||[*+-](?:\s|$)|\d+[.)](?:\s|$)|`{3}|~{3})/.test(first);
  const quoted = (
    plain ? [`**Thinking:** ${first}`, ...lines.slice(1)] : ['**Thinking:**', '', ...lines]
  ).map((line) => (line.trim() === '' ? '>' : `> ${line}`));
  return quoted.join('\n');
}

/** A command line is cut to this many characters (one line, an inline code span). */
export const COMMAND_MAX = 500;

/** `- Command: \`/model\``: one line per command the user ran (inert: a code span). */
const commandLine = (message: TranscriptMessage): string => {
  const text = message.blocks
    .filter((block) => block.kind === 'text')
    .map((block) => block.text)
    .join(' ');
  return `- Command: ${inlineCode(clipLine(text, COMMAND_MAX) || '/')}`;
};

const toolLine = (block: Extract<TranscriptBlock, { kind: 'tool' }>): string =>
  `- ${inlineCode(oneLine(block.name) || 'tool')}${block.summary === '' ? '' : ` ${inlineCode(oneLine(block.summary))}`}`;

/** The markdown of one assistant turn's blocks ('' when nothing is shown with these options). */
function responseMarkdown(
  blocks: readonly TranscriptBlock[],
  options: SessionMarkdownOptions,
  inert: InertTransform,
): { markdown: string; cut: boolean } {
  const parts: string[] = [];
  let tools: string[] = [];
  let cut = false;
  const flushTools = (): void => {
    if (tools.length > 0) parts.push(tools.join('\n'));
    tools = [];
  };
  for (const block of blocks) {
    if (block.kind === 'tool') {
      if (options.tools) tools.push(toolLine(block));
      continue;
    }
    if (block.kind === 'thinking' && !options.thinking) continue;
    flushTools();
    const text = textBlock(block.text, MESSAGE_HEADING_SHIFT, inert);
    if (text.markdown === '') continue;
    cut ||= text.cut;
    parts.push(block.kind === 'thinking' ? thinkingQuote(text.markdown) : text.markdown);
  }
  flushTools();
  return { markdown: parts.join('\n\n'), cut };
}

export interface SessionMarkdownInput {
  summary: AgentSessionSummary;
  messages: readonly TranscriptMessage[];
  prompts: number;
  /** ISO date-time of the last event. */
  endedAt?: string;
  /** Display path of the session file (`~/...`). */
  sourcePath: string;
  /** The home directory `~` stands for (shortens the cwd in the description). */
  home?: string;
}

export interface MarkdownContext {
  /** The title of the file (frontmatter `title` and the H1); the session's own when not overridden. */
  title: string;
  now: Date;
  inert: InertTransform;
}

export interface GeneratedFile {
  /** The whole file: frontmatter + body. */
  markdown: string;
  /** The body (what the preview renders). */
  body: string;
  title: string;
  description: string;
}

export interface GeneratedSession extends GeneratedFile {
  truncated: boolean;
}

/** `Claude Code session in ~/repos/app, 2026-10-21, 12 prompts` */
export function sessionDescription(input: SessionMarkdownInput): string {
  const { summary } = input;
  const where = summary.cwd === undefined ? '' : ` in ${tildePath(summary.cwd, input.home)}`;
  const date = day(summary.startedAt ?? summary.modifiedAt);
  const count = `${input.prompts} prompt${input.prompts === 1 ? '' : 's'}`;
  return clipLine(
    `${sourceLabel(summary.agent, summary.source)} session${where}, ${date}, ${count}`,
    1000,
  );
}

export function sessionMarkdown(
  input: SessionMarkdownInput,
  options: SessionMarkdownOptions,
  context: MarkdownContext,
): GeneratedSession {
  const { summary } = input;
  const { inert } = context;
  const title = clipLine(context.title, 200);
  const description = sessionDescription(input);

  const rows: [string, string][] = [['Agent', cell(sourceLabel(summary.agent, summary.source))]];
  if (summary.cwd !== undefined) rows.push(['Directory', codeCell(summary.cwd)]);
  if (summary.gitBranch !== undefined) rows.push(['Branch', codeCell(summary.gitBranch)]);
  if (summary.model !== undefined) rows.push(['Model', codeCell(summary.model)]);
  if (summary.startedAt !== undefined) rows.push(['Started', `${minute(summary.startedAt)} UTC`]);
  if (input.endedAt !== undefined) rows.push(['Ended', `${minute(input.endedAt)} UTC`]);
  rows.push(['Prompts', String(input.prompts)]);
  rows.push(['Session', codeCell(summary.id)]);
  rows.push(['Source', codeCell(input.sourcePath)]);

  const sections: string[] = [`# ${headingText(title, inert)}`, table(rows)];
  let bytes = utf8Length(sections.join('\n\n'));
  let truncated = false;
  let prompt = 0;
  let index = 0;
  const messages = input.messages;
  while (index < messages.length) {
    if (bytes > BODY_MAX_BYTES) {
      const left = messages.slice(index).filter((m) => m.role === 'user').length;
      if (left > 0) {
        sections.push(
          `_… ${left} more prompt${left === 1 ? '' : 's'} left out to keep this file small._`,
        );
        truncated = true;
        break;
      }
    }
    const message = messages[index] as TranscriptMessage;
    index += 1;
    let part = '';
    if (message.role === 'command') {
      // consecutive commands are one list
      const lines = [commandLine(message)];
      while (messages[index]?.role === 'command') {
        lines.push(commandLine(messages[index] as TranscriptMessage));
        index += 1;
      }
      part = lines.join('\n');
    } else if (message.role === 'user') {
      prompt += 1;
      const when = message.timestamp === undefined ? '' : ` · ${minute(message.timestamp)}`;
      const textOf = message.blocks
        .filter((block) => block.kind === 'text')
        .map((block) => block.text)
        .join('\n\n');
      const text = textBlock(textOf, MESSAGE_HEADING_SHIFT, inert);
      truncated ||= text.cut;
      part = [`## Prompt ${prompt}${when}`, text.markdown].filter((s) => s !== '').join('\n\n');
    } else {
      const response = responseMarkdown(message.blocks, options, inert);
      truncated ||= response.cut;
      if (response.markdown !== '') part = `### Response\n\n${response.markdown}`;
    }
    if (part === '') continue;
    sections.push(part);
    bytes += utf8Length(part) + 2;
  }

  const body = `${inert.document(sections.join('\n\n'))}\n`;
  const fields: Record<string, unknown> = {
    type: 'agent-session',
    title,
    description,
    tags: ['agent-session', summary.agent],
    // Imported history never enters search (entries.ts#buildSearchIndex skips `index: false`).
    index: false,
    agent: summary.agent,
    source: summary.source,
    session_id: summary.id,
    cwd: summary.cwd,
    git_branch: summary.gitBranch,
    model: summary.model,
    started: summary.startedAt === undefined ? undefined : seconds(summary.startedAt),
    ended: input.endedAt === undefined ? undefined : seconds(input.endedAt),
    prompts: input.prompts,
    source_path: input.sourcePath,
    imported: seconds(context.now.toISOString()),
  };
  const head = frontmatter(fields, ['started', 'ended', 'imported']);
  return { markdown: `${head}\n${body}`, body, title, description, truncated };
}

// ---------------------------------------------------------------- plans

/** The plan text without its own frontmatter (a leading `---` … `---` block). */
export function stripFrontmatter(text: string): string {
  const normal = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const match = /^---\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(normal);
  return match === null ? normal : normal.slice(match[0].length);
}

/** Lines outside fenced code (fences opened at up to 3 spaces), each with whether it is code. */
function proseLines(text: string): { line: string; code: boolean }[] {
  let fence: { char: string; length: number } | null = null;
  return text.split('\n').map((line) => {
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close !== undefined && close[0] === fence.char && close.length >= fence.length)
        fence = null;
      return { line, code: true };
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (open !== undefined) {
      fence = { char: open[0] ?? '`', length: open.length };
      return { line, code: true };
    }
    return { line, code: false };
  });
}

const ATX = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;

/** The first ATX heading of `text` outside code: its level and text. */
export function firstHeading(text: string): { level: number; text: string; line: number } | null {
  const lines = proseLines(text);
  for (let i = 0; i < lines.length; i++) {
    const entry = lines[i];
    if (entry === undefined || entry.code) continue;
    const match = ATX.exec(entry.line);
    if (match !== null && (match[2] ?? '').trim() !== '') {
      return { level: (match[1] ?? '#').length, text: oneLine(match[2] ?? ''), line: i };
    }
  }
  return null;
}

/** Whether `text` has a level-1 heading (ATX `# `, or a setext `===` underline) outside code. */
export function hasH1(text: string): boolean {
  const lines = proseLines(text);
  return lines.some(
    (entry, i) =>
      !entry.code &&
      (/^ {0,3}#[ \t]+\S/.test(entry.line) ||
        (/^ {0,3}=+[ \t]*$/.test(entry.line) &&
          i > 0 &&
          lines[i - 1]?.code === false &&
          (lines[i - 1]?.line.trim() ?? '') !== '')),
  );
}

/** Plain text of a markdown line for an excerpt: list, quote and heading markers and emphasis dropped. */
const plainLine = (line: string): string =>
  line
    .replace(/^\s*(?:[>*+-]|\d+[.)])\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>\n]*>/g, '')
    .replace(/[*_`]+/g, '')
    .trim();

/** The first lines of prose after the title heading (or from the top), one line, at most `max` characters. */
export function planExcerpt(text: string, max = 200): string {
  const body = stripFrontmatter(text);
  const heading = firstHeading(body);
  const lines = proseLines(body).slice(heading === null ? 0 : heading.line + 1);
  const out: string[] = [];
  let length = 0;
  for (const { line, code } of lines) {
    if (code || /^\s*(?:#{1,6}\s|\||[-*_]{3,}\s*$)/.test(line)) continue;
    const plain = plainLine(line);
    if (plain === '') continue;
    out.push(plain);
    length += plain.length + 1;
    if (length > max) break;
  }
  return clipLine(out.join(' '), max);
}

export interface PlanMarkdownInput {
  summary: AgentPlanSummary;
  /** The plan file's text. */
  text: string;
  /** Display path of the plan file. */
  sourcePath: string;
}

/** `Claude Code plan, 2026-10-21` + `, <thread>` when known. */
export function planDescription(summary: AgentPlanSummary): string {
  const thread = summary.thread === undefined ? '' : `, ${oneLine(summary.thread)}`;
  return clipLine(`${AGENT_LABELS[summary.agent]} plan, ${day(summary.modifiedAt)}${thread}`, 1000);
}

export function planMarkdown(input: PlanMarkdownInput, context: MarkdownContext): GeneratedFile {
  const { summary } = input;
  const { inert } = context;
  const title = clipLine(context.title, 200);
  const description = planDescription(summary);
  const { text, cut } = truncateBlock(
    stripFrontmatter(input.text).trim(),
    Number.POSITIVE_INFINITY,
  );
  const withTitle = hasH1(text) ? text : `# ${headingText(title, inert)}\n\n${text}`;
  const inertText = inert.block(withTitle, 0).trim();
  const body = `${inert.document(cut === 0 ? inertText : `${inertText}\n\n${truncationNote(cut)}`)}\n`;
  const fields: Record<string, unknown> = {
    type: 'plan',
    title,
    description,
    tags: ['plan', summary.agent],
    index: false,
    agent: summary.agent,
    source: summary.source,
    plan_id: summary.id,
    cwd: summary.cwd,
    thread: summary.thread === undefined ? undefined : oneLine(summary.thread),
    source_path: input.sourcePath,
    imported: seconds(context.now.toISOString()),
  };
  const head = frontmatter(fields, ['imported']);
  return { markdown: `${head}\n${body}`, body, title, description };
}

/** A title or description for the bookkeeping lines of index.md / log.md: one line, no raw HTML, no link syntax. */
export function indexLineText(value: string, opts: { brackets: boolean }): string {
  const line = oneLine(value).replaceAll('<', '&lt;');
  return opts.brackets ? line.replace(/[\\[\]]/g, '\\$&') : line;
}
