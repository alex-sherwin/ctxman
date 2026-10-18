// NODE* (no fs calls of its own: every read goes through `InflateSources`; imports src/lib/okf.ts and
// src/lib/links.ts): loads what a recipe needs, gathers file contents for the included items and renders
// the document (plans/INFLATE_SPEC.md §5.6, §6.2). Never import from the browser island.
import { OKF_ENTRY_FILE } from '../../datasets/registry.ts';
import type { DatasetId, LinkableDatasetId, OkfDatasetId } from '../../datasets/registry.ts';
import { isLocalReference } from '../../datasets/schemas.ts';
import type { RecipeData } from '../../datasets/schemas.ts';
import { classifyHref, extractLinks, parseCtxmanHref, resolveBundleHref } from '../links.ts';
import { parseFrontmatterLoose, splitFrontmatter } from '../okf.ts';
import { OPTION_DEFS, itemKey } from './catalog.ts';
import { expandRecipe } from './expand.ts';
import type {
  ContextLookup,
  ExpandLookup,
  ExpandedPlan,
  InflateWarning,
  ItemLookup,
  ItemSegment,
} from './expand.ts';
import { renderPlan } from './render.ts';
import type { InflateResult } from './render.ts';

export interface EntryRef {
  title: string;
  abs: string;
}
export interface BundleFileRef {
  /** Bundle-relative posix path. */
  rel: string;
  abs: string;
  kind: 'markdown' | 'text' | 'binary';
}

/** Everything the pipeline reads from the world. `createFsSources` is the real implementation. */
export interface InflateSources {
  readContext(slug: string): Promise<ContextLookup>; // never 'loading'
  readItem(dataset: LinkableDatasetId, slug: string): Promise<ItemLookup>; // never 'loading'
  /** Any dataset (ctxman: link targets). null = invalid slug or entry file missing. */
  entryRef(dataset: DatasetId, slug: string): Promise<EntryRef | null>;
  itemPaths(dataset: LinkableDatasetId, slug: string): { rootAbs: string; entryAbs: string };
  listFiles(dataset: OkfDatasetId | 'skill', slug: string): Promise<BundleFileRef[]>;
  readText(dataset: OkfDatasetId | 'skill', slug: string, rel: string): Promise<string | null>;
  /** '~' / '~/x' → home; relative → resolved against cwd; then joined with subpath segments. */
  localPaths(path: string, subpath?: string): { root: string; target: string };
  statPath(abs: string): Promise<'dir' | 'file' | null>;
  /**
   * Direct children; names starting with '.' and 'node_modules' skipped; dirs first, then
   * case-insensitive name; null = not a directory.
   */
  listDir(abs: string): Promise<{ name: string; dir: boolean }[] | null>;
}

export interface ExpandInputs {
  contexts: Map<string, ContextLookup>;
  items: Map<string, ItemLookup>;
}

/** Reads every recipe context, then every reachable item (links of ready contexts + recipe.items), in parallel. */
export async function loadExpandInputs(
  recipe: RecipeData,
  sources: InflateSources,
): Promise<ExpandInputs> {
  const contexts = new Map<string, ContextLookup>();
  await Promise.all(
    recipe.contexts.map(async (slug) => {
      contexts.set(slug, await sources.readContext(slug));
    }),
  );
  const wanted = new Map<string, { dataset: LinkableDatasetId; slug: string }>();
  for (const slug of recipe.contexts) {
    const found = contexts.get(slug);
    if (found?.status !== 'ready') continue;
    for (const link of found.context.links) {
      wanted.set(itemKey(link.dataset, link.slug), { dataset: link.dataset, slug: link.slug });
    }
  }
  for (const item of recipe.items) {
    wanted.set(itemKey(item.dataset, item.slug), { dataset: item.dataset, slug: item.slug });
  }
  const items = new Map<string, ItemLookup>();
  await Promise.all(
    [...wanted].map(async ([key, { dataset, slug }]) => {
      items.set(key, await sources.readItem(dataset, slug));
    }),
  );
  return { contexts, items };
}

/** ExpandLookup over loaded inputs; anything not loaded is `missing`. */
export function lookupFrom(inputs: ExpandInputs): ExpandLookup {
  return {
    context: (slug) => inputs.contexts.get(slug) ?? { status: 'missing' },
    item: (dataset, slug) => inputs.items.get(itemKey(dataset, slug)) ?? { status: 'missing' },
  };
}

// ---------------------------------------------------------------- content gathering

export interface ItemContent {
  rootAbs: string;
  entryAbs: string;
  files?: BundleFileRef[];
  /** rel → text (null = unreadable). */
  texts?: Record<string, string | null>;
  /**
   * inline-main / inline-bundle, and `summary` of an item placed in a working directory (its "Summary + links"
   * file list): concept files in index order.
   */
  concepts?: string[];
  local?: { root: string; target: string; exists: boolean };
  /** null = target is not a directory. */
  tree?: { entries: { name: string; dir: boolean }[]; total: number } | null;
}
export interface PlanContent {
  items: Record<string, ItemContent>;
  targets: Record<string, EntryRef | null>;
  warnings: InflateWarning[];
}

const baseName = (rel: string): string => rel.split('/').pop() ?? rel;

/**
 * Concept files of a bundle in index order: markdown links of index.md that resolve to markdown files of
 * the bundle, then every other markdown file in tree order. `indexText` is the entry (the root index.md, which
 * carries the bundle's navigation); the entry itself, every nested index.md and every log.md are excluded.
 */
export function conceptFiles(files: readonly BundleFileRef[], indexText: string | null): string[] {
  const markdown = new Set(files.filter((f) => f.kind === 'markdown').map((f) => f.rel));
  const out: string[] = [];
  const add = (rel: string): void => {
    const name = baseName(rel);
    if (name === 'index.md' || name === 'log.md') return;
    if (!markdown.has(rel) || out.includes(rel)) return;
    out.push(rel);
  };
  if (indexText !== null) {
    const text = indexText.replace(/\r\n?/g, '\n');
    let body = text;
    try {
      body = parseFrontmatterLoose(text).body;
    } catch {
      body = splitFrontmatter(text)?.body ?? text;
    }
    for (const link of extractLinks(body)) {
      if (classifyHref(link.href) !== 'bundle') continue;
      const resolved = resolveBundleHref(link.href, 'index.md');
      if ('path' in resolved) add(resolved.path);
    }
  }
  for (const file of files) add(file.rel);
  return out;
}

const unreadable = (key: string, rel: string): InflateWarning => ({
  code: 'file-unreadable',
  message: `${key}: ${rel} could not be read (missing, binary or larger than 512 KB)`,
  key,
});

/**
 * Reads what the renderer needs for every INCLUDED item segment (see spec §6.2 table; plans/INFLATE_V3_PLAN.md
 * §6: an okf item placed in a directory in `summary` mode also lists its bundle files and concept order).
 */
export async function gatherContent(
  plan: ExpandedPlan,
  sources: InflateSources,
): Promise<PlanContent> {
  const warnings: InflateWarning[] = [];
  const items: Record<string, ItemContent> = {};
  const ctxmanKeys = new Set<string>();

  const collectLinks = (body: string): void => {
    for (const link of extractLinks(body)) {
      if (classifyHref(link.href) !== 'ctxman') continue;
      const target = parseCtxmanHref(link.href);
      if (target !== null) ctxmanKeys.add(`${target.dataset}/${target.slug}`);
    }
  };
  const collectTargets = (text: string | null, rewrite: boolean): void => {
    if (text === null || !rewrite) return;
    collectLinks(splitFrontmatter(text.replace(/\r\n?/g, '\n'))?.body ?? text);
  };

  const gather = async (seg: ItemSegment): Promise<void> => {
    const { kind, mode } = seg;
    if (kind === null || mode === null) return;
    const content: ItemContent = { ...sources.itemPaths(seg.dataset, seg.slug) };
    items[seg.key] = content;
    const rewrite = seg.options.rewriteLinks ?? (OPTION_DEFS.rewriteLinks.default as boolean);
    // A reference's `info` is inlined in every mode; its ctxman: links are resolved (render.ts#infoBody).
    const info = seg.meta?.ref?.info;
    if (info !== undefined) collectLinks(info.replace(/\r\n?/g, '\n'));

    if (kind === 'skill') {
      if (mode !== 'inline') return;
      content.files = await sources.listFiles('skill', seg.slug);
      const text = await sources.readText('skill', seg.slug, 'SKILL.md');
      content.texts = { 'SKILL.md': text };
      if (text === null) warnings.push(unreadable(seg.key, 'SKILL.md'));
      collectTargets(text, rewrite);
      return;
    }

    if (kind === 'local-repo' || kind === 'local-folder') {
      const ref = seg.meta?.ref;
      if (ref === undefined || !isLocalReference(ref)) return;
      const { root, target } = sources.localPaths(ref.path, ref.subpath);
      const exists = (await sources.statPath(target)) === 'dir';
      content.local = { root, target, exists };
      if (!exists) {
        warnings.push({
          code: 'path-missing',
          message: `${seg.key}: path ${target} does not exist`,
          key: seg.key,
        });
      } else if (mode === 'tree') {
        const entries = await sources.listDir(target);
        content.tree = entries === null ? null : { entries, total: entries.length };
      }
      return;
    }

    if (kind === 'remote-repo' || kind === 'remote-skill') return;

    // okf: kb, rca, idea, task, bug, feature, project
    const dataset = seg.dataset as OkfDatasetId;
    if (mode === 'summary' && seg.placed) {
      // "Summary + links": only the file list and the concept order, nothing is inlined (no unreadable
      // warning, no link targets: the entry text just orders the files).
      const files = await sources.listFiles(dataset, seg.slug);
      content.files = files;
      content.concepts = conceptFiles(
        files,
        await sources.readText(dataset, seg.slug, OKF_ENTRY_FILE),
      );
      return;
    }
    if (mode !== 'inline-main' && mode !== 'inline-bundle') return;
    const files = await sources.listFiles(dataset, seg.slug);
    content.files = files;
    const texts: Record<string, string | null> = {};
    content.texts = texts;
    const has = (rel: string): boolean => files.some((f) => f.rel === rel);
    const read = async (rel: string): Promise<string | null> => {
      const text = await sources.readText(dataset, seg.slug, rel);
      texts[rel] = text;
      if (text === null) warnings.push(unreadable(seg.key, rel));
      collectTargets(text, rewrite);
      return text;
    };
    const entryText = await read(OKF_ENTRY_FILE);
    content.concepts = conceptFiles(files, entryText);
    if (mode === 'inline-bundle') {
      for (const rel of content.concepts) await read(rel);
      if (seg.options.includeLog === true && has('log.md')) await read('log.md');
    }
  };

  const included = plan.segments.filter(
    (s): s is ItemSegment => s.type === 'item' && s.status === 'included',
  );
  await Promise.all(included.map(gather));

  const targets: Record<string, EntryRef | null> = {};
  await Promise.all(
    [...ctxmanKeys].map(async (key) => {
      const at = key.indexOf('/');
      targets[key] = await sources.entryRef(key.slice(0, at) as DatasetId, key.slice(at + 1));
    }),
  );

  return { items, targets, warnings: sortWarnings(warnings, included) };
}

/** Stable warning order: by item segment order, then message (parallel gathering finishes in any order). */
function sortWarnings(warnings: InflateWarning[], order: readonly ItemSegment[]): InflateWarning[] {
  const rank = new Map(order.map((s, i) => [s.key, i] as const));
  return warnings
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (rank.get(a.w.key ?? '') ?? 0) - (rank.get(b.w.key ?? '') ?? 0) || a.i - b.i)
    .map(({ w }) => w);
}

/** expand → gather: everything a render or a working-directory plan needs (plans/INFLATE_V2_SPEC.md §8.1). */
export async function prepareInflate(
  recipe: RecipeData,
  sources: InflateSources,
): Promise<{ plan: ExpandedPlan; content: PlanContent }> {
  const plan = expandRecipe(recipe, lookupFrom(await loadExpandInputs(recipe, sources)));
  const content = await gatherContent(plan, sources);
  return { plan, content };
}

/** expand → gather → render (the v1 single document with absolute paths). */
export async function inflateRecipe(
  recipe: RecipeData,
  sources: InflateSources,
  now: Date,
): Promise<InflateResult> {
  const { plan, content } = await prepareInflate(recipe, sources);
  return renderPlan(plan, content, { generatedAt: now.toISOString() });
}
