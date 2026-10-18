// Browser-safe (fetch only): typed wrappers over `src/ui/edit/api.ts` for the routes the EntryTools dialogs call
// (ROUND3_SPEC §D). Like `sendJson` / `getJson` they never throw: a failure is `{ ok: false, status, error,
// message, issues? }` (status 0 = network).
import type { EntryRel, LinkableDatasetId } from '../../datasets/registry.ts';
import { getJson, sendJson } from '../edit/api.ts';
import type { ApiResult } from '../edit/api.ts';
import type { FrontmatterPatch } from './entry-helpers.ts';

const seg = encodeURIComponent;

// ---------------------------------------------------------------- /api/entry/<ds>/<slug>

export interface EntryRead {
  /** JSON-safe frontmatter exactly as on disk (a date is `YYYY-MM-DD`). */
  frontmatter: Record<string, unknown>;
  /** ISO mtime of main.md / SKILL.md: the `ifUnmodifiedSince` base. */
  lastModified: string;
  issues: { path: string; message: string }[];
}

export interface EntryWritten {
  frontmatter: Record<string, unknown>;
  lastModified: string;
  /** False when the patch changed nothing (no write happened). */
  changed: boolean;
  warnings: unknown[];
}

export interface EntryLinkBody {
  dataset: LinkableDatasetId;
  slug: string;
  rel: EntryRel;
}

export interface EntryPatchBody extends FrontmatterPatch {
  addLinks?: EntryLinkBody[];
  removeLinks?: { dataset: LinkableDatasetId; slug: string }[];
  ifUnmodifiedSince?: string;
}

export const entryApiUrl = (dataset: string, slug: string): string =>
  `/api/entry/${seg(dataset)}/${seg(slug)}`;

/** `GET /api/entry/<ds>/<slug>`. */
export function getEntry(dataset: string, slug: string): Promise<ApiResult<EntryRead>> {
  return getJson<EntryRead>(entryApiUrl(dataset, slug));
}

/** `PATCH /api/entry/<ds>/<slug>`: edits only the given keys. 409 = `ifUnmodifiedSince` is stale. */
export function patchEntry(
  dataset: string,
  slug: string,
  body: EntryPatchBody,
): Promise<ApiResult<EntryWritten>> {
  return sendJson<EntryWritten>('PATCH', entryApiUrl(dataset, slug), body);
}

// ---------------------------------------------------------------- contexts

export interface ContextLinkBody {
  dataset: LinkableDatasetId;
  slug: string;
  notes?: string;
}

export interface ContextAppended {
  added: string[];
  skipped: string[];
  lastModified: string;
}

/** `POST /api/context/<slug>/links`: appends the links that are not there yet. */
export function appendContextLinks(
  slug: string,
  links: ContextLinkBody[],
): Promise<ApiResult<ContextAppended>> {
  return sendJson<ContextAppended>('POST', `/api/context/${seg(slug)}/links`, { links });
}

export interface ContextCreateBody {
  name: string;
  description: string;
  links: ContextLinkBody[];
}

/** `POST /api/context`: a new context with its links (201). 409 `exists` when the name is taken. */
export function createContextWithLinks(
  body: ContextCreateBody,
): Promise<ApiResult<{ lastModified: string }>> {
  return sendJson<{ lastModified: string }>('POST', '/api/context', { ...body, tags: [] });
}

// ---------------------------------------------------------------- concepts

export interface ConceptCreated {
  path: string;
  /** The page of the new file: `/kb/foo/doc/concepts/x`. */
  url: string;
  lastModified: string;
  warnings: unknown[];
}

/** `/api/doc/<ds>/<slug>/<path>` with each path segment URI-encoded. */
export const docApiUrl = (dataset: string, slug: string, path: string): string =>
  `/api/doc/${seg(dataset)}/${seg(slug)}/${path.split('/').map(seg).join('/')}`;

/** `POST /api/doc/<ds>/<slug>/<path>`: creates a concept file and lists it in index.md / log.md. 409 `exists`. */
export function createConcept(
  dataset: string,
  slug: string,
  path: string,
  body: { title: string; type?: string; description?: string },
): Promise<ApiResult<ConceptCreated>> {
  return sendJson<ConceptCreated>('POST', docApiUrl(dataset, slug, path), body);
}
