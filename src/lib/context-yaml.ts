// PURE: the Forge YAML view's serializer + validator (UI_SPEC §H.7).
// `serializeContext` writes exactly what the server's context-io.serializeContext writes (same key order,
// same notes normalisation), so a context round-trips identically through the Forge and the API.
// `parseContextYaml` is a thin wrapper around the generic `parseYamlDoc` (src/lib/yaml-doc.ts) with the
// zod `contextSchema` and the immutable context name. No node:* / astro:* imports: it runs in the browser.
import { contextSchema } from '../datasets/schemas.ts';
import type { ContextDoc } from './entry-summary.ts';
import { parseYamlDoc } from './yaml-doc.ts';
import type { YamlIssue } from './yaml-doc.ts';
import { stringifyYaml } from './yaml.ts';

export type { YamlIssue } from './yaml-doc.ts';

export type ContextYamlResult = { ok: true; doc: ContextDoc } | { ok: false; issues: YamlIssue[] };

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

/**
 * Parse `text` as a context. `expectedName` is the immutable context name (file stem): a different
 * `name:` is an error. Syntax errors come first; schema problems are only reported for syntactically
 * valid YAML (a half-typed document would otherwise produce a wall of follow-up errors).
 */
export function parseContextYaml(text: string, expectedName: string): ContextYamlResult {
  return parseYamlDoc(text, contextSchema, { expectedName });
}
