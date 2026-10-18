// PURE (no fs, no astro:*; browser-safe): the generic "YAML text -> validated document with source positions"
// machinery behind every YAML editor (the Forge's YAML view and the DataForm YAML tab). Extracted from
// context-yaml.ts (ROUND2_UI_SPEC §H.1); `parseContextYaml` is now a thin wrapper around `parseYamlDoc`.
// Parses with the same options as src/lib/yaml.ts `parseYaml` (core schema, timestamp tag, merge keys),
// validates with a zod schema, and maps every problem to a 1-based source position that Monaco can show as
// a marker.
import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';
import type { Document } from 'yaml';
import type { ZodType } from 'zod';
import { describeIssue, issuePath } from './findings.ts';

export interface YamlIssue {
  /** 1-based, like Monaco. */
  line: number;
  column: number;
  endLine: number;
  /** Exclusive end column; always > `column` when `endLine === line`. */
  endColumn: number;
  message: string;
  /** 'yaml' = syntax error; 'schema' = valid YAML that is not a valid document. */
  source: 'yaml' | 'schema';
  /**
   * True when the generated JSON Schema (schemas/<dataset>.schema.json, shown by monaco-yaml in an editor that
   * sets `schemaDataset`) reports the same problem: syntax errors and every zod issue except `custom` ones.
   * False for what JSON Schema cannot express: duplicate links, a changed `name`. An editor with monaco-yaml
   * passes only `issues.filter((i) => !i.coveredBySchema)` as markers; `ok` / apply logic is unaffected.
   */
  coveredBySchema: boolean;
}

export type YamlDocResult<T> = { ok: true; doc: T } | { ok: false; issues: YamlIssue[] };

export interface ParseYamlDocOptions {
  /** The immutable entry name (file stem): a different `name:` is an error. Omit when the name may change. */
  expectedName?: string;
  /** Message of the name-changed issue. Default: `name must stay "<n>" (rename isn't supported)`. */
  nameMessage?: (expected: string) => string;
}

/** Cascading syntax errors are noise after the first few. */
const MAX_ISSUES = 50;

const defaultNameMessage = (expected: string): string =>
  `name must stay "${expected}" (rename isn't supported)`;

interface Span {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

function toSpan(lc: LineCounter, start: number, end: number): Span {
  const a = lc.linePos(start);
  const b = lc.linePos(Math.max(start, end));
  let endColumn = b.col;
  if (b.line === a.line && endColumn <= a.col) endColumn = a.col + 1;
  return { line: a.line, column: a.col, endLine: b.line, endColumn };
}

function rangeOf(node: unknown): [number, number] | null {
  if (typeof node !== 'object' || node === null || !('range' in node)) return null;
  const range = (node as { range?: unknown }).range;
  if (!Array.isArray(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
    return null;
  }
  return [range[0], range[1]];
}

type YamlPathPart = string | number;
const toYamlPath = (path: readonly PropertyKey[]): YamlPathPart[] =>
  path.map((p) => (typeof p === 'symbol' ? String(p) : p));

function firstLineSpan(text: string, lc: LineCounter): Span {
  const eol = text.indexOf('\n');
  return toSpan(lc, 0, eol === -1 ? text.length : eol);
}

/** Span of the node at `path`, else of its nearest existing ancestor, else of the first line. */
function spanAtPath(
  doc: Document,
  lc: LineCounter,
  text: string,
  path: readonly PropertyKey[],
): Span {
  const yamlPath = toYamlPath(path);
  for (let n = yamlPath.length; n > 0; n--) {
    const range = rangeOf(doc.getIn(yamlPath.slice(0, n), true));
    if (range !== null) return toSpan(lc, range[0], range[1]);
  }
  return firstLineSpan(text, lc);
}

/** Span of the KEY `key` inside the mapping at `path` (unknown-property problems point at the key). */
function spanOfKey(
  doc: Document,
  lc: LineCounter,
  text: string,
  path: readonly PropertyKey[],
  key: string,
): Span {
  const parent = path.length === 0 ? doc.contents : doc.getIn(toYamlPath(path), true);
  if (isMap(parent)) {
    for (const pair of parent.items) {
      if (isScalar(pair.key) && String(pair.key.value) === key) {
        const range = rangeOf(pair.key);
        if (range !== null) return toSpan(lc, range[0], range[1]);
      }
    }
  }
  return spanAtPath(doc, lc, text, path);
}

function unrecognizedKeys(issue: { code: string }): string[] {
  if (issue.code !== 'unrecognized_keys') return [];
  const keys = (issue as { keys?: unknown }).keys;
  return Array.isArray(keys) ? keys.map(String) : [];
}

function byPosition(a: YamlIssue, b: YamlIssue): number {
  return a.line - b.line || a.column - b.column;
}

/**
 * Parse `text` and validate it with `schema`. Syntax errors come first; schema problems are only reported for
 * syntactically valid YAML (a half-typed document would otherwise produce a wall of follow-up errors).
 * With `opts.expectedName` a different top-level `name:` is an extra (non-schema) issue.
 */
export function parseYamlDoc<T>(
  text: string,
  schema: ZodType<T>,
  opts: ParseYamlDocOptions = {},
): YamlDocResult<T> {
  const lc = new LineCounter();
  const doc = parseDocument(text, {
    lineCounter: lc,
    prettyErrors: false,
    customTags: ['timestamp'],
    merge: true,
    schema: 'core',
  });

  if (doc.errors.length > 0) {
    const issues = doc.errors.slice(0, MAX_ISSUES).map<YamlIssue>((err) => ({
      ...toSpan(lc, err.pos[0], err.pos[1]),
      message: err.message,
      source: 'yaml',
      coveredBySchema: true,
    }));
    return { ok: false, issues: issues.sort(byPosition) };
  }

  const value: unknown = doc.toJS() ?? {};
  const parsed = schema.safeParse(value);
  const issues: YamlIssue[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const label = issuePath(issue.path);
      const prefix = label === '' ? '' : `${label}: `;
      const keys = unrecognizedKeys(issue);
      if (keys.length > 0) {
        for (const key of keys) {
          issues.push({
            ...spanOfKey(doc, lc, text, issue.path, key),
            message: `${prefix}Unrecognized key "${key}"`,
            source: 'schema',
            coveredBySchema: true,
          });
        }
        continue;
      }
      issues.push({
        ...spanAtPath(doc, lc, text, issue.path),
        message: `${prefix}${describeIssue(issue, value)}`,
        source: 'schema',
        coveredBySchema: issue.code !== 'custom',
      });
    }
  }

  const { expectedName } = opts;
  if (expectedName !== undefined) {
    const rawName =
      typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined;
    const nameIssueExists =
      !parsed.success && parsed.error.issues.some((i) => issuePath(i.path) === 'name');
    if (typeof rawName === 'string' && rawName !== expectedName && !nameIssueExists) {
      issues.push({
        ...spanAtPath(doc, lc, text, ['name']),
        message: (opts.nameMessage ?? defaultNameMessage)(expectedName),
        source: 'schema',
        coveredBySchema: false,
      });
    }
  }

  if (!parsed.success || issues.length > 0) {
    return { ok: false, issues: issues.slice(0, MAX_ISSUES).sort(byPosition) };
  }
  return { ok: true, doc: parsed.data };
}
