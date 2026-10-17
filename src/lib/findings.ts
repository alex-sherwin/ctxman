// PURE: the Finding/Report model shared by every compliance check (okf, links, collections) and the CLIs.
// Rule ids are stable strings (e.g. 'okf/type', 'links/broken'); tests and the Tools page rely on them.

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

/** Structural subset of a zod issue (kept zod-free so this module stays dependency-free). */
export interface PathIssue {
  path: readonly PropertyKey[];
  message: string;
}

/** `['links', 0, 'slug']` -> 'links.0.slug'; '' for the root. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join('.');
}

function valueAt(root: unknown, path: readonly PropertyKey[]): unknown {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/**
 * zod's wording for absent fields ("expected string, received undefined", and for coerced dates
 * "expected date, received Date") is cryptic; when the offending `root` document is given, say what is wrong.
 */
export function describeIssue(issue: PathIssue, root?: unknown): string {
  if (root === undefined) return issue.message;
  const missing = valueAt(root, issue.path) === undefined;
  if (missing && /^Invalid input: expected \w+, received (undefined|Date)$/.test(issue.message)) {
    return 'Required';
  }
  if (/expected date, received Date/.test(issue.message)) {
    return 'Invalid date (use YYYY-MM-DD or an ISO 8601 timestamp)';
  }
  return issue.message;
}

/** `path: message` (just `message` for a root issue); pass the parsed document as `root` for friendlier wording. */
export function issueMessage(issue: PathIssue, root?: unknown): string {
  const message = describeIssue(issue, root);
  const p = issuePath(issue.path);
  return p === '' ? message : `${p}: ${message}`;
}
