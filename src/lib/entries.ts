// SERVER (no astro:*): everything pages, API routes and the MCP endpoint read from the datasets (PLAN §E.21, §H).
// The disk is the truth on every request: okf + skill entries (frontmatter, bodies, summaries, lists, relations,
// invalid files) come from the entry index (entry-index.ts); references, contexts and recipes are read through
// reference-io.ts / context-io.ts / recipe-io.ts; bundle file lists come from bundles.ts; markdown is rendered
// at request time by markdown.ts (Sätteri, memoized by source hash).
// Never import this module from scripts or browser islands.
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DATASET_IDS,
  ENTRY_REL_INVERSE_LABELS,
  ENTRY_REL_LABELS,
  datasetDef,
  entryUrl,
  isOkfDatasetId,
  isValidName,
  OKF_ENTRY_FILE,
} from '../datasets/registry.ts';
import type { DatasetId, LinkableDatasetId, OkfDatasetId } from '../datasets/registry.ts';
import { DATASET_SCHEMAS } from '../datasets/schemas.ts';
import type {
  ContextData,
  OkfEntry,
  RecipeData,
  ReferenceData,
  SkillData,
  SnippetData,
} from '../datasets/schemas.ts';
import { validate } from '../datasets/validate.ts';
import { listBundleFiles, safeJoin, walkFiles } from './bundles.ts';
import type { BundleFile } from './bundles.ts';
import { backRefs, ContextIoError, listContexts, readContext } from './context-io.ts';
import type { ContextRecord } from './context-io.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { tocEntries } from './doc-toc.ts';
import type { TocEntry } from './doc-toc.ts';
import { getEntryIndex } from './entry-index.ts';
import type { EntryIndex, IndexedEntry } from './entry-index.ts';
import { summarize } from './entry-summary.ts';
import type { EntrySummary, SearchDoc } from './entry-summary.ts';
import { entryFileRelPath, lastModifiedOf } from './freshness.ts';
import { itemKey } from './inflate/catalog.ts';
import { rewriteRenderedHtml } from './links.ts';
import { renderMarkdown, renderMarkdownDoc } from './markdown.ts';
import { parseFrontmatterLoose, splitFrontmatter } from './okf.ts';
import { listRecipes, readRecipe, RecipeIoError } from './recipe-io.ts';
import { listReferences, readReference, ReferenceIoError } from './reference-io.ts';
import { buildRelationGraph, linkedFrom, linksTo } from './relations.ts';
import { listSnippets, readSnippet, SnippetIoError } from './snippet-io.ts';
import type { OutRel, RelationEdge, RelationGraph } from './relations.ts';
import {
  contextToSearchDoc,
  okfDocToSearchDoc,
  recipeToSearchDoc,
  referenceToSearchDoc,
  skillToSearchDoc,
  snippetToSearchDoc,
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

/** What a detail page shows about an entry's relations (okf, skill, reference, snippet; never context / recipe). */
export interface EntryRelations {
  /**
   * Outgoing edges: frontmatter `links` in file order (every rel, `child` included), then mentions. [] for
   * reference and snippet.
   */
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
  /** Data-dir-relative posix path of the entry's own file: 'kb/foo/index.md' | 'reference/foo.yaml'. */
  fileRelPath: string;
} & (
  | {
      kind: 'okf';
      data: OkfEntry;
      /** The markdown body as read (frontmatter split off, LF): what the doc toolbar's Copy copies in preview. */
      body: string;
      html: string;
      /** The headings nav of the page (src/lib/doc-toc.ts; [] = none). */
      toc: TocEntry[];
      files: BundleFile[];
      relations: EntryRelations;
      /** ISO mtime of the entry index.md itself (the `ifUnmodifiedSince` base of the frontmatter PATCH). */
      fileModified: string;
    }
  | {
      kind: 'skill';
      data: SkillData;
      /** The markdown body as read (frontmatter split off, LF). */
      body: string;
      html: string;
      /** The headings nav of the page (src/lib/doc-toc.ts; [] = none). */
      toc: TocEntry[];
      files: BundleFile[];
      relations: EntryRelations;
      /** ISO mtime of SKILL.md itself. */
      fileModified: string;
    }
  | {
      kind: 'reference';
      data: ReferenceData;
      relations: EntryRelations;
      /** `info` rendered with the project's markdown pipeline (absent when blank). */
      infoHtml?: string;
    }
  | {
      kind: 'snippet';
      data: SnippetData;
      relations: EntryRelations;
      /** `markdown` rendered with the project's markdown pipeline. */
      markdownHtml: string;
    }
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

/** Parsed frontmatter of a non-entry markdown file of an okf bundle (any keys; `type` is checked by `pnpm run check`). */
export type DocFrontmatter = Record<string, unknown>;

export interface DocDetail {
  /** Summary of the bundle's entry (the root index.md). */
  entry: EntrySummary;
  /** Bundle-relative file, e.g. 'concepts/search.md'. */
  relPath: string;
  data: DocFrontmatter;
  title: string;
  /** The markdown body as read (frontmatter split off, LF): what the doc toolbar's Copy copies in preview. */
  body: string;
  html: string;
  /** The headings nav of the page (src/lib/doc-toc.ts; [] = none). */
  toc: TocEntry[];
  /** ISO mtime of this file. */
  lastModified: string;
  files: BundleFile[];
  backRefs: BackRef[];
}

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

async function safeContexts(dataDir: string = resolveDataDir()): Promise<ContextRecord[]> {
  return (await listContexts(dataDir)).items;
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

/** okf + skill targets come from the entry index; a reference or snippet is read from its yaml file. */
async function targetInfo(
  index: EntryIndex,
  dataDir: string,
  dataset: LinkableDatasetId,
  slug: string,
): Promise<TargetInfo> {
  const indexed = index.byKey.get(`${dataset}/${slug}`);
  if (indexed !== undefined) return infoOfIndexed(indexed);
  if (dataset === 'snippet') {
    try {
      await readSnippet(slug, dataDir);
      return { missing: false };
    } catch (error) {
      if (!(error instanceof SnippetIoError)) throw error;
      // An existing but invalid file is a target that exists; a missing or unaddressable one is not.
      return error.code === 'not-found' || error.code === 'bad-slug'
        ? { missing: true }
        : { missing: false };
    }
  }
  if (dataset !== 'reference') return { missing: true };
  try {
    const record = await readReference(slug, dataDir);
    const title = nonEmpty((record.reference as { title?: unknown }).title);
    return title === undefined ? { missing: false } : { missing: false, title };
  } catch (error) {
    if (!(error instanceof ReferenceIoError)) throw error;
    // An existing but invalid file is a target that exists; a missing or unaddressable one is not.
    return error.code === 'not-found' || error.code === 'bad-slug'
      ? { missing: true }
      : { missing: false };
  }
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
  dataDir: string = resolveDataDir(),
): Promise<EntrySummary[]> {
  if (dataset === 'context') {
    return (await safeContexts(dataDir)).map((record) =>
      summarize('context', record.slug, record.context, new Date(record.lastModified), nowMs),
    );
  }
  if (dataset === 'recipe') {
    return (await listRecipes(dataDir)).items.map((record) =>
      summarize('recipe', record.slug, record.recipe, new Date(record.lastModified), nowMs),
    );
  }
  const kind = datasetDef(dataset).kind;
  if (kind === 'okf' || kind === 'skill') {
    // From the entry index on disk: an edit shows on the very next request and an invalid file is listed
    // (with its issues) instead of vanishing from the collection.
    return (await getEntryIndex(dataDir)).entries
      .filter((entry) => entry.dataset === dataset)
      .map((entry) => summaryOf(entry, nowMs))
      .sort((a, b) => compareText(a.slug, b.slug));
  }
  // reference, snippet: yaml files; an invalid one is listed (flagged) with its issues
  const { items, invalid } =
    dataset === 'snippet'
      ? await listSnippets(dataDir).then(({ items: records, invalid: bad }) => ({
          items: records.map((r) => ({
            slug: r.slug,
            data: r.snippet,
            lastModified: r.lastModified,
          })),
          invalid: bad,
        }))
      : await listReferences(dataDir).then(({ items: records, invalid: bad }) => ({
          items: records.map((r) => ({
            slug: r.slug,
            data: r.reference,
            lastModified: r.lastModified,
          })),
          invalid: bad,
        }));
  const summaries = items.map((record) =>
    summarize(dataset, record.slug, record.data, new Date(record.lastModified), nowMs),
  );
  for (const bad of invalid) {
    const summary = summarize(
      dataset,
      bad.slug,
      { name: bad.slug, description: '' },
      new Date(bad.lastModified),
      nowMs,
    );
    summary.invalid = bad.issues;
    summaries.push(summary);
  }
  return summaries.sort((a, b) => compareText(a.slug, b.slug));
}

export async function listAllEntries(
  nowMs: number = Date.now(),
  dataDir: string = resolveDataDir(),
): Promise<Record<DatasetId, EntrySummary[]>> {
  const lists = await Promise.all(DATASET_IDS.map((id) => listEntries(id, nowMs, dataDir)));
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
  dataDir: string = resolveDataDir(),
): Promise<EntryDetail | null> {
  if (!isValidName(slug)) return null;
  const fileRelPath = entryFileRelPath(dataset, slug);

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
    const rendered = await renderMarkdownDoc(indexed.body);
    const html = rewriteRenderedHtml(rendered.html, {
      dataset,
      slug,
      fromRelPath: entryFile,
      dataDir,
    });
    // A valid file gets the schema's output (defaults, coerced dates).
    const parsed =
      indexed.issues.length === 0 ? validate(DATASET_SCHEMAS[indexed.dataset], indexed.data) : null;
    const data = (parsed?.success === true ? parsed.data : indexed.data) as Record<string, unknown>;
    const base = {
      summary: summaryOf(indexed, nowMs),
      backRefs: backRefs(await safeContexts(dataDir), dataset, slug),
      fileRelPath,
      body: indexed.body,
      html,
      toc: tocEntries(rendered.headings),
      files: await listBundleFiles(indexed.dataset, slug, dataDir),
      relations: await relationsFor(index, dataDir, dataset, slug),
      fileModified: indexed.fileModified,
    };
    return kind === 'okf'
      ? { ...base, kind: 'okf', data: data as OkfEntry }
      : { ...base, kind: 'skill', data: data as SkillData };
  }

  // snippet: a yaml file read from disk. An invalid file is listed (flagged) but has no detail page (404).
  if (dataset === 'snippet') {
    let snippet;
    try {
      snippet = await readSnippet(slug, dataDir);
    } catch (error) {
      if (error instanceof SnippetIoError) return null;
      throw error;
    }
    return {
      kind: 'snippet',
      summary: summarize(dataset, slug, snippet.snippet, new Date(snippet.lastModified), nowMs),
      backRefs: backRefs(await safeContexts(dataDir), dataset, slug),
      fileRelPath,
      data: snippet.snippet,
      relations: await relationsFor(index, dataDir, dataset, slug),
      // Like a reference's info: only ctxman: and external links are rewritten (a snippet has no bundle).
      markdownHtml: rewriteRenderedHtml(await renderMarkdown(snippet.snippet.markdown), {
        dataset,
        slug,
        fromRelPath: '',
        dataDir,
      }),
    };
  }

  // reference: a yaml file read from disk. An invalid file is listed (flagged) but has no detail page (404).
  let reference;
  try {
    reference = await readReference(slug, dataDir);
  } catch (error) {
    if (error instanceof ReferenceIoError) return null;
    throw error;
  }
  const info = nonEmpty(reference.reference.info);
  return {
    kind: 'reference',
    summary: summarize(dataset, slug, reference.reference, new Date(reference.lastModified), nowMs),
    backRefs: backRefs(await safeContexts(dataDir), dataset, slug),
    fileRelPath,
    data: reference.reference,
    relations: await relationsFor(index, dataDir, dataset, slug),
    // Like a recipe preamble: only ctxman: and external links are rewritten (a reference has no bundle).
    ...(info === undefined
      ? {}
      : {
          infoHtml: rewriteRenderedHtml(await renderMarkdown(info), {
            dataset,
            slug,
            fromRelPath: '',
            dataDir,
          }),
        }),
  };
}

/**
 * One non-entry markdown file of an okf bundle (`docPath` = bundle-relative path WITHOUT `.md`, e.g.
 * 'concepts/search', 'log'). null when the bundle or file does not exist or the path is unsafe.
 */
export async function getDocDetail(
  dataset: OkfDatasetId,
  slug: string,
  docPath: string,
  nowMs: number = Date.now(),
): Promise<DocDetail | null> {
  if (!isOkfDatasetId(dataset) || !isValidName(slug)) return null;
  // 'index' is the entry (served by the entry page), not a sub-doc.
  if (docPath === '' || docPath === 'index' || docPath.endsWith('.md')) return null;
  const segments = docPath.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return null;
  const dataDir = resolveDataDir();
  const relPath = `${docPath}.md`;
  const bundleDir = path.join(datasetDir(dataset, dataDir), slug);
  const abs = safeJoin(bundleDir, relPath);
  if (abs === null) return null;

  if (!(await exists(abs))) return null;
  // The bundle is the entry index's (disk): an entry with an invalid index.md still has its pages.
  const bundleEntry = (await getEntryIndex(dataDir)).byKey.get(`${dataset}/${slug}`);
  if (bundleEntry === undefined) return null;

  const disk = parseDiskMarkdown(await readFile(abs, 'utf8'));
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
  const rendered = await renderMarkdownDoc(disk.body);

  return {
    entry,
    relPath,
    data: disk.data,
    title,
    body: disk.body,
    html: rewriteRenderedHtml(rendered.html, {
      dataset,
      slug,
      fromRelPath: relPath,
      dataDir,
    }),
    toc: tocEntries(rendered.headings),
    lastModified: lastModified.toISOString(),
    files: await listBundleFiles(dataset, slug, dataDir),
    backRefs: backRefs(await safeContexts(dataDir), dataset, slug),
  };
}

// ---------------------------------------------------------------- search index

const DATASET_ORDER: ReadonlyMap<string, number> = new Map(DATASET_IDS.map((id, i) => [id, i]));

/** Frontmatter `index: false` (the boolean only): the file stays out of the search index. */
const unindexed = (data: Record<string, unknown>): boolean => data.index === false;

/**
 * The whole fuse corpus: okf entries + every other okf markdown file + skills + references + snippets +
 * contexts + recipes. `index: false` in an okf entry's index.md leaves out the whole bundle (entry and every file);
 * in any other bundle markdown file, that file alone. The widget (`/api/search-index.json`, `#tag` too) and the MCP
 * `search` tool read this index; lists, details, relations, pickers and Forge do not.
 */
export async function buildSearchIndex(
  dataDir: string = resolveDataDir(),
): Promise<{ generatedAt: string; docs: SearchDoc[] }> {
  const docs: SearchDoc[] = [];
  const index = await getEntryIndex(dataDir);

  for (const entry of index.entries) {
    if (entry.dataset === 'skill') {
      // Only a valid skill has the strict frontmatter the search doc needs.
      if (entry.issues.length === 0) {
        docs.push(skillToSearchDoc(entry.slug, entry.data as SkillData, entry.body));
      }
      continue;
    }
    const dataset = entry.dataset;
    if (unindexed(entry.data)) continue;
    docs.push(
      okfDocToSearchDoc({
        dataset,
        slug: entry.slug,
        relPath: OKF_ENTRY_FILE,
        data: entry.data,
        body: entry.body,
        entryTitle: nonEmpty(entry.data.title) ?? nonEmpty(entry.data.name) ?? entry.slug,
      }),
    );
    // Every other markdown file of the bundle; the root index.md is the entry doc above, nested index.md and log.md
    // are navigation and history, not knowledge (UX-22), at any depth.
    const bundleDir = path.join(datasetDir(dataset, dataDir), entry.slug);
    for (const relPath of await walkFiles(bundleDir)) {
      if (!relPath.endsWith('.md')) continue;
      const base = relPath.slice(relPath.lastIndexOf('/') + 1);
      if (base === 'index.md' || base === 'log.md') continue;
      let source: string;
      try {
        source = await readFile(path.join(bundleDir, ...relPath.split('/')), 'utf8');
      } catch {
        continue;
      }
      const disk = parseDiskMarkdown(source);
      if (unindexed(disk.data)) continue;
      docs.push(
        okfDocToSearchDoc({
          dataset,
          slug: entry.slug,
          relPath,
          data: disk.data,
          body: disk.body,
          entryTitle: entry.slug,
        }),
      );
    }
  }

  for (const record of (await listReferences(dataDir)).items) {
    docs.push(referenceToSearchDoc(record.slug, record.reference));
  }
  for (const record of (await listSnippets(dataDir)).items) {
    docs.push(snippetToSearchDoc(record.slug, record.snippet));
  }
  for (const record of await safeContexts(dataDir)) {
    docs.push(contextToSearchDoc(record.slug, record.context));
  }
  for (const record of (await listRecipes(dataDir)).items) {
    docs.push(recipeToSearchDoc(record.slug, record.recipe));
  }

  docs.sort(
    (a, b) =>
      (DATASET_ORDER.get(a.dataset) ?? 0) - (DATASET_ORDER.get(b.dataset) ?? 0) ||
      compareText(a.id, b.id),
  );
  return { generatedAt: new Date().toISOString(), docs };
}
