// PURE: the Forge YAML view's serializer + validator (UI_SPEC §H.7).
// `serializeContext` writes exactly what the server's context-io.serializeContext writes (same key order,
// same notes normalisation), so a context round-trips identically through the Forge and the API.
// `parseContextYaml` parses with the same options as src/lib/yaml.ts `parseYaml` (core schema, timestamp
// tag, merge keys), validates with the zod `contextSchema`, and maps every problem to a 1-based source
// position that Monaco can show as a marker. No node:* / astro:* imports: it runs in the browser.
import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';
import type { Document } from 'yaml';
import { contextSchema } from '../datasets/schemas.ts';
import type { ContextDoc } from './entry-summary.ts';
import { describeIssue, issuePath } from './findings.ts';
import { stringifyYaml } from './yaml.ts';

export interface YamlIssue {
  /** 1-based, like Monaco. */
  line: number;
  column: number;
  endLine: number;
  /** Exclusive end column; always > `column` when `endLine === line`. */
  endColumn: number;
  message: string;
  /** 'yaml' = syntax error; 'schema' = valid YAML that is not a valid context. */
  source: 'yaml' | 'schema';
}

export type ContextYamlResult = { ok: true; doc: ContextDoc } | { ok: false; issues: YamlIssue[] };

/** Cascading syntax errors are noise after the first few. */
const MAX_ISSUES = 50;

// ---------------------------------------------------------------- serialize

function normalizeNotes(notes: string | undefined): string | undefined {
  if (notes === undefined) return undefined;
  const text = notes.replace(/\r\n?/g, '\n').trimEnd();
  return text.trim() === '' ? undefined : `${text}\n`;
}

/**
 * Deterministic YAML: key order name, description, tags (omitted when empty), links[{dataset, slug,
 * notes (omitted when blank)}]; multi-line notes become `|` literal blocks.
 */
export function serializeContext(doc: ContextDoc): string {
  const out: Record<string, unknown> = { name: doc.name, description: doc.description };
  if (doc.tags !== undefined && doc.tags.length > 0) out.tags = doc.tags;
  out.links = doc.links.map((link) => {
    const item: Record<string, unknown> = { dataset: link.dataset, slug: link.slug };
    const notes = normalizeNotes(link.notes);
    if (notes !== undefined) item.notes = notes;
    return item;
  });
  return stringifyYaml(out);
}

// ---------------------------------------------------------------- compare

/** Key-order independent shape used to compare two contexts (missing tags/notes == empty). */
function canonical(doc: ContextDoc): unknown {
  return {
    name: doc.name,
    description: doc.description,
    tags: doc.tags ?? [],
    links: doc.links.map((l) => ({
      dataset: l.dataset,
      slug: l.slug,
      notes: l.notes === undefined || l.notes === '' ? null : l.notes,
    })),
  };
}

/** True when both contexts hold the same data (ignores key order and absent-vs-empty tags/notes). */
export function sameContext(a: ContextDoc | null, b: ContextDoc | null): boolean {
  if (a === null || b === null) return a === b;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// ---------------------------------------------------------------- parse + validate

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
 * Parse `text` as a context. `expectedName` is the immutable context name (file stem): a different
 * `name:` is an error. Syntax errors come first; schema problems are only reported for syntactically
 * valid YAML (a half-typed document would otherwise produce a wall of follow-up errors).
 */
export function parseContextYaml(text: string, expectedName: string): ContextYamlResult {
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
    }));
    return { ok: false, issues: issues.sort(byPosition) };
  }

  const value: unknown = doc.toJS() ?? {};
  const parsed = contextSchema.safeParse(value);
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
          });
        }
        continue;
      }
      issues.push({
        ...spanAtPath(doc, lc, text, issue.path),
        message: `${prefix}${describeIssue(issue, value)}`,
        source: 'schema',
      });
    }
  }

  const rawName =
    typeof value === 'object' && value !== null ? (value as { name?: unknown }).name : undefined;
  const nameIssueExists =
    !parsed.success && parsed.error.issues.some((i) => issuePath(i.path) === 'name');
  if (typeof rawName === 'string' && rawName !== expectedName && !nameIssueExists) {
    issues.push({
      ...spanAtPath(doc, lc, text, ['name']),
      message: `name must stay "${expectedName}" (rename isn't supported)`,
      source: 'schema',
    });
  }

  if (!parsed.success || issues.length > 0) {
    return { ok: false, issues: issues.slice(0, MAX_ISSUES).sort(byPosition) };
  }
  return { ok: true, doc: parsed.data };
}
