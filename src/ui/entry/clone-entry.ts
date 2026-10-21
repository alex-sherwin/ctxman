// PURE (no DOM, no fetch; browser-safe): the logic behind the Clone… dialog of the detail menu
// (src/ui/menus/CloneEntryDialog.tsx): the form draft from the original's frontmatter (the name and title suggestions
// are `suggestCloneName` / `cloneTitle` of src/lib/names.ts, shared with the server), local checks, the POST body of `/api/entry/<ds>/<slug>/clone` and the server issues on their fields. The browser
// half of src/lib/entry-clone.ts; unit-tested in tests/unit/clone-entry.test.ts.
import { datasetDef, isOkfDatasetId, isTimeTrackedDatasetId } from '../../datasets/registry.ts';
import type { OkfDatasetId } from '../../datasets/registry.ts';
import { formatSeconds, totalDurationSeconds } from '../../lib/iso8601.ts';
import { cloneTitle, nameProblem } from '../../lib/names.ts';
import { titleFromName } from '../../lib/templates.ts';
import type { ApiIssue } from '../edit/api.ts';
import { DESCRIPTION_MAX, issueKeyProblem, TITLE_MAX } from './entry-helpers.ts';

/** Whether an entry menu offers "Clone…": okf bundles, in the detail header only (never in a list row). */
export function canClone(target: { dataset: string; context: 'row' | 'detail' }): boolean {
  return target.context === 'detail' && isOkfDatasetId(target.dataset);
}

/** The form of the dialog ('' = not set). */
export interface CloneDraft {
  /** null = untouched: the suggestion is shown (and follows the entries list as it loads). */
  name: string | null;
  title: string;
  description: string;
  state: string;
  tags: string[];
  issueKey: string;
  links: boolean;
  children: boolean;
  time: boolean;
}

/** What the original has that the checkboxes copy (shown next to them). */
export interface CloneSource {
  /** related and depends-on links */
  relations: number;
  /** child links */
  children: number;
  /** "2h 30m" when time is logged ("3 durations" when one has no fixed length), '' when none */
  timeTotal: string;
  /** the `resolved` value as written, '' when none */
  resolved: string;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The links the original's frontmatter carries, by kind (an item without `rel` is `related`). */
export function cloneSource(fm: Readonly<Record<string, unknown>>): CloneSource {
  const links = Array.isArray(fm.links) ? fm.links : [];
  const children = links.filter(
    (link) =>
      typeof link === 'object' && link !== null && (link as { rel?: unknown }).rel === 'child',
  ).length;
  const time = strings(fm.time);
  const seconds = totalDurationSeconds(time);
  return {
    relations: links.length - children,
    children,
    timeTotal:
      time.length === 0
        ? ''
        : seconds === null
          ? `${time.length} ${time.length === 1 ? 'duration' : 'durations'}`
          : formatSeconds(seconds),
    resolved: str(fm.resolved),
  };
}

/**
 * The dialog's initial values: the name untouched (suggested), "<title> (copy)", the original's description and tags,
 * the dataset's DEFAULT state (not the original's), no issue key (an issue belongs to one entry); relations on, child
 * links and logged time off.
 */
export function cloneDraft(
  dataset: OkfDatasetId,
  slug: string,
  fm: Readonly<Record<string, unknown>>,
): CloneDraft {
  return {
    name: null,
    // the same default as the server's for an omitted title
    title: cloneTitle(str(fm.title).trim() || titleFromName(slug)),
    description: str(fm.description),
    state: datasetDef(dataset).states?.[0]?.id ?? '',
    tags: strings(fm.tags),
    issueKey: '',
    links: true,
    children: false,
    time: false,
  };
}

/** The name the dialog submits: the typed one, else the suggestion. */
export function cloneName(draft: CloneDraft, suggestion: string): string {
  return draft.name ?? suggestion;
}

export type CloneField = 'name' | 'title' | 'description' | 'state' | 'tags' | 'issueKey';
export type CloneErrors = Partial<Record<CloneField, string>>;

const FIELDS: readonly CloneField[] = ['name', 'title', 'description', 'state', 'tags', 'issueKey'];

/** The checks the browser can make before sending (the server repeats them; a taken name comes back as a 409). */
export function cloneProblems(
  dataset: OkfDatasetId,
  name: string,
  draft: CloneDraft,
  existing: ReadonlySet<string>,
): CloneErrors {
  const errors: CloneErrors = {};
  const nameError = nameProblem(name, existing, datasetDef(dataset).singular);
  if (nameError !== null) errors.name = nameError;
  const description = draft.description.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (description === '') errors.description = 'Required';
  else if (description.length > DESCRIPTION_MAX) {
    errors.description = `${DESCRIPTION_MAX} characters max`;
  }
  if (draft.title.trim().length > TITLE_MAX) errors.title = `${TITLE_MAX} characters max`;
  const issueKey = issueKeyProblem(draft.issueKey);
  if (issueKey !== null) errors.issueKey = issueKey;
  return errors;
}

/** The POST body of `/api/entry/<ds>/<slug>/clone`. */
export interface CloneBody {
  name: string;
  /** '' = the name in sentence case (an omitted title would mean "<original title> (copy)"). */
  title: string;
  description: string;
  state?: string;
  tags: string[];
  issueKey?: string;
  links: boolean;
  children: boolean;
  time?: boolean;
}

/**
 * The request for `draft`: trimmed text (a blank title is sent as '': the server then uses the name in sentence
 * case), the tags always (the dialog shows the original's), a blank issue key left out (none), `state` only for
 * lifecycle datasets and `time` only for time-tracked ones.
 */
export function cloneBody(dataset: OkfDatasetId, name: string, draft: CloneDraft): CloneBody {
  const body: CloneBody = {
    name,
    title: draft.title.trim(),
    description: draft.description.trim(),
    tags: [...draft.tags],
    links: draft.links,
    children: draft.children,
  };
  if (datasetDef(dataset).states !== undefined && draft.state !== '') body.state = draft.state;
  if (draft.issueKey.trim() !== '') body.issueKey = draft.issueKey.trim();
  if (isTimeTrackedDatasetId(dataset)) body.time = draft.time;
  return body;
}

/**
 * Server issues (`400 invalid`: body keys, or frontmatter keys of the rewritten index.md such as `links.0.slug`) put
 * onto the dialog's fields; what has no field comes back in `other` as text.
 */
export function cloneIssuesToFields(issues: readonly ApiIssue[]): {
  fields: CloneErrors;
  other: string[];
} {
  const fields: CloneErrors = {};
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
