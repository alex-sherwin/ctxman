// PURE (no DOM, no fetch; browser-safe): the logic behind the EntryTools dialogs (ROUND3_SPEC §E.5): the
// frontmatter form (draft <-> API shape, changed keys only, local checks, mapping server issues onto fields),
// date arithmetic for `stale_after`, context link lists, the Add file path/title rules and the
// data-attribute contract between the SSR buttons and the island. Unit-tested in tests/unit/entry-tools-helpers.test.ts.
import { isLinkableDatasetId, isValidName } from '../../datasets/registry.ts';
import type { LinkableDatasetId } from '../../datasets/registry.ts';
import type { OkfStatus } from '../../lib/entry-summary.ts';
import { isIsoDateTime } from '../../lib/iso8601.ts';
import { todayYmd } from '../../lib/time.ts';
import { titleFromName } from '../../lib/templates.ts';
import type { ApiIssue } from '../edit/api.ts';

// ---------------------------------------------------------------- limits (mirror src/lib/entry-io.ts)

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 1024;

/** The okf `status` values; '' = none. */
export const OKF_STATUS_VALUES: readonly OkfStatus[] = ['draft', 'stable', 'deprecated'];

// ---------------------------------------------------------------- dates

/** `YYYY-MM-DD` that is a real calendar date (2027-02-30 is not). */
export function isRealYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `ymd` + `days` calendar days (UTC arithmetic, no DST drift). `ymd` must be a real date. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The local calendar day of `nowMs` plus `days` (the "+30 d" / "+90 d" buttons). */
export function daysFromToday(nowMs: number, days: number): string {
  return addDaysYmd(todayYmd(nowMs), days);
}

/** The message under the `stale_after` input, or null when it is empty (= none) or a real date. */
export function staleAfterProblem(value: string): string | null {
  const v = value.trim();
  if (v === '' || isRealYmd(v)) return null;
  return 'Use a real date as YYYY-MM-DD';
}

/** The message under the `resolved` input, or null when it is empty (= not resolved) or an ISO 8601 date / date-time. */
export function resolvedProblem(value: string): string | null {
  const v = value.trim();
  if (v === '' || isIsoDateTime(v)) return null;
  return 'Use an ISO 8601 date or date-time, e.g. 2026-10-19 or 2026-10-19T14:30';
}

// ---------------------------------------------------------------- frontmatter draft

/** The editable frontmatter keys as form strings ('' = not set). */
export interface FrontmatterDraft {
  title: string;
  description: string;
  tags: string[];
  state: string;
  /** task, feature, bug, rca: ISO 8601 durations. */
  time: string[];
  /** task, feature, bug, rca: an ISO 8601 date / date-time. */
  resolved: string;
  staleAfter: string;
  status: string;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The form's initial values from the JSON-safe frontmatter `GET /api/entry/<ds>/<slug>` returns. */
export function draftFromFrontmatter(fm: Readonly<Record<string, unknown>>): FrontmatterDraft {
  return {
    title: str(fm.title),
    description: str(fm.description),
    tags: strings(fm.tags),
    state: str(fm.state),
    time: strings(fm.time),
    resolved: str(fm.resolved),
    staleAfter: str(fm.stale_after),
    status: str(fm.status),
  };
}

/** The keys of `PATCH /api/entry/<ds>/<slug>` the Details dialog sends. */
export interface FrontmatterPatch {
  state?: string;
  title?: string | null;
  description?: string;
  tags?: string[];
  time?: string[] | null;
  resolved?: string | null;
  stale_after?: string | null;
  status?: OkfStatus | null;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Only the keys whose value changed (compared trimmed), in API shape: an emptied `title` / `time` / `resolved` /
 * `stale_after` / `status` is `null` (= delete the key). A skill edits its description only; `state` is sent only for
 * datasets with a lifecycle (`hasState`). `time` and `resolved` only change where the dialog shows them (time-tracked
 * datasets), so other datasets never send them.
 */
export function frontmatterPatch(
  kind: 'okf' | 'skill',
  hasState: boolean,
  base: FrontmatterDraft,
  draft: FrontmatterDraft,
): FrontmatterPatch {
  const patch: FrontmatterPatch = {};
  if (draft.description.trim() !== base.description.trim()) {
    patch.description = draft.description.trim();
  }
  if (kind === 'skill') return patch;
  if (draft.title.trim() !== base.title.trim()) {
    patch.title = draft.title.trim() === '' ? null : draft.title.trim();
  }
  if (!sameList(draft.tags, base.tags)) patch.tags = [...draft.tags];
  if (hasState && draft.state !== base.state && draft.state !== '') patch.state = draft.state;
  if (!sameList(draft.time, base.time))
    patch.time = draft.time.length === 0 ? null : [...draft.time];
  if (draft.resolved.trim() !== base.resolved.trim()) {
    patch.resolved = draft.resolved.trim() === '' ? null : draft.resolved.trim();
  }
  if (draft.staleAfter.trim() !== base.staleAfter.trim()) {
    patch.stale_after = draft.staleAfter.trim() === '' ? null : draft.staleAfter.trim();
  }
  if (draft.status !== base.status) {
    patch.status =
      draft.status === '' ? null : (OKF_STATUS_VALUES.find((s) => s === draft.status) ?? null);
  }
  return patch;
}

export type FrontmatterField =
  | 'title'
  | 'description'
  | 'tags'
  | 'state'
  | 'time'
  | 'resolved'
  | 'stale_after'
  | 'status';
export type FieldErrors = Partial<Record<FrontmatterField, string>>;

const FIELDS: readonly FrontmatterField[] = [
  'title',
  'description',
  'tags',
  'state',
  'time',
  'resolved',
  'stale_after',
  'status',
];

/** Checks the browser can do before sending (the server repeats them). */
export function draftProblems(kind: 'okf' | 'skill', draft: FrontmatterDraft): FieldErrors {
  const errors: FieldErrors = {};
  const description = draft.description.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (description === '') errors.description = 'Required';
  else if (description.length > DESCRIPTION_MAX) {
    errors.description = `${DESCRIPTION_MAX} characters max`;
  }
  if (kind === 'okf') {
    if (draft.title.trim().length > TITLE_MAX) errors.title = `${TITLE_MAX} characters max`;
    const stale = staleAfterProblem(draft.staleAfter);
    if (stale !== null) errors.stale_after = stale;
    const resolved = resolvedProblem(draft.resolved);
    if (resolved !== null) errors.resolved = resolved;
  }
  return errors;
}

/**
 * Server issues (`400 invalid`, paths are body keys: `stale_after`, `tags.2`, `links.0.slug`) put onto the form
 * fields; whatever has no field (an unknown path, a general problem) comes back in `other` as text.
 */
export function issuesToFields(issues: readonly ApiIssue[]): {
  fields: FieldErrors;
  other: string[];
} {
  const fields: FieldErrors = {};
  const other: string[] = [];
  for (const issue of issues) {
    const head = issue.path.split('.')[0] ?? '';
    const field = FIELDS.find((f) => f === head);
    if (field !== undefined) {
      fields[field] =
        fields[field] === undefined ? issue.message : `${fields[field]}; ${issue.message}`;
    } else {
      other.push(issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`);
    }
  }
  return { fields, other };
}

// ---------------------------------------------------------------- 'ds/slug' keys

export interface LinkTarget {
  dataset: LinkableDatasetId;
  slug: string;
}

/** `'task/fix-login'` -> `{dataset, slug}`; null when the dataset is not linkable or the name is invalid. */
export function splitKey(key: string): LinkTarget | null {
  const at = key.indexOf('/');
  if (at < 0) return null;
  const dataset = key.slice(0, at);
  const slug = key.slice(at + 1);
  return isLinkableDatasetId(dataset) && isValidName(slug) ? { dataset, slug } : null;
}

/** The links a new / extended context gets: `self` first, then the chosen keys in order, no duplicates, invalid keys dropped. */
export function buildContextLinks(self: LinkTarget, keys: readonly string[]): LinkTarget[] {
  const out: LinkTarget[] = [self];
  const seen = new Set([`${self.dataset}/${self.slug}`]);
  for (const key of keys) {
    const target = splitKey(key);
    if (target === null || seen.has(key)) continue;
    seen.add(key);
    out.push(target);
  }
  return out;
}

// ---------------------------------------------------------------- Add file

export const DEFAULT_CONCEPT_TYPE = 'Concept';

/** Longest path the bundle file routes accept (bundles.ts). */
const FILE_PATH_MAX = 512;

/**
 * What the Add file dialog creates for the typed path: trimmed, a leading `/` or `./` dropped (a bundle-root link
 * style), `.md` added when missing (`references/abc` -> `references/abc.md`); a path ending in `/` (no file name yet)
 * stays as typed; '' for blank input. Check it with `newFilePathProblem`.
 */
export function newFilePath(raw: string): string {
  const path = raw.trim().replace(/^(?:\.?\/)+/, '');
  if (path === '' || path.endsWith('/')) return path;
  if (/\.md$/i.test(path)) return path.replace(/\.md$/i, '.md');
  return `${path}.md`;
}

/**
 * Why `path` (a `newFilePath` result) cannot be created, or null: folders and a file name inside the bundle, none
 * empty, `.` / `..` or dot-prefixed, no characters Windows refuses, and not a reserved `index.md` / `log.md`.
 */
export function newFilePathProblem(path: string): string | null {
  if (path === '') return null;
  const segments = path.split('/');
  if (segments.at(-1) === '') return 'Add a file name after the last /';
  if (segments.includes('')) return 'A folder name is empty (//)';
  if (segments.some((s) => s === '.' || s === '..'))
    return 'No . or .. folders: the file stays in the bundle';
  if (segments.some((s) => s.startsWith('.'))) return 'Names cannot start with a dot';
  if (/[\\:*?"<>|]/.test(path) || [...path].some((c) => c.charCodeAt(0) < 32)) {
    return 'These are not allowed: \\ : * ? " < > | and control characters';
  }
  if (path.length > FILE_PATH_MAX) return `At most ${FILE_PATH_MAX} characters`;
  const base = segments.at(-1);
  if (base === 'index.md' || base === 'log.md') {
    return `${base} is reserved (the entry, folder navigation and the update log)`;
  }
  return null;
}

/** The title a new file gets by default: the file name without folders / `.md`, "Fix login bug" style. */
export function conceptTitleFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  return titleFromName(base.replace(/\.md$/i, ''));
}

export interface ConceptBody {
  title: string;
  type?: string;
  description?: string;
}

/** The POST body: blank `type` / `description` are left out (the server defaults the type to `Concept`). */
export function conceptBody(input: {
  title: string;
  type: string;
  description: string;
}): ConceptBody {
  const body: ConceptBody = { title: input.title.trim() };
  if (input.type.trim() !== '') body.type = input.type.trim();
  if (input.description.trim() !== '') body.description = input.description.trim();
  return body;
}

// ---------------------------------------------------------------- SSR buttons -> dialogs

/** The `data-entry-action` values the island handles (the buttons are rendered by the pages, disabled). */
export const ENTRY_ACTIONS = [
  'frontmatter',
  'add-relation',
  'add-child',
  'remove-relation',
  'remove-child',
  'add-to-context',
  'build-context',
  'add-file',
] as const;
export type EntryAction = (typeof ENTRY_ACTIONS)[number];

export function isEntryAction(value: unknown): value is EntryAction {
  return typeof value === 'string' && (ENTRY_ACTIONS as readonly string[]).includes(value);
}

/** Which dialog is open (ephemeral UI state, not URL state). */
export type EntryDialog =
  | { type: 'frontmatter' }
  | { type: 'relation'; mode: 'relation' | 'child' }
  | { type: 'remove'; key: string; rel: string; title: string }
  | { type: 'add-to-context' }
  | { type: 'build-context' }
  | { type: 'add-file'; path?: string };

/** What the island reads from a clicked button: `data-entry-action` plus its `data-key`, `data-rel`, `data-path`, `data-title`. */
export interface ActionTrigger {
  action: string | undefined;
  key?: string | undefined;
  rel?: string | undefined;
  path?: string | undefined;
  /** The title of the row the button belongs to (`data-title`, or the row's link text). */
  title?: string | undefined;
}

/** The dialog a button opens; null for an unknown action or a remove button without a valid key. */
export function dialogFor(trigger: ActionTrigger): EntryDialog | null {
  const { action } = trigger;
  if (!isEntryAction(action)) return null;
  switch (action) {
    case 'frontmatter':
      return { type: 'frontmatter' };
    case 'add-relation':
      return { type: 'relation', mode: 'relation' };
    case 'add-child':
      return { type: 'relation', mode: 'child' };
    case 'remove-relation':
    case 'remove-child': {
      const key = trigger.key ?? '';
      if (splitKey(key) === null) return null;
      const title = trigger.title?.trim();
      return {
        type: 'remove',
        key,
        rel: action === 'remove-child' ? 'child' : (trigger.rel ?? ''),
        title: title === undefined || title === '' ? key : title,
      };
    }
    case 'add-to-context':
      return { type: 'add-to-context' };
    case 'build-context':
      return { type: 'build-context' };
    case 'add-file': {
      const path = trigger.path?.trim();
      return path === undefined || path === '' ? { type: 'add-file' } : { type: 'add-file', path };
    }
  }
}
