// PURE (no fs, no astro:*; browser-safe). The ONE entry point to arktype validation: `validate(schema, input)`
// returns `{ success, data }` or `{ success: false, issues }` with plain `ValidationIssue`s, so call sites never
// touch `ArkErrors` and the Types in schemas.ts can change without rippling. `kind` lets the YAML editor and the
// forms tell what JSON Schema can express (`unknown-key`, `other`) from custom predicates (`custom`).
import { type } from 'arktype';
import type { Type } from 'arktype';

export interface ValidationIssue {
  /** ArkError.path: array of keys from the document root. */
  path: PropertyKey[];
  /** ArkError.message, e.g. "name must be a string (was missing)" (arktype prefixes the path). */
  message: string;
  /** ArkError.code: 'domain' | 'required' | 'predicate' | 'pattern' | 'union' | 'unit' | ... */
  code: string;
  /**
   * 'unknown-key' = an undeclared key of a `'+': 'reject'` object (ArkError.expected === 'removed');
   * 'custom' = a narrow predicate (code 'predicate' that is not unknown-key): duplicates, name changes, ...;
   * 'other' = everything JSON Schema can express.
   */
  kind: 'unknown-key' | 'custom' | 'other';
}

export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

/**
 * `undefined`-valued keys of plain objects are dropped (deeply, copy on write) before validation: arktype
 * rejects an explicit `undefined` for an optional key, while data from forms and TypeScript literals often
 * carries one. YAML and JSON never do.
 */
function pruneUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    let copy: unknown[] | null = null;
    value.forEach((item, index) => {
      const pruned = pruneUndefined(item);
      if (pruned !== item) {
        copy ??= [...value];
        copy[index] = pruned;
      }
    });
    return copy ?? value;
  }
  if (value === null || typeof value !== 'object') return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  let copy: Record<string, unknown> | null = null;
  for (const [key, item] of Object.entries(value)) {
    const pruned = item === undefined ? undefined : pruneUndefined(item);
    if (item === undefined || pruned !== item) {
      copy ??= { ...(value as Record<string, unknown>) };
      if (item === undefined) delete copy[key];
      else copy[key] = pruned;
    }
  }
  return copy ?? value;
}

/**
 * arktype compiles a big union of literals (`type.enumerated(...)` with many values) into a predicate, so its
 * errors carry code 'predicate' too; their `expected` is the list of values (`"a", "b" or "c"`). JSON Schema
 * expresses them (`enum`), unlike a narrow, so they are not 'custom'.
 */
const LITERAL = '(?:"(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?|null|true|false)';
const LITERAL_LIST = new RegExp(`^${LITERAL}(?:(?:, | or )${LITERAL})*$`);

function toIssue(error: InstanceType<typeof type.errors>[number]): ValidationIssue {
  let kind: ValidationIssue['kind'] = 'other';
  if (error.code === 'predicate') {
    if (error.expected === 'removed') kind = 'unknown-key';
    else if (!LITERAL_LIST.test(error.expected)) kind = 'custom';
  }
  return { path: [...error.path], message: error.message, code: error.code, kind };
}

/** Validate `input` against `schema`; never throws for bad data. `data` is the schema OUTPUT (defaults applied). */
export function validate<S extends Type<any, any>>(
  schema: S,
  input: unknown,
): ParseResult<S['infer']> {
  const result: unknown = schema(pruneUndefined(input));
  if (result instanceof type.errors) return { success: false, issues: [...result].map(toIssue) };
  return { success: true, data: result as S['infer'] };
}

/** `path: message` for the first issue, with the arktype path prefix of the message dropped. */
function firstIssueText(issues: readonly ValidationIssue[]): string {
  const first = issues[0];
  if (first === undefined) return 'invalid';
  const dotted = first.path.map((p) => String(p)).join('.');
  return dotted === '' ? first.message : `${dotted}: ${first.message}`;
}

/** Like `validate`, but returns the data or throws `Error("<what>: <first issue>")` (internal invariants). */
export function assertValid<S extends Type<any, any>>(
  schema: S,
  input: unknown,
  what = 'invalid data',
): S['infer'] {
  const result = validate(schema, input);
  if (!result.success) throw new Error(`${what}: ${firstIssueText(result.issues)}`);
  return result.data;
}
