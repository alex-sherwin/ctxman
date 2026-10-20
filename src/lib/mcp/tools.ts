// SERVER (no astro:*): the MCP tools of the embedded /mcp endpoint (plans/CORE_REFACTOR_PLAN.md §8). Every tool is a
// plain async function `(args, ctx) => ToolResult`; server.ts registers them with the SDK (arktype Types as
// Standard Schema input), tests call them directly. All data comes from the disk through the same libs the pages
// and API routes use, so a write shows on the very next read. Results are markdown `content` PLUS
// `structuredContent` (JSON); bodies are clipped at MAX_TEXT_CHARS with a note. Errors never throw out of a tool:
// they become `isError: true` results whose text starts `code: message`.
import { readFile } from 'node:fs/promises';
import { type } from 'arktype';
import type { Type } from 'arktype';
import Fuse from 'fuse.js';
import type { FuseResult } from 'fuse.js';
import {
  DATASETS,
  DATASET_IDS,
  LINKABLE_DATASETS,
  NAME_MAX_LENGTH,
  NAME_PATTERN,
  OKF_DATASET_IDS,
  OWNERS,
  REFERENCE_TYPES,
  datasetDef,
  entryUrl,
  isOkfDatasetId,
  isValidName,
} from '../../datasets/registry.ts';
import type { DatasetId } from '../../datasets/registry.ts';
import { listBundleFiles, MAX_TEXT_BYTES, resolveBundleFile } from '../bundles.ts';
import { ContextIoError, appendContextLinks } from '../context-io.ts';
import { DataDirError, resolveDataDir, resolveServerOrigin } from '../data-dir.ts';
import { appendLog, DocIoError } from '../doc-io.ts';
import { filterEntries } from '../entry-filter.ts';
import { getEntryIndex, invalidateEntryIndex } from '../entry-index.ts';
import { EntryCreateError, writePlannedEntry } from '../entry-create.ts';
import { EntryIoError, createEntry, patchEntry, toJsonSafe } from '../entry-io.ts';
import {
  buildSearchIndex,
  getEntryDetail,
  getRelationGraph,
  listAllEntries,
  listEntries,
} from '../entries.ts';
import type { EntryDetail, EntryRelations, RelationRow } from '../entries.ts';
import type { EntrySummary, SearchDoc } from '../entry-summary.ts';
import { checkCollections } from '../collections-check.ts';
import { formatReport, toReport } from '../findings.ts';
import type { Finding, Report } from '../findings.ts';
import { entryFileRelPath } from '../freshness.ts';
import { createFsSources } from '../inflate/fs-sources.ts';
import { INFLATE_LAYOUTS, INFLATE_TARGETS } from '../inflate/catalog.ts';
import { inflateRecipe } from '../inflate/pipeline.ts';
import { parseRecipe } from '../inflate/recipe.ts';
import type { RecipeData } from '../../datasets/schemas.ts';
import { checkLinks } from '../links.ts';
import { checkOkf } from '../okf.ts';
import { RecipeIoError, readRecipe } from '../recipe-io.ts';
import { ReferenceIoError } from '../reference-io.ts';
import { SnippetIoError } from '../snippet-io.ts';
import { childrenOf } from '../relations.ts';
import { FUSE_OPTIONS, MIN_QUERY } from '../search-config.ts';
import { buildTagIndex, searchDocs } from '../search-query.ts';
import { planNewEntry } from '../templates.ts';
import { todayYmd } from '../time.ts';
import { stringifyYaml } from '../yaml.ts';
import { docUri, entryUri } from './resources.ts';

// ---------------------------------------------------------------- context + result shapes

/** What every tool needs; built once per HTTP request (`buildToolContext`). */
export interface ToolContext {
  dataDir: string;
  nowMs: number;
  /** Origin of the running app (`CTXMAN_SERVER_ORIGIN`): prefix of the page URLs and the yaml schema modeline. */
  serverOrigin: string;
}

/** Throws DataDirError when `CTXMAN_DATA_DIR` is unset (the middleware answers 503 before a route gets here). */
export function buildToolContext(nowMs: number = Date.now()): ToolContext {
  return { dataDir: resolveDataDir(), nowMs, serverOrigin: resolveServerOrigin() };
}

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /** An arktype Type that stays JSON-Schema-expressible (no `.narrow`, no morphs). */
  input: Type<object>;
  /** false = the tool writes under the data dir. */
  readOnly: boolean;
  /** `args` have been validated against `input` by the SDK; tests may pass plain objects. */
  handler: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
}

/** Longest text a tool puts into one result before it clips (about 12k tokens). */
export const MAX_TEXT_CHARS = 50_000;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 200;
const SNIPPET_CHARS = 200;
const FINDINGS_SHOWN = 100;

function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

export function failure(
  code: string,
  message: string,
  issues: readonly { path: string; message: string }[] = [],
): ToolResult {
  const lines = [`${code}: ${message}`];
  for (const issue of issues)
    lines.push(`- ${issue.path === '' ? '(root)' : issue.path}: ${issue.message}`);
  const structured: Record<string, unknown> = { error: code, message };
  if (issues.length > 0) structured.issues = issues;
  return {
    content: [{ type: 'text', text: lines.join('\n') }],
    structuredContent: structured,
    isError: true,
  };
}

/** io-module failures -> `code: message` results; anything else is an `internal` error with its message. */
export function toFailure(error: unknown): ToolResult {
  if (error instanceof DataDirError) return failure('data-dir', error.message);
  if (
    error instanceof EntryIoError ||
    error instanceof ContextIoError ||
    error instanceof RecipeIoError ||
    error instanceof ReferenceIoError ||
    error instanceof SnippetIoError ||
    error instanceof DocIoError
  ) {
    return failure(error.code, error.message, error.issues);
  }
  if (error instanceof EntryCreateError) {
    return failure(
      error.code,
      error.message,
      error.problems.map((problem) => ({ path: '', message: problem })),
    );
  }
  return failure('internal', error instanceof Error ? error.message : String(error));
}

function defineTool<I extends Type<object>>(def: {
  name: string;
  title: string;
  description: string;
  input: I;
  readOnly: boolean;
  handler: (args: I['infer'], ctx: ToolContext) => Promise<ToolResult>;
}): ToolDef {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    input: def.input,
    readOnly: def.readOnly,
    handler: async (args, ctx) => {
      try {
        return await def.handler(args as I['infer'], ctx);
      } catch (error) {
        return toFailure(error);
      }
    },
  };
}

// ---------------------------------------------------------------- input types

// Only JSON-Schema-expressible constraints (arktype's toJsonSchema throws on predicates): no `.narrow`, no morphs.
const nameType = type(NAME_PATTERN).and(`string <= ${NAME_MAX_LENGTH}`);
const datasetType = type.enumerated(...DATASET_IDS);
const linkableType = type.enumerated(...LINKABLE_DATASETS);
const entryDatasetType = type.enumerated(...OKF_DATASET_IDS, 'skill');
const okfDatasetType = type.enumerated(...OKF_DATASET_IDS);
const limitType = type(`1 <= number.integer <= ${MAX_LIMIT}`).describe(
  `Maximum rows (default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}).`,
);
const offsetType = type('number.integer >= 0').describe(
  'Character offset to continue a clipped text (use the nextOffset of the previous call).',
);
const relType = type.enumerated('child', 'related', 'depends-on');
const linkRefType = type({ '+': 'reject', dataset: linkableType, slug: nameType });
const entryLinkInput = type({
  '+': 'reject',
  dataset: linkableType,
  slug: nameType,
  'rel?': relType,
});
const noInput = type({ '+': 'reject' });

// ---------------------------------------------------------------- shared helpers

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

function truncate(value: string, max: number): string {
  const text = oneLine(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

interface Clipped {
  text: string;
  start: number;
  end: number;
  total: number;
  truncated: boolean;
}

function clip(text: string, offset: number = 0, max: number = MAX_TEXT_CHARS): Clipped {
  const total = text.length;
  const start = Math.min(Math.max(0, offset), total);
  const end = Math.min(total, start + max);
  return { text: text.slice(start, end), start, end, total, truncated: end < total };
}

const keyOf = (dataset: string, slug: string): string => `${dataset}/${slug}`;
const pageUrl = (ctx: ToolContext, dataset: DatasetId, slug: string): string =>
  `${ctx.serverOrigin}${entryUrl(dataset, slug)}`;

function limitOf(value: number | undefined): number {
  return Math.min(MAX_LIMIT, Math.max(1, value ?? DEFAULT_LIMIT));
}

/** A summary reduced to what an agent reads (no `name`, `relations`, empty fields). */
function compactSummary(s: EntrySummary): Record<string, unknown> {
  const out: Record<string, unknown> = {
    dataset: s.dataset,
    slug: s.slug,
    title: s.title ?? s.name,
    description: s.description,
    lastModified: s.lastModified,
    url: s.url,
  };
  if (s.state !== undefined) out.state = s.state;
  if (s.tags.length > 0) out.tags = s.tags;
  if (s.stale) out.stale = true;
  if (s.staleAfter !== undefined) out.staleAfter = s.staleAfter;
  if (s.okfStatus !== undefined) out.okfStatus = s.okfStatus;
  if (s.refType !== undefined) out.refType = s.refType;
  if (s.uriKind !== undefined) out.uriKind = s.uriKind;
  if (s.owner !== undefined) out.owner = s.owner;
  if (s.subpath !== undefined) out.subpath = s.subpath;
  if (s.linkCount !== undefined) out.linkCount = s.linkCount;
  if (s.recipeTarget !== undefined) out.recipeTarget = s.recipeTarget;
  if (s.contextCount !== undefined) out.contextCount = s.contextCount;
  if (s.itemCount !== undefined) out.itemCount = s.itemCount;
  if (s.invalid !== undefined) out.invalid = s.invalid;
  return out;
}

function summaryLine(s: EntrySummary): string {
  const state = s.state === undefined ? '' : ` [${s.state}]`;
  const flags = [s.stale ? 'stale' : '', s.invalid === undefined ? '' : 'invalid'].filter(Boolean);
  const flag = flags.length === 0 ? '' : ` (${flags.join(', ')})`;
  const title = s.title !== undefined && s.title !== s.name ? `${s.title}: ` : '';
  return `- \`${keyOf(s.dataset, s.slug)}\`${state}${flag} ${title}${truncate(s.description, 160)}`;
}

function moreNote(shown: number, total: number): string {
  return shown < total
    ? `\n\n… ${total - shown} more not shown (raise limit or narrow the query).`
    : '';
}

// ---------------------------------------------------------------- search

function snippetFor(doc: SearchDoc, matches: FuseResult<SearchDoc>['matches']): string {
  const preferred = ['body', 'description', 'headings'];
  for (const key of preferred) {
    const match = matches?.find((m) => m.key === key && typeof m.value === 'string');
    const value = match?.value;
    if (match === undefined || value === undefined || match.indices.length === 0) continue;
    const best = match.indices.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
    const from = Math.max(0, best[0] - 70);
    const to = Math.min(value.length, from + SNIPPET_CHARS);
    const slice = oneLine(value.slice(from, to));
    return `${from > 0 ? '…' : ''}${slice}${to < value.length ? '…' : ''}`.slice(
      0,
      SNIPPET_CHARS + 2,
    );
  }
  return truncate(doc.description, SNIPPET_CHARS);
}

const searchTool = defineTool({
  name: 'search',
  title: 'Search entries',
  description:
    'Fuzzy-search every entry and every concept file of every dataset (kb, rca, idea, task, bug, feature, project, skill, reference, snippet, context, recipe), the same search as the ctxman UI. A `#tag` token keeps only files whose frontmatter tags include that tag exactly (several = all of them); the other words are the fuzzy query, and `#tag` alone lists every file with the tag. Returns ranked hits with an excerpt. Start here, then call get-entry or read-bundle-file.',
  readOnly: true,
  input: type({
    '+': 'reject',
    query: type('string >= 2').describe(
      'Search text (at least 2 characters); `#tag` tokens match tags exactly.',
    ),
    'datasets?': datasetType.array().describe('Restrict to these datasets (default: all).'),
    'limit?': limitType,
  }),
  async handler(args, ctx) {
    const query = args.query.trim();
    if (query.length < MIN_QUERY) {
      return failure('invalid', `query must have at least ${MIN_QUERY} characters`);
    }
    const limit = limitOf(args.limit);
    const wanted =
      args.datasets === undefined || args.datasets.length === 0
        ? null
        : new Set<string>(args.datasets);
    const docs = (await buildSearchIndex(ctx.dataDir)).docs.filter(
      (doc) => wanted === null || wanted.has(doc.dataset),
    );
    const results = searchDocs(
      new Fuse(docs, FUSE_OPTIONS),
      docs,
      buildTagIndex(docs),
      query,
      limit,
    );
    const hits = results.map((result) => {
      const doc = result.item;
      const score = Math.round((1 - (result.score ?? 1)) * 1000) / 1000;
      return {
        id: doc.id,
        dataset: doc.dataset,
        slug: doc.slug,
        path: doc.path,
        title: doc.title,
        description: truncate(doc.description, 240),
        url: `${ctx.serverOrigin}${doc.url}`,
        resource:
          doc.path === null
            ? entryUri(doc.dataset, doc.slug)
            : docUri(doc.dataset, doc.slug, doc.path),
        score,
        snippet: snippetFor(doc, result.matches),
      };
    });
    const text =
      hits.length === 0
        ? `No results for "${query}".`
        : [
            `${hits.length} result(s) for "${query}" (score 0-1, higher is better):`,
            '',
            ...hits.map(
              (hit) =>
                `- \`${hit.id}\` ${hit.title} (${hit.score}) ${hit.path === null ? '' : `[file ${hit.path}] `}${hit.snippet === '' ? '' : `— ${hit.snippet}`}`,
            ),
          ].join('\n');
    return ok(text, { query, count: hits.length, hits });
  },
});

// ---------------------------------------------------------------- list-datasets / list-entries

const listDatasetsTool = defineTool({
  name: 'list-datasets',
  title: 'List datasets',
  description:
    'The 12 datasets with their kind, lifecycle states, entry file layout and entry count. Call once to learn what exists.',
  readOnly: true,
  input: noInput,
  async handler(_args, ctx) {
    const all = await listAllEntries(ctx.nowMs, ctx.dataDir);
    const datasets = DATASETS.map((def) => ({
      id: def.id,
      label: def.label,
      kind: def.kind,
      description: def.description,
      states: def.states?.map((s) => s.id) ?? [],
      entryFile:
        def.kind === 'data' ? `${def.id}/<name>.yaml` : `${def.id}/<name>/${def.entryFile}`,
      count: all[def.id].length,
    }));
    const text = [
      '| dataset | kind | entries | states | entry file |',
      '| --- | --- | --- | --- | --- |',
      ...datasets.map(
        (d) =>
          `| ${d.id} | ${d.kind} | ${d.count} | ${d.states.join(', ') || '-'} | \`${d.entryFile}\` |`,
      ),
    ].join('\n');
    return ok(text, { datasets });
  },
});

const listEntriesTool = defineTool({
  name: 'list-entries',
  title: 'List entries',
  description:
    'Entries of one dataset, filtered like the UI lists (q = all words must appear in name, title, description or tags; state = any of; tag = all of; project = the children of that project). Newest first unless sorted.',
  readOnly: true,
  input: type({
    '+': 'reject',
    dataset: datasetType,
    'q?': type('string').describe('Whitespace-separated words, all must match.'),
    'state?': type('string').array().describe('Keep entries in any of these lifecycle states.'),
    'tag?': type('string').array().describe('Keep entries carrying all of these tags.'),
    'project?': nameType.describe(
      'Only the children of this project (a `child` link of the project).',
    ),
    'type?': type
      .enumerated(...REFERENCE_TYPES)
      .describe('reference dataset only: the reference type.'),
    'sort?': type.enumerated('modified', 'name', 'state'),
    'limit?': limitType,
  }),
  async handler(args, ctx) {
    const limit = limitOf(args.limit);
    let keys: ReadonlySet<string> | null = null;
    if (args.project !== undefined) {
      keys = new Set(
        childrenOf(await getRelationGraph(ctx.dataDir), keyOf('project', args.project)),
      );
    }
    const all = await listEntries(args.dataset, ctx.nowMs, ctx.dataDir);
    const rows = filterEntries(all, {
      ...(args.q === undefined ? {} : { q: args.q }),
      ...(args.state === undefined ? {} : { states: args.state }),
      ...(args.tag === undefined ? {} : { tags: args.tag }),
      ...(args.type === undefined ? {} : { type: args.type }),
      ...(args.sort === undefined ? {} : { sort: args.sort }),
      keys,
    });
    const shown = rows.slice(0, limit);
    const text =
      rows.length === 0
        ? `No ${datasetDef(args.dataset).plural} match.`
        : `${rows.length} ${datasetDef(args.dataset).plural} (showing ${shown.length}):\n\n${shown.map(summaryLine).join('\n')}${moreNote(shown.length, rows.length)}`;
    return ok(text, {
      dataset: args.dataset,
      total: rows.length,
      shown: shown.length,
      entries: shown.map(compactSummary),
    });
  },
});

// ---------------------------------------------------------------- get-entry

function compactRows(rows: readonly RelationRow[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {
      rel: row.rel,
      label: row.label,
      entry: row.key,
      title: row.title,
    };
    if (row.state !== undefined) out.state = row.state;
    if (row.missing) out.missing = true;
    return out;
  });
}

function relationsText(relations: EntryRelations): string[] {
  const line = (row: RelationRow): string =>
    `- ${row.label}: \`${row.key}\`${row.state === undefined ? '' : ` [${row.state}]`} ${row.title === row.slug ? '' : row.title}${row.missing ? ' (missing)' : ''}`.trimEnd();
  const out: string[] = [];
  if (relations.linksTo.length > 0) out.push('', '## Links to', ...relations.linksTo.map(line));
  if (relations.linkedFrom.length > 0)
    out.push('', '## Linked from', ...relations.linkedFrom.map(line));
  return out;
}

function frontmatterText(frontmatter: Record<string, unknown>): string {
  return ['```yaml', stringifyYaml(frontmatter).trimEnd(), '```'].join('\n');
}

const getEntryTool = defineTool({
  name: 'get-entry',
  title: 'Get entry',
  description:
    'One entry: frontmatter and markdown body (okf and skill), the yaml data (reference, snippet, context, recipe; a snippet also its markdown), its relations (links to, linked from, children, parents), bundle files and the contexts that link to it. Bodies over 50 KB are clipped; read the rest with read-bundle-file.',
  readOnly: true,
  input: type({
    '+': 'reject',
    dataset: datasetType,
    slug: nameType,
    'includeBody?': type('boolean').describe('Include the markdown body (default true).'),
  }),
  async handler(args, ctx) {
    const detail = await getEntryDetail(args.dataset, args.slug, ctx.nowMs, ctx.dataDir);
    if (detail === null)
      return failure('not-found', `${args.dataset} "${args.slug}" does not exist`);
    const includeBody = args.includeBody !== false;
    const s = detail.summary;
    const structured: Record<string, unknown> = {
      dataset: s.dataset,
      slug: s.slug,
      title: s.title ?? s.name,
      description: s.description,
      path: detail.fileRelPath,
      url: pageUrl(ctx, s.dataset, s.slug),
      resource: entryUri(s.dataset, s.slug),
      lastModified: s.lastModified,
    };
    if (s.state !== undefined) structured.state = s.state;
    if (s.tags.length > 0) structured.tags = s.tags;
    if (s.stale) structured.stale = true;
    if (s.invalid !== undefined) structured.invalid = s.invalid;
    if (detail.backRefs.length > 0) structured.linkedFromContexts = detail.backRefs;

    const out: string[] = [
      `# ${s.title ?? s.name}`,
      '',
      `\`${keyOf(s.dataset, s.slug)}\` — ${s.description}`,
    ];
    out.push(
      '',
      `file \`${detail.fileRelPath}\`, modified ${s.lastModified}, ${structured.url as string}`,
    );
    if (s.invalid !== undefined) {
      out.push(
        '',
        'INVALID FILE:',
        ...s.invalid.map((i) => `- ${i.path === '' ? '(root)' : i.path}: ${i.message}`),
      );
    }

    if (detail.kind === 'okf' || detail.kind === 'skill') {
      const indexed = (await getEntryIndex(ctx.dataDir)).byKey.get(keyOf(s.dataset, s.slug));
      const frontmatter = toJsonSafe(indexed?.data ?? detail.data) as Record<string, unknown>;
      structured.frontmatter = frontmatter;
      out.push('', frontmatterText(frontmatter));
      if (includeBody) {
        const body = clip(indexed?.body ?? '');
        structured.body = body.text;
        if (body.truncated) {
          structured.bodyTruncated = { shown: body.end, total: body.total };
          out.push(
            '',
            body.text,
            '',
            `… (truncated, ${body.total - body.end} more characters; page through the whole file with read-bundle-file, path "${datasetDef(s.dataset).entryFile}", offset)`,
          );
        } else {
          out.push('', body.text.trim());
        }
      }
      structured.relations = {
        linksTo: compactRows(detail.relations.linksTo),
        linkedFrom: compactRows(detail.relations.linkedFrom),
        ...(detail.relations.children === undefined
          ? {}
          : { children: compactRows(detail.relations.children) }),
        parents: compactRows(detail.relations.parents),
      };
      out.push(...relationsText(detail.relations));
      structured.files = detail.files.map((f) => ({ path: f.path, size: f.size, kind: f.kind }));
      out.push(
        '',
        '## Files',
        ...detail.files.map((f) => `- \`${f.path}\` (${f.kind}, ${f.size} bytes)`),
      );
    } else if (detail.kind === 'reference') {
      structured.data = detail.data;
      out.push('', frontmatterText(detail.data as Record<string, unknown>));
      structured.relations = {
        linksTo: compactRows(detail.relations.linksTo),
        linkedFrom: compactRows(detail.relations.linkedFrom),
        parents: compactRows(detail.relations.parents),
      };
      out.push(...relationsText(detail.relations));
    } else if (detail.kind === 'snippet') {
      structured.data = detail.data;
      const { markdown, ...rest } = detail.data;
      out.push('', frontmatterText(rest), '', markdown.trim());
      structured.relations = {
        linksTo: compactRows(detail.relations.linksTo),
        linkedFrom: compactRows(detail.relations.linkedFrom),
        parents: compactRows(detail.relations.parents),
      };
      out.push(...relationsText(detail.relations));
    } else if (detail.kind === 'context') {
      structured.data = detail.data;
      structured.links = contextLinks(detail);
      out.push('', ...contextLinesText(detail));
    } else {
      structured.data = detail.data;
      structured.contexts = detail.contexts.map(({ slug, missing, description, linkCount }) => ({
        slug,
        missing,
        ...(description === undefined ? {} : { description }),
        ...(linkCount === undefined ? {} : { linkCount }),
      }));
      structured.items = detail.items.map(({ dataset, slug, title, missing }) => ({
        dataset,
        slug,
        ...(title === undefined ? {} : { title }),
        missing,
      }));
      out.push('', frontmatterText(detail.data as Record<string, unknown>));
    }
    if (detail.backRefs.length > 0) {
      out.push(
        '',
        '## Linked from contexts',
        ...detail.backRefs.map(
          (ref) => `- \`context/${ref.context}\` ${truncate(ref.description, 120)}`,
        ),
      );
    }
    return ok(out.join('\n'), structured);
  },
});

type ContextDetail = Extract<EntryDetail, { kind: 'context' }>;

function contextLinks(detail: ContextDetail): Record<string, unknown>[] {
  return detail.links.map((link) => {
    const out: Record<string, unknown> = {
      dataset: link.dataset,
      slug: link.slug,
      missing: link.missing,
    };
    if (link.title !== undefined) out.title = link.title;
    if (link.state !== undefined) out.state = link.state;
    if (link.notes !== undefined) out.notes = link.notes;
    return out;
  });
}

function contextLinesText(detail: ContextDetail): string[] {
  if (detail.links.length === 0) return ['No links yet.'];
  return [
    '## Links',
    ...detail.links.map((link) => {
      const state = link.state === undefined ? '' : ` [${link.state}]`;
      const title = link.title === undefined ? '' : ` ${link.title}`;
      const notes = link.notes === undefined ? '' : `\n  notes: ${truncate(link.notes, 300)}`;
      return `- \`${keyOf(link.dataset, link.slug)}\`${state}${title}${link.missing ? ' (missing)' : ''}${notes}`;
    }),
  ];
}

const getContextTool = defineTool({
  name: 'get-context',
  title: 'Get context',
  description:
    'A context (an evergreen set of links to entries): its description and every link resolved to the target title, state, missing flag and the context-specific notes.',
  readOnly: true,
  input: type({ '+': 'reject', slug: nameType }),
  async handler(args, ctx) {
    const detail = await getEntryDetail('context', args.slug, ctx.nowMs, ctx.dataDir);
    if (detail === null || detail.kind !== 'context') {
      return failure('not-found', `context "${args.slug}" does not exist`);
    }
    const s = detail.summary;
    const text = [
      `# context/${s.slug}`,
      '',
      s.description,
      '',
      `${detail.links.length} link(s), modified ${s.lastModified}`,
      '',
      ...contextLinesText(detail),
    ].join('\n');
    return ok(text, {
      slug: s.slug,
      description: s.description,
      tags: s.tags,
      lastModified: s.lastModified,
      url: pageUrl(ctx, 'context', s.slug),
      links: contextLinks(detail),
    });
  },
});

// ---------------------------------------------------------------- bundle files

const listBundleFilesTool = defineTool({
  name: 'list-bundle-files',
  title: 'List bundle files',
  description:
    'Every file of an okf bundle or skill directory (concepts, index, log, scripts, references) with size, kind and mtime. Read one with read-bundle-file.',
  readOnly: true,
  input: type({ '+': 'reject', dataset: entryDatasetType, slug: nameType }),
  async handler(args, ctx) {
    const files = await listBundleFiles(args.dataset, args.slug, ctx.dataDir);
    if (files.length === 0)
      return failure('not-found', `${args.dataset} "${args.slug}" has no files (does it exist?)`);
    const text = [
      `${files.length} file(s) in \`${keyOf(args.dataset, args.slug)}\`:`,
      '',
      ...files.map(
        (f) =>
          `- \`${f.path}\` (${f.kind}, ${f.size} bytes${f.role === undefined ? '' : `, ${f.role}`})`,
      ),
    ].join('\n');
    return ok(text, {
      dataset: args.dataset,
      slug: args.slug,
      files: files.map((f) => ({
        path: f.path,
        size: f.size,
        kind: f.kind,
        mtime: f.mtime,
        ...(f.role === undefined ? {} : { role: f.role }),
        resource: docUri(args.dataset, args.slug, f.path),
      })),
    });
  },
});

/** Reads one text file of a bundle (safeJoin + realpath inside the bundle, 512 KB cap); shared with the resources. */
export async function readBundleFileText(
  dataset: 'skill' | (typeof OKF_DATASET_IDS)[number],
  slug: string,
  relPath: string,
  dataDir: string,
): Promise<{ ok: true; text: string; lastModified: string } | { ok: false; result: ToolResult }> {
  const file = await resolveBundleFile(dataset, slug, relPath, dataDir);
  if (!file.ok) {
    const message: Record<string, string> = {
      'bad-path': `"${relPath}" is not a safe bundle-relative path`,
      'no-entry': `${dataset} "${slug}" does not exist`,
      'not-found': `${relPath} does not exist in ${dataset}/${slug}`,
      outside: `${relPath} resolves outside the bundle`,
    };
    return { ok: false, result: failure(file.reason, message[file.reason] ?? file.reason) };
  }
  if (file.size > MAX_TEXT_BYTES) {
    return {
      ok: false,
      result: failure('too-large', `${relPath} is ${file.size} bytes (limit ${MAX_TEXT_BYTES})`),
    };
  }
  const buf = await readFile(file.realAbs);
  if (buf.includes(0))
    return { ok: false, result: failure('not-text', `${relPath} is not a text file`) };
  return { ok: true, text: buf.toString('utf8'), lastModified: file.mtime.toISOString() };
}

const readBundleFileTool = defineTool({
  name: 'read-bundle-file',
  title: 'Read bundle file',
  description:
    'The text of one file of an okf bundle or skill (e.g. index.md (the okf entry), concepts/search.md, log.md, SKILL.md, scripts/x.ts), up to 512 KB. Output over 50 KB is clipped; pass offset to continue.',
  readOnly: true,
  input: type({
    '+': 'reject',
    dataset: entryDatasetType,
    slug: nameType,
    path: type('string >= 1').describe(
      'Bundle-relative path with extension, e.g. concepts/search.md.',
    ),
    'offset?': offsetType,
  }),
  async handler(args, ctx) {
    const read = await readBundleFileText(args.dataset, args.slug, args.path, ctx.dataDir);
    if (!read.ok) return read.result;
    const page = clip(read.text, args.offset);
    const note = page.truncated
      ? `\n\n… (truncated, ${page.total - page.end} more characters; call again with offset ${page.end})`
      : '';
    return ok(`${page.text}${note}`, {
      dataset: args.dataset,
      slug: args.slug,
      path: args.path,
      lastModified: read.lastModified,
      resource: docUri(args.dataset, args.slug, args.path),
      text: page.text,
      offset: page.start,
      total: page.total,
      ...(page.truncated ? { nextOffset: page.end } : {}),
    });
  },
});

// ---------------------------------------------------------------- render-recipe

const renderRecipeTool = defineTool({
  name: 'render-recipe',
  title: 'Render recipe',
  description:
    'Context Inflate: expand a saved recipe (recipe) OR an ad hoc composition (contexts, items, target, layout, preamble) into the one markdown brief the /inflate page generates, plus a manifest summary and warnings. Never writes anything. Output over 50 KB is clipped; pass offset to continue.',
  readOnly: true,
  input: type({
    '+': 'reject',
    'recipe?': nameType.describe('Slug of a saved recipe. Give this OR the composition fields.'),
    'contexts?': nameType.array().describe('Context slugs (ad hoc).'),
    'items?': linkRefType.array().describe('Extra entries {dataset, slug} (ad hoc).'),
    'target?': type.enumerated(...INFLATE_TARGETS),
    'layout?': type.enumerated(...INFLATE_LAYOUTS),
    'preamble?': type('string').describe('Markdown placed at the top of the document (ad hoc).'),
    'offset?': offsetType,
  }),
  async handler(args, ctx) {
    const adHoc =
      args.contexts !== undefined ||
      args.items !== undefined ||
      args.target !== undefined ||
      args.layout !== undefined ||
      args.preamble !== undefined;
    let recipe: RecipeData;
    if (args.recipe !== undefined) {
      if (adHoc)
        return failure(
          'invalid',
          'give either recipe or the composition fields (contexts, items, target, layout, preamble), not both',
        );
      recipe = (await readRecipe(args.recipe, ctx.dataDir)).recipe;
    } else {
      if (!adHoc)
        return failure(
          'invalid',
          'give recipe (a saved recipe slug) or at least one of contexts, items',
        );
      const parsed = parseRecipe({
        name: 'mcp-adhoc',
        description: 'Ad hoc composition rendered through MCP.',
        ...(args.target === undefined ? {} : { target: args.target }),
        ...(args.layout === undefined ? {} : { layout: args.layout }),
        contexts: args.contexts ?? [],
        items: args.items ?? [],
        ...(args.preamble === undefined ? {} : { preamble: args.preamble }),
      });
      if (!parsed.ok)
        return failure('invalid', 'composition does not match the recipe schema', parsed.issues);
      recipe = parsed.recipe;
    }
    const result = await inflateRecipe(
      recipe,
      createFsSources({ dataDir: ctx.dataDir, nowMs: ctx.nowMs }),
      new Date(ctx.nowMs),
    );
    const page = clip(result.markdown, args.offset);
    const m = result.manifest;
    const text = page.truncated
      ? `${page.text}\n\n… (truncated, ${page.total - page.end} more characters; call again with offset ${page.end})`
      : page.text;
    return ok(text, {
      recipe: m.recipe,
      target: m.target,
      layout: m.layout,
      generatedAt: m.generatedAt,
      bytes: m.bytes,
      counts: m.counts,
      contexts: m.contexts,
      segments: m.segments.map((seg) => ({
        key: seg.key,
        type: seg.type,
        title: seg.title,
        status: seg.status,
        bytes: seg.bytes,
        ...(seg.mode === undefined ? {} : { mode: seg.mode }),
      })),
      warnings: m.warnings,
      offset: page.start,
      total: page.total,
      ...(page.truncated ? { nextOffset: page.end } : {}),
    });
  },
});

// ---------------------------------------------------------------- check-data

const CHECKS = {
  okf: { title: 'OKF', run: checkOkf },
  links: { title: 'Links', run: checkLinks },
  collections: { title: 'Collections', run: checkCollections },
} as const;

const checkDataTool = defineTool({
  name: 'check-data',
  title: 'Check data',
  description:
    'Run the data compliance checks in-process (the same as `pnpm run check:data`): okf (bundle structure), links (broken links, relations), collections (schemas of every file). Returns the findings; errors fail the check, warnings do not.',
  readOnly: true,
  input: type({
    '+': 'reject',
    'scope?': type
      .enumerated('okf', 'links', 'collections')
      .array()
      .describe('Checks to run (default: all three).'),
  }),
  async handler(args, ctx) {
    const scope =
      args.scope === undefined || args.scope.length === 0
        ? (['okf', 'links', 'collections'] as const)
        : [...new Set(args.scope)];
    const reports: Record<string, Report> = {};
    const findings: (Finding & { check: string })[] = [];
    for (const name of scope) {
      const check = CHECKS[name];
      const result = await check.run(ctx.dataDir);
      reports[name] = toReport(result.findings, result.filesChecked);
      for (const f of reports[name].findings) findings.push({ ...f, check: name });
    }
    const errors = Object.values(reports).reduce((n, r) => n + r.errors, 0);
    const warnings = Object.values(reports).reduce((n, r) => n + r.warnings, 0);
    const shown = findings.slice(0, FINDINGS_SHOWN);
    const text = [
      ...scope.map((name) =>
        formatReport(CHECKS[name].title, {
          ...reports[name]!,
          findings: reports[name]!.findings.slice(0, FINDINGS_SHOWN),
        }),
      ),
      findings.length > shown.length
        ? `… ${findings.length - shown.length} more findings not shown`
        : '',
      errors === 0 && warnings === 0
        ? 'All checks: OK'
        : `All checks: ${errors} errors, ${warnings} warnings`,
    ]
      .filter((line) => line !== '')
      .join('\n');
    return ok(text, {
      ok: errors === 0,
      errors,
      warnings,
      checks: Object.fromEntries(
        scope.map((name) => {
          const r = reports[name]!;
          return [
            name,
            { ok: r.ok, errors: r.errors, warnings: r.warnings, filesChecked: r.filesChecked },
          ];
        }),
      ),
      findings: shown,
      findingsTotal: findings.length,
    });
  },
});

// ---------------------------------------------------------------- write tools

const createEntryTool = defineTool({
  name: 'create-entry',
  title: 'Create entry',
  description:
    'WRITES to the data dir. Create a new entry of any dataset from the standard template (the same as the /new form and `pnpm run add:<dataset>`); never overwrites. okf: title, state, tags, parent (a project that gets a child link) apply. reference: type (local-repo | local-folder | remote-repo | remote-skill), path or uri, subpath, owner. snippet: markdown (the reusable text). context and recipe start empty (add links with append-context-links).',
  readOnly: false,
  input: type({
    '+': 'reject',
    dataset: datasetType,
    name: nameType.describe('Slug; becomes the directory / file name.'),
    description: type('string >= 1').describe('One-line description.'),
    'title?': 'string',
    'state?': type('string').describe('Lifecycle datasets only; default is the first state.'),
    'tags?': type('string').array(),
    'parent?': nameType.describe(
      'okf only: an existing project that gets a child link to the new entry.',
    ),
    'type?': type.enumerated(...REFERENCE_TYPES),
    'path?': 'string',
    'uri?': 'string',
    'subpath?': 'string',
    'owner?': type.enumerated(...OWNERS),
    'markdown?': type('string').describe(
      'snippet only: the markdown of the snippet (default: a TODO placeholder).',
    ),
  }),
  async handler(args, ctx) {
    const def = datasetDef(args.dataset);
    const referenceOnly = (['type', 'path', 'uri', 'subpath', 'owner'] as const).filter(
      (k) => args[k] !== undefined,
    );
    if (args.dataset !== 'reference' && referenceOnly.length > 0) {
      return failure('invalid', `${referenceOnly.join(', ')} only apply to the reference dataset`);
    }
    if (args.dataset !== 'snippet' && args.markdown !== undefined) {
      return failure('invalid', 'markdown only applies to the snippet dataset');
    }
    let created: {
      dataset: DatasetId;
      slug: string;
      path: string;
      url: string;
      files: string[];
      parentLinked?: boolean;
      parentError?: string;
    };
    if (def.kind === 'data') {
      const bad = (['title', 'state', 'tags', 'parent'] as const).filter(
        (k) => args[k] !== undefined,
      );
      if (bad.length > 0)
        return failure('invalid', `${bad.join(', ')} do not apply to ${def.plural}`);
      let planned;
      try {
        planned = planNewEntry(args.dataset, args.name, {
          description: args.description,
          ...(args.type === undefined ? {} : { type: args.type }),
          ...(args.path === undefined ? {} : { path: args.path }),
          ...(args.uri === undefined ? {} : { uri: args.uri }),
          ...(args.subpath === undefined ? {} : { subpath: args.subpath }),
          ...(args.owner === undefined ? {} : { owner: args.owner }),
          ...(args.markdown === undefined ? {} : { markdown: args.markdown }),
          serverOrigin: ctx.serverOrigin,
          now: new Date(ctx.nowMs),
        });
      } catch (error) {
        return failure('invalid', error instanceof Error ? error.message : String(error));
      }
      const files = await writePlannedEntry(args.dataset, args.name, planned, ctx.dataDir);
      created = {
        dataset: args.dataset,
        slug: args.name,
        path: entryFileRelPath(args.dataset, args.name),
        url: entryUrl(args.dataset, args.name),
        files,
      };
    } else {
      created = await createEntry(
        args.dataset,
        {
          name: args.name,
          description: args.description,
          ...(args.title === undefined ? {} : { title: args.title }),
          ...(args.state === undefined ? {} : { state: args.state }),
          ...(args.tags === undefined ? {} : { tags: args.tags }),
          ...(args.parent === undefined ? {} : { parent: args.parent }),
        },
        ctx.dataDir,
        new Date(ctx.nowMs),
      );
    }
    invalidateEntryIndex(ctx.dataDir);
    const detail = await getEntryDetail(created.dataset, created.slug, ctx.nowMs, ctx.dataDir);
    const lines = [
      `Created \`${keyOf(created.dataset, created.slug)}\` (${created.path}).`,
      `Files: ${created.files.map((f) => `\`${f}\``).join(', ')}`,
      `Page: ${ctx.serverOrigin}${created.url}`,
    ];
    if (created.parentLinked === true)
      lines.push(`Linked as a child of project/${args.parent ?? ''}.`);
    if (created.parentLinked === false)
      lines.push(`Could not link to the parent project: ${created.parentError ?? 'unknown error'}`);
    return ok(lines.join('\n'), {
      dataset: created.dataset,
      slug: created.slug,
      path: created.path,
      url: `${ctx.serverOrigin}${created.url}`,
      resource: entryUri(created.dataset, created.slug),
      files: created.files,
      ...(created.parentLinked === undefined ? {} : { parentLinked: created.parentLinked }),
      ...(created.parentError === undefined ? {} : { parentError: created.parentError }),
      ...(detail === null ? {} : { summary: compactSummary(detail.summary) }),
    });
  },
});

const patchEntryTool = defineTool({
  name: 'patch-entry',
  title: 'Patch entry frontmatter',
  description:
    'WRITES. Edit the frontmatter of an okf or skill entry: state (lifecycle datasets), title, description, tags (replaces the list), time and resolved (task, feature, bug and rca: time tracking), addLinks / removeLinks (relations of an okf entry index.md: rel child | related | depends-on, default related). Only the given keys change, every other byte of the file stays; invalid results are refused and nothing is written. Last write wins.',
  readOnly: false,
  input: type({
    '+': 'reject',
    dataset: entryDatasetType,
    slug: nameType,
    'state?': type('string').describe('A lifecycle state of the dataset, e.g. in-progress.'),
    'title?': type('string').describe('Empty string removes the title.'),
    'description?': 'string',
    'tags?': type('string').array(),
    'time?': type('string')
      .array()
      .describe(
        'Time spent, one ISO 8601 duration per stretch of work (PT1H30M, PT45M, P1D). Replaces the list: to add one, send the current list (get-entry) plus the new value; [] removes it.',
      ),
    'resolved?': type('string | null').describe(
      'When the work was resolved: an ISO 8601 date or date-time (2026-10-19, 2026-10-19T14:30+02:00). null removes it.',
    ),
    'addLinks?': entryLinkInput.array(),
    'removeLinks?': linkRefType.array(),
  }),
  async handler(args, ctx) {
    const { dataset, slug, ...changes } = args;
    const patched = await patchEntry(dataset, slug, changes, ctx.dataDir);
    const text = [
      patched.changed
        ? `Updated \`${keyOf(dataset, slug)}\`.`
        : `No change: \`${keyOf(dataset, slug)}\` already matches.`,
      `Modified ${patched.lastModified}.`,
      ...(patched.warnings.length > 0
        ? ['Warnings:', ...patched.warnings.map((w) => `- ${w.rule}: ${w.message}`)]
        : []),
      '',
      frontmatterText(patched.frontmatter),
    ].join('\n');
    return ok(text, {
      dataset,
      slug,
      changed: patched.changed,
      lastModified: patched.lastModified,
      frontmatter: patched.frontmatter,
      warnings: patched.warnings,
    });
  },
});

const appendContextLinksTool = defineTool({
  name: 'append-context-links',
  title: 'Append context links',
  description:
    'WRITES. Add links (dataset, slug, optional markdown notes for the consuming agent) to an existing context. A target that is already linked is skipped and its existing notes stay.',
  readOnly: false,
  input: type({
    '+': 'reject',
    slug: nameType.describe('The context.'),
    links: type({ '+': 'reject', dataset: linkableType, slug: nameType, 'notes?': 'string' })
      .array()
      .atLeastLength(1),
  }),
  async handler(args, ctx) {
    const result = await appendContextLinks(args.slug, { links: args.links }, ctx.dataDir);
    const text = [
      `context/${args.slug}: added ${result.added.length}, skipped ${result.skipped.length} (already linked); ${result.record.context.links.length} link(s) now.`,
      ...(result.added.length > 0
        ? ['Added: ' + result.added.map((k) => `\`${k}\``).join(', ')]
        : []),
      ...(result.skipped.length > 0
        ? ['Skipped: ' + result.skipped.map((k) => `\`${k}\``).join(', ')]
        : []),
    ].join('\n');
    return ok(text, {
      slug: args.slug,
      added: result.added,
      skipped: result.skipped,
      linkCount: result.record.context.links.length,
      lastModified: result.record.lastModified,
    });
  },
});

const appendLogTool = defineTool({
  name: 'append-log',
  title: 'Append to log',
  description:
    "WRITES. Add one line to an okf bundle's log.md as a bullet under today's `## YYYY-MM-DD` heading (a new dated section on top when the newest heading is not today); creates log.md when missing. Use it to record what changed and why.",
  readOnly: false,
  input: type({
    '+': 'reject',
    dataset: okfDatasetType,
    slug: nameType,
    text: type('string >= 1').describe(
      'One line; markdown inline formatting such as **Update**: ... is fine.',
    ),
  }),
  async handler(args, ctx) {
    if (!isOkfDatasetId(args.dataset) || !isValidName(args.slug))
      return failure('invalid', 'dataset or slug is invalid');
    const appended = await appendLog(
      args.dataset,
      args.slug,
      args.text,
      todayYmd(ctx.nowMs),
      ctx.dataDir,
    );
    const text = [
      `${appended.created ? 'Created' : 'Updated'} \`${keyOf(args.dataset, args.slug)}/log.md\`. Newest section:`,
      '',
      appended.head,
    ].join('\n');
    return ok(text, {
      dataset: args.dataset,
      slug: args.slug,
      path: appended.path,
      created: appended.created,
      entry: appended.entry,
      head: appended.head,
      lastModified: appended.lastModified,
    });
  },
});

// ---------------------------------------------------------------- registry

export const TOOLS: readonly ToolDef[] = [
  searchTool,
  listDatasetsTool,
  listEntriesTool,
  getEntryTool,
  listBundleFilesTool,
  readBundleFileTool,
  getContextTool,
  renderRecipeTool,
  checkDataTool,
  createEntryTool,
  patchEntryTool,
  appendContextLinksTool,
  appendLogTool,
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** Calls a tool by name with plain args (tests, scripts). Unknown names are an `unknown-tool` failure. */
export async function callTool(name: string, args: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(name);
  return tool === undefined
    ? failure('unknown-tool', `no tool named "${name}"`)
    : tool.handler(args, ctx);
}
