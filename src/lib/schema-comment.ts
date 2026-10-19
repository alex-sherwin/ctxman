// PURE (no fs, no astro:*; browser-safe): the yaml-language-server "magic comment" that points a YAML data
// file at its generated JSON Schema (served by GET /api/schemas/<dataset>), and helpers to check / repair it.
// The comment points at the RUNNING app's /api/schemas/<ds>. It is NOT part of any serializer: file writers add
// it through `withSchemaComment`, passing the origin (`resolveServerOrigin()` in data-dir.ts).

/** The YAML datasets that have a JSON Schema, in registry order. */
export const SCHEMA_DATASETS = ['reference', 'snippet', 'context', 'recipe'] as const;
export type SchemaDatasetId = (typeof SCHEMA_DATASETS)[number];

export function isSchemaDatasetId(value: unknown): value is SchemaDatasetId {
  return typeof value === 'string' && (SCHEMA_DATASETS as readonly string[]).includes(value);
}

export const schemaFileName = (ds: SchemaDatasetId): string => `${ds}.schema.json`;

/** Origin written into modelines when none is configured (the dev/start default of the server). */
export const DEFAULT_SERVER_ORIGIN = 'http://127.0.0.1:4321';

const MODELINE_PREFIX = '# yaml-language-server:';

/** Path of the schema endpoint of the running app; the full URL is `${origin}${SCHEMA_API_PATH}${dataset}`. */
export const SCHEMA_API_PATH = '/api/schemas/';

/** `${origin}/api/schemas/<ds>`; `origin` has no trailing slash (see `resolveServerOrigin`). */
export function schemaUrl(ds: SchemaDatasetId, origin: string): string {
  return `${origin}${SCHEMA_API_PATH}${ds}`;
}

/** '# yaml-language-server: $schema=<origin>/api/schemas/<ds>': VS Code resolves it while ctxman runs. */
export function schemaCommentLine(ds: SchemaDatasetId, origin: string): string {
  return `${MODELINE_PREFIX} $schema=${schemaUrl(ds, origin)}`;
}

/** `${schemaCommentLine(ds, origin)}\n${body}` (body = a serializer's output, already ending in '\n'). */
export function withSchemaComment(ds: SchemaDatasetId, body: string, origin: string): string {
  return `${schemaCommentLine(ds, origin)}\n${body}`;
}

const BOM = '﻿';

/** First line of `source` without BOM and without a trailing CR. */
function firstLine(source: string): string {
  const text = source.startsWith(BOM) ? source.slice(1) : source;
  const end = text.indexOf('\n');
  const line = end === -1 ? text : text.slice(0, end);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** Any loopback origin (127.0.0.1, localhost, [::1]; optional port) with the dataset's schema endpoint. */
function schemaUrlPattern(ds: SchemaDatasetId): RegExp {
  return new RegExp(
    `^https?://(?:127\\.0\\.0\\.1|localhost|\\[::1\\])(?::\\d{1,5})?${SCHEMA_API_PATH}${ds}(?:\\.schema\\.json)?$`,
  );
}

/**
 * First line (BOM stripped, CR stripped): 'ok' when it is a modeline whose $schema is
 * http(s)://(127.0.0.1|localhost|[::1])(:port)?/api/schemas/<ds> (optional trailing `.schema.json`, no query);
 * 'wrong' when a modeline exists but is anything else; else 'missing'.
 */
export function schemaCommentStatus(
  ds: SchemaDatasetId,
  source: string,
): 'ok' | 'missing' | 'wrong' {
  const line = firstLine(source);
  if (!line.startsWith(MODELINE_PREFIX)) return 'missing';
  const prefix = `${MODELINE_PREFIX} $schema=`;
  if (!line.startsWith(prefix)) return 'wrong';
  return schemaUrlPattern(ds).test(line.slice(prefix.length)) ? 'ok' : 'wrong';
}

/**
 * Idempotent repair: 'ok' -> unchanged (any loopback origin is accepted); 'wrong' -> first line replaced (EOL kept); 'missing' -> line
 * prepended (BOM dropped; a CRLF file gets '\r\n' after the inserted line).
 */
export function fixSchemaComment(ds: SchemaDatasetId, source: string, origin: string): string {
  const status = schemaCommentStatus(ds, source);
  if (status === 'ok') return source;
  const line = schemaCommentLine(ds, origin);
  const text = source.startsWith(BOM) ? source.slice(1) : source;
  if (status === 'wrong') {
    const end = text.indexOf('\n');
    if (end === -1) return line;
    const cr = text.charAt(end - 1) === '\r' ? '\r' : '';
    return `${line}${cr}${text.slice(end)}`;
  }
  // Which EOL does the file use? Decided by the first line break.
  const firstBreak = text.indexOf('\n');
  const eol = firstBreak > 0 && text.charAt(firstBreak - 1) === '\r' ? '\r\n' : '\n';
  return `${line}${eol}${text}`;
}
