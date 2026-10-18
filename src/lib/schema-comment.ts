// PURE (no fs, no astro:*; browser-safe): the yaml-language-server "magic comment" that points a YAML data
// file at its generated JSON Schema (schemas/<dataset>.schema.json), and helpers to check / repair it.
// The comment is NOT part of any serializer: file writers add it through `withSchemaComment`.

/** The YAML datasets that have a JSON Schema, in registry order. */
export const SCHEMA_DATASETS = ['reference', 'context', 'recipe'] as const;
export type SchemaDatasetId = (typeof SCHEMA_DATASETS)[number];

export function isSchemaDatasetId(value: unknown): value is SchemaDatasetId {
  return typeof value === 'string' && (SCHEMA_DATASETS as readonly string[]).includes(value);
}

export const schemaFileName = (ds: SchemaDatasetId): string => `${ds}.schema.json`;

const MODELINE_PREFIX = '# yaml-language-server:';

/**
 * '# yaml-language-server: $schema=../../schemas/<ds>.schema.json', relative to data/<ds>/<name>.yaml. Fixed
 * text, also for a CTXMAN_DATA_DIR outside the repo (the IDE hint then just does not resolve; nothing else
 * depends on it).
 */
export function schemaCommentLine(ds: SchemaDatasetId): string {
  return `${MODELINE_PREFIX} $schema=../../schemas/${schemaFileName(ds)}`;
}

/** `${schemaCommentLine(ds)}\n${body}` (body = a serializer's output, already ending in '\n'). */
export function withSchemaComment(ds: SchemaDatasetId, body: string): string {
  return `${schemaCommentLine(ds)}\n${body}`;
}

const BOM = '﻿';

/** First line of `source` without BOM and without a trailing CR. */
function firstLine(source: string): string {
  const text = source.startsWith(BOM) ? source.slice(1) : source;
  const end = text.indexOf('\n');
  const line = end === -1 ? text : text.slice(0, end);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * First line (BOM stripped, CR stripped): 'ok' if === schemaCommentLine(ds); 'wrong' if it starts with
 * '# yaml-language-server:'; else 'missing'.
 */
export function schemaCommentStatus(
  ds: SchemaDatasetId,
  source: string,
): 'ok' | 'missing' | 'wrong' {
  const line = firstLine(source);
  if (line === schemaCommentLine(ds)) return 'ok';
  return line.startsWith(MODELINE_PREFIX) ? 'wrong' : 'missing';
}

/**
 * Idempotent repair: 'ok' -> unchanged; 'wrong' -> first line replaced (EOL kept); 'missing' -> line
 * prepended (BOM dropped; a CRLF file gets '\r\n' after the inserted line).
 */
export function fixSchemaComment(ds: SchemaDatasetId, source: string): string {
  const status = schemaCommentStatus(ds, source);
  if (status === 'ok') return source;
  const line = schemaCommentLine(ds);
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
