// NODE (pure helpers + one fs check): markdown link extraction, bundle-relative resolution, link checking
// for okf bundles and skill directories, and href rewriting of rendered HTML. Rule ids: PLAN.md §E.6.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  docUrl,
  entryUrl,
  isDatasetId,
  isValidName,
  OKF_DATASET_IDS,
} from '../datasets/registry.ts';
import type { DatasetId, OkfDatasetId } from '../datasets/registry.ts';
import { entryLinkSchema } from '../datasets/schemas.ts';
import { listBundles, maskMarkdownCode, splitFrontmatter } from './okf.ts';
import { walkFiles } from './bundles.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { sortFindings } from './findings.ts';
import type { Finding } from './findings.ts';
import { entryFileRelPath } from './freshness.ts';
import { parseYaml } from './yaml.ts';

export interface MdLink {
  href: string;
  text: string;
  /** 1-based line of the link's opening `[` (or of the reference definition / autolink). */
  line: number;
  image: boolean;
}

// ---------------------------------------------------------------- extraction

interface Dest {
  hrefStart: number;
  hrefEnd: number;
  /** Index just after the closing `)`. */
  end: number;
}

/** Parses `dest "title")` starting right after `(`. */
function parseInlineTail(s: string, start: number): Dest | null {
  let i = start;
  const skipSpace = (): void => {
    while (i < s.length && /[ \t\r\n]/.test(s[i] ?? '')) i++;
  };
  skipSpace();
  let hrefStart = i;
  let hrefEnd = i;
  if (s[i] === '<') {
    i++;
    hrefStart = i;
    while (i < s.length && s[i] !== '>' && s[i] !== '\n') i++;
    if (s[i] !== '>') return null;
    hrefEnd = i;
    i++;
  } else {
    let depth = 0;
    while (i < s.length) {
      const c = s[i] ?? '';
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (/\s/.test(c)) break;
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    hrefEnd = Math.min(i, s.length);
  }
  skipSpace();
  const opener = s[i];
  if (opener === '"' || opener === "'" || opener === '(') {
    const closer = opener === '(' ? ')' : opener;
    i++;
    while (i < s.length && s[i] !== closer) {
      if (s[i] === '\\') i++;
      i++;
    }
    if (s[i] !== closer) return null;
    i++;
    skipSpace();
  }
  if (s[i] !== ')') return null;
  return { hrefStart, hrefEnd, end: i + 1 };
}

/** Index of the `]` matching the `[` at `open` (nested brackets balanced, escapes honoured), or -1. */
function findClosingBracket(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    } else if (c === '\n' && /^\n[ \t]*\r?\n/.test(s.slice(i, i + 64))) {
      return -1; // a link never spans a blank line
    }
  }
  return -1;
}

/**
 * Inline links `[t](href "title")`, images `![a](href)`, reference definitions `[id]: href`, and
 * `<scheme:…>` autolinks, in document order. Fenced code blocks and inline code are skipped.
 */
export function extractLinks(markdown: string): MdLink[] {
  const masked = maskMarkdownCode(markdown);
  const lineStarts = [0];
  for (let i = 0; i < markdown.length; i++) if (markdown[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const found: { offset: number; link: MdLink }[] = [];

  // inline links + images
  for (let i = 0; i < masked.length; i++) {
    if (masked[i] !== '[' || masked[i - 1] === '\\' || masked[i + 1] === '^') continue;
    const close = findClosingBracket(masked, i);
    if (close === -1 || masked[close + 1] !== '(') continue;
    const dest = parseInlineTail(masked, close + 2);
    if (!dest) continue;
    found.push({
      offset: i,
      link: {
        href: markdown.slice(dest.hrefStart, dest.hrefEnd),
        text: markdown.slice(i + 1, close),
        line: lineOf(i),
        image: masked[i - 1] === '!',
      },
    });
  }

  // reference definitions: [id]: href "title"
  const defPattern = /^ {0,3}\[(?!\^)((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>\n]*>|\S+)/gm;
  for (const m of masked.matchAll(defPattern)) {
    const offset = m.index ?? 0;
    const raw = m[2] ?? '';
    const href = raw.startsWith('<') ? raw.slice(1, -1) : raw;
    const labelStart = offset + m[0].indexOf('[') + 1;
    found.push({
      offset,
      link: {
        href,
        text: markdown.slice(labelStart, labelStart + (m[1] ?? '').length),
        line: lineOf(offset),
        image: false,
      },
    });
  }

  // autolinks
  for (const m of masked.matchAll(/<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/g)) {
    const offset = m.index ?? 0;
    found.push({
      offset,
      link: { href: m[1] ?? '', text: m[1] ?? '', line: lineOf(offset), image: false },
    });
  }

  return found.sort((a, b) => a.offset - b.offset).map((f) => f.link);
}

// ---------------------------------------------------------------- classification + resolution

export function classifyHref(href: string): 'external' | 'anchor' | 'ctxman' | 'bundle' {
  const h = href.trim();
  if (h.startsWith('#')) return 'anchor';
  if (h.toLowerCase().startsWith('ctxman:')) return 'ctxman';
  if (h.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return 'external';
  return 'bundle';
}

function stripQueryAndFragment(href: string): { path: string; fragment: string } {
  const hash = href.indexOf('#');
  const fragment = hash === -1 ? '' : href.slice(hash + 1);
  let rest = hash === -1 ? href : href.slice(0, hash);
  const query = rest.indexOf('?');
  if (query !== -1) rest = rest.slice(0, query);
  return { path: rest, fragment };
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/**
 * Resolves a bundle-relative href against the file it appears in. `/x.md` is bundle-root relative;
 * `./x.md`, `x.md`, `../x.md` are relative to `fromRelPath`'s directory. Query and fragment are dropped,
 * `%20` etc. decoded. A result that leaves the bundle is `{ escapes: true }`.
 */
export function resolveBundleHref(
  href: string,
  fromRelPath: string,
): { path: string } | { escapes: true } {
  const { path: raw } = stripQueryAndFragment(href.trim());
  const decoded = safeDecode(raw).replaceAll('\\', '/');
  if (decoded === '') return { path: fromRelPath };
  const joined = decoded.startsWith('/')
    ? path.posix.normalize(decoded.replace(/^\/+/, ''))
    : path.posix.join(path.posix.dirname(fromRelPath), decoded);
  const normalized = path.posix.normalize(joined);
  if (normalized === '..' || normalized.startsWith('../')) return { escapes: true };
  return { path: normalized };
}

/** 'ctxman:feature/context-forge#x' -> { dataset: 'feature', slug: 'context-forge', fragment: 'x' }; null if malformed. */
export function parseCtxmanHref(
  href: string,
): { dataset: DatasetId; slug: string; fragment?: string } | null {
  const m = /^ctxman:([^/#?]+)\/([^/#?]+)(?:#(.*))?$/i.exec(href.trim());
  if (!m) return null;
  const dataset = (m[1] ?? '').toLowerCase();
  const slug = m[2] ?? '';
  if (!isDatasetId(dataset) || !isValidName(slug)) return null;
  const fragment = m[3];
  return fragment ? { dataset, slug, fragment } : { dataset, slug };
}

// ---------------------------------------------------------------- fs check

async function listSkillDirs(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(datasetDir('skill', dataDir), { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Does the entry file of `<dataset>/<slug>` exist? (`reference/x.yaml`, `kb/x/main.md`, …) */
function entryExists(dataDir: string, dataset: DatasetId, slug: string): boolean {
  return existsSync(path.join(dataDir, ...entryFileRelPath(dataset, slug).split('/')));
}

/** Arguments of the per-file link checks. `relPath` is bundle-relative posix, `dataDir` defaults to the data dir. */
export interface FileLinksArgs {
  dataset: OkfDatasetId | 'skill';
  /** The entry (bundle / skill directory) name. */
  name: string;
  relPath: string;
  /** The file's text as it would be on disk (frontmatter included). */
  source: string;
  dataDir?: string;
}

/**
 * Findings for the structured `links` of an okf entry's main.md frontmatter, all reported on the line of the
 * `links:` key: `links/relation-self` (error, a link to the entry itself) and `links/relation-target`
 * (warning, the target entry does not exist). Items that do not parse (bad dataset or slug, duplicate keys…) are
 * `okf/entry-schema` errors elsewhere and are skipped here, as is frontmatter that does not parse.
 */
export function checkFrontmatterLinks(args: {
  dataset: OkfDatasetId;
  name: string;
  source: string;
  dataDir?: string;
}): Finding[] {
  const { dataset, name, source } = args;
  const dataDir = args.dataDir ?? resolveDataDir();
  const split = splitFrontmatter(source);
  if (!split) return [];
  let data: unknown;
  try {
    data = parseYaml(split.raw);
  } catch {
    return [];
  }
  const links =
    data !== null && typeof data === 'object' ? (data as { links?: unknown }).links : undefined;
  if (!Array.isArray(links)) return [];

  // The frontmatter starts on file line 2.
  const keyIndex = split.raw.split('\n').findIndex((line) => /^links\s*:/.test(line));
  const line = keyIndex === -1 ? 2 : keyIndex + 2;
  const file = `${dataset}/${name}/main.md`;
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const item of links) {
    const parsed = entryLinkSchema.safeParse(item);
    if (!parsed.success) continue;
    const { dataset: targetDataset, slug } = parsed.data;
    const key = `${targetDataset}/${slug}`;
    if (targetDataset === dataset && slug === name) {
      if (reported.has('self')) continue;
      reported.add('self');
      findings.push({
        severity: 'error',
        rule: 'links/relation-self',
        file,
        line,
        message: 'an entry cannot link to itself',
      });
    } else if (!reported.has(key) && !entryExists(dataDir, targetDataset, slug)) {
      reported.add(key);
      findings.push({
        severity: 'warning',
        rule: 'links/relation-target',
        file,
        line,
        message: `relation target ${key} does not exist`,
      });
    }
  }
  return findings;
}

/**
 * Link findings for ONE markdown file of an okf bundle or skill directory (the loop body of checkLinks, shared with
 * the doc editor): links/broken, links/escapes-bundle, links/ctxman-invalid (errors), links/ctxman-target (warning),
 * and, for an okf entry's main.md, checkFrontmatterLinks. `file` of each finding is `<dataset>/<name>/<relPath>`.
 */
export function checkFileLinks(args: FileLinksArgs): Finding[] {
  const { dataset, name, relPath, source } = args;
  const dataDir = args.dataDir ?? resolveDataDir();
  const root = path.join(datasetDir(dataset, dataDir), name);
  const file = `${dataset}/${name}/${relPath}`;
  const findings: Finding[] = [];

  const split = splitFrontmatter(source);
  const body = split ? split.body : source;
  const lineOffset = split ? split.bodyLine - 1 : 0;
  for (const link of extractLinks(body)) {
    const line = link.line + lineOffset;
    const href = link.href.trim();
    if (href === '') continue;
    const kind = classifyHref(href);
    if (kind === 'external' || kind === 'anchor') continue;
    if (kind === 'ctxman') {
      const target = parseCtxmanHref(href);
      if (!target) {
        findings.push({
          severity: 'error',
          rule: 'links/ctxman-invalid',
          file,
          line,
          message: `invalid ctxman: link "${href}" (expected ctxman:<dataset>/<slug>)`,
        });
      } else if (!entryExists(dataDir, target.dataset, target.slug)) {
        findings.push({
          severity: 'warning',
          rule: 'links/ctxman-target',
          file,
          line,
          message: `ctxman: link target ${target.dataset}/${target.slug} does not exist`,
        });
      }
      continue;
    }
    const resolved = resolveBundleHref(href, relPath);
    if ('escapes' in resolved) {
      findings.push({
        severity: 'error',
        rule: 'links/escapes-bundle',
        file,
        line,
        message: `link "${href}" points outside the bundle`,
      });
    } else if (!existsSync(path.join(root, ...resolved.path.split('/')))) {
      findings.push({
        severity: 'error',
        rule: 'links/broken',
        file,
        line,
        message: `broken link "${href}": ${resolved.path} does not exist in the bundle`,
      });
    }
  }

  if (relPath === 'main.md' && dataset !== 'skill') {
    findings.push(...checkFrontmatterLinks({ dataset, name, source, dataDir }));
  }
  return sortFindings(findings);
}

/**
 * Link validity for every .md in every okf bundle and every skill directory.
 * links/broken, links/escapes-bundle, links/ctxman-invalid, links/relation-self (errors);
 * links/ctxman-target, links/relation-target (warnings).
 */
export async function checkLinks(
  dataDir: string = resolveDataDir(),
): Promise<{ findings: Finding[]; filesChecked: number }> {
  const findings: Finding[] = [];
  let filesChecked = 0;

  const checkRoot = async (dataset: OkfDatasetId | 'skill', name: string): Promise<void> => {
    const root = path.join(datasetDir(dataset, dataDir), name);
    for (const relPath of (await walkFiles(root)).filter((f) => f.endsWith('.md'))) {
      const source = await readFile(path.join(root, ...relPath.split('/')), 'utf8');
      filesChecked++;
      findings.push(...checkFileLinks({ dataset, name, relPath, source, dataDir }));
    }
  };

  for (const dataset of OKF_DATASET_IDS) {
    for (const bundle of await listBundles(dataset, dataDir)) await checkRoot(dataset, bundle);
  }
  for (const skill of await listSkillDirs(dataDir)) await checkRoot('skill', skill);

  return { findings: sortFindings(findings), filesChecked };
}

// ---------------------------------------------------------------- rendered HTML rewrite

function decodeAttr(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&#x27;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function encodeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/** Class that marks a link whose target does not exist (styled by prose.css). */
export const BROKEN_LINK_CLASS = 'cx-link--broken';

function insertAttr(tag: string, attr: string): string {
  return tag.replace(/\s*\/?>$/, (end) => `${attr}${end}`);
}

/** Adds `cx-link--broken` to the tag's class list (merged into an existing class) and sets its `title`. */
function markBroken(tag: string, title: string): string {
  let out = tag;
  const classMatch = /\sclass=(?:"([^"]*)"|'([^']*)')/i.exec(out);
  if (classMatch) {
    const existing = classMatch[1] ?? classMatch[2] ?? '';
    if (!existing.split(/\s+/).includes(BROKEN_LINK_CLASS)) {
      const merged = `${existing} ${BROKEN_LINK_CLASS}`.trim();
      out = out.replace(classMatch[0], () => ` class="${merged}"`);
    }
  } else {
    out = insertAttr(out, ` class="${BROKEN_LINK_CLASS}"`);
  }
  const titleAttr = ` title="${encodeAttr(title)}"`;
  const titleMatch = /\stitle=(?:"([^"]*)"|'([^']*)')/i.exec(out);
  return titleMatch ? out.replace(titleMatch[0], () => titleAttr) : insertAttr(out, titleAttr);
}

/**
 * Rewrites `href` attributes of `<a>` tags in rendered HTML. Bundle `.md` targets become site routes
 * (main.md -> the entry page, others -> the sub-doc page; fragment kept), `ctxman:<ds>/<slug>` becomes
 * `/<ds>/<slug>`, http(s) links open in a new tab. Anchors, non-.md bundle targets and links in skill
 * entries (no doc route) are left unchanged.
 *
 * With `ctx.dataDir` the targets are also checked on disk, and a link whose target is missing gets
 * `class="cx-link--broken"` (merged into an existing class) plus a `title`: `Missing: <ds>/<slug>` for a `ctxman:`
 * entry that does not exist, `Invalid ctxman: link` for a malformed `ctxman:` href, `Missing file: <path>` for a
 * bundle target that does not exist, `Points outside the bundle` for one that leaves it. Bundle targets are only
 * checked for okf and skill entries (the datasets that have a bundle directory).
 */
export function rewriteRenderedHtml(
  html: string,
  ctx: { dataset: DatasetId; slug: string; fromRelPath: string; dataDir?: string },
): string {
  const routable = (OKF_DATASET_IDS as readonly string[]).includes(ctx.dataset);
  const dataDir = ctx.dataDir;
  const bundleRoot =
    dataDir !== undefined && (routable || ctx.dataset === 'skill')
      ? path.join(datasetDir(ctx.dataset, dataDir), ctx.slug)
      : null;
  return html.replace(/<a\s[^>]*>/gi, (tag) => {
    const m = /\shref=(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!m) return tag;
    const original = m[1] ?? m[2] ?? '';
    const href = decodeAttr(original).trim();
    const kind = classifyHref(href);

    if (kind === 'external') {
      // Only web links open in a new tab; mailto:, tel:, file: etc. are left alone.
      if (!/^(?:https?:)?\/\//i.test(href)) return tag;
      let out = tag;
      const additions = [
        /\starget=/i.test(tag) ? '' : ' target="_blank"',
        /\srel=/i.test(tag) ? '' : ' rel="noreferrer"',
      ].join('');
      if (additions !== '') out = out.replace(/\/?>$/, (end) => `${additions}${end}`);
      return out;
    }

    let next: string | null = null;
    let broken: string | null = null;
    if (kind === 'ctxman') {
      const target = parseCtxmanHref(href);
      if (target) {
        next = `${entryUrl(target.dataset, target.slug)}${target.fragment ? `#${target.fragment}` : ''}`;
        if (dataDir !== undefined && !entryExists(dataDir, target.dataset, target.slug)) {
          broken = `Missing: ${target.dataset}/${target.slug}`;
        }
      } else if (dataDir !== undefined) {
        broken = 'Invalid ctxman: link';
      }
    } else if (kind === 'bundle') {
      const resolved = resolveBundleHref(href, ctx.fromRelPath);
      if (routable && 'path' in resolved && resolved.path.endsWith('.md')) {
        const fragment = stripQueryAndFragment(href).fragment;
        const base =
          resolved.path === 'main.md'
            ? entryUrl(ctx.dataset, ctx.slug)
            : docUrl(ctx.dataset, ctx.slug, encodeURI(resolved.path));
        next = fragment === '' ? base : `${base}#${fragment}`;
      }
      if (bundleRoot !== null) {
        if ('escapes' in resolved) {
          broken = 'Points outside the bundle';
        } else if (!existsSync(path.join(bundleRoot, ...resolved.path.split('/')))) {
          broken = `Missing file: ${resolved.path}`;
        }
      }
    }

    let out = tag;
    if (next !== null) {
      const replacement = `${m[0].slice(0, m[0].indexOf('=') + 1)}"${encodeAttr(next)}"`;
      out = out.replace(m[0], () => replacement);
    }
    return broken === null ? out : markBroken(out, broken);
  });
}
