// NODE: OKF v0.2 frontmatter handling and conformance checks for every okf bundle
// (data/<kb|rca|idea|task|bug|feature|project>/<name>/**). Rule ids: PLAN.md §E.5.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { datasetDef, isValidName, OKF_DATASET_IDS } from '../datasets/registry.ts';
import type { OkfDatasetId } from '../datasets/registry.ts';
import { DATASET_SCHEMAS, okfConceptSchema, okfIndexSchema } from '../datasets/schemas.ts';
import { walkFiles } from './bundles.ts';
import { datasetDir, resolveDataDir } from './data-dir.ts';
import { issueMessage, sortFindings } from './findings.ts';
import type { Finding, PathIssue } from './findings.ts';
import { parseYaml } from './yaml.ts';

export interface ParsedDoc {
  data: Record<string, unknown>;
  body: string;
  /** 1-based line of the file where `body` starts. */
  bodyLine: number;
}

// ---------------------------------------------------------------- frontmatter

/**
 * Splits `---` frontmatter from the body. null unless the file starts with a `---` line (optional BOM,
 * CRLF normalized to LF) and a closing `---` line follows. `raw` starts on file line 2.
 */
export function splitFrontmatter(
  source: string,
): { raw: string; body: string; bodyLine: number } | null {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  if (lines[0]?.trimEnd() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trimEnd() === '---') {
      return {
        raw: lines.slice(1, i).join('\n'),
        body: lines.slice(i + 1).join('\n'),
        bodyLine: i + 2,
      };
    }
  }
  return null;
}

type FrontmatterResult = { ok: true; doc: ParsedDoc } | { ok: false; error: string; line?: number };

/** Message + file line of a YAML parse error (line relative to the file, frontmatter starts on line 2). */
function yamlErrorInfo(error: unknown): { message: string; line?: number } {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split('\n')[0] ?? message;
  const linePos = (error as { linePos?: { line?: number }[] } | null)?.linePos;
  const line = linePos?.[0]?.line;
  return line === undefined ? { message: first } : { message: first, line: line + 1 };
}

function asMapping(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Strict parse for concept files: missing frontmatter, bad YAML and non-mapping frontmatter are errors. */
export function parseFrontmatter(source: string): FrontmatterResult {
  const split = splitFrontmatter(source);
  if (!split) return { ok: false, error: 'missing frontmatter', line: 1 };
  let value: unknown;
  try {
    value = parseYaml(split.raw);
  } catch (error) {
    const info = yamlErrorInfo(error);
    return info.line === undefined
      ? { ok: false, error: info.message }
      : { ok: false, error: info.message, line: info.line };
  }
  // An empty block (`---\n---`) is an empty mapping; `type` is then reported as missing.
  const data = value === undefined || value === null ? {} : asMapping(value);
  if (!data) return { ok: false, error: 'frontmatter is not a mapping', line: 2 };
  return { ok: true, doc: { data, body: split.body, bodyLine: split.bodyLine } };
}

/** For reserved files (index.md / log.md) and the `docs` collection: no frontmatter is fine; throws on bad YAML. */
export function parseFrontmatterLoose(source: string): ParsedDoc {
  const split = splitFrontmatter(source);
  if (!split) return { data: {}, body: source, bodyLine: 1 };
  let value: unknown;
  try {
    value = parseYaml(split.raw);
  } catch (error) {
    throw new Error(yamlErrorInfo(error).message, { cause: error });
  }
  const data = value === undefined || value === null ? {} : asMapping(value);
  if (!data) throw new Error('frontmatter is not a mapping');
  return { data, body: split.body, bodyLine: split.bodyLine };
}

/** File line of a top-level frontmatter key (1-based), for nicer findings. */
function keyLine(raw: string, key: string): number | undefined {
  const lines = raw.split('\n');
  const pattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
  const index = lines.findIndex((l) => pattern.test(l));
  return index === -1 ? undefined : index + 2;
}

// ---------------------------------------------------------------- code masking (shared with links.ts)

function blank(text: string): string {
  return text.replace(/[^\r\n]/g, ' ');
}

/**
 * Length-preserving copy of `markdown` with fenced code blocks and inline code spans replaced by spaces
 * (newlines kept), so scanners can ignore code without losing offsets or line numbers.
 */
export function maskMarkdownCode(markdown: string): string {
  const lines = markdown.split('\n');
  let fence: { char: string; length: number } | null = null;
  const masked = lines.map((line) => {
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close?.[1] && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
      return blank(line);
    }
    const open = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
    if (open?.[1] && !(open[1][0] === '`' && (open[2] ?? '').includes('`'))) {
      fence = { char: open[1][0] ?? '`', length: open[1].length };
      return blank(line);
    }
    return line;
  });
  return maskInlineCode(masked.join('\n'));
}

function maskInlineCode(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== '`') {
      out += ch;
      i++;
      continue;
    }
    let j = i;
    while (text[j] === '`') j++;
    const length = j - i;
    let found = -1;
    let k = j;
    while (k < text.length) {
      if (text[k] === '`') {
        let m = k;
        while (text[m] === '`') m++;
        if (m - k === length) {
          found = m;
          break;
        }
        k = m;
      } else {
        k++;
      }
    }
    // A code span never crosses a paragraph break.
    if (found !== -1 && !/\n[ \t]*\r?\n/.test(text.slice(i, found))) {
      out += blank(text.slice(i, found));
      i = found;
    } else {
      out += text.slice(i, j);
      i = j;
    }
  }
  return out;
}

// ---------------------------------------------------------------- path classes

/** relPath is bundle-relative posix. `index.md` / `log.md` are reserved at every level. */
export function classifyOkfPath(relPath: string): 'root-index' | 'index' | 'log' | 'concept' {
  if (relPath === 'index.md') return 'root-index';
  const base = path.posix.basename(relPath);
  if (base === 'index.md') return 'index';
  if (base === 'log.md') return 'log';
  return 'concept';
}

// ---------------------------------------------------------------- file validation

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isRealYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** YAML 1.1 timestamps: an unquoted `2026-12-01` arrives as a Date at 00:00Z. */
function isValidStaleAfter(value: unknown): boolean {
  if (typeof value === 'string') return isRealYmd(value);
  if (value instanceof Date) {
    return !Number.isNaN(value.getTime()) && value.toISOString().endsWith('T00:00:00.000Z');
  }
  return false;
}

function rawFrontmatterOf(source: string): string {
  return splitFrontmatter(source)?.raw ?? '';
}

/** Validates one markdown file of a bundle. `file` is used verbatim as the data-dir-relative path of each finding. */
export function validateOkfFile(args: {
  dataset: OkfDatasetId;
  bundle: string;
  relPath: string;
  source: string;
  file: string;
}): Finding[] {
  const { dataset, bundle, relPath, source, file } = args;
  const findings: Finding[] = [];
  const add = (
    severity: Finding['severity'],
    rule: string,
    message: string,
    line?: number,
  ): void => {
    findings.push(
      line === undefined
        ? { severity, rule, file, message }
        : { severity, rule, file, line, message },
    );
  };

  const kind = classifyOkfPath(relPath);

  if (kind === 'root-index') {
    validateRootIndex(source, add);
    return findings;
  }
  if (kind === 'index' || kind === 'log') {
    if (splitFrontmatter(source)) {
      add(
        'error',
        'okf/reserved-frontmatter',
        `${path.posix.basename(relPath)} must not have frontmatter`,
        1,
      );
    }
    if (kind === 'log') validateLog(source, add);
    return findings;
  }

  // concept
  const parsed = parseFrontmatter(source);
  if (!parsed.ok) {
    add('error', 'okf/frontmatter', parsed.error, parsed.line);
    return findings;
  }
  const { data, body, bodyLine } = parsed.doc;
  const raw = rawFrontmatterOf(source);
  const reported = new Set<string>();
  const dedupe = (issue: PathIssue): boolean => {
    const key = `${issue.path.map(String).join('.')}\0${issue.message}`;
    if (reported.has(key)) return false;
    reported.add(key);
    return true;
  };

  // stale_after has its own rule; `type` too. Mark them handled before schema issues are listed.
  const handledKeys = new Set<string>();

  const type = data.type;
  if (typeof type !== 'string' || type.trim() === '') {
    add(
      'error',
      'okf/type',
      '`type` is required and must be a non-empty string',
      keyLine(raw, 'type') ?? 2,
    );
    handledKeys.add('type');
  }

  if ('stale_after' in data) {
    handledKeys.add('stale_after');
    if (!isValidStaleAfter(data.stale_after)) {
      add(
        'error',
        'okf/stale-after-format',
        '`stale_after` must be an absolute date in YYYY-MM-DD form',
        keyLine(raw, 'stale_after'),
      );
    }
  }

  const reportIssues = (rule: string, issues: readonly PathIssue[]): void => {
    for (const issue of issues) {
      const top = issue.path[0];
      if (typeof top === 'string' && handledKeys.has(top)) continue;
      if (!dedupe(issue)) continue;
      add(
        'error',
        rule,
        issueMessage(issue),
        typeof top === 'string' ? keyLine(raw, top) : undefined,
      );
    }
  };

  const concept = okfConceptSchema.safeParse(data);
  if (!concept.success) reportIssues('okf/concept-schema', concept.error.issues);

  if (relPath === 'main.md') {
    const entry = DATASET_SCHEMAS[dataset].safeParse(data);
    if (!entry.success) reportIssues('okf/entry-schema', entry.error.issues);
    if (typeof data.name === 'string' && data.name !== bundle) {
      add(
        'error',
        'okf/name-mismatch',
        `name "${data.name}" must equal the bundle directory name "${bundle}"`,
        keyLine(raw, 'name'),
      );
    }
    const expectedType = datasetDef(dataset).okfType;
    if (typeof type === 'string' && type.trim() !== '' && expectedType && type !== expectedType) {
      add(
        'warning',
        'okf/type-mismatch',
        `type "${type}" differs from the usual "${expectedType}" for ${dataset} entries`,
        keyLine(raw, 'type'),
      );
    }
  }

  checkFootnotes(body, bodyLine, data, add);
  return findings;
}

type AddFinding = (
  severity: Finding['severity'],
  rule: string,
  message: string,
  line?: number,
) => void;

function validateRootIndex(source: string, add: AddFinding): void {
  const split = splitFrontmatter(source);
  if (!split) return; // no frontmatter at all is fine
  let value: unknown;
  try {
    value = parseYaml(split.raw);
  } catch (error) {
    const info = yamlErrorInfo(error);
    add('error', 'okf/index-frontmatter', info.message, info.line ?? 2);
    return;
  }
  const data = value === undefined || value === null ? {} : value;
  const result = okfIndexSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      add(
        'error',
        'okf/index-frontmatter',
        `${issueMessage(issue)} (the bundle-root index.md may only declare okf_version: "0.2")`,
        2,
      );
    }
  }
}

function validateLog(source: string, add: AddFinding): void {
  const masked = maskMarkdownCode(source.replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
  let previous: string | null = null;
  masked.split('\n').forEach((line, index) => {
    const m = /^##(?!#)[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(line);
    if (!m) return;
    const heading = (m[1] ?? '').trim();
    if (!isRealYmd(heading)) {
      add(
        'error',
        'okf/log-heading',
        `log heading "${heading}" must be an ISO date (YYYY-MM-DD)`,
        index + 1,
      );
      return;
    }
    if (previous !== null && heading >= previous) {
      add(
        'warning',
        'okf/log-order',
        `log dates must be newest-first: ${heading} follows ${previous}`,
        index + 1,
      );
    }
    previous = heading;
  });
}

function checkFootnotes(
  body: string,
  bodyLine: number,
  data: Record<string, unknown>,
  add: AddFinding,
): void {
  const masked = maskMarkdownCode(body);
  const known = new Set<string>();
  if (Array.isArray(data.sources)) {
    for (const s of data.sources) {
      const id = asMapping(s)?.id;
      if (typeof id === 'string') known.add(id);
    }
  }
  const references: { id: string; index: number }[] = [];
  for (const m of masked.matchAll(/\[\^([^\]\s]+)\]/g)) {
    const index = m.index ?? 0;
    const lineStart = masked.lastIndexOf('\n', index - 1) + 1;
    const isDefinition =
      /^ {0,3}$/.test(masked.slice(lineStart, index)) && masked[index + m[0].length] === ':';
    if (isDefinition) known.add(m[1] ?? '');
    else references.push({ id: m[1] ?? '', index });
  }
  const warned = new Set<string>();
  for (const ref of references) {
    if (known.has(ref.id) || warned.has(ref.id)) continue;
    warned.add(ref.id);
    const line = bodyLine + masked.slice(0, ref.index).split('\n').length - 1;
    add(
      'warning',
      'okf/footnote-source',
      `footnote [^${ref.id}] has no definition and no sources[].id "${ref.id}"`,
      line,
    );
  }
}

// ---------------------------------------------------------------- dataset walk

/** Sorted bundle (directory) names of an okf dataset; dot-entries skipped. */
export async function listBundles(
  dataset: OkfDatasetId,
  dataDir: string = resolveDataDir(),
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(datasetDir(dataset, dataDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/** Strays: non-directory, non-dot entries directly under data/<okf-dataset>/. */
async function listStrays(dataset: OkfDatasetId, dataDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(datasetDir(dataset, dataDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => !e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

/** OKF conformance of every bundle of every okf dataset. */
export async function checkOkf(
  dataDir: string = resolveDataDir(),
): Promise<{ findings: Finding[]; filesChecked: number }> {
  const findings: Finding[] = [];
  let filesChecked = 0;

  for (const dataset of OKF_DATASET_IDS) {
    for (const stray of await listStrays(dataset, dataDir)) {
      findings.push({
        severity: 'warning',
        rule: 'okf/stray-file',
        file: `${dataset}/${stray}`,
        message: `only bundle directories belong in data/${dataset}/`,
      });
    }

    for (const bundle of await listBundles(dataset, dataDir)) {
      const root = path.join(datasetDir(dataset, dataDir), bundle);
      const bundleFile = `${dataset}/${bundle}`;
      if (!isValidName(bundle)) {
        findings.push({
          severity: 'error',
          rule: 'okf/bad-bundle-name',
          file: bundleFile,
          message:
            'bundle directory names must be kebab-case: a-z, 0-9, single hyphens, max 64 chars',
        });
      }
      const files = (await walkFiles(root)).filter((f) => f.endsWith('.md'));
      if (!files.includes('main.md')) {
        findings.push({
          severity: 'error',
          rule: 'okf/missing-main',
          file: bundleFile,
          message: 'bundle has no main.md (the entry concept)',
        });
      }
      if (!files.includes('index.md')) {
        findings.push({
          severity: 'warning',
          rule: 'okf/missing-index',
          file: bundleFile,
          message: 'bundle has no root index.md',
        });
      }
      for (const relPath of files) {
        const source = await readFile(path.join(root, ...relPath.split('/')), 'utf8');
        filesChecked++;
        findings.push(
          ...validateOkfFile({
            dataset,
            bundle,
            relPath,
            source,
            file: `${bundleFile}/${relPath}`,
          }),
        );
      }
    }
  }
  return { findings: sortFindings(findings), filesChecked };
}
