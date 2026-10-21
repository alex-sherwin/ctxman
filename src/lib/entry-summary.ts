// PURE shared shapes + builders (UI_SPEC §0.5, PLAN §E.15). Islands import ONLY the types
// (`import type`); `summarize` runs in SSR (src/lib/entries.ts) and scripts/tests.
import {
  datasetDef,
  entryUrl,
  isFolderReferenceType,
  isReferenceType,
  OWNERS,
  REFERENCE_FOLDER_PATTERN,
  ISSUE_KEY_PATTERN,
} from '../datasets/registry.ts';
import type { DatasetId, Owner, ReferenceType } from '../datasets/registry.ts';
import { entryLinkSchema } from '../datasets/schemas.ts';
import type { ContextInput, ContextLink, EntryLink } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import type { Issue } from './context-io.ts';
import { isInflateTarget } from './inflate/catalog.ts';
import type { InflateTarget } from './inflate/catalog.ts';
import { classifyRemoteUri } from './remote-uri.ts';
import type { RemoteUriKind } from './remote-uri.ts';
import { isStale, toYmd } from './time.ts';

export type OkfStatus = 'draft' | 'stable' | 'deprecated';
const OKF_STATUS_VALUES: readonly string[] = ['draft', 'stable', 'deprecated'];

/** One row per entry (all datasets). `GET /api/entries?dataset=<id>` → `{ entries: EntrySummary[] }`. */
export interface EntrySummary {
  dataset: DatasetId;
  slug: string;
  name: string;
  title?: string;
  description: string;
  tags: string[];
  /** Lifecycle datasets only. */
  state?: string;
  /** ISO. ALL datasets: okf = max mtime in bundle; skill = max mtime in dir; yaml = file mtime. */
  lastModified: string;
  /** OKF `stale_after`, `YYYY-MM-DD`. */
  staleAfter?: string;
  /** today (local) >= staleAfter. */
  stale: boolean;
  okfStatus?: OkfStatus;
  /** okf only: the issue tracker key (`issueKey`), when it is a valid one. */
  issueKey?: string;
  /** reference only. */
  refType?: ReferenceType;
  /** reference remote-skill only, derived from `uri`: 'git' repo or https 'archive'. */
  uriKind?: RemoteUriKind;
  /** reference only: `me` | `not-me` (omitted when absent or not a valid owner). */
  owner?: Owner;
  /** reference only: the `subpath`, trimmed and without leading / trailing slashes (omitted when empty). */
  subpath?: string;
  /** reference local-repo, local-folder, remote-repo only: a valid `folder` (Inflate's folder name instead of the slug). */
  folder?: string;
  /** context only. */
  linkCount?: number;
  /** recipe only (from `data.target`). */
  recipeTarget?: InflateTarget;
  /** recipe only: number of contexts. */
  contextCount?: number;
  /** recipe only: number of ad hoc items. */
  itemCount?: number;
  /** '/kb/foo' */
  url: string;
  /**
   * okf + skill: the entry file fails its dataset schema (or has unparseable YAML / a wrong `name`). Present only
   * then; the entry is still listed, with the file as it is on disk. Set by `entries.ts` from the entry index.
   */
  invalid?: Issue[];
  /**
   * okf only: the structured relations of the entry (`links` in the entry index.md frontmatter, `rel` filled in), file order.
   * Present only when there is at least one valid item (malformed items are skipped).
   */
  relations?: EntryLink[];
}

/** One searchable document: one per markdown file in an okf bundle, plus skills, references, contexts. */
export interface SearchDoc {
  /** 'kb/foo' | 'kb/foo/concepts/x' | 'reference/bar' */
  id: string;
  dataset: DatasetId;
  slug: string;
  /** Bundle-relative file e.g. 'concepts/x.md'; null for the entry itself (index.md / SKILL.md / yaml). */
  path: string | null;
  title: string;
  name: string;
  description: string;
  tags: string[];
  headings: string[];
  body: string;
  state?: string;
  /** okf entries (not sub-docs) only: the issue tracker key, searchable on its own. */
  issueKey?: string;
  /** '/kb/foo' or '/kb/foo/doc/concepts/x' */
  url: string;
}

/**
 * Context API payload (POST/PUT body): same as the input type of `contextSchema` but with `links`
 * required, exactly as UI_SPEC §0.5 declares it. Assignable to `ContextInput`.
 */
export type ContextDoc = Omit<ContextInput, 'links'> & { links: ContextLink[] };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The items of `data.links` that parse as an entry relation, one by one (bad items are skipped), file order. */
function relationsOf(links: unknown): EntryLink[] {
  if (!Array.isArray(links)) return [];
  const out: EntryLink[] = [];
  for (const item of links) {
    const parsed = validate(entryLinkSchema, item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Build an EntrySummary from an entry's validated frontmatter / yaml data.
 * `data` is whatever the collection (or `readContext`) produced; unknown shapes degrade gracefully.
 */
export function summarize(
  dataset: DatasetId,
  slug: string,
  data: Record<string, unknown>,
  lastModified: Date,
  nowMs: number,
): EntrySummary {
  const def = datasetDef(dataset);
  const modifiedMs = lastModified.getTime();
  const summary: EntrySummary = {
    dataset,
    slug,
    name: nonEmptyString(data.name) ?? slug,
    description: typeof data.description === 'string' ? data.description : '',
    tags: Array.isArray(data.tags)
      ? data.tags.filter((t): t is string => typeof t === 'string')
      : [],
    lastModified: new Date(Number.isNaN(modifiedMs) ? 0 : modifiedMs).toISOString(),
    stale: false,
    url: entryUrl(dataset, slug),
  };

  const title = nonEmptyString(data.title);
  if (title !== undefined) summary.title = title;

  if (def.states !== undefined) {
    const state = nonEmptyString(data.state);
    if (state !== undefined) summary.state = state;
  }

  if (def.kind === 'okf') {
    const staleAfter = data.stale_after;
    if (staleAfter instanceof Date || typeof staleAfter === 'string') {
      const ymd = toYmd(staleAfter);
      if (ymd !== '') {
        summary.staleAfter = ymd;
        summary.stale = isStale(ymd, nowMs);
      }
    }
    if (typeof data.status === 'string' && OKF_STATUS_VALUES.includes(data.status)) {
      summary.okfStatus = data.status as OkfStatus;
    }
    if (typeof data.issueKey === 'string' && ISSUE_KEY_PATTERN.test(data.issueKey)) {
      summary.issueKey = data.issueKey;
    }
    const relations = relationsOf(data.links);
    if (relations.length > 0) summary.relations = relations;
  }

  if (dataset === 'reference') {
    const owner = data.owner;
    if (typeof owner === 'string' && (OWNERS as readonly string[]).includes(owner)) {
      summary.owner = owner as Owner;
    }
    if (typeof data.subpath === 'string') {
      const subpath = data.subpath.trim().replace(/^\/+|\/+$/g, '');
      if (subpath !== '') summary.subpath = subpath;
    }
  }
  if (dataset === 'reference' && isReferenceType(data.type)) {
    summary.refType = data.type;
    if (
      isFolderReferenceType(data.type) &&
      typeof data.folder === 'string' &&
      REFERENCE_FOLDER_PATTERN.test(data.folder)
    ) {
      summary.folder = data.folder;
    }
    if (data.type === 'remote-skill' && typeof data.uri === 'string') {
      const uriKind = classifyRemoteUri(data.uri);
      if (uriKind !== null) summary.uriKind = uriKind;
    }
  }
  if (dataset === 'context') summary.linkCount = Array.isArray(data.links) ? data.links.length : 0;
  if (dataset === 'recipe') {
    if (isInflateTarget(data.target)) summary.recipeTarget = data.target;
    summary.contextCount = Array.isArray(data.contexts) ? data.contexts.length : 0;
    summary.itemCount = Array.isArray(data.items) ? data.items.length : 0;
  }

  return summary;
}
