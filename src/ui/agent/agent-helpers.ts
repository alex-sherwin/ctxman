// PURE (no DOM, no fetch; browser-safe): the logic behind the Import session / Import plan dialogs
// (plans/AGENT_HISTORY_SPEC.md §7): agent chip options and labels, short display of a working directory or a file
// path, relative times from a `now` (the `$now` store), the import path / title rules (the Add file rules of
// entry-helpers.ts), keyboard selection moves, the Load more merge and the meta lines above the preview. Unit-tested
// in tests/unit/agent-dialog-helpers.test.ts.
import { AGENT_IDS, AGENT_LABELS, AGENT_SOURCE_LABELS } from '../../lib/agent-history/types.ts';
import type {
  AgentId,
  AgentPlanSummary,
  AgentSessionSummary,
  AgentSource,
} from '../../lib/agent-history/types.ts';
import { formatAbsolute, formatRelative } from '../../lib/time.ts';
import type { ApiFailure } from '../edit/api.ts';
import { newFilePath, newFilePathProblem, TITLE_MAX } from '../entry/entry-helpers.ts';
import type { AgentFilter } from './agent-api.ts';

// ---------------------------------------------------------------- agents

/** The agent chips, `All` first, then `AGENT_IDS` in their order. */
export const AGENT_FILTERS: readonly AgentFilter[] = ['all', ...AGENT_IDS];

export interface AgentFilterOption {
  id: AgentFilter;
  label: string;
  /** `<prefix>-agent-<all|id>`. */
  testId: string;
}

/** The ChipToggle options of a dialog (`prefix` = `session` or `plan`). */
export function agentFilterOptions(prefix: string): AgentFilterOption[] {
  return AGENT_FILTERS.map((id) => ({
    id,
    label: id === 'all' ? 'All' : AGENT_LABELS[id],
    testId: `${prefix}-agent-${id}`,
  }));
}

/** The agent badge of a list row: short, the full label is its title. */
export const AGENT_SHORT_LABELS: Readonly<Record<AgentId, string>> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  copilot: 'Copilot',
};

/** "GitHub Copilot · VS Code", "Codex · archived", "Claude Code". */
export function agentSourceText(agent: AgentId, source: AgentSource): string {
  const extra = AGENT_SOURCE_LABELS[source];
  return extra === '' ? AGENT_LABELS[agent] : `${AGENT_LABELS[agent]} · ${extra}`;
}

// ---------------------------------------------------------------- display

const segmentsOf = (value: string): string[] => value.split(/[\\/]+/).filter((s) => s !== '');

/**
 * A working directory in a narrow row: its last two segments (`~/repos/app` and `/Users/me/repos/app` -> `repos/app`,
 * `C:\work\app\web` -> `app/web`); a path of two segments or fewer stays as it is (`~/app`, `/srv`, `~`). '' for none.
 */
export function shortCwd(cwd: string | undefined): string {
  const value = (cwd ?? '').trim();
  if (value === '') return '';
  const segments = segmentsOf(value);
  if (segments.length <= 2) return value;
  return segments.slice(-2).join('/');
}

/**
 * A file path in a narrow row: the first two segments, `…` and the file name when it has more than four
 * (`~/.codex/plans/<thread>/<turn>/PLAN.md` -> `~/.codex/…/PLAN.md`); shorter paths stay whole.
 */
export function shortPath(path: string): string {
  const segments = segmentsOf(path);
  if (segments.length <= 4) return path;
  const lead = path.startsWith('/') ? '/' : '';
  return `${lead}${segments[0]}/${segments[1]}/…/${segments.at(-1) ?? ''}`;
}

/** "3 hours ago" from the `$now` store; '' before the store has ticked (0) or for no date. */
export function relativeTime(iso: string | undefined, nowMs: number): string {
  if (iso === undefined || iso === '' || nowMs <= 0) return '';
  return formatRelative(iso, nowMs);
}

/** `YYYY-MM-DD HH:mm` local; '' for no date. */
export function absoluteTime(iso: string | undefined): string {
  return iso === undefined || iso === '' ? '' : formatAbsolute(iso);
}

/** "812 B", "12.3 KB", "4.1 MB" (1024 based, one decimal under 100). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 100 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// ---------------------------------------------------------------- the list

/** `selected` when it is one of `keys`, else the first key (the first row is selected on load), null for none. */
export function effectiveKey(keys: readonly string[], selected: string | null): string | null {
  if (selected !== null && keys.includes(selected)) return selected;
  return keys[0] ?? null;
}

/**
 * The key `delta` rows away from `selected` (ArrowDown = +1, ArrowUp = -1), clamped to the list; with nothing
 * selected the first row. Null for an empty list.
 */
export function moveSelection(
  keys: readonly string[],
  selected: string | null,
  delta: number,
): string | null {
  if (keys.length === 0) return null;
  const at = selected === null ? -1 : keys.indexOf(selected);
  if (at < 0) return keys[0] ?? null;
  const next = Math.min(keys.length - 1, Math.max(0, at + delta));
  return keys[next] ?? null;
}

/** The row move of a key in the search field: ArrowDown / ArrowUp one row, PageDown / PageUp ten; else 0. */
export function keyDelta(key: string): number {
  switch (key) {
    case 'ArrowDown':
      return 1;
    case 'ArrowUp':
      return -1;
    case 'PageDown':
      return 10;
    case 'PageUp':
      return -10;
    default:
      return 0;
  }
}

export interface CountInput {
  /** Nothing loaded yet. */
  initial: boolean;
  /** A new filter is being typed or loads. */
  busy: boolean;
  /** The list failed. */
  failed: boolean;
  count: number;
  /** Another page exists. */
  more: boolean;
}

/** The toolbar count: "Loading…", "Searching…", "50+ sessions", "1 plan"; '' when the list failed. */
export function countText(input: CountInput, singular: string, plural: string): string {
  if (input.failed) return '';
  if (input.initial) return 'Loading…';
  if (input.busy) return 'Searching…';
  return `${input.count}${input.more ? '+' : ''} ${input.count === 1 ? singular : plural}`;
}

/** Load more: `incoming` appended to `existing`, rows whose key is already listed left out (the list shifted). */
export function mergeByKey<T extends { key: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set(existing.map((item) => item.key));
  const out = [...existing];
  for (const item of incoming) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------- the import form

export interface ImportPathState {
  /** What the import writes (`newFilePath`: trimmed, leading `/` dropped, `.md` added). */
  path: string;
  /** Shown under the field; null when fine or still blank. */
  problem: string | null;
  ok: boolean;
}

/** The Path field: the Add file rules (`newFilePath` + `newFilePathProblem`); blank is not ok but shows no error. */
export function importPathState(raw: string): ImportPathState {
  const path = newFilePath(raw);
  const problem = newFilePathProblem(path);
  return { path, problem, ok: path !== '' && !path.endsWith('/') && problem === null };
}

/** The Title field: required, at most TITLE_MAX characters. */
export function importTitleProblem(title: string): string | null {
  const value = title.trim();
  if (value === '') return 'Required';
  if (value.length > TITLE_MAX) return `${TITLE_MAX} characters max`;
  return null;
}

/** The `title` of the import body: only when it differs from the agent's own title (the server's default). */
export function titleOverride(draft: string, original: string): string | undefined {
  const value = draft.trim();
  return value === '' || value === original.trim() ? undefined : value;
}

/** The line under the form for a failed import: 409 says to pick another path; issues as `path: message`. */
export function importFailureText(res: ApiFailure, path: string): string {
  if (res.status === 409) return `${path} already exists in this bundle. Pick another path.`;
  if (res.issues !== undefined && res.issues.length > 0) {
    return res.issues
      .map((i) => (i.path === '' ? i.message : `${i.path}: ${i.message}`))
      .join('; ');
  }
  if (res.status === 0) return `Could not reach ctxman: ${res.message}`;
  return res.message;
}

// ---------------------------------------------------------------- the meta line above the preview

export interface MetaItem {
  /** Stable id: `data-meta` of the item (tests). */
  id: string;
  label: string;
  value: string;
  /** Mono value (paths, ids, branches). */
  mono?: boolean;
  /** Tooltip, e.g. the full value. */
  title?: string;
}

/** Agent, directory, branch, model, started and prompts (once the detail is loaded) of a session. */
export function sessionMeta(summary: AgentSessionSummary, prompts?: number): MetaItem[] {
  const items: MetaItem[] = [
    { id: 'agent', label: 'Agent', value: agentSourceText(summary.agent, summary.source) },
  ];
  if (summary.cwd !== undefined && summary.cwd !== '') {
    items.push({ id: 'cwd', label: 'Dir', value: summary.cwd, mono: true, title: summary.cwd });
  }
  if (summary.gitBranch !== undefined && summary.gitBranch !== '') {
    items.push({ id: 'branch', label: 'Branch', value: summary.gitBranch, mono: true });
  }
  if (summary.model !== undefined && summary.model !== '') {
    items.push({ id: 'model', label: 'Model', value: summary.model, mono: true });
  }
  const started = summary.startedAt ?? summary.modifiedAt;
  items.push({
    id: 'started',
    label: summary.startedAt === undefined ? 'Modified' : 'Started',
    value: absoluteTime(started),
    title: started,
  });
  if (prompts !== undefined)
    items.push({ id: 'prompts', label: 'Prompts', value: String(prompts) });
  return items;
}

/** Agent, file, directory, thread and modified of a plan. */
export function planMeta(summary: AgentPlanSummary): MetaItem[] {
  const items: MetaItem[] = [
    { id: 'agent', label: 'Agent', value: agentSourceText(summary.agent, summary.source) },
    { id: 'path', label: 'File', value: summary.path, mono: true, title: summary.path },
  ];
  if (summary.cwd !== undefined && summary.cwd !== '') {
    items.push({ id: 'cwd', label: 'Dir', value: summary.cwd, mono: true, title: summary.cwd });
  }
  if (summary.thread !== undefined && summary.thread !== '') {
    items.push({ id: 'thread', label: 'Thread', value: summary.thread, title: summary.thread });
  }
  items.push({
    id: 'modified',
    label: 'Modified',
    value: absoluteTime(summary.modifiedAt),
    title: summary.modifiedAt,
  });
  return items;
}
