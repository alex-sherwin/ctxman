// NODE (fs): the one-off migration behind `pnpm run migrate:index` (Phase 7): an okf bundle used to keep its entry in
// `main.md` next to a navigation `index.md`; the entry is now the bundle-root `index.md` itself (entry frontmatter with
// `okf_version` first, then the entry body, then the old navigation sections). The conversion functions are PURE text
// transforms; `migrateDataDir` applies them to every okf bundle of a data dir. Idempotent: a bundle without `main.md`
// is skipped.
import { readdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { OKF_DATASET_IDS, OKF_ENTRY_FILE } from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { writeFileAtomic } from './atomic-write.ts';
import { walkFiles } from './bundles.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { resolveBundleHref } from './links.ts';
import { maskMarkdownCode, splitFrontmatter } from './okf.ts';
import { parseYaml } from './yaml.ts';

const LEGACY_ENTRY_FILE = 'main.md';
const VERSION_LINE = 'okf_version: "0.2"';

const normalizeEol = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

/**
 * The navigation worth keeping from an old root `index.md` body: everything except its `# Title` heading line and its
 * `## Entry` section (which only pointed at main.md). Text under the title, before the first `##`, stays. Returns ''
 * when nothing is left. Headings inside code fences are not headings.
 */
export function remainingIndexSections(indexBody: string): string {
  const lines = normalizeEol(indexBody).split('\n');
  const masked = maskMarkdownCode(lines.join('\n')).split('\n');
  const kept: string[] = [];
  let skipping = false;
  let titleSeen = false;
  lines.forEach((line, i) => {
    const heading = /^(#{1,2})(?!#)[ \t]/.exec(masked[i] ?? '');
    if (heading) {
      skipping = false;
      if (heading[1] === '#' && !titleSeen) {
        titleSeen = true;
        return;
      }
      if (/^##[ \t]+entry[ \t]*#*[ \t]*$/i.test(masked[i] ?? '')) {
        skipping = true;
        return;
      }
    }
    if (!skipping) kept.push(line);
  });
  return kept.join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
}

/** Frontmatter of the old index.md: has any key besides `okf_version` (= it already is an entry, not navigation). */
function hasEntryKeys(raw: string): boolean {
  try {
    const value = parseYaml(raw);
    return (
      value !== null &&
      typeof value === 'object' &&
      Object.keys(value as Record<string, unknown>).some((k) => k !== 'okf_version')
    );
  } catch {
    return true;
  }
}

/**
 * New `index.md` text from the old `main.md` and (optional) old navigation `index.md`: `okf_version` (the old
 * index's line when it had one) as the FIRST frontmatter key, the rest of main.md's frontmatter verbatim, main.md's
 * body, then the remaining navigation sections after a blank line. Throws when `main.md` has no frontmatter or the
 * old index.md already carries entry keys.
 */
export function convertEntry(mainSource: string, oldIndexSource: string | null): string {
  const main = splitFrontmatter(mainSource);
  if (!main) throw new Error(`${LEGACY_ENTRY_FILE} has no frontmatter`);
  const lines = main.raw.split('\n').filter((l) => !/^okf_version\s*:/.test(l));

  let versionLine = VERSION_LINE;
  let navigation = '';
  if (oldIndexSource !== null) {
    const old = splitFrontmatter(oldIndexSource);
    if (old) {
      if (hasEntryKeys(old.raw)) {
        throw new Error(
          `${OKF_ENTRY_FILE} already has entry frontmatter next to ${LEGACY_ENTRY_FILE}; resolve it by hand`,
        );
      }
      versionLine = old.raw.split('\n').find((l) => /^okf_version\s*:/.test(l)) ?? VERSION_LINE;
    }
    navigation = remainingIndexSections(old ? old.body : oldIndexSource);
  }

  const frontmatter = [versionLine, ...lines].join('\n');
  let body = main.body.replace(/\s+$/, '');
  body = body === '' ? '\n' : `${body}\n`;
  const tail = navigation === '' ? '' : `\n${navigation}\n`;
  return `---\n${frontmatter}\n---\n${body}${tail}`;
}

/**
 * Rewrites link destinations that resolve to the bundle-root `main.md` (`/main.md`, `./main.md`, `main.md`,
 * `../main.md` at any depth, fragment and query kept) to the `index.md` equivalent. Inline links, images and
 * reference definitions; code is left alone. `fromRel` is the bundle-relative path of the file.
 */
export function rewriteMainLinks(
  markdown: string,
  fromRel: string,
): { text: string; count: number } {
  const masked = maskMarkdownCode(markdown);
  const found: { start: number; end: number }[] = [];
  for (const m of masked.matchAll(/\]\([ \t]*(<[^>\n]*>|[^\s)]*)/g)) {
    const raw = m[1] ?? '';
    const start = (m.index ?? 0) + m[0].length - raw.length;
    found.push({ start, end: start + raw.length });
  }
  for (const m of masked.matchAll(/^ {0,3}\[(?!\^)(?:[^\]\\]|\\.)+\]:[ \t]*(<[^>\n]*>|\S+)/gm)) {
    const raw = m[1] ?? '';
    const start = (m.index ?? 0) + m[0].length - raw.length;
    found.push({ start, end: start + raw.length });
  }
  found.sort((a, b) => a.start - b.start);

  let out = '';
  let cursor = 0;
  let count = 0;
  for (const { start, end } of found) {
    const dest = markdown.slice(start, end);
    const resolved = resolveBundleHref(dest.replace(/^</, '').replace(/>$/, ''), fromRel);
    const rewritten =
      'path' in resolved && resolved.path === LEGACY_ENTRY_FILE
        ? dest.replace(/(^|[/<])main\.md(?=$|[#?>])/, `$1${OKF_ENTRY_FILE}`)
        : dest;
    if (rewritten === dest) continue;
    out += markdown.slice(cursor, start) + rewritten;
    cursor = end;
    count++;
  }
  return { text: out + markdown.slice(cursor), count };
}

export interface BundleMigration {
  dataset: OkfDatasetId;
  slug: string;
  /** 'migrated' (or 'would-migrate' in a dry run), 'skipped' (no main.md), 'failed' (see `error`). */
  status: 'migrated' | 'would-migrate' | 'skipped' | 'failed';
  error?: string;
  /** Files whose links changed (bundle-relative, the new index.md included), with the rewrite count. */
  rewrites: { file: string; count: number }[];
  /** The old navigation sections were merged after the entry body. */
  navigationMerged: boolean;
}

export interface MigrationReport {
  dryRun: boolean;
  bundles: BundleMigration[];
  migrated: number;
  skipped: number;
  failed: number;
  rewrites: number;
}

async function readIfExists(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function migrateBundle(
  dataset: OkfDatasetId,
  slug: string,
  root: string,
  dryRun: boolean,
): Promise<BundleMigration> {
  const result: BundleMigration = {
    dataset,
    slug,
    status: 'skipped',
    rewrites: [],
    navigationMerged: false,
  };
  const mainSource = await readIfExists(path.join(root, LEGACY_ENTRY_FILE));
  if (mainSource === null) return result;

  try {
    const oldIndex = await readIfExists(path.join(root, OKF_ENTRY_FILE));
    const converted = convertEntry(mainSource, oldIndex);
    result.navigationMerged =
      oldIndex !== null &&
      remainingIndexSections(splitFrontmatter(oldIndex)?.body ?? oldIndex) !== '';

    const writes: { abs: string; text: string }[] = [];
    const entry = rewriteMainLinks(converted, OKF_ENTRY_FILE);
    writes.push({ abs: path.join(root, OKF_ENTRY_FILE), text: entry.text });
    if (entry.count > 0) result.rewrites.push({ file: OKF_ENTRY_FILE, count: entry.count });

    for (const rel of (await walkFiles(root)).filter((f) => f.endsWith('.md'))) {
      if (rel === LEGACY_ENTRY_FILE || rel === OKF_ENTRY_FILE) continue;
      const abs = path.join(root, ...rel.split('/'));
      const source = await readFile(abs, 'utf8');
      const rewritten = rewriteMainLinks(source, rel);
      if (rewritten.count === 0) continue;
      writes.push({ abs, text: rewritten.text });
      result.rewrites.push({ file: rel, count: rewritten.count });
    }

    if (!dryRun) {
      for (const write of writes) await writeFileAtomic(write.abs, write.text);
      await unlink(path.join(root, LEGACY_ENTRY_FILE));
    }
    result.status = dryRun ? 'would-migrate' : 'migrated';
  } catch (error) {
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

/** Migrates every okf bundle of `dataDir` that still has a `main.md`. */
export async function migrateDataDir(
  dataDir: string = resolveDataDir(),
  options: { dryRun?: boolean } = {},
): Promise<MigrationReport> {
  const dryRun = options.dryRun === true;
  const bundles: BundleMigration[] = [];
  for (const dataset of OKF_DATASET_IDS) {
    const base = datasetDir(dataset, dataDir);
    let names: string[];
    try {
      names = (await readdir(base, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      continue;
    }
    for (const slug of names) {
      bundles.push(await migrateBundle(dataset, slug, path.join(base, slug), dryRun));
    }
  }
  const count = (status: BundleMigration['status'][]): number =>
    bundles.filter((b) => status.includes(b.status)).length;
  return {
    dryRun,
    bundles,
    migrated: count(['migrated', 'would-migrate']),
    skipped: count(['skipped']),
    failed: count(['failed']),
    rewrites: bundles.reduce((n, b) => n + b.rewrites.reduce((m, r) => m + r.count, 0), 0),
  };
}
