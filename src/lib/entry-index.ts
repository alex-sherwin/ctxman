// NODE (fs): the entry index. One scan of every okf `main.md` / skill `SKILL.md` (frontmatter, schema issues,
// structured relations) and of every `.md` body of those directories (`ctxman:` mentions), cached per entry
// directory by the (mtimeMs, size) of its files. relations.ts (PURE) builds the link graph from it; entries.ts
// builds list/detail summaries from it. Spec: plans/ROUND3_SPEC.md §C.
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  datasetDef,
  isLinkableDatasetId,
  isValidName,
  OKF_DATASET_IDS,
} from '../datasets/registry.ts';
import type { LinkableDatasetId, OkfDatasetId } from '../datasets/registry.ts';
import { DATASET_SCHEMAS, entryLinkSchema } from '../datasets/schemas.ts';
import type { EntryLink } from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { walkFiles } from './bundles.ts';
import type { Issue } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { describeIssue, issuePath } from './findings.ts';
import { classifyHref, extractLinks, parseCtxmanHref } from './links.ts';
import { parseFrontmatterLoose, splitFrontmatter } from './okf.ts';

/** Datasets that live in a directory with an entry file: the okf bundles and skills. */
export type IndexedDataset = OkfDatasetId | 'skill';

/** A `ctxman:<dataset>/<slug>` link found in the body of one of an entry's markdown files. */
export interface Mention {
  dataset: LinkableDatasetId;
  slug: string;
  /** Bundle-relative posix path of the file the link is in. */
  file: string;
  /** 1-based line within `file` (frontmatter lines counted). */
  line: number;
}

export interface IndexedEntry {
  dataset: IndexedDataset;
  slug: string;
  /** Data-dir-relative posix path of the entry file: 'task/x/main.md' | 'skill/x/SKILL.md'. */
  file: string;
  /** `parseFrontmatterLoose(...).data` (timestamp tag, like astro); {} when unparseable. */
  data: Record<string, unknown>;
  /** Markdown body of the entry file (after the frontmatter). */
  body: string;
  /**
   * [] = valid. A YAML error gives `[{ path: '', message }]`; otherwise the dataset schema's issues
   * (`path` dotted, message as in the checks) plus `name` when it differs from the directory name.
   */
  issues: Issue[];
  /** okf only: the items of `data.links` that parse with entryLinkSchema one by one (bad items skipped), file order. */
  relations: EntryLink[];
  /**
   * `ctxman:` links in every .md of the directory (frontmatter excluded, code masked, images skipped), targets in
   * LINKABLE_DATASETS, links to the entry itself skipped; main.md first, then the other files in walk order.
   */
  mentions: Mention[];
  /** Newest mtime of any file of the directory (dot names skipped): the same value as `lastModifiedOf(dir)`. */
  lastModified: Date;
  /** ISO mtime of the entry file itself: the `ifUnmodifiedSince` base of PATCH. */
  fileModified: string;
}

export interface EntryIndex {
  /** Registry dataset order (kb … project, skill), then slug. */
  entries: readonly IndexedEntry[];
  /** Keyed 'dataset/slug', e.g. 'task/write-agents-md'. */
  byKey: ReadonlyMap<string, IndexedEntry>;
  /**
   * Entry directories (re)read and parsed by THIS build: every entry on a cold build, 0 when nothing changed,
   * 1 after one file of one entry changed. (Tests assert caching with it.)
   */
  parsed: number;
}

/** A finished build is served again for this long (one page render calls getEntryIndex several times). */
const MEMO_MS = 200;
/** Entry directories scanned at the same time (keeps open file descriptors bounded on big data dirs). */
const SCAN_CONCURRENCY = 32;

const INDEXED_DATASETS: readonly IndexedDataset[] = [...OKF_DATASET_IDS, 'skill'];

interface Memo {
  promise: Promise<EntryIndex>;
  /** Date.now() when the build finished; null while it is running (callers then share the promise). */
  finishedAt: number | null;
}

interface DirState {
  /** Per entry directory (absolute): the signature of its files and the entry built from them. */
  entries: Map<string, { sig: string; entry: IndexedEntry }>;
  memo: Memo | null;
  last: EntryIndex | null;
}

const STATES = new Map<string, DirState>();

function stateFor(dataDir: string): DirState {
  const key = path.resolve(dataDir);
  let state = STATES.get(key);
  if (state === undefined) {
    state = { entries: new Map(), memo: null, last: null };
    STATES.set(key, state);
  }
  return state;
}

/**
 * The entry index of `dataDir` (default: the resolved data dir). Cheap when nothing changed: one directory walk
 * plus one `stat` per file; only entries whose files changed are read again. Results are memoized for 200 ms and
 * concurrent callers share the in-flight build. While no entry changed, `entries` and `byKey` keep their identity
 * from build to build (a consumer may cache derived data on `index.entries`).
 */
export function getEntryIndex(dataDir: string = resolveDataDir()): Promise<EntryIndex> {
  const state = stateFor(dataDir);
  const current = state.memo;
  if (
    current !== null &&
    (current.finishedAt === null || Date.now() - current.finishedAt < MEMO_MS)
  ) {
    return current.promise;
  }
  const memo: Memo = { promise: build(dataDir, state), finishedAt: null };
  state.memo = memo;
  memo.promise.then(
    () => {
      memo.finishedAt = Date.now();
    },
    () => {
      if (state.memo === memo) state.memo = null;
    },
  );
  return memo.promise;
}

/**
 * Drops the 200 ms memo (not the per-directory cache) so the next getEntryIndex rescans. Every write route calls
 * it after writing. Without an argument the memo of EVERY data dir is dropped.
 */
export function invalidateEntryIndex(dataDir?: string): void {
  if (dataDir === undefined) {
    for (const state of STATES.values()) state.memo = null;
    return;
  }
  const state = STATES.get(path.resolve(dataDir));
  if (state !== undefined) state.memo = null;
}

// ---------------------------------------------------------------- build

interface Candidate {
  dataset: IndexedDataset;
  slug: string;
  dirAbs: string;
}

interface FileStat {
  rel: string;
  abs: string;
  mtimeMs: number;
  size: number;
}

async function listCandidates(dataDir: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const dataset of INDEXED_DATASETS) {
    const base = datasetDir(dataset, dataDir);
    let dirents;
    try {
      dirents = await readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    const slugs = dirents
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && isValidName(e.name))
      .map((e) => e.name)
      .sort();
    for (const slug of slugs) out.push({ dataset, slug, dirAbs: path.join(base, slug) });
  }
  return out;
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function build(dataDir: string, state: DirState): Promise<EntryIndex> {
  const candidates = await listCandidates(dataDir);
  const nextCache = new Map<string, { sig: string; entry: IndexedEntry }>();
  let parsed = 0;

  const scanned = await mapLimit(candidates, SCAN_CONCURRENCY, async (candidate) => {
    const entryFile = datasetDef(candidate.dataset).entryFile;
    const rels = await walkFiles(candidate.dirAbs);
    if (!rels.includes(entryFile)) return null;
    const stats = (
      await Promise.all(
        rels.map(async (rel): Promise<FileStat | null> => {
          const abs = path.join(candidate.dirAbs, ...rel.split('/'));
          try {
            const st = await stat(abs);
            return { rel, abs, mtimeMs: st.mtimeMs, size: st.size };
          } catch {
            return null; // removed mid-walk
          }
        }),
      )
    ).filter((s): s is FileStat => s !== null);
    if (!stats.some((s) => s.rel === entryFile)) return null;

    const sig = stats.map((s) => `${s.rel}:${s.mtimeMs}:${s.size}`).join('\n');
    const cached = state.entries.get(candidate.dirAbs);
    if (cached !== undefined && cached.sig === sig) {
      nextCache.set(candidate.dirAbs, cached);
      return cached.entry;
    }
    const entry = await buildEntry(candidate, entryFile, stats);
    if (entry === null) return null;
    parsed++;
    nextCache.set(candidate.dirAbs, { sig, entry });
    return entry;
  });

  state.entries = nextCache; // directories that vanished are dropped
  const entries = scanned.filter((e): e is IndexedEntry => e !== null);

  const previous = state.last;
  const unchanged =
    previous !== null &&
    previous.entries.length === entries.length &&
    entries.every((entry, i) => entry === previous.entries[i]);
  const index: EntryIndex =
    unchanged && previous !== null
      ? { entries: previous.entries, byKey: previous.byKey, parsed }
      : {
          entries,
          byKey: new Map(entries.map((e) => [`${e.dataset}/${e.slug}`, e])),
          parsed,
        };
  state.last = index;
  return index;
}

/** Reads every .md of the directory and builds the entry; null when the entry file cannot be read. */
async function buildEntry(
  candidate: Candidate,
  entryFile: string,
  stats: readonly FileStat[],
): Promise<IndexedEntry | null> {
  const { dataset, slug } = candidate;
  const markdown = stats.filter((s) => s.rel.endsWith('.md'));
  // main.md / SKILL.md first, then the rest in walk order (mention order).
  const ordered = [
    ...markdown.filter((s) => s.rel === entryFile),
    ...markdown.filter((s) => s.rel !== entryFile),
  ];
  const sources = new Map<string, string>();
  for (const file of ordered) {
    try {
      sources.set(file.rel, await readFile(file.abs, 'utf8'));
    } catch {
      if (file.rel === entryFile) return null;
    }
  }
  const source = sources.get(entryFile);
  if (source === undefined) return null;

  const issues: Issue[] = [];
  let data: Record<string, unknown> = {};
  let body: string;
  try {
    const doc = parseFrontmatterLoose(source);
    data = doc.data;
    body = doc.body;
  } catch (error) {
    issues.push({ path: '', message: error instanceof Error ? error.message : String(error) });
    body = splitFrontmatter(source)?.body ?? source;
  }

  if (issues.length === 0) {
    const result = validate(DATASET_SCHEMAS[dataset], data);
    if (!result.success) {
      for (const issue of result.issues) {
        issues.push({ path: issuePath(issue.path), message: describeIssue(issue, data) });
      }
    }
    if (typeof data.name === 'string' && data.name !== slug) {
      issues.push({
        path: 'name',
        message: `name "${data.name}" must equal the directory name "${slug}"`,
      });
    }
  }

  const mentions: Mention[] = [];
  for (const [rel, text] of sources) collectMentions(dataset, slug, rel, text, mentions);

  let lastModified = 0;
  let fileModified = 0;
  for (const s of stats) {
    if (s.mtimeMs > lastModified) lastModified = s.mtimeMs;
    if (s.rel === entryFile) fileModified = s.mtimeMs;
  }

  return {
    dataset,
    slug,
    file: `${dataset}/${slug}/${entryFile}`,
    data,
    body,
    issues,
    relations: dataset === 'skill' ? [] : relationsOf(data),
    mentions,
    // Truncated like freshness.lastModifiedOf(dir), so both report the same instant.
    lastModified: new Date(lastModified),
    // st.mtime rounds the fractional millisecond (new Date(mtimeMs) would truncate it); PATCH compares this string.
    fileModified: new Date(Math.round(fileModified)).toISOString(),
  };
}

function relationsOf(data: Record<string, unknown>): EntryLink[] {
  const links = data.links;
  if (!Array.isArray(links)) return [];
  const out: EntryLink[] = [];
  for (const item of links) {
    const result = validate(entryLinkSchema, item);
    if (result.success) out.push(result.data);
  }
  return out;
}

function collectMentions(
  dataset: IndexedDataset,
  slug: string,
  file: string,
  source: string,
  out: Mention[],
): void {
  if (!/ctxman:/i.test(source)) return; // the link scan is the expensive part
  const split = splitFrontmatter(source);
  const body = split ? split.body : source;
  const lineOffset = split ? split.bodyLine - 1 : 0;
  for (const link of extractLinks(body)) {
    if (link.image) continue;
    const href = link.href.trim();
    if (classifyHref(href) !== 'ctxman') continue;
    const target = parseCtxmanHref(href);
    if (target === null || !isLinkableDatasetId(target.dataset)) continue;
    if (target.dataset === dataset && target.slug === slug) continue;
    out.push({ dataset: target.dataset, slug: target.slug, file, line: link.line + lineOffset });
  }
}
