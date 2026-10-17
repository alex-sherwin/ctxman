// SERVER-ASTRO: everything pages and API routes read from the datasets (PLAN §E.21, §H).
// Collections (astro:content) provide parsed entries + rendered HTML; the filesystem provides
// freshness and bundle file lists; contexts are ALWAYS read through context-io.ts (fs + zod), never
// getCollection('context') (PLAN §A.2: that collection has no watcher and exists only for validation).
// Never import this module from scripts, tests or browser islands.
import { getCollection, getEntry } from 'astro:content';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DATASET_IDS,
  OKF_DATASET_IDS,
  datasetDef,
  entryUrl,
  isOkfDatasetId,
  isValidName,
} from '../datasets/registry.ts';
import type { DatasetId, LinkableDatasetId, OkfDatasetId } from '../datasets/registry.ts';
import type {
  ContextData,
  DocData,
  OkfEntry,
  ReferenceData,
  SkillData,
} from '../datasets/schemas.ts';
import { listBundleFiles, safeJoin } from './bundles.ts';
import type { BundleFile } from './bundles.ts';
import { backRefs, ContextIoError, listContexts, readContext } from './context-io.ts';
import type { ContextRecord } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { summarize } from './entry-summary.ts';
import type { EntrySummary, SearchDoc } from './entry-summary.ts';
import { entryAbsPath, entryFileRelPath, lastModifiedOf } from './freshness.ts';
import { rewriteRenderedHtml } from './links.ts';
import { renderMarkdown } from './markdown.ts';
import {
  contextToSearchDoc,
  okfDocToSearchDoc,
  referenceToSearchDoc,
  skillToSearchDoc,
} from './search-index.ts';

export type BackRef = ReturnType<typeof backRefs>[number];

export interface ResolvedLink {
  dataset: LinkableDatasetId;
  slug: string;
  title?: string;
  state?: string;
  url: string;
  /** The target entry does not exist (dangling pointer; not fatal). */
  missing: boolean;
  /** Raw markdown notes (non-blank only). */
  notes?: string;
  /** `notes` rendered to HTML with the project's markdown pipeline (links rewritten). */
  notesHtml?: string;
}

export type EntryDetail = {
  summary: EntrySummary;
  backRefs: BackRef[];
  /** Data-dir-relative posix path of the entry's own file: 'kb/foo/main.md' | 'reference/foo.yaml'. */
  fileRelPath: string;
} & (
  | { kind: 'okf'; data: OkfEntry; html: string; files: BundleFile[] }
  | { kind: 'skill'; data: SkillData; html: string; files: BundleFile[] }
  | { kind: 'reference'; data: ReferenceData }
  | { kind: 'context'; data: ContextData; links: ResolvedLink[] }
);

export interface DocDetail {
  /** Summary of the bundle's entry (main.md). */
  entry: EntrySummary;
  /** Bundle-relative file, e.g. 'concepts/search.md'. */
  relPath: string;
  data: DocData;
  title: string;
  html: string;
  /** ISO mtime of this file. */
  lastModified: string;
  files: BundleFile[];
  backRefs: BackRef[];
}

/** Datasets served by a content collection (everything except context). */
type CollectionDatasetId = Exclude<DatasetId, 'context'>;

/** The slice of a collection entry this module relies on. */
interface RawEntry {
  id: string;
  data: Record<string, unknown>;
  body?: string | undefined;
  rendered?: { html: string } | undefined;
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

async function loadCollection(dataset: CollectionDatasetId): Promise<RawEntry[]> {
  return (await getCollection(dataset)) as RawEntry[];
}

async function loadEntry(dataset: CollectionDatasetId, id: string): Promise<RawEntry | undefined> {
  return (await getEntry(dataset, id)) as RawEntry | undefined;
}

async function safeContexts(): Promise<ContextRecord[]> {
  return (await listContexts()).items;
}

/** Rendered HTML of a collection entry (the loader's own render), falling back to the runtime renderer. */
async function htmlOf(entry: RawEntry): Promise<string> {
  return entry.rendered?.html ?? (await renderMarkdown(entry.body ?? ''));
}

// ---------------------------------------------------------------- listings

/** One summary per entry of `dataset`, sorted by slug. Freshness comes from the filesystem. */
export async function listEntries(
  dataset: DatasetId,
  nowMs: number = Date.now(),
): Promise<EntrySummary[]> {
  if (dataset === 'context') {
    return (await safeContexts()).map((record) =>
      summarize('context', record.slug, record.context, new Date(record.lastModified), nowMs),
    );
  }
  const entries = await loadCollection(dataset);
  const summaries = await Promise.all(
    entries.map(async (entry) =>
      summarize(
        dataset,
        entry.id,
        entry.data,
        await lastModifiedOf(entryAbsPath(dataset, entry.id)),
        nowMs,
      ),
    ),
  );
  return summaries.sort((a, b) => compareText(a.slug, b.slug));
}

export async function listAllEntries(
  nowMs: number = Date.now(),
): Promise<Record<DatasetId, EntrySummary[]>> {
  const lists = await Promise.all(DATASET_IDS.map((id) => listEntries(id, nowMs)));
  return Object.fromEntries(DATASET_IDS.map((id, i) => [id, lists[i] ?? []])) as Record<
    DatasetId,
    EntrySummary[]
  >;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- detail

async function exists(abs: string): Promise<boolean> {
  try {
    return (await stat(abs)).isFile();
  } catch {
    return false;
  }
}

async function resolveLinks(
  contextSlug: string,
  context: ContextData,
  dataDir: string,
): Promise<ResolvedLink[]> {
  return Promise.all(
    context.links.map(async (link): Promise<ResolvedLink> => {
      const abs = path.join(dataDir, ...entryFileRelPath(link.dataset, link.slug).split('/'));
      const missing = !(await exists(abs));
      const resolved: ResolvedLink = {
        dataset: link.dataset,
        slug: link.slug,
        url: entryUrl(link.dataset, link.slug),
        missing,
      };
      if (!missing) {
        const target = await loadEntry(link.dataset, link.slug);
        const title = nonEmpty(target?.data.title);
        if (title !== undefined) resolved.title = title;
        const state =
          datasetDef(link.dataset).states === undefined ? undefined : target?.data.state;
        if (typeof state === 'string' && state !== '') resolved.state = state;
      }
      const notes = nonEmpty(link.notes);
      if (notes !== undefined) {
        resolved.notes = notes;
        // dataset 'context' is not a bundle dataset: only ctxman: links and external links are rewritten.
        resolved.notesHtml = rewriteRenderedHtml(await renderMarkdown(notes), {
          dataset: 'context',
          slug: contextSlug,
          fromRelPath: '',
        });
      }
      return resolved;
    }),
  );
}

/** Everything the detail page renders; null when the slug is invalid or the entry does not exist. */
export async function getEntryDetail(
  dataset: DatasetId,
  slug: string,
  nowMs: number = Date.now(),
): Promise<EntryDetail | null> {
  if (!isValidName(slug)) return null;
  const fileRelPath = entryFileRelPath(dataset, slug);
  const dataDir = resolveDataDir();

  if (dataset === 'context') {
    let record: ContextRecord;
    try {
      record = await readContext(slug, dataDir);
    } catch (error) {
      if (error instanceof ContextIoError) return null;
      throw error;
    }
    return {
      kind: 'context',
      summary: summarize('context', slug, record.context, new Date(record.lastModified), nowMs),
      backRefs: [],
      fileRelPath,
      data: record.context,
      links: await resolveLinks(slug, record.context, dataDir),
    };
  }

  // Check the disk first: getEntry() logs a warning for every miss, and a 404 probe is routine.
  if (!(await exists(path.join(dataDir, ...fileRelPath.split('/'))))) return null;
  const entry = await loadEntry(dataset, slug);
  if (entry === undefined) return null;
  const lastModified = await lastModifiedOf(entryAbsPath(dataset, slug, dataDir));
  const summary = summarize(dataset, slug, entry.data, lastModified, nowMs);
  const refs = backRefs(await safeContexts(), dataset, slug);
  const base = { summary, backRefs: refs, fileRelPath };

  switch (datasetDef(dataset).kind) {
    case 'okf': {
      const html = rewriteRenderedHtml(await htmlOf(entry), {
        dataset,
        slug,
        fromRelPath: 'main.md',
      });
      const files = await listBundleFiles(dataset as OkfDatasetId, slug, dataDir);
      return { ...base, kind: 'okf', data: entry.data as OkfEntry, html, files };
    }
    case 'skill': {
      const html = rewriteRenderedHtml(await htmlOf(entry), {
        dataset,
        slug,
        fromRelPath: 'SKILL.md',
      });
      const files = await listBundleFiles('skill', slug, dataDir);
      return { ...base, kind: 'skill', data: entry.data as SkillData, html, files };
    }
    default:
      return { ...base, kind: 'reference', data: entry.data as ReferenceData };
  }
}

/**
 * One non-entry markdown file of an okf bundle (`docPath` = bundle-relative path WITHOUT `.md`, e.g.
 * 'concepts/search', 'index', 'log'). null when the bundle or file does not exist or the path is unsafe.
 */
export async function getDocDetail(
  dataset: OkfDatasetId,
  slug: string,
  docPath: string,
  nowMs: number = Date.now(),
): Promise<DocDetail | null> {
  if (!isOkfDatasetId(dataset) || !isValidName(slug)) return null;
  if (docPath === '' || docPath.endsWith('.md')) return null;
  const segments = docPath.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  const dataDir = resolveDataDir();
  const relPath = `${docPath}.md`;
  const bundleDir = path.join(datasetDir(dataset, dataDir), slug);
  const abs = safeJoin(bundleDir, relPath);
  if (abs === null) return null;

  if (!(await exists(abs)) || !(await exists(path.join(bundleDir, 'main.md')))) return null;
  const doc = await loadDoc(`${dataset}/${slug}/${docPath}`);
  const bundleEntry = await loadEntry(dataset, slug);
  if (doc === undefined || bundleEntry === undefined) return null;

  const lastModified = await lastModifiedOf(abs);
  const entry = summarize(
    dataset,
    slug,
    bundleEntry.data,
    await lastModifiedOf(entryAbsPath(dataset, slug, dataDir)),
    nowMs,
  );
  const title = okfDocToSearchDoc({
    dataset,
    slug,
    relPath,
    data: doc.data,
    body: doc.body ?? '',
    entryTitle: entry.title ?? entry.name,
  }).title;

  return {
    entry,
    relPath,
    data: doc.data as DocData,
    title,
    html: rewriteRenderedHtml(await htmlOf(doc), { dataset, slug, fromRelPath: relPath }),
    lastModified: lastModified.toISOString(),
    files: await listBundleFiles(dataset, slug, dataDir),
    backRefs: backRefs(await safeContexts(), dataset, slug),
  };
}

async function loadDoc(id: string): Promise<RawEntry | undefined> {
  return (await getEntry('docs', id)) as RawEntry | undefined;
}

// ---------------------------------------------------------------- search index

const DATASET_ORDER: ReadonlyMap<string, number> = new Map(DATASET_IDS.map((id, i) => [id, i]));

/** The whole fuse corpus: okf entries + every other okf markdown file + skills + references + contexts. */
export async function buildSearchIndex(): Promise<{ generatedAt: string; docs: SearchDoc[] }> {
  const docs: SearchDoc[] = [];

  for (const dataset of OKF_DATASET_IDS) {
    for (const entry of await loadCollection(dataset)) {
      docs.push(
        okfDocToSearchDoc({
          dataset,
          slug: entry.id,
          relPath: 'main.md',
          data: entry.data,
          body: entry.body ?? '',
          entryTitle: nonEmpty(entry.data.title) ?? nonEmpty(entry.data.name) ?? entry.id,
        }),
      );
    }
  }

  // `docs` ids are '<dataset>/<slug>/<path without .md>'; main.md was added above.
  const okfIds: readonly string[] = OKF_DATASET_IDS;
  for (const doc of (await getCollection('docs')) as RawEntry[]) {
    const [dataset, slug, ...rest] = doc.id.split('/');
    if (dataset === undefined || slug === undefined || rest.length === 0) continue;
    if (!okfIds.includes(dataset) || !isOkfDatasetId(dataset)) continue;
    const relPath = `${rest.join('/')}.md`;
    if (relPath === 'main.md') continue;
    docs.push(
      okfDocToSearchDoc({
        dataset,
        slug,
        relPath,
        data: doc.data,
        body: doc.body ?? '',
        entryTitle: slug,
      }),
    );
  }

  for (const entry of await loadCollection('skill')) {
    docs.push(skillToSearchDoc(entry.id, entry.data as SkillData, entry.body ?? ''));
  }
  for (const entry of await loadCollection('reference')) {
    docs.push(referenceToSearchDoc(entry.id, entry.data as ReferenceData));
  }
  for (const record of await safeContexts()) {
    docs.push(contextToSearchDoc(record.slug, record.context));
  }

  docs.sort(
    (a, b) =>
      (DATASET_ORDER.get(a.dataset) ?? 0) - (DATASET_ORDER.get(b.dataset) ?? 0) ||
      compareText(a.id, b.id),
  );
  return { generatedAt: new Date().toISOString(), docs };
}
