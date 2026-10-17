// PURE shared shapes + builders (UI_SPEC §0.5, PLAN §E.15). Islands import ONLY the types
// (`import type`); `summarize` runs in SSR (src/lib/entries.ts) and scripts/tests.
import { datasetDef, entryUrl, isReferenceType } from '../datasets/registry.ts';
import type { DatasetId, ReferenceType } from '../datasets/registry.ts';
import type { ContextInput, ContextLink } from '../datasets/schemas.ts';
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
  /** reference only. */
  refType?: ReferenceType;
  /** reference remote-skill only, derived from `uri`: 'git' repo or https 'archive'. */
  uriKind?: RemoteUriKind;
  /** context only. */
  linkCount?: number;
  /** '/kb/foo' */
  url: string;
}

/** One searchable document: one per markdown file in an okf bundle, plus skills, references, contexts. */
export interface SearchDoc {
  /** 'kb/foo' | 'kb/foo/concepts/x' | 'reference/bar' */
  id: string;
  dataset: DatasetId;
  slug: string;
  /** Bundle-relative file e.g. 'concepts/x.md'; null for the entry itself (main.md / SKILL.md / yaml). */
  path: string | null;
  title: string;
  name: string;
  description: string;
  tags: string[];
  headings: string[];
  body: string;
  state?: string;
  /** '/kb/foo' or '/kb/foo/doc/concepts/x' */
  url: string;
}

/**
 * Context API payload (POST/PUT body): same as the zod input of `contextSchema` but with `links`
 * required, exactly as UI_SPEC §0.5 declares it. Assignable to `ContextInput`.
 */
export type ContextDoc = Omit<ContextInput, 'links'> & { links: ContextLink[] };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
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
  }

  if (dataset === 'reference' && isReferenceType(data.type)) {
    summary.refType = data.type;
    if (data.type === 'remote-skill' && typeof data.uri === 'string') {
      const uriKind = classifyRemoteUri(data.uri);
      if (uriKind !== null) summary.uriKind = uriKind;
    }
  }
  if (dataset === 'context') summary.linkCount = Array.isArray(data.links) ? data.links.length : 0;

  return summary;
}
