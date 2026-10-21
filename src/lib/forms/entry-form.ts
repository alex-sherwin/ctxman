// PURE (no fs, no astro:*; browser-safe): the rules of the NewEntryForm (ROUND3_SPEC §E.7): which datasets it
// serves, the draft shape, the client-side validation, the `POST /api/entry/<ds>` body and how a failed
// response maps back to fields. The server (src/lib/entry-io.ts `createEntry`) stays the authority; this only
// gives the same answers before the request is sent.
import {
  datasetDef,
  ISSUE_KEY_EXPECTED,
  ISSUE_KEY_PATTERN,
  isOkfDatasetId,
} from '../../datasets/registry.ts';
import type { OkfDatasetId } from '../../datasets/registry.ts';
import { nameProblem } from '../names.ts';

/** Datasets with the entry create form (the yaml ones keep DataForm, see `forms/fields.ts`). */
export type NewEntryDataset = OkfDatasetId | 'skill';

export function isNewEntryDataset(value: unknown): value is NewEntryDataset {
  return value === 'skill' || isOkfDatasetId(value);
}

export interface NewEntryDraft {
  name: string;
  title: string;
  description: string;
  /** Lifecycle datasets only; '' otherwise. */
  state: string;
  /** okf only: the issue tracker key; '' = none. */
  issueKey: string;
  tags: string[];
  /** A project slug, or null = none. */
  parent: string | null;
}

/** Field ids of the form; server issues are keyed by these (`tags.0` -> `tags`). */
export type NewEntryField = keyof NewEntryDraft;

/** API limits (ROUND3_SPEC §D.1/D.2): `title` one line <= 200, `description` one line <= 1024. */
export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 1024;

/** Key of "no project" in the parent Select. */
export const NO_PARENT = 'none';

/** Key under which a problem that belongs to no single field is reported. */
export const FORM_ERROR_KEY = '_';

/** The blank draft of a dataset: first lifecycle state, `parent` prefilled (`?parent=`). */
export function blankDraft(dataset: NewEntryDataset, parent: string | null): NewEntryDraft {
  return {
    name: '',
    title: '',
    description: '',
    state: datasetDef(dataset).states?.[0]?.id ?? '',
    issueKey: '',
    tags: [],
    parent,
  };
}

export interface DraftContext {
  /** Slugs that already exist in the dataset (invalid entries included). */
  existing: ReadonlySet<string>;
  /** Slugs of the known projects; null while the list is not loaded (a prefilled parent is not judged then). */
  projects: ReadonlySet<string> | null;
}

/** Validation errors by field id (one message each), unfiltered. */
export function validateDraft(
  dataset: NewEntryDataset,
  draft: NewEntryDraft,
  context: DraftContext,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const nameIssue = nameProblem(draft.name, context.existing, datasetDef(dataset).singular);
  if (nameIssue !== null) errors.name = nameIssue;
  if (draft.title.trim().length > TITLE_MAX) errors.title = `${TITLE_MAX} characters max`;
  const description = draft.description.trim();
  if (description === '') errors.description = 'Required';
  else if (description.length > DESCRIPTION_MAX) {
    errors.description = `${DESCRIPTION_MAX} characters max`;
  }
  const issueKey = draft.issueKey.trim();
  if (dataset !== 'skill' && issueKey !== '' && !ISSUE_KEY_PATTERN.test(issueKey)) {
    errors.issueKey = `Use ${ISSUE_KEY_EXPECTED}`;
  }
  if (draft.parent !== null && context.projects !== null && !context.projects.has(draft.parent)) {
    errors.parent = `Project "${draft.parent}" does not exist`;
  }
  return errors;
}

/** The request body for `POST /api/entry/<ds>`: only what applies to the dataset and is not blank. */
export function buildBody(dataset: NewEntryDataset, draft: NewEntryDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name,
    description: draft.description.trim(),
  };
  if (dataset !== 'skill') {
    if (draft.title.trim() !== '') body.title = draft.title.trim();
    if (draft.tags.length > 0) body.tags = draft.tags;
    if (draft.issueKey.trim() !== '') body.issueKey = draft.issueKey.trim();
  }
  if (datasetDef(dataset).states !== undefined && draft.state !== '') body.state = draft.state;
  if (draft.parent !== null) body.parent = draft.parent;
  return body;
}

/** The part of a failed API result this module reads (`ApiResult` of ui/edit/api.ts fits). */
export interface FailedCreate {
  status: number;
  message: string;
  issues?: readonly { path: string; message: string }[];
}

/** Field errors of a failed create: 409 = the name, 400 issues by their first path segment. */
export function failureErrors(res: FailedCreate, singular: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (res.status === 409) errors.name = `A ${singular} with this name already exists`;
  for (const issue of res.issues ?? []) {
    const key = issue.path.split('.')[0] ?? '';
    const field = key === '' ? FORM_ERROR_KEY : key;
    if (errors[field] === undefined) errors[field] = issue.message;
  }
  return errors;
}

/** The status line of a failed create: the name error of a 409, the server's text when no field is named. */
export function failureMessage(res: FailedCreate, errors: Record<string, string>): string {
  const fields = Object.keys(errors);
  if (res.status === 409 && errors.name !== undefined) return errors.name;
  if (fields.length === 0 || res.status === 0 || res.status >= 500) return res.message;
  const formLevel = errors[FORM_ERROR_KEY];
  if (fields.length === 1 && formLevel !== undefined) return formLevel;
  return 'Fix the highlighted fields';
}
