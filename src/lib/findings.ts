// PURE: the Finding/Report model shared by every compliance check (okf, links, collections) and the CLIs.
// Rule ids are stable strings (e.g. 'okf/type', 'links/broken'); tests and the Tools page rely on them.
import { ITEM_KIND_LABELS, ITEM_KINDS } from './inflate/catalog.ts';
import type { ItemKind } from './inflate/catalog.ts';

export type Severity = 'error' | 'warning';

export interface Finding {
  severity: Severity;
  rule: string;
  /** Data-dir-relative posix path, e.g. 'kb/ctxman/concepts/search.md'. */
  file: string;
  /** 1-based line within `file` when known. */
  line?: number;
  message: string;
}

export interface Report {
  ok: boolean;
  errors: number;
  warnings: number;
  /** Sorted by file, line, rule. */
  findings: Finding[];
  /** Number of files the check looked at (set by the check functions; shown in the clean summary). */
  filesChecked?: number;
}

/** Stable report order: file, line (unknown first), rule, message. Returns a new array. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compareText(a.file, b.file) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      compareText(a.rule, b.rule) ||
      compareText(a.message, b.message),
  );
}

/** ok = no errors (warnings never fail). Findings are sorted by file, line (unknown first), rule. */
export function toReport(findings: readonly Finding[], filesChecked?: number): Report {
  const sorted = sortFindings(findings);
  const errors = sorted.filter((f) => f.severity === 'error').length;
  const report: Report = {
    ok: errors === 0,
    errors,
    warnings: sorted.length - errors,
    findings: sorted,
  };
  if (filesChecked !== undefined) report.filesChecked = filesChecked;
  return report;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `ERROR rule file:line message` / `WARN rule file:line message` lines plus a one-line summary. */
export function formatReport(title: string, r: Report): string {
  const lines = r.findings.map((f) => {
    const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
    return `${f.severity === 'error' ? 'ERROR' : 'WARN '} ${f.rule} ${where} ${f.message}`;
  });
  const files = r.filesChecked === undefined ? '' : ` (${r.filesChecked} files)`;
  lines.push(
    r.errors === 0 && r.warnings === 0
      ? `${title}: OK${files}`
      : `${title}: ${r.errors} errors, ${r.warnings} warnings${files}`,
  );
  return lines.join('\n');
}

export function exitCode(r: Report): 0 | 1 {
  return r.errors === 0 ? 0 : 1;
}

/** Structural subset of a `ValidationIssue` (src/datasets/validate.ts), kept import-free so this module stays dependency-free. */
export interface PathIssue {
  path: readonly PropertyKey[];
  message: string;
  /** ArkError code ('union', 'predicate', ...) when known. */
  code?: string;
}

/** `['links', 0, 'slug']` -> 'links.0.slug'; '' for the root. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join('.');
}

/** arktype's own spelling of a path in its messages: `links[0].slug`, `tags[1]`, `name`. */
function arkPath(path: readonly PropertyKey[]): string {
  let out = '';
  path.forEach((key, index) => {
    if (typeof key === 'number') out += `[${key}]`;
    else out += index === 0 ? String(key) : `.${String(key)}`;
  });
  return out;
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** The message without arktype's leading path ("name must be a string" at path ['name'] -> "must be a string"). */
function withoutPathPrefix(issue: PathIssue): string {
  for (const prefix of [arkPath(issue.path), issuePath(issue.path)]) {
    if (prefix !== '' && issue.message.startsWith(`${prefix} `)) {
      return issue.message.slice(prefix.length + 1);
    }
  }
  return issue.message;
}

/**
 * Friendly wording for the arktype messages ctxman users meet most: a missing field is "Required", an unparsable
 * date says which formats work, an undeclared key is "Unrecognized key". A per-kind recipe default whose
 * `mode` / `material` does not belong to the kind (a union error) names the kind. Any other message loses only
 * arktype's leading path, because `issueMessage()` adds the path itself.
 */
export function describeIssue(issue: PathIssue, root?: unknown): string {
  if (issue.message.endsWith('(was missing)')) return 'Required';
  if (root !== undefined) {
    const value = valueAt(root, issue.path);
    if (value === undefined && issue.message.endsWith('(was undefined)')) return 'Required';
    const [section, kind, field] = issue.path;
    if (
      value !== undefined &&
      section === 'defaults' &&
      typeof kind === 'string' &&
      (field === 'mode' || field === 'material') &&
      issue.path.length === 3 &&
      (ITEM_KINDS as readonly string[]).includes(kind)
    ) {
      return `${field} "${String(value)}" does not apply to ${ITEM_KIND_LABELS[kind as ItemKind]} items`;
    }
  }
  if (/must be a parsable date/.test(issue.message)) {
    return 'Invalid date (use YYYY-MM-DD or an ISO 8601 timestamp)';
  }
  if (issue.message.endsWith(' must be removed')) {
    return `Unrecognized key "${String(issue.path.at(-1))}"`;
  }
  // a `.describe("must be …")` text lands after arktype's own "must be"
  return withoutPathPrefix(issue).replace(/^must be must be /, 'must be ');
}

/** `path: message` (just `message` for a root issue); pass the parsed document as `root` for friendlier wording. */
export function issueMessage(issue: PathIssue, root?: unknown): string {
  const message = describeIssue(issue, root);
  const p = issuePath(issue.path);
  return p === '' ? message : `${p}: ${message}`;
}
