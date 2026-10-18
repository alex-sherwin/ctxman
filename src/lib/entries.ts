// SERVER-ASTRO: everything pages and API routes read from the datasets (PLAN §E.21, §H).
// okf + skill entries (frontmatter, summaries, lists, relations, invalid files) come from the entry index on disk
// (entry-index.ts, ROUND3_SPEC §A3); collections (astro:content) only provide their rendered HTML (when they hold
// the entry and its body matches the disk), the `docs` collection and the reference entries; the filesystem
// provides bundle file lists; contexts are ALWAYS read through context-io.ts (fs + zod), never
// getCollection('context') (PLAN §A.2: that collection has no watcher and exists only for validation);
// recipes likewise go through recipe-io.ts, never getCollection('recipe').
// Never import this module from scripts, tests or browser islands.
import { getCollection, getEntry } from 'astro:content';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DATASET_IDS,
  ENTRY_REL_INVERSE_LABELS,
  ENTRY_REL_LABELS,
  OKF_DATASET_IDS,
  datasetDef,
  entryUrl,
  isOkfDatasetId,
  isValidName,
} from '../datasets/registry.ts';
import type { DatasetId, LinkableDatasetId, OkfDatasetId } from '../datasets/registry.ts';
import { DATASET_SCHEMAS } from '../datasets/schemas.ts';
import type {
  ContextData,
  DocData,
  OkfEntry,
  RecipeData,
  ReferenceData,
  SkillData,
} from '../datasets/schemas.ts';
import { listBundleFiles, safeJoin } from './bundles.ts';
import type { BundleFile } from './bundles.ts';
import { backRefs, ContextIoError, listContexts, readContext } from './context-io.ts';
import type { ContextRecord } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { getEntryIndex } from './entry-index.ts';
import type { EntryIndex, IndexedEntry } from './entry-index.ts';
import { summarize } from './entry-summary.ts';
import type { EntrySummary, SearchDoc } from './entry-summary.ts';
import { entryAbsPath, entryFileRelPath, lastModifiedOf } from './freshness.ts';
import { itemKey } from './inflate/catalog.ts';
import { rewriteRenderedHtml } from './links.ts';
import { renderMarkdown } from './markdown.ts';
import { parseFrontmatterLoose, splitFrontmatter } from './okf.ts';
import { listRecipes, readRecipe, RecipeIoError } from './recipe-io.ts';
import { buildRelationGraph, linkedFrom, linksTo } from './relations.ts';
import type { OutRel, RelationEdge, RelationGraph } from './relations.ts';
import {
  contextToSearchDoc,
  okfDocToSearchDoc,
  recipeToSearchDoc,
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

/** A context listed by a recipe, resolved for the detail page. */
export interface RecipeContextRef {
  slug: string;
  url: string;
  missing: boolean;
  description?: string;
  linkCount?: number;
}

/** An ad hoc item of a recipe, resolved for the detail page. */
export interface RecipeItemRef {
  /** `dataset/slug` */
  key: string;
  dataset: LinkableDatasetId;
  slug: string;
  url: string;
  title?: string;
  missing: boolean;
}

/** One line of a relation panel: an outgoing edge ("Links to"), an incoming one ("Linked from") or a child/parent. */
export interface RelationRow {
  /** The OTHER entry: `dataset/slug`. */
  key: string;
  dataset: LinkableDatasetId;
  slug: string;
  rel: OutRel;
  /** `ENTRY_REL_LABELS` (outgoing), `ENTRY_REL_INVERSE_LABELS` (incoming), 'Mentions' / 'Mentioned by'. */
  label: string;
  /** The other entry's `title`, else its slug. */
  title: string;
  /** Lifecycle datasets only; the raw value (may not be a registry state when the other file is invalid). */
  state?: string;
  /** The other entry does not exist (dangling link): `title` is the slug. */
  missing: boolean;
  source: 'frontmatter' | 'body';
  /** Body mentions: bundle-relative files the link appears in (first occurrence first); [] for frontmatter rows. */
  files: string[];
}

/** What a detail page shows about an entry's relations (okf, skill, reference; never context / recipe). */
export interface EntryRelations {
  /** Outgoing edges: frontmatter `links` in file order (every rel, `child` included), then mentions. [] for reference. */
  linksTo: RelationRow[];
  /** Incoming edges, ordered Parent (child), Required by, Related, Mentioned by; then by key. */
  linkedFrom: RelationRow[];
  /** Project entries only: the `child` targets in file order (the same rows as the `child` ones of `linksTo`). */
  children?: RelationRow[];
  /** Entries declaring a `child` edge to this one (the incoming `child` rows of `linkedFrom`). */
  parents: RelationRow[];
}

export type EntryDetail = {
  summary: EntrySummary;
  backRefs: BackRef[];
  /** Data-dir-relative posix path of the entry's own file: 'kb/foo/main.md' | 'reference/foo.yaml'. */
  fileRelPath: string;
} & (
  | {
      kind: 'okf';
      data: OkfEntry;
      html: string;
      files: BundleFile[];
      relations: EntryRelations;
      /** ISO mtime of main.md itself (the `ifUnmodifiedSince` base of the frontmatter PATCH). */
      fileModified: string;
    }
  | {
      kind: 'skill';
      data: SkillData;
      html: string;
      files: BundleFile[];
      relations: EntryRelations;
      /** ISO mtime of SKILL.md itself. */
      fileModified: string;
    }
  | { kind: 'reference'; data: ReferenceData; relations: EntryRelations }
  | { kind: 'context'; data: ContextData; links: ResolvedLink[] }
  | {
      kind: 'recipe';
      data: RecipeData;
      contexts: RecipeContextRef[];
      items: RecipeItemRef[];
      preambleHtml?: string;
      blocks: { id: string; html: string }[];
    }
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

/** Datasets served by a content collection (everything except the runtime-read yaml datasets context and recipe). */
type CollectionDatasetId = Exclude<DatasetId, 'context' | 'recipe'>;

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

/** Line endings and surrounding whitespace do not make two markdown bodies different. */
function sameBody(a: string | undefined, b: string): boolean {
  const norm = (text: string): string => text.replace(/\r\n?/g, '\n').trim();
  return a !== undefined && norm(a) === norm(b);
}

/**
 * Rendered HTML of `body`, which is the markdown currently on disk: the collection's own render (`entry.rendered`)
 * when the collection holds the entry AND its body equals the disk body; otherwise (entry not loaded yet, invalid
 * file, or the content layer still lags behind a write) the runtime renderer, the same Sätteri pipeline.
 */
async function htmlFor(entry: RawEntry | undefined, body: string): Promise<string> {
  if (entry?.rendered !== undefined && sameBody(entry.body, body)) return entry.rendered.html;
  return renderMarkdown(body);
}

/** Frontmatter + body of a markdown file read from disk; bad YAML gives empty data and the raw body. */
function parseDiskMarkdown(source: string): { data: Record<string, unknown>; body: string } {
  try {
    const doc = parseFrontmatterLoose(source);
    return { data: doc.data, body: doc.body };
  } catch {
    return { data: {}, body: splitFrontmatter(source)?.body ?? source };
  }
}

/** The summary of an indexed okf / skill entry: freshness from the index, `invalid` when its file has issues. */
function summaryOf(entry: IndexedEntry, nowMs: number): EntrySummary {
  const summary = summarize(entry.dataset, entry.slug, entry.data, entry.lastModified, nowMs);
  if (entry.issues.length > 0) summary.invalid = entry.issues;
  return summary;
}

// ---------------------------------------------------------------- relations

const GRAPHS = new WeakMap<object, RelationGraph>();

function graphOf(index: EntryIndex): RelationGraph {
  let graph = GRAPHS.get(index.entries);
  if (graph === undefined) {
    graph = buildRelationGraph(index.entries);
    GRAPHS.set(index.entries, graph);
  }
  return graph;
}

/**
 * The relation graph of the entry index (frontmatter `links` + body mentions). Memoized on the identity of
 * `index.entries`, which the entry index keeps from build to build while no entry changed.
 */
export async function getRelationGraph(dataDir: string = resolveDataDir()): Promise<RelationGraph> {
  return graphOf(await getEntryIndex(dataDir));
}

/** What a link target contributes to a row: existence, raw `title` (non-blank only) and lifecycle `state`. */
interface TargetInfo {
  missing: boolean;
  title?: string;
  state?: string;
}

function infoOfIndexed(entry: IndexedEntry): TargetInfo {
  const info: TargetInfo = { missing: false };
  const title = nonEmpty(entry.data.title);
  if (title !== undefined) info.title = title;
  const state = datasetDef(entry.dataset).states === undefined ? undefined : entry.data.state;
  if (typeof state === 'string' && state !== '') info.state = state;
  return info;
}

/** okf + skill targets come from the entry index; a reference is a file plus its collection entry. */
async function targetInfo(
  index: EntryIndex,
  dataDir: string,
  dataset: LinkableDatasetId,
  slug: string,
): Promise<TargetInfo> {
  const indexed = index.byKey.get(`${dataset}/${slug}`);
  if (indexed !== undefined) return infoOfIndexed(indexed);
  if (dataset !== 'reference') return { missing: true };
  const abs = path.join(dataDir, ...entryFileRelPath(dataset, slug).split('/'));
  if (!(await exists(abs))) return { missing: true };
  const title = nonEmpty((await loadEntry('reference', slug))?.data.title);
  return title === undefined ? { missing: false } : { missing: false, title };
}

function splitKey(key: string): { dataset: LinkableDatasetId; slug: string } {
  const at = key.indexOf('/');
  return { dataset: key.slice(0, at) as LinkableDatasetId, slug: key.slice(at + 1) };
}

/** Rows for `edges`; `side` picks the entry shown (`to` of an outgoing edge, `from` of an incoming one). */
function rowsOf(
  edges: readonly RelationEdge[],
  side: 'to' | 'from',
  infos: ReadonlyMap<string, TargetInfo>,
): RelationRow[] {
  return edges.map((edge): RelationRow => {
    const key = edge[side];
    const { dataset, slug } = splitKey(key);
    const info = infos.get(key);
    const row: RelationRow = {
      key,
      dataset,
      slug,
      rel: edge.rel,
      label:
        edge.rel === 'mentions'
          ? side === 'to'
            ? 'Mentions'
            : 'Mentioned by'
          : side === 'to'
            ? ENTRY_REL_LABELS[edge.rel]
            : ENTRY_REL_INVERSE_LABELS[edge.rel],
      title: info?.title ?? slug,
      missing: info?.missing ?? true,
      source: edge.source,
      files: [...edge.files],
    };
    if (info?.state !== undefined) row.state = info.state;
    return row;
  });
}

/** The relations of one entry for its detail page (titles, states and `missing` marks resolved). */
async function relationsFor(
  index: EntryIndex,
  dataDir: string,
  dataset: DatasetId,
  slug: string,
): Promise<EntryRelations> {
  const graph = graphOf(index);
  const key = `${dataset}/${slug}`;
  const out = linksTo(graph, key);
  const incoming = linkedFrom(graph, key);
  const keys = new Set<string>([...out.map((e) => e.to), ...incoming.map((e) => e.from)]);
  const infos = new Map<string, TargetInfo>(
    await Promise.all(
      [...keys].map(async (k): Promise<[string, TargetInfo]> => {
        const target = splitKey(k);
        return [k, await targetInfo(index, dataDir, target.dataset, target.slug)];
      }),
    ),
  );
  const linksToRows = rowsOf(out, 'to', infos);
  const relations: EntryRelations = {
    linksTo: linksToRows,
    linkedFrom: rowsOf(incoming, 'from', infos),
    parents: rowsOf(
      incoming.filter((e) => e.rel === 'child'),
      'from',
      infos,
    ),
  };
  if (dataset === 'project') relations.children = linksToRows.filter((row) => row.rel === 'child');
  return relations;
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
  if (dataset === 'recipe') {
    return (await listRecipes()).items.map((record) =>
      summarize('recipe', record.slug, record.recipe, new Date(record.lastModified), nowMs),
    );
  }
  const kind = datasetDef(dataset).kind;
  if (kind === 'okf' || kind === 'skill') {
    // From the entry index on disk: an edit shows on the very next request and an invalid file is listed
    // (with its issues) instead of vanishing from the collection.
    return (await getEntryIndex()).entries
      .filter((entry) => entry.dataset === dataset)
      .map((entry) => summaryOf(entry, nowMs))
      .sort((a, b) => compareText(a.slug, b.slug));
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
  index: EntryIndex,
  dataDir: string,
): Promise<ResolvedLink[]> {
  return Promise.all(
    context.links.map(async (link): Promise<ResolvedLink> => {
      const info = await targetInfo(index, dataDir, link.dataset, link.slug);
      const resolved: ResolvedLink = {
        dataset: link.dataset,
        slug: link.slug,
        url: entryUrl(link.dataset, link.slug),
        missing: info.missing,
      };
      if (info.title !== undefined) resolved.title = info.title;
      if (info.state !== undefined) resolved.state = info.state;
      const notes = nonEmpty(link.notes);
      if (notes !== undefined) {
        resolved.notes = notes;
        // dataset 'context' is not a bundle dataset: only ctxman: links and external links are rewritten
        // (a ctxman: link to a missing entry is marked broken).
        resolved.notesHtml = rewriteRenderedHtml(await renderMarkdown(notes), {
          dataset: 'context',
          slug: contextSlug,
          fromRelPath: '',
          dataDir,
        });
      }
      return resolved;
    }),
  );
}

/** Markdown (preamble, blocks) rendered like context notes: only ctxman: and external links are rewritten. */
async function recipeHtml(slug: string, markdown: string, dataDir: string): Promise<string> {
  return rewriteRenderedHtml(await renderMarkdown(markdown), {
    dataset: 'recipe',
    slug,
    fromRelPath: '',
    dataDir,
  });
}

async function resolveRecipe(
  slug: string,
  recipe: RecipeData,
  index: EntryIndex,
  dataDir: string,
): Promise<{
  contexts: RecipeContextRef[];
  items: RecipeItemRef[];
  preambleHtml?: string;
  blocks: { id: string; html: string }[];
}> {
  const contexts = await Promise.all(
    recipe.contexts.map(async (contextSlug): Promise<RecipeContextRef> => {
      const ref: RecipeContextRef = {
        slug: contextSlug,
        url: entryUrl('context', contextSlug),
        missing: false,
      };
      try {
        const record = await readContext(contextSlug, dataDir);
        ref.description = record.context.description;
        ref.linkCount = record.context.links.length;
      } catch (error) {
        if (!(error instanceof ContextIoError)) throw error;
        ref.missing = true;
      }
      return ref;
    }),
  );
  const items = await Promise.all(
    recipe.items.map(async (item): Promise<RecipeItemRef> => {
      const info = await targetInfo(index, dataDir, item.dataset, item.slug);
      const ref: RecipeItemRef = {
        key: itemKey(item.dataset, item.slug),
        dataset: item.dataset,
        slug: item.slug,
        url: entryUrl(item.dataset, item.slug),
        missing: info.missing,
      };
      if (info.title !== undefined) ref.title = info.title;
      return ref;
    }),
  );
  const blocks = await Promise.all(
    recipe.markdown.map(async (block) => ({
      id: block.id,
      html: await recipeHtml(slug, block.body, dataDir),
    })),
  );
  const out: Awaited<ReturnType<typeof resolveRecipe>> = { contexts, items, blocks };
  const preamble = nonEmpty(recipe.preamble);
  if (preamble !== undefined) out.preambleHtml = await recipeHtml(slug, preamble, dataDir);
  return out;
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
      links: await resolveLinks(slug, record.context, await getEntryIndex(dataDir), dataDir),
    };
  }

  if (dataset === 'recipe') {
    let record;
    try {
      record = await readRecipe(slug, dataDir);
    } catch (error) {
      if (error instanceof RecipeIoError) return null;
      throw error;
    }
    return {
      kind: 'recipe',
      summary: summarize('recipe', slug, record.recipe, new Date(record.lastModified), nowMs),
      backRefs: [],
      fileRelPath,
      data: record.recipe,
      ...(await resolveRecipe(slug, record.recipe, await getEntryIndex(dataDir), dataDir)),
    };
  }

  const index = await getEntryIndex(dataDir);
  const kind = datasetDef(dataset).kind;

  if (kind === 'okf' || kind === 'skill') {
    // The entry index is the source of truth (disk): an invalid file still opens, flagged by `summary.invalid`.
    const indexed = index.byKey.get(`${dataset}/${slug}`);
    if (indexed === undefined) return null;
    const entryFile = datasetDef(dataset).entryFile;
    // Only a valid entry can be in the collection; an unknown id would log a warning for nothing.
    const collectionEntry =
      indexed.issues.length === 0
        ? await loadEntry(dataset as CollectionDatasetId, slug)
        : undefined;
    const html = rewriteRenderedHtml(await htmlFor(collectionEntry, indexed.body), {
      dataset,
      slug,
      fromRelPath: entryFile,
      dataDir,
    });
    // A valid file gets the schema's output (defaults, coerced dates) like the collection used to give.
    const parsed =
      indexed.issues.length === 0 ? DATASET_SCHEMAS[indexed.dataset].safeParse(indexed.data) : null;
    const data = (parsed?.success === true ? parsed.data : indexed.data) as Record<string, unknown>;
    const base = {
      summary: summaryOf(indexed, nowMs),
      backRefs: backRefs(await safeContexts(), dataset, slug),
      fileRelPath,
      html,
      files: await listBundleFiles(indexed.dataset, slug, dataDir),
      relations: await relationsFor(index, dataDir, dataset, slug),
      fileModified: indexed.fileModified,
    };
    return kind === 'okf'
      ? { ...base, kind: 'okf', data: data as OkfEntry }
      : { ...base, kind: 'skill', data: data as SkillData };
  }

  // reference: a yaml file served by its collection. Check the disk first: getEntry() logs a warning for every
  // miss, and a 404 probe is routine.
  if (!(await exists(path.join(dataDir, ...fileRelPath.split('/'))))) return null;
  const entry = await loadEntry(dataset as CollectionDatasetId, slug);
  if (entry === undefined) return null;
  const lastModified = await lastModifiedOf(entryAbsPath(dataset, slug, dataDir));
  return {
    kind: 'reference',
    summary: summarize(dataset, slug, entry.data, lastModified, nowMs),
    backRefs: backRefs(await safeContexts(), dataset, slug),
    fileRelPath,
    data: entry.data as ReferenceData,
    relations: await relationsFor(index, dataDir, dataset, slug),
  };
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

  if (!(await exists(abs))) return null;
  // The bundle is the entry index's (disk): an entry with an invalid main.md still has its pages.
  const bundleEntry = (await getEntryIndex(dataDir)).byKey.get(`${dataset}/${slug}`);
  if (bundleEntry === undefined) return null;

  // The file as it is on disk. The `docs` collection supplies the rendered HTML when it holds this file with the
  // same body; a file the content layer has not picked up yet (a new concept) or an older version is rendered here.
  const disk = parseDiskMarkdown(await readFile(abs, 'utf8'));
  const collectionDoc = await loadDoc(`${dataset}/${slug}/${docPath}`);
  const lastModified = await lastModifiedOf(abs);
  const entry = summaryOf(bundleEntry, nowMs);
  const title = okfDocToSearchDoc({
    dataset,
    slug,
    relPath,
    data: disk.data,
    body: disk.body,
    entryTitle: entry.title ?? entry.name,
  }).title;

  return {
    entry,
    relPath,
    data: disk.data as DocData,
    title,
    html: rewriteRenderedHtml(await htmlFor(collectionDoc, disk.body), {
      dataset,
      slug,
      fromRelPath: relPath,
      dataDir,
    }),
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

/** The whole fuse corpus: okf entries + every other okf markdown file + skills + references + contexts + recipes. */
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
    // index.md and log.md are navigation and history, not knowledge: they stay out of search (UX-22).
    const last = rest[rest.length - 1];
    if (last === 'index' || last === 'log') continue;
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
  for (const record of (await listRecipes()).items) {
    docs.push(recipeToSearchDoc(record.slug, record.recipe));
  }

  docs.sort(
    (a, b) =>
      (DATASET_ORDER.get(a.dataset) ?? 0) - (DATASET_ORDER.get(b.dataset) ?? 0) ||
      compareText(a.id, b.id),
  );
  return { generatedAt: new Date().toISOString(), docs };
}
